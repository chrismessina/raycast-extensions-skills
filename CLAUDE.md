# CLAUDE.md

Guidance for agents working in this repo. The README is the human-facing manual.

## What this is

Source for the **`raycast-extensions` Claude Code plugin** (`plugins/raycast-extensions/`): the
skills, the reference files that hold policy, the learnings the skills route to, the preset
`presets/chrismessina.json`, the runner `scripts/rx.mjs`, and the `rx guard` hook. Plus derived
`@raycast/api` release notes (`docs/reference/`). It is not a Raycast extension — there is no
`ray build` here, and `package.json` is `private: true` with Prettier as its only dependency.

The mechanics — every check a program can decide — live in the separate open-source CLI
`raycast-harness` (`rx`, repo `chrismessina/raycast-harness`), pinned here by `rx-version.json`.
This repo holds only what is Chris-specific: policy, procedure, judgment, evidence, and the preset
that binds his rules to `rx` checks.

## Editing the plugin

**A local-directory marketplace loads the plugin in place from this checkout.** An edit to a
`SKILL.md` reaches the next session, or the current one after `/reload-plugins` — not before. So
the skill already loaded in this session is the pre-edit version: do not verify an edit by invoking
the skill without reloading first. (Verified 2026-09-22 on Claude Code 2.1.280: a marker added to a
skill description appeared in a fresh session while the copy under `~/.claude/plugins/cache/` did
not have it. That cache copy is what GitHub installs run, not what a local checkout runs.)

Bump `version` in **both** `plugins/raycast-extensions/.claude-plugin/plugin.json` and
`.claude-plugin/marketplace.json` for a release, so GitHub installs see an update, and keep the
README's `**Status:**` line in step. **Run `bash check-references.sh` after touching any skill,
reference, learning, manifest, or the README** — it fails on a dangling `reference/X.md` pointer, a
skill missing from the README table or either manifest description, a version mismatch, a learning
no skill or reference links to, and a relative link that does not resolve. Exit 0 = clean.

## How skills call `rx`

One spelling, validated by `scripts/rx-calls-check.mjs --check` against the pinned version's
`rx commands --json`:

```bash
node "<plugin>/scripts/rx.mjs" <command> [subcommand] [--flags]   # <plugin> = two levels above the skill's directory
```

In a skill or reference, every line that names `scripts/rx.mjs` (a fenced line, an inline code span,
a hook command) must be exactly one call in that shape, on one line, with literal command, subcommand
and flag names. Each argument is a bare word, `'…'` (its contents are data), or `"…"` holding at most
`$NAME` or `${NAME}`; a `# comment` after a space is allowed. Anything else outside single quotes (a
substitution, an assignment, a redirection, a pipe, `&&`, a backslash, a `<placeholder>`) fails
`rx-calls-check` as `runner-shape`. Compute a value on its own line first (`EXT="$(jq -r .name
package.json)"`, then `--extension "$EXT"`). In prose, the path must sit inside a one-line code span;
a span holding only the path (`"<plugin>/scripts/rx.mjs"`) names the file and is not a call. A `$NAME`
argument is trusted as a value: never put a flag in a variable (`OPT=--json`, then `"$OPT"`), because
the check cannot see what it expands to.

The runner reads the exact version from `rx-version.json`, runs it (`npx -y raycast-harness@<version>`,
or a local checkout when `RX_DEV=<path>` is set during development), and appends
`--preset <plugin>/presets/chrismessina.json` to every command whose registry accepts it. Never a
bare `rx`, never `npx raycast-harness`, never `--preset` by hand. `reference/rx.md` is generated
from the registry by `scripts/rx-reference.mjs`; do not edit it. Every `rx` command prints
`VERDICT  check-id  message` lines and exits 0 (PASS/WARN/N/A), 1 (a FAIL) or 2 (an ERROR); a skill
branches on the exit code and quotes the FAIL/ERROR lines, and never re-implements a check in prose
or shell. One exception: `rx guard` without `--json` speaks the hook transport instead (allow =
silent, exit 0; deny = the hook's JSON decision document on stdout, also exit 0); its verdict form
is `--json`, for tests. Where a rule can be decided mechanically, add the check to `rx` — not prose to a skill.

**The guard.** `hooks/hooks.json` runs `rx guard` as a `PreToolUse` hook on every Bash command. A
publish is admitted only as the whole command `npm run publish` or `ray publish` (optionally after
one `cd <dir> &&`; the skills' canonical recipe is `npm run publish`), only behind a current
`rx gates` receipt and a valid `rx audit record` audit; any
other Bash command whose text contains the whole word `publish` is blocked (so the word stays out
of commit messages and `echo`), and marking a PR ready in any form is always blocked. Nothing in
this repo writes under `.git/rx/` by hand — that is `rx`'s state.

**Where `rx preflight` runs.** Inside `rx gates`, after `rx stale` has established the published
baseline and `rx scan` has checked the payload for forbidden examples — that is `ship`'s step 0,
after baseline verification, not "before anything is read". The pre-`rx` scripts (`preflight.mjs`, `greptile-drift.mjs`,
`ship/scripts/pr-body.py`) were ported into `rx preflight`, `rx greptile outdated` / `update` and
`rx pr body` and deleted; skills call the runner, never a script of their own, and the Greptile rule
snapshot is versioned inside `rx` (`reference/greptile-rules.md` maps it). Never hand-edit a rules
copy: `rx greptile update` replaces it, and updating the shipped snapshot is one coordinated change
(the `raycast-harness` release, the pin, the map's "Core snapshot" line and its table together;
`reference/greptile-rules.md` has the procedure).

## The preset and the audit matrix

`presets/chrismessina.json` is the one home for rule ids, scope, severity and bindings. Validate
with `node "<plugin>/scripts/rx.mjs" preset check "<plugin>/presets/chrismessina.json"`; regenerate
the matrix in `reference/house-style.md` with `… preset table <preset> --into <house-style.md>`
(`--check` fails when the generated region differs from the preset). Edit the preset, never the
table. Core `rx` carries no Chris-specific value — a new house rule is a preset entry plus a policy
section in a reference file, and a check in `rx` when it can be decided mechanically.

## `learnings/`

The learnings live **inside the plugin** so they ship with every install. Each one declares where
it routes in its frontmatter — `applies_to: ["ship", "develop"]` (skill directory names) and
`trigger: "when you are about to <do the thing>"` — and `scripts/learnings-routes.mjs` writes each
skill's *When you are about to… / Read* table between its `<!-- learnings:start -->` /
`<!-- learnings:end -->` markers (`--check` in CI). Rows are never written by hand. A learning only
a folder listing points at gets rediscovered after the review instead of read before the work, so
`check-references.sh` fails on a learning no skill or reference links to.

Filed by category with YAML frontmatter (`module`, `component`, `problem_type`, `tags`, plus
`applies_to` and `trigger`); array items are double-quoted. Match the existing vocabulary
(`component: development_workflow`, `module: publishing`, `module: skills`). `CONCEPTS.md` defines
the shared terms. Evidence moves, never vanishes: a narrative cut from a skill or reference goes to
a learning, and the rule keeps one line linking it.

Cite code in public repos by GitHub URL, and files in this repo by relative path. Never by a
machine-local absolute path: this repo is public.

## The pre-push hook

`githooks/pre-push` runs `plugins/raycast-extensions/scripts/ci.mjs` (every CI check, including
`check-references.sh` and the plugin's script tests) on the commit being pushed, with `RX_DEV`
unset and `RX_TARBALL` honored only as a test-only override — exported to a temp dir, so uncommitted or untracked files in the tree (another session's
work in progress) neither fail nor pass a push they are not part of. It exists because a new skill
shipped unannounced and CI failed on five pushes in a row before anyone looked. Install once per
clone: `ln -sf ../../githooks/pre-push .git/hooks/pre-push`. Do not set `core.hooksPath` — it would
bypass the `commit-msg` hook that blocks session URLs. When it fails, fix what it reports.

## Conventions

- US English everywhere (House Style, `us-english`).
- Prettier covers `yml`/`yaml`/`json` only (`npm run format`). Markdown is hand-wrapped.
- No Claude session URLs or Claude attribution lines in commits, docs or anything public
  (`Co-Authored-By: Claude` trailers are allowed).
