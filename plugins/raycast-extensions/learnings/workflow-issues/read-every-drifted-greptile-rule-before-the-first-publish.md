---
title: "A list of changed Greptile rules is a to-do list, not a note: read every changed rule before the first publish"
date: 2026-11-03
category: workflow-issues
module: publishing
component: development_workflow
problem_type: workflow_issue
severity: high
applies_to: ["ship"]
trigger: "when you are about to act on the Greptile rule changes that `rx gates` (its `greptile-rules` step) or `rx greptile outdated` lists during a pre-flight"
applies_when:
  - "`rx greptile outdated` FAILs, or `rx gates`' `greptile-rules` step lists rule changes, during a ship pre-flight"
  - "Submitting a NEW extension, which Greptile reviews against every rule rather than only the diff of an update"
  - "The Greptile rules in use are older than a rule-fleet change (new rules, changed scopes)"
symptoms:
  - "The preflight exits 0 and tsc, lint and build are green, yet Greptile opens at 2/5 with three P1s"
  - "Findings cite rules the plugin's greptile-rules.md map has never heard of"
  - "A policy we apply (then: ship AGENTS.md) is exactly what a changed rule now blocks"
root_cause: stale_reference_copy
resolution_type: process_change
---

# Read every drifted Greptile rule before the first publish

*Written against the pre-`rx` plugin, where `scripts/greptile-drift.mjs` printed DRIFT and the rule
copy lived in `reference/greptile/`. In this plugin the same signal is `rx greptile outdated` (FAIL
with one detail line per change) and the first step of `rx gates`, `greptile-rules`, which also
updates the copy in use; the rules snapshot is versioned inside `raycast-harness`
([`reference/greptile-rules.md`](../../reference/greptile-rules.md)). The lesson is unchanged.*

## What happened

`cosign` (new extension, raycast/extensions #33077, 2026-11-03). The pre-flight ran the drift
check first, as `ship` prescribed. It printed about twenty lines: six rules added
(`no-nested-review-config`, `extension-overlap`, `data-hooks-bugs`, `oauth-token-bugs`, ...) and a dozen
changed, among them `no-agent-scaffolding` and the docs rules. `ship` said drift *never blocks*, and the run
read only the lines that looked relevant (`oauth-*`, `store-screenshots`, `changelog-entries`), then published.

Greptile's first review was 2/5 with three P1s and six P2s. Four came from rules in that same drift list that
were never opened: `readme-user-facing` (a Development section), `error-empty-state` (list shows "No
favorites" when the load failed), `no-agent-scaffolding` (`AGENTS.md`, which our own policy then said to ship), and
`manifest-basics` territory (an empty `tools` array). Every one was cheap to fix before publishing and
cost a review round after it.

## Why the existing gates passed

The preflight encodes only the deterministic rules, and only the ones someone has ported. A rule added
upstream has no check until the checks are updated, so a green preflight says nothing about it. The
rule copy is also what the *judgment* walk reads, so a stale copy makes the judgment walk stale too.
The drift list is the one signal that says "your map is out of date"; reading only part of it defeats it.

## Guidance

1. **Take the live rules first**, so the judgment walk reads current text. `rx gates` does this in its
   `greptile-rules` step; outside a gates run, `node "<plugin>/scripts/rx.mjs" greptile update`.
2. **Read the text of every added or changed rule** and write one line per rule in the pre-flight report
   (`pass`, `fail`, or `n/a` with the reason), against the branch diff. The rx audit already requires a
   `greptile/<rule id>` entry for every judgment rule; a changed rule's entry is written from its new text.
   Skimming titles is the failure; the rule bodies hold the specifics (for `error-empty-state`: destructure
   `error` and `revalidate`, render a retry view; for `readme-user-facing`: no Development or build section).
3. **Treat a changed policy rule as a decision, not a detail.** A rule that now blocks something the plugin
   ships on purpose (here `AGENTS.md`) goes to Chris before the publish, with the rule text quoted. (Here
   he ruled on 2026-11-03 that `AGENTS.md` and `CONCEPTS.md` no longer ship: kept in the mirror, listed in
   the extension's `.gitignore`.)
4. **A finding the product visibly contradicts is declined with a screenshot, not fixed.** `list-search-filtering`
   said accessories are hidden beside the detail pane; the submitted `metadata/` screenshot showed them
   rendering. Quote the screenshot in the thread.
5. **When two sources conflict, satisfy both in the UI.** House style wanted Copy Error on every failure toast,
   while `failure-toasts` wanted `failureToastOptions` (which cannot carry the error text). The error view
   with Retry and Copy Error satisfied both.

## Receipt

Round 1 of #33077: 2/5, nine findings. After the fixes and replies (head `11356cf`): 5/5.
