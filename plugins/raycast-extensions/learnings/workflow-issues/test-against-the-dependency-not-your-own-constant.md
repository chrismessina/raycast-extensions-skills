---
title: "A test that asserts against your own constant agrees with your own wrong unit"
date: 2026-08-16
problem_type: best_practice
category: best-practices
component: testing_framework
module: "src/utils/models.ts, src/utils/contextWindow.ts"
severity: high
related_components:
  - anthropic-sdk
  - token-budgeting
  - test-oracles
tags:
  - test-oracle
  - dependency-contracts
  - integration-assertion
  - tautological-test
  - anthropic-sdk
  - token-counting
applies_when:
  - "A local constant encodes a rule that actually belongs to a dependency (SDK, API, driver, kernel)"
  - "A unit test's expected value is imported from the same module the code under test imports it from"
  - "Deriving a bound from first principles about a dependency's internals rather than measuring it"
  - "A dependency's rule lives behind a non-exported path, so it cannot be read at runtime"
  - "About to ship a docstring that calls an estimate a guarantee"
---

# A test that asserts against your own constant agrees with your own wrong unit

> **Provenance.** Written in the local checkout of the `claude` extension and moved here on 2026-10-18,
> when that checkout was deleted. Its `src/…` citations are to that extension's code as it stood on
> [raycast/extensions#30287](https://github.com/raycast/extensions/pull/30287) (merged), so line numbers are historical.

## Context

This extension clamps `max_tokens` before a non-streaming request, because `@anthropic-ai/sdk` rejects an over-large non-streaming call **synchronously** — before a promise exists, before a byte leaves the process. The clamp value, `MAX_NONSTREAMING_TOKENS` (`src/utils/models.ts:81`), was derived correctly from the SDK's documented projection gate: `60min * max_tokens / 128000 > 10min`, which puts the ceiling at 21333.

The derivation was right. The unit tests around it were green. Both facts were worthless, because the assertion was `clamped === MAX_NONSTREAMING_TOKENS` — the code's output compared against the very constant the code used to produce it. Any value in that constant passes. It is a mirror held up to a mirror.

Rewriting the assertion to exercise the SDK's real gate found a **second** gate the constant knew nothing about, and which rejected the extension's own clamp value on two live model ids.

This is a fourth axis alongside three sibling docs from the same project. [bugs-concentrate-at-module-seams.md](../architecture-patterns/bugs-concentrate-at-module-seams.md) is about *where* a defect sits. [green-falsification-that-tested-nothing.md](green-falsification-that-tested-nothing.md) is about *whether the check ran at all*. [rendered-output-is-invisible-to-code-review.md](rendered-output-is-invisible-to-code-review.md) is about *whether the evidence exists in the artifact*.

Here all three of those are satisfied and it still proves nothing. The distinction from the falsification sibling is the sharp one: **there, the probe never landed; here, it lands, executes real code, and returns a true result — to a question nobody needed answered.** A tautology is not a false negative. It is a correct answer with no information content, which is strictly harder to spot, because there is nothing broken to find.

## Guidance

**When the correctness of a value is determined by a dependency, assert against the dependency's actual behavior — never against your own copy of its number.**

The corollary is the useful part: **a local constant that mirrors a dependency's rule is a cache with no invalidation.** A test comparing code to that constant can detect drift between the code and the cache. It can never detect drift between the cache and the truth — and the truth is the only thing the user experiences.

### Instance 1 — the tautological assertion

The unit assertion, in shape:

```ts
// Tautology: the expected value and the actual value have the same author.
expect(buildModelRequestParams(model, { streaming: false }).max_tokens)
  .toBe(MAX_NONSTREAMING_TOKENS);
```

Green. Green if the constant were 21333, green if it were 999999, green if the SDK's rule had changed three releases ago. The oracle is the code's own input.

The integration assertion instead asks the SDK, by constructing a client and catching the synchronous throw. No API key is needed and no request is made — both gates fire client-side before dispatch:

```js
const client = new Anthropic({ apiKey: "not-a-real-key" });
for (const model of ids) {
  try {
    client.messages.create({ model, max_tokens, messages: [{ role: "user", content: "hi" }] });
    // reached => the SDK accepts this pair
  } catch (e) {
    // AnthropicError: "Streaming is required for operations that may take longer than 10 minutes"
  }
}
```

Measured against `@anthropic-ai/sdk` 0.115.0 in `node_modules`:

| model id | `max_tokens=21333` | `max_tokens=8192` |
|---|---|---|
| `claude-opus-4-1-20250805` | **throws** | ok |
| `claude-opus-4-20250514` | **throws** | ok |
| `claude-sonnet-4-5-20250929` | ok | ok |
| `claude-3-5-haiku-20241022` | ok | ok |
| `claude-opus-4-5-20251101` | ok | ok |

The extension's own clamp value was rejected on two of five ids. The unit test could not see this — the model id is not an input to a tautology.

The second gate is a per-model cap in `MODEL_NONSTREAMING_TOKENS`, read at `node_modules/@anthropic-ai/sdk/resources/messages/messages.js:31-32`:

```js
const maxNonstreamingTokens = constants_1.MODEL_NONSTREAMING_TOKENS[body.model] ?? undefined;
timeout = this._client.calculateNonstreamingTimeout(body.max_tokens, maxNonstreamingTokens);
```

The map itself (`node_modules/@anthropic-ai/sdk/internal/constants.js`) holds **8192** for eight keys, all Opus 4 / 4.1 aliases across direct, Bedrock, and Vertex id spellings: `claude-opus-4-20250514`, `claude-opus-4-0`, `claude-4-opus-20250514`, `anthropic.claude-opus-4-20250514-v1:0`, `claude-opus-4@20250514`, `claude-opus-4-1-20250805`, `anthropic.claude-opus-4-1-20250805-v1:0`, `claude-opus-4-1@20250805`.

Both gates raise the **identical** message, so the error text does not distinguish them. Gate 1's boundary was also confirmed exactly: on `claude-sonnet-4-5-20250929`, `max_tokens=21333` is accepted and `21334` throws — the derivation behind the constant was correct, and correctness of the derivation is precisely what gave false comfort about its sufficiency.

**Why the fix is not "copy the map."** That path is unreachable:

```
$ node -e "require('@anthropic-ai/sdk/internal/constants')"
ERR_PACKAGE_PATH_NOT_EXPORTED
  Package subpath './internal/constants' is not defined by "exports"
```

A local copy would be a second cache with no invalidation — the same defect one layer down, and it would go stale the moment the SDK adds an id. So the shipped resolution **reacts to the rejection instead of predicting it** (`src/utils/models.ts:98-115`):

```ts
export function isNonstreamingCeilingError(error: unknown): boolean {
  return error instanceof Error && /streaming is required/i.test(error.message);
}

export function nonstreamingRetryParams<T extends { max_tokens: number }>(params: T, error: unknown): T | null {
  if (!isNonstreamingCeilingError(error)) return null;
  if (params.max_tokens <= NONSTREAMING_FALLBACK_TOKENS) return null;
  return { ...params, max_tokens: NONSTREAMING_FALLBACK_TOKENS };
}
```

`NONSTREAMING_FALLBACK_TOKENS = 8192` (`:88`) is the lowest value the map contains, so one retry clears gate 2 for every id in it. The call site (`src/hooks/useChat.tsx:239-251`) pays nothing for the retry — the throw happens before the request leaves the process, so the "retry" costs a function call and no round trip.

Note what the reaction strategy buys: **an id added to the SDK's map next release is handled with no change here.** Clamping everything to 8192 up front would also work and would need no retry, but it would cost every non-capped model 60% of its non-streaming ceiling to guard a case no model in the current live list reaches — the trade is stated at `src/utils/models.ts:74-77`.

### Instance 2 — the refuted premise, where the code was already fine

Same branch, and the interesting variant. The author was about to ship UTF-8 byte length as a **provable upper bound** on token count: every BPE token consumes at least one byte, therefore `tokens <= utf8Bytes`. The reasoning is locally airtight and the conclusion is false.

An independent reviewer refuted the **premise, not the code**: `countTokens()` counts a *structured request*, and structural and special tokens — role delimiters, BOS/EOS, system-optimization tokens — consume **zero user-content bytes**. No byte count can prove a request fits, because the request contains tokens that are not made of the user's bytes at all.

The encoding change shipped anyway, and correctly: `utf8ByteLength` (`src/utils/contextWindow.ts:50`) is strictly better than JS `String.length`, which under-counts CJK by roughly 3x. What changed was the **label**. Its docstring (`:29-49`) now states `THIS IS A HEURISTIC, NOT A BOUND` outright (`:42`), and `estimateRequestTokens` (`:133`) adds `FRAMING_TOKENS_PER_MESSAGE` (`:27`, value 8) per message as an unproven allowance rather than pretending the byte count alone suffices.

The load-bearing consequence is in the module's contract at `contextWindow.ts:209-224`, which now states the asymmetry explicitly: when `countTokens()` **succeeds**, the list was *measured* to fit — a guarantee. When it **fails**, nothing is guaranteed, and `countFailed: true` exists so a caller can tell the two situations apart. `FALLBACK_TURN_CAP` (`:15`, value 10) survives as a real backstop precisely because the estimate is not a proof.

**The fix here was to the documentation, not to the code.** That distinction is the whole reason this instance sits next to the first one.

### The difference between the two, which is the point

| | Instance 1 | Instance 2 |
|---|---|---|
| What was wrong | the **test** | the **claim** |
| What the code did | over-sent on two ids | exactly the right thing |
| Fixed by | changing what the test asserts against | changing what the docstring promises |
| Cost of not fixing | user-visible failure | false confidence downstream |

They share one root: **a belief about a dependency's behavior was held locally instead of being checked against the dependency.** In the first case the belief was encoded in a number and validated against itself. In the second it was encoded in a proof sketch about a tokenizer nobody had asked.

Both are the same question wearing different clothes: *what is the oracle?* If the answer is "something I wrote," there is no oracle.

## Why This Matters

A tautological test is worse than no test, and the mechanism is specific. No test leaves a known gap. A green tautology fills the gap with a signal — it appears in the count, it appears in CI, it appears in the sentence "the clamp is covered." It converts an unknown into a wrong known, at exactly the moment the author decides to stop looking.

It is also structurally invisible to review of the kind that catches the sibling docs' defects. There is no seam to widen scope across: the constant and its test are in the same file, both correct, mutually consistent. There is no probe that failed to land: the assertion executes real code and returns true. There is no missing pixel: everything under discussion is a number in the artifact. Every reviewer looking at that file sees a correct derivation, a correct constant, and a passing test — and the SDK, which was never consulted, rejects the value on two of five live models.

Instance 2 shows the same failure with no code defect at all, which is why it is worth carrying: the damage from an unsound claim is deferred. Nothing breaks today. It breaks when a future caller reads "bound," treats the result as a guarantee, and removes the backstop that was doing the actual work.

## When to Apply

- **A test's expected value is imported from the module under test.** Trace where the expected value came from. If the code and the test resolve it through the same import, the test asserts self-consistency and nothing else.
- **A constant's comment cites a dependency's rule.** That comment is the tell — it means the value is a cache of someone else's decision. Ask what invalidates it. Usually nothing does.
- **A bound is derived rather than measured.** A correct derivation proves the gate you modeled exists. It says nothing about a second gate you did not model — which is exactly what happened here, from a derivation that was and remains arithmetically right.
- **A dependency's rule is behind a non-exported path.** Do not copy it. Copying converts an unreadable truth into a readable lie with a shelf life. React to the dependency's own rejection instead, and make the reaction message-matched and fail-safe: `isNonstreamingCeilingError` returns false on any wording change, so the error surfaces to the user rather than triggering a blind retry.
- **A helper's docstring is about to use the words "guaranteed," "bound," "always," or "at most."** Name what would have to be true, then check whether the dependency actually promises it. Structural tokens, framing overhead, and server-side normalization are the usual things a first-principles argument omits.
- **The dependency's validation is synchronous.** Then the integration assertion is cheap — no key, no network, no fixture. There is no excuse for the tautology when the real oracle costs one `try`/`catch`.

## Examples

- `src/utils/models.ts:60-81` — `MAX_NONSTREAMING_TOKENS = 21333`, with the docstring naming **both** gates and stating why gate 2 is reacted to rather than predicted.
- `src/utils/models.ts:88` — `NONSTREAMING_FALLBACK_TOKENS = 8192`, chosen as the lowest value in the SDK's map so one retry clears every id in it.
- `src/utils/models.ts:98-115` — `isNonstreamingCeilingError` and `nonstreamingRetryParams`, the shipped resolution.
- `src/hooks/useChat.tsx:232-251` — the call site, wrapping `messages.create()` in an async function so the synchronous throw becomes a rejection a `.catch()` can see, then retrying once at the fallback.
- `src/utils/contextWindow.ts:29-49` — `utf8ByteLength` and its docstring, which states `THIS IS A HEURISTIC, NOT A BOUND` at `:42`; and `:133-141` — `estimateRequestTokens` with its framing allowance.
- `src/utils/contextWindow.ts:209-224` — the "WHAT IS AND IS NOT GUARANTEED" contract that Instance 2's refutation produced.
- `node_modules/@anthropic-ai/sdk/internal/constants.js` — `MODEL_NONSTREAMING_TOKENS`, eight Opus 4 / 4.1 keys at 8192, unreachable through the package export map. Consumed at `node_modules/@anthropic-ai/sdk/resources/messages/messages.js:31-32`. SDK 0.115.0.

## Related

- [green-falsification-that-tested-nothing.md](green-falsification-that-tested-nothing.md) — the nearest sibling and the necessary contrast. Its remedy is *confirm the probe landed*; that remedy is fully satisfied here and does not help. There a green result meant the check never ran; here a green result means the check ran perfectly against the wrong oracle. Its Instance 1 (a regex matching code that had been refactored) and this doc's Instance 1 are the two halves of one question: did the check touch the code, and did it compare against anything external.
- [rendered-output-is-invisible-to-code-review.md](rendered-output-is-invisible-to-code-review.md) — its rule "never write a test that appears to cover it" is the same instinct applied to a property no process can observe. This doc's case is the observable one: an external oracle *does* exist, is cheap to consult, and was simply not consulted.
- [bugs-concentrate-at-module-seams.md](../architecture-patterns/bugs-concentrate-at-module-seams.md) — seam defects are recoverable by widening review scope. This class is not: the constant, its test, and the derivation all live in one file and agree with each other. The missing party is outside the repo.
- [raycast/extensions#30287](https://github.com/raycast/extensions/pull/30287) — the PR carrying both fixes; open, out of draft, unmerged at the time of writing. Its head ref on the fork is `ext/claude-api-compat`, which is the local branch `fix/api-compatibility` under a different name — the PR number is the reference that survives either.
- [raycast/extensions#29798](https://github.com/raycast/extensions/pull/29798) — the sibling storage-refactor PR the three related docs came from; parked in draft.
