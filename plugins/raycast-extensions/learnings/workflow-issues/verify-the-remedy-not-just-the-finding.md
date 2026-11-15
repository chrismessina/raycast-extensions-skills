---
title: Verify the premise of a review finding and of the remedy it implies — then measure, not argue
date: 2026-09-06
last_updated: 2026-10-31
category: workflow-issues
module: publishing
component: development_workflow
problem_type: workflow_issue
severity: high
applies_to: ["ship", "raycast-pr-loop", "review-pr"]
trigger: "when you are about to comply with a review finding, answer a rating that will not clear, or act on a collision or value you cannot reproduce"
applies_when:
  - "A reviewer's finding is correct and names or implies a specific fix"
  - "The implied fix depends on an external tool's output meaning what its shape suggests"
  - "About to comply with a first-round finding, where measuring the alternative would read as resistance"
  - "A remedy was already implemented and shipped, and a later reviewer contradicts it"
  - "An automated reviewer holds a Store PR with a numeric rating and a 'not safe to merge' verdict across several rounds"
  - "A finding is technically correct but the remedy it implies is unstated or only implied"
  - "The correct answer is 'this is as good as it gets' and that has to be made credible to a bot"
  - "A reviewer reports a shortcut, constant or API-value collision you cannot reproduce"
  - "Two independent reviewers report the same finding and that reads as corroboration"
  - "A vendor's published reference disagrees with the artifact it ships"
  - "Deciding whether to refine a feature or delete it"
tags:
  - review
  - verification
  - ground-truth
  - measurement
  - vendor-docs
  - publishing
  - raycast-store
related_components:
  - development_workflow
---

# Verify the premise of a review finding and of the remedy it implies — then measure, not argue

One procedure, three incidents. The procedure is current; the incidents under **Evidence** are
dated records and are not amended in place. This file absorbed
`answer-a-blocking-review-with-a-measurement` (2026-08-18) and
`wrong-vendor-docs-manufacture-review-findings` (2026-09-07) on 2026-10-31; their amendment
chains are resolved here.

## The procedure

### 1. Separate four things: the finding, its premise, the remedy, the remedy's premise

A review says "X can still happen" or "X collides with Y." That is a claim about the code. It is
*not* a claim that the implied fix is correct — usually the remedy is never stated at all, and the
reader supplies it. Evaluate the finding and the remedy separately; they frequently disagree.
Each may rest on a claim about the world (an emitter's timing, a documented constant, a
platform binding). Write that claim down as a sentence. Once it is a sentence, it is checkable.

Compliance-by-default is the failure mode in every incident below. A rating that will not clear
creates pressure to ship *any* change that looks responsive, which is how a regression ships
with a green badge on it — or a correct shortcut gets moved to resolve a collision that does
not exist.

### 2. Check whichever premise makes a claim about the world — on every finding, including the first

Check the premise of the finding *or* the remedy, whichever one asserts something external. A
trivial remedy (rename, move a shortcut, reorder) is not evidence that nothing needs checking:
in Evidence C the remedy had no premise and the finding's premise was false. A remedy with no
external claim at all (a pure refactor answering a finding about your own code) needs none.

Where to check, cheapest first:

1. **Your own reference.** A repo that has been burned before has the answer written down,
   verified against the artifact when it was written. For a Raycast constant that is
   [`keyboard-conventions.md`](../../reference/keyboard-conventions.md). Look there before the
   vendor's page — the vendor's page is the one source already known to be wrong when a
   reviewer cites it.
2. **The shipped artifact, not the package that declares it.** The npm `@raycast/api` ships
   types and no values; the values live in the runtime the host app bundles. Reading the npm
   package finds nothing and feels like confirmation. Know which artifact carries the value.
3. **The emitter's source, when the remedy parses another tool's output.** Output shape is not
   semantics; a line naming one package looks per-package, and whether it *is* depends on what
   the emitting code does immediately after printing it — one `grep -n` and one `sed -n` away in
   any tool on disk.

This reading is cheap, invisible to the reviewer, and produces no argument, so it belongs on
*every* finding. Deferring it to "the last finding" is what let Evidence A's remedy through.

### 3. Two instruments, two thresholds

| Check | Cost | When |
| --- | --- | --- |
| Read the premise against ground truth (§2) | minutes | every finding |
| Build the implied alternative and measure it against what you have | hours | when a rating will not clear and the complete fix is not constructible in scope |

Measurement's credibility comes from being unusual. Spend it on the finding you have already
tried to fix, not the first one, and not on one you could settle by reading.

### 4. Two reviewers agreeing is one data point when both read the same page

Ask what each reviewer *consulted*, not only what each concluded. Correlated inputs arrive
wearing the costume of independent agreement (Evidence C: the same wrong doc page, two bots,
two days).

### 5. When you measure, report the number as the finding, and bound what remains

Build the fix the finding implies, run it under the real conditions, and report what was
built, what was measured, and the number — including when the sophisticated design loses.
Name the other constructions considered and why each was rejected, so the space reads as
searched. Then state the residual precisely: its trigger and its worst case. A bounded
residual is a different object from "known race, accepting it," and it is what lets a reviewer
close a thread it cannot otherwise close. **Do not overstate the bound** — Evidence B's first
statement of its residual was wrong, and the correct statement lives in
[`portable-node-advisory-file-lock`](../design-patterns/portable-node-advisory-file-lock.md) §6
and its Examples.

Put the rationale in the code, next to the guard it explains. The review thread is not durable;
the source comment is. Three overlapping guards with no comment saying which interleaving each
closes get "simplified" to two.

### 6. Deletion is a legitimate answer

The outcome space is not {comply, defend}. When the remedy's premise is false *and no other
signal exists*, the feature was never implementable and the honest fix removes it (Evidence A:
the status, its icon case, the regex, the counter guard, and four tests that only ever
exercised the author's own regex).

### 7. A shipped remedy is still an unverified remedy

Implementation is not verification, and neither is a passing build. Evidence A's misleading
indicator cleared `tsc`, ESLint, a production build and 43 tests, because every one measured
whether the code ran, not whether its premise held. Compliance closes the review thread; it
does not close the question.

### 8. If a doc fix has been reverted before, fix the generator

A page that regresses is being regenerated from a source that still holds the old value;
patching the rendered file buys one release. Check the history of the line before deciding
what to fix (Evidence C: `Pin` was corrected in #30538 and reverted the next day by an automated
docs update).

## Why this matters

An adversarial reviewer is most useful precisely where you are least able to check yourself,
which is also where you are most likely to accept its suggested fix wholesale. An automated
reviewer cannot be talked out of a finding — it has no stake and no memory of your reputation —
and it responds to evidence it can evaluate. That is a cleaner standard than human review
often applies, and it puts the effort in producing evidence rather than phrasing. The failure in
every incident below is quiet: the thread closes, the score improves, and the defect is now
yours, carrying the reviewer's authority.

## Evidence

### A. The remedy whose premise was false — Brew, [raycast/extensions#30852](https://github.com/raycast/extensions/pull/30852), 2026-09-06

The Brew extension marked each row "Downloading" during a bulk upgrade. An adversarial reviewer
correctly flagged the attribution as a fragile substring scan — a package named `git` matched an
unrelated package's GitHub URL — and suggested matching Homebrew's own `Fetching <name> from
<tap>` announcement instead. That was implemented, tested, and published.

A later reviewer found the remedy could not work at all. In Homebrew 6.0.22-65-gd55434689b, `brew fetch` prints
every `Fetching …` line while **enqueueing** (`/opt/homebrew/Library/Homebrew/cmd/fetch.rb:305`
for formulae, `:344` for casks) and only then works the queue concurrently (`:84`, and `:174` on
the fallback path). The lines announce what is *about to* be fetched. Attribution built on them
raced through all 71 rows in milliseconds and parked on whichever package was announced last,
for the entire download.

The finding was verified against the source. The remedy was not. Both checks were the same
cost. The premise — *"`Fetching X from Y` is emitted when X starts downloading"* — was never
written down, therefore never checked; twenty lines of `cmd/fetch.rb` settle it. Brew does no
per-package work during the batch, so no refinement of the match could have produced a truthful
indicator: the feature was removed (commit `6f85545`). Cost: a shipped commit, a public PR
update, a demotion from a second reviewer, and a fourth round on a branch that had already
survived five.

**Held, same PR.** A reviewer said outdated casks lost their kind and got formula-shaped brew
argv. Premise — `brew outdated --json=v2` omits `token` from casks while `isCask()` keys off it —
checked against `cmd/outdated.rb` and `cask/cask.rb`, held; remedy built at the ingress seam. No
later contradiction.

**False finding, same PR.** The reviewer reported `metadata/` screenshots missing. The directory
holds six 2000×1250 PNGs, unchanged by the PR and so absent from its diff. Checking the premise
("not in the diff means not in the repo") took one `gh api` call and produced a push-back instead
of six needless screenshots.

### B. The finding that was true and the remedy that was worse — Context7, [raycast/extensions#30311](https://github.com/raycast/extensions/pull/30311), 2026-08-18

A 41-file redesign of a forked extension drew six rounds from an automated reviewer over about
two and a half hours, seven line-level comments, three on `extensions/context7/src/lib/atomic-file.ts`.
Every round found something real and all six were fixed: a mutation that decided before taking
its lock, a mutator that bypassed the lock entirely, an unconditional lock delete (all three in
one commit), a live holder judged stale, a cleanup outside the lock, and a prune whose keep-set
was captured outside the lock.

One finding did not clear — round five, verdict **"not yet safe to merge"** at **4/5**: stale-lock
reclamation can, in principle, delete a successor's lock. Correct. Its only complete fix does
not exist in portable `node:fs`. Six rounds of this argument did not move the reviewer:

> The residual requires a crashed holder, two simultaneous reclaimers, and a stall between two
> syscalls. It is as tight as portable `fs` allows.

True as far as it went, and unfalsifiable as written. What ended it was building the remedy the
finding implied — each lock acquisition owns a unique filename, so a reclaimer cannot target a
successor's — and running it under contention:

> I built the fix your finding implies — each acquisition owns a unique lock path, so a
> reclaimer physically cannot delete a successor's. It closes that race and opens a worse one:
> when the directory empties the numbering resets, so a stale observation can claim a higher
> generation while another claims a lower one from an empty directory. Two holders, two paths.
> Measured 5 of 6 writes surviving, against 8 of 8 for the current design. `rename`-to-claim
> and `link`-based schemes relocate the same window rather than removing it.

Posted 05:29 UTC. The reviewer withdrew at 05:35 — six minutes — calling the 5/6-vs-8/8 result
"the most concrete data point here." One reply said "Closing this thread"; the other said "Happy
to drop the review flag — implementation looks correct as-is." Both were posted as top-level PR
comments rather than as replies inside the review threads, which is worth knowing if you go
looking for the withdrawal where the finding was raised. A maintainer approved at 08:25, the PR
merged at 08:27, and it published to the Store at 08:28 (https://raycast.com/loris/context7).
Six rounds of argument had not moved it; one number did.

**Retracted claim, kept here only as history.** The reply above, and the first write-up of this
incident, bounded the residual as *"a crashed holder, two simultaneous reclaimers, and a
multi-second stall between two adjacent operations; because the writes underneath are atomic,
the worst outcome is one lost update."* **That bound is wrong**, and the 2026-10-28 Codex review
of `raycast-at-profile` showed why: no crash is required (a live holder that stalled past the
threshold releases normally), one reclaimer can suffice, no multi-second stall is needed (a 20 ms
retry sleep is the window), and once a successor's lock is deleted two critical sections overlap
and the stale one's write can erase *several* committed updates, not one. The correct statement
is "never corrupt, can drop updates," with the interleaving spelled out in
[`portable-node-advisory-file-lock`](../design-patterns/portable-node-advisory-file-lock.md) §6
and its *Correction* under Examples. Do not quote the retracted bound in a review reply.

### C. The finding whose premise was a wrong vendor doc — Brew, [raycast/extensions#30852](https://github.com/raycast/extensions/pull/30852), 2026-09-07

> **Resolved upstream 2026-09-15 — read this as a dated incident, not a standing claim.** Raycast
> fixed the docs (`raycast/extensions` #30879, #30538). Re-fetched 2026-09-15:
> `developers.raycast.com/api-reference/keyboard` matched the runtime on all 17 `Common`
> constants, `Pin` included. Leaving the incident unmarked let it be repeated as present fact for
> a week, which a Raycast engineer had to correct. The live divergence afterward was different
> (`@raycast/eslint-plugin` 2.2.0 against the runtime on five constants); see
> [`keyboard-conventions.md`](../../reference/keyboard-conventions.md).

Raycast's public API reference documented `Keyboard.Shortcut.Common.Pin` as ⌘⇧P. The shipped
runtime binds it to ⌘ `.`. Two automated reviewers, on two different days, each filed a
duplicate-shortcut finding against the same PR: Sort by Popularity is ⌘⇧P, Pin is `Common.Pin`,
therefore they collide. The first was complied with: a long-standing user shortcut moved from
⇧⌘P to ⇧⌘S to resolve a collision that did not exist, and shipped. The revert (`bca7163`) and the
two commits documenting why are three commits of churn on a branch already under review.

The value was never ambiguous, read from Raycast 2.2.0.0's bundled runtime:

```
$ grep -oE 'Pin:\{macOS:\{[^}]*\}[^}]*\}' \
    "/Applications/Raycast.app/.../api/node_modules/@raycast/api/index.js"
Pin:{macOS:{modifiers:["cmd"],key:"."},Windows:{modifiers:["ctrl"],key:"."}}
```

And it was already written down in this repo: `keyboard-conventions.md`'s semantic map carried
`` `Common.Pin` | ⌘ . | ctrl . `` all along, and its header recorded that a June snapshot had five
wrong macOS bindings — naming `Pin` — with the instruction to regenerate rather than trust prose
docs. Both were written as guidance for *authoring* a shortcut; this was *answering a review*.
Those felt like different activities and are not. Auditing the whole page afterward found eight
wrong cells across six rows (five macOS, three Windows), filed as
[raycast/extensions#30879](https://github.com/raycast/extensions/pull/30879). `Pin` had been
corrected once before ([#30538](https://github.com/raycast/extensions/pull/30538), 26 Aug) and
reverted the next day by an automated "Docs: update for the new API release" commit.

**Held, same PR.** A finding that a short package name could absorb a tapped formula's warning:
the constructed regex run against the exact reported input returned `false`; code kept, probe
posted.

## Related

- [`portable-node-advisory-file-lock`](../design-patterns/portable-node-advisory-file-lock.md)
  — the technical half of Evidence B: the three guards, the measured alternatives, and the
  correct statement of the residual.
- [`self-review-does-not-catch-diagnostic-errors`](self-review-does-not-catch-diagnostic-errors.md)
  — the same root cause with the wrong theory held by the author; here the theory is the
  reviewer's and adopted by the author. Plausibility survives re-reading and dies on measurement.
- [`count-the-review-layers-not-the-findings`](count-the-review-layers-not-the-findings.md) —
  when the rounds themselves are the signal.
- [`keyboard-conventions.md`](../../reference/keyboard-conventions.md) — the operational rule for
  answering a shortcut-collision finding: confirm against the runtime.
