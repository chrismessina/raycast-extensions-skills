---
title: Verify the remedy a review implies, not just the finding
date: 2026-09-06
category: workflow-issues
module: publishing
component: development_workflow
problem_type: workflow_issue
severity: high
applies_when:
  - "A reviewer's finding is correct and names or implies a specific fix"
  - "The implied fix depends on an external tool's output meaning what its shape suggests"
  - "About to comply with a first-round finding, where measuring the alternative would read as resistance"
  - "A remedy was already implemented and shipped, and a later reviewer contradicts it"
  - "Deciding whether to refine a feature or delete it"
tags:
  - review
  - verification
  - ground-truth
  - publishing
related_components:
  - development_workflow
---

# Verify the remedy a review implies, not just the finding

## Context

[Answer a blocking review finding with a measurement](answer-a-blocking-review-with-a-measurement.md) already establishes the split, in its §1: a finding is a claim about the code, and is *not* a claim that the implied fix is correct. This doc is the case where that split was ignored, the remedy was built, and it shipped.

In [raycast/extensions#30852](https://github.com/raycast/extensions/pull/30852), the Brew extension marked each row "Downloading" during a bulk upgrade. An adversarial reviewer correctly flagged the attribution as a fragile substring scan — a package named `git` matched an unrelated package's GitHub URL — and suggested matching Homebrew's own `Fetching <name> from <tap>` announcement instead. That was implemented, tested, and published.

A later reviewer found the remedy could not work at all. In Homebrew 6.0.22, `brew fetch` prints every `Fetching …` line while **enqueueing** (`/opt/homebrew/Library/Homebrew/cmd/fetch.rb:305` for formulae, `:344` for casks) and only then works the queue concurrently (`:84`, and `:174` on the fallback path). The lines announce what is *about to* be fetched. Attribution built on them raced through all 71 rows in milliseconds and parked on whichever package was announced last, for the entire download — a row claiming to be downloading while a different one was.

The finding was verified against the source. The remedy was not. Both checks were the same cost.

## Guidance

### 1. State the remedy's premise as a sentence, then check that sentence

Every remedy rests on a claim about the world. Write it down before building: *"`Fetching X from Y` is emitted when X starts downloading."* Once it is a sentence, it is checkable — and this one is false in a way that reading twenty lines of `cmd/fetch.rb` settles.

A remedy inherits none of the finding's credibility. The reviewer proved the old code was wrong; that is not evidence about the new code.

### 2. When the remedy reads another tool's output, read that tool's source

Output shape is not semantics. A line that names one package looks per-package; whether it *is* depends on when the emitting code runs. The question is never "does this line contain the name" but "what does the emitter do immediately after printing it" — one `grep -n` and one `sed -n` away in any tool you have on disk.

This is the same instrument as read the version off the running artifact, pointed at a remedy instead of a bug.

### 3. Deletion is a legitimate answer to a review finding

The outcome space is not {comply, defend}. When the remedy's premise is false *and no other signal exists*, the feature was never implementable and the honest fix is to remove it. Here brew genuinely does no per-package work during the batch, so no refinement of the match could have produced a truthful indicator.

Removing it took the status, its icon case, the regex, the counter guard, and four tests that only ever exercised the author's own regex. A test suite that green-lights a deleted premise was measuring nothing. Compare retire the code, keep the model §5.

### 4. A shipped remedy is still an unverified remedy

Implementation is not verification, and neither is a passing build. The misleading indicator cleared `tsc`, ESLint, a production build, and 43 tests, because every one of them measured whether the code ran — not whether its premise held. Compliance closes the review thread; it does not close the question.

### 5. Amendment to the parent doc's §6

That doc reserves its method "for the last finding, not the first," because measurement is expensive and reads as resistance. That is right for **benchmarking an alternative design** and wrong as a general rule for remedy-checking. Reading the emitter is cheap, invisible to the reviewer, and produces no argument — so it belongs on *every* finding, including the first. Deferring it is what let this remedy through.

Two instruments, two thresholds:

| Check | Cost | When |
| --- | --- | --- |
| Read the remedy's premise against ground truth | minutes | every finding |
| Build and benchmark the implied alternative | hours | last finding, when a rating will not clear |

## Why This Matters

An adversarial reviewer is most useful precisely where you are least able to check yourself, which is also where you are most likely to accept its suggested fix wholesale. The failure is quiet: the thread closes, the score improves, and the defect is now yours rather than the reviewer's — carrying the reviewer's authority.

It cost a shipped commit, a public PR update, a demotion from a second reviewer, and a fourth round on a branch that had already survived five.

## When to Apply

- Any review finding that names or implies a fix, at any severity, on the first round.
- Especially when the remedy parses, matches, or infers from output you do not control.
- Not needed when the remedy is a pure refactor with no external premise (rename, extract, reorder) — there is no claim about the world to falsify.

## Examples

**Held.** Same PR: a reviewer said outdated casks lost their kind and got formula-shaped brew argv. Premise — `brew outdated --json=v2` omits `token` from casks while `isCask()` keys off it — checked against `cmd/outdated.rb` and `cask/cask.rb`, held, remedy built at the ingress seam. No later contradiction.

**Failed.** The `Fetching <name>` remedy above. Premise never written down, therefore never checked.

**False finding.** The same reviewer later reported `metadata/` screenshots missing. The directory exists with six 2000×1250 PNGs, unchanged by the PR and so absent from its diff. Checking the premise — "not in the diff means not in the repo" — took one `gh api` call and produced a push-back instead of six needless screenshots.

## Related

- [Answer a blocking review finding with a measurement](answer-a-blocking-review-with-a-measurement.md) — the parent; this extends its §1 to remedies that were already built, and amends its §6.
- [Self-review does not catch diagnostic errors](self-review-does-not-catch-diagnostic-errors.md) — the same root cause with the wrong theory held by the author; this is the third instance, where the theory is the reviewer's and adopted by the author. Consolidate if a fourth appears.
- Read the version off the running artifact — ground truth over source-as-read.
- Grading a reverse-engineered model against the vendor release — §5, retire rather than refine.

## Provenance

Brew extension, [raycast/extensions#30852](https://github.com/raycast/extensions/pull/30852), 2026-09-06. Removal commit `6f85545`. Homebrew 6.0.22-65-gd55434689b.
