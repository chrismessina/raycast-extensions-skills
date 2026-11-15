---
title: "The mirror sync workflow: every incident behind a guard in sync-from-upstream.yml, dated, with the run that proved it"
date: 2026-08-01
last_updated: 2026-10-31
category: workflow-issues
module: publishing
component: development_workflow
problem_type: workflow_issue
severity: high
applies_when:
  - "Editing `templates/sync-from-upstream.yml` or a mirror's installed copy of it"
  - "A standalone mirror's sync run failed, opened a conflict issue, or stopped opening PRs"
  - "Tempted to remove a guard in the workflow that looks redundant"
  - "Diagnosing a mirror that reverted a local edit or lost a file"
applies_to: ["ship"]
trigger: "when you are about to edit templates/sync-from-upstream.yml or diagnose a failed mirror sync run"
tags:
  - mirror
  - sync
  - github-actions
  - raycast-extensions
  - three-way-compare
---

# The mirror sync workflow: the incident behind every guard

`templates/sync-from-upstream.yml` reconciles a standalone mirror (`chrismessina/raycast-<name>`)
against the merged `raycast/extensions` state. The workflow keeps its decision table and a short
invariant comment per guard; each guard's incident is recorded here, keyed by the comment that
points at it. Dates are when the failure was diagnosed; run ids are GitHub Actions run ids on the
named mirror.

## Blind overwrite (the reason the three-way compare exists) — 2026-08-01

The previous workflow downloaded each upstream file and committed it unconditionally. That silently
reverted local-only work: on 2026-08-01 it undid a README fix (a dead `docs/shelf.md` link) by
restoring the monorepo's older copy, and reported success. The bug was not the cron schedule; it was
overwriting without comparing. A merge-triggered sync running the same code would lose the same edit,
just less often — which is worse, because rare corruption is the kind you stop watching for.

## Resolving the subtree in one recursive call — 2026-07-31

Walking the contents API directory by directory issues a request per file — about 85 for a mid-size
extension — which trips secondary rate limits against a repo the default `GITHUB_TOKEN` does not own.
karakeep run `30660911758` failed partway through exactly that walk. The whole-repo recursive tree
call does truncate on this monorepo (verified the same day), which is why the call is scoped to the
extension's own subtree and the `truncated` flag is asserted: a truncated tree silently omits entries,
which would read as "upstream no longer serves this file" and become deletions.

## `.gitignore`d upstream paths and `git check-ignore --no-index` — 2026-08-02

The digger extension publishes a `.private/` directory that its mirror ignores. Downloading one is
harmless; staging it is not: `git add` refuses an ignored path and exits non-zero, which `xargs`
reports as 123 and the whole run fails. Verified on raycast-digger run `30744504919`, and every
scheduled run before it — which is why the failure mails arrived daily.

`--no-index` is the whole reason the guard works. By default `git check-ignore` consults the index
and reports a tracked file as not-ignored even when a `.gitignore` rule matches it; digger's mirror
had force-added four files under `.private/`, so the bare form returned false for exactly the paths
the guard exists to catch. `--no-index` asks the question actually meant: does a rule match this
path? Skipping is the correct resolution, not `git add -f`: the mirror's `.gitignore` is a
deliberate statement that the path does not belong there.

## `package-lock.json` is derived, never compared — 2026-09-17

A blob-SHA compare is the wrong instrument for a generated file. A standalone mirror legitimately
carries devDependencies the monorepo copy does not (the fleet-wide
`@ianvs/prettier-plugin-sort-imports`, added 2026-07), so its lock can never equal upstream's —
while upstream's lock keeps moving under Raycast's dependency bots. Both sides therefore differ from
the baseline on every run, the table classifies that as a conflict, and the sync halts forever.
Four mirrors (bookface, tesla-energy, trimmy, wrap-unwrap) had been failing daily since 2026-09-15
on exactly this, and no hand reconciliation would have cleared it — the next bot bump recreates it.
Taking upstream's lock is also wrong: it drops the mirror's own devDependencies and breaks `npm ci`.
The lock is regenerated from `package.json` with `npm install --package-lock-only --ignore-scripts`
only when `package.json` moved, and is excluded from deletion propagation for the same reason.

The lockfile-format guard exists because `ubuntu-latest` floats and the npm on it floats with it: an
image bump that changes `lockfileVersion` would rewrite the whole file inside a content PR as if
upstream had done it. A loud stop is recoverable; a silent whole-file rewrite reviewed as "sync from
upstream" is not.

## The `{PR_MERGE_DATE}` stamp is not a conflict — 2026-09-17

Delivering the stamp is half of why the workflow exists, yet it presents as a both-sides change: the
mirror wrote the literal placeholder, Raycast CI substituted the merge date. raycast-secret-browser-commands
had been halted since 2026-09-15 on a `CHANGELOG.md` whose only difference was `{PR_MERGE_DATE}` vs
`2026-09-15`.

The test is line-wise and exact, not a date mask. An earlier draft masked every ISO date in both files
and compared the results, which was far too loose: two sides editing the same *old* release date
differently also compare equal under that mask, and upstream would silently win. A line may differ
only if the mirror's line carries the placeholder and upstream's line is that same line with a date
where the placeholder is; every other line must match byte for byte, and the files must have the same
number of lines. The fetch is split out of the `if` chain so that a failed download is reported as a
network failure, not mistaken for "not a stamp".

## "Upstream is behind" and the hunk-level merge — 2026-10-01

Both exceptions exist because the halts they clear were the common case, not the edge case. Verified
against five mirrors halted the same day: fathom shipped upstream from the mirror and kept editing
(upstream equaled the mirror's own 09-17 commits); at-profile's `package.json` and `history.ts` took
a Raycast dependency sweep on top of the fleet's import-sort commit, edits that never touched the
same lines. A halt also freezes the baseline, so every halt left unreconciled compounds into the next
one.

`upstream_is_behind` is bounded to post-baseline commits on purpose. Searching all history would read
an upstream *revert* — Raycast backing out a release — as "behind", because the reverted-to bytes sit
in an older mirror commit, and the revert would be kept out silently. Bounded, that revert lands on a
pre-baseline blob and halts as a conflict. The residual misread is a revert to a version first
written after the baseline, which still keeps the mirror's newer copy.

`try_merge` fetches both sides by blob SHA, not by path (a raw URL breaks on a path with a space and
would misreport that as a conflict), verifies each blob's hash, runs `git merge-file`, and for JSON
requires the result to parse. Any fetch or hash failure returns "conflict", so a network blip halts
the run instead of guessing.

## Deletion propagation, and the regression it restored — 2026-07-31 to 2026-08-03

The compare loop only visits paths upstream serves *now*, so a file upstream removed is never seen
by it. The blind workflow this one replaced did propagate deletions by diffing `git ls-files` against
its download manifest, and dropping that was a silent capability regression carried since 2026-08-03.
The baseline makes the restored version strictly better informed: a path in the baseline and absent
from the upstream listing is an unambiguous upstream deletion, and a local-only file (`AGENTS.md`,
`CLAUDE.md`, `.github/`) is structurally incapable of becoming a deletion candidate because the
baseline only ever holds paths upstream served. The blind version's subdirectory scoping existed to
patch a `git ls-files` scan with no such guarantee, after karakeep run `30651601868` (2026-07-31)
removed `package.json`, `tsconfig.json` and the workflow itself while reporting success.

The mass-deletion refusal (more than half the baseline vanishing) exists because a legitimate
upstream restructure and a resolution bug that pointed at the wrong subtree look identical to the
script, and only one of them is recoverable from a review.

## The frozen baseline — 2026-08-13

Gating the baseline write on `updated != '0'` freezes it, because the runs that copy nothing are the
common case: every run after you adopt upstream's own bytes by hand short-circuits on byte-equality
and copies nothing. The compare then keeps scoring against a snapshot that stopped tracking the
mirror, and the next genuine upstream-only change reads as "both sides moved" and halts on a phantom
conflict. Diagnosed on raycast-karakeep (`0369178`, `ac103cf`): baseline pinned at 2026-08-03, 77
files against upstream's 88, two green no-op runs, then three phantom conflicts. Recording is
therefore unconditional; `synced_at` alone never produces a commit (the compare is on
`{upstream_commit, files}`), and the baseline-only commit runs only on the default branch because
`workflow_dispatch` can be fired against any ref.

## A pushed branch with no PR — 2026-08-27, and the Q21 verification — 2026-10-31

raycast-store-updates run `33111251375` pushed `sync/upstream-<sha>` and then had `gh pr create`
refused ("GitHub Actions is not permitted to create or approve pull requests"), leaving a branch with
no PR. Every run after re-derived the same commit-keyed name, made a fresh commit, and died on
non-fast-forward — wedged for six days. The first fix reused an existing branch instead of pushing.

That reuse had its own hole (audit job-C, 2026-10-30): an existing branch without an open PR was
reused without incorporating the newly computed reconciliation. Trace: a run pushes its branch, PR
creation fails, the mirror then receives a local fix while upstream stays at the same commit, the
next run computes a different safe reconciliation, finds the old branch, and opens a PR from that old
branch — the computed result is discarded. Since 2026-10-31 the workflow writes this run's staged
result to a tree object, fetches the existing branch, and reuses it (or its open PR) **only when the
branch's tree equals that computed tree**; a lookup failure or a mismatch stops the run and names
the stale branch for reconciliation. Not `--force`: a closed-but-undeleted PR, or a manual fix-up
commit someone pushed onto the branch, would be silently overwritten. And `set -e` does not cover a
`gh | grep` inside an `if` test (bash exempts it from errexit), so the open-PR lookup captures its
exit status explicitly and aborts on failure instead of reading an API blip as "no open PR".

## Content versus bookkeeping

The workflow's guarantee is that extension **content** reaches `main` only through a PR you merge.
The one direct write to `main` is the bookkeeping file `.github/upstream-sync-state.json`, committed
on the default branch when no PR will carry it. Until 2026-10-31 the header said "never pushes to
main" and a reader had to reach the baseline step to find the exception (audit job-C, Q30); the header
now states the distinction up front.
