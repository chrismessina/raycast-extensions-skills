# House Style

Chris's personal conventions for every Raycast extension — a standards checklist, applied at
**build time** by `develop` and audited at **pre-flight** by `ship`. One home per rule; skills link
the ID and never restate the rule.

> **Living document.** Rules here are earned from Chris's actual fleet, not invented — each cites
> fleet evidence: established adoption, a concrete defect it prevents, or a specific gap worth
> closing. The incident narratives behind a rule live in `../learnings/` and are linked from the
> rule, not repeated here. Emerging candidates are parked in
> [Still to enumerate](#still-to-enumerate) rather than promoted early.

## How to use this checklist

Every rule has a **tag** (who applies it), an **ID** (the stable name results are recorded
against), and a scope line saying which extensions it **applies** to. "Self-authored" means
`package.json` `author` is `chrismessina`; a fork you contribute to is never changed to match
your style.

- **`[build]`** — apply while writing. Judgment calls and patterns no audit can check after the
  fact. `develop` only; no matrix row.
- **`[verify]`** — checkable presence or absence; `ship` asserts it.
- **`[both]`** — applied while writing *and* asserted by `ship`.
- **`[lint]`** — belongs in ESLint; the audit is only the backstop for extensions that do not
  carry the lint rule yet.

**Where a rule is checked.** The preset `presets/chrismessina.json` binds every non-`[build]`
rule to its checks — `rx` check ids, ESLint rules from `eslint-plugin-raycast-harness`, or a
named judgment — with the rule's applicability and severity (`block` / `report`). The
[audit matrix](#audit-matrix) below is generated from it. A rule's **Audit** line here is one of:

- `rx <command>`: `<check-id>` must pass — mechanical; the verdict line is the evidence.
- an ESLint rule name — mechanical where the extension carries the plugin; the audit is the
  backstop otherwise.
- a reading instruction — a judgment, recorded as one entry per rule in `rx audit record` with the
  evidence read (sites, file:line, what was concluded). Silence is never a result: an
  inapplicable rule is recorded `n-a` with the reason.

`develop`'s **house-style audit fix** applies `[build]`, `[both]`, and `[lint]` rules to existing
code. `ship`'s **house-style audit** is read-only: it records a result per applicable ID; anything
that needs code goes back to `develop`.

### Why these rules do not live in Prettier

- **Prettier** reshapes only what it can derive from the AST with no notion of *meaning*: quotes,
  semicolons, width, indentation, trailing commas. **Zero** house-style rules are pure formatting.
- **ESLint** is where semantic rules belong — "no `any`", "no hand-defined `Preferences`", the
  `instanceof Error` ternary, shortcut collisions. That is what `[lint]` means: the rule's durable
  home is a lint rule. `@raycast/eslint-config` is the shared base; `eslint-plugin-raycast-harness`
  carries the house rules that have one.
- **The house-style audit** covers the rest — relationships Prettier and off-the-shelf ESLint
  cannot see (Copy-Error toast pairing, `canAccess(AI)` gating, `supportPath`-is-internal).

---

## Tooling and gates

### `[both]` `.prettierrc` is this exact file, in every self-authored extension

**ID:** `prettierrc` · **Applies:** self-authored

```json
{
  "printWidth": 120,
  "singleQuote": false,
  "plugins": ["@ianvs/prettier-plugin-sort-imports"],
  "importOrder": ["<BUILTIN_MODULES>", "<THIRD_PARTY_MODULES>", "^@raycast/(.*)$", "^[.]"]
}
```

The first two keys are the Raycast-scaffold standard. The last two add deterministic import
ordering — Node builtins, then third-party, then `@raycast/*`, then relative.

**`@ianvs/prettier-plugin-sort-imports` must be in `devDependencies`** (`^4.7.0`) or Prettier
fails to load the plugin and every format run errors. Config and dependency are a matched pair:
never add one without the other. Promoted from opt-in to rule on 2026-08-29, when a fleet census
found most actively maintained extensions already carried this exact config with the plugin
declared, and none carried one without the other.

> **Self-authored extensions only.** Never add this to a fork you do not own. Sorting imports
> rewrites every file with more than one import block, burying your actual change in an
> unrelated reformat and making the Store PR unreviewable. Check `author` in `package.json`
> before touching `.prettierrc`.

An extension still on the plain two-key config gets the change the next time it is being changed
for another reason (`[build]`). A standalone reformat PR is noise.

- **Audit:** `rx preflight`: `prettierrc` must pass (plugin ↔ `devDependencies` pairing, and the
  four-key values where adopted). Judgment: a two-key file is not a failure; it converts on the
  next touch.

### `[lint]` Never hand-define `Preferences` or `Arguments` types

**ID:** `no-hand-preferences` · **Applies:** all

Rely on Raycast's **auto-generated ambient types** from `package.json` (commands + preferences):

```ts
const preferences = getPreferenceValues<Preferences>();
```

…where `Preferences` is the *generated* ambient type — never a locally declared
`interface Preferences` / `interface Arguments`, and never a hand-rolled type param passed to
`getPreferenceValues()`.

- **Audit:** `rx preflight`: `hand-typed-preferences` must pass.

### `[lint]` No `any` type casting

**ID:** `no-any` · **Applies:** all

No `as any`, no `: any`.

- **Durable home:** `@typescript-eslint/no-explicit-any` in the shared config.
- **Audit backstop:** `rg -n '\bas any\b|:\s*any\b' src` on an un-linted fork; read each hit.

### `[lint]` Unwrap unknown catch values with the `instanceof Error` ternary

**ID:** `catch-unwrap` · **Applies:** all

A `catch` value is `unknown`. Stringify it with the exact guard — never touch `error.message`
unguarded, and do not spin up a **one-off, in-repo** `getErrorMessage` helper:

```ts
const errorMessage = error instanceof Error ? error.message : String(error);
```

**Exemption — the shared kit.** `getErrorMessage` from `@chrismessina/raycast-kit` satisfies this
rule and is *preferred* wherever the kit is already a dependency: it renders the fleet's real error
shapes that the bare ternary turns into `"[object Object]"` (see the `kit` rule). The prohibition is
on hand-rolling a *local* helper per repo, not on the one shared implementation.

This is Chris's standard across the fleet (17 of 21 self-authored extensions at the 2026-07 census)
and pairs with the Copy-Error toast below, whose `errorMessage` is produced this way.

- **Durable home:** ESLint (`@typescript-eslint/no-unsafe-member-access` catches the unguarded
  `.message`).
- **Audit backstop:** `catch (` blocks that reference `.message` without an accompanying
  `instanceof Error` or kit `getErrorMessage`.

### `[both]` Typecheck with `tsc --noEmit` — `ray lint` never typechecks, and a plain `ray build` does not either

**ID:** `tsc-gate` · **Applies:** all

`ray lint` (ESLint) **skips types entirely**, and a default `ray build` (esbuild) **strips them
without checking** — type errors compile and lint clean, then fail in editors and for external
reviewers running `tsc`. `ray build -e dist`, which many extensions use as their `build` script,
*does* typecheck (`@raycast/api` runs one when `environment === "dist"` and prints
`checked TypeScript`; verified in `node_modules/@raycast/api/dist/commands/build/index.js`). Run
`tsc --noEmit` anyway: it is the gate reviewers run, it does not depend on which environment the
repo's script happens to pass, and it fails loudly on its own. Do not tell a contributor their build
proves nothing when its output says it checked.

**Order: build → `tsc --noEmit` → lint.** A fresh checkout has no generated `raycast-env.d.ts`
until a build or dev run creates it, so `tsc` before build reports valid generated `Preferences`
references as errors.

- Common trap: a Raycast hook with multiple overloads (`usePromise` / `useCachedPromise`) silently
  resolving to the **paginated** overload, inferring `data` as `any[]`. Annotate the fetcher's
  return type (`(q: string): Promise<YcResult<T>> => …`) to pin the intended overload.
- TS does **not** carry an early-return narrowing into nested closures: after `if (!x) return`, a
  `const`-captured `string | null` is still `string | null` inside a later `async function`.
  Re-bind to a typed const (`const v: string = x`) rather than reaching for `as` / `!`.

- **Audit:** `rx gates`: `build`, `tsc`, `lint` must pass, in that order, from the extension root
  (`extension-root`). A gate that "passed" from the wrong directory did not run.

### `[verify]` `eslint-plugin-react-hooks` with `rules-of-hooks: error` is present

**ID:** `react-hooks-lint` · **Applies:** self-authored

`@raycast/eslint-config` carries NO react-hooks rules, so a hook placed below a guard's early
return (`if (g) return g;` then a `useMemo`) lints clean and crashes at runtime ("Rendered more
hooks than during the previous render" — attio Tasks, 2026-09-02). Every self-authored extension's
eslint config adds the plugin explicitly.

- **Audit:** the eslint config references `react-hooks/rules-of-hooks`. **Report, do not block:**
  as of 2026-09-23 only 1 of 35 extensions carries it; add it the next time the extension is
  changed for another reason.

### `[verify]` `madge --circular` runs as a `pretest` gate

**ID:** `madge-cycles` · **Applies:** self-authored

`ray` bundles to CJS, where an import cycle silently evaluates one module's default export as
`undefined` — "Element type is invalid" at runtime, invisible to `tsc` (attio: records↔objects
cycle, latent for days, detonated when an unrelated import changed evaluation order).

- **Audit:** `package.json` has `"check:cycles": "madge --circular --extensions ts,tsx src"` wired
  into `pretest`. **Report, do not block:** as of 2026-09-23 only 1 of 35 extensions carries it;
  add it the next time the extension is changed for another reason.

### `[build]` Run every `ray`/`npm` command from the extension root, never a parent

**ID:** `extension-root` · **Applies:** all

`npm install`, `npm run dev`, `npm run publish`, and `npx ray develop|build|lint` resolve the
manifest by **walking up from your current directory to the nearest `package.json`** — not by
finding "the extension." From a parent with no `package.json` you get an npm-flavored error that
names npm and never Raycast; from a parent that *has* one, **npm silently runs the parent's script
and exits 0** (measured 2026-07-24 with a decoy parent; this plugin's own repo is such a parent).
Never rely on an error to tell you that you are in the wrong directory.

The extension root is the directory holding the `package.json` **that carries Raycast keys**
(`commands`, `title`, `icon`) — not merely any `package.json`. The fleet has two topologies and only
one puts the root at the repo root:

| Topology | Repo root | Extension root |
|---|---|---|
| Standalone repo (e.g. `chrismessina/raycast-<name>`) | = extension root | the repo root itself |
| Monorepo (`raycast/extensions`, incl. sparse checkouts and PR-review forks) | monorepo root | `extensions/<name>/` |

**Resolve the root explicitly before running anything.** Every `rx` command that takes an
extension does this for you: `--root <dir>` wins; otherwise it walks up from the current directory
to the nearest `package.json` with a non-empty `commands` array, then searches one level down; more
than one candidate is `ERROR` asking for `--root`. Several matches → ask which extension, do not
guess. Then `cd` there and stay there for the whole build/lint/dev cycle.

- **`develop`:** `cd` to the resolved root before the first command; keep the dev loop there.
- **`ship`:** `rx gates` and `npm run publish` run from that same root. A gate that "passed" from
  the wrong directory did not run.
- **Evidence:** the measured table, the decoy experiment and the retired shell resolver's two bugs:
  [`extension-root-npm-walks-up-and-runs-the-parent`](../learnings/workflow-issues/extension-root-npm-walks-up-and-runs-the-parent.md).

### `[build]` A UI change is not done until the app has been LAUNCHED

**ID:** `launch-before-done` · **Applies:** all

`tsc` + build + lint + tests cannot see module-eval order, hook-order drift, cache shape, or a
dark asset on a light ground. After any wave of UI work, run the extension (`npm run dev`) and
open the changed commands before reporting — or say plainly that rendered output is unverified and
hand the eyes-only list over.

### `[both]` (conditional) Disable the Impeccable design hook — it is irrelevant to Raycast extensions

**ID:** `impeccable-off` · **Applies:** Impeccable plugin installed

The Impeccable **design detector hook** (`/impeccable hooks`) scans edited files for rendered-UI
defects — broken `<img>`, contrast, gradient text, glow shadows, layout rhythm. **A Raycast
extension has no rendered HTML/CSS surface** — the UI is declared entirely through `@raycast/api`
components — so every finding it produces on extension code is a false positive. (2026-07-23,
`reddit-search`: it read a server-side Atom-feed parser's `<img` regex and a JSDoc mentioning
`<img>` as a "broken image" and re-fired on every `Stop` event.)

**Rule:** on first touch of any Raycast extension repo where the hook is firing, disable it for
that project:

```bash
node <impeccable-skill-dir>/scripts/hook-admin.mjs off   # writes hook.enabled:false to .impeccable/config.json
# (or) /impeccable hooks off
```

`.impeccable/config.json` is machine-local (gitignore it — it must not ship to the Store PR). Do
not reach for per-file/per-rule ignores: the whole detector is out of scope for this codebase.

- **`develop`:** run once when you first edit an extension in a session and the hook is firing.
- **`ship`:** ensure the hook is off before the pre-flight, so a stray design finding cannot
  masquerade as a house-style violation — and keep `.impeccable/` out of the payload. A `.gitignore`
  entry does **not** do that: `ray publish` copies the extension directory wholesale, ignored and
  untracked files included (only the fork-side `git add` honors `.gitignore`). `.impeccable` is in
  the preset's `holdout.localOnly`, so `rx holdout out` moves it aside before `rx gates`; it moves
  only untracked entries, so a tracked copy would still ship.
- **Audit:** if `.impeccable/` exists in the repo, `git ls-files --error-unmatch .impeccable` fails
  (nothing under it is tracked) and `rx holdout out` has run before `rx gates`
  (`holdout-out` lists it).

---

## Runtime correctness

Every rule here is a defect class that shipped through a green `tsc` + `ray build` + `ray lint` +
full test suite, and was caught only by a human launching the app.

The `environment` rules follow the same principle: use what the platform already knows instead of
re-deriving it. Reference: <https://developers.raycast.com/api-reference/environment>.

### `[build]` `useCachedPromise` keying: the fn's TEXT is the namespace, args are the key

**ID:** `ucp-keying` · **Applies:** all

The persisted cache namespaces by `hash(fn.toString())` and keys by `hash(args)`. Two
consequences, both learned from live crashes:
- **A shared wrapper collapses namespaces.** Any hook that funnels different operations through
  one literal function (a `(...args) => fn(...args)` wrapper) MUST put an operation discriminator
  into the args, or equal-args calls overwrite each other's cached data (attio: Tasks rendered a
  cached members array).
- **A fn returning a fn IS the pagination contract.** `(deps) => async ({page}) =>` makes
  useCachedPromise treat results as page arrays — using that shape for a single-object fetch
  crashes on `.length`. Curried form only where a `pagination` object is actually passed to the
  `<List>`.

### `[build]` A controlled `List.Dropdown` fires `onChange(firstItem)` on mount, ignoring `value`

**ID:** `dropdown-mount-onchange` · **Applies:** any `List.Dropdown` whose `onChange` persists or sets state

**Context:** this showed up where the search-bar dropdown is pressed into service as a **settings
control** (a chat's model picker), not as the list *filter* it was designed to be. As a filter, a
mount-time `onChange(firstItem)` just re-filters and nobody notices. It bites only when `onChange`
writes a remembered choice. If you are building a picker, ask first whether it belongs in the
dropdown at all (a `Form.Dropdown` in a form, or an action that pushes a picker).

When the dropdown first renders, Raycast calls `onChange` with its **first** item even when `value`
names a different one. An `onChange` that saves the pick (to `useCachedState`, `Cache`,
`LocalStorage`) silently overwrites the saved choice with item 1 on every launch, so the command
"never remembers" the model or filter the user set. **Fix:** render the item you want selected
FIRST, so the mount-time call passes the same value. Do not suppress the first call: if Raycast
ever fixes the quirk, that swallows the user's first real pick. *(Receipt: raycast-osaurus,
2026-09-26 — the debug log showed `changeModel("foundation")` right after mount with
`value="raptor-…"`, so the default set in Manage Models never took.)*

### `[both]` An elapsed-time check uses `performance.now()`, never `Date.now()`

**ID:** `monotonic-elapsed` · **Applies:** all

`Date.now()` is a wall clock: a clock correction (NTP stepping the system time back, a manual
change) moves it backward, and every duration measured across that jump goes negative. A cache-freshness window pins itself open and
serves stale data (fathom `transcriptTextFor`, 2026-09-19, caught in review); a timeout never
fires; a "how long has this run" guard reports a negative age and takes the wrong branch. Reproduce
it by stubbing `Date.now` an hour back — the defect is deterministic, not a race.

`Date.now()` remains correct for a timestamp that is STORED and outlives the process (a TTL on
disk, an `updatedAt`): `performance.now()` is relative to process start and is meaningless once
written down. The test is whether the number is compared against another reading from the same
process run.

- **Audit:** `rg -n 'Date\.now\(\)' src` → read each hit. One subtracted from another reading taken
  in the same process run is a defect; a stored timestamp is not.

### `[both]` A readiness gate tracks *did prep finish* and *which items succeeded* separately

**ID:** `readiness-gate` · **Applies:** background prep drives `isLoading`

One boolean cannot carry both, and conflating them fails in *both* directions:
- **Finish must resolve on every path — including `.catch`.** If a background task (WASM load,
  pre-render, prefetch) drives the spinner via `isLoading={… || !ready}`, the failure branch must
  still flip `ready`, or one non-critical failure wedges the whole view on a permanent spinner even
  though the UI is fully functional. Toast *and* dismiss — never just toast.
- **A single "ready" flag lies about per-item availability.** When the gate covers N independent
  items, track the *set of items that actually succeeded* — not one flag flipped for all.
  Render/fetch each item independently (per-item `try/catch`, not a `Promise.all` that rejects on
  the first failure and abandons the rest), return the succeeded ids, and gate each item's action on
  membership. The two paths must derive the identical key (e.g. both `${id}-512.png`), or
  set-membership does not prove the target exists. (Cursors #29662: a flat `quickLookReady`
  boolean offered ⌘Y on cursors a first-failure `Promise.all` never rendered.)

- **Audit:** find loading gates fed by background work — `rg -n 'isLoading=\{[^}]*(ready|Ready)' src`
  — and read each: the failure branch must resolve the gate, and any per-item action must be
  gated on that item's success, not on the shared flag.

### `[both]` A cache version is DERIVED from the cached shape, never hand-maintained

**ID:** `cache-version-derived` · **Applies:** persists a typed payload

Any extension that persists a typed payload — `LocalStorage`, `Cache`, a JSON file — has a version
in its key so a shape change evicts stale entries. Hand-maintaining that version fails, and it
fails silently: an entry written under the old shape simply lacks the new field, and an optional
field's absence is indistinguishable from a real negative result. `tsc`, `ray build` and `ray lint`
all pass, because the code is correct — it is the *data* that is from a previous era.

Compute the version instead — a generated constant (`export const CACHE_SCHEMA = "<hash>"`, used
as `` KEY_PREFIX: `myext_cache_${CACHE_SCHEMA}_` ``) derived by a script the extension owns.
Whatever that script is, it meets all of these, or it is not a gate:

- **Hash the transitive import closure of the cached types, not one entry file.** A cached type
  almost always reaches a union or interface defined elsewhere; hashing one file lets a rename
  there keep the old key, and the stale value then misses the new lookup and throws at render.
  Over-invalidating is the safe direction: a needless eviction costs one refetch, a missed one
  costs a false claim rendered as fact for the whole TTL.
- **Canonicalize through the TypeScript compiler printer (`removeComments: true`), never a regex
  comment strip.** A regex truncates `type Url = "https://a.example"` at the `//`, so two
  different URLs hash identically — the exact failure the mechanism exists to prevent. Reprinting
  keeps the hash stable across comment and whitespace edits and moves it on real shape changes.
- **Its check mode writes nothing and exits non-zero on a mismatch.** A `--check` that regenerates
  the file silently repairs stale output and proves nothing. The gate that protects users is that
  check running before commit and in `prelint`, **not the build**: npm lifecycle scripts fire for
  `npm run build` but not for `npx ray build`, which is what Raycast Store CI runs, and `predev`
  runs once, so a `ray develop` hot reload keeps the old fingerprint.
- **Commit the generated file.**
- **Keep a hand-bumped salt beside the hash.** A semantic correction with an unchanged shape — a
  classifier that now returns "unavailable" where it returned "absent" — moves no type and
  therefore no hash. One deliberate step for the case no derivation can see.
- **Belt and braces at the point of use.** Where a merge or a render can encounter an old record,
  prefer the value that is actually populated over the one that merely arrived first. That fixes
  the class independently of the storage layer having been correct.

**The general rule this is an instance of:** when edit A is only correct if someone also makes
unrelated edit B, that pair is a latent defect no matter how well it is documented — a checklist
item is just one more chance to forget. Derive B from A, or make the inconsistent state
unrepresentable where it is consumed.

- **Audit:** `rg -n 'KEY_PREFIX|CACHE_VERSION|schemaVersion' src/` → any hand-typed version literal
  beside a persisted typed payload is a finding. Where a derivation script exists, read it against
  the list above: a check mode that writes, or a hash over one file, is a finding (the script this
  rule shipped until 2026-10-31 did both; it was removed rather than copied again).
- **Evidence:** 2026-09-09, `raycast-digger` — `DiggerResult` gained `wellKnown`, then `theme`,
  then `ThemeColor.hex`; the key bump was forgotten all three times. Each produced a section
  confidently reporting an absence it had never established, served from cache for 48h. The third
  instance also survived a cache bump by winning a merge, which is why the point-of-use rule is
  listed above and not just the derivation.

### `[both]` Interval-driven commands must branch on `environment.launchType`

**ID:** `interval-launchtype` · **Applies:** a command declares `interval`

A command with an `interval` (a scheduled background refresh — `"mode": "menu-bar"` alone does
**not** cause background ticks) runs both on user open **and** on the scheduled background wake.
Guard user-facing side effects (`showToast`, `showHUD`, error UI) behind `environment.launchType`,
so a failed background refresh (an expired OAuth token) logs quietly instead of firing the same
toast path as a manual open:

```ts
if (environment.launchType === LaunchType.Background) {
  // log only — no toasts, no HUD
}
```

- **The gap:** `raycast-tesla-energy/src/menu-bar-status.tsx` and `raycast-luma/src/luma-menubar.tsx`
  (both interval-driven) do not guard their fetch/error UI against background invocation.
  `LaunchType` is imported in 7 repos but only ever passed **outbound** to `launchCommand()`.
- **Audit:** `jq -r '.commands[] | select(.interval) | .name' package.json` lists the interval
  commands; each one's source reads `environment.launchType` before any `showToast` / `showHUD`.

### `[both]` Handle no-AI-access on every Raycast-AI call

**ID:** `ai-access` · **Applies:** calls Raycast AI

Any code path that calls `AI.ask` / `useAI` must **degrade gracefully** for a user without Raycast
AI access (non-Pro, or AI disabled). Two acceptable ways: **gate ahead of time** with
`environment.canAccess(AI)` and branch to a non-AI fallback (preferred when there is a real
fallback to show), or **catch the thrown no-access error** around the AI call. An *ungated,
uncaught* AI call is the defect.

- **Right:** `raycast-reader/src/hooks/useArticleReader.ts:84` —
  `const canAccessAI = environment.canAccess(AI);` then
  `const shouldShowSummary = canAccessAI && preferences.enableAISummary;`.
- **The gap this rule closes:** `raycast-sora/src/utils/videoNaming.ts:44` calls `useAI(...)`
  unconditionally; a user without AI access gets a failure instead of the truncated-title fallback
  `getVideoDisplayTitle()` already provides.
- Same pattern for any capability behind `canAccess` (`BrowserExtension` —
  `raycast-memory-store/src/lib/background.ts:25`).
- **Audit:** the failure mode is a **green check on a real violation**, so the pattern has to be
  tight. Match `\b(useAI|AI\s*\.\s*ask|AI\s*\[\s*["']ask["']\s*\])\s*\(` **and** resolve aliases by
  first reading the `@raycast/api` import specifiers in each file for `useAI`/`AI`. For each hit
  assert **either** a `canAccess(AI)` guard **or** an enclosing try/catch on that path.

### `[both]` `environment.supportPath` is for INTERNAL state only — user files go to a preference dir

**ID:** `supportpath-internal` · **Applies:** writes files

`supportPath`'s *parent* is not a list of installed extensions — Raycast creates an extension's
folder there only on first run. See
[`read-installed-raycast-extensions-from-config-not-application-support`](../learnings/design-patterns/read-installed-raycast-extensions-from-config-not-application-support.md).

`supportPath` is the writable per-extension directory — the right home for caches, indexes, and
command state the user never opens by hand. (Not `assetsPath`, which points at the extension's
*bundled* assets — replaced on every update, so anything you write there is lost.) Anything the
user is meant to **find in Finder** (exports, downloads, generated deliverables) goes to a
user-visible directory — an `exportDirectory`/`downloadDirectory` preference defaulting to
`~/Downloads`.

- **Right:** `raycast-fathom/src/utils/export.ts:36` reads `preferences.exportDirectory`.
- **The gap:** `raycast-fathom/src/actions/TeamMemberActions.tsx:22` writes a user-facing JSON
  export to `path.join(environment.supportPath, "downloads")` — buried where no one will find it.
- **Audit:** flag `environment.supportPath` used to build a path that is then revealed/opened for
  the user, or handed to `Action.ShowInFinder`.

### `[verify]` Read the active selection via the platform API, never a shell-out

**ID:** `selection-api` · **Applies:** reads the selection

Use the platform functions — never an `osascript`/`open`-based shell-out:
- `getSelectedText()` — highlighted text in the frontmost app.
- `getSelectedFinderItems()` — selected files, **Finder-specific**: it rejects if Finder is not
  frontmost, so always `await` it in a try/catch (or use it as a guarded fallback, as the fleet
  does: `at-profile/src/yaml-settings.ts:282`, `trimmy/src/trim-core.ts:91`).

- **Audit:** a bare `osascript`/`System Events` grep is **too broad** — it fires on AppleScript/JXA
  used for unrelated automation (`get-app-icon`, `airbuddy`). Narrow to scripts that read a
  selection: `osascript`/JXA **co-occurring** with `selection of`, `selected items`,
  `get selection`, `selectedText`, `sel of`; then read the hits.

> **Underused — reach for these on the next fitting extension.** Not rules (little adoption, no live
> defect), but first-choice options when the situation fits: **`environment.appearance`**
> (`"dark"`/`"light"`) for custom SVG/canvas graphics whose colors must track the theme (component
> `tintColor`s still use `Color.*`); **`environment.textSize`** for a long-form `Detail`;
> **`environment.isDevelopment`** for dev-only debug UI.

### `[both]` `launchCommand` is awaited inside a try/catch with a failure toast

**ID:** `launch-command-caught` · **Applies:** all

`launchCommand` returns a promise that rejects when Raycast cannot open the target command. A bare
`onAction={() => launchCommand(…)}` fails silently and leaves an unhandled rejection. Route every
call through one helper that awaits it and shows a failure toast with Copy Error (`copy-error`).

- **Audit:** `rg -n 'launchCommand\(' src`. Every hit is inside a `try` whose `catch` shows a
  failure toast, or is the one helper that does. *(2026-09-27, mercury #31611: a Raycast reviewer
  requested changes over three unwrapped calls.)*

---

## Toasts, errors, and logging

### `[both]` Every failure toast carries a "Copy Error" action

**ID:** `copy-error` · **Applies:** all

> **What gets copied is disclosed.** An error string can carry a token, a signed URL, or a server's
> echo of the request. Redact at the boundary where the message is derived, so the same redacted
> string feeds the toast *and* the clipboard —
> [`error-display-is-a-credential-disclosure-surface`](../learnings/security-issues/error-display-is-a-credential-disclosure-surface.md).

Every failure toast offers **Copy Error**, which copies the error message to the clipboard —
however the toast is made. Three paths, and only the last is compliant by default:

| Path | Compliant when |
|---|---|
| `showToast({ style: Toast.Style.Failure, … })`, or `toast.style = Toast.Style.Failure` | it sets a `primaryAction` titled `"Copy Error"` (canonical form below) **and it reports a result, not a caught error** (a validation verdict such as "Saved at the Wrong Size", or a progress toast flipped to Failure). A caught error, including one routed through a local wrapper (`showFailure(title, errorMessage(e))`), goes through `showFailureToast` or the kit: Greptile `failure-toasts` flags the hand-built form, and a wrapper does not hide it (capture-raycast-metadata #33805, round 1) |
| `showFailureToast(error, { title })` from `@raycast/utils` | it passes `primaryAction` titled `"Copy Error"`. **Its default action is not Copy Error:** it attaches **Report Error** (a published extension) or **Copy Logs** (development or private). Passing `primaryAction` moves that default to the secondary slot, so the user gets both. |
| `showError` / `failToast` from `@chrismessina/raycast-kit` | always — the kit attaches Copy Error itself, and redacts |

- **Audit — a per-call-site pairing review, not a count.** List every failure site
  (`rg -n 'Toast\.Style\.Failure|showFailureToast\(' src`), then read each one: it sets a Copy Error
  `primaryAction` in the same call or on the same toast, and the string it displays and copies went
  through redaction. `showError(` / `failToast(` sites comply without one. A global count of
  `"Copy Error"` strings proves nothing — one compliant toast can mask ten that are not. ESLint
  `copy-error-pairing` (`eslint-plugin-raycast-harness`) catches the literal forms and accepts the
  helper forms; the reading covers what it cannot see.
- **Canonical form.** One redacted string, derived once, feeds both surfaces. `redactSecrets` is
  `@chrismessina/raycast-kit/errors`; on a fork without the kit, the boundary still exists — put the
  redaction where `errorMessage` is derived, never display or copy `error.message` raw:

```ts
catch (error) {
  logger.error("Token generation failed", error);
  // The boundary: derive once, redact once, then use the SAME string everywhere it surfaces.
  const errorMessage = redactSecrets(error instanceof Error ? error.message : String(error));
  await showToast({
    style: Toast.Style.Failure,
    title: "Failed to generate token",
    message: errorMessage,
    primaryAction: {
      title: "Copy Error",
      onAction: async () => {
        await Clipboard.copy(errorMessage);
      },
    },
  });
}
```

With `@raycast/utils`, derive the redacted string first and pass it to both the message and the
action — `showFailureToast(error, …)` would otherwise display `error.message` unredacted:

```ts
const errorMessage = redactSecrets(error instanceof Error ? error.message : String(error));
await showFailureToast(errorMessage, {
  title: "Failed to generate token",
  primaryAction: { title: "Copy Error", onAction: () => Clipboard.copy(errorMessage) },
});
```

### `[both]` In a `no-view` command, never `showHUD` before a toast that carries actions

**ID:** `no-hud-before-actions` · **Applies:** a `no-view` command

The Copy-Error rule is silently defeated in `no-view` commands by a single earlier `showHUD`. Three
pieces of documented behavior compose into a trap:

1. `showHUD` **closes the main Raycast window** — its stated purpose, not a side effect.
2. `showToast` **degrades when the window is closed** — to a HUD or a system notification; both
   are non-interactive.
3. Neither fallback renders actions, so `primaryAction` / `secondaryAction` are **dropped**.

The code reads correct — the actions sit right there in the `showToast` call — and they never
render. **Only a human running the command sees it.**

- **HUDs cannot carry actions at all.** `showHUD(title, options)` accepts only `clearRootSearch`
  and `popToRootType`. "Add an action to the HUD" is never the fix — the fix is to stop using a HUD.
- **If a `no-view` command offers any action on completion** — Show in Finder, Open, Copy Error,
  Retry — use a **Toast for the whole flow**: animated toast up front, mutate `message`/`title` for
  progress, terminal toast at the end. No `showHUD` anywhere in that command's path, *including
  inside shared `lib/` helpers it calls* — that is where it hides.
- **HUD stays correct** for instant, action-free confirmations: "Copied", "Pinned", "Moved to Trash".
- **Accept the trade-off:** a Toast keeps the Raycast window open where a HUD dismisses it. That is
  the price of interactivity.

```ts
// no-view command, canonical shape
const toast = await showToast({ style: Toast.Style.Animated, title: "Downloading", message: filename });

toast.message = `${filename} — ${percent}%`; // progress: mutate in place

// Terminal state: the user ends up looking at a Toast, so the action survives.
await toast.hide();
await showToast({
  style: Toast.Style.Success,
  title: "Download Complete",
  message: filename,
  primaryAction: { title: "Show in Finder", onAction: () => showInFinder(path) },
});
```

- **Audit:** for each command with `"mode": "no-view"` in `package.json`, walk its entry file **and
  the `lib/` helpers it imports**. Flag any `showHUD` in a command that also builds a toast carrying
  `primaryAction`/`secondaryAction`.
- **Evidence:** 2026-08-07, `raycast-fetch`. The single-download completion toast carried both
  "Open File" and "Reveal in Finder"; neither ever appeared, because the progress helper opened
  with `showHUD`. It survived a code review, a house-style audit, and an adversarial Codex pass —
  Chris found it on the first real run.

### `[both]` `Toast.Style.Animated` is a promise that work is in flight — never spin for a synchronous write

**ID:** `animated-means-work` · **Applies:** all

An animated toast tells the user "wait, something is happening." If the operation is an instant
`LocalStorage` write, a `setState`, or a `Clipboard.copy`, there is nothing to wait for: show the
terminal Success toast directly, with no `Animated` phase at all.

- **Reserve `Animated` for genuinely async work** — network requests, disk IO, spawned processes.
- **For genuinely async work, both terminal patterns are supported.** Mutate in place
  (`toast.style = Toast.Style.Success`, or `failToast` for the failure half), or `await toast.hide()`
  then show a fresh toast. They are equivalent **for a simple sequential flow, where nothing else
  can reach the toast slot in between.** Once the toast is held across an await that can be
  superseded, aborted, or raced by another toast, neither is safe as written — see `toast-no-id`.
- **Audit:** `rg -n 'Toast\.Style\.Animated' src`. For each, confirm genuinely async work is
  awaited between creation and the terminal state. Flag any whose only intervening work is
  `LocalStorage` / `setState` / `Clipboard`.
- **Evidence:** 2026-07-27, `raycast-claude` — Chris screenshotted "Preset saved!" beside a
  still-spinning icon. **15 of the 17 animated sites were instant `LocalStorage` writes** that should
  never have had a spinner; deleting the `Animated` phase fixed it. Live mutation of `toast.style`
  is Raycast's documented pattern and worked at the other sites in the same codebase — the defect
  was the spinner, not how the terminal state was set.

### `[both]` A toast has no id — `hide()` and mutation act on whatever is on screen NOW

**ID:** `toast-no-id` · **Applies:** all

A `Toast` handle reads like a reference to a specific toast. It is not: there is one toast slot,
`showToast` replaces whatever occupies it, and `hide()` / property mutation act on whatever is
visible *now*. Every bug below comes from code written as if the handle had identity.

**None of this is in the API docs**, which is why the rule exists. [Toast][t] documents `hide()`
as `() => Promise<void>` and says nothing about identity, one-at-a-time, or rejection;
[showFailureToast][f] says nothing about aborts or replacing a visible toast. Keep the provenance
straight:

- **Verified in the installed `@raycast/utils` source** (`dist/module.js`) — the only reliable
  answer to any hook-ordering question: `usePromise` suppresses `onError` for an `AbortError`, and
  it supersedes a run by aborting it, swapping the controller and invoking the next run **without
  awaiting the old one's settlement**.
- **Repo convention, not platform behavior** — a wrapper that short-circuits on `AbortError` (e.g.
  `showBrewFailureToast`). Check the extension you are in; Raycast's own `showFailureToast` makes
  no such promise.
- **Inference, treated as cheap insurance** — that `hide()` may reject. The type permits it and the
  implementation is not inspectable.

[t]: https://developers.raycast.com/api-reference/feedback/toast
[f]: https://developers.raycast.com/utilities/functions/showfailuretoast

**Five rules for any animated toast held across an `await`:**

1. **Never hide after a genuine failure.** The failure toast has already taken the slot; hiding
   dismisses *it* and the user loses the error entirely. `showToast` needs no `hide()` first.
2. **Do hide on an abort.** `usePromise` suppresses `onError` for an `AbortError`, so unless your
   failure path is reached some other way, nothing replaces your toast and it spins forever after
   the user has walked away.
3. **Guard on ownership, not just on timing.** Run N's deferred hide lands after run N+1 has shown
   its own toast and dismisses N+1's. Take a per-run token (`const mine = ++runRef.current`) and
   hide only while `runRef.current === mine`.
4. **Never `await` the hide into the work promise.** A rejection awaited inside the fetcher turns a
   *successful* operation into a visible failure. Fire and forget with a logged `.catch()`.
5. **Finish an animated toast in place; do not replace it while it is still being updated.** Every
   property change (`toast.message = …`, `.title`, `.style`) sends Raycast an `updateToast` carrying
   the handle's FULL options — its Animated style, title and Cancel action — with no id, unawaited
   (`setImmediate` → `postMessage`, read from the `@raycast/api/index.js` bundled inside
   Raycast.app). Finishing by `showToast` puts a second kind of request in flight behind it, and
   the two were seen to apply out of order: the progress update landed on top of the success
   toast. Finish the way Raycast's docs and 212 extensions do — set `style`, `title`,
   `message = undefined` and `primaryAction = undefined` on the same toast. (That updates to one
   toast stay in order is inferred, not proven; confirm with a same-tick repro.) Do **not** reach
   for a settle delay or a toast controller: a 250 ms gap was built for `brew`, needed four review
   rounds, kept surfacing late hides that closed other toasts, and was pulled; no extension in the
   monorepo has a controller.

**Put the toast inside the promise, not in a `useEffect` keyed on `isLoading`.** The
effect-with-cleanup shape is wrong by construction: the cleanup is deferred, so it fires exactly
when the slot has moved on.

```ts
const runRef = useRef(0);
const { data } = usePromise(async () => {
  const mine = ++runRef.current;
  const clear = (t: Toast) => {
    if (runRef.current !== mine) return;              // superseded — not ours
    t.hide().catch((e) => logger.log("hide failed", e)); // never awaited
  };
  const progress = await showToast({ style: Toast.Style.Animated, title: "Working…" });
  try {
    const result = await work(signal);
    clear(progress);
    return result;
  } catch (err) {
    if (isAbortError(err)) clear(progress);           // nothing else will
    throw err;                                        // real failure: leave it
  }
}, [], { abortable, onError: showFailureToast });
```

- **Audit:** ESLint `no-toast-hide-in-cleanup` (`eslint-plugin-raycast-harness`) catches the
  effect-cleanup form. Then read every `Toast.Style.Animated` and every `.hide()`: can a second
  toast reach the slot between creation and hide? Flag any hide on a failure path, any
  `await …hide()` inside a fetcher, any hide with no ownership guard, and any animated toast
  finished by a fresh `showToast` while its setters are still in use (rule 5).
- **Evidence:** 2026-09-17, `brew` #31164 — three passes to get one toast right. v1 hid in an
  effect cleanup and would have dismissed the failure toast raised microseconds earlier; v2 left
  the toast spinning on abort, because the failure helper ignores `AbortError`; v3 introduced the
  supersession race in rule 3. **What ended it was reading the installed `@raycast/utils` source**
  — reasoning from the API surface produced three wrong answers in a row. 2026-10-02, `brew`: an
  installed tap cask left "Installing Tinycast / Operation completed successfully" with a live
  Cancel button on screen; `execBrewWithProgress` reported its exit as a progress message in the
  same tick `settle` replaced the toast with `showToast` (rule 5).

### `[both]` Toast copy never says "this window" — a toast is a detached HUD

**ID:** `toast-window-copy` · **Applies:** all

A toast does not belong to a window. It renders as a floating pill with no frame, no title bar,
and nothing around it the phrase could refer to — so copy that says "keep this window open",
"close this window", or "in another window" points at something the user cannot see.

- **Say the app, or say the fact.** `"keep Raycast open"` is the instruction a user can act on.
  When the distinction is really between two *command instances* — which the user has no name for
  — drop the noun and state the fact: `"This recording is already downloading."`
- **Why it slips in:** the phrase is written while reading code, where "the command's window" is
  the accurate mental model. It survives `tsc`, `ray lint`, `ray build`, and a Codex review,
  because every one of those reads the string as an opaque literal.
- **The doc comment is part of the rule.** When a toast's wording encodes a real lifecycle fact,
  the comment above it tends to restate the old wording. Update both, or the next reader restores
  the string to match the comment.
- **Audit:** `rg -n '(message|title): "[^"]*window' src/` → hits inside comments are fine; hits
  inside a user-facing string are the defect. *(fathom, 2026-09-16: `"… · keep this window open"`
  shipped to a HUD; Chris caught it on sight. Two sibling strings had the same noun.)*

### `[both]` (conditional) Structured logging via `@chrismessina/raycast-logger`

**ID:** `logger` · **Applies:** self-authored, makes web requests

**Condition:** the extension makes web requests — `fetch`, `useFetch`, `axios`, `node-fetch`,
Node's `http`/`https`, `undici`/`got`/`ky`, or a request package such as
`@chrismessina/raycast-downloader` (`rx` applies this pattern over `src/`; a narrower one misses
real clients — `raycast-fetch` requests through the downloader package and writes `fetch (` with a
space). Does **not** apply to extensions with no network calls.

**If yes:** `@chrismessina/raycast-logger` is a dependency and imported (the `logger` used in the
Copy-Error pattern above), and the extension exposes a preference named **exactly
`verboseLogging`**, type `checkbox` — the logger reads `getPreferenceValues().verboseLogging`
internally, so a differently named toggle silently does nothing.

- **Audit:** `rx preflight`: `logger` must pass.

#### `[both]` The copy is fixed too — type this block verbatim

**ID:** `logger-verbose-copy` · **Applies:** the extension declares `verboseLogging`

Decided 2026-09-05, after a fleet census found 3 titles and 11 label/description pairs for one
toggle that does the same thing everywhere. Type this block verbatim; do not reword it per
extension (extra context belongs in the README, not the toggle). `title` is the settings group
heading, `description` keeps its trailing period, `label` has none.

```json
{
  "name": "verboseLogging",
  "title": "Debug Logging",
  "label": "Enable extra diagnostics in the console",
  "description": "Show detailed logs in the console for debugging.",
  "type": "checkbox",
  "required": false,
  "default": false
}
```

- **Audit:** `rx preflight`: `logger-verbose-copy` must pass (the full block is compared; absence
  is `N/A`).

#### `[both]` Logger 1.5.0+: declare `strictRedaction` beside `verboseLogging`

**ID:** `logger-strict-redaction` · **Applies:** self-authored, installed logger 1.5.0+

Logger 1.5.0 reads a second preference, `strictRedaction`: standard redaction masks values by
*name*, strict also masks every URL query string and fragment. The user holds the switch because
the user is the one who knows a log is about to leave the machine. Declare it verbatim, next to
`verboseLogging`, in every self-authored extension whose **installed** logger is 1.5.0+:

```json
{
  "name": "strictRedaction",
  "type": "checkbox",
  "required": false,
  "title": "Strict Redaction",
  "label": "Also hide URL query strings and fragments in logs",
  "description": "Turn on before reproducing an issue, then share only the new log lines.",
  "default": false
}
```

This is UI copy in `package.json`, so it ships — fold it into the next PR that touches the
extension. In an extension you do **not** author, leave it alone.

- **Audit:** `rx preflight`: `logger-strict-redaction` must pass. **Report, do not block** on an
  extension still pinned below 1.5.0 — bumping the logger is its own change.

#### `[both]` Preference descriptions fit on one line — 80 characters or fewer

**ID:** `pref-description-length` · **Applies:** all

Raycast's settings pane shows a preference's `description` under its control; past about 86
characters it wraps behind a **Show more / Show less** disclosure, and at a narrower width it
wraps at about 51. So: **`description` ≤ 80 characters** (hard limit; aim for 50 or fewer when the
copy allows), **`label` < 50** (it renders in a larger font on the same row as the switch).
**Command-level preferences count too.**

- **Say when or why, not what.** The `label` already names the setting. The description earns its
  line by saying when to turn it on or what changes as a result. Detail that needs more than one
  line belongs in the README.
- These are *targets measured once*, not documented Raycast limits. If a screenshot shows a line
  wrapping earlier, lower the number here; do not raise it without one.

- **Audit:** `rx preflight`: `pref-description-length` and `pref-label-length` must pass (report).
- **Evidence** for all four logger/preference rules — the census, the 237-character description,
  both measurements, and the shell audits `rx` replaced:
  [`logger-preference-copy-and-length-measurements`](../learnings/tooling-decisions/logger-preference-copy-and-length-measurements.md).

#### `[both]` (conditional) The Store description leads with the action and the app people search for

**ID:** `store-description` · **Applies:** the branch adds or changes `description` in `package.json`

The top-level `description` is the line on the Store list, on the extension's web page, and in
search engine and AI assistant results, so it is written for someone who has never seen the
extension. Raycast added this to its guidelines and to Greptile as `store-description` in
raycast/extensions#33589, and rewrote about 3,500 descriptions to it in #33590–#33599 (merged
2026-11-16/17). The rule as shipped on `main` (092555d) is medium severity and strict: every point
below is a requirement, a miss is a should-fix, and Greptile posts one comment per description
listing every miss with a rewritten description as JSON to paste. This house rule's own severity is
`report`; Greptile's finding still holds the PR.

- **Lead with the action and the app, service or task people search for.** ✅ `Find and kill
  processes sorted by CPU or memory usage, and force quit apps and background processes.` ❌
  `Control Obsidian with Raycast` ❌ `Manage Apple Reminders.`
- **Name the main things it does, matching its commands and AI tools.** Claim nothing the code
  doesn't do. ✅ `Create, view and complete Apple Reminders, add reminders in natural language with
  AI, and see them in the menu bar.` ❌ `Spotify's most common features, now at your fingertips.`
- **About 50 to 155 characters.** Search engines cut off longer ones. Count them; don't estimate.
- **No filler every extension shares:** "Raycast extension to", "from Raycast", "directly from your
  command bar", "the fastest way to".
- **One sentence:** sentence case, US English, a closing period, brand names in canonical spelling
  (`GitHub`, `macOS`).
- **Name a platform (`Mac`, `macOS`, `Windows`) only when `platforms` matches.**
- **Not covered:** a description on `main` the branch doesn't change, command and preference
  descriptions (those are `pref-description-length` and the command copy rules), and a description
  in another language for an extension that targets that locale.
- **Start from Raycast's rewrite.** When the published description came from #33590, adopt it
  through the mirror sync and edit from there; never revert it to an older local copy.

- **Audit:** judgment `store-description` (report). The mechanical parts (length, closing period,
  filler, platform) are `rx preflight` `store-description` (WARN) since rx 0.2.0; the rest is the
  judgment.

### `[both]` (conditional) Prefer `@chrismessina/raycast-kit` for failure toasts and count copy

**ID:** `kit` · **Applies:** self-authored, already being changed

**Condition — all three must hold:**

1. The extension is **self-authored** (`package.json` `author: chrismessina`), AND
2. it is **already being changed** for some other reason, AND
3. it has failure handling (a `Toast.Style.Failure`, a `showFailureToast`, or a data hook —
   `usePromise` / `useCachedPromise` / `useFetch` — whose rejection shows the default failure
   toast), an `instanceof Error` unwrap ternary, count-bearing copy, or a hand-rolled byte formatter
   (`bytes / 1024`, `toFixed(1) + " MB"` — the kit's `bytes` subpath replaces it; floor and tsconfig
   requirement in `dep-gates.md`).

**Build obligation — failure toasts.** In a self-authored extension, new or touched failure-toast
code uses `showError`, `failToast` or `onErrorToast` from `@chrismessina/raycast-kit@^0.3.0`,
including the failures a data hook produces. Existing toasts you are not touching need not be
converted, and the count-copy, unwrap and byte-formatting helpers stay a preference bundled with
substantive work. `develop` applies this at write time; `ship`'s audit only reports it (*Audit
posture* below).

**Never on a fork you do not own** — a personal dependency, the same call as the logger. **Never
as a standalone change**: swapping a helper is not worth a Store reviewer's time on its own.

**Audit posture — REPORT, never block.** The hard gate stays on the *underlying* rules
(`copy-error`, `catch-unwrap`, `plural-copy`): a failure toast without a Copy-Error action fails
the audit whether or not the kit is involved, and hand-rolling the compliant block is correct.
What fails is a missing copy action, not a missing dependency. At ship time, missing kit adoption
stays report-only; during development, the build obligation above governs new or touched
failure-toast code.

**The mapping:**

```ts
import { showError, failToast, onErrorToast, getErrorMessage, countOf } from "@chrismessina/raycast-kit";

// A fresh failure toast — carries Copy Error itself, redacted.
await showError(error, { title: "Failed to Load" });

// A progress toast flipped to failure IN PLACE — showError creates a NEW toast, so these
// sites need failToast. They are the majority of real failure paths.
const toast = await showToast({ style: Toast.Style.Animated, title: "Exporting…" });
try { await work(); toast.style = Toast.Style.Success; }
catch (error) { failToast(toast, error, { title: "Export Failed" }); }

// A data hook — failureToastOptions receives no error argument; its default toast offers
// Retry plus Copy Logs or Report Error, never Copy Error.
useCachedPromise(load, [id], { onError: onErrorToast({ title: "Couldn't Load Funding" }) });

// Raw server/protocol text stays out of the toast: short message, raw text as `cause`.
throw new Error("Cosign didn't provide a valid response.", { cause: rpcError.message });

// Count copy — user-facing copy always passes `zero`, per `plural-copy`.
countOf(n, "item", { zero: "No items" }) // "No items" · "1 item" · "7 items"
countOf(n, "item")                       // "0 items" — numeric zero; internal/among-other-counts only
```

`showError` swallows `AbortError` by default (a user typing the next keystroke cancels the
in-flight request); pass `ignoreAbort: false` where you do want it surfaced. `getErrorMessage`
renders the fleet's real error shapes that the bare ternary turns into `"[object Object]"`, which
is why `catch-unwrap` accepts it.

**Decide the entry point per MODULE, not per file type.** `@raycast/api` ships types only (the
host injects it), so the kit's root export is **unloadable in plain Node**. The pure helpers have
subpaths — `/errors` (`getErrorMessage`, `isAbortError`, `redactSecrets`), `/plural` (`countOf`,
`plural`), `/bytes` (`formatBytes`, `formatSpeed`) — and **a subpath import needs
`"module": "Node16"` + `"moduleResolution": "Node16"`** in `tsconfig.json`; the scaffold default
(node10) ignores `exports` maps and fails with TS2307. Migrate the tsconfig *before* adopting a
subpath.

| Module | Import from |
|---|---|
| UI layer — components, actions, anything already importing `@raycast/api` | root |
| Pure logic — parsers, formatters, index/cache readers, tests, scripts | the subpath |

The trap is a production module that happens to be headlessly testable: importing the root into it
still compiles and builds, and fails only when run outside Raycast, as
`Cannot find module '@raycast/api'`.

- **Audit:** judgment; note non-adoption as an opportunity and move on.
- **Evidence:** adoption history, the error-shape validation, the TS2307/TS5095 resolver repro and
  the `claude-artifacts` headless-fixture receipt:
  [`raycast-kit-adoption-and-subpath-resolution`](../learnings/tooling-decisions/raycast-kit-adoption-and-subpath-resolution.md);
  what belongs in the kit at all, with the 2026-07-25 census:
  [`deciding-whether-to-extract-a-shared-package`](../learnings/tooling-decisions/deciding-whether-to-extract-a-shared-package.md).

---

## Files and exports

### `[both]` Show a file with `Action.ShowInFinder` / `showInFinder()`, never `open(path, "Finder")`

**ID:** `show-in-finder` · **Applies:** all

`open(path, "Finder")` means "open this file **with** the Finder application". It is not the
show-in-Finder API and does not reliably select the file in its containing folder. The correct
primitives are `Action.ShowInFinder` (inside an `ActionPanel`) and `showInFinder(path)` (in a toast
action or plain handler). The **component** supplies the right default title and icon; the
**utility** takes only a path — you own the surrounding title/icon there.

**Also watch the inverse:** a label promising Finder while the handler calls bare `open(filePath)`,
which opens the file in its default app and never involves Finder. The label is the spec.

- **Audit:** `open(` with `"Finder"` as its second argument.
- **Evidence:** 2026-08-07, `raycast-fetch` — two action panels labeled "Reveal in Finder" were
  opening the file with Finder rather than revealing it.

#### Wording: "Show in Finder" — and on `Action.ShowInFinder`, pass no `title` at all

Raycast's term is **Show**, not Reveal or Open — in action titles, error copy, and any
user-visible string. But the stronger rule is that the title carries the platform:

```
title?: string;
@defaultValue `"Show in Finder"` on macOS and … on Windows   ← the Windows half MOVES
icon?:  @defaultValue Icon.Finder on macOS and Icon.HardDrive on Windows
```

So **any** `title` that names the file manager on `<Action.ShowInFinder>` — including the
"correct" `"Show in Finder"` — hardcodes macOS wording onto Windows. Omit it and both platforms
are right for free, *and stay right across upgrades*: `ShowInFinderProps` documented
`"Show in Explorer"` in v1.104.23 and **`"File Explorer"`** in v2.0.3.

**The one exception: two `ShowInFinder` actions in the same resolved panel.** With no titles they
render as two identical rows that open different files. Give the one that needs telling apart a
title that names the **target**, not the file manager — `"Show Hook Log"`, not
`"Show Hook Log in Finder"` — and leave the other untitled. *(2026-09-23, `claude-artifacts`
doctor.)*

Hand-written titles (`toast.primaryAction`, a custom `<Action>`) get no such help. Where you must
hand-write one, **read the current default out of the installed types rather than copying a string
from this file**:

```bash
rg -A3 'defaultValue.*Show in Finder' node_modules/@raycast/api/types/index.d.ts
```

```ts
// macOS is stable; the Windows half is version-dependent — verify against the line above.
title: isMacOS ? "Show in Finder" : "File Explorer"   // v2.0.3 wording
```

Never `"Show in Folder"` — that has never been Raycast's string on either platform.

- **Audit:** `rg -n 'title[=:] *["`].*\b[Rr]eveal'` → any user-facing "Reveal" (it hides in "Reveal
  Index File" and "Could Not Reveal…"); `rg -U --pcre2 -n '<Action\.ShowInFinder\b(?:[^>]|=>)*?\btitle=' src`
  → every hit is a finding unless its panel holds a second `ShowInFinder` and the title names only
  the target; one naming Finder, Explorer, or Folder is always a finding. Internal identifiers
  (`revealOnComplete`, a `RevealInFinderAction` component) are not user-facing and do not block.
- **Evidence:** 2026-08-10 fleet audit — 8 user-facing strings across 4 self-authored extensions
  said "Reveal" or "Open in Finder"; `raycast-reader` emitted "Show in Folder"; every
  `Action.ShowInFinder` already omitted `title`, so the component was the only thing getting
  Windows right. **2026-08-20:** v2.0.3 renamed the Windows default ten days after this rule had
  recommended hand-writing it — evidence for the omit-`title` form over any literal.

### `[both]` A completed file export offers Show in Finder AND Copy Path, both with shortcuts

**ID:** `export-actions` · **Applies:** writes a file for the user

Writing a file and reporting only "Saved to Downloads" makes the user go find it. The success
toast is the only moment the path is in hand, so it carries both ways to act on it — and both get
a shortcut, because a toast action without one is reachable only by mouse before the toast expires.

```ts
const path = await downloadToFile(resource, format);
toast.style = Toast.Style.Success;
toast.title = `Saved ${basename(path)}`;   // the ACTUAL path — a collision fallback may have renamed it
toast.message = "in Downloads";
toast.primaryAction = {
  // Hand-written because a toast cannot use <Action.ShowInFinder>. Verify the Windows half
  // against the installed types — see the Show-in-Finder rule above.
  title: process.platform === "darwin" ? "Show in Finder" : "File Explorer",
  // Cross-platform extension, custom semantic (no Common member means "show in the file
  // manager"): name both platforms, per keyboard-conventions. Mac-only: a plain { cmd+o }.
  shortcut: { macOS: { modifiers: ["cmd"], key: "o" }, Windows: { modifiers: ["ctrl"], key: "o" } },
  onAction: () => showInFinder(path),
};
toast.secondaryAction = {
  title: "Copy Path",
  shortcut: Keyboard.Shortcut.Common.CopyPath,   // ⌘⌃C / alt shift C — platform-aware
  onAction: async (t) => {
    await Clipboard.copy(path);
    t.message = "Path copied to clipboard";
  },
};
```

Three requirements on the write itself, none of which the toast can paper over:

- **Never overwrite.** `writeFile(path, contents, { flag: "wx" })` fails with `EEXIST` rather than
  clobbering; catch that and try `name 2`, `name 3`, … the way the Finder does. A plain
  `existsSync` check races its own write.
- **`await mkdir(dir, { recursive: true })` first.** `~/Downloads` is not guaranteed to exist.
- **Failures follow the Copy-Error rule**, like every other failure toast.

- **Audit:** `rg -n 'writeFile' src/` → each hit needs the `wx` flag, a preceding `mkdir`, and a
  success toast whose Show in Finder and Copy Path actions **each set a `shortcut`**; every failure
  path in an export handler passes the Copy-Error pairing review.
- **Evidence:** 2026-09-08, `raycast-ios-apps` `use-export-favorites.ts` — a good toast (the source
  of this rule) paired with two hand-rolled failure toasts carrying no Copy Error and discarding the
  error to `console.error`; `raycast-digger` had the inverse (correct failures, `open()` on the
  directory instead of `showInFinder`). Brought up to this rule the same day; the one correction
  learned was to report `basename(actualPath)`, not the intended filename.
- **Exception — a downloader keeps Open File in place of Copy Path.** Chris, 2026-10-04, on
  `fetch`: *"stick with Show in Finder and Open File, since this extension is a downloader."* The
  exception covers `fetch`'s download toast only. An export (a file the extension *generated*)
  still carries Copy Path.

### `[both]` A CSV export neutralizes spreadsheet formulas, not just quotes

**ID:** `csv-formula-guard` · **Applies:** exports CSV

RFC 4180 quoting is about *parsing* and does nothing about *execution*. Excel, Sheets and Numbers
all evaluate a cell whose value begins `=`, `+`, `-`, `@`, or a leading tab or carriage return,
**quoted or not**. Any column fed by a remote API is an injection vector into the user's
spreadsheet: an App Store title of `=HYPERLINK("http://evil","click")` exports as a live formula.

Prefix the neutralizing apostrophe, which spreadsheets strip on display, in **one cell helper every
column routes through** — per-field escaping is how the next column added forgets:

```ts
function csvCell(value: string): string {
  // Leading whitespace is skipped first: import paths that trim it (Google Sheets does by
  // default) would otherwise expose the formula behind it.
  const neutralized = /^[\t\r]|^\s*[=+\-@]/.test(value) ? `'${value}` : value;
  return `"${neutralized.replace(/"/g, '""')}"`;
}
```

Non-string columns need `String(value)` at the call site, not a widened signature — a numeric
`price` that silently becomes `"undefined"` is the failure this catches. Apply it to the header row
too if any header ever becomes dynamic.

- **Audit — locate, then read.** A grep cannot tell a CSV writer from a file that only mentions
  `.csv`, and the compliant helper itself contains `.replace(/"/g, '""')`. Find the writers —
  `rg -n 'text/csv|\.csv[`"]|toCsv|csvCell' src` — and confirm **every cell, header included if
  dynamic, passes through one helper whose first step is the formula guard**
  (`/^[\t\r]|^\s*[=+\-@]/`). Tests pin it: `csvCell("=1+1")` starts with `"'=`, and
  `csvCell(" =1+1")` with `"' =`. The older first-character-only guard `/^[=+\-@\t\r]/` is a
  finding.
- **Evidence:** 2026-09-08, `raycast-ios-apps` `generateCSV` — correct quoting on `name` and
  `sellerName`, straight from the iTunes API, with nothing stopping a leading `=`. 2026-10-04,
  `fathom` #31922: Greptile found the guard then prescribed checked only the first character, so
  `" =1+1"` and `"\n=1+1"` passed.

---

## Actions, panels, and icons

### `[build]` An ActionPanel spanning two scopes is split into `ActionPanel.Section`

**ID:** `actionpanel-sections` · **Applies:** all

**For each resolved panel: section only if it has 5 or more direct actions spanning 2 or more
scopes.** A submenu counts as one. Title the item section with the item's display name; keep a
destructive action in the section of the thing it destroys.

**The section boundary is scope, not category** — not "reads vs writes", not "safe vs
destructive", but *what does this act on?*

1. **First section: the selected item.** Everything that reads, edits, copies, or deletes *this
   row*. **Title it with the item's own name** (`betaGroup.attributes.name`, the tester's display
   name, `Build 4`) — the panel then states its target instead of leaving the user to infer it. A
   display-name helper, never inline concatenation (the two renderings must agree).
2. **Following sections: the wider scope.** Actions on the collection or context — "Add New
   Tester", "Create Group". Usually untitled; title it only for a second, genuinely different scope.

```tsx
<ActionPanel>
  <ActionPanel.Section title={betaTesterDisplayName(tester)}>
    {copyAction(tester)}
    {removeTesterAction(tester)}   {/* destructive lives WITH what it destroys */}
  </ActionPanel.Section>
  <ActionPanel.Section>
    {addNewTesterAction()}
    {manageBuildsAction()}
  </ActionPanel.Section>
</ActionPanel>
```

**A single-scope panel is EXEMPT at any size.** Five actions that all act on the same item stay
flat — there is no second scope, and inventing one produces an empty or artificial section. This is
the common false positive; check condition 2 before flagging.

**"Resolved" means what the user actually sees**, for one concrete item, after conditionals
evaluate: a `{cond && <Action/>}` counts only in the branch where it renders (a panel judged per
state); a fragment counts as the actions inside it; an `ActionPanel.Submenu` counts as **one**.
Applies to `List.Item`/`Grid.Item`/`Detail` panels; a `Form`'s single submit action needs nothing.

**Sectioning changes shortcut adjacency — recheck resolved-panel collisions after** (`keyboard`,
`rx shortcuts check`). Adding `Common.New`/`Common.Remove` while sectioning is normal and is
exactly when a collision gets introduced.

Deliberately `[build]`, not `[both]`: whether two actions share a scope is a judgment no grep
decides. Receipts — the TestFlight panel, the trailing-space display name, and the per-row
shortcut rule:
[`actionpanel-sectioning-testflight-receipts`](../learnings/design-patterns/actionpanel-sectioning-testflight-receipts.md).

### `[both]` Audit the FIRST action of every ActionPanel state, not just the primary one

**ID:** `first-action` · **Applies:** all

Raycast binds Return to whatever action is first in an `ActionPanel`, per rendered state,
regardless of any explicit `shortcut` on it. So the question is never "did I assign the shortcuts
correctly" — it is **"for each state this view can render, what does Return do?"**

- A **destructive or irreversible** action (eject, delete, revoke, overwrite) must never be first
  in any state. Put a read-only action ahead of it.
- Every state must render **at least one** action. An empty `ActionPanel` is a dead end the user
  can only escape with Esc.
- Adding an action to one state does not audit the others: the branch you did not touch is where
  the defect lands.

- **Audit:** enumerate every branch that renders a different `ActionPanel` — loaded, empty, error,
  mid-scan, partial results — and for each one name the first action and what Return therefore
  triggers. *(Real: `raycast-ejection-seat` audited the shortcut slots in the blockers state — then
  in the "No Visible Blockers" state `Eject Volume` was first, so opening a clean volume and
  pressing Return ejected it.)*

### `[both]` Keyboard shortcuts follow `keyboard-conventions.md`

**ID:** `keyboard` · **Applies:** all

**The canonical rules live in [`keyboard-conventions.md`](./keyboard-conventions.md)** — the
precedence of sources, the semantic `Common` map, when a shortcut must name both platforms, the
conflict invariant over *resolved* panels, and the three `--fix` hazards (its section
"The three `--fix` hazards"). They are not restated here, so the two files cannot drift.

- **Audit:** `rx shortcuts check`: `shortcut-ambiguous` and `shortcut-reserved` must pass (needs
  `rx shortcuts runtime` once per installed Raycast version; `N/A` only when the extension declares
  no shortcuts); ESLint `no-ambiguous-shortcut` for the platform form. Judgment: the semantic map
  and the audit-fix transformation contract, as `keyboard-conventions.md` defines them.

### `[both]` Every `isShowingDetail` list carries a "Show Sidebar" / "Hide Sidebar" action

**ID:** `toggle-sidebar` · **Applies:** a list uses `isShowingDetail`

Any `List` that renders a detail pane (`isShowingDetail`) must let the user collapse it — a
permanently open sidebar crushes list titles into unreadable stubs (attio 2.0, notes view,
2026-09-01). The pattern, verbatim:

```tsx
const [showDetail, setShowDetail] = useCachedState<boolean>("show-detail-<view>", true);
// ...
<List isShowingDetail={items.length > 0 && showDetail} ...>
// in EVERY item's ActionPanel:
<Action
  title={showDetail ? "Hide Sidebar" : "Show Sidebar"}
  icon={Icon.AppWindowSidebarRight}
  shortcut={{ macOS: { modifiers: ["cmd", "shift"], key: "d" }, Windows: { modifiers: ["ctrl", "shift"], key: "d" } }}
  onAction={() => setShowDetail((v) => !v)}
/>
```

- **`useCachedState`, not `useState`** — the preference survives relaunch.
- **The title names what the action will do**: "Hide Sidebar" while it shows, "Show Sidebar"
  while hidden. Never "Toggle Sidebar". *(Chris, 2026-09-26, shipping Mercury.)* Shortcut exactly
  ⌘⇧D / Ctrl⇧D, platform-explicit (no `Common` constant covers it).
- **On every item's panel**, not just some.
- **With the sidebar showing, a row has about half the width: no wide accessories.** Tags, full
  dates and long text accessories truncate the title to a few characters. Move the value somewhere
  that costs no row width: a `List.Section` per value when it groups rows (a team, a year), or a
  shorter form that the section makes unambiguous ("May 28" under "2026"). When the sidebar is
  hidden there is room again, so the full form may come back (`showDetail ? short : full`).
  Reference: `FundingView` (year sections) and `JobsView` (team sections) in
  `https://github.com/chrismessina/raycast-cosign/blob/main/src/components/entities.tsx`.
  *(cosign, 2026-11-04: a colored team tag left "Business Devel…" beside "Education + Pro"; Chris:
  "the accessories are too wide w/ the sidebar visible.")*
- **Audit:** every `isShowingDetail` has a matching action titled `"Show Sidebar"` /
  `"Hide Sidebar"` (chosen from the flag) in the same view, and a `useCachedState`-backed flag in
  the `isShowingDetail` expression. A bare `isShowingDetail={true}`, a missing action, or a
  "Toggle Sidebar" title is a finding.

### `[build]` Prefer `updateCommandMetadata` to surface menu-bar status in the command list

**ID:** `menubar-metadata` · **Applies:** menu-bar commands

When a `menu-bar` command has a meaningful compact status, push it into the command's `subtitle`
with `updateCommandMetadata({ subtitle })` so the user sees it in the root search without opening
the menu. A *recommendation, not a mandate* — a menu-bar command with no meaningful one-line status
should not invent one. The opportunity (0 repos use this yet):
`raycast-tesla-energy/src/menu-bar-status.tsx` already computes a compact status string;
`raycast-luma/src/luma-menubar.tsx` likewise.

### `[both]` A fenced code block in `Detail` markdown carries a language tag

**ID:** `detail-code-lang` · **Applies:** renders code in `Detail`

Raycast's markdown renderer colors fenced code by language. An untagged fence renders as flat
monospace, which is the difference between a 17KB `apple-app-site-association` you can read and a
grey wall you cannot.

```ts
// Not: `# ${title}\n\n\`\`\`\n${body}\n\`\`\``
const language = inferLanguage(name, contentType);   // "json" | "xml" | "html" | ""
markdown = `# ${title}\n\n\`\`\`${language}\n${body}\n\`\`\``;
```

Derive the tag from the Content-Type first and the filename second; emit an empty string when
neither settles it, since a wrong tag colors the block as the wrong language.

**And size the fence to the body.** A fixed three backticks is closed early by any resource that
itself contains ```` ``` ````, after which the remainder renders as Markdown:

```ts
const longestRun = [...text.matchAll(/`+/g)].reduce((max, m) => Math.max(max, m[0].length), 0);
const fence = "`".repeat(Math.max(3, longestRun + 1));
```

- **Audit:** `rg -n '\\`\\`\\`' src/` → any fence built into a markdown string needs both a
  language slot and a computed length.
- **Evidence:** 2026-09-08, `raycast-digger` `ResourceDetailView` — every fetched well-known file
  rendered untagged; the fence-length half was found by adversarial review on the export path.

### `[both]` Empty-state assets are themed or vector

**ID:** `empty-state-assets` · **Applies:** bundles empty-state art

A single dark PNG/SVG empty-state asset renders as a dark slab on light theme. Either
`{ source: { light, dark } }` pairs or a plain `Icon`.

- **Audit:** `icon="empty/` and any bare string icon path for a missing themed twin.

### `[both]` A monochrome bundled icon needs a theme-aware treatment — a bare filename is invisible in one theme

**ID:** `monochrome-icon` · **Applies:** bundles a monochrome icon

**Scope: monochrome glyphs shipped as a single asset.** Referencing one by bare filename —
`icon="artifact_file.svg"` — renders it with **its own baked-in fill**, which Raycast does not
adjust for the active theme. A glyph authored dark reads fine in light mode and **disappears
against the dark background** (and vice versa). Two supported fixes; either satisfies this rule.

**1. Tint from the code side** (preferred for a single monochrome asset):

```tsx
const ARTIFACT_ICON: Image.ImageLike = {
  source: "artifact_file.svg",
  tintColor: Color.PrimaryText,   // theme-aware; tracks the row's title color
};
```

**2. Ship a themed source pair** — `Image.Source` accepts `{ light, dark }` directly, and Raycast
also picks up an implicit `foo@dark.png` sibling:

```tsx
const ICON: Image.ImageLike = { source: { light: "glyph-light.svg", dark: "glyph-dark.svg" } };
```

> **Not in a `List.EmptyView`.** *Observed on `raycast-osaurus`, 2026-09-26:* an EmptyView
> `icon={{ source: "logo.svg", tintColor: Color.SecondaryText }}` rendered **nothing**, and so did
> the same asset as a PNG. Fix 2 (`logo.svg` + `logo@dark.svg` with the gray baked in) worked.
> Where an asset icon will not render, reach for fix 2 first.

- **Which color, when tinting:** `Color.PrimaryText` for a glyph that should read like the row
  title; `Color.SecondaryText` for a de-emphasized accessory; a semantic `Color.*` where the icon
  carries status. **Prefer the enum over a raw hex** — `Color.Raw` and `Color.Dynamic` are
  supported, but the enum keeps one palette across the fleet and tracks Raycast's themes for free.
- **Do not count on `fill="currentColor"` in the SVG.** *Observed on `claude-artifacts`,
  2026-07-25:* switched to `currentColor` to fix dark mode, shipped, still invisible — the fix was
  `tintColor`. An observation, not an SDK law (Raycast's changelog records a `currentColor` fix,
  so behavior may differ by version); use one of the two mechanisms above and it does not matter.
- **Exempt:** full-color raster assets meant to keep their own colors, and `Icon.*` built-ins.
- **Not the same as `environment.appearance`** — that is for graphics you *render* yourself.
- **Audit:** `icon=` / `source:` with a bare `.svg`/`.png` string that has **neither** an adjacent
  `tintColor` **nor** a `{ light, dark }` source **nor** an `@dark` sibling in `assets/`, for a
  monochrome glyph. A green `ray lint` proves nothing here. **Check both themes before calling an
  icon done** — the defect needs the theme toggled.

### `[build]` Pin actions use the Tack icons; person avatars use the squircle mask

**ID:** `icon-choices` · **Applies:** all

- Pin/unpin actions use `Icon.Tack` / `Icon.TackDisabled` (the paired set) — never
  `Icon.Pin`/`Icon.PinDisabled` (Chris preference, attio 2026-09-01).
- Person avatars rendered as icons/accessories always carry `mask: Image.Mask.RoundedRectangle`
  (squircle) — bare circular/unmasked avatar rectangles are a finding (attio, 2026-09-02).

### `[both]` No agent-tool tags in shipped comments

**ID:** `no-tool-tags` · **Applies:** all

A comment prefix that a coding-agent plugin asks for (`ponytail:`, and any like it) is tooling
residue to a Store reviewer. Keep the explanation and drop the tag.

- **Audit:** `rg -n '//\s*ponytail:|/\*\s*ponytail:' src`. Zero hits. *(2026-09-27, mercury
  #31611: a Raycast reviewer flagged three `// ponytail:` notes.)*

---

## Copy

### `[both]` US English everywhere — UI copy, comments, docs, identifiers

**ID:** `us-english` · **Applies:** all

Every word this fleet ships is **US English**. Not just user-visible strings: comments,
docstrings, CHANGELOG entries, AGENTS.md, commit messages, PR descriptions, and identifiers too.

<!-- us-english-ok:start — the definition of the check: word list, regex, and its discussion -->
catalog (not catalogue) · behavior · color · recognize · normalize · serialize · optimize ·
analyze · honor · labeled · canceled · cancelable · center · defense · license (noun and verb) ·
artifact · while (not whilst) · afterward (not afterwards)

**Audit — two halves.** Tracked files, before shipping; it must print nothing:

```bash
git grep -niP '\b(un|mis|re)?(catalogue|parenthesis(ed|ing)|behaviour|colour|recognis[a-z]*|normalis[a-z]*|serialis[a-z]*|analyse[sd]?|honour[a-z]*|labell(ed|ing)|cancell(ed|ing|able)|centre|defence|artefacts?|whilst|afterwards|organis[a-z]*|summaris[a-z]*|stabilis[a-z]*|customis[a-z]*|prioritis[a-z]*|utilis[a-z]*|minimis[a-z]*|maximis[a-z]*|optimis(e|ed|es|ing|ation)|canonicalis[a-z]*|licence)\b' -- . ':!package-lock.json' ':!**/fixtures/**'
```

**`-P`, never `-E`.** Apple's `git grep -E` has no `\b`: it treats the boundary as unmatchable, so
the audit prints nothing and reads as a pass. Measured 2026-10-04 on `fetch` (Apple Git 2.54):
`-E` 0 hits, `-P` 44, on a tree full of `Cancelled`.

Exclude any other path that holds external data verbatim. Commit messages and PR descriptions are
not files, so the second half is `[build]`: read them before you push.

Word boundaries and explicit endings matter: `PercentRef` matches a loose `centre`, `optimistic` is
correct US English, and **`cancellation` keeps its double L** in US English while `canceled` /
`canceling` / `cancelable` take one.
<!-- us-english-ok:end -->

Two carve-outs, both narrow: **external data keeps its own spelling** (a CVE summary, an upstream
package description, a quoted API field), and **`@raycast/api`'s own names are whatever Raycast
called them**.

**Why it is a hard rule and not a preference.** Chris has asked for this more than once, and the
last time in capitals: *"PLEASE STOP USING BRITISH ENGLISH EVERYWHERE!! YOU MUST WRITE US ENGLISH
ACROSS THE ENTIRE FLEET."* (2026-09-21, brew). It drifts in silently because no gate checks
spelling — `tsc`, `ray lint` and Prettier are all blind to it — and a model writing careful prose
reaches for British forms unprompted. On brew it reached 34 files, including copy already shipped
to the Store.

### `[both]` Empty/error state copy: short title, one-line description, steps in the actions

**ID:** `empty-state-copy` · **Applies:** all

`List.EmptyView` (and `Toast`) copy follows one shape: an icon, a short imperative title, and a
**single-sentence** description. Multi-step guidance goes in the `actions`, not the description.

**Why it is a hard rule:** `List.EmptyView`'s `description` **collapses newlines** — a multi-line
string renders as one run-on line. *Observed behavior*, not a documented guarantee (the SDK types
say only `description: string`); the evidence is Chris's own note at
`https://github.com/chrismessina/raycast-airbuddy/blob/main/src/components/error-views.tsx#L43`.
Repro: render a `List.EmptyView` with `description={"line one\nline two"}`.

- **A thrown error's message IS toast copy.** Without a message override or a custom error
  handler, `useCachedPromise` / `usePromise` failure toasts and `showFailureToast(error)` display
  `Error.message`, and `toast.message = error.message` displays it directly, so an `Error` thrown in
  `lib/` code obeys this rule as if it were a toast literal: one short sentence a person can act on.
  Protocol or server text (`MCP error -32602: Output validation error: …`, a raw HTTP body) never
  goes in the message. Put it on the error as the standard `cause` —
  `throw new Error("Cosign didn't provide a valid response.", { cause: raw })` — and the kit
  (`showError` / `failToast` / `onErrorToast`, `^0.3.0`) copies it as `Caused by: …` under Copy
  Error, never in the toast. `failureToastOptions` receives no error argument, and the default hook
  toast offers Retry plus Copy Logs (development or private extensions) or Report Error (otherwise);
  both use the error's stack or message, and neither walks `cause`. So in a self-authored
  extension, new or touched hook failure handling passes `onError: onErrorToast({ title })` with a
  short concrete title. On a fork, keep the personal-dependency exemption and give the hook an
  `onError` that shows Copy Error with the extension's existing helpers.
  *(cosign, 2026-11-04: a rewrite produced "Cosign couldn't send this; the problem is on Cosign's
  side. Details: MCP error -32602: …", four lines in the toast. Chris: "That UI copy is still far
  too long… It should simply say 'Cosign didn't provide a valid response.'")*
- **Error `Detail` screens** use the heading form `` `# Error\n\n${message}` ``
  (`raycast-fathom/src/search-meetings.tsx:335`, `raycast-reader/src/views/ArticleReaderView.tsx:120`),
  where `message` is the `instanceof Error` string from `catch-unwrap`.
- **Audit:** (a) the newline half is mechanical — ESLint `no-multiline-emptyview-description`
  (`eslint-plugin-raycast-harness`) catches `List.EmptyView` / `Grid.EmptyView` / bare `EmptyView`
  and any local wrapper passed via `additionalComponents`, across `"…"`, `{"…"}` and template
  literals; it checks literal values and template quasis only, not variables or concatenations. The
  audit backstop for an extension without the plugin: any `EmptyView` `description` whose string
  literal contains an explicit `\n`. (b) judgment: any error `Detail` not using the `# Error`
  heading form; overall description *length*.
- **Why lint and not a shared `<EmptyView>` component** (decided 2026-07-25): a wrapper cannot stop
  anyone using `List.EmptyView` directly, `description: string` cannot express "contains no
  newline" in TypeScript, and normalizing at runtime would *hide* the defect rather than prevent
  it. A component layer would also drag React and JSX build surface into every consumer for 55
  call sites that are mostly domain-specific.

### `[build]` Toggle copy states the resulting direction (on/off), never a bare "Toggled"

**ID:** `toggle-copy` · **Applies:** all

When a command **toggles** a setting, the success copy says **which way it went** — the resulting
state — not merely that a toggle happened. "Toggled" (or a bare status adjective like "Not
Floating") makes the user open the app to find out what they just did.

- **State the result as on/off (or the equivalent named state):** `"Microphone Input On"` /
  `"Microphone Input Off"`, `"Desktop Widgets Floating: On"` / `"…: Off"`; a multi-value setting
  names the resulting value (`"Spatial Audio: Fixed"`). All real airbuddy toggle toasts
  (`raycast-airbuddy/src/toggle-*.ts`).
- **Read the real post-state when the API exposes it.** Prefer polling the readable property over
  assuming the direction from a locally tracked "was it on before" guess, which desyncs if the
  setting is changed from the app's own UI between calls.
- **When the direction is genuinely unknowable** (no readable property, no reliable local state),
  do **not** fabricate one — say so and point the user at where to confirm
  (`message: "Check <app> to confirm the current state."`). *(airbuddy's stopgap for
  `toggle desktop widgets` / `toggle audio input lock` before AirBuddy 913 added readable
  properties; once they existed, the toasts were upgraded to name the real state.)*
- **Audit:** `[build]` judgment — success-toast titles on `toggle-*` commands with a bare
  `"Toggled"` / `"… Toggled"` and no on/off or named result.

### `[both]` Count-bearing copy uses correct singular/plural agreement — never `item(s)`

**ID:** `plural-copy` · **Applies:** all

Any user-facing string that interpolates a count agrees grammatically with it across **all three**
cases: zero, one, and many. `"1 items"` and `"No devices found"` beside `"3 device found"` are
defects. The lazy escape hatches — `"${n} item(s)"`, always-plural `"${n} items"` — are prohibited
in copy the **user reads** (fine in `logger.*` debug output).

- **The shape:** three-way. Do not hand-inline the ternary five times — `countOf(n, "device")` in
  `@chrismessina/raycast-kit` (see `kit`) handles the irregulars the hand-rolled version got wrong
  (`match`→`matches`, `city`→`cities`, `person`→`people`, `series`→`series`) and thousands
  separators.
- **Zero has its own copy.** `"No devices found."` reads better than `"0 devices found."` and
  matches the `List.EmptyView` empty-state titles this fleet already writes.
- **The defects this closes (real fleet):** `raycast-craft/src/tools/add-collection-items.ts:63`
  renders `${input.items.length} item(s)`; `raycast-fathom/src/view-action-items.tsx:71` and
  `raycast-at-profile/src/history.tsx:188` render an unconditional `${n} items`.
- **Audit:** the greppable subset is what `ship` asserts (the rule is `[both]` for that reason):
  the literal `(s)` / `(es)` crutch, and `length}\s*<plural-noun>` templates with no adjacent
  `=== 1` guard. General agreement across a computed message stays a `[build]` judgment.

---

## Project, README, and changelog

### `[build]` Organize `src/` into role folders once a command file grows past ~150 lines

**ID:** `src-folders` · **Applies:** all

Every self-authored extension beyond a handful of files splits `src/` into a subset of these role
folders — the convention is which name means what:

- **`hooks/`** — React state hooks, each file/export prefixed `use*`.
- **`utils/`** — business logic / pure helpers. (Older repos used `lib/`; new work uses `utils/`.)
- **`types/`** — shared type declarations.
- **`components/`** — small reusable UI widgets.
- **`views/`** — full-screen sub-views (a whole `List`/`Detail` screen), distinct from `components/`.
- **`actions/`** — standalone `ActionPanel`/`Action` builders.

Evidence: `raycast-digger/src/{types,utils,components,hooks,actions}`,
`raycast-fathom/src/{tools,types,utils,components,hooks,actions,views}`. Do not invent parallel
names (`helpers/`, `lib/` in new work).

### `[verify]` Original extensions ship the social-badge preamble and `FUNDING.yml`

**ID:** `readme-preamble` · **Applies:** self-authored

**Going-forward standard, not a description of the fleet as it stands.** Apply it to anything new
and backfill on the next substantive touch; never impose it on a fork. Two artifacts:

1. **`README.md`** follows [`readme-template.md`](./readme-template.md) — **the single source of
   truth for the shape**, the substitution traps (`<repo>` vs `<slug>`), the `media/` image rule
   and the nav-anchor rule. Do not reproduce the markup here, and do not copy the shape from an
   existing standalone repo: most of the fleet predates the current template, and the retired
   three-badge form (`# Title` *above* a `<div>` of Follow/Stars/Store) is still visible in older
   repos.
2. **`.github/FUNDING.yml`** — every self-authored standalone repo carries it; all copies are
   byte-identical. Standalone-only (it never ships to the monorepo) and never a Store blocker.

> **The badge implies publication.** The Store badge deep-links to
> `raycast.com/chrismessina/<slug>`, which 404s until the extension is in the Store. Add the block
> **at publish time**, and when auditing, check the URL resolves rather than only that the block
> exists (`central-icon-system` carried the badge while its Store URL 404'd).

- **Audit:** for self-authored extensions, the preamble **and** `.github/FUNDING.yml` are present
  and the Store badge URL resolves; an unpublished extension is reported separately, not as a
  violation. Watch for `.github` in `.gitignore`, which silently prevents `FUNDING.yml` from ever
  being committed. README image destinations are `rx preflight`: `readme-assets`, `readme-links`.
- **Census 2026-08-10:** 25 self-authored extensions, 12 published; of those 12: 4 complete, 3 badge
  but no `FUNDING.yml`, 5 neither.

### `[both]` Never hand-invent a merge date — keep the `{PR_MERGE_DATE}` placeholder

**ID:** `merge-date-placeholder` · **Applies:** all

The newest, unreleased CHANGELOG entry keeps Raycast's literal `{PR_MERGE_DATE}` token; Raycast
substitutes the real date when the Store PR merges. Do **not** guess a date before merge. Entries
follow `## [<Title>] - {PR_MERGE_DATE}` under a `# <Name> Changelog` header; only the unreleased
entry carries the token, and exactly one entry carries it.

Tagged `[both]` and not `[verify]` because the entry is *written* during `develop`: as a
`[verify]`-only rule the placeholder got replaced with a real date at write time and nothing checked
it until `ship`, by which point Chris had already read the wrong date (2026-09-09). A rule about how
to write something is tagged for the skill that writes it.

- **Audit:** `rx preflight`: `changelog-placeholder` (exactly one token, on the top entry) and
  `changelog-order` (descending dates) must pass. `rx changelog` emits the same
  `changelog-placeholder` from the one shared predicate.

### `[both]` Changelog bullets are tweet-length and ordered by user benefit

**ID:** `changelog-bullets` · **Applies:** all

The CHANGELOG is read by two audiences who both skim: a Store reviewer deciding what changed, and a
user deciding whether to care. Neither reads a paragraph.

**Length: ~280 characters per bullet — tweet length.** If a bullet needs more, the rationale
belongs in the commit message. A bullet that runs long is usually carrying three things at once;
cut the mechanism and keep the outcome.

**Order by user benefit, not by diff size or chronology.** The headline capability first, behavior
changes to things that already worked next (a returning user needs to find those), dependency and
security bumps last.

**One bullet per change a user would notice.** A minor improvement does not earn its own line —
fold it into the bullet for the feature it belongs to. A CHANGELOG where every touched file gets a
bullet reads as a diff, not as release notes.

**Do name behavior changes explicitly.** A default action that moved, an action that disappeared
from a view, a renamed command — these stop a bug report from being filed. They go above the
dependency bumps, never omitted as noise.

- **Audit:** `rx changelog`: `changelog-bullets` — WARN for every bullet line over 280 characters
  **anywhere in the file**, shipped entries included (the scan is the whole CHANGELOG, not the
  newest entry; an old long bullet is noise to note, not a reason to edit published history). The
  numeric target alone never blocks — 300 for a bullet that genuinely needs it is fine, 390 is a
  bullet doing three jobs. `changelog-history` (dated history matches the published copy, except
  recorded privacy redactions) runs only when `rx changelog` is given `--published <dir>`; `ship`
  runs it explicitly as `node "<plugin>/scripts/rx.mjs" changelog --published "$PUBLISHED_DIR"` with
  `rx stale`'s `.data.publishedDir`. `rx gates` never runs `rx changelog` and forwards the published
  directory to `rx preflight` only, so no gates or preflight check is `changelog-history`; a bare
  `rx changelog` reports it `N/A`. The rx binding is **partial**:
  ordering by benefit and one bullet per noticeable change are judgment, recorded in the audit
  entry with the bullets read.

> **Be careful running Prettier on `CHANGELOG.md`.** It reformats whitespace inside headings that
> have **already shipped** — collapsing a double space after the dash — which puts unrelated churn
> in a diff that a Store reviewer reads as an edit to published history. `ray lint` does **not**
> require the changelog to be Prettier-clean, so reformatting it buys nothing. This is cosmetic,
> not dangerous: Raycast CI substitutes the literal `{PR_MERGE_DATE}` token and nothing else, so
> whitespace in an already-dated heading cannot cause a re-stamp — only reverting a dated heading
> *back to the placeholder* can. If Chris says normalize it, normalize it. Observed twice in one
> session (2026-08-27, brew #30598): `npx prettier --write CHANGELOG.md` rewrote
> `## [Bug fix] -  2026-05-21` to a single space, and `ray lint` stayed green both times — only
> `changelog-history` surfaces it.

**Evidence:** written 2026-08-27 after the `brew` analytics PR, where the first draft ran to nine
bullets — one of them 391 characters, another 326 — and spent a full bullet on a minor change Chris
flagged as not warranting its own line. Condensing to seven bullets ordered by benefit, with the
minor items folded in as clauses, is the shape this rule describes.

---

## Audit matrix

Generated by `rx preset table` from `presets/chrismessina.json`; edit the preset, not the table
(`rx preset table` in its `--check` mode fails when they differ). One row per non-`[build]` rule anchored in
this file, in the order the rules appear above. **Applies** is the preset's applicability
expression; **Severity** is what `rx audit record` enforces: a `block` failure stops the submission
and goes back to `develop`, a `report` failure is recorded and does not. **Binding** names the check
that produces the evidence — an `rx` check id, an ESLint rule, or a judgment the agent records.

**An audit must accept every compliant form.** A check that greps for the hand-written form of a
rule reports a regression on code that just adopted a helper encoding it — see
[`audit-coupled-to-the-hand-written-form-of-a-rule`](../learnings/workflow-issues/audit-coupled-to-the-hand-written-form-of-a-rule.md).

<!-- rx:matrix:start -->
| Rule | ID | Tag | Applies | Severity | Binding |
|---|---|---|---|---|---|
| `.prettierrc` is this exact file, in every self-authored extension | `prettierrc` | `both` | self-authored | **block** | rx `prettierrc` (partial); judgment `prettierrc` (partial) |
| Never hand-define `Preferences` or `Arguments` types | `no-hand-preferences` | `lint` | all | **report** | rx `hand-typed-preferences` |
| No `any` type casting | `no-any` | `lint` | all | **report** | judgment `no-any` |
| Unwrap unknown catch values with the `instanceof Error` ternary | `catch-unwrap` | `lint` | all | **report** | judgment `catch-unwrap` |
| Typecheck with `tsc --noEmit` — `ray lint` never typechecks, and a plain `ray build` does not either | `tsc-gate` | `both` | all | **block** | rx `tsc` |
| `eslint-plugin-react-hooks` with `rules-of-hooks: error` is present | `react-hooks-lint` | `verify` | self-authored | **report** | judgment `react-hooks-lint` |
| `madge --circular` runs as a `pretest` gate | `madge-cycles` | `verify` | self-authored | **report** | judgment `madge-cycles` |
| Disable the Impeccable design hook — it is irrelevant to Raycast extensions | `impeccable-off` | `both` | Impeccable plugin installed | **report** | judgment `impeccable-off` |
| An elapsed-time check uses `performance.now()`, never `Date.now()` | `monotonic-elapsed` | `both` | all | **block** | judgment `monotonic-elapsed` |
| A readiness gate tracks *did prep finish* and *which items succeeded* separately | `readiness-gate` | `both` | background prep drives `isLoading` | **block** | judgment `readiness-gate` |
| A cache version is DERIVED from the cached shape, never hand-maintained | `cache-version-derived` | `both` | persists a typed payload | **block** | judgment `cache-version-derived` |
| Interval-driven commands must branch on `environment.launchType` | `interval-launchtype` | `both` | a command declares `interval` | **block** | judgment `interval-launchtype` |
| Handle no-AI-access on every Raycast-AI call | `ai-access` | `both` | calls Raycast AI | **block** | judgment `ai-access` |
| `environment.supportPath` is for INTERNAL state only — user files go to a preference dir | `supportpath-internal` | `both` | writes files | **block** | judgment `supportpath-internal` |
| Read the active selection via the platform API, never a shell-out | `selection-api` | `verify` | reads the selection | **block** | judgment `selection-api` |
| `launchCommand` is awaited inside a try/catch with a failure toast | `launch-command-caught` | `both` | all | **block** | judgment `launch-command-caught` |
| Every failure toast carries a "Copy Error" action | `copy-error` | `both` | all | **block** | eslint `copy-error-pairing` (partial); judgment `copy-error` (partial) |
| In a `no-view` command, never `showHUD` before a toast that carries actions | `no-hud-before-actions` | `both` | a `no-view` command | **block** | judgment `no-hud-before-actions` |
| `Toast.Style.Animated` is a promise that work is in flight — never spin for a synchronous write | `animated-means-work` | `both` | all | **block** | judgment `animated-means-work` |
| A toast has no id — `hide()` and mutation act on whatever is on screen NOW | `toast-no-id` | `both` | all | **block** | eslint `no-toast-hide-in-cleanup` (partial); judgment `toast-no-id` (partial) |
| Toast copy never says "this window" — a toast is a detached HUD | `toast-window-copy` | `both` | all | **block** | judgment `toast-window-copy` |
| Structured logging via `@chrismessina/raycast-logger` | `logger` | `both` | self-authored, makes web requests | **block** | rx `logger` |
| The copy is fixed too — type this block verbatim | `logger-verbose-copy` | `both` | declares `verboseLogging` | **block** | rx `logger-verbose-copy` |
| Logger 1.5.0+: declare `strictRedaction` beside `verboseLogging` | `logger-strict-redaction` | `both` | self-authored, installed `@chrismessina/raycast-logger` ≥ 1.5.0 | **report** | rx `logger-strict-redaction` |
| Preference descriptions fit on one line — 80 characters or fewer | `pref-description-length` | `both` | all | **report** | rx `pref-description-length`; rx `pref-label-length` |
| The Store description leads with the action and the app people search for | `store-description` | `both` | the branch adds or changes `description` in `package.json` | **report** | rx `store-description` (partial); judgment `store-description` (partial) |
| Prefer `@chrismessina/raycast-kit` for failure toasts and count copy | `kit` | `both` | self-authored, already being changed | **report** | judgment `kit` |
| Show a file with `Action.ShowInFinder` / `showInFinder()`, never `open(path, "Finder")` | `show-in-finder` | `both` | all | **block** | judgment `show-in-finder` |
| A completed file export offers Show in Finder AND Copy Path, both with shortcuts | `export-actions` | `both` | writes a file for the user | **block** | judgment `export-actions` |
| A CSV export neutralizes spreadsheet formulas, not just quotes | `csv-formula-guard` | `both` | exports CSV | **block** | judgment `csv-formula-guard` |
| Audit the FIRST action of every ActionPanel state, not just the primary one | `first-action` | `both` | all | **block** | judgment `first-action` |
| Keyboard shortcuts follow `keyboard-conventions.md` | `keyboard` | `both` | all | **block** | eslint `no-ambiguous-shortcut` (partial); rx `shortcut-ambiguous` (partial); rx `shortcut-reserved` (partial) |
| Every `isShowingDetail` list carries a "Show Sidebar" / "Hide Sidebar" action | `toggle-sidebar` | `both` | a list uses `isShowingDetail` | **block** | judgment `toggle-sidebar` |
| A fenced code block in `Detail` markdown carries a language tag | `detail-code-lang` | `both` | renders code in `Detail` | **block** | judgment `detail-code-lang` |
| Empty-state assets are themed or vector | `empty-state-assets` | `both` | bundles empty-state art | **block** | judgment `empty-state-assets` |
| A monochrome bundled icon needs a theme-aware treatment — a bare filename is invisible in one theme | `monochrome-icon` | `both` | bundles a monochrome icon | **block** | judgment `monochrome-icon` |
| No agent-tool tags in shipped comments | `no-tool-tags` | `both` | all | **report** | judgment `no-tool-tags` |
| US English everywhere — UI copy, comments, docs, identifiers | `us-english` | `both` | all | **block** | judgment `us-english` |
| Empty/error state copy: short title, one-line description, steps in the actions | `empty-state-copy` | `both` | all | **block** | eslint `no-multiline-emptyview-description` (partial); judgment `empty-state-copy` (partial) |
| Count-bearing copy uses correct singular/plural agreement — never `item(s)` | `plural-copy` | `both` | all | **block** | judgment `plural-copy` |
| Original extensions ship the social-badge preamble and `FUNDING.yml` | `readme-preamble` | `verify` | self-authored | **report** | judgment `readme-preamble` |
| Never hand-invent a merge date — keep the `{PR_MERGE_DATE}` placeholder | `merge-date-placeholder` | `both` | all | **block** | rx `changelog-placeholder`; rx `changelog-order` (partial) |
| Changelog bullets are tweet-length and ordered by user benefit | `changelog-bullets` | `both` | all | **block** | rx `changelog-bullets` (partial) |
<!-- rx:matrix:end -->

---

## Still to enumerate

Candidates that showed up in a fleet audit (2026-07-23) but are **not yet rules** — either emerging
or too split to codify. Parked here so they are not re-discovered from scratch.

- **Conventional Commits** (`feat:`/`fix:`/`chore:`/…). Near-100% in recent repos (`airbuddy`
  40/40, `wrap-unwrap` 39/39) but **zero** in older ones. A habit adopted mid-2026, and a commit
  convention rather than extension house-style. Promote when it is the norm across a fresh audit.
- **Real unit-test suites** (`*.test.ts`). Only 4/21. Emerging; too sparse to mandate.
- **Explicit `throttle` on live-search `List`s.** Chris sets it deliberately where a command does
  per-keystroke remote fetching; many search commands omit it. A per-command correctness call.
- **Default icon filename `extension-icon.png`.** ~10/21 use it — a coin flip, not a convention.
- ~~**`@raycast/api` import ordering.**~~ **Promoted 2026-08-29** — see `prettierrc`.

**Rejected outright** (checked, no real pattern): `ActionPanel.Section` usage ratio;
`showFailureToast` vs manual Failure toast (already covered by `copy-error`);
`useCachedPromise`/`usePromise` vs manual loading state (even split);
`export default function Command()` naming (mixed).
