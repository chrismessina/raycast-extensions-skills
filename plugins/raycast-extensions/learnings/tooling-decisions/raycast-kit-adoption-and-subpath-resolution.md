---
title: "@chrismessina/raycast-kit: adoption history, the error shapes the bare ternary gets wrong, and why a subpath import needs moduleResolution Node16"
date: 2026-07-25
last_updated: 2026-10-31
category: tooling-decisions
module: shared-tooling
component: tooling
problem_type: tooling_decision
severity: medium
applies_when:
  - "Adopting `@chrismessina/raycast-kit` in a self-authored extension that is already being changed"
  - "A `@chrismessina/raycast-kit/<subpath>` import fails to typecheck with TS2307"
  - "A headlessly tested module (parser, formatter, index reader) fails outside Raycast with `Cannot find module '@raycast/api'`"
  - "Deciding whether a hand-rolled helper should move into the kit"
applies_to: ["develop", "ship"]
trigger: "when you are about to adopt @chrismessina/raycast-kit or import one of its subpaths"
tags:
  - raycast-kit
  - shared-package
  - moduleResolution
  - exports-map
  - house-style
---

# `@chrismessina/raycast-kit`: adoption history, error shapes, and the subpath resolver

The policy is the `kit` rule in [`house-style.md`](../../reference/house-style.md#kit): when it
applies, what it maps, report-only status, and the root-versus-subpath import table. What belongs
in the kit at all was decided in
[`deciding-whether-to-extract-a-shared-package`](./deciding-whether-to-extract-a-shared-package.md),
which also holds the 2026-07-25 compliance census and the rejected helpers (`formatDate`,
`truncate`). This file holds the rest of the evidence the rule used to carry inline.

## Why a dependency, not a reminder

Three rules — `copy-error`, `catch-unwrap`, and `plural-copy` — were enforced by an agent
remembering to grep, and the census measured that at roughly 20% compliance for Copy Error
(26 of 124 hand-written failure toasts carried the action). `raycast-ios-apps` was the proof:
**51 failure toasts, zero Copy-Error actions**, because it called `showFailureToast` from
`@raycast/utils` 42 times — whose default action is Report Error or Copy Logs, never Copy Error,
unless you pass one. The house-style rule and the ergonomic path pointed in opposite directions,
and the ergonomic path won. A dependency inverts that: the compliant call becomes the shortest one.

## Adoption history

- **0.1.0 published 2026-07-25**; floor `^0.2.0` from 2026-09-09, when the `bytes` subpath
  (`formatBytes`, `formatSpeed`) landed in 0.2.0. The floor has been `^0.3.0` since 2026-11-04 (the release
  Chris requested; `cosign` first adopter). In 0.3.0, Copy Error carries ⌘⇧C (`Keyboard.Shortcut.Common.Copy`),
  `onErrorToast({ title })` is an `onError` for `usePromise` / `useCachedPromise` (whose
  `failureToastOptions` cannot see the error), and the clipboard includes the error's `cause` chain, so
  raw server text can stay out of the toast. No breaking changes. Zero runtime dependencies,
  `@raycast/api` peer. Floors and the tsconfig prerequisite are tracked in `dep-gates.md`.
- **Why `bytes` moved the floor, and what it changes on screen.** It replaces a hand-rolled byte
  formatter in every extension that shows a download or file size, and those copies had already
  drifted apart. The kit defaults to base-1024 with one decimal from KB up (developer-tooling
  convention, matching the rest of the fleet); a typical local copy divided by 1,000,000 and
  emitted only `KB`/`MB`. So adopting it *changes displayed numbers* — `4492333` renders `4.3 MB`
  where the local copy said `4.5 MB` — and gains `B`/`GB`/`TB`, which is the point: the old shape
  rendered 1.5 GB as `1500.0 MB`. Do **not** pass `{ base: 1000 }` to preserve old numbers; pass it
  only when the figure sits next to something the user can also read in Finder.
- **First adoption: `get-app-icon`** (`c1de11b`), which converted 4 non-compliant failure toasts and
  deleted a duplicate `pluralize`, net −22 lines.
- `store-updates` and `fathom` were the first two extensions importing subpaths — and the two
  already on `moduleResolution: Node16`, which is not a coincidence (below).

## `getErrorMessage` is strictly better than the ternary it replaces

Validated against real fleet error shapes: an `itunes-api`-style `{status, statusText}` object, a
nested `{error:{message}}` JSON API response, and a thrown plain object were all rendering
**`"[object Object]"`** through the bare `error instanceof Error ? error.message : String(error)`
ternary. 4 of 7 real shapes produce better copy through the kit. This is why the `[lint]`
`catch-unwrap` rule treats the kit helper as satisfying it.

`showError` swallows `AbortError` by default — a user typing the next keystroke cancels the
in-flight request, and that was never a failure worth toasting. Pass `ignoreAbort: false` where you
do want it surfaced.

## The subpath resolver: TS2307 is a tsconfig problem, not a missing package

`@raycast/api` ships types only (no `main`; the host injects it at runtime), so the kit's root
export — which pulls in `showError` → `toast.js` → `@raycast/api` — is **unloadable in plain Node**.
The pure helpers have standalone subpaths: `@chrismessina/raycast-kit/errors` (`getErrorMessage`,
`isAbortError`, `redactSecrets`), `/plural` (`countOf`, `plural`), `/bytes` (`formatBytes`,
`formatSpeed`).

A scaffolded extension is `"module": "commonjs"` with no `moduleResolution`, which is node10: it
resolves packages by walking files on disk and ignores the `exports` field entirely, so every
subpath import fails to typecheck:

```
error TS2307: Cannot find module '@chrismessina/raycast-kit/bytes' or its corresponding
  type declarations.
  There are types at '…/dist/bytes.d.ts', but this result could not be resolved under
  your current 'moduleResolution' setting.
```

**The fix is `"module": "Node16"` + `"moduleResolution": "Node16"`.** Do **not** reach for
`"bundler"`: it is rejected outright unless `module` is also `es2015`-or-later — `error TS5095` —
so it is a bigger migration, not a smaller one.

Verified on `threads` 2026-09-09: switching those two keys alone made every subpath resolve with
`tsc --noEmit` exit 0, `ray build` exit 0, `ray lint` exit 0, and **zero source changes**. Migrate
the tsconfig *before* adopting a subpath, not after — the failure looks like a missing package
rather than a resolver setting, and the tempting workaround (import from the root instead)
silently re-poisons a pure module with `@raycast/api`.

## The headless-module trap

Importing the root into a production module that happens to be headlessly testable poisons it:
the module still compiles and `ray build` still succeeds — esbuild resolves `@raycast/api` fine —
so **nothing fails until you run that module outside Raycast**, and then it fails as
`Cannot find module '@raycast/api'` with a stack naming `toast.js`. The error never mentions the
kit's export map, so it reads like a broken install rather than a wrong entry point.

**Receipt, `claude-artifacts` 2026-07-25** — an early kit adoption, hours after `get-app-icon`: a
root import of `getErrorMessage` into the index-parser module broke all 11 of its headless fixtures
at once. The first fix attempted was a hand-rolled local copy plus a comment claiming the kit
"can't" be used in pure modules — wrong, and the kit's README had documented the subpath all along.
Check the entry point before concluding the kit does not fit.
