---
title: Guard accumulator loops with an elapsed-time assertion
date: 2026-07-25
last_updated: 2026-10-31
category: design-patterns
module: text-processing
component: wrap-unwrap
problem_type: design_pattern
severity: high
applies_to: ["develop", "review-pr"]
trigger: "when you are about to build a string or array across lines, tokens, or records inside a loop"
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

> **Source extension:** file citations are URLs into
> [`chrismessina/raycast-wrap-unwrap`](https://github.com/chrismessina/raycast-wrap-unwrap),
> where the four fixes and the committed perf guards live. The guidance is extension-agnostic.

## When this applies

Write a perf guard when the code under change has **all three** of these properties. Append-only
loops and inputs bounded at a few hundred characters are out of scope; do not add timing tests
to them.

1. **It accumulates.** A string built with `+=` across a loop, an array pushed to and later
   queried, a `Map` grown per item — anything where iteration N sees the results of iterations
   1..N-1.
2. **It touches the accumulation inside the loop.** `.slice()`, `.join()`, `regex.test()`,
   `.indexOf()`, `.charCodeAt()`, a `.find()` over prior results, spreading it into a new array. If
   the only operation is append, you are fine.
3. **The input size is attacker- or user-controlled up to a documented ceiling.** A 1MB paste
   limit is a *promise* that 1MB works. If your ceiling is 200 characters this does not apply.

Red flags in review — each means "measure before merging":

- `$`-anchored regex tested against a growing string. The anchor does not prevent the scan.
- `.slice()` on an accumulator, even `.slice(-2)`. It flattens the rope.
- `.slice(i)` / `.join()` over "the rest of" a collection inside a loop over that collection.
- `[...arr]`, `arr.map()`, `arr.reverse()`, or `arr.find()` where `arr` is the output array being built.
- Any answer to "what happened earlier?" computed by scanning instead of maintained incrementally.
- A lookahead bounded by a parameter the *caller* supplies (a width, a budget) rather than a
  constant you chose — see cause 4.

Write the guard **when you fix the first quadratic path**, not after fixing all of them. Its
value is not proving the fix worked (verify that by hand); it is catching the regression a later,
unrelated correctness fix introduces. The guard added early on this branch is the only reason
cause 4 was found.

## The guard

One committed test per accumulating function, in the suite, failing on CI. Every element below
is doing work:

```ts
// https://github.com/chrismessina/raycast-wrap-unwrap/blob/main/test/unwrap.test.ts#L248-262
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

1. **The bound is generous, not tight.** `< 400ms` against a linear implementation that runs in
   about 15ms: 25× headroom. A tight bound (say 50ms) flakes on a loaded laptop, gets marked
   skip, and stops protecting anything. The quadratic version took over 1000ms at this size. The
   gap between "slow machine" and "wrong complexity" is orders of magnitude; calibrate to the
   gap, not the target.
2. **The input is big enough to separate the curves.** 20,000 lines for unwrap; 80,000 tokens for
   wrap (`test/wrap.test.ts#L280-286`, the test that caught cause 4). At 100 lines both
   implementations look identical.
3. **Correctness is asserted in the same test.** `out.split("\n").length === 1` — otherwise a
   future "optimization" that skips the joining entirely passes the timer.
4. **The guard exercises the bound it protects.** A guard pinned to the default width never
   exercised cause 4's width-dependent path. Run it at a value that reaches the bound.
5. `process.hrtime.bigint()` for resolution; a comment naming the causes and the measured linear
   baseline so a 380ms result can be read as fine or alarming; a failure message that says what
   the failure *means*.

Why only a clock catches this: `npm test` (147 tests), `npx tsc --noEmit` and `npx ray lint` were
all green with every quadratic path live. Type checking and linting cannot see complexity, and
correctness fixtures are small enough that O(n²) and O(n) are indistinguishable.

## Context

The Wrap/Unwrap extension reflows Markdown text: `unwrap` collapses hard-wrapped lines into
paragraphs, `wrap` re-breaks them at a width budget. Both walk lines and build a growing string
(unwrap's `Group.joined`) or a growing array of prior decisions (classify's `out`). The extension
promises a hard input ceiling of one million characters
(`MAX_INPUT = 1_000_000`, [`src/lib/pipeline.ts#L4`](https://github.com/chrismessina/raycast-wrap-unwrap/blob/main/src/lib/pipeline.ts#L4);
larger input is rejected with an `OversizeError`). Everything at or under that ceiling is a paste
the extension has promised to handle.

Four independent O(n²) paths were found across an adversarial-review campaign
([raycast/extensions#29727](https://github.com/raycast/extensions/pull/29727)). None was a nested
loop; each was one innocuous method call inside an accumulating loop.

| Input | Before | After |
| --- | --- | --- |
| 188KB indented code | 10,299ms | 14ms |
| 833KB single paragraph | 18,031ms | 22ms |
| 1MB prose | 32,056ms | 39ms |

Two facts set up everything else. **Three of the four shipped to the Store** under a fully green
suite ([PR #27655](https://github.com/raycast/extensions/pull/27655), the initial submission).
**Nobody filed an issue** across two releases: a 32-second freeze reads to a user as "Raycast
hung," not "this extension is slow," so the field does not report it. The suite is the only
detector you get.

## The four causes

All four reduce to one shape: a method whose cost is proportional to the *accumulated* size,
invoked once per *iteration*.

**Cause 1 — rescanning prior state** ([`src/lib/classify.ts`](https://github.com/chrismessina/raycast-wrap-unwrap/blob/main/src/lib/classify.ts)).
Deciding whether an indented line sits inside a list required knowing whether a list item had
appeared since the last blank. The original asked by rescanning every record so far:
`[...out].map((c, i) => ({ c, i })).reverse().find(({ c }) => c.role === "blank")?.i ?? -1` —
three full passes over all prior output, per line. 188KB of indented code: 10,299ms. The fix
maintains a `Set` of list depths since the last blank inside a `push()` helper that every
classification site funnels through ([`#L314-354`](https://github.com/chrismessina/raycast-wrap-unwrap/blob/main/src/lib/classify.ts#L314-354));
the consumer is `listDepthsSinceBlank.has(prefixes.length)` ([`#L441`](https://github.com/chrismessina/raycast-wrap-unwrap/blob/main/src/lib/classify.ts#L441)).
Routing *all* mutations through one helper is what makes incremental state safe; scattered
`out.push()` calls would each have to remember the `Set`.

**Cause 2 — an anchored regex against the whole accumulator.** Unwrap's hyphen-rejoin rule tested
whether the accumulated paragraph ends in letter-plus-hyphen with
`HYPHEN_BREAK_END = /[\p{L}\p{Nd}][-­]$/u` ([`src/lib/regex.ts#L100`](https://github.com/chrismessina/raycast-wrap-unwrap/blob/main/src/lib/regex.ts#L100)).
The `$` anchor makes this *look* constant-time. It is not: the engine still scans forward from
every start position; the anchor rejects matches, it does not skip the scan. Per join on the
growing paragraph, an 833KB paste took 18,031ms. The fix tests a short tail only.

**Cause 3 — `.slice()` on the accumulator forces a rope flatten.** V8 represents `a + b` as a
lazy rope (cons-string), which is why plain concatenation in a loop is fast. Any operation that
needs the flat characters — `.slice()`, a regex, `.charCodeAt()` — collapses the rope, and that
flattening is O(accumulated length). Once per iteration, two operations that each look free
rebuild quadratic behavior. Isolated measurement, 32k-iteration concat loop:

| Loop body | Time |
| --- | --- |
| `regex.test(s.slice(-2))` + concat | 1308ms |
| `s.slice(-2)` + concat (no regex) | 11ms |
| plain concat | 2ms |

(A second machine gave 609ms / 7ms / 1ms; the two-orders-of-magnitude ratio does not move.) The
middle row is the lesson: the slice alone amortized because V8 caches the flattened result and
the loop appends to the same string; add the regex and the cost explodes. That interaction
cannot be reasoned out from the source — measure it.

The fix threads a short tail through the group object so the accumulator is never touched:
`takeTail` ([`src/lib/unwrap.ts#L34-39`](https://github.com/chrismessina/raycast-wrap-unwrap/blob/main/src/lib/unwrap.ts#L34-39))
grabs 3 UTF-16 code units and drops a leading low surrogate, and `joinWithHyphenation` derives
the new tail from the short strings rather than from `joined`
([`#L119-155`](https://github.com/chrismessina/raycast-wrap-unwrap/blob/main/src/lib/unwrap.ts#L119-155)).
**Bounding a window is a correctness change, not only a performance change:** a first attempt
used a flat 2-code-unit tail, which sliced astral characters in half so `\p{L}` stopped matching
and the Unicode join silently broke. The boundary has its own test
([`test/unwrap.test.ts#L264`](https://github.com/chrismessina/raycast-wrap-unwrap/blob/main/test/unwrap.test.ts#L264)).
The same principle covers per-line state generally: `advanceInlineState`
([`#L58-109`](https://github.com/chrismessina/raycast-wrap-unwrap/blob/main/src/lib/unwrap.ts#L58-109))
carries "inside an open code span or link destination" forward per line, because rescanning the
paragraph for it was the other half of the 18-second paste.

**Cause 4 — self-inflicted by a correctness fix, in a session dedicated to removing this bug
class.** Round 7 of review found `wrap`'s block-safety check wrong in both directions (testing
the *next token* alone missed constructs assembled from several tokens — `_` is prose, `___` is
held back, but `_ ___` is a horizontal rule — and it overran the width). The correct fix judges
the resulting *line*. Its first cut built the candidate line as `tokens.slice(i).join(" ")` per
rejected break: 1MB of prose went to 32,056ms. That code never reached a commit; the committed
perf guard caught it.

The shipped version gathers only the tokens that could land on the candidate line, bounded by
**both** a token count and the width budget ([`src/lib/wrap.ts`](https://github.com/chrismessina/raycast-wrap-unwrap/blob/main/src/lib/wrap.ts)):

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

**The first cut of this bound was itself insufficient, and that is the most transferable part.**
It stopped at `contBudget` alone — bounded, but by a value the *user* controls: the wrap-column
preference has no upper limit and a cross-extension launch context supplies it directly. With a
large width and a run of rejected tokens, each rejected break re-scanned up to `width`
characters: 20,000 unsafe tokens at width 20000 took 4048ms, 40,000 took 9564ms. An external
review caught it; the width-80 perf guard never exercised that shape. Capping by token count
fixes it because the question is small — whether a line *starts* a block is decided by its
opening token or two, so eight tokens is always enough. Same input after the cap: 22ms and 49ms,
flat in width and linear in run length.

Stated properly: **when you need lookahead, bound it by a constant you choose, not by a
parameter your caller chooses.** "Bounded by the budget" reads like a fix and is not one when the
budget is user-supplied. Cause 4 matters more than causes 1–3 combined because it was introduced
by someone who had spent the whole session removing this bug class, in the file they had just
fixed. Vigilance did not prevent it; the committed clock did.

## Related

- The committed guards and their neighbors, as source rather than copies:
  [`test/unwrap.test.ts#L248-262`](https://github.com/chrismessina/raycast-wrap-unwrap/blob/main/test/unwrap.test.ts#L248-262)
  (unwrap stays linear) ·
  [`test/wrap.test.ts#L280-286`](https://github.com/chrismessina/raycast-wrap-unwrap/blob/main/test/wrap.test.ts#L280-286)
  (wrap stays linear despite per-token block probing — the test that caught cause 4) ·
  [`test/wrap.test.ts#L248-254`](https://github.com/chrismessina/raycast-wrap-unwrap/blob/main/test/wrap.test.ts#L248-254)
  (the same elapsed-time instrument against regex backtracking on adversarial input) ·
  [`test/wrap.test.ts#L271-278`](https://github.com/chrismessina/raycast-wrap-unwrap/blob/main/test/wrap.test.ts#L271-278)
  (a guard that can *reject* an operation must also be shown not to reject everything — a
  bullet check that fired on em dashes produced a 100,000-character output line) ·
  [`test/unwrap.test.ts#L264`](https://github.com/chrismessina/raycast-wrap-unwrap/blob/main/test/unwrap.test.ts#L264)
  (the surrogate-pair boundary of the bounded tail).
- [raycast/extensions#29727](https://github.com/raycast/extensions/pull/29727) — the PR carrying
  all four fixes and both committed perf guards.
- [raycast/extensions#27655](https://github.com/raycast/extensions/pull/27655) — the initial Store
  submission, which shipped with causes 1–3 live under a fully green suite. The counterexample
  this doc exists to prevent.
