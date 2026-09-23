---
title: Guard accumulator loops with an elapsed-time assertion
date: 2026-07-25
last_updated: 2026-07-25
category: design-patterns
module: text-processing
component: wrap-unwrap
problem_type: design_pattern
severity: high
applies_when:
  - "Building a string or array accumulator across lines, tokens, or records in a loop"
  - "Testing an anchored regex against a whole accumulated buffer instead of a bounded tail"
  - "Calling .slice(), .join(), .split(), or .length on a growing accumulator inside its own loop"
  - "Scanning previously emitted output to classify or decide about the current item"
  - "Handling user-supplied input whose size is bounded only by a documented limit (e.g. a 1MB paste)"
symptoms:
  - "Inputs well inside the documented size limit hang for seconds to minutes with no UI feedback"
  - "Runtime grows superlinearly with input size (188KB ~10s, 833KB ~18s, 1MB ~32s)"
  - "npm test, tsc --noEmit, and ray lint all pass while the quadratic path is present"
  - "Careful code review by experienced engineers does not surface the hot path"
  - "A later correctness fix silently reintroduces quadratic behavior in a different function"
root_cause: logic_error
resolution_type: code_fix
related_components:
  - testing_framework
  - tooling
tags:
  - performance
  - quadratic
  - big-o
  - string-accumulation
  - v8-rope-flattening
  - regex-anchoring
  - profiling
  - performance-regression-test
---

# Guard accumulator loops with an elapsed-time assertion

> **Source extension:** file citations are absolute paths into
> [`chrismessina/raycast-wrap-unwrap`](https://github.com/chrismessina/raycast-wrap-unwrap),
> where the four fixes and the committed perf guards live. The guidance itself is
> extension-agnostic — it applies to any accumulator-shaped loop over user-supplied input.

## Context

The Wrap/Unwrap extension reflows Markdown text: `unwrap` collapses hard-wrapped lines back into paragraphs, `wrap` re-breaks them at a width budget. Both are accumulator-shaped — they walk lines and build up a growing string (unwrap's `Group.joined`) or a growing array of prior decisions (classify's `out`).

The extension advertises a hard input ceiling of one million characters, declared at `https://github.com/chrismessina/raycast-wrap-unwrap/blob/main/src/lib/pipeline.ts#L4`:

```ts
export const MAX_INPUT = 1_000_000;
```

Anything larger is rejected up front with an `OversizeError` (`https://github.com/chrismessina/raycast-wrap-unwrap/blob/main/src/lib/pipeline.ts#L59-61`). Everything at or under that ceiling is a paste the extension has promised to handle. That promise is what turned four ordinary-looking lines of code into user-visible hangs.

Four independent O(n²) paths were found in the reflow engine across an adversarial-review campaign (PR [raycast/extensions#29727](https://github.com/raycast/extensions/pull/29727), open and in review at time of writing). Each one made a paste *inside* the supported limit hang Raycast for seconds to minutes with no spinner, no counter, no way to tell the extension from a crash. Measured before → after:

| Input | Before | After |
| --- | --- | --- |
| 188KB indented code | 10,299ms | 14ms |
| 833KB single paragraph | 18,031ms | 22ms |
| 1MB prose | 32,056ms | 39ms |

None of the four was a nested loop. Every one was a single innocuous method call sitting inside a loop that happened to be accumulating.

Two facts about how this was found — and not found — set up everything below:

- **Three of the four shipped to the Store.** Causes 1–3 were live in [PR #27655](https://github.com/raycast/extensions/pull/27655), the extension's initial submission, under a fully green test suite. (The fourth was introduced and caught during the fix campaign itself — see below.)
- **Nobody ever filed an issue.** Zero GitHub issues were opened about it across two releases. A 32-second freeze reads to a user as *"Raycast hung"*, not *"this extension is slow"* — so the field does not report it either. There is no external feedback loop for this class of bug. The test suite is the only detector you get.

## Guidance

**Any function that accumulates a string or an array across a loop needs a committed test that asserts wall-clock elapsed time.**

Not a benchmark you run by hand. Not a note in the PR description. A test in the suite, with a generous ceiling, that fails on CI when someone reintroduces the quadratic path.

This is the whole lesson, and it is load-bearing because *every other gate passed while the quadratic path was live*:

- `npm test` — 147 tests, green
- `npx tsc --noEmit` — clean
- `npx ray lint` — exit 0

Type checking cannot see algorithmic complexity. Linters cannot see it. Correctness tests operate on fixtures small enough that O(n²) and O(n) are indistinguishable — a 12-line fixture runs both in under a millisecond. The only instrument that detects this class is a clock, and the only way a clock stays in the loop is if it lives in the test suite.

Three sub-rules make the guard work:

**1. The bound must be generous, not tight.** The unwrap guard at `https://github.com/chrismessina/raycast-wrap-unwrap/blob/main/test/unwrap.test.ts#L248-262` asserts `< 400ms` against a linear implementation that runs in roughly 15ms — a 25× headroom. That is deliberate. A tight bound (say 50ms) flakes on a loaded laptop, gets marked skip, and stops protecting anything. A 25× bound cannot flake on hardware variance but cannot survive an algorithmic regression either: the quadratic version took over 1000ms at that same size. The gap between "slow machine" and "wrong complexity" is orders of magnitude, so calibrate to the gap, not to the target.

**2. The input has to be big enough to separate the curves.** 20,000 lines for unwrap; 80,000 tokens for wrap. At 100 lines both implementations look identical.

**3. Assert correctness in the same test.** The unwrap guard also asserts `out.split("\n").length === 1` — otherwise a future "optimization" that skips the joining entirely would pass the timer.

## Why This Matters

The killer is never an obvious loop. It is an innocuous call on a growing accumulator. All four causes here reduce to the same shape — a method whose cost is proportional to the *accumulated* size, invoked once per *iteration*:

**Cause 1 — rescanning prior state (`https://github.com/chrismessina/raycast-wrap-unwrap/blob/main/src/lib/classify.ts`).** Deciding whether an indented line sits inside a list required knowing whether a list item had appeared since the last blank. The original implementation asked that question by rescanning every record produced so far:

```ts
// BEFORE (removed in the fix commit on this branch)
[...out]
  .map((c, i) => ({ c, i }))
  .reverse()
  .find(({ c }) => c.role === "blank")?.i ?? -1;
```

`[...out]` copies the whole array, `.map()` allocates another, `.reverse()` a third — three full passes over all prior output, once per line. 188KB of indented code: 10,299ms.

The fix replaces the query with incrementally-maintained state. A `Set` of blockquote depths is kept current inside a `push()` helper that every classification site funnels through (`https://github.com/chrismessina/raycast-wrap-unwrap/blob/main/src/lib/classify.ts#L314-354`):

```ts
const listDepthsSinceBlank = new Set<number>();

const push = (rec: Classified): void => {
  if (rec.role === "blank") {
    listDepthsSinceBlank.clear();
    listContentColumn.clear();
  } else if (rec.role === "list-item") {
    listDepthsSinceBlank.add(rec.prefixes.length);
    // ...
  }
  out.push(rec);
};
```

The consuming branch is now a `Set` membership test (`https://github.com/chrismessina/raycast-wrap-unwrap/blob/main/src/lib/classify.ts#L441`):

```ts
const inListContext = listDepthsSinceBlank.has(prefixes.length);
```

The structural move: routing *all* mutations through one `push()` helper is what makes incremental maintenance safe. Scattered `out.push()` calls would each need to remember to update the `Set`.

**Cause 2 — an anchored regex against the whole accumulator.** Unwrap's hyphen-rejoin rule tests whether the accumulated paragraph ends in a letter-plus-hyphen, using `HYPHEN_BREAK_END` (`https://github.com/chrismessina/raycast-wrap-unwrap/blob/main/src/lib/regex.ts#L100`):

```ts
export const HYPHEN_BREAK_END = /[\p{L}\p{Nd}][-­]$/u;
```

The `$` anchor makes this *look* like a constant-time end-of-string check. It is not. A regex engine still scans forward from every start position; the anchor only rejects matches, it does not skip the scan. Tested against the growing paragraph per join, an 833KB paste took 18,031ms. The fix tests against a short tail only.

**Cause 3 — `.slice()` on the accumulator forces a rope flatten.** This is the subtlest one and worth internalizing on its own. V8 represents `a + b` as a lazy *rope* (a cons-string), which is why plain concatenation in a loop is fast. Any operation that needs the flat characters — `.slice()`, a regex, `.charCodeAt()` — collapses the rope into a contiguous string, and that flattening is O(accumulated length). Do it once per iteration and you have rebuilt quadratic behavior out of two operations that each look free.

The isolated measurement, reproduced against a 32k-iteration concat loop:

| Loop body | Time |
| --- | --- |
| `regex.test(s.slice(-2))` + concat | 1308ms |
| `s.slice(-2)` + concat (no regex) | 11ms |
| plain concat | 2ms |

(Re-running this shape on a second machine gives 609ms / 7ms / 1ms — the absolute numbers vary by hardware, the two-orders-of-magnitude ratio does not.)

Note what the middle row proves: the slice alone was cheap here because V8's flattened result is cached and the loop appends to the *same* string, so the cost amortizes. Add the regex and the cost explodes. That interaction is not something you can reason about from the source — you have to measure it.

The fix threads a short tail string through the group object so the accumulator is never touched. `takeTail` (`https://github.com/chrismessina/raycast-wrap-unwrap/blob/main/src/lib/unwrap.ts#L34-39`) grabs 3 UTF-16 code units and refuses to split a surrogate pair:

```ts
function takeTail(text: string): string {
  const tail = text.slice(-3);
  // A leading low surrogate means the slice landed mid-pair; drop the orphan half.
  const first = tail.charCodeAt(0);
  return first >= 0xdc00 && first <= 0xdfff ? tail.slice(1) : tail;
}
```

`Group.tail` carries it (`https://github.com/chrismessina/raycast-wrap-unwrap/blob/main/src/lib/unwrap.ts#L168`), and `joinWithHyphenation` returns both the new accumulator and the new tail, deriving the tail from the short strings rather than from `joined` (`https://github.com/chrismessina/raycast-wrap-unwrap/blob/main/src/lib/unwrap.ts#L119-155`):

```ts
const keptTail = drop > 0 ? priorTail.slice(0, -drop) : priorTail;
const joined = (drop > 0 ? prior.slice(0, prior.length - drop) : prior) + separator + next;
// The result's last chars always lie within this short string, so the tail is
// derived without ever slicing `joined`.
return { joined, tail: takeTail(keptTail + separator + next) };
```

Two design details carry weight here. The `separator`/`drop` variables are computed first and applied *once* at the end, so no branch slices the rope. And a naive earlier attempt at this fix used a flat 2-code-unit tail window — fast, but it sliced astral characters in half so `\p{L}` stopped matching and the Unicode join it exists for silently broke. Bounding a window is a correctness change, not just a performance change; the boundary needs its own test (`https://github.com/chrismessina/raycast-wrap-unwrap/blob/main/test/unwrap.test.ts#L264` guards the surrogate-pair case).

The same principle applies to per-line state generally. `advanceInlineState` (`https://github.com/chrismessina/raycast-wrap-unwrap/blob/main/src/lib/unwrap.ts#L58-109`) computes whether the text ends inside an open code span or link destination *per line*, carrying the result forward on the group — because rescanning the whole accumulated paragraph for that answer was the other half of the 18-second paste.

**Cause 4 — self-inflicted, by a correctness fix, in a session dedicated to removing this exact bug class.** This is the sharpest evidence for the guidance.

Round 7 of review found `wrap`'s block-safety check wrong in both directions: testing the *next token* alone missed constructs assembled from several tokens (`_` is prose, `___` is held back, but the line `_ ___` is a horizontal rule and lost its round trip), and it overran the width needlessly. The correct fix is to judge the resulting *line*, not the token. The first cut of that fix built the candidate line as `tokens.slice(i).join(" ")` — every remaining token, joined, per rejected break. 1MB of prose went to 32,056ms.

That code never reached a commit. The committed perf guard caught it first.

The shipped version gathers only the tokens that could land on the candidate line, bounded by **both** a token count and the width budget (`https://github.com/chrismessina/raycast-wrap-unwrap/blob/main/src/lib/wrap.ts`):

```ts
let probeLine = t;
for (let j = i + 1; j < tokens.length && j - i <= BLOCK_PROBE_TOKENS; j++) {
  if (probeLine.length + 1 + tokens[j].length > contBudget) break;
  probeLine += " " + tokens[j];
}
if (wouldStartNewBlock(probeLine)) {
  cur += " " + t;
  continue;
}
```

**The first cut of this bound was itself insufficient, and that is the most transferable part of the story.** It stopped at `contBudget` alone — which is bounded, but bounded by a value the *user* controls. `width` has no upper limit: the wrap-column preference is unbounded, and a cross-extension launch context supplies it directly. With a large width and a run of tokens that keep being rejected, each rejected break re-scanned up to `width` characters, and the path was quadratic again: 20,000 unsafe tokens at width 20000 took 4048ms, 40,000 took 9564ms. An external review caught it; the width-80 perf guard never exercised that shape.

Capping by token count fixes it because the question being asked is small: whether a line *starts* a block is decided by its opening token or two — a marker, a fence, an ATX run, an underline. Eight tokens is always enough. Same input after the cap: 22ms and 49ms, flat in width and linear in run length.

So the escape hatch, stated properly: when you need lookahead, bound it by a **constant you choose**, not by a parameter your caller chooses. "Bounded by the budget" reads like a fix and is not one when the budget is user-supplied. And add the guard at a value that actually exercises the bound — a perf test pinned to the default width will not.

The reason cause 4 matters more than causes 1–3 combined: it was introduced by someone who had spent the entire session removing this bug class, in the file they had just fixed, with the failure mode fresh in mind. Vigilance did not prevent it. The committed clock did.

## When to Apply

Write a perf guard when the code under change has all three of these properties:

1. **It accumulates.** A string built with `+=` across a loop, an array pushed to and later queried, a `Map` grown per item — anything where iteration N sees the results of iterations 1..N-1.
2. **It touches the accumulation inside the loop.** `.slice()`, `.join()`, `regex.test()`, `.indexOf()`, `.charCodeAt()`, a `.find()` over prior results, spreading it into a new array. If the only operation is append, you are fine.
3. **The input size is attacker- or user-controlled up to a documented ceiling.** A 1MB paste limit is a *promise* that 1MB works. If your ceiling is 200 characters this does not apply.

Specific red flags in review — treat each as "measure before merging":

- `$`-anchored regex tested against a growing string. The anchor does not prevent the scan.
- `.slice()` on an accumulator, even `.slice(-2)`. It flattens the rope.
- `.slice(i)` / `.join()` over "the rest of" a collection inside a loop over that collection.
- `[...arr]`, `arr.map()`, `arr.reverse()`, or `arr.find()` where `arr` is the output array being built.
- Any answer to "what happened earlier?" computed by scanning instead of maintained incrementally.

And the timing rule: **write the perf guard when you fix the first quadratic path, not after you finish fixing all of them.** The guard's value is not proving the fix worked — that you can verify by hand. Its value is catching the regression a later, unrelated, well-intentioned correctness fix introduces. The guard added early in this branch is the only reason cause 4 was found at all.

## Examples

### The guard for unwrap

`https://github.com/chrismessina/raycast-wrap-unwrap/blob/main/test/unwrap.test.ts#L248-262`:

```ts
test("unwrap stays linear on a long single-paragraph paste", () => {
  // Regression guard for two O(n²) traps, both of which made a legal <=1MB paste
  // hang Raycast for seconds: rescanning the accumulated paragraph with an anchored
  // regex, and slicing it per join (which forces V8 to flatten the rope).
  const lines = 20_000;
  const input = Array.from({ length: lines }, (_, i) => `word${i} filler text here`).join("\n");
  const started = process.hrtime.bigint();
  const out = unwrap(input, dflt);
  const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
  assert.equal(out.split("\n").length, 1, "should collapse to a single paragraph");
  // Generous bound: the linear implementation runs in ~15ms, the quadratic one took
  // >1000ms at this size. Anything near the ceiling means a rope-flattening slice or
  // full-accumulator regex came back.
  assert.ok(elapsedMs < 400, `unwrap took ${elapsedMs.toFixed(0)}ms — quadratic path likely reintroduced`);
});
```

Every element is doing work: `process.hrtime.bigint()` rather than `Date.now()` for resolution; 20,000 lines to separate the curves; a correctness assertion so the timer cannot be satisfied by doing nothing; the comment naming both original causes and the measured linear baseline so a future reader knows whether a 380ms result is fine or alarming; and a failure message that says what the failure *means*, not just that a number was exceeded.

### The guard for wrap

`https://github.com/chrismessina/raycast-wrap-unwrap/blob/main/test/wrap.test.ts#L280-286`:

```ts
test("wrap stays linear despite per-token block probing", () => {
  const words = Array.from({ length: 80_000 }, (_, i) => `word${i}`).join(" ");
  const started = process.hrtime.bigint();
  wrap(words, { width: 80 });
  const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
  assert.ok(elapsedMs < 2000, `wrap took ${elapsedMs.toFixed(0)}ms — per-token cost regressed`);
});
```

The name states the hazard — wrap *must* probe per token for round-trip safety, so the test's job is to confirm that probing stayed bounded. This is the test that caught cause 4.

### The adjacent guard worth copying

`https://github.com/chrismessina/raycast-wrap-unwrap/blob/main/test/wrap.test.ts#L248-254` uses the same elapsed-time technique against a different quadratic-ish failure — regex backtracking rather than accumulator growth:

```ts
test("nested-paren link pattern has no catastrophic backtracking", () => {
  const started = process.hrtime.bigint();
  wrap("[a](" + "(".repeat(50_000), { width: 80 });
  wrap("[a](" + "()".repeat(25_000) + ")", { width: 80 });
  const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
  assert.ok(elapsedMs < 1000, `adversarial paren input took ${elapsedMs.toFixed(0)}ms`);
});
```

Same instrument, adversarial input instead of merely large input. Both belong in a text-processing suite.

### A related trap the same review surfaced

`https://github.com/chrismessina/raycast-wrap-unwrap/blob/main/test/wrap.test.ts#L271-278` guards a bug that is not quadratic but shares the "the budget got bypassed" symptom:

```ts
test("the new-block guard does not fire on em/en dashes in prose", () => {
  // `recognizeDashBullets` is false for wrap(), so "—" is prose — treating it as a
  // bullet made every dash bypass the width budget (a 100k-char line at width 20).
  const input = "alpha " + "— ".repeat(2000) + "omega";
  const out = wrap(input, { width: 20 });
  const longest = Math.max(...out.split("\n").map((l) => l.length));
  assert.ok(longest <= 20, `guard bypassed the budget: longest line ${longest}`);
});
```

A safety check that fires too often degrades to "never break the line" and produces a 100,000-character output line. When you add a guard that can *reject* an operation, also test that it does not reject everything — the pathological output is the tell.

## Related

- [raycast/extensions#29727](https://github.com/raycast/extensions/pull/29727) — the PR carrying all four fixes and both committed perf guards (open, in review at time of writing).
- [raycast/extensions#27655](https://github.com/raycast/extensions/pull/27655) — the initial Store submission, which shipped with causes 1–3 live under a fully green suite. The counterexample this doc exists to prevent.
