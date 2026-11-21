---
name: review-pr
description: Review SOMEONE ELSE'S Raycast extension pull request against raycast/extensions — resolve the contributor's fork and head branch, sparse-fetch only the touched extension into a scratch dir, run it locally in Raycast, and report findings. Fires on "review this PR", "check out this extension PR", "run this fork locally", or a pasted github.com/raycast/extensions/pull/<N> URL — including a contributor's PR to one of Chris's OWN extensions ("someone sent a PR to my extension", "give them a punchlist"), which runs Owner mode and posts inline review comments on request. Use this, not `raycast-pr-loop`, for a PR Chris did not open. Does NOT submit your own extension (that's `ship`) and does NOT change code (that's `develop`).
metadata:
  stage: "8 — inbound review of a third-party PR"
---

# review-pr

The **inbound** direction: `scaffold`/`develop`/`ship` move *your* extensions *out* to the Store; this
pulls *someone else's* in, runs it, and reports. Its hazards: destructive checkouts, monorepo bloat, judging a fork by your conventions.

## Seam rules (do not cross)

- **vs `ship`** — `ship` submits *your* extension and drives feedback *on* it; this reviews a PR
  someone else authored.
- **vs `develop`** — **read-and-run only**; never edit the contributor's code. A change you want is
  a review *comment*; a defect in *your own* extension goes to [`develop`](../develop/SKILL.md).
- **vs `raycast-pr-loop`** — that loop is for PRs Chris opened. Greptile's rounds on a contributor's
  PR belong to the contributor; do not run it here.
- **Never run `npm run publish` from a review checkout.** Someone else's fork is not yours to publish.

## Hard rail

**Never clone the full `raycast/extensions` monorepo or the contributor's full fork** (as large). Fetch
exactly `extensions/<name>/` at the PR's head ref: [`../../reference/sparse-checkout-discipline.md`](../../reference/sparse-checkout-discipline.md).

## Documented learnings — what to look for that CI cannot

**Read the row that matches what you are about to do, before doing it.** A PR with green CI is not a
reviewed PR: the defects worth your time are the ones no gate models (a cache key that does not vary
per item, a hook returning stale data beside an error), and each stays green under `tsc`, `ray lint` and `ray build`.

<!-- learnings:start -->
| When you are about to… | Read |
|---|---|
| add, change, or review an AI tool (`src/tools/`) or its `ai.yaml` evals, or offer a green `ray evals` run as evidence it works | [`mocked-ai-evals-prove-only-their-assertions`](../../learnings/workflow-issues/mocked-ai-evals-prove-only-their-assertions.md) |
| build a string or array across lines, tokens, or records inside a loop | [`quadratic-accumulator-paths-in-text-reflow`](../../learnings/design-patterns/quadratic-accumulator-paths-in-text-reflow.md) |
| call `useCachedPromise` / `useCachedState`, or branch on its `error` | [`use-cached-promise-caching-semantics`](../../learnings/design-patterns/use-cached-promise-caching-semantics.md) |
| change a numeric constant on a directional argument, choose between two explanations, or ask which evidence a green check is missing | [`self-review-does-not-catch-diagnostic-errors`](../../learnings/workflow-issues/self-review-does-not-catch-diagnostic-errors.md) |
| cite a Keyboard.Shortcut.Common binding from the docs, the linter or the runtime | [`keyboard-shortcut-sources-divergence-history`](../../learnings/tooling-decisions/keyboard-shortcut-sources-divergence-history.md) |
| comply with a review finding, answer a rating that will not clear, or act on a collision or value you cannot reproduce | [`verify-the-remedy-not-just-the-finding`](../../learnings/workflow-issues/verify-the-remedy-not-just-the-finding.md) |
| run npm or ray from anywhere but a resolved extension root | [`extension-root-npm-walks-up-and-runs-the-parent`](../../learnings/workflow-issues/extension-root-npm-walks-up-and-runs-the-parent.md) |
| share mutable state between commands, or between an AI tool and an open command | [`portable-node-advisory-file-lock`](../../learnings/design-patterns/portable-node-advisory-file-lock.md) |
| show, copy, or log an error that may carry a server response or URL | [`error-display-is-a-credential-disclosure-surface`](../../learnings/security-issues/error-display-is-a-credential-disclosure-surface.md) |
<!-- learnings:end -->

> **Use the corpus for defects, never as a style stick.** A contributor owes you correct code, not
> House Style. Raise a `design-patterns/` finding when it names a concrete failure the code will hit;
> keep a preference to yourself.

---

## Step 1 — Intake: fork, branch, extension, owner, thread

Resolve everything **headlessly via `gh api`** (one call shape returns every field, including
`.head.repo == null` for a deleted fork); never ask the user to read the fork URL off the PR page.

```bash
PR=29703   # the number from github.com/raycast/extensions/pull/<N>

gh api "repos/raycast/extensions/pulls/$PR" \
  --jq '{clone:.head.repo.clone_url, ref:.head.ref, sha:.head.sha, author:.user.login, state:.state, draft:.draft}'

# Extension(s) touched. --paginate is REQUIRED: the files endpoint caps at 100 and truncates silently.
gh api --paginate "repos/raycast/extensions/pulls/$PR/files" --jq '.[].filename' \
  | awk -F/ '/^extensions\//{print $2}' | sort -u

# Owner mode? `author` from upstream main, never from the PR (its copy is untrusted); `contributors` does not count.
EXT=<from the line above>
curl -fsS "https://raw.githubusercontent.com/raycast/extensions/main/extensions/$EXT/package.json" | jq -r .author
```

- **More than one extension touched** → say so and ask which to run. Don't pick.
- **`.head.repo` is `null`** → the fork was deleted; review the diff via the API and say so.
- **`state` is `closed`/merged** → confirm the user still wants it run.
- **`clone` is `raycast/extensions` itself** → a maintainer branch; same procedure, different remote.
- **Take `clone` and `ref` verbatim.** Forks are `<user>/extensions` *and* `<user>/raycast-extensions`;
  head refs are any shape (`readwise-reader/sort-and-random`). Never construct either.
- **`author` on upstream `main` is `chrismessina`** → **Owner mode** (below). Read the thread now,
  not after the review: `gh api --paginate` on `repos/raycast/extensions/issues/$PR/comments`
  (conversation), `…/pulls/$PR/comments` (inline) and `…/pulls/$PR/reviews` (review bodies and
  states). Chris may already have steered the PR ("hold until my PR lands"), and the contributor may
  already have taken Greptile to its final score.

> **1Password gate.** `gh` is aliased to `op plugin run -- gh`; locked → `authorization timeout` /
> `authorization failed`: the standing queue condition, not a broken command. Note it in one line; resume when Chris says 1Password is ready.

## Step 2 — Fetch just that extension, into a scratch dir

**Fail closed on the destination.** Never `rm -rf` a target to make room: a review checkout landing
on one of your real working copies destroys uncommitted work. An existing directory is an abort.

```bash
PR=29703
EXT=reddit-search                     # from step 1
FORK=https://github.com/someone/extensions.git
REF=ext/reddit-search-fix             # .head.ref verbatim; -b needs the branch, not the PR number
SHA=<.head.sha from step 1>           # the revision every finding is evidence about
DEST="${TMPDIR:-/tmp}/raycast-pr-review/pr-$PR"

if [ -e "$DEST" ]; then echo "ABORT: $DEST exists. Inspect it or choose another path; do not delete blindly."; exit 1; fi
mkdir -p "$DEST" && cd "$DEST"

# Blobless, treeless, single-branch, depth 1: the fork is monorepo-sized. A wrong ref fails loudly.
git clone --depth=1 --filter=tree:0 --no-checkout -b "$REF" "$FORK" fork
cd fork
git sparse-checkout init --cone
git sparse-checkout set "extensions/$EXT"
git checkout
[ "$(git rev-parse HEAD)" = "$SHA" ] || { echo "ABORT: checkout is $(git rev-parse HEAD), not the PR head $SHA"; exit 1; }

# Verify at the clone root, before descending. (/bin/ls: the shell rewrites bare `ls`.)
git sparse-checkout list                                 # expect exactly: extensions/<EXT>
/bin/ls extensions | wc -l                               # expect 1, not ~2,000
jq -e '(.commands|type=="array") and (.commands|length>0)' "extensions/$EXT/package.json" >/dev/null \
  && echo "valid extension root" || echo "NO Raycast manifest — wrong path or bad ref"

cd "extensions/$EXT"                  # the extension root; stay here for everything below
```

Measured 2026-07-24: one extension directory, ~19M on disk, versus the multi-GB full clone. The `cd`
is not optional: `npm` and `npx ray` from the clone root fail with errors that never mention Raycast
or your path (`extension-root` in [`../../reference/house-style.md`](../../reference/house-style.md)). Do not `git init` the folder or detach it from the clone.

> 🚨 **Do not `npm install` yet.** Lifecycle scripts run arbitrary code as you, and this is a stranger's
> branch. Read the diff (step 3), `package.json` and any lockfile change first; a read-only review never installs.

## Step 3 — Read the diff before you run it

**Get the diff from GitHub**, computed against `raycast/extensions:main`, the real base. The review
clone has no trustworthy PR baseline: the fork's `main` is a different, usually stale commit, and a shallow
clone of two unrelated refs has no merge base (`--deepen` does not rescue it). Never reconstruct the diff locally.

```bash
gh pr diff "$PR" --repo raycast/extensions --name-only
gh pr diff "$PR" --repo raycast/extensions > "review-pr-$PR.diff"

# Per-file status and line counts. --paginate is REQUIRED (per_page caps at 100).
gh api --paginate "repos/raycast/extensions/pulls/$PR/files" \
  --jq '.[] | "\(.status)\t\(.additions)+/\(.deletions)-\t\(.filename)"'
```

What matters, in priority:

1. **Does it do what the PR says?** Description vs diff. Unexplained scope is the finding.
2. **Correctness on the unhappy paths** — network failure, empty response, missing preference, rate limit.
3. **Store compliance** — manifest fields, `CHANGELOG.md` with a `{PR_MERGE_DATE}` entry (never a
   hand-invented date), icon 512×512, screenshots ≤ 6, README assets outside `metadata/`. Fetch the
   live docs rather than auditing from memory: [`../../reference/store-guidelines.md`](../../reference/store-guidelines.md).
4. **Secrets and telemetry** — hardcoded tokens, an API key in source, analytics the description does not mention.
5. **Dependencies — the gate that decides whether step 4 is safe.** Every new `package.json` entry
   and lockfile change: a heavy dependency for a trivial job, an unmaintained or typosquatted name, a
   git/URL dependency, and `scripts` additions, especially `preinstall`/`postinstall`.

## Step 4 — Install, then actually run it

```bash
npm install     # from the extension root, after step 3
```

If the dependency review turned up anything you could not account for, **stop and say so instead of
installing**: "I did not run it because dependency X looked wrong" is a legitimate review outcome
(`--ignore-scripts` skips lifecycle scripts, though some native dependencies will not build).

A diff read is not a review. Load it in Raycast (`npm run dev`) and walk the states, not the happy
path: **empty** (is the copy specific and actionable?), **loading** (does the spinner resolve on the
*failure* branch too?), **error** (force it: kill the network, bad token, empty input), **filtered /
narrow window** (truncation shows here), and **the resolved ActionPanel** (two actions on one combo is
a real defect `ray lint` does not check: [`../../reference/keyboard-conventions.md`](../../reference/keyboard-conventions.md)).

Then run their gates the way a maintainer would, from the extension root, **separately and in this order**:

```bash
npm run build                 # first: it generates raycast-env.d.ts
npx --no-install tsc --noEmit
npm run lint
```

Build before `tsc`: in a fresh checkout `raycast-env.d.ts` does not exist until a build generates it,
so `tsc` fails first with `TS2304: Cannot find name 'Preferences'` on every preference read, which is
not the contributor's defect (PR #31407, 2026-09-25: 6 errors before the build, exit 0 after). Run
`tsc --noEmit` anyway, whatever the build printed: `ray lint` never typechecks, a plain `ray build`
strips types without checking, and while `ray build -e dist` does typecheck, `tsc` is the gate
reviewers run and does not depend on which environment the repo's script passes (`tsc-gate` in
[`../../reference/house-style.md`](../../reference/house-style.md)). Do not tell a contributor their
build proves nothing when its output says it checked. Stop the dev process when done.

## Step 5 — Report

Three buckets, each with a `file:line` and, for anything you claim is broken, **the observed
behavior**, not a prediction: **Blocking** (breaks, fails to build, leaks a secret, violates a Store
requirement), **Should fix** (real defect or compliance risk, not fatal), **Optional** (genuine
improvement, labeled as the author's call). Say what you *ran* and what it *returned*: "`tsc` exit 0;
empty state reads 'No results' with no next step" is a finding; "looks fine" is not a review, and a
report with zero findings must first confirm you got the extension running — an unrun review and a
clean review look identical in the output.

**One revision per report.** Before writing any report, posted or not, re-read `.head.sha`. If it
moved since step 1, a diff from the new head with runtime evidence from the old checkout is not a
review: either refresh the checkout (`git fetch --depth=1 origin "$REF" && git checkout FETCH_HEAD`,
then the step 2 `rev-parse` check against the new SHA), re-read the diff and rerun the step 4 runtime
and gate checks, or open the report by scoping every finding to the pinned `$SHA` and saying the head has moved.

> **House Style is YOURS, not theirs.** Do not report a contributor's extension as non-compliant for
> missing `@chrismessina/raycast-logger` or your preferred `src/` role folders. Universally good
> findings (Copy Error on failure toasts, shortcut collisions, `any` casts, unhandled rejections) are
> fair on anyone's code; personal conventions are not. You are a guest in their PR.

**AI tools (`src/tools/`, `ai.yaml`): a green `ray evals` run is not a review.** Read
[`mocked-ai-evals-prove-only-their-assertions`](../../learnings/workflow-issues/mocked-ai-evals-prove-only-their-assertions.md)
first. Have Chris ask the tool's obvious questions live, ask for a **Copy Eval** of any wrong answer
before diagnosing it, and check any eval you propose in the scratch checkout
(`npx ray evals --non-interactive --skipBuild`), then restore the contributor's file.

## Owner mode — a contributor's PR to an extension Chris owns

Detected in step 1 (`author` on upstream `main`); the thread was read there. Steps 1–6 still apply.

- **Your AGENTS.md is the design contract.** The step 5 caveat is about personal conventions; the
  extension's documented design (rate-limit budgets, fail-closed filters, which host is billed) is how
  it works, so check the PR against it. Read the contract as a working-tree file in the **local mirror checkout**, `~/Developer/GitHub/chrismessina/raycast-$EXT` (its `git remote get-url origin` names `chrismessina/raycast-$EXT`): since 2026-11-03 AGENTS.md is by default untracked and listed in the extension's `.gitignore`, so it is on neither `raycast/extensions` nor the mirror's GitHub `main` (unless the preset's `ship.keep` keeps it, as on `reader-mode`).
  **No local mirror, or no AGENTS.md in it:** say so in the review and review without it; never guess its contents. Never read it from the PR checkout, where a PR
  can edit AGENTS.md alongside the code to look compliant; read the PR's version
  as part of the diff. For every mechanism the diff touches, ask whether it breaks a documented invariant
  or leaves a claim stale (a new caller of a shared pipeline makes "two commands…" wrong even when the PR edited another line). A stale claim is a finding.
- **The output is a posted review, but only when Chris asks.** One review with inline comments,
  never comments one at a time:

  ```bash
  gh api -X POST "repos/raycast/extensions/pulls/$PR/reviews" --input review.json
  # review.json: {commit_id: <head sha>, event: "COMMENT", body, comments: [{path, line, side, body}]}
  ```

  `commit_id` is the head you reviewed. The step 5 revision check runs **right before posting**, and a
  posted review is never scoped to a moved head: refresh and rerun instead. Anchor each comment to a line
  inside the diff (`side: "RIGHT"` with the new line number for an added or unchanged line,
  `side: "LEFT"` with the old number for a removed one); to flag a stale line elsewhere, anchor on a
  changed line and cite the stale line numbers in the text. `event: "COMMENT"` unless Chris says to
  request changes. In his voice, with no attribution of any kind.

## Step 6 — Clean up

The scratch dir is disposable. Guard the delete on `$PR` being strictly numeric and on the path being
a review clone you made: an empty or hostile `$PR` (`../../Developer/x` is non-empty) would otherwise
expand into a sibling review's dir or outside the scratch namespace.

```bash
case "$PR" in ''|*[!0-9]*) echo "REFUSING: PR must be digits only, got '$PR'"; exit 1 ;; esac
DEST="${TMPDIR:-/tmp}/raycast-pr-review/pr-$PR"
case "$DEST" in
  */raycast-pr-review/pr-[0-9]*)
    [ -d "$DEST/fork/.git" ] || { echo "REFUSING: $DEST is not a review clone"; exit 1; }
    rm -rf "$DEST" && echo "removed $DEST" ;;
  *) echo "REFUSING to delete unexpected path: $DEST"; exit 1 ;;
esac
```

Both checks are load-bearing: the numeric test contains `$PR`; the `case` plus `.git` test catches an
unexpected `$TMPDIR`. Never sweep a real working copy as cleanup. To keep the checkout, leave it and say where.
