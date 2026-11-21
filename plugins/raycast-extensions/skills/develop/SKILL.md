---
name: develop
description: Change the CODE of an EXISTING Raycast extension — feature work, refactors, deliberate major dependency migrations (Node bump, ESLint major, flat-config, @raycast/api breaking changes), and bringing a forked or legacy extension up to Chris's House Style (the "house-style audit fix"). Fires on "build/add/change/refactor [feature]", "migrate to ESLint 10 / Node 22 / flat config", or "bring this fork up to my house style / fix the toasts & shortcuts to match my conventions." Does NOT scaffold net-new (that's `scaffold`) and does NOT submit to the Store (that's `ship`). Absorbs the former `raycast-extension-modernizer`.
metadata:
  stage: "2b + 4 — modernization + feature/refactor + house-style audit fix"
---

# develop

Owns every **code-changing** operation on an extension that already exists. Three intents, told apart by the trigger phrase:

| Intent | Trigger shape | What it does |
|---|---|---|
| **Feature / refactor** | "add / change / refactor X" | Normal command/view/logic work. |
| **Modernization** | "migrate to ESLint 10 / the new Node / flat config" | Deliberate **major-version** migration, gated. |
| **House-style audit fix** | "bring this up to my house style", "fix the toasts/shortcuts" | Sweep existing code and retrofit it to House Style. |

All three change code, so they all live here and hand forward to `ship` when done.

Every mechanical check in this skill runs through the plugin's `rx` runner:

```bash
node "<plugin>/scripts/rx.mjs" preflight --root .   # one example; any command: <command> [subcommand] [--flags]. <plugin> = two levels above this skill's base directory
```

A command prints `VERDICT  check-id  message` lines and exits 0 (PASS/WARN/N/A only), 1 (a FAIL) or 2 (an ERROR). Branch on the exit code and quote the FAIL/ERROR lines; never re-implement a check in prose or shell. Contracts: [`../../reference/rx.md`](../../reference/rx.md).

## Seam rules (do not cross)

- **vs `scaffold`** — binary on existence. The extension already exists; you're changing it. If it doesn't exist yet, stop — that's `scaffold`.
- **vs `ship`** — `ship` never changes code behavior. Non-breaking dep hygiene, metadata weeding, compliance and submission belong to `ship`.
- **Two-way handoff from `ship`** — when `ship`'s house-style audit fails, or Store review feedback needs **code** (not just metadata/screenshots), `ship` hands *back* here with the feedback context. Make the change, then hand forward to `ship` again. Don't submit from `develop`. (`raycast-pr-loop` fixes a valid code finding in place under these same rules; it does not bounce every change through here.)
- **Hard rail: never sync or clone the full monorepo.** Before any monorepo read or write, consult [`../../reference/sparse-checkout-discipline.md`](../../reference/sparse-checkout-discipline.md). `rx stale` does the sparse fetch for you.

## Documented learnings — read before writing the code, not after the review

`learnings/` in this plugin holds write-ups of defects and decisions from previous runs of these skills, each with the trigger that makes it relevant. **Read the row that matches what you are about to do — before doing it.** A learning is only useful at the moment it applies; rediscovering one after the review costs a round.

<!-- learnings:start -->
| When you are about to… | Read |
|---|---|
| add or edit a verboseLogging, strictRedaction, or any preference description or label | [`logger-preference-copy-and-length-measurements`](../../learnings/tooling-decisions/logger-preference-copy-and-length-measurements.md) |
| add Swift (or any native helper) to a Raycast extension | [`raycast-swift-helper-built-from-source`](../../learnings/architecture-patterns/raycast-swift-helper-built-from-source.md) |
| add, change, or review an AI tool (`src/tools/`) or its `ai.yaml` evals, or offer a green `ray evals` run as evidence it works | [`mocked-ai-evals-prove-only-their-assertions`](../../learnings/workflow-issues/mocked-ai-evals-prove-only-their-assertions.md) |
| adopt @chrismessina/raycast-kit or import one of its subpaths | [`raycast-kit-adoption-and-subpath-resolution`](../../learnings/tooling-decisions/raycast-kit-adoption-and-subpath-resolution.md) |
| assert against a constant from the code under test, or one that mirrors a dependency's rule | [`test-against-the-dependency-not-your-own-constant`](../../learnings/workflow-issues/test-against-the-dependency-not-your-own-constant.md) |
| break code on purpose to prove a test catches it, or trust a zero-match grep or empty fetch | [`green-falsification-that-tested-nothing`](../../learnings/workflow-issues/green-falsification-that-tested-nothing.md) |
| build a string or array across lines, tokens, or records inside a loop | [`quadratic-accumulator-paths-in-text-reflow`](../../learnings/design-patterns/quadratic-accumulator-paths-in-text-reflow.md) |
| bump, floor, or migrate @raycast/api and want to know why the policy says what it says | [`raycast-api-policy-history`](../../learnings/tooling-decisions/raycast-api-policy-history.md) |
| call `useCachedPromise` / `useCachedState`, or branch on its `error` | [`use-cached-promise-caching-semantics`](../../learnings/design-patterns/use-cached-promise-caching-semantics.md) |
| change a numeric constant on a directional argument, choose between two explanations, or ask which evidence a green check is missing | [`self-review-does-not-catch-diagnostic-errors`](../../learnings/workflow-issues/self-review-does-not-catch-diagnostic-errors.md) |
| change the messages, state file or safety rules of a long-running helper an extension spawns | [`long-running-helper-outlives-extension-updates`](../../learnings/architecture-patterns/long-running-helper-outlives-extension-updates.md) |
| cite a Keyboard.Shortcut.Common binding from the docs, the linter or the runtime | [`keyboard-shortcut-sources-divergence-history`](../../learnings/tooling-decisions/keyboard-shortcut-sources-divergence-history.md) |
| clear stale-upstream on a fork's package-lock.json or resolve a pull-contributions conflict that touches only the lockfile | [`fork-lockfile-lags-upstream-stale-upstream`](../../learnings/workflow-issues/fork-lockfile-lags-upstream-stale-upstream.md) |
| drive a third-party Mac app through AppleScript or JXA | [`raycast-applescript-jxa-integration`](../../learnings/architecture-patterns/raycast-applescript-jxa-integration.md) |
| fix something whose correctness is on screen: a toast, an icon, a color | [`rendered-output-is-invisible-to-code-review`](../../learnings/workflow-issues/rendered-output-is-invisible-to-code-review.md) |
| fix two modules that share a data contract, or review a multi-commit branch task by task | [`bugs-concentrate-at-module-seams`](../../learnings/architecture-patterns/bugs-concentrate-at-module-seams.md) |
| introduce a helper that encodes a rule an audit already greps for | [`audit-coupled-to-the-hand-written-form-of-a-rule`](../../learnings/workflow-issues/audit-coupled-to-the-hand-written-form-of-a-rule.md) |
| launch `npm run dev`, stop a watcher, or report a change as exercised in Raycast | [`raycast-dev-loop-incidents`](../../learnings/workflow-issues/raycast-dev-loop-incidents.md) |
| list or filter by the user's installed extensions, or walk up from `environment.supportPath` / `assetsPath` | [`read-installed-raycast-extensions-from-config-not-application-support`](../../learnings/design-patterns/read-installed-raycast-extensions-from-config-not-application-support.md) |
| move a helper into a shared package, or add one to the kit | [`deciding-whether-to-extract-a-shared-package`](../../learnings/tooling-decisions/deciding-whether-to-extract-a-shared-package.md) |
| pass anything from an AI tool's `confirmation` to the tool itself | [`ai-tool-confirmation-runs-in-its-own-process`](../../learnings/design-patterns/ai-tool-confirmation-runs-in-its-own-process.md) |
| read Instagram media, or any signed-in page, through `BrowserExtension.getContent`, or rely on a third-party downloader API | [`reading-instagram-media-from-the-browser-tab-in-2026`](../../learnings/tooling-decisions/reading-instagram-media-from-the-browser-tab-in-2026.md) |
| read Reddit without a logged-in session | [`reading-reddit-programmatically-in-2026`](../../learnings/tooling-decisions/reading-reddit-programmatically-in-2026.md) |
| render both `markdown` and `metadata` in a `List.Item.Detail`, or add a view toggle beside Show/Hide Sidebar | [`list-detail-description-toggle`](../../learnings/design-patterns/list-detail-description-toggle.md) |
| run npm or ray from anywhere but a resolved extension root | [`extension-root-npm-walks-up-and-runs-the-parent`](../../learnings/workflow-issues/extension-root-npm-walks-up-and-runs-the-parent.md) |
| share mutable state between commands, or between an AI tool and an open command | [`portable-node-advisory-file-lock`](../../learnings/design-patterns/portable-node-advisory-file-lock.md) |
| show, copy, or log an error that may carry a server response or URL | [`error-display-is-a-credential-disclosure-surface`](../../learnings/security-issues/error-display-is-a-credential-disclosure-surface.md) |
| split an ActionPanel into sections or title a section with a display name | [`actionpanel-sectioning-testflight-receipts`](../../learnings/design-patterns/actionpanel-sectioning-testflight-receipts.md) |
| write a preference description, an empty-state description, or any other string a user reads | [`copy-rules-written-from-memory`](../../learnings/workflow-issues/copy-rules-written-from-memory.md) |
<!-- learnings:end -->

Reach for the corpus when you are about to use a `@raycast/api` or `@raycast/utils` primitive in a way you have not used before, when a hook or platform API behaves differently from how it reads, or when a review finding points at a dependency's runtime behavior rather than at your own code. `CONCEPTS.md` at the repo root defines the terms these learnings use.

> **The recurring shape:** the expensive defects in this fleet are the ones `tsc`, `ray lint` and `ray build` all pass — a cache key that does not vary, a hook returning stale data alongside an error, an effect that cannot tell a fetch from a cache restore. A green gate is evidence about types and syntax, never about a library's runtime semantics. When behavior depends on a dependency, **read the dependency** — `node_modules/@raycast/utils/dist/module.js` is bundled but readable.

---

## Before the first edit — root, staleness, then branch

Three steps, in this order, for all three intents. None is an interview: the brief already says what to build. These establish *where*, *against what baseline*, and *on what ref*.

1. **Resolve the extension root and `cd` there.** It is the directory whose `package.json` carries Raycast keys (`commands`, `title`, `icon`): the repo root for a standalone repo, `extensions/<name>/` for anything monorepo-derived. Running `ray`/`npm` from a parent fails with npm-flavored errors (`ENOENT … package.json`, `could not determine executable to run`) or silently runs the parent's scripts; the resolver one-liner and the measured behavior table are the `extension-root` rule in [`../../reference/house-style.md`](../../reference/house-style.md). Several matches → ask which extension. Don't guess.

2. **Staleness gate — compare the tree against the PUBLISHED extension before reading code, planning or editing.** A local working copy is not authoritative: other people contribute to published extensions directly in `raycast/extensions`, and nothing about a stale tree announces that a whole command is missing. One command serves both checkpoints — this entry gate and `ship`'s pre-flight (`rx gates` runs it again) — so its verdicts mean the same thing in both places:

   ```bash
   node "<plugin>/scripts/rx.mjs" stale
   ```

   `rx stale` resolves the root itself before any lookup (so it also works from `src/`; two candidate roots → `ERROR root`, pass `--root`), compares **content**, not names, against a sparse fetch of `raycast/extensions`, and fails closed: any lookup failure other than a 404 is `ERROR github`, never "no differences".

   | Result | Meaning | Action |
   |---|---|---|
   | `N/A stale not published` | no baseline | proceed |
   | `PASS stale-mine` | published == your `HEAD` for every differing path | proceed |
   | `WARN stale-check` / `WARN stale-new` | published == an older commit of yours / a file only you have — an upstream revert or deletion looks the same | resolve each path by hand; `ship` records the disposition in the audit |
   | `WARN stale-remove` | a file the preset keeps local-only (`AGENTS.md`, …) is published; the next publish deletes it | proceed; `ship` records the `remove-published` disposition |
   | `FAIL stale-upstream` / `stale-only-pub` / `stale-unhandled` | upstream has edits or files you do not; or a symlink/mode change | **STOP — the tree is stale** |

   On STOP: do not edit or plan against the local code. Adopt the published version as the baseline, re-apply local work on top, and check each change against what the published version already fixed. A contributor's fix may be better than yours — compare rather than assume, and **re-run the house-style checks after reconciling**, because adopting a superset is not adopting every line in it. (`metadata/*.png` differing is usually Raycast CI's recompression; adopt one only after `ship`'s `rx png` triage.) The 2026-07-28 incident this gate exists for, and the re-verification corollary, are in [`raycast-dev-loop-incidents`](../../learnings/workflow-issues/raycast-dev-loop-incidents.md) §1.

3. **Read the tree state, then branch — only with permission to touch refs.** Look first: `git status --short && git branch --show-current`. Chris works in a **permanently dirty tree and his uncommitted edits are sacred**:
   - **Dirty tree → do NOT run any ref-mutating command.** Show him the status and ask whether to branch (carrying the edits) or stay put.
   - **Clean tree, and he asked for a branch → `git switch -c <prefix>/<slug>`** (`feature/`, `fix/`, `chore/`). The *only* ref command this step authorizes.
   - **Never `git add`, `commit`, `stash`, `checkout <path>`, `reset` or `pull` to "clean up"** — not even to make branching succeed. `git fetch` is safe; `pull`/`merge`/`rebase` touch the working tree and are not.
   - **No instruction either way?** Work on the current branch and say so in your report.

If the ask genuinely needs shaping before code, that's `superpowers:brainstorming` — invoke it and come back. Otherwise build the bullet list as written.

## Real examples Chris gives you stay out of the code (all three intents)

*(Stated by Chris, 2026-10-27.)* A URL, username, handle, email, post or video ID, or named path he hands you to reproduce a bug is often personal. Use it to reproduce, then **write fakes from the start** everywhere that ships — test fixtures, comments, CHANGELOG examples, commit messages — including derived values (a post's shortcode, the IDs an API returned for it, filenames built from it). Use an obviously fake value shaped like the real one (`AbCdEfGhIjK`, `example_user`). If a real value is genuinely needed, ask him first. `ship`'s `rx scan` is the backstop; writing fakes here means it finds nothing. *(instagram-media-downloader #32858, 2026-10-27: a reproduction post's shortcode and four media IDs went into tests and the CHANGELOG, then shipped.)*

## Intent 1 — Feature / refactor

Ordinary code work. The one non-default obligation: **write to House Style as you go.** In a self-authored extension (`author: chrismessina`), **every failure toast you write or touch is `showError` / `failToast` / `onErrorToast` from `@chrismessina/raycast-kit`**. This is `kit`'s build obligation in `house-style.md`. Existing toasts you are not touching need not be converted, and the obligation never applies on a fork you don't own. Add the dependency the first time you need one rather than hand-rolling `Toast.Style.Failure` or reaching for `showFailureToast`. Give a `useCachedPromise` / `usePromise` `onError: onErrorToast({ title })`, because its `failureToastOptions` cannot see the error. The `kit` rule is not only a `ship` audit finding: it applies the moment you write the toast. *(cosign, 2026-11-04: the kit was adopted only after Chris asked "should we use my raycast-kit?"; the agent had hand-rolled seven failure toasts plus a Copy Error helper the kit already provides.)* Elsewhere: no failure toast without a Copy Error action; no `Action` with an ad-hoc shortcut where a `Keyboard.Shortcut.Common` fits. Applying it inline is cheaper than letting `ship`'s audit bounce it back.

## Intent 2 — Modernization (gated)

Deliberate **major-version** migrations only: Node bump, ESLint 9→10, flat-config migration, `@raycast/api` breaking changes. Routine non-breaking bumps are `ship`'s dep hygiene; if the user means "keep my packages current", that's `ship`.

1. **Consult the gates** — [`../../reference/dep-gates.md`](../../reference/dep-gates.md) for the current targets before bumping across a major.
2. **Migrate** one major at a time. After each, re-run the three gates below (build → tsc → lint) — a dependency change invalidates every earlier green — and, for `@raycast/api`, `node "<plugin>/scripts/rx.mjs" api-floor`.
3. **If you discover a moved gate**, **propose** updating `dep-gates.md` and ask. Gates never move silently.

## Intent 3 — House-style audit fix (the `npm audit fix` for code)

Take an extension that works (a fork you contribute to, or your own legacy one) and bring it up to House Style: an iterative sweep of **code patterns**, not dependency versions. Sources of truth: [`../../reference/house-style.md`](../../reference/house-style.md) and [`../../reference/keyboard-conventions.md`](../../reference/keyboard-conventions.md).

1. **Load** `house-style.md`. Apply its `[build]`, `[both]` and `[lint]` rules; `[verify]`-only rules are `ship`'s read-only assertions. Each rule states its own scope (`Applies:`); a self-authored-only rule is never imposed on a fork.
2. **Scan** for each rule's governed pattern. The ones that recur: failure toasts without a Copy Error action (`copy-error`); `hide()` on a toast in a `useEffect` cleanup, a failure path, or without per-run ownership (`toast-no-id`); inline `shortcut={{…}}` objects (`keyboard`); web requests without `@chrismessina/raycast-logger` (`logger`, self-authored only); a bare `.svg`/`.png` icon with no `tintColor` (`monochrome-icon`); hand-typed `Preferences`/`Arguments` and `any` casts (`[lint]` rules — fix what you find, but their durable home is ESLint). **Self-authored only:** failure-toast code this pass touches follows Intent 1's kit obligation (`showError` / `failToast` / `onErrorToast`). For untouched toasts, `instanceof Error` ternaries and `${n} items` copy, offer `@chrismessina/raycast-kit` (`showError`, `getErrorMessage`, `countOf`) as a preference, not a violation; skip entirely on forks.
3. **Present a worklist** before mutating en masse. Fix iteratively; show diffs.
4. **Shortcuts: apply the transformation contract** in `keyboard-conventions.md` exactly — semantics over combo, `platforms` read first, the conflict invariant outranking the semantic map. **Do not let `ray lint --fix` do it.** Its three hazards — a diverging constant's binding moving, a cross-platform match rewriting a macOS-only literal, and the ambiguity warning being silently answered for you — are policy in [The three `--fix` hazards](../../reference/keyboard-conventions.md#the-three---fix-hazards); read it before accepting any autofix on a shortcut. Then assert the resolved-panel invariant mechanically:

   ```bash
   node "<plugin>/scripts/rx.mjs" shortcuts runtime   # once per installed Raycast version: records the app's real Common table
   node "<plugin>/scripts/rx.mjs" shortcuts check --extension-typescript     # shortcut-ambiguous / shortcut-reserved per resolved panel; ERROR without the table
   ```

5. **Gates, separately and in this order** (`tsc-gate`): `npm run build` generates `raycast-env.d.ts`; `npx tsc --noEmit` is the type gate reviewers run (`ray lint` never typechecks); `npm run lint` last. Since `@raycast/api` 2.9.0, `ray lint`/`validate`/`publish` **error** on two options with the same `value` in one `dropdown` preference, even under `--relaxed`.
6. **Hand forward to `ship`** when clean — `ship` re-runs the read-only audit as the gate.

> **Forked-extension caveat:** on a fork you are contributing *upstream*, House Style is *your* convention. Apply universally-good fixes (Copy Error, `Common` shortcuts, no `any`) freely; flag personal-dependency additions (`@chrismessina/raycast-logger`, `-kit`, the `.prettierrc`) for the user's call before adding them to a non-`chrismessina`-authored extension.

## Before reporting — audit the copy you wrote

No gate reads words. Review every string and comment you added (untracked files included) against these five `house-style.md` rules, each with its own scope from the preset:

| Rule | Applies | How it is checked |
|---|---|---|
| `us-english` | all | judgment; run the rule's regex over tracked files |
| `empty-state-copy` | all | judgment: every `List.EmptyView` description you wrote is one sentence, steps in the actions |
| `pref-description-length` | all (report) | `rx preflight` → `pref-description-length`, `pref-label-length` |
| `logger-verbose-copy` | the extension declares `verboseLogging` (block) | `rx preflight` → `logger-verbose-copy`: the whole block, verbatim |
| `logger-strict-redaction` | self-authored **and** installed logger ≥ 1.5.0 (report) | `rx preflight` → `logger-strict-redaction` |

Write a preference from the rule, not from memory, and on a fork fix only the preferences you wrote. Then run `node "<plugin>/scripts/rx.mjs" preflight` and quote any FAIL/WARN on those four ids. Twice the rule existed and was never read: [`copy-rules-written-from-memory`](../../learnings/workflow-issues/copy-rules-written-from-memory.md).

## After the change — run it in Raycast, don't just build it

**The static gates are necessary and not sufficient.** Build, `tsc` and lint prove the code compiles and lints. They prove nothing about whether the feature works, and they cannot see where Chris's nits live — a blurry empty-state label, a spinner that never resolves, an action that fires on an item whose file was never written. Reporting "builds clean" as "works" is how QA gets outsourced back to him.

**Launch it.** From the extension root, `npm run dev` (or `ray develop` — whichever the repo defines). A plain `npm run dev` reaches the app he is running; do not ask which Raycast app he is in and do not pass `--target`.

**One watcher lifecycle.** Start the watcher once, in the background, and keep it alive through every state you walk below. Never start-sleep-kill it: `ray develop` deploys incrementally and removes the install when it exits, so a watcher stopped early leaves a manifest with no `.js` — the command shows in root search, new preferences are missing from the pane, and the stack trace points at a file that no longer exists. Before handoff, stop it — **unless you are handing Chris the still-running watcher to test in his own terminal, in which case say so explicitly in the report.** An agent cannot hold a foreground watcher across tool calls, so when the change needs his hands, hand him `npm run dev` to run himself and say you did not run it. If a preference edit fails to appear after a *completed* deploy, check for `.js` under `~/.config/raycast/extensions/<ext>` first; preferences hot-reload, and prescribing a restart only risks blanking his stored values. The incidents behind each sentence here, including two retracted pieces of advice: [`raycast-dev-loop-incidents`](../../learnings/workflow-issues/raycast-dev-loop-incidents.md).

Confirm it appears in Raycast, then walk the states, not just the happy path:

- **Empty** — zero results / no data yet. Is the copy specific, and does it say what to *do*? (`empty-state-copy`.)
- **Loading** — does `isLoading` resolve on the failure branch too? A `.catch` that toasts without dismissing wedges the view on a permanent spinner.
- **Error** — force the failure (kill the network, bad token, empty input). Does the toast carry its Copy Error action?
- **Filtered / narrow window** — a query that matches nothing; a shrunk window. Truncation and alignment defects only appear here.
- **The ActionPanel as resolved** — open it and read the shortcuts on screen; `rx shortcuts check` is the mechanical half, your eyes are the other.
- **The effect that lands OUTSIDE the extension** — clipboard, a written file, a Finder reveal, an `open` handoff. **A green toast is not evidence the effect worked.** Verify at the destination: paste into a real app, `file` the written path, confirm Finder selected the item. The pasteboard probe (`xcrun swift -e …`) and the 2026-07-26 `get-app-icon` clipboard bug that passed every gate are in [`raycast-dev-loop-incidents`](../../learnings/workflow-issues/raycast-dev-loop-incidents.md) §5. If a temp file backs a clipboard action, do not delete it — or put the data on the pasteboard instead.

**Report what you actually observed** — the command run and what happened. `tsc` exit 0 plus "I walked the empty and error states; the empty state reads X" is a report. "Should work" is not, and neither is a green build alone. Where a step needs Chris's hands (a real account, a device, a paid API), say exactly that and hand him the steps with real paths. **For an external effect, name the destination evidence, not the action:** *"pasted into Notes → 512×512 image"* is a report; "Copy Icon works" is an assertion.

## House Style (applies to all three intents)

Every code change here conforms to House Style. The canonical, tagged checklist is [`../../reference/house-style.md`](../../reference/house-style.md) — read it rather than working from memory; it is not restated here. Shortcuts follow [`../../reference/keyboard-conventions.md`](../../reference/keyboard-conventions.md).

## Hands off

→ `ship` when the change is done, the three gates are green, **and it has been exercised in Raycast**. `ship` runs `rx gates`, the audit, weeding, compliance, PR and cleanup. If it bounces back with code-level feedback, you're up again.

← `review-pr` when a *contributor's* PR needs code changes, or when reviewing one surfaces a defect in your own extension. Reviewing someone else's submission is [`review-pr`](../review-pr/SKILL.md); changing code is here.

## Gotchas

- **Don't conflate hygiene with migration.** "Update my deps" is ambiguous — a non-breaking refresh is `ship`; a major migration is here. Ask before bumping.
- **The fix for one review finding can create the next.** A gate, early return or guard added to satisfy a reviewer has its own failure and empty path; walk it before moving on (cursors #29493: a Quick Look race fix wedged the grid on WASM-load failure).
- **A doubled effect in a dev log is usually the renderer replay**, not your dependency array: outside production Raycast replays effect setup on initial mount. Establish the expected replay first, then investigate what is left — repeats beyond it are real bugs, and a second setup that corrupts state is a cleanup bug dev mode found for you. **Development renderer replay** in `CONCEPTS.md`; detail in [`raycast-dev-loop-incidents`](../../learnings/workflow-issues/raycast-dev-loop-incidents.md) §7.
- **New files won't show in `git diff`.** Cross-reference `git status` when reviewing what you changed.
