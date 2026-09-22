---
module: development-workflow
date: 2026-07-30
problem_type: workflow_issue
component: development_workflow
severity: high
applies_when:
  - "About to change a numeric constant (page size, concurrency, timeout, batch size) on a directional argument"
  - "Two or more explanations fit the same observation and the most plausible one is about to be adopted"
  - "Relying on an API field's obvious meaning, especially a count alongside a filter or projection"
  - "About to treat a negative grep or an absent match as evidence"
  - "A fix targets one specific code path and was verified by re-reading the function"
  - "About to report a nontrivial branch as done"
tags:
  - debugging-methodology
  - empirical-measurement
  - adversarial-review
  - instrumentation
  - agent-behavior
  - raycast
related_components:
  - documentation
  - tooling
---

# Self-review does not catch diagnostic errors

## Context

Over one long session — a GraphQL transport rewrite plus menu-bar badge fixes for the `gh-pr-tracker` Raycast extension, shipped to the Store as [raycast/extensions#29801](https://github.com/raycast/extensions/pull/29801) (merged 2026-07-30) — the primary agent produced a run of **wrong diagnoses**. Not bugs: confident, articulate, internally-consistent explanations of why something was broken, each of which turned out to be false.

The ones this document draws on:

1. Duplicate fetches are the two commands each fetching.
2. Duplicate fetches are two separate processes.
3. Hoisting the fetch into `useCallback` will fix it.
4. A larger page size is faster.
5. A lower concurrency avoids overloading the API. *(a different agent, opposite direction)*
6. `timelineItems.totalCount` respects the `itemTypes` filter.
7. Raycast does not use strict mode — the grep came back empty.
8. The stale-badge fix can decide from the cached payload.
9. The duplicate fetching had been affecting every user since an earlier release.

Every one was caught by empirical measurement or by an independent reviewer. **None was caught by the agent re-reading its own code**, and several survived multiple self-review passes. Two survived *and produced a code change* — a `useCallback` hoist that fixed nothing (3), and a page-size bump that introduced intermittent 502s (4).

The pattern is not "the agent was careless." Every wrong diagnosis was the *most plausible* explanation available from reading the code. That is precisely the problem: reading code produces plausible theories, and an agent reviewing its own plausible theory against the same code will confirm it. Plausibility is what self-review measures, and plausibility is not truth.

This document is about the methods that broke the loop.

## Guidance

Treat any diagnosis you arrived at by reading code as a **hypothesis, not a finding**, until something outside your own reasoning has ruled on it. Five techniques do that work, roughly in order of cost.

### 1. Instrument with distinguishing labels

The cheapest and highest-yield move. When two hypotheses predict the same observable, add a field to the log that makes them predict *different* observables — then run once.

Duplicate fetches were showing up in the logs. The obvious theory: the view command and the menu-bar command each fetch, so of course there are two. Adding a `source` tag to the fetch options killed it in a single run — the pairs came back same-source (`view`, `view`, then `menu-bar`, `menu-bar`), not one of each.

The design rule: **a log line that both hypotheses would emit identically is not instrumentation, it is noise.** Before adding a log, ask what different values would mean. If the answer is "nothing, I'd just see that it happened," you have not built an instrument.

### 2. Build a discriminating probe

When the competing hypotheses are about *process or runtime topology* rather than data, a single well-chosen identifier can decide it.

Still on the duplicate fetches: after `source` disproved the two-commands theory, the remaining question was "is this one process running its effect twice, or two processes?" A module-scoped random ID, logged both at module scope and inside the fetch, answered it in one run:

```
Module loaded  { moduleLoadId: 'vkhn5g' }   ← ONE module load
Fetch starting { moduleLoadId: 'vkhn5g' }
Fetch starting { moduleLoadId: 'vkhn5g' }   ← SAME id
```

One module load, two fetches. That eliminated the entire class of "two processes" explanations without further debate.

A probe is discriminating when its possible outputs **partition the hypothesis space**. `moduleLoadId` does: same id ⇒ one process; different ids ⇒ two. Design for that partition explicitly rather than logging whatever is convenient.

### 3. Run a measurement sweep — record cost *and* latency, three trials

Never tune a constant by reasoning about it. Sweep it.

`PR_PAGE_SIZE` was raised 25 → 50 on the intuition that "fewer round-trips is faster." It caused intermittent 502s. The sweep against `raycast/extensions` (312 open PRs), 3 trials each, settled it:

| `first:` | elapsed | cost (points) | result |
| --- | --- | --- | --- |
| 10 | 2,120ms | 6 | 3/3 succeeded |
| 25 | 4,738ms | 14 | 3/3 succeeded |
| 50 | 9,361ms | 28 | **2/3 — one 502 Bad Gateway** |

Rate-limit cost per PR is **flat** (~0.56 points) at every page size. A larger page bought nothing on quota and only made each request heavy enough to hit GitHub's documented 10-second query timeout. The intuition was not merely unmeasured — it was measuring the wrong axis.

Crucially, **the same class of error runs in both directions and is not specific to one agent.** An adversarial Codex pass set `ACTIVITY_CONCURRENCY = 2` reasoning "do not amplify GitHub load" — equally plausible, equally unmeasured, equally wrong. Measured on 8 PRs, cost was identical (8 points) at every level:

| concurrency | elapsed |
| --- | --- |
| 2 | 2,464ms |
| 4 | 1,286ms |
| 8 | 892ms |

At 2, a cold start (nothing marked seen, so every scanned PR needs a detail fetch) was **slower than the design it replaced** — ~44s vs ~28s at 150 PRs.

Sweep protocol that earned its keep:

- **Three trials per setting**, not one. The 502 appeared on 1 of 3 at page 50; a single trial would have shipped it.
- **Record both axes** — latency and cost. Cost being flat is what disproved the whole premise of the page-size change.
- **Write the numbers into the code**, at the constant, not only into a doc.

### 4. Probe the API rather than trusting a field's obvious meaning

Truncation detection compared `timelineItems.totalCount` against `nodes.length`. Sound reasoning; wrong. `totalCount` **ignores the `itemTypes` filter** — it counts the entire timeline while `nodes` returns only the requested types. A direct side-by-side probe of the filtered and unfiltered forms on one PR made it unarguable:

```
filtered   timelineItems(last:30, itemTypes:[...]) → totalCount 9, nodes 4
unfiltered timelineItems(last:30)                  → totalCount 9
```

Consequence in production: **every** PR looked truncated — 25 of 25 — triggering a REST backfill for all of them and defeating the entire optimization while reporting success.

Note the second half of the discipline: the probe was then **extended across 50 PRs to establish scope**, which showed the other four connections (`comments`, `reviews`, `reviewThreads`, `commits`) report `totalCount` accurately. So the workaround was applied narrowly rather than defensively everywhere. **Establish the blast radius of a surprising API behavior; do not generalize it on one data point.**

### 5. Verify the location before reading an absence as evidence

A grep for `StrictMode` in the extension's locally-installed `@raycast/api` package came back empty, and that absence was read as "Raycast does not use StrictMode" — a load-bearing negative claim that then blocked the correct diagnosis for several turns.

The actual runtime lives in the Raycast.app bundle:

```
/Applications/Raycast.app/Contents/Resources/RaycastNodeExtensions_RaycastNodeExtensions.bundle/
  Contents/Resources/api/node_modules/@raycast/api/index.js
```

where the React root is created in strict mode — the bundle passes `process.env.NODE_ENV !== "production" && process.env.NODE_ENV !== "test"` as the `isStrictMode` argument to React's `createContainer`, and wraps the tree in `StrictMode` under the same condition. That is the real cause of the duplicate fetches: the dev renderer replays passive effects. It is **DEV-ONLY** — production launches evaluate that condition to false, so no shipped build ever double-fetched. (An earlier claim that this had been "doubling every fetch for every user" was itself a further wrong diagnosis, corrected by the same finding.)

Worth noting how the mechanism presents, since it is a trap of the same family: the bundle is minified, so the condition appears as a bare positional argument. Grepping it for a literal `isStrictMode: true` returns nothing — the only `isStrictMode` hit is React's unrelated public type-guard helper. Confirming this behavior means reading the `createContainer` call site, not searching for the option name.

The rule: **an absence is only evidence if you have verified you searched the thing that actually runs.** For any interpreted or bundled runtime, confirm which copy is loaded before treating a negative grep as a fact.

### 6. Get an independent reviewer, and ask for everything

Instances the agent could not have caught by instrumentation — because it never suspected them — were caught by Greptile, by a human Store reviewer, and by adversarial Codex passes.

The instructive one is the stale-badge fix, because it *failed on precisely the path it was written for*. The fix decided whether to commit an empty render by checking the cached payload. But the view command overwrites that payload with an empty list **before** launching the menu bar, so on the mark-as-read path the payload already read empty, the check concluded "nothing to clear," and the badge stayed. Found by a reviewer, not by self-review — self-review kept re-reading a function whose logic was internally coherent and never simulated the caller ordering.

Operationally: run the independent review on any nontrivial branch **before** reporting done, and ask the reviewer to report *everything* and filter in a separate pass. Scoping a review request by severity up front ("only high-severity," "be conservative") makes reviewers report less, which is the opposite of the goal.

## Why This Matters

An agent's self-review has a structural blind spot: it re-runs the same reasoning process that produced the diagnosis, against the same code, with the same priors. When the diagnosis was wrong because the *world* differs from the code's apparent semantics — a field that ignores a filter, a runtime that lives in a different directory, a caller that mutates state before invoking you — no amount of re-reading surfaces it. The code is consistent with itself. That is exactly what re-reading checks.

The costs observed here were not theoretical:

- Two wrong diagnoses **produced shipped code changes** (the `useCallback` hoist that fixed nothing; the 25 → 50 page-size bump that introduced intermittent 502s).
- One wrong assumption about `totalCount` **silently defeated the entire optimization** the session existed to build — 25 of 25 PRs falling back to REST while the code reported success.
- One fix **failed on the single path it was written for** and would have shipped a permanently stale badge.
- Wrong diagnoses **compound**: the `useCallback` theory was only reachable because the `source`-disproved theory had to fall first, and the StrictMode absence-of-evidence error then blocked the correct answer for several turns after that.

Each was caught by a technique costing minutes. Instrumentation with a distinguishing label is one field. A discriminating probe is one random string. A measurement sweep is three trials at three values. The asymmetry between the cost of the check and the cost of the miss is the entire argument.

A second-order benefit worth naming: **the measurements survive in the code.** When a swept constant carries its sweep table in its docblock, a future agent reading it inherits evidence rather than re-deriving a plausible theory. A measured constant with its measurement attached is significantly harder to un-tune by reasoning.

## When to Apply

Escalate from self-review to measurement whenever any of these hold:

- **You are about to change a numeric constant** — page size, concurrency, timeout, batch size, retry count — on the strength of a directional argument ("fewer round-trips," "don't overload the server"). Sweep it. Both directions of intuition were wrong here, produced by two different agents.
- **Two or more explanations fit the observation.** Do not pick the most plausible; build the label or probe that separates them. If you cannot name an observation that would distinguish them, your theory may be unfalsifiable — which is what happened with the `useCallback` hypothesis, since the installed `usePromise` stores its function in a latest-value ref and revalidates on its args array, never on function identity.
- **You are relying on an API field's obvious meaning** — especially a count, total, or flag alongside a filter, projection, or pagination parameter. Probe filtered and unfiltered variants side by side, then establish the blast radius across a sample.
- **You are about to treat an absence as evidence.** Confirm you searched the artifact that actually executes.
- **A fix targets a specific code path.** Trace the actual caller ordering and simulate that path, not the function in isolation.
- **Before reporting a nontrivial branch as done.** Independent review — a second agent, a static reviewer, a human — is the only technique that catches errors you do not suspect. Ask for everything; filter afterwards.

Self-review remains useful for what it is good at: typos, unhandled nulls, inconsistent naming, forgotten call sites. It is not a diagnostic instrument.

## Examples

### Duplicate fetches — plausible attribution, disproved in one run

**Before.** Duplicate fetch log lines. Diagnosis: the view command and the menu-bar command each fetch; naturally there are two. Plausible, matches the architecture, and confirmed by every subsequent re-read of both commands.

**Probe.** Add a `source: "view" | "menu-bar"` field to the fetch options and log it.

**After.** The pairs were same-source — two `view`, then two `menu-bar`. The theory was dead in one run. A follow-up module-scoped `moduleLoadId` (same value across both fetches) then eliminated the "two processes" class entirely. The real cause was Raycast's dev renderer replaying passive effects, which no amount of reading the extension's own source could have surfaced. **Cost of the probe: one field. Cost of not having it: two wrong diagnoses in sequence, one of which shipped a no-op `useCallback` refactor.**

### Page size 25 → 50 — an intuition that was measuring the wrong axis

**Before.** `PR_PAGE_SIZE` raised 25 → 50, reasoning "fewer round-trips is faster." Intermittent 502s followed.

**Sweep.** Three trials at 10 / 25 / 50 against a 312-PR repo, recording latency *and* rate-limit cost.

**After.** Cost per PR flat at ~0.56 points across all three sizes. The larger page bought no quota saving whatsoever and only pushed each request into GitHub's 10-second query timeout. Reverted, and the measurement written into the code.

The mirror-image instance is the more useful one: an independent Codex pass set `ACTIVITY_CONCURRENCY = 2` on the equally-plausible "do not amplify GitHub load." Measured cost was identical at every concurrency level; only wall-clock moved — 2,464ms at 2 vs 892ms at 8 — and at 2, a cold start was *slower than the design it replaced*. **Two agents, opposite intuitions, both wrong, one measurement each.**

### `timelineItems.totalCount` — a field that does not mean what it says

**Before.** Truncation detected by `totalCount > nodes.length`, applied uniformly to all five connections. Correct-looking, and it silently made **every** PR fall back to REST — 25 of 25 — negating the optimization while reporting success.

**Probe.** Query the same PR twice, filtered and unfiltered, side by side.

**After.** Filtered: `totalCount 9, nodes 4`. Unfiltered: `totalCount 9`. `totalCount` counts the whole timeline and ignores `itemTypes` entirely. Detection for that connection switched to saturation (`fetched >= requested`), and a 50-PR probe established that the other four connections *do* report accurately — so the workaround stayed narrow.

### The stale-badge fix that failed on its own target path

**Before.** To decide whether an empty render was needed to clear a stale menu-bar badge, the code checked the **cached payload**. Internally coherent; survived self-review.

**Reviewer.** Greptile traced the caller.

**After.** The view command overwrites the cached payload with an empty list *before* launching the menu-bar command. So on the mark-as-read path — the one path this fix existed for — the payload already read empty, the check concluded "nothing to clear," and the badge persisted. The fix introduced a separate committed-count key as the authority, with the caller-ordering hazard written into the comment so the next reader cannot repeat it.

**The generalizable lesson:** self-review verifies a function against itself. Only tracing the real caller ordering — or a reviewer who does — catches a function that is correct in isolation and wrong in situ.

## Related

- [`green-falsification-that-tested-nothing.md`](https://github.com/chrismessina/claude/blob/main/docs/solutions/best-practices/green-falsification-that-tested-nothing.md) — the verification-layer counterpart. That doc covers an agent failing to *verify* its own fix (probes returning a clean reading while checking nothing); this one covers an agent failing to *diagnose*. Its rule that a subagent's self-falsification is systematically weaker than an independent one is the same finding reached from the other side.
- [`bugs-concentrate-at-module-seams.md`](https://github.com/chrismessina/claude/blob/main/docs/solutions/architecture-patterns/bugs-concentrate-at-module-seams.md) — seven Critical defects survived a per-task review of every diff on a 39-commit branch, five of them living between the files those reviews examined. That doc explains *where* defects hide; this one explains *why re-reading did not surface them and what did*.
- The seven diagnoses are recorded in situ, with their corrections, in `docs/PERFORMANCE-FINDINGS.md` in the `gh-pr-tracker` extension repo — see §4.5 (cost model corrected by instrumentation), §5 (an adversarial pass overturning §3/§4, with the standing rule "where this section contradicts §3 or §4, this section wins"), §6.2 (page-size sweep), §6.4 (`totalCount` probe), §6.5 (the safety-margin bug reported by a human Store reviewer), and §6.6 (two silent-data-loss blockers found by adversarial review).
