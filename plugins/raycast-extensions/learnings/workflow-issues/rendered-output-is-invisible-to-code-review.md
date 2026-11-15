---
title: "Rendered-output defects are invisible to code review in principle, not by carelessness"
date: 2026-07-30
applies_to: ["develop"]
trigger: "when you are about to fix something whose correctness is on screen: a toast, an icon, a color"
problem_type: developer_experience
category: developer-experience
component: development_workflow
module: "src/utils/toast.ts, src/actions/index.tsx"
severity: high
related_components:
  - raycast-api
  - toast-notifications
  - icon-selection
  - code-review
tags:
  - rendered-output
  - review-limits
  - verification-discipline
  - raycast-toast
  - icon-semantics
  - human-in-the-loop
applies_when:
  - "A fix's correctness is a property of what appears on screen rather than of program state"
  - "Choosing an icon, color, or animation whose identifier implies a visual relationship"
  - "Mutating an already-presented UI object rather than replacing it"
  - "Handing a human a hands-on verification list after a review has passed"
  - "Tempted to write a test asserting a visual property the test process cannot observe"
  - "A build passes tsc, lint, and the bundler, and the defect is still on screen"
---

# Rendered-output defects are invisible to code review in principle, not by carelessness

> **Provenance.** Written in the local checkout of the `claude` extension and moved here on 2026-10-18,
> when that checkout was deleted. Its `src/…` citations are to that extension's code as it stood on
> [raycast/extensions#29798](https://github.com/raycast/extensions/pull/29798) (closed without merging), so line numbers are historical.

## Context

Two defects on the storage/API-compat branch of this extension ([raycast/extensions#29798](https://github.com/raycast/extensions/pull/29798), open and unmerged at the time of writing) were found by the author looking at his screen — after same-family code reviews and an independent whole-branch review had passed the code.

Neither was missed through inattention. In both cases the evidence needed to spot the defect **was not present in the artifact under review.** The source read correctly; the pixels did not match the source.

This is the **unobserved pixels** case in the four-way selector at [`self-review-does-not-catch-diagnostic-errors` → Which evidence is missing?](self-review-does-not-catch-diagnostic-errors.md#which-evidence-is-missing): the evidence for correctness does not exist in the reviewed artifact at all. A test could run perfectly, land exactly where intended, and still tell you nothing, because the property under test is not a property of the code.

## Guidance

### Instance 1 — the toast that never stopped spinning

Raycast's `showToast()` returns a mutable `Toast`. The idiomatic pattern — the one `@raycast/api`'s own documentation shows — is to mutate it in place:

```ts
const toast = await showToast({ style: Toast.Style.Animated, title: "Saving…" });
await save();
toast.style = Toast.Style.Success;   // updates the title text
toast.title = "Preset saved!";        // …but the spinner keeps spinning
```

The title text updates. The animated spinner icon does not swap. The user sees "Preset saved!" beside a spinner that runs forever — a toast whose text and icon assert contradictory states.

Reading that code shows a toast correctly reaching a success state. Every element of the success path is present and ordered correctly. The contradiction exists only in rendered output.

> **Historical workaround — do not copy.** The branch fixed this with a hide-and-reshow helper, `resolveToast(toast, next)` (`src/utils/toast.ts:19`: `await toast.hide()` then `await showToast(next)`), applied unconditionally "regardless of root cause" (`:3-18`), plus `showResolvedToast(options)` (`:30`), which shows only the resolved state. The general diagnosis that motivated the first helper — *mutating a presented toast never swaps the icon* — was later shown false, and hide-and-reshow is unsafe as a blanket pattern: a toast has no identity, so `hide()` on a retained handle acts on whatever toast is on screen *now*, including a newer run's. The current rules are `animated-means-work` and `toast-no-id` in [`house-style.md`](../../reference/house-style.md): no `Animated` phase for an instant write (which was the real defect at 15 of the 17 sites here — the second helper's "no spinner" judgment is the part that survived), and for genuinely async work either terminal pattern is fine in a simple sequential flow, with ownership handled per `toast-no-id` once the handle crosses an await that can be superseded.

What this incident still establishes, independent of the workaround: the contradiction between the text and the spinner existed only in rendered output, and no reading of the source could have found it.

**Measured at the current tree.** The figure of "17 sites across 9 files" carried in session recollection — and repeated in the helper's own docstring at `src/utils/toast.ts:9` — describes the *original bug's* footprint before the migration, not the current helper's call sites:

| Helper | Call sites | Files |
|---|---|---|
| `resolveToast` | 16 | 5 |
| `showResolvedToast` | 6 | 3 |
| **Total** | **22** | **8 distinct** |

Counted with `rg -n "(resolveToast|showResolvedToast)\(" src/ --glob '!src/utils/toast.ts'`, excluding definitions and bare imports. Files: `src/model.tsx`, `src/recents.tsx`, `src/ask.tsx`, `src/hooks/useChat.tsx`, `src/hooks/useModel.tsx`, `src/hooks/useRecents.tsx`, `src/views/model/form.tsx`, `src/views/model/import.tsx`.

The migration is complete: `rg -n "\.style\s*=\s*Toast\.Style" src/` returns **zero matches**. No presented toast in the tree is still mutated in place.

### Instance 2 — an icon pair that rendered as two unrelated shapes

`Icon.PinDisabled` reads, by identifier, like the disabled form of `Icon.Pin`. A Pin/Unpin toggle built from that pair looks symmetric in source and renders as two visually unrelated shapes.

**The enum values actively reinforce the wrong conclusion.** Against `@raycast/api` 1.104.23 (`node_modules/@raycast/api/types/index.d.ts`):

```ts
Geopin      = "geopin-16",       // :5056
Pin         = "pin-16",          // :5243
PinDisabled = "pin-disabled-16", // :5244
```

`Pin` and `PinDisabled` are adjacent in the enum and share the `pin-` string prefix. There is no `GeopinDisabled` member at all. So the identifiers, the string values, and the declaration order **all three** point at "`PinDisabled` is the disabled form of `Pin`" — and the rendered glyphs disagree. This is a stronger trap than identifier symmetry alone: every signal available to a static reader is consistent, mutually corroborating, and wrong.

The resolution is documented in the tree at `src/actions/index.tsx:15-26`. Per that comment: `Icon.Pin` renders as a lollipop, and `Icon.PinDisabled` is a struck-through map marker — the disabled form of `Icon.Geopin`. Both claims are about rendered glyphs and are **not verifiable from the package**; they are attributed to the author's on-screen observation, and this doc does not upgrade them to fact.

The adopted pair is `Icon.Tack` / `Icon.TackDisabled` (`index.d.ts:5321-5322`), used at `src/actions/index.tsx:30` and `:59` — chosen because it is the pushpin pair Raycast's own Clipboard History uses for "Pin Entry", so the convention is one a user already knows from the app.

Note the two instances are independent: `src/actions/` does not import the toast helper. The pin *toasts* in `src/ask.tsx:266` and `:271` use `showResolvedToast`; the pin *icons* live in `src/actions/index.tsx`. Same class of defect, no shared code.

### A third instance, from a different repo

The class is not specific to this extension or to toasts. A `raycast-claude-artifacts` session on 2026-07-25 hit the same shape by a different mechanism (session history): a bundled SVG icon using `fill="currentColor"` rendered dark-grey-on-dark in dark mode — effectively invisible. It passed `tsc`, `lint`, and the bundler. It was caught by a screenshot, and fixed by passing `{ source, tintColor: Color.PrimaryText }` explicitly rather than relying on the SVG to inherit a theme-aware color.

That incident was compounded into a house-style rule requiring an explicit `tintColor` on bundled SVG assets. Three instances, three mechanisms — a mutated toast, a mis-paired icon enum, an untinted SVG — and one constant: **a fully green build tells you nothing about any of them.**

### The procedure

Reviewing harder does not fix this. The remedy is procedural:

1. **Name the limit explicitly.** When a fix concerns rendered output, say plainly in the report that only a human at the screen can confirm it. Do not let it sit in a list of items that read as verified.
2. **Put it first in the hands-on list.** It is the only item that cannot be discharged any other way, so it should not be buried under items the reader could in principle check themselves.
3. **Never write a test that appears to cover it.** A green assertion on a rendered-output property manufactures confidence at the moment you have decided to stop looking. An assertion that `toast.style === Toast.Style.Success` would have passed on the exact code that shipped the forever-spinner — because the bug is that the icon does not follow `style`. The assertion would have been true and useless.

When a property is not in the artifact, verifying that the check landed cannot rescue it. The only correct move is to not write the check, and to say so.

## Why This Matters

Code review — human or AI — reasons over an artifact. When correctness is a property of *rendered output*, the artifact does not contain the evidence. The reviewer is not being careless; they are being asked to answer a question the input cannot settle.

That is why the toast defect survived so much review, and why the review count is the wrong lesson to draw. Adding another reviewer of the same kind adds nothing when the missing evidence is missing for all of them identically. Widening scope does not help here. Only changing the observer does.

The failure mode this creates is precise: a review passes, a suite is green, and the reported state is "verified" — while a user opens the extension and sees a spinner contradicting the word next to it. The UI lies about its state, and every automated signal says it does not.

## When to Apply

- **When a fix's success criterion is a glyph, animation, color, or layout** rather than a value. If you cannot state the assertion as a property of program state, no test will cover it.
- **When picking an icon whose identifier implies a pair.** Identifier symmetry, string-value prefixes, and enum adjacency are all cheap coincidences of naming. Confirm the rendered glyphs, or use a pair a first-party surface already uses.
- **When setting a toast's terminal state.** Follow `animated-means-work` (no spinner for an instant write) and `toast-no-id` (ownership before `hide()` or mutation on a handle held across an await) in `house-style.md`; the hide-and-reshow helper above is history, not a recipe.
- **When an asset's appearance depends on theme or host rendering** — a bundled SVG, a tint, a color that resolves at runtime. The build cannot see the result.
- **When writing the hands-on verification list** after any branch touching UI. Separate "I verified this" from "only you can verify this," and lead with the second.
- **When tempted to add a test to close the loop on a visual fix.** That is the moment to write nothing and say so instead.

## Examples

- `src/utils/toast.ts:19` — `resolveToast`, the hide-and-reshow helper (historical, see above); `:30` — `showResolvedToast`, the no-Animated-phase variant. The docstring at `:3-18` records the symptom and that root cause was never established.
- `src/hooks/useModel.tsx:270-277` — the "Preset saved!" site the user caught spinning; now has no Animated phase at all.
- `src/actions/index.tsx:15-26` — the icon-choice comment: why `Icon.Tack` / `Icon.TackDisabled` was adopted (`:15-17`, `:24-26`) and why `Icon.Pin` / `Icon.PinDisabled` / `Icon.Geopin` were rejected (`:19-22`); `:30` and `:59` — the adopted pair in use.
- `src/ask.tsx:266`, `:271` — pin toasts via `showResolvedToast`, including a Failure branch whose comment names the principle directly: reporting success when the row is gone "would be the UI lying about its state."
- `node_modules/@raycast/api/types/index.d.ts:5056`, `:5243-5244`, `:5321-5322` — the `Geopin` / `Pin` / `PinDisabled` / `Tack` / `TackDisabled` enum members, at version 1.104.23.

The canonical symptom report, verbatim from the user, sent with a screenshot and no prose diagnosis:

> re: #7, the Preset Saved! toast spins forever and never completes.

## Related

- [`self-review-does-not-catch-diagnostic-errors` → Which evidence is missing?](self-review-does-not-catch-diagnostic-errors.md#which-evidence-is-missing) — the selector that places this case (unobserved pixels) beside its three siblings and says which remedy each needs.
- [`house-style.md`](../../reference/house-style.md) — `animated-means-work` and `toast-no-id`, the current toast rules, including the correction of this incident's first diagnosis.
- [raycast/extensions#29798](https://github.com/raycast/extensions/pull/29798) — the branch carrying both fixes; open and unmerged at the time of writing.
