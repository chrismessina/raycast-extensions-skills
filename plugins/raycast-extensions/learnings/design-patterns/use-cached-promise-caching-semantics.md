---
title: "useCachedPromise: four caching behaviors that every gate passes"
date: 2026-09-17
category: design-patterns
module: extension-caching
component: use-cached-promise
problem_type: design_pattern
severity: high
applies_when:
  - "Calling useCachedPromise or useCachedState anywhere in an extension"
  - "Rendering the same component for many rows, each fetching a different resource"
  - "Branching on the hook's `error` to decide what the view shows"
  - "Writing a second cache of your own alongside the hook's, so another surface can read it"
  - "Reasoning about whether a failure produced a toast, an empty view, or both"
symptoms:
  - "Opening item B briefly shows item A's content, then swaps to the correct content"
  - "A relaunch with no network shows an error screen even though data was cached"
  - "Two toasts appear for one failure, or a toast appears that no code in the extension writes"
  - "An expiry or freshness mechanism never triggers, because entries keep looking fresh"
  - "tsc --noEmit, ray lint, and ray build are all green while every one of the above is live"
root_cause: integration_issue
resolution_type: code_fix
related_components:
  - raycast-utils
  - caching
tags:
  - raycast-utils
  - use-cached-promise
  - caching
  - cache-key
  - stale-while-revalidate
  - offline
  - silent-failure
---

# useCachedPromise: four caching behaviors that every gate passes

## Context

`useCachedPromise` is stale-while-revalidate: it returns the last cached value immediately,
refetches in the background, and swaps in the new value. That description is accurate and also
incomplete in four ways, each of which produces a user-visible defect that **`tsc --noEmit`,
`ray lint`, and `ray build` all pass**.

All four surfaced in one extension (`raydocs`) during a single session. Three were caught only by
adversarial review, and one of them was introduced *by the fix for another*. None was visible in
the final code once fixed, which is why they are written down here.

Line references are to `@raycast/utils/dist/module.js` at **2.3.1**, inside whichever extension's
`node_modules/` you are reading — deliberately not an absolute path, because it resolves per
checkout rather than naming one file. It is a bundled build artifact, so the numbers move between
releases: verify a line still says what is quoted here before relying on it.

## Guidance

### 1. The cache key is the ARGS array, not the closure

```js
// module.js:844
const cacheKey = serialize(args || []) + internal_cacheKeySuffix;
// module.js:846
cacheNamespace: serialize(fn),
```

The key comes from the **second positional argument**. The namespace comes from serializing the
function — for an inline arrow, its source text, which is byte-identical for every instance.

So this shares **one cache slot across every row**:

```tsx
// WRONG — args is [] for all 107 items, and the arrow's source text is identical for all of them
useCachedPromise(() => getLinkMarkdown(link.url.markdown), [], { onError: () => {} });
```

```tsx
// RIGHT — the varying value participates in the key
useCachedPromise(getLinkMarkdown, [link.url.markdown], { onError: () => {} });
```

The wrong form typechecks, lints, builds, and *works* while you test one item. Open a second item
and it renders the first one's content until the fetch resolves — and any action reading that data
during the window operates on the wrong resource. In `raydocs` a "Copy as Markdown" action could
copy a different document than the one on screen.

**This is the one that recurs**, because the correct form looks unremarkable and a later refactor
to a closure reintroduces it with no signal.

### 2. `error` and `data` coexist — branching on `error` first throws away good data

On failure the hook sets `error` **and still returns the last cached value** (`module.js:880-890`,
which picks `cachedData` or `laggyDataRef.current`). So:

```tsx
// WRONG — discards a complete cached list to show a failure screen
if (error) return <List><List.EmptyView title="Failed to load" /></List>;
```

Launch once online, go offline, relaunch: the user gets an error screen while a full cached dataset
sits unused in `data`. Gate on the absence of data, not on the presence of an error:

```tsx
if (error && data.length === 0) return <List><List.EmptyView … /></List>;
```

Then decide the *other* surface deliberately: when cached content IS shown despite an error, the
view looks completely normal and silently lies about being current, so it needs a toast. Exactly
one surface per case — never zero, never two.

### 3. An effect keyed on `data` cannot tell a fetch from a cache restore

`onData` is invoked inside the promise-resolution path (`module.js:206`), so it fires **only when a
fetch actually resolves**. An effect keyed on `data` also fires for the value the hook restored
from cache on mount.

That distinction is invisible until you keep your own metadata about the value:

```tsx
// WRONG — writes the restored value with a new timestamp before any fetch resolves,
// so a stale entry keeps looking fresh and your expiry never fires
useEffect(() => { if (data) writeCache(url, data); }, [url, data]);

// RIGHT — only a confirmed fetch refreshes the entry and its age
useCachedPromise(fetchFn, [url], { onData: (value) => writeCache(url, value) });
```

This one is nastier than it reads: the mechanism **silently disables itself in exactly the case it
exists for**. An entry that has not successfully refreshed is the one whose age most needs to be
old, and this marks it new.

### 4. No `onError` means the hook shows its own toast

```js
// module.js:131-140 — paraphrased
if (latestOnError.current) { await latestOnError.current(err); }
else if (environment.launchType !== LaunchType.Background) {
  await showFailureToast(err, { title: "Failed to fetch latest data", primaryAction: { … } });
}
```

Supplying `onError` is what suppresses it. "I never wrote a `showToast` call" is not evidence that
no toast appears — a custom error view plus the default toast is the usual accidental result.

Pass `onError: () => {}` when your own view is the error surface, and then remember that you have
taken responsibility for **all** cases: with the toast suppressed and cached content displayed
(behavior 2), a transient failure becomes completely silent unless you raise one yourself.

## Why This Matters

The unifying property is that **no static gate can see any of these**. Each is a correct-looking
call whose defect lives in the library's runtime semantics:

- typecheck passes: every signature is satisfied
- lint passes: no rule models cache-key derivation or toast provenance
- build passes: esbuild does not typecheck, let alone reason about caching
- reading the diff passes: the wrong and right forms differ by a few characters

Behavior 1 also survives single-item manual testing, which is the testing most likely to happen.

Two of these were found only by pointing an adversarial reviewer at the library source and asking
what the hook actually does, rather than at the extension code. **When a defect depends on a
dependency's runtime behavior, read the dependency** — `node_modules/@raycast/utils/dist/module.js`
is bundled but readable, and every claim above came from it.

## When to Apply

Check all four whenever a component using `useCachedPromise` is added or changed, and specifically:

- **The moment the same component renders for many rows.** That is when behavior 1 becomes live,
  and it is the cheapest to check: does the args array contain the value that varies?
- **The moment you write a second cache alongside the hook's.** Behavior 3 applies, and so does
  key symmetry — writer and reader must derive the identical key, or the cache is permanently
  useless while every gate stays green.
- **Whenever an error branch decides what renders.** Behavior 2 plus the one-surface rule.

## Examples

### Verifying the key actually varies

The key is derived from values you control, so assert it rather than reasoning about it. Bundle the
real module and print what two different inputs produce, rather than reimplementing the derivation:

```bash
npx esbuild /tmp/probe.ts --bundle --platform=node --format=esm \
  --outfile=/tmp/probe.mjs --alias:@=./src --log-level=error && node /tmp/probe.mjs
```

`@raycast/api` ships types only and has no runtime JS, so a probe that imports it needs a stub —
a few lines exporting a fake `Cache`/`Icon`/`Color` is enough, aliased with
`--alias:@raycast/api=/path/to/stub.js`. That stub also makes cache logic (expiry boundaries,
malformed entries, clock skew) testable with plain `assert`, with no test framework added.

### The one-surface rule, written out

| state | surface |
| --- | --- |
| error, no cached data | full error view with retry and copy-error. No toast. |
| error, cached data present | render the cached data **and** raise a failure toast — the view otherwise lies |
| no error | normal render, nothing extra |

## Related

- `../workflow-issues/answer-a-blocking-review-with-a-measurement.md`
  — behavior 1 was flagged by a
  reviewer whose implied remedy would have been expensive; measuring it (all cached documents
  totalled 0.71 MB against `Cache`'s 10 MB default) is what made the cheap fix defensible.
