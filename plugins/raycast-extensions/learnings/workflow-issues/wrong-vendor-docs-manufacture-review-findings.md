---
title: A wrong vendor doc manufactures review findings — check your own reference first
date: 2026-09-07
category: workflow-issues
module: publishing
component: development_workflow
problem_type: workflow_issue
severity: high
applies_when:
  - "A reviewer reports a shortcut, constant or API-value collision you cannot reproduce"
  - "Two independent reviewers report the same finding and that reads as corroboration"
  - "About to change working code to satisfy a finding whose premise is a documented value"
  - "A vendor's published reference disagrees with the artifact it ships"
  - "A documentation fix landed once and came back"
tags:
  - review
  - ground-truth
  - vendor-docs
  - verification
related_components:
  - development_workflow
---

# A wrong vendor doc manufactures review findings — check your own reference first

## Context

> ⚠️ **RESOLVED UPSTREAM 2026-09-15 — read this as a dated incident, not a standing claim.**
> Raycast fixed the docs (`raycast/extensions` #30879, #30538). Re-fetched 2026-09-15:
> `developers.raycast.com/api-reference/keyboard` matches the runtime on **all 17** `Common`
> constants, `Pin` included. The transferable lesson is below and still holds; the specific
> accusation against that page does not. Leaving it unmarked let it be repeated as present fact
> for a week, which a Raycast engineer had to correct.
>
> The live divergence today is different: **`@raycast/eslint-plugin` 2.2.0** disagrees with both
> the runtime and the docs on five constants. See
> `../../reference/keyboard-conventions.md`.

Raycast's public API reference documents `Keyboard.Shortcut.Common.Pin` as ⌘⇧P. The shipped runtime binds it to ⌘. Two automated reviewers, on two different days, each filed a duplicate-shortcut finding against the same PR: Sort by Popularity is ⌘⇧P, Pin is `Common.Pin`, therefore they collide.

I complied with the first. Moved a long-standing user shortcut from ⇧⌘P to ⇧⌘S to resolve a collision that does not exist, and shipped it. The revert, and the two commits documenting why, are three commits of pure churn in a branch already under review.

The value was never ambiguous:

```
$ grep -oE 'Pin:\{macOS:\{[^}]*\}[^}]*\}' \
    "/Applications/Raycast.app/.../api/node_modules/@raycast/api/index.js"
Pin:{macOS:{modifiers:["cmd"],key:"."},Windows:{modifiers:["ctrl"],key:"."}}
```

**And it was already written down in this repo.**
[`keyboard-conventions.md`'s semantic map](../../reference/keyboard-conventions.md#the-semantic-map-build)
has carried `` `Common.Pin` | ⌘ . | ctrl . `` all along, and [its header](../../reference/keyboard-conventions.md#keyboard-conventions) records that a June snapshot had five wrong macOS bindings — naming `Pin` — and says to "regenerate rather than trusting prose docs."

The rule existed. The correct value existed. Neither had any purchase, because both were written as guidance for *authoring* a shortcut, and I was *answering a review*. Those felt like different activities and are not.

## Guidance

### 1. When a finding cites a documented value, check your own reference before the vendor's page

The reflex on a review finding is to go read the vendor's docs, because that is where the reviewer got it. That is the one source already known to be wrong here.

A repo that has been burned before usually has the answer written down. Look there first — it is faster than the docs and it was verified against the artifact when it was written.

### 2. For a constant, read the shipped artifact, not the package that declares it

The npm `@raycast/api` has **no `index.js` at all** — it ships types (`Pin: Shortcut`) and no values. The values live in the runtime the host app bundles, and `ray build` leaves `@raycast/api` external precisely so the app supplies it. Reading the npm package would have found nothing and felt like confirmation.

Know which artifact carries the value before you go looking for it.

### 3. Two reviewers agreeing is not corroboration when both read the same page

The second finding felt like confirmation of the first. It was the same wrong source arriving twice — correlated inputs wearing the costume of independent agreement.

Ask what each reviewer *consulted*, not just what each concluded. Agreement between two readers of one document is one data point.

### 4. A remedy with no external premise can still rest on a finding that has one

[Verify the remedy a review implies](verify-the-remedy-not-just-the-finding.md) excuses "a pure refactor with no external premise (rename, extract, reorder)" from checking, on the grounds that there is no claim about the world to falsify. Moving a shortcut is exactly that shape, and the carve-out is wrong for this case: the falsifiable claim lived in the **finding**, not the remedy.

Amendment: check the premise of the finding *or* the remedy, whichever makes a claim about the world. A trivial remedy is not evidence that nothing needs checking.

### 5. If a doc fix has been reverted before, fix the generator

`Pin` was already corrected once — [#30538](https://github.com/raycast/extensions/pull/30538), 26 Aug — and reverted the next day by an automated "Docs: update for the new API release" commit. A page that regresses is being regenerated from a source that still holds the old value, so patching the rendered file buys one release at most.

Check the history of the line you are fixing before deciding what to fix.

## Why This Matters

A wrong value in a vendor's reference does not stay in the vendor's reference. It propagates into every reviewer that reads it, and those reviewers apply pressure to change correct code — with the authority of a second opinion and none of the evidence.

The failure is quiet in the worst way: complying *closes* the finding. The reviewer is satisfied, the thread resolves, and the defect is now in your code carrying someone else's confidence.

Auditing the whole table afterwards found **eight wrong cells across six rows**, not one — five macOS, three Windows. The one that cost a change was simply the one a reviewer happened to read.

## When to Apply

- Any finding whose premise is a value you did not write: a framework constant, a documented default, a platform binding.
- Especially when you cannot reproduce the problem the finding describes. That is the signal, not a reason to assume you are missing something.
- Not needed when the finding cites *your own* code and you can read the line it names.

## Examples

**Failed.** The ⌘⇧P collision. Complied, shipped, reverted. Cost: three churn commits and a user-visible change to a shortcut that was correct.

**Held.** The same PR, a finding that `metadata/` screenshots were missing. One `gh api` call showed six PNGs at 2000×1250 on `main`, absent from the *diff* because unchanged. Push-back instead of six needless screenshots.

**Held.** A finding that a short package name could absorb a tapped formula's warning. Ran the constructed regex against the exact reported input, got `false`, kept the code and posted the probe.

## Related

- [Verify the remedy a review implies, not just the finding](verify-the-remedy-not-just-the-finding.md) — the sibling; this amends its "pure refactor needs no check" carve-out, because there the finding was true and the remedy unchecked, and here the finding itself was false.
- [Answer a blocking review finding with a measurement](answer-a-blocking-review-with-a-measurement.md) — names compliance-by-default as the failure mode; this is compliance-by-default on a finding that was itself false.
- Grading a reverse-engineered model against the vendor release — its §2 ground-truth ladder puts a vendor's generated API reference on rung 2, tracking the build. This is a counterexample: a page presenting as generated-per-release, wrong about the value, and regressing after correction. Strengthen that corollary from "lags" to "can contradict, and can revert".
- Read the version off the running artifact — shares the primitive (ask the artifact, not the paperwork) but describes staleness between two points in time; here the doc and the runtime describe the same release and simply disagree.
- [`keyboard-conventions.md`](../../reference/keyboard-conventions.md) — the operational half, and where the durable rule for answering a collision finding lives.

## Provenance

Brew extension, [raycast/extensions#30852](https://github.com/raycast/extensions/pull/30852). Docs fix filed as [raycast/extensions#30879](https://github.com/raycast/extensions/pull/30879) (eight cells, six rows). Values read from Raycast 2.2.0.0's bundled runtime, 2026-09-07. Revert commit `bca7163`.
