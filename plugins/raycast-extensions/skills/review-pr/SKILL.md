---
name: review-pr
description: Review SOMEONE ELSE'S Raycast extension pull request against raycast/extensions — resolve the contributor's fork and head branch, sparse-fetch only the touched extension into a scratch dir, run it locally in Raycast, and report findings. Fires on "review this PR", "check out this extension PR", "run this fork locally", or a pasted github.com/raycast/extensions/pull/<N> URL. Does NOT submit your own extension (that's `ship`) and does NOT change code (that's `develop`).
metadata:
  stage: "8 — inbound review of a third-party PR"
---

# review-pr

The **inbound** direction. `scaffold`/`develop`/`ship` move *your* extensions *out* to the
Store; this one pulls *someone else's* submission *in*, runs it, and reports on it. Chris
contributes to 13 extensions he doesn't own — reviewing other people's PRs against them is
recurring work, and it has its own hazards (destructive checkouts, monorepo bloat, judging a
fork by your own conventions).

## Seam rules (do not cross)

- **vs `ship`** — `ship` submits *your* extension and drives feedback *on* it. This reviews a
  PR authored by *someone else*. Opposite direction, different repo, different fork.
- **vs `develop`** — this skill is **read-and-run only**. It never edits the contributor's
  code. If review turns up something you want changed, that's a review *comment*; if it turns
  up a defect in *your own* extension, hand to [`develop`](../develop/SKILL.md).
- **vs your own open PR** — feedback on a PR *you* opened is `ship`'s review-feedback cycle.

## Throughline A — hard rail

**Never clone the full `raycast/extensions` monorepo, and never clone the contributor's full
fork of it either.** A fork of the monorepo is just as large as the monorepo. Fetch exactly
`extensions/<name>/` at the PR's head ref and nothing else — see
[`../../reference/sparse-checkout-discipline.md`](../../reference/sparse-checkout-discipline.md).

## Documented learnings — what to look for that CI cannot

`learnings/` in this plugin holds write-ups of defects and decisions from previous runs of these skills, each with the trigger that makes it relevant. **Read the row that matches what you are about to do — before doing it.** A learning is only useful at the moment it applies; rediscovering one after the review costs a round.

| When you are about to… | Read |
|---|---|
| showing, copying, or logging an error that may carry a server response or URL | [`error-display-is-a-credential-disclosure-surface`](../../learnings/security-issues/error-display-is-a-credential-disclosure-surface.md) |
| calling `useCachedPromise` / `useCachedState`, or branching on its `error` | [`use-cached-promise-caching-semantics`](../../learnings/design-patterns/use-cached-promise-caching-semantics.md) |
| sharing mutable state between commands, or between an AI tool and an open command | [`portable-node-advisory-file-lock`](../../learnings/design-patterns/portable-node-advisory-file-lock.md) |
| building a string or array across lines, tokens, or records inside a loop | [`quadratic-accumulator-paths-in-text-reflow`](../../learnings/design-patterns/quadratic-accumulator-paths-in-text-reflow.md) |
| a reviewer reports a collision or value you cannot reproduce | [`wrong-vendor-docs-manufacture-review-findings`](../../learnings/workflow-issues/wrong-vendor-docs-manufacture-review-findings.md) |
| changing a numeric constant on a directional argument, or choosing between two explanations | [`self-review-does-not-catch-diagnostic-errors`](../../learnings/workflow-issues/self-review-does-not-catch-diagnostic-errors.md) |

**A PR with green CI is not a reviewed PR.** The defects worth your time here are the ones no gate models: a cache key that does not vary per item, a hook returning stale data alongside an error, an effect that cannot tell a fetch from a cache restore. Each renders the wrong content or leaks state while `tsc`, `ray lint`, and `ray build` stay green. See [`use-cached-promise-caching-semantics`](../../learnings/design-patterns/use-cached-promise-caching-semantics.md).

> **Use the corpus for defects, never as a style stick.** These learnings encode *our* conventions alongside real hazards, and this skill's own caveat about judging a fork by your own conventions still governs. A contributor owes you correct code, not House Style. Raise a `design-patterns/` finding when it names a concrete failure the code will actually hit; keep a preference to yourself.

---

## Step 1 — Intake: resolve fork, branch, and extension from the PR number

Resolve these **headlessly via `gh`**. Do not ask the user to read the fork URL off the PR
page, and do not open "Files changed" by hand to find the extension folder — both are in the
API.

```bash
PR=29703   # the number from github.com/raycast/extensions/pull/<N>

# Fork clone URL, head branch, author, state.
gh api "repos/raycast/extensions/pulls/$PR" \
  --jq '{clone:.head.repo.clone_url, ref:.head.ref, author:.user.login, state:.state, draft:.draft}'

# Which extension(s) the PR touches. --paginate is REQUIRED — the files endpoint caps at
# per_page=100 and silently truncates beyond it, which would hide a touched extension.
gh api --paginate "repos/raycast/extensions/pulls/$PR/files" --jq '.[].filename' \
  | awk -F/ '/^extensions\//{print $2}' | sort -u
```

Use these REST calls rather than `gh pr view` / `gh pr diff`. Both routes work (verified
2026-07-24 on PRs #29703 and #29720, with Chris's token *missing* `read:org` — `gh pr view`
did **not** fail, and the speed difference is marginal, ~1.2s vs ~1.5s). The reason to prefer
`gh api` is narrower and real: **one call shape returns every field the intake needs**,
including `.head.repo == null` for a deleted fork, which the `gh pr` JSON surface doesn't
expose as cleanly. Consistency beats mixing two interfaces.

**Read the intake before proceeding:**

- **More than one extension touched** → say so and ask which to run. Don't pick.
- **`.head.repo` is `null`** → the fork was deleted; the PR cannot be run locally. Review the
  diff via the API and say that's what you did.
- **`state` is `closed`/merged** → confirm the user still wants it run before doing the work.
- **`clone` is `raycast/extensions` itself** → a maintainer branch, not a fork. Same procedure,
  different remote.

> **1Password gate.** `gh` here is aliased to `op plugin run -- gh`, so every call above needs
> 1Password unlocked. Locked → `authorization timeout` / `authorization failed`. That is the
> standing queue condition, **not** a broken command and not something to debug: note it in one
> line, and pick the review up when Chris says 1Password is ready.

## Step 2 — Fetch just that extension, into a scratch dir

**Fail-closed on the destination.** Never `rm -rf` a target path to make room. Your real
working copies of your extensions live somewhere on disk, and a
contributor's PR checkout landing on top of one would destroy uncommitted work. **Review
checkouts go to a scratch directory, and an existing directory is an abort, not a prompt.**

```bash
PR=29703
EXT=reddit-search                     # from step 1
FORK=https://github.com/someone/extensions.git
REF=ext/reddit-search-fix
DEST="${TMPDIR:-/tmp}/raycast-pr-review/pr-$PR"

# ABORT if the destination already exists — never clobber.
if [ -e "$DEST" ]; then
  echo "ABORT: $DEST exists. Inspect it or choose another path; do not delete blindly."
  exit 1
fi
mkdir -p "$DEST" && cd "$DEST"

# Blobless, treeless, single-branch, depth 1 — the fork is monorepo-sized.
git clone --depth=1 --filter=tree:0 --no-checkout -b "$REF" "$FORK" fork
cd fork
git sparse-checkout init --cone
git sparse-checkout set "extensions/$EXT"
git checkout
```

**Verify at the clone root, BEFORE descending** — these two checks only mean anything from
here, and one of them fails misleadingly from anywhere else (see below):

```bash
git sparse-checkout list                        # expect exactly: extensions/<EXT>
ls extensions/ | wc -l                          # expect 1 — NOT ~2,000
jq -e '(.commands|type=="array") and (.commands|length>0)' "extensions/$EXT/package.json" \
  >/dev/null && echo "valid extension root" || echo "NO Raycast manifest — wrong path or bad ref"
```

> **Run the count at the clone root, or it silently means nothing.** From inside
> `extensions/$EXT` there is no `extensions/` subdirectory: `ls` writes its error to *stderr*
> (not counted by `wc -l`, which reads stdout) and the pipe reports **`0`** while the error text
> scrolls past in your terminal. So it fails safe — `0` is obviously wrong, not a false pass —
> but only if you actually read the number. The `jq` manifest check below is the check that
> genuinely proves you're in the right place. (Measured 2026-07-24.)

Only now descend to the extension root. **Do not `npm install` yet:**

```bash
cd "extensions/$EXT"                  # <- the extension root; stay here for everything below
ls                                    # expect package.json, src/, assets/
```

> 🚨 **`npm install` executes code you have not read.** A package's `preinstall`/`postinstall`
> lifecycle scripts run arbitrary commands as you, and a malicious or compromised dependency in
> a stranger's PR is a real supply-chain vector — this is someone else's branch, not yours.
> **Read the diff (step 3) BEFORE installing**, and specifically read `package.json` and any
> lockfile change first. Install happens in step 4, after review, and only once you've decided
> the dependency changes are legitimate. If you only need to *read* the change, you never need
> to install at all.

*Measured 2026-07-24 against `raycast/extensions`: this procedure materializes exactly 1
extension directory and ~19M on disk, versus the multi-GB full clone. A wrong or missing
branch fails loudly at clone time (`fatal: Remote branch … not found`), so a typo'd ref can't
silently give you the wrong code.*

**`cd extensions/$EXT` is not optional.** Run `npm install` / `npm run dev` / `npx ray lint`
from the clone root and you get `npm error code ENOENT … package.json` — or, via `npx`,
`could not determine executable to run`, which sounds like `ray` isn't installed. Neither error
mentions Raycast or your path, so it sends you debugging a dependency. See the
`[both]` extension-root rule (with the measured behavior table) in
[`../../reference/house-style.md`](../../reference/house-style.md) (*Environment / tooling*).

Do **not** `git init` the extension folder or detach it from the clone. That trick exists in
community guides so `npm run publish` works — but publishing is not your job here, and losing
the git context costs you the diff you're reviewing.

## Step 3 — Read the diff before you run it

Review the change as a change, from the fork's own history:

**Get the diff from GitHub, not from the fork clone.** GitHub computes the PR diff against
`raycast/extensions:main` — the real base. The fork's own `main` is a different, usually stale
commit, so diffing against it inside the clone silently compares to the wrong baseline:

```
upstream raycast/extensions main   d0d48b5…
cwouyang/extensions        main    8a7c4ed…    ← a contributor fork
<you>/extensions    main    51d5b63…    ← your fork
```

All three differ (measured 2026-07-24). This is the same trap as the wrong-PR-base failure in
[`ship`](../ship/SKILL.md) — a fork `main` drifts and the diff balloons or misleads.

```bash
# Authoritative: GitHub diffs against the true base.
gh pr diff "$PR" --repo raycast/extensions --name-only
gh pr diff "$PR" --repo raycast/extensions > "review-pr-$PR.diff"

# Per-file status + line counts. --paginate is REQUIRED: per_page caps at 100 and a large
# PR is silently truncated without it (raycast/extensions PRs regularly exceed 100 files
# when a fork's base has drifted).
gh api --paginate "repos/raycast/extensions/pulls/$PR/files" \
  --jq '.[] | "\(.status)\t\(.additions)+/\(.deletions)-\t\(.filename)"'
```

For local history/context inside the clone, `git log --oneline -10` is fine. Do **not** try to
reconstruct the base diff with `git diff origin/main …` — besides pointing at the fork's main,
a `--depth=1` clone of two unrelated refs has no merge base, so the three-dot form dies with
`fatal: no merge base` and `--deepen` does not rescue it (both verified 2026-07-24).

What actually matters, in rough priority:

1. **Does it do what the PR says?** Description vs. diff. Unexplained scope is the finding.
2. **Correctness on the unhappy paths** — network failure, empty response, missing preference,
   rate limit. Untested error paths are where extension bugs live.
3. **Store compliance** — manifest fields, `CHANGELOG.md` present with a `{PR_MERGE_DATE}`
   entry (never a hand-invented date), icon 512×512, screenshots ≤ 6, README assets **outside**
   `metadata/`. Fetch the live docs rather than auditing from memory — procedure in
   [`../../reference/store-guidelines.md`](../../reference/store-guidelines.md).
4. **Secrets and telemetry** — hardcoded tokens, an API key in source, analytics calls the
   description doesn't mention.
5. **Dependencies — read these before you install anything.** Any new entry in `package.json`,
   and any `package-lock.json` change. Look for: a heavy dep for a trivial job, an unmaintained
   or typosquatted name, a git/URL dependency instead of a registry version, and **`scripts`
   additions — especially `preinstall`/`postinstall`**, which execute on install. This is the
   gate that decides whether step 4 is safe to run at all.

## Step 4 — Install, then actually run it

Only now — with the diff and dependency changes read — install:

```bash
npm install     # from the extension root; you read package.json + lockfile in step 3
```

If the dependency review turned up anything you couldn't account for, **stop and say so
instead of installing.** Reporting "I did not run it because dependency X looked wrong" is a
legitimate and useful review outcome. `npm install --ignore-scripts` will skip lifecycle
scripts if you want the tree without executing them, though some native deps won't build.

A diff read is not a review. Load it in Raycast and exercise it:

```bash
npm run dev          # or `ray develop`
```

Walk the states, not the happy path — this is where real findings come from and where a
reviewer adds value a linter can't:

- **Empty** — no results / no data yet. Is the copy specific and actionable?
- **Loading** — does the spinner resolve on the *failure* branch too, or wedge forever?
- **Error** — force it (kill the network, bad token, empty input). Does it fail gracefully?
- **Filtered / narrow window** — a query matching nothing; a shrunken window. Truncation shows here.
- **The resolved ActionPanel** — open it and read the shortcuts on screen. Two actions on the
  same combo is a real defect, and `ray lint` does **not** check it (see
  [`../../reference/keyboard-conventions.md`](../../reference/keyboard-conventions.md)).

Then run their gates the way a maintainer would — from the extension root:

```bash
npx tsc --noEmit     # ray build does NOT typecheck; this catches what it misses
npm run build
npm run lint
```

Stop the dev process when done (a live `ray develop` holds the extension in a dev state in
Raycast).

## Step 5 — Report

Three buckets, each with a `file:line` and, for anything you claim is broken, **the actual
observed behavior** — not a prediction:

- **Blocking** — breaks, fails to build, leaks a secret, violates a Store requirement.
- **Should fix** — real defect or compliance risk, not fatal.
- **Optional** — genuine improvement; explicitly labeled as the author's call.

Say what you *ran* and what it *returned*. "`tsc` exit 0; empty state reads 'No results' with
no next step" is a finding. "Looks fine" is not a review, and a report with zero findings needs
you to first confirm you actually got the extension running — an unrun review and a clean
review look identical in the output.

> **House Style is YOURS, not theirs.** Do not report a contributor's extension as
> non-compliant for missing `@chrismessina/raycast-logger`, or for not using your preferred
> `src/` role folders. Universally-good findings (Copy-Error on failure toasts, shortcut
> collisions, `any` casts, unhandled rejections) are fair review comments on anyone's code.
> Personal conventions are not. This is the forked-extension caveat from
> [`develop`](../develop/SKILL.md), and it matters more here: you're a guest in their PR.

## Step 6 — Clean up

The scratch dir is disposable and monorepo-derived — don't leave it around to be mistaken for
a working copy later.

**Guard the delete on `$PR` being set, and on the path being the one you made.** An empty `$PR`
expands the path to `…/raycast-pr-review/pr-` — still inside the scratch namespace, so it won't
eat your home directory, but it also won't remove what you meant and may delete a *sibling*
review's dir. Verify, don't assume:

```bash
# 1. PR must be STRICTLY NUMERIC. `${PR:?}` alone only catches empty/unset — a value like
#    `../../Developer/my-extension` is non-empty and would still
#    expand into a path outside the scratch dir.
case "$PR" in ''|*[!0-9]*) echo "REFUSING: PR must be digits only, got '$PR'"; exit 1 ;; esac

DEST="${TMPDIR:-/tmp}/raycast-pr-review/pr-$PR"

# 2. Path must sit in the scratch namespace AND actually be a review clone.
case "$DEST" in
  */raycast-pr-review/pr-[0-9]*)
    [ -d "$DEST/fork/.git" ] || { echo "REFUSING: $DEST is not a review clone"; exit 1; }
    rm -rf "$DEST" && echo "removed $DEST" ;;
  *) echo "REFUSING to delete unexpected path: $DEST"; exit 1 ;;
esac
```

Both checks are load-bearing. The numeric test is what actually contains a hostile or fat-fingered
`$PR`; the `case` + `.git` test catches a `$TMPDIR` that isn't what you assumed.

Only remove the path *you* created in step 2. **Never** sweep one of your real extension
working copies as part of review cleanup — those are real working copies
with uncommitted work in them, and no review ever needs to delete one.

If you'd rather keep the checkout around (to answer follow-up questions on the PR), leave it and
say where it is. A stale scratch dir is harmless; the step-2 abort guard will catch it next time.

## Gotchas

- **A fork of a monorepo is a monorepo.** `git clone <fork>` without
  `--filter=tree:0 --no-checkout --depth=1` pulls thousands of extensions. The filters are the
  whole point.
- **Community guides say `rm -rf "$ROOT/$EXTENSION_NAME"` before checkout.** Do not copy that.
  It is a blind delete of a path that may be your own working copy of that extension —
  exactly the fail-closed violation his standing rules forbid. Abort on collision instead.
- **`-b "$REF"` needs the head branch, not the PR number.** `git clone -b 29703` fails; the ref
  comes from `.head.ref` in step 1.
- **`-b <feature-ref>` gives you exactly one remote-tracking branch — so `origin/main` is
  absent.** `git clone -b main` *does* create `origin/main`, but a review clone is pinned to the
  PR's head ref, so the base you want was never fetched. Fetch it on demand
  (`git fetch --depth=1 origin main:refs/remotes/origin/main`).
- **Then use a TWO-dot diff, not three.** `git diff origin/main...HEAD` dies with
  `fatal: no merge base` in a shallow review clone — the two refs share no history, and
  `git fetch --deepen=50` does **not** rescue it. `git diff origin/main HEAD` works.
  Both verified 2026-07-24 on PR #29720.
- **Forks are not all named `extensions`.** Contributors fork to `<user>/extensions` *and* to
  `<user>/raycast-extensions` (both seen live: `cwouyang/extensions`,
  `artistro08/raycast-extensions`). Never construct the fork URL from the username — always
  take `.head.repo.clone_url` verbatim from step 1.
- **Head refs are not all `ext/<name>`.** Real branches include `readwise-reader/sort-and-random`,
  `add-neovim-extension`, `browser-tabs-windows-support` — slashes, no prefix, any shape. Quote
  the ref and don't pattern-match it.
- **Don't publish from a review checkout.** `npm run publish` in someone else's fork is not
  yours to run.
- **The extension root is `extensions/<name>/`, never the clone root.** See step 2.
