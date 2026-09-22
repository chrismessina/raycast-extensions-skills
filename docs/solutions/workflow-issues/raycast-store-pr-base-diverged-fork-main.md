---
module: publishing
date: 2026-07-17
problem_type: workflow_issue
component: development_workflow
severity: high
applies_when:
  - "Publishing a fork-maintained extension to raycast/extensions via `ray publish`"
  - "A Store PR shows far more changed files than the branch actually touched"
  - "The fork's `main` has diverged from upstream (carries its own commits or Sync merge commits)"
tags:
  - raycast
  - ray-publish
  - pull-request
  - fork
  - github
  - store-submission
related_components:
  - tooling
---

# Raycast Store PR balloons to 100s of files (wrong PR base = diverged fork main)

## Context

Publishing this extension to the Raycast Store goes through `ray publish`, which
opens a PR against `raycast/extensions`. On PR #29493, the "Files changed" count
was **143** even though the branch only touched `extensions/cursors/`. A human
reviewer flagged it, and one comment ("can you revert these changes, seems like a
merge conflict resolution has caused this") was actually a symptom of this same
root cause, not a real request to revert extension code.

The instinct is to think the branch is polluted and needs rebuilding or a manual
file-by-file cleanup. It does not. The branch is fine — the PR is diffing it
against the wrong base.

## Guidance

**Verify the PR base after every `ray publish`, and if it's wrong, retarget the
base — do not rebuild.**

`ray publish` sometimes opens the PR against **`chrismessina:main` (the fork)**
instead of **`raycast/extensions:main` (upstream)**. The fork's `main` periodically
diverges from upstream: GitHub's "Sync fork" produces **merge** commits rather than
fast-forwards, and the fork carries real first-party commits directly on `main`
(workflows and other maintenance commits). When the PR base is that diverged fork main,
GitHub diffs the branch against it and the PR balloons to every unrelated extension
change since the divergence.

Check (REST — works with a `repo`-scoped token; `gh pr edit`/GraphQL needs
`read:org` and may time out or fail):

```bash
gh api repos/raycast/extensions/pulls/<N> \
  --jq '{base_repo:.base.repo.full_name, base:.base.ref, changed_files}'
```

A correct PR reads `base_repo: raycast/extensions`, `base: main`, and
`changed_files` limited to your extension's files.

Fix — retarget the base, do **not** rebuild:

```bash
gh api -X PATCH repos/raycast/extensions/pulls/<N> -f base=main
```

The branch is already correct; only the base pointer is wrong. The diff collapses
to just your extension instantly — no re-clone, no new commits. On #29493 this
returned `{"base":"main","base_repo":"raycast/extensions","changed_files":19,...}`
(down from 143) in one call.

**Do NOT "fix" this by resetting the fork's `main`.** It carries the maintainer's
own commits (the fork-sync workflow, etc.). Retargeting the PR base is the correct,
non-destructive fix, and fork-main divergence becomes harmless once the base is
right.

## Why This Matters

- A 143-file PR reads as careless or conflicted to a reviewer and stalls the
  submission — the reviewer can't tell your 19 real files from 124 phantom ones.
- The two tempting "fixes" are both wrong and costly: pulling/rebuilding the branch
  wastes a full re-clone and re-publish cycle, and resetting fork `main` destroys
  first-party commits the fork legitimately holds.
- The real fix is a single REST call that changes a pointer, not the code. Knowing
  this turns a scary "everything is broken" moment into a ten-second correction.

## When to Apply

- Immediately after any `ray publish` for a fork-maintained upstream extension:
  verify base and changed-file count before treating the PR as done.
- Whenever a Store PR's file count is implausibly high, or a reviewer flags
  unrelated files / a "merge conflict resolution" that you didn't make.

## Examples

Before (wrong base — the branch diffed against diverged fork main):

```
base_repo: <you>/extensions
base:      main
changed_files: 143
```

After (`gh api -X PATCH ... -f base=main`):

```
base_repo: raycast/extensions
base:      main
changed_files: 19
```

## Related

- The canonical prevention lives in the **`ship` skill** (raycast-extensions
  plugin), under "Known failure — wrong PR base / diverged fork main → huge diff." A
  lesson was added there during this session so the audit runs on every publish. This
  doc is the repo-local record of the same failure for anyone working in `cursors`
  without that plugin loaded.
- The fork's own first-party commits are what make fork `main` un-fast-forwardable —
  do not delete them by resetting fork main.
