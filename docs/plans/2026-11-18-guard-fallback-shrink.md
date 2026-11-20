# Shrink the guard fallback to rx guard's text rules, and check the pin before it changes

Date: 2026-11-18. Status: plan; Codex r5 DESIGN returned PATCH, and both fixes are folded in below.

## Why

`plugins/raycast-extensions/hooks/hooks.json` runs `scripts/rx.mjs guard` before every Bash, Write,
Edit, MultiEdit and NotebookEdit call. Twice (on 2026-11-15, and again for 0.1.4 this week) the pin in
`rx-version.json` named an rx version npm could not serve yet, the runner exited 2, and every call
was refused, including the edit that would revert the pin. The uncommitted fallback in
`scripts/rx.mjs` removes that deadlock, but it also re-implements rx guard's path resolution
(symlink walking, path-word splitting). Four Codex rounds each found another divergence, and the
broad `ready` / `draft` patterns deny ordinary commands such as `gh pr create --draft` and
`rg ready src` during an outage.

What the fallback has to protect during an outage is small:

- **Publish.** rx cannot verify receipts while it is down, so rx itself would refuse any publish.
  Denying every mention of the word `publish` is exactly right, not over-blocking.
- **Marking a PR ready.** rx guard's rule is plain text matching already.
- **rx state and the attestation key.** rx guard's Bash rule is text matching plus path-word
  resolution. The resolution part only matters against a deliberately disguised path, during an
  outage. That is accepted as a residual.

## 1. Shrink `guardStake` (`plugins/raycast-extensions/scripts/rx.mjs`)

Copy, verbatim, the text rules from
`/Users/messina/Developer/GitHub/chrismessina/raycast-harness/src/audit/publish-command.mjs:86-123`:
`READY_MENTIONS`, `PUBLISH_MENTION`, `STATE_MENTIONS`, `normalize()` (continuations joined, quotes
and backslashes removed, lowercased) and `collapseSeparators()`. A comment names that file as the
source and says the copy must match it.

The fallback then decides:

| Call | Fallback |
|---|---|
| Hook input that is not a JSON object, or a Bash `command` that is not a string | deny (unchanged) |
| Bash whose normalized text matches `READY_MENTIONS` or `PUBLISH_MENTION` | deny |
| Bash whose collapsed normalized text matches `STATE_MENTIONS`, a literal worktree state path (`.git/worktrees/<name>/rx`), `.config/raycast-harness` in any spelling of home (`~`, `$HOME`, absolute), or rx's config directory (`configDir(env)`, lowercased) | deny |
| Write / Edit / MultiEdit / NotebookEdit with no target path | deny (unchanged) |
| Write / Edit / MultiEdit / NotebookEdit whose target, resolved against the payload's `cwd` with `path.resolve` (lexical, no symlinks) and lowercased, has a `.git/rx` segment pair, a `.git/worktrees/<name>/rx` triple, or lies in the config directory | deny |
| anything else | allow with the `systemMessage` warning (unchanged) |

Deleted: `GUARD_STAKES`, `landing()`, `isProtected()`'s physical forms, the path-word loop, the
protected-cwd check, and the `lstatSync` / `readlinkSync` imports if nothing else uses them.
A plain `.git/hooks/...` write is no longer denied: rx guard does not deny it either.

Unchanged: `runGuard` (the 90 s deadline, the stdin and EPIPE handling, passthrough of rx's own
answer when it runs), `DENY_UNREADABLE`, the never-`permissionDecision: "allow"` rule, exit 0.

The section comment shrinks to: what the fallback is for, that its rules are copies of rx guard's
text rules, and one residual sentence: while rx is down, a Bash path to rx state that is
disguised (through a symlink, `..`, a variable, or a separate git directory) is not caught, nor is
a Write target that reaches it only through a symlink. (Lexical `..` in a Write target is
resolved by `path.resolve`.)

## 2. Check the pin before it changes

`CLAUDE.md:76-82` already says to change the pin only after
`npx -y <package>@<version> --version` succeeds. Both outages happened anyway, because the rule is
prose and the pin is edited by hand. Make the safe path the easy one:

- New `plugins/raycast-extensions/scripts/pin-rx.mjs <version>`: runs
  `npx -y @chrismessina/raycast-harness@<version> commands --json` directly (not through the runner,
  so `RX_DEV` / `RX_TARBALL` cannot substitute another rx), with a timeout. It requires that
  document's `version` to equal `<version>`, renders the reference with `rx-reference.mjs`'s
  exported `render(registry, version)`, and only then writes `reference/rx.md` and
  `rx-version.json`. On any failure it exits 1 naming the version and npm's error, and writes
  nothing. A version npm has not propagated yet fails the same way; retry later. (Codex r5: the
  registry request replaces a separate `--version` probe and proves the reference can be built.)
- `CLAUDE.md:76-82` points at it: "bump the pin with `node plugins/raycast-extensions/scripts/pin-rx.mjs <version>`,
  never by hand." The surrounding text changes from "every call is blocked" to what now happens:
  the guard runs in its fallback, with a warning naming the problem.
- With part 1, a pin bumped by hand anyway no longer locks the session, so this script prevents a
  degraded session instead of a dead one.

## Tests (`plugins/raycast-extensions/scripts/rx.test.mjs`)

Witness each new case failing on the current code first where the current code differs.

- Replace the "Codex G1, G2" path test with a text-rule table run through the fallback:
  - denied: `gh pr ready 12`, `gh pr -R o/r ready 12`, `gh "pr" re""ady`, `gh api -X PATCH … -f draft=false`,
    `-f ready_for_review=true`, a GraphQL `markPullRequestReadyForReview`, `npm run publish`,
    `cat .git//rx/receipt.json`, `cat .git/worktrees/w/rx/receipt.json`,
    `cat ~/.config/raycast-harness/attest.key`, `rm ~/.config/raycast-harness/generations/current.json`;
  - allowed with the warning: `gh pr create --draft`, `gh pr list --label ready`, `rg ready src`,
    `cat .git/config`, `ls`;
  - Write denied: `.git/rx/x.json` (relative to `cwd`), `.git/worktrees/w/rx/x.json`, a path in
    the config directory; Write allowed: `rx-version.json`, `src/a.ts`, `.git/hooks/pre-push`.
- Keep the three-failure-mode test, the unreadable-input test, passthrough, G3 (odd values,
  EPIPE) and G4 (hang). Adjust the first test's guarded examples if they relied on `GUARD_STAKES`.
- `pin-rx.mjs`, with a fake `npx` on `PATH` and the plugin files redirected to a temp dir:
  a registry for the requested version (both files written); a registry naming another version,
  a non-JSON answer, and a nonzero exit (both files unchanged, exit 1).

## Procedure

Edit in the scratch copy, run `node --check` and the suite there, then copy into the plugin. The
plugin loads in place, so a broken `rx.mjs` locks every tool call.

## Out of scope

Running an older cached rx during an outage, shell-word tokenization, symlink resolution.
