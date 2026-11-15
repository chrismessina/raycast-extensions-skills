---
module: publishing
date: 2026-07-17
applies_to: ["ship"]
trigger: "when you are about to verify a Store PR after publishing, or explain why it shows far more changed files than the branch touched"
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

**Verify both identities of the PR base after every `ray publish` — which repository
and which branch — and repair the one that is wrong without rebuilding the branch.**

The fork's `main` periodically diverges from upstream: GitHub's "Sync fork" produces
**merge** commits rather than fast-forwards, and the fork carries real first-party
commits directly on `main` (workflows and other maintenance commits). A PR whose diff is
computed against that diverged fork main balloons to every unrelated extension change
since the divergence.

Check (REST — works with a `repo`-scoped token; `gh pr edit`/GraphQL needs
`read:org` and may time out or fail). Read **both** the base repository and the base
branch, and the head too:

```bash
gh api repos/raycast/extensions/pulls/<N> \
  --jq '{base_repo:.base.repo.full_name, base:.base.ref, head_repo:.head.repo.full_name, head:.head.ref, changed_files}'
```

A correct PR reads `base_repo: raycast/extensions`, `base: main`, and
`changed_files` limited to your extension's files.

**What the one-call repair does and does not do.** The remedy that worked on #29493:

```bash
gh api -X PATCH repos/raycast/extensions/pulls/<N> -f base=main
```

That body sets the PR's base **branch**. It cannot move a PR to another base
**repository**: the endpoint `repos/raycast/extensions/pulls/<N>` already names a PR
that lives in `raycast/extensions`, so its base repo is `raycast/extensions` before and
after the call, and if the PR actually lived on the fork
(`repos/chrismessina/extensions/pulls/<N>`) this call would answer 404 for the upstream
number. Observed on #29493: the response read
`{"base":"main","base_repo":"raycast/extensions","changed_files":19,...}` and the
"Files changed" count fell from 143 to 19 in one call, with no re-clone and no new
commits. The exact mechanism by which re-asserting `base=main` collapsed the diff was
not captured — the pre-repair `base.ref` and `base.repo` were not read before the PATCH
(the first write-up of this incident asserted the base repo had been the fork; that
was inferred from the symptom, not read from the API). What is established: the
branch content was correct, the PATCH is a base-**branch** write, and it was
sufficient here.

So branch on what the check prints:

- `base_repo: raycast/extensions`, wrong or stale `base`, or the right base and an
  implausible `changed_files` → run the PATCH above; re-read the same fields.
- `base_repo` is the fork, or the PR number resolves only under
  `repos/chrismessina/extensions/pulls/` → no PATCH on the upstream endpoint can fix
  it; the PR is in the wrong repository. Open the Store PR against upstream
  (`ray publish` again, or `gh pr create -R raycast/extensions --head chrismessina:<branch>`)
  and close the fork-local one.

**Do NOT "fix" this by resetting the fork's `main`.** It carries the maintainer's
own commits (the fork-sync workflow, etc.). The branch is correct in every case above;
only a pointer or a target repository is wrong, and fork-main divergence becomes
harmless once the PR is against upstream `main`.

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
  verify base repository, base branch and changed-file count before treating the PR
  as done.
- Whenever a Store PR's file count is implausibly high, or a reviewer flags
  unrelated files / a "merge conflict resolution" that you didn't make.

## Examples

Observed on #29493 (the symptom, and the response after the PATCH):

```
Files changed (before): 143      # the only pre-repair value that was read

gh api -X PATCH repos/raycast/extensions/pulls/29493 -f base=main
→ {"base":"main","base_repo":"raycast/extensions","changed_files":19,...}
```

Claimed in the first write-up, not observed: that `base_repo` had read `<fork>/extensions`
before the call. A PATCH to the upstream endpoint cannot have changed that field, so the
claim is withdrawn; the branch-retargeting result stands.

## Related

- The `ship` skill runs the post-publish base check on every Store PR; this learning
  holds the incident and the corrected explanation, not a second copy of that
  procedure.
- The fork's own first-party commits are what make fork `main` un-fast-forwardable —
  do not delete them by resetting fork main.
