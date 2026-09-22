---
title: Count the review layers, not the findings
date: 2026-09-18
category: workflow-issues
module: publishing
component: development_workflow
problem_type: workflow_issue
severity: high
applies_when:
  - "A third or fourth review pass is finding real defects in the fixes from the previous pass"
  - "Two independent reviewers, given different briefs, name the same function or helper"
  - "Each round's fix is individually correct and each round still produces a new P1"
  - "About to add a guard, a marker file, or a module-level cache to make a helper behave"
  - "A reviewer's finding names a batch, a request, or a session, and the fix reaches for the filesystem or a global"
tags:
  - code-review
  - greptile
  - adversarial-review
  - abstraction
  - concurrency
  - raycast-downloader
related_components:
  - development_workflow
---

# Count the review layers, not the findings

## Context

Fetch's first Store submission ([raycast/extensions#31248](https://github.com/raycast/extensions/pull/31248)) drew a 2/5 from Greptile with three findings. All three were valid and all three were fixed. Three adversarial passes then ran over those fixes, and each one found real defects **in the previous pass's work**:

| Layer | Found in the previous layer's fixes |
| --- | --- |
| 2 | A reservation leak on batch startup failure; the `filename*` charset parsed and then ignored |
| 3 | Quote-stripping before splitting reproduced the exact bug it fixed; releasing a reservation on `conflict` deleted a **live** runner's `.part`; the overwrite fallback exiled every future download to `foo (1)` |
| 4 | A bare `catch` masking `ENAMETOOLONG`/`EACCES`; `uniquePath` deleting the reservation the new helper had just made; a stale claim marker wedging overwrite mode permanently; a non-re-entrant module-level `Set` |

Twenty further findings across the three passes (2, then 8, then 10) — several severe, none of them present in the original Greptile round. Every individual finding was real, and every fix was a correct response to the finding in front of it. **Nothing inside any single round said "stop."**

What said stop was arithmetic. Layers 3 and 4 were independent reviewers working from different briefs, and both wrote, unprompted, that most of the damage was in one helper — a function called `claimExact` that layer 1's fix had introduced.

## Guidance

### 1. The count is the signal, not the severity

A review engine always has one more finding. Judging "are we done?" by the severity or plausibility of the current round is judging the wrong variable, because every round looks locally reasonable — that is what makes the loop feel productive while it is running.

The signal that a design is wrong rather than buggy is **convergence**: two or more independent passes, given different instructions, landing on the same symbol. One reviewer naming a helper is a finding. Two reviewers naming the same helper is a statement about the helper.

Track which symbol each round's findings cluster on. When the same name appears in two consecutive rounds, stop patching it and ask what it is for.

### 2. Ask what scope the original finding was actually about

Greptile's finding was that two URLs *in one batch* could resolve to the same output path. That is a **batch-scoped** fact: the batch is the only thing that knows which paths it has handed out.

`claimExact` answered it with process-global state, an atomic filesystem claim, a liveness probe over a marker file, and a reset hook. To answer a question about one array of URLs, it had to be right about the whole filesystem, about other processes, and about the command process's lifetime. Every later bug came from exactly those three gaps:

- filesystem — `ENAMETOOLONG` swallowed by a `catch` that assumed `EEXIST`
- other processes — a claim marker outliving a killed runner, wedging the name forever
- process lifetime — a module-level `Set` that a second batch could clear mid-flight

The fix was not a better guard. It was solving the problem at the altitude the finding described. `prepareItems` already knows every path it resolved, so a batch-local set threaded into the resolver closes it:

```ts
// https://github.com/chrismessina/raycast-fetch/blob/main/src/download-batch.tsx#L122
const taken = new Set<string>();
// …:144, after each resolve
taken.add(outputPath);

// https://github.com/chrismessina/raycast-fetch/blob/main/src/lib/url-utils.ts#L450, 463
taken?: ReadonlySet<string>,
overwrite && !taken?.has(direct) && reserveDirect(direct) ? direct : uniquePath(…, { reserve: true });
```

That single change closed four of layer 4's findings at once, because all four were consequences of the altitude rather than separate mistakes.

### 3. Deleting the helper is not deleting the capability

[Verify the remedy a review implies](verify-the-remedy-not-just-the-finding.md) §3 establishes deletion as a legitimate answer to a finding — in the case where *the feature was never implementable*. This is the neighbouring case and it resolves differently: the capability was fine and still ships. What was deleted was the **placement**.

The reservation itself survived, because it is genuinely needed — without a marker on disk a sibling's `uniquePath` sees a free name and picks the same one, which is the original bug. It shrank to one function with a deliberately narrow catch (`https://github.com/chrismessina/raycast-fetch/blob/main/src/lib/url-utils.ts#L425`), where every errno except `EEXIST` falls through to `uniquePath`, which budgets the filename length and surfaces an unwritable directory as a throw the commands already handle.

So the question at a convergence point is not "keep or delete" but "what is the smallest thing that has to exist, and who should own it."

### 4. A subtle predicate duplicated across two call sites will drift, and the drift is the bug

Layer 3's data-loss finding existed because the same release condition was written out at two call sites. A guard was added to one and not the other — and the unguarded copy deleted a live runner's `.part`, which kept writing to an unlinked inode until its final rename failed with `ENOENT`. Bytes lost, no visible cause.

The durable fix is one exported predicate, not two corrected copies:

```ts
// https://github.com/chrismessina/raycast-fetch/blob/main/src/lib/downloader.ts#L70
export function shouldReleaseReservation(result: DownloadResult): boolean {
  return !result.success && !result.id && result.errorCode !== "conflict";
}
```

When a condition is subtle enough to need a paragraph of comment explaining *why* a term is there, it is too subtle to exist twice.

### 5. Green gates say nothing about any of this

Every defect above passed `tsc --noEmit`, `ray build`, and `ray lint` with zero warnings, in every round. They were found by reading the dependency's `dist/` and by running throwaway scripts against the real package. Where a fix touches a library's runtime semantics, the check is to exercise it — witness the red, then the green — not to re-read the diff.

## Why This Matters

The loop has no natural end unless you supply one. Chasing a score round by round produces code that is locally defensible at every step and globally worse than what it replaced: by its last revision `claimExact` carried four branches, a module-level `Set`, and an exported reset hook, and was still generating P1s. The alternative — noticing convergence and changing altitude — removed more code than it added and closed four findings in one edit.

The cost of missing the signal is not just the extra rounds. It is that each round's fix is a plausible-looking piece of machinery which the next engineer inherits and reasonably assumes was necessary.

## When to Apply

- At round 3+ of any review loop, before writing the next fix
- Whenever two reviewers independently name the same function, file, or symbol
- When a fix's diff adds a guard, a marker file, a cache, or module-level mutable state in order to make an existing helper behave
- When the finding's own wording names a bounded scope (one batch, one request, one session) and the fix reaches outside it

Not a reason to ignore a finding. Every finding in this sequence was correct and every one was addressed; the question is only *where* the fix belongs.

## Examples

**The convergence, stated plainly.** Layer 3's report: *"Layer 3's `claimExact` is where most of the damage is."* Layer 4's report, written from a brief that did not quote layer 3: *"`claimExact` is where most of the damage is."* Two engines, two briefs, one sentence. That pair is the artifact to watch for.

**Altitude, before and after.**

```ts
// Before — process-global, filesystem-wide, answering a batch-scoped question
const claimedThisPass = new Set<string>();       // module-level
export function resetOverwriteClaims(): void { claimedThisPass.clear(); }
function claimExact(outputPath: string): boolean {
  if (claimedThisPass.has(part)) return false;
  try { closeSync(openSync(part, "wx")); }
  catch { if (existsSync(`${part}.claim`)) return false; /* … */ }   // bare catch
}

// After — the batch owns what the batch knows
const taken = new Set<string>();                 // local to prepareItems
resolveOutputPath(url, dir, overwrite, taken);
```

**The narrow catch that replaced the bare one.** A `catch {}` treating every `openSync` failure as "name already taken" returned a path with no reservation behind it, and the runner died on `ENAMETOOLONG` minutes later. Narrowing to `EEXIST` sends every other errno to `uniquePath`, which budgeted a 300-character basename down to 230 bytes and produced a path that opens.
