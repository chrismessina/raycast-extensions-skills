# House Style

Chris's personal conventions for every Raycast extension — the "third category": not a lifecycle *stage*, not a *throughline* constraint, but a standards checklist. Applied at **build time** by `develop` and audited at **pre-flight** by `ship`. Single source of truth, two consumers.

> **Living document.** Rules here are earned from Chris's actual fleet, not invented — each cites real fleet evidence: established adoption, a concrete defect it prevents, or a specific gap worth closing (a few are grounded in a gap rather than existing adoption, and say so). Append as new ones prove out; keep each tagged. Emerging-but-not-yet-established candidates are parked in [Still to enumerate](#still-to-enumerate) rather than promoted early.

## How to use this checklist

Every rule has a **tag** (who applies it), an **ID** (a stable name to cite and record results
against), and a scope line saying which extensions it **applies** to. "Self-authored" means
`package.json` `author` is you; a fork you contribute to is never changed to match your style.

- **`[build]`** — apply while writing. Judgment calls and patterns no audit can check after the
  fact. `develop` only.
- **`[verify]`** — checkable presence or absence; `ship` asserts it.
- **`[both]`** — applied while writing *and* asserted by `ship`.
- **`[lint]`** — belongs in ESLint; the audit is only the backstop for extensions that don't
  carry the lint rule yet.

`develop`'s **house-style audit fix** applies `[build]`, `[both]`, and `[lint]` rules to existing
code. `ship`'s **house-style audit** is read-only: it walks the [audit matrix](#audit-matrix),
runs each applicable rule's **Audit**, and records a result per ID. Anything that needs code goes
back to `develop`.

### Why these rules don't live in Prettier

A recurring question: can these be enforced via `.prettierrc` for determinism?
Mostly **no** — the layers don't overlap:

- **Prettier** only reshapes what it can derive from the AST with no notion of
  *meaning*: quotes, semicolons, width, indentation, trailing commas. **Zero**
  house-style rules are pure formatting.
- **ESLint** is where semantic rules belong — "no `any`", "no hand-defined
  `Preferences`", the `instanceof Error` ternary. That's what the `[lint]` tag means:
  the rule's durable home is a lint rule, and the audit is only the backstop for forks
  that don't carry it yet. The fleet's `@raycast/eslint-config` is the shared base.
- **The house-style audit** (`develop`/`ship`) covers the rest — relationships Prettier
  and off-the-shelf ESLint can't see (Copy-Error toast pairing, `canAccess(AI)` gating,
  `supportPath`-is-internal).

---

## Tooling and gates

Formatting, lint, type, and build gates, and the environment they run in.

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

The first two keys are the Raycast-scaffold standard. The last two add deterministic
import ordering — Node builtins, then third-party, then `@raycast/*`, then relative.

**`@ianvs/prettier-plugin-sort-imports` must be in `devDependencies`** (`^4.7.0`) or
Prettier fails to load the plugin and every format run errors. Config and dependency
are a matched pair: never add one without the other.

**Promoted from opt-in to rule, 2026-08-29,** when a fleet census found most actively
maintained extensions already carried this exact config with the plugin declared, and none
carried one without the other.

- **Audit:** two halves. (a) If `.prettierrc` lists `@ianvs/prettier-plugin-sort-imports`,
  `package.json` `devDependencies` declares it, and the reverse — either half alone fails every
  format run. (b) If the extension has adopted the four-key form, it matches exactly:
  `jq -S . .prettierrc` equals `jq -S .` of the block above. A two-key file is not a failure
  here; it converts the next time the extension changes for another reason.

> **Self-authored extensions only.** Never add this to a fork you don't own.
> Sorting imports rewrites every file that has more than one import block, burying your
> actual change in an unrelated reformat and making the Store PR unreviewable. Same
> reasoning as the `@chrismessina/raycast-kit` rule below. Check `author` in
> `package.json` before touching `.prettierrc`.

An extension still on the plain two-key config gets the change the next time it is being
changed for another reason (`[build]`). A standalone reformat PR is noise.

### `[lint]` Never hand-define `Preferences` or `Arguments` types

**ID:** `no-hand-preferences` · **Applies:** all

Rely on Raycast's **auto-generated ambient types** from `package.json` (commands + preferences). Use:

```ts
const preferences = getPreferenceValues<Preferences>();
```

…where `Preferences` is the *generated* ambient type — never a locally-declared `interface Preferences` / `interface Arguments`, and never a hand-rolled type param passed to `getPreferenceValues()`.

- **Durable home:** ESLint rule (custom or config).
- **Audit backstop:** grep for a local `interface Preferences|Arguments` declaration, or a `getPreferenceValues<LocalType>()` where `LocalType` is defined in-file.

### `[lint]` No `any` type casting

**ID:** `no-any` · **Applies:** all

No `as any`, no `: any`.

- **Durable home:** `@typescript-eslint/no-explicit-any` in the shared config.
- **Audit backstop:** grep `\bas any\b` / `:\s*any\b` for un-linted forks.

### `[lint]` Unwrap unknown catch values with the `instanceof Error` ternary

**ID:** `catch-unwrap` · **Applies:** all

A `catch` value is `unknown`. Stringify it with the exact guard — never touch
`error.message` unguarded, and don't spin up a **one-off, in-repo** `getErrorMessage` helper:

```ts
const errorMessage = error instanceof Error ? error.message : String(error);
```

**Exemption — the shared kit.** `getErrorMessage` from `@chrismessina/raycast-kit`
satisfies this rule and is *preferred* wherever the kit is already a dependency: it is
strictly better than the ternary (see the kit section below for the fleet error shapes
the bare ternary renders as `"[object Object]"`). The prohibition is on hand-rolling a
*local* helper per repo, not on the one shared implementation. Use the literal ternary
only where the kit is not available.

This is Chris's standard across the fleet (17 of 21 self-authored extensions —
e.g. `raycast-digger/src/hooks/useFetchSite.ts:42`,
`raycast-ios-apps/src/ipatool.ts:328`). It pairs directly with the Copy-Error
toast below, whose `errorMessage` is produced this way.

- **Durable home:** ESLint (`@typescript-eslint/no-unsafe-member-access` catches the
  unguarded `.message`; a custom rule can enforce the exact ternary).
- **Audit backstop:** grep `catch (` blocks that reference `.message` without an
  accompanying `instanceof Error`.

### `[both]` Typecheck with `tsc --noEmit` — `ray lint` never typechecks, and a plain `ray build` does not either

**ID:** `tsc-gate` · **Applies:** all

`ray lint` (ESLint) **skips types entirely**, and a default `ray build` (esbuild)
**strips them without checking** — type errors compile and lint clean, then fail
in editors and for external reviewers running `tsc`.

> **Correction, 2026-09-17.** The blanket claim that "`ray build` does NOT
> typecheck" is false for `ray build -e dist`, which many extensions use as their
> `build` script. The installed `@raycast/api` runs a typecheck when
> `environment === "dist"` and prints `checked TypeScript` in its output — verified
> by reading `node_modules/@raycast/api/dist/commands/build/index.js`. Run
> `tsc --noEmit` anyway: it is the gate reviewers run, it does not depend on which
> environment the repo's script happens to pass, and it is the one that fails
> loudly and on its own. Do not tell a contributor their build proves nothing when
> their build output literally says it checked.

- **Always run `npx tsc --noEmit` as the real type gate** before claiming a change
  is done, alongside build + lint. Treat a non-zero `tsc` exit as a failure even if
  `ray build` succeeded.
- Common trap: a Raycast hook with multiple overloads (e.g. `usePromise` /
  `useCachedPromise`) silently resolving to the **paginated** overload, inferring
  `data` as `any[]`. Annotate the fetcher's return type
  (`(q: string): Promise<YcResult<T>> => …`) to pin the intended overload.
- TS does **not** carry an early-return narrowing into nested closures: after
  `if (!x) return`, a `const`-captured `string | null` is still `string | null`
  inside a later `async function`. Re-bind to a typed const (`const v: string = x`)
  rather than reaching for `as` / `!`.

- **Audit:** `npx tsc --noEmit` exits 0 from the extension root (not a parent — see `extension-root`).

### `[verify]` `eslint-plugin-react-hooks` with `rules-of-hooks: error` is present

**ID:** `react-hooks-lint` · **Applies:** self-authored

`@raycast/eslint-config` carries NO react-hooks rules, so a hook placed below a
guard's early return (`if (g) return g;` then a `useMemo`) lints clean and crashes at
runtime ("Rendered more hooks than during the previous render" — attio Tasks,
2026-09-02). Every self-authored extension's eslint config adds the plugin explicitly.

- **Audit:** the eslint config references `react-hooks/rules-of-hooks`. **Report, don't block:**
  as of 2026-09-23 only 1 of 35 extensions carries it, so add it the next time the extension
  is changed for another reason.

### `[verify]` `madge --circular` runs as a `pretest` gate

**ID:** `madge-cycles` · **Applies:** self-authored

`ray` bundles to CJS, where an import cycle silently evaluates one module's default
export as `undefined` — "Element type is invalid" at runtime, invisible to `tsc`
(attio: records↔objects cycle, latent for days, detonated when an unrelated import
changed evaluation order).

- **Audit:** `package.json` has `"check:cycles": "madge --circular --extensions ts,tsx src"`
  wired into `pretest`. **Report, don't block:** as of 2026-09-23 only 1 of 35 extensions carries
  it, so add it the next time the extension is changed for another reason.

### `[build]` Run every `ray`/`npm` command from the extension root, never a parent

**ID:** `extension-root` · **Applies:** all

`npm install`, `npm run dev`, `npm run publish`, and `npx ray develop|build|lint` resolve the
manifest by **walking up from your current directory to the nearest `package.json`** — not by
finding "the extension." Run one from the wrong place and you either get an npm-flavored error
that blames tooling instead of your path, or — worse — you silently operate on a *different*
package.

**Measured on this machine, 2026-07-24** (`raycast-wrap-unwrap`, git 2.50.1, npm/npx; `ray` is
*not* on `PATH` — extensions invoke it via `npx` or an npm script, so always write `npx ray …`):

| Where you run it | `npm run dev` | `npx ray lint` / `npx ray build` |
|---|---|---|
| Extension root | ✅ works (`ray develop` starts) | ✅ works, exit 0 |
| **Subdirectory** of the extension (e.g. `src/`) | ✅ works — npm walks *up* to the nearest `package.json` | ✅ works |
| Parent with **no** `package.json` above it | ❌ `npm error code ENOENT … path …/package.json` | ❌ `npm error could not determine executable to run` |
| Parent that **has** its own `package.json` | 🚨 **silently runs the PARENT's script, exit 0** | ❌ `could not determine executable to run` |

**The last row is the dangerous one, and it's why this rule exists.** npm does not resolve "the
extension" — it walks *upward* to the nearest ancestor `package.json` and uses whatever it finds.
Verified with a decoy `{"name":"PARENT-DECOY","scripts":{"dev":"echo RAN_PARENT_SCRIPT"}}` one
level up: `npm run dev` printed `RAN_PARENT_SCRIPT` and **exited 0 with no error at all.** So the
failure is not reliably a clean error — it can be the *wrong package* quietly running or
installing. This plugin's own source repo is exactly such an ancestor: a
`package.json` with `format` scripts and no extension in it.

When you *do* get an error, it **names npm and never Raycast** — nothing says "manifest" — so it
reads like a broken install and sends you debugging a dependency. (`npx ray …` is the more
confusing: "could not determine executable to run" sounds like `ray` isn't installed.)

**So never rely on an error to tell you you're in the wrong directory.** Resolve the root
explicitly (below) and `cd` there before running anything.

The extension root is the directory holding the `package.json` **that carries Raycast keys**
(`commands`, `title`, `icon`) — not merely any `package.json`. That distinction is the whole
rule, because the fleet has **two topologies** and only one of them puts the root at the repo root:

| Topology | Repo root | Extension root |
|---|---|---|
| Standalone repo (e.g. `chrismessina/raycast-<name>`) | = extension root | the repo root itself |
| Monorepo (`raycast/extensions`, incl. sparse checkouts and PR-review forks) | monorepo root | `extensions/<name>/` |

**The trap is the second row.** After a sparse checkout or a PR-review fetch you are sitting
in the monorepo root with exactly one extension materialized under `extensions/<name>/` — it
*feels* like the project root, and the error blames tooling instead of the path. This plugin's own
source-repo root is a third false root, and the worst kind: it has a
`package.json` (Prettier/format scripts only) with **no extension in it**, so npm's upward walk
finds it and runs *that* instead of erroring.

**Resolve the root explicitly before running anything** — don't infer it from where the shell
happens to be:

```bash
# Find the package.json holding a real Raycast `commands` ARRAY.
# Testing `.commands` alone is too loose — `{"commands":"anything-truthy"}` passes `jq -e`
# and would misidentify the root (verified 2026-07-24).
# Walk UP first, THEN search descendants: you are usually already *inside* the extension,
# and a bare `find .` only looks downward — from `myext/src/lib` it silently returns
# nothing (bug found and the fix verified against a disposable tree, 2026-08-10).
find_ext_root() {
  _is_ext() { jq -e '(.commands|type=="array") and (.commands|length>0)' "$1" >/dev/null 2>&1; }
  d=$PWD
  while [ "$d" != "/" ]; do
    if [ -f "$d/package.json" ] && _is_ext "$d/package.json"; then echo "$d"; return 0; fi
    d=$(dirname "$d")
  done
  find . -name package.json -not -path '*/node_modules/*' \
    -exec sh -c 'jq -e "(.commands|type==\"array\") and (.commands|length>0)" "$1" >/dev/null 2>&1 && dirname "$1"' _ {} \;
}
```

Ambiguous result (several matches) → ask which extension, don't guess. Then `cd` there and
stay there for the whole build/lint/dev cycle.

- **`develop`:** `cd` to the resolved root before the first command; keep the dev loop there.
- **`ship`:** every pre-flight gate (`tsc --noEmit`, `npm run build`, `npm run lint`) and
  `npm run publish` runs from that same root. A gate that "passed" from the wrong directory
  did not run.

### `[build]` A UI change is not done until the app has been LAUNCHED

**ID:** `launch-before-done` · **Applies:** all

`tsc` + build + lint + tests cannot see module-eval order, hook-order drift, cache
shape, or a dark asset on a light ground. After any wave of UI work, run the
extension (`npm run dev`) and open the changed commands before reporting — or say
plainly that rendered output is unverified and hand the eyes-only list over.

### `[both]` (conditional) Disable the Impeccable design hook — it is irrelevant to Raycast extensions

**ID:** `impeccable-off` · **Applies:** Impeccable plugin installed

The Impeccable **design detector hook** (`/impeccable hooks`) scans edited files for
rendered-UI defects — broken `<img>`, contrast, gradient text, glow shadows, layout
rhythm. **A Raycast extension has no rendered HTML/CSS surface** — the UI is declared
entirely through `@raycast/api` components (`List`, `ActionPanel`, `Detail`), which the
detector cannot see. So every finding it produces on extension code is a false positive.

The concrete failure (observed 2026-07-23, `reddit-search`): the detector read a
**server-side Atom-feed parser** — `decodeEntities(rawContent).match(/<img[^>]+src="…"/)`,
a regex that *extracts* image URLs from feed HTML, plus a JSDoc mentioning `<img>` — as a
"broken image" and re-fired the `broken-image` finding on **every `Stop` event**, turning
a shipped, correct extension into a per-turn nag.

**Condition:** only when the Impeccable plugin is installed; without it there is nothing to disable.

**Rule:** on first touch of any Raycast extension repo, disable the hook for that project:

```bash
node <impeccable-skill-dir>/scripts/hook-admin.mjs off   # writes hook.enabled:false to .impeccable/config.json
# (or) /impeccable hooks off
```

`.impeccable/config.json` is machine-local (gitignore it — it must not ship to the Store
PR). Do NOT reach for per-file/per-rule ignores here: the whole detector is out of scope
for this codebase, so `off` is the correct blunt instrument, not a scoped `ignore-value`.

- **`develop`:** run this once when you first edit an extension in a session and the hook
  is firing. It has no bearing on the code; silence it and move on.
- **`ship`:** ensure the hook is off (or its config gitignored) before the pre-flight, so
  a stray design finding can't masquerade as a house-style violation during the audit.

- **Audit:** if `.impeccable/` exists in the repo, `git check-ignore -q .impeccable/config.json` succeeds, so it can never ship.

---

## Runtime correctness

Every rule here is a defect class that shipped through a green `tsc` + `ray build` +
`ray lint` + full test suite, and was caught only by a human launching the app.

The `environment` rules follow the same principle: use what the platform already knows
instead of re-deriving it. Reference: <https://developers.raycast.com/api-reference/environment>.

### `[build]` `useCachedPromise` keying: the fn's TEXT is the namespace, args are the key

**ID:** `ucp-keying` · **Applies:** all

The persisted cache namespaces by `hash(fn.toString())` and keys by `hash(args)`.
Two consequences, both learned from live crashes:
- **A shared wrapper collapses namespaces.** Any hook that funnels different
  operations through one literal function (a `(...args) => fn(...args)` wrapper) MUST
  put an operation discriminator into the args, or equal-args calls overwrite each
  other's cached data (attio: Tasks rendered a cached members array).
- **A fn returning a fn IS the pagination contract.** `(deps) => async ({page}) =>`
  makes useCachedPromise treat results as page arrays — using that shape for a
  single-object fetch crashes on `.length`. Curried form only where a `pagination`
  object is actually passed to the `<List>`.

### `[both]` An elapsed-time check uses `performance.now()`, never `Date.now()`

**ID:** `monotonic-elapsed` · **Applies:** all

`Date.now()` is a wall clock: an NTP correction or a DST shift moves it backward, and
every duration measured across that jump goes negative. A cache-freshness window pins
itself open and serves stale data (fathom `transcriptTextFor`, 2026-09-19, caught in
review); a timeout never fires; a "how long has this run" guard reports a negative age
and takes the wrong branch. Reproduce it by stubbing `Date.now` an hour back — the
defect is deterministic, not a race.

`Date.now()` remains correct for a timestamp that is STORED and outlives the process
(a TTL on disk, an `updatedAt`): `performance.now()` is relative to process start and
is meaningless once written down. The test is whether the number is compared against
another reading from the same process run.

- **Audit:** `rg -n 'Date\.now\(\)' src` → read each hit. One subtracted from another reading taken in the same process run is a defect; a stored timestamp is not.

### `[both]` A readiness gate tracks *did prep finish* and *which items succeeded* separately

**ID:** `readiness-gate` · **Applies:** background prep drives `isLoading`

One boolean can't carry both, and conflating them fails in *both* directions:
- **Finish must resolve on every path — including `.catch`.** If a background task (WASM load, pre-render, prefetch) drives the spinner via `isLoading={… || !ready}`, the failure branch must still flip `ready`, or one non-critical failure wedges the whole view on a permanent spinner even though the UI is fully functional. Toast *and* dismiss — never just toast.
- **A single "ready" flag lies about per-item availability.** When the gate covers N independent items (pre-rendered files, prefetched rows), track the *set of items that actually succeeded* — not one flag flipped for all. Render/fetch each item independently (per-item `try/catch`, not a `Promise.all` that rejects on the first failure and abandons the rest), return the succeeded ids, and gate each item's action on membership. Flipping one `ready=true` on completion offers an action (Quick Look, open-file) on items whose file/row was never produced — pointing at something that doesn't exist. And the two paths must derive the identical key (e.g. both `${id}-512.png`), or set-membership doesn't actually prove the target exists. (Cursors #29662: a flat `quickLookReady` boolean offered ⌘Y on cursors a first-failure `Promise.all` never rendered.)

- **Audit:** find loading gates fed by background work — `rg -n 'isLoading=\{[^}]*(ready|Ready)' src` —
  and read each: the failure branch must resolve the gate, and any per-item action must be gated
  on that item's success, not on the shared flag.

### `[both]` A cache version is DERIVED from the cached shape, never hand-maintained

**ID:** `cache-version-derived` · **Applies:** persists a typed payload

Any extension that persists a typed payload — `LocalStorage`, `Cache`, a JSON file — has a
version in its key so a shape change evicts stale entries. Hand-maintaining that version
fails, and it fails silently: an entry written under the old shape simply lacks the new
field, and an optional field's absence is indistinguishable from a real negative result.
`tsc`, `ray build` and `ray lint` all pass, because the code is correct — it is the *data*
that is from a previous era.

Compute the version instead:

```js
// scripts/cache-schema.mjs — run from prebuild/predev, checked by prelint
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import ts from "typescript";

// Reprint through the compiler: comments go, formatting is normalized, and string
// literals survive intact. A regex strip cuts `"https://a"` at the `//`.
function canonical(file) {
  const sf = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, false, ts.ScriptKind.TS);
  return ts.createPrinter({ removeComments: true }).printFile(sf);
}
const hash = createHash("sha256").update(canonical("src/types/index.ts")).digest("hex").slice(0, 10);
writeFileSync("src/utils/cacheSchema.ts", `export const CACHE_SCHEMA = "${hash}";\n`);
```

```json
"prebuild": "node scripts/cache-schema.mjs",
"predev":   "node scripts/cache-schema.mjs",
"prelint":  "node scripts/cache-schema.mjs --check"
```

```ts
KEY_PREFIX: `myext_cache_${CACHE_SCHEMA}_`,
```

- **Hash the transitive imports, not just the entry file.** A cached type almost always
  reaches a union or interface defined elsewhere; hashing one file lets a rename there keep
  the old key, and the stale value then misses the new lookup and throws at render.
- **Never strip comments with a regex.** It truncates `type Url = "https://a.example"` at the
  `//`, so two different URLs hash identically — the exact failure the mechanism exists to
  prevent. The compiler printer above is verified against that case, comment and whitespace
  changes, and JSDoc: formatting-only edits keep the hash, real shape changes move it.
- **Keep a hand-bumped salt beside the hash.** A semantic correction with an unchanged
  shape — a classifier that now returns "unavailable" where it returned "absent" — moves no
  type and therefore no hash. One deliberate step for the case no derivation can see.
- **Know what the hooks do NOT cover.** npm lifecycle scripts fire for `npm run build`, not
  for `npx ray build`, which is what Raycast Store CI runs; and `predev` runs once, so a
  `ray develop` hot reload keeps the old fingerprint. The gate that protects users is the
  pre-commit lint, not the build.
- **Over-invalidating is the safe direction.** Hash the whole types file rather than
  computing reachability from the cached root: a needless eviction costs one refetch,
  a missed one costs a false claim rendered as fact for the whole TTL.
- **Commit the generated file** and gate it in `prelint`, so a stale fingerprint fails the
  build rather than shipping.
- **Belt and braces at the point of use.** Where a merge or a render can encounter an old
  record, prefer the value that is actually populated over the one that merely arrived
  first. That fixes the class independently of the storage layer having been correct.

**The general rule this is an instance of:** when edit A is only correct if someone also
makes unrelated edit B, that pair is a latent defect no matter how well it is documented —
a checklist item is just one more chance to forget. Derive B from A, or make the
inconsistent state unrepresentable where it is consumed.

- **Audit:** `rg -n 'KEY_PREFIX|CACHE_VERSION|schemaVersion' src/` → any hand-typed
  version literal beside a persisted typed payload.
- **Evidence:** 2026-09-09, `raycast-digger` — `DiggerResult` gained `wellKnown`, then
  `theme`, then `ThemeColor.hex`; the key bump was forgotten all three times. Each
  produced a section confidently reporting an absence it had never established ("None
  published", "No theme declared", a grid of colorless swatches), served from cache for
  48h. The third instance also survived a cache bump by winning a merge, which is why the
  point-of-use rule is listed above and not just the derivation.

### `[both]` Interval-driven commands must branch on `environment.launchType`

**ID:** `interval-launchtype` · **Applies:** a command declares `interval`

A command with an `interval` (a scheduled background refresh — this is what causes
background ticks; `"mode": "menu-bar"` alone does **not**) runs both on user open
**and** on the scheduled background wake. Guard user-facing side effects
(`showToast`, `showHUD`, error UI) behind `environment.launchType`, so a failed
background refresh (e.g. an expired OAuth token) logs quietly instead of firing the
same toast path as a manual open:

```ts
if (environment.launchType === LaunchType.Background) {
  // log only — no toasts, no HUD
}
```

- **The gap:** `raycast-tesla-energy/src/menu-bar-status.tsx` and
  `raycast-luma/src/luma-menubar.tsx` (both interval-driven) don't guard their
  fetch/error UI against background invocation. *(Note: `LaunchType` is imported in
  7 repos but only ever passed **outbound** to `launchCommand()` — no repo yet reads
  its own `environment.launchType`. This is the blank spot to close.)*

- **Audit:** `jq -r '.commands[] | select(.interval) | .name' package.json` lists the interval commands; each one's source reads `environment.launchType` before any `showToast` / `showHUD`.

### `[both]` Handle no-AI-access on every Raycast-AI call

**ID:** `ai-access` · **Applies:** calls Raycast AI

Any code path that calls `AI.ask` / `useAI` must **degrade gracefully** for a user
without Raycast AI access (non-Pro, or AI disabled) — never let it surface as an
unhandled failure. Two acceptable ways:
- **Gate ahead of time** with `environment.canAccess(AI)` and branch to a non-AI
  fallback (preferred when there's a real fallback to show).
- **Catch the thrown no-access error** around the AI call and fall back there.

Either is fine; an *ungated, uncaught* AI call is the defect.

- **Right (copy this):** `raycast-reader/src/hooks/useArticleReader.ts:84` —
  `const canAccessAI = environment.canAccess(AI);` then
  `const shouldShowSummary = canAccessAI && preferences.enableAISummary;`, reused
  before `rewriteArticleTitle` (~:263).
- **The gap this rule closes:** `raycast-sora/src/utils/videoNaming.ts:44` calls
  `useAI(...)` unconditionally; a user without AI access gets a failure instead of
  the truncated-title fallback `getVideoDisplayTitle()` already provides.
- Same pattern applies to any capability behind `canAccess` (e.g.
  `BrowserExtension` — `raycast-memory-store/src/lib/background.ts:25`).
- **Audit:** the failure mode here is a **green check on a real violation**, so the pattern
  has to be tight. A literal `useAI (` / `useAI(` grep misses `useAI  (`, a renamed import
  (`import { useAI as ask }`), and property access (`AI["ask"]`). Match
  `\b(useAI|AI\s*\.\s*ask|AI\s*\[\s*["']ask["']\s*\])\s*\(` **and** resolve aliases by
  first grepping the `@raycast/api` import specifiers in each file for `useAI`/`AI`.
  For each hit assert **either** a `canAccess(AI)` guard **or** an enclosing try/catch on
  that path. AST detection (`ts-morph`/`typescript` compiler API) is the airtight version if
  this ever produces a miss in practice.

### `[both]` `environment.supportPath` is for INTERNAL state only — user files go to a preference dir

**ID:** `supportpath-internal` · **Applies:** writes files

`supportPath`'s *parent* is not a list of installed extensions — Raycast creates an
extension's folder there only on first run. See [`read-installed-raycast-extensions-from-config-not-application-support`](../learnings/design-patterns/read-installed-raycast-extensions-from-config-not-application-support.md).

`supportPath` is the writable per-extension directory — the right home for caches,
indexes, and command state the user never opens by hand. (Not `assetsPath`, which points
at the extension's *bundled* assets — that directory is part of the installed bundle and
gets replaced on every update, so anything you write there is lost. The SDK does not
document it as filesystem-read-only; the reason to avoid it is durability, not permissions.)
Anything the user is meant to **find in Finder** (exports, downloads, generated
deliverables) must go to a user-visible directory — an
`exportDirectory`/`downloadDirectory` preference defaulting to `~/Downloads`.

- **Right:** `raycast-fathom/src/utils/export.ts:36` reads
  `preferences.exportDirectory` for vCard/member exports.
- **The gap:** `raycast-fathom/src/actions/TeamMemberActions.tsx:22` writes a
  user-facing JSON export to `path.join(environment.supportPath, "downloads")` —
  buried in `~/Library/Application Support/…` where no one will find it. Route it
  through the same `exportDirectory` preference.
- **Audit:** flag `environment.supportPath` used to build a path that is then
  revealed/opened for the user, or handed to `Action.ShowInFinder`.

### `[verify]` Read the active selection via the platform API, never a shell-out

**ID:** `selection-api` · **Applies:** reads the selection

Use the platform functions to read a selection — never an `osascript`/`open`-based
shell-out:
- `getSelectedText()` — highlighted text in the frontmost app.
- `getSelectedFinderItems()` — selected files, **Finder-specific**: it rejects if
  Finder isn't the frontmost app, so always `await` it in a try/catch (or use it as a
  guarded fallback, as the fleet does).

Already **universal** in the fleet (no shell-outs found): `getSelectedText` in 5
repos (`digger`, `google-maps`, `reader`, `trimmy`, `wrap-unwrap`),
`getSelectedFinderItems` in 2 (`at-profile/src/yaml-settings.ts:282`,
`trimmy/src/trim-core.ts:91`, both macOS-guarded fallbacks). Codifying the winner so
a future extension doesn't regress to `osascript`.

- **Audit:** a bare `osascript`/`System Events` grep is **too broad** — it fires on
  AppleScript/JXA used for unrelated automation (`get-app-icon` opens Finder's Info
  window; `airbuddy` drives its own JXA), neither of which reads a selection. Narrow to
  scripts that actually read one: match `osascript`/JXA **co-occurring** with a selection
  term (`selection of`, `selected items`, `get selection`, `selectedText`, `sel of`), then
  eyeball the hits. Prefer the API in every case that survives.

> **Underused — reach for these on the next fitting extension.** These have little
> or no current adoption and **no** live defect, so they are not rules — but Chris's
> own read is that the `environment` toolkit is under-embraced, so treat them as
> first-choice options when the situation fits:
> - **`environment.appearance`** (`"dark"`/`"light"`) — used in exactly one place
>   (`tesla-energy`'s SVG chart, `view-solar-production.tsx:95`). The pattern to reuse
>   whenever an extension renders **custom graphics** (SVG/canvas) whose colors must
>   track the theme. (Component `tintColor`s should still use the theme-safe `Color.*`
>   enum, not this.)
> - **`environment.textSize`** (`"medium"`/`"large"`) — 0 repos. A natural first try
>   on a long-form `Detail`/Markdown extension like `reader`.
> - **`environment.isDevelopment`** — 0 repos. Gate dev-only debug UI behind it
>   (today debug output is gated on the `verboseLogging` preference instead — fine,
>   but `isDevelopment` is the idiomatic switch for *dev-only* affordances).

---

## Toasts, errors, and logging

### `[both]` Every failure toast carries a "Copy Error" action

**ID:** `copy-error` · **Applies:** all

> **What gets copied is disclosed.** An error string can carry a token, a signed URL, or a
> server's echo of the request. Read [`error-display-is-a-credential-disclosure-surface`](../learnings/security-issues/error-display-is-a-credential-disclosure-surface.md)
> before copying or displaying a raw server error.

Every failure toast offers **Copy Error**, which copies the error message to the clipboard —
however the toast is made. There are three paths, and only the last is compliant by default:

| Path | Compliant when |
|---|---|
| `showToast({ style: Toast.Style.Failure, … })`, or `toast.style = Toast.Style.Failure` | it sets a `primaryAction` titled `"Copy Error"` (canonical form below) |
| `showFailureToast(error, { title })` from `@raycast/utils` | it passes `primaryAction` titled `"Copy Error"`. **Its default action is not Copy Error:** it attaches **Report Error** (opens a GitHub issue on a published extension) or **Copy Logs** (in development or a private extension). Passing `primaryAction` moves that default to the secondary slot, so the user gets both. |
| `showError` / `failToast` from `@chrismessina/raycast-kit` | always — the kit attaches Copy Error itself |

- **Audit — a per-call-site pairing review, not a count.** List every failure site, then read
  each one: `rg -n 'Toast\.Style\.Failure|showFailureToast\(' src`. Each hit must set a
  Copy Error `primaryAction` in the same call or on the same toast. `showError(` / `failToast(`
  sites comply without one. A global count of `"Copy Error"` strings proves nothing — one
  compliant toast can mask ten that are not.
- **Canonical form:**

```ts
catch (error) {
  logger.error("Token generation failed", error);
  const errorMessage = error instanceof Error ? error.message : String(error);
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

With `@raycast/utils`, pass the action explicitly:

```ts
await showFailureToast(error, {
  title: "Failed to generate token",
  primaryAction: { title: "Copy Error", onAction: () => Clipboard.copy(error instanceof Error ? error.message : String(error)) },
});
```

### `[both]` In a `no-view` command, never `showHUD` before a toast that carries actions

**ID:** `no-hud-before-actions` · **Applies:** a `no-view` command

The Copy-Error rule above is silently defeated in `no-view` commands by a single earlier `showHUD`. Three pieces of documented behavior compose into a trap:

1. `showHUD` **closes the main Raycast window** — its stated purpose, not a side effect.
2. `showToast` **degrades when the window is closed.** Raycast's docs describe that fallback inconsistently — `showHUD()` in one place, a system notification in another — but both are non-interactive, so the distinction doesn't change the outcome.
3. Neither fallback renders actions, so `primaryAction` / `secondaryAction` are **dropped**.

The code reads correct — the actions sit right there in the `showToast` call — and they never render. Nothing in the type system, the linter, or a diff review catches it. **Only a human running the command sees it.**

- **HUDs cannot carry actions at all.** `showHUD(title, options)` accepts only `clearRootSearch` and `popToRootType`. There is no action parameter, so "add an action to the HUD" is never the fix — the fix is to stop using a HUD.
- **If a `no-view` command offers any action on completion** — Show in Finder, Open, Copy Error, Retry — use a **Toast for the whole flow**: animated toast up front, mutate `message`/`title` for progress, terminal toast at the end. No `showHUD` anywhere in that command's path, *including inside shared `lib/` helpers it calls* — that is where it hides.
- **HUD stays correct** for instant, action-free confirmations: "Copied", "Pinned", "Moved to Trash".
- **Accept the trade-off:** a Toast keeps the Raycast window open where a HUD dismisses it. That is the price of interactivity; there is no third option that both closes the window and offers an action.

```ts
// no-view command, canonical shape
const toast = await showToast({ style: Toast.Style.Animated, title: "Downloading", message: filename });

toast.message = `${filename} — ${percent}%`; // progress: mutate in place

// Terminal state. Mutating `toast.style` in place is equally supported (see the
// kit section below); what matters here is that the user ends up looking at a
// Toast rather than a HUD, so the action survives.
await toast.hide();
await showToast({
  style: Toast.Style.Success,
  title: "Download Complete",
  message: filename,
  primaryAction: { title: "Show in Finder", onAction: () => showInFinder(path) },
});
```

- **Audit:** for each command with `"mode": "no-view"` in `package.json`, walk its entry file **and the `lib/` helpers it imports**. Flag any `showHUD` in a command that also builds a toast carrying `primaryAction`/`secondaryAction`.
- **Evidence:** 2026-08-07, `raycast-fetch`. The single-download completion toast carried both "Open File" and "Reveal in Finder"; neither ever appeared, because the progress helper opened with `showHUD`. It survived a full code review, a house-style audit, and an adversarial Codex pass — Chris found it on the first real run. Converting the path to a Toast throughout fixed it, confirmed on screen.

### `[both]` `Toast.Style.Animated` is a promise that work is in flight — never spin for a synchronous write

**ID:** `animated-means-work` · **Applies:** all

An animated toast tells the user "wait, something is happening." If the operation is an instant `LocalStorage` write, a `setState`, or a `Clipboard.copy`, there is nothing to wait for: show the terminal Success toast directly, with no `Animated` phase at all.

- **Reserve `Animated` for genuinely async work** — network requests, disk IO, spawned processes, anything with a plausible wait.
- **For genuinely async work, both terminal patterns are supported.** Mutate in place (`toast.style = Toast.Style.Success`, or `failToast` for the failure half — see the kit section below), or `await toast.hide()` then show a fresh toast. Pick either; they are equivalent **for a simple sequential flow, where nothing else can reach the toast slot in between.** The moment the toast is held across an await that can be superseded, aborted, or raced by another toast, neither is safe as written — see the no-id rule immediately below.
- **Audit:** grep `Toast.Style.Animated`. For each, confirm genuinely async work is awaited between creation and the terminal state. Flag any whose only intervening work is `LocalStorage` / `setState` / `Clipboard`.

**Evidence, and a correction worth recording.** 2026-07-27, `raycast-claude`: Chris screenshotted "Preset saved!" beside a still-spinning icon. The first diagnosis was *"mutating `toast.style` on a presented toast never swaps the animated icon"* and it was written down as a general law. **That claim is false** — Raycast's SDK documents live mutation as the supported pattern, and it demonstrably worked at other sites in that same codebase. The actual defect was that **15 of the 17 sites were instant `LocalStorage` writes that should never have had a spinner**. The fix was deleting the `Animated` phase, not changing how the terminal state is set. If you see the old claim resurface anywhere, this entry supersedes it.

### `[both]` A toast has no id — `hide()` and mutation act on whatever is on screen NOW

**ID:** `toast-no-id` · **Applies:** all

A `Toast` handle reads like a reference to a specific toast. It is not: there is
one toast slot, `showToast` replaces whatever occupies it, and `hide()` /
property mutation act on whatever is visible *now*. Every bug below comes from
code written as if the handle had identity.

**None of this is in the API docs**, which is why the rule exists. [Toast][t]
documents `hide()` as `() => Promise<void>` and says nothing about identity,
about one-at-a-time, or about rejection; [showFailureToast][f] says nothing about
aborts or about replacing a visible toast. Keep the provenance straight when you
apply this:

- **Verified in the installed `@raycast/utils` source** (`dist/module.js`) — the
  only reliable answer to any hook-ordering question: `usePromise` suppresses
  `onError` for an `AbortError`, and it supersedes a run by aborting it, swapping
  the controller and invoking the next run **without awaiting the old one's
  settlement**.
- **Repo convention, not platform behavior** — a wrapper that short-circuits on
  `AbortError` (e.g. `showBrewFailureToast`). Check the extension you are in;
  Raycast's own `showFailureToast` makes no such promise, and if yours does not
  ignore aborts then rule 2 below is already handled for you.
- **Inference, treated as cheap insurance** — that `hide()` may reject. The type
  permits it and the implementation is not inspectable, so treat it as
  best-effort rather than proving it either way.

[t]: https://developers.raycast.com/api-reference/feedback/toast
[f]: https://developers.raycast.com/utilities/functions/showfailuretoast

**Four rules for any animated toast held across an `await`:**

1. **Never hide after a genuine failure.** The failure toast has already taken the
   slot; hiding dismisses *it* and the user loses the error entirely. Let the
   replacement stand — `showToast` needs no `hide()` first.
2. **Do hide on an abort.** `usePromise` suppresses `onError` for an `AbortError`,
   so unless your failure path is reached some other way, nothing replaces your
   toast and it spins forever after the user has walked away. (If the extension's
   failure helper also short-circuits on aborts, as `brew`'s does, that closes the
   last route to a replacement.)
3. **Guard on ownership, not just on timing.** `usePromise` supersedes a run by
   aborting it, swapping the controller and invoking the next run **without
   awaiting the old one's settlement**. Run N's deferred hide therefore lands after
   run N+1 has shown its own toast and dismisses N+1's. Take a per-run token
   (`const mine = ++runRef.current`) and hide only while `runRef.current === mine`.
4. **Never `await` the hide into the work promise.** `hide()` returns a promise,
   and a rejection awaited inside the fetcher turns a *successful* operation into a
   visible failure. Fire and forget with a logged `.catch()` — the same call costs
   nothing and removes the question.

**Put the toast inside the promise, not in a `useEffect` keyed on `isLoading`.**
The effect-with-cleanup shape is the most inviting way to write this and it is
wrong by construction: the cleanup is deferred, so it fires exactly when the slot
has moved on.

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

- **Audit:** grep `Toast.Style.Animated` and every `.hide()`. For each, ask: can a
  second toast reach the slot between creation and hide? Flag any `hide()` in a
  `useEffect` cleanup, any hide on a failure path, any `await …hide()` inside a
  fetcher, and any hide with no ownership guard.
- **Evidence:** 2026-09-17, `brew` #31164 — three passes to get one toast right.
  v1 hid in an effect cleanup and would have dismissed the failure toast raised
  microseconds earlier, swallowing the error. v2 fixed that but left the toast
  spinning on abort, because the failure helper ignores `AbortError`. v3 fixed
  that and introduced the supersession race in rule 3. Each version was correct
  about the case in front of it and blind to the next. **What ended it was reading
  the installed `@raycast/utils` source** (`dist/module.js`) for the actual
  abort/revalidate ordering — the API surface does not tell you, and reasoning
  about it from the outside produced three wrong answers in a row. Go to the
  installed source first for any question about hook ordering or lifecycle.

### `[both]` Toast copy never says "this window" — a toast is a detached HUD

**ID:** `toast-window-copy` · **Applies:** all

A toast does not belong to a window. It renders as a floating pill with no frame,
no title bar, and nothing around it the phrase could refer to — so copy that says
"keep this window open", "close this window", or "in another window" points at
something the user cannot see.

- **Say the app, or say the fact.** `"keep Raycast open"` is the instruction a user
  can act on. When the distinction is really between two *command instances* — which
  the user has no name for and does not think about — drop the noun entirely and state
  the fact: `"This recording is already downloading."` beats `"…is being downloaded in
  another window."`
- **Why it slips in:** the phrase is written while reading code, where "the command's
  window" is the accurate mental model for the lifecycle being described. It survives
  `tsc`, `ray lint`, `ray build`, and a Codex review, because every one of those reads
  the string as an opaque literal. Only looking at the rendered toast catches it.
- **The doc comment is part of the rule.** When a toast's wording encodes a real
  lifecycle fact (here: the generation poll dies with the command, so dismissing really
  does stop it), the comment above it tends to restate the old wording. Update both, or
  the next reader restores the string to match the comment.
- **Audit:** `[both]` — grep toast literals for the noun and read each hit:
  ```bash
  grep -rnE '(message|title): "[^"]*window' src/
  ```
  Hits inside comments are fine; hits inside a user-facing string are the defect.
  *(fathom, 2026-09-16: `"… · keep this window open"` shipped to a HUD that has no
  window. Chris caught it on sight — "seeing the toast as a HUD makes 'keep this window
  open' not make sense." Two sibling strings had the same noun and had not been seen yet.)*

### `[both]` (conditional) Structured logging via `@chrismessina/raycast-logger`

**ID:** `logger` · **Applies:** self-authored, makes web requests

**Condition:** the extension makes web requests — `fetch`, `useFetch`, `axios`, `node-fetch`, Node's `http`/`https`, or a request package such as `@chrismessina/raycast-downloader` (the audit below has the exact pattern).

**If yes:** `@chrismessina/raycast-logger` must be a dependency and imported (the `logger` used in the Copy-Error pattern above). Does **not** apply to extensions with no network calls — the audit must check the condition first, or it mis-fires on offline extensions.

**Corollary — the debug preference name is fixed.** The logger reads
`getPreferenceValues().verboseLogging` internally, so an extension that adopts it
**must** expose a preference named **exactly `verboseLogging`**, type `checkbox`.
This is not a free naming choice — a differently-named toggle silently does nothing.

- **Audit:** first the condition —
  `rg -l '\bfetch\s*\(|axios|node-fetch|useFetch|@chrismessina/raycast-downloader|from "(node:)?https?"|from "(undici|got|ky)"' src`
  must list something, or the row is `n/a`. (A narrower pattern misses real clients: `raycast-fetch`
  requests through the downloader package and writes `fetch (` with a space.)
  Then: `@chrismessina/raycast-logger` is in `package.json` `dependencies`, `src` imports it,
  and `jq -e '(.preferences // [])[] | select(.name=="verboseLogging" and .type=="checkbox")' package.json`
  succeeds.

#### `[both]` The copy is fixed too — type this block verbatim

**ID:** `logger-verbose-copy` · **Applies:** the extension declares `verboseLogging`

Decided 2026-09-05. The `name` is what the logger reads; the three copy fields are what
the user reads, and they were fleet-wide drift: **3 different titles and 11 different
label/description pairs across 11 extensions**, for one toggle that does exactly one
thing everywhere. Raycast 2 renders `title` as the settings group heading, so an
extension with `title: "Verbose Logging"` puts a jargon term where every other row shows
plain language.

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

- **Do not reword it per extension.** "Enable detailed logging for debugging Tesla API
  calls" is not more helpful than the standard line; it is one more string to maintain and
  it makes the fleet look hand-assembled. If an extension genuinely needs to say something
  extra — that values are redacted, say — that belongs in its README, not the toggle.
- **`title` is a group heading, not a row label.** Several extensions had the label text in
  `title` and left `label` doing the work, which renders the toggle under a heading that
  repeats it.
- **Keep the trailing period on `description`, and none on `label`.** That is what the
  rendered UI looks right with; mixed punctuation across rows is visible in Settings.
- The description says *console*, not *Raycast console* or *logs* — it is accurate for
  `ray develop` and for the packaged extension both.

**Audit:**

```bash
jq -r '(.preferences // [])[] | select(.name=="verboseLogging")
  | if (.title=="Debug Logging"
        and .label=="Enable extra diagnostics in the console"
        and .description=="Show detailed logs in the console for debugging.")
    then "ok" else "DRIFT: \(.title) / \(.label) / \(.description)" end' package.json
```

#### `[both]` Logger 1.5.0+: declare `strictRedaction` beside `verboseLogging`

**ID:** `logger-strict-redaction` · **Applies:** self-authored, installed logger 1.5.0+

`@chrismessina/raycast-logger` **1.5.0** reads a second preference, `strictRedaction`. Standard
redaction masks values by *name* (`password`, `token`, `?access_token=`); strict also masks every
URL query string and fragment, which catches a secret under an unremarkable name (`?sid=…`). The
logger reads it per call, and the user's setting wins over the extension's configured level.

It is **optional in the Raycast sense** — `"required": false`, default off — so a user never sees
it unless they open the extension's settings, and nothing about ordinary logging changes. What
the extension gains is a switch the user can flip before pasting a log into an issue. Declare it
in every extension on logger 1.5.0+, next to `verboseLogging`, verbatim from the logger's README:

```json
{
  "name": "strictRedaction",
  "type": "checkbox",
  "required": false,
  "title": "Strict Redaction",
  "label": "Also hide URL query strings and fragments in logs",
  "description": "Enable before reproducing an issue, then share only the lines written afterward. Masks every URL query string and fragment, including values that automatic redaction cannot recognize by name. Does not change lines already in the console.",
  "default": false
}
```

- **Audit:** an extension whose **installed** logger is 1.5.0+
  (`npm ls @chrismessina/raycast-logger`; a caret range like `^1.2.2` admits 1.5.0 without
  installing it) declares `strictRedaction`; `jq -r '(.preferences // [])[] | select(.name=="strictRedaction") | .title' package.json`
  prints `Strict Redaction`. **Report, don't block** on an extension still pinned below 1.5.0 —
  bumping the logger is its own change.
- **Why not in code instead:** `new Logger({ enableRedaction: "strict" })` is always strict,
  and a query string is often the thing being diagnosed. The person who knows a log is about to
  leave the machine is the user, so the user holds the switch.

This is UI copy in `package.json`, so it ships — changing it is a Store PR. Fold it into
the next PR that touches the extension rather than opening one that changes three strings.
In an extension you do **not** author, leave it alone; the standard is Chris's house style,
not a fix to someone else's product.

### `[both]` (conditional) Prefer `@chrismessina/raycast-kit` for failure toasts and count copy

**ID:** `kit` · **Applies:** self-authored, already being changed

What belongs in the kit, and what does not, was decided in
[`deciding-whether-to-extract-a-shared-package`](../learnings/tooling-decisions/deciding-whether-to-extract-a-shared-package.md).

**Condition — all three must hold:**

1. The extension is **self-authored** (`package.json` `author: chrismessina`), AND
2. it is **already being changed** for some other reason, AND
3. it has a `Toast.Style.Failure`, an `instanceof Error` unwrap ternary, count-bearing copy, or a
   hand-rolled byte formatter (`bytes / 1024`, `toFixed(1) + " MB"` — the kit's `bytes` subpath
   replaces it; floor and tsconfig requirement in `dep-gates.md`).

**Never on a fork you don't own** — this is a personal dependency, the same call as the
logger. And **never as a standalone change**: sorting imports or swapping a helper is not
worth a Store reviewer's time on its own. Bundle it with substantive work or skip it.

**Why the rule exists.** Three other rules — `copy-error`, `catch-unwrap`, and
`plural-copy` — are enforced today by an agent
remembering to grep. The 2026-07-25 fleet audit measured what that's worth:

| Rule | Hand-written | Repos | Compliance |
|---|---|---|---|
| `Toast.Style.Failure` | 124 | 20 | — |
| …carrying a Copy-Error action | **26** | **9** | **~20%** |
| `instanceof Error ? …` ternary | 98 | 16 | — |
| Count-bearing copy | 34 | 11 | — |

`raycast-ios-apps` is the proof: **51 failure toasts, zero Copy-Error actions**, because it
calls `showFailureToast` from `@raycast/utils` 42 times — whose default action is Report Error
or Copy Logs, never Copy Error, unless you pass one.
The house-style rule and the ergonomic path point in opposite directions, and the ergonomic
path wins. A dependency inverts that: the compliant call becomes the shortest one.

**Status:** published — [`@chrismessina/raycast-kit`](https://www.npmjs.com/package/@chrismessina/raycast-kit)
**0.2.0** (first published 2026-07-25; floor `^0.2.0`, see `dep-gates.md`), zero runtime deps,
`@raycast/api` peer. First adoption: `get-app-icon`
(`c1de11b`), which converted 4 non-compliant failure toasts and deleted a duplicate
`pluralize`, net −22 lines.

**The mapping:**

```ts
import { showError, failToast, getErrorMessage, countOf } from "@chrismessina/raycast-kit";

// BEFORE — Copy-Error block hand-written (or, more often, omitted)
const errorMessage = error instanceof Error ? error.message : String(error);
await showToast({ style: Toast.Style.Failure, title: "Failed to Load", message: errorMessage,
  primaryAction: { title: "Copy Error", onAction: async () => { await Clipboard.copy(errorMessage); } } });
// AFTER — carries Copy Error itself
await showError(error, { title: "Failed to Load" });

// A progress toast flipped to failure IN PLACE — showError creates a NEW toast, so
// these sites need failToast. They're the majority of real failure paths, and were
// the ones missing a Copy-Error action (attaching it by hand costs six lines).
const toast = await showToast({ style: Toast.Style.Animated, title: "Exporting…" });
try { await work(); toast.style = Toast.Style.Success; }
catch (error) { failToast(toast, error, { title: "Export Failed" }); }

// BEFORE — says "1 items" at count 1
`${n} items`  /  `${n} item(s)`
// AFTER — user-facing copy always passes `zero`, per `plural-copy`
countOf(n, "item", { zero: "No items" }) // "No items" · "1 item" · "7 items"
countOf(n, "item")                       // "0 items" — numeric zero; internal/among-other-counts only
```

`showError` swallows `AbortError` by default — a user typing the next keystroke cancels the
in-flight request, and that was never a failure worth toasting. Pass `ignoreAbort: false`
where you do want it surfaced.

**`getErrorMessage` is strictly better than the ternary it replaces**, which is why the
`[lint]` ternary rule above stays satisfied by it. Validated against real fleet error shapes:
an `itunes-api`-style `{status, statusText}` object, a nested `{error:{message}}` JSON API
response, and a thrown plain object were all rendering **`"[object Object]"`** through the
bare ternary. 4 of 7 real shapes produce better copy.

**Pure-TS subpaths — decide the entry point per MODULE, not per file type.**
`@raycast/api` ships types only (no `main`; the host injects it at runtime), so the root
export — which pulls in `showError` → `toast.js` → `@raycast/api` — is **unloadable in plain
Node**. The pure helpers have standalone subpaths: `@chrismessina/raycast-kit/errors`
(`getErrorMessage`, `isAbortError`, `redactSecrets`), `@chrismessina/raycast-kit/plural`
(`countOf`, `plural`), and `@chrismessina/raycast-kit/bytes` (`formatBytes`, `formatSpeed`,
added in 0.2.0).

> 🚨 **A subpath import needs `moduleResolution: Node16` — the fleet default cannot read
> `exports` maps.** A scaffolded extension is `"module": "commonjs"` with no
> `moduleResolution`, which is node10: it resolves packages by walking files on disk and
> ignores the `exports` field entirely, so every subpath import fails to typecheck:
>
> ```
> error TS2307: Cannot find module '@chrismessina/raycast-kit/bytes' or its corresponding
>   type declarations.
>   There are types at '…/dist/bytes.d.ts', but this result could not be resolved under
>   your current 'moduleResolution' setting.
> ```
>
> **The fix is `"module": "Node16"` + `"moduleResolution": "Node16"`** (what `store-updates`
> and `fathom` already run — they are the two extensions using subpaths today, which is not a
> coincidence). Do **not** reach for `"bundler"`: it is rejected outright unless `module` is
> also `es2015`-or-later — `error TS5095` — so it is a bigger migration, not a smaller one.
>
> Verified on `threads` 2026-09-09: switching those two keys alone made every subpath resolve
> with `tsc --noEmit` exit 0, `ray build` exit 0, `ray lint` exit 0, and **zero source
> changes**. Migrate the tsconfig *before* adopting a subpath, not after — the failure looks
> like a missing package rather than a resolver setting, and the tempting workaround (import
> from the root instead) silently re-poisons a pure module with `@raycast/api`.

The rule is **not** "subpaths in tests, root everywhere else." It is:

| Module | Import from |
|---|---|
| UI layer — components, actions, anything already importing `@raycast/api` | root |
| Pure logic — parsers, formatters, index/cache readers, tests, scripts | the subpath |

**The trap is a production module that happens to be headlessly testable.** Importing the
root into one poisons it: the module still compiles and `ray build` still succeeds — esbuild
resolves `@raycast/api` fine — so **nothing fails until you run that module outside Raycast**,
and then it fails as `Cannot find module '@raycast/api'` with a stack naming `toast.js`. The
error never mentions the kit's export map, so it reads like a broken install rather than a
wrong entry point.

*(Receipt, `claude-artifacts` 2026-07-25 — an early kit adoption, hours after `get-app-icon`: a root import of
`getErrorMessage` into the index-parser module broke all 11 of its headless fixtures at once.
The first fix attempted was a hand-rolled local copy plus a comment claiming the kit "can't"
be used in pure modules — wrong, and the kit's README had documented the subpath all along.
Check the entry point before concluding the kit doesn't fit.)*

**Audit posture — REPORT, never block.** `ship`'s pre-flight notes non-adoption as an
opportunity and moves on. The hard gate stays on the *underlying* rules (a failure toast
without a Copy-Error action fails the audit whether or not the kit is involved) — hand-rolling
the compliant block is still perfectly correct. What fails is a missing copy action, not a
missing dependency.

**Out of scope, deliberately.** The same audit considered and **rejected** date, text, and
number helpers: eight `formatDate` implementations across the fleet had eight different
signatures (`string`, `number`, `Date|string`, `string+Period`, `string|undefined`) — a shared
name, not a shared behavior. `truncate` looked fleet-wide at 79 uses until 40 proved to be in
`digger` alone. Generic helpers belong in `@raycast/utils`, already imported by 19 of 24
extensions. Don't grow the kit past rules that would otherwise depend on memory.

---

## Files and exports

### `[both]` Show a file with `Action.ShowInFinder` / `showInFinder()`, never `open(path, "Finder")`

**ID:** `show-in-finder` · **Applies:** all

`open(path, "Finder")` means "open this file **with** the Finder application". It is not the show-in-Finder API and does not reliably select the file in its containing folder. The correct primitives are the built-in `Action.ShowInFinder` (inside an `ActionPanel`) and `showInFinder(path)` (in a toast action or plain handler). The **component** supplies the right default title and icon for free; the **utility** takes only a path and simply shows it — you own the surrounding title/icon there.

**Also watch the inverse:** a label promising Finder while the handler calls bare `open(filePath)`, which opens the file in its default app and never involves Finder. The label is the spec — make the call match it.

- **Audit:** grep `open(` with `"Finder"` as its second argument.
- **Evidence:** 2026-08-07, `raycast-fetch` — two action panels labeled "Reveal in Finder" were opening the file with Finder rather than revealing it.

#### Wording: "Show in Finder" — and on `Action.ShowInFinder`, pass no `title` at all

Raycast's term is **Show**, not Reveal or Open — in action titles, error copy, and any user-visible string. ("Reveal" is Finder's own menu wording, which is exactly why it keeps creeping in.) But the rule that matters is stronger than wording, because the title carries the platform:

```
title?: string;
@defaultValue `"Show in Finder"` on macOS and … on Windows   ← the Windows half MOVES
icon?:  @defaultValue Icon.Finder on macOS and Icon.HardDrive on Windows
```

So **any** `title` that names the file manager on `<Action.ShowInFinder>` — including the "correct" `"Show in Finder"` — hardcodes macOS wording onto Windows. Omit it and both platforms are right for free, *and stay right across upgrades*.

**The one exception: two `ShowInFinder` actions in the same resolved panel.** With no titles they render as two identical rows that open different files. Give the one that needs telling apart a title that names the **target** and not the file manager — `"Show Hook Log"`, not `"Show Hook Log in Finder"` — and leave the other untitled. *(2026-09-23, `claude-artifacts` doctor: the "show index" remedy and the hook-log action render in one panel.)*

> ⚠️ **The Windows string is not stable, which is the whole argument for omitting `title`.**
> `ShowInFinderProps` documented `"Show in Explorer"` in v1.104.23 and **`"File Explorer"`**
> in v2.0.3. Any extension that hand-wrote the v1 wording silently disagrees with Raycast
> the moment it upgrades. The component tracks the change; a literal never will.

Hand-written titles (`toast.primaryAction`, a custom `<Action>`) get no such help, so they carry a standing maintenance cost. Prefer routing through `Action.ShowInFinder` where an `ActionPanel` allows it. Where you genuinely must hand-write (a toast action), **read the current default out of the installed types rather than copying a string from this file**:

```bash
grep -A3 'defaultValue.*Show in Finder' node_modules/@raycast/api/types/index.d.ts
```

```ts
// macOS is stable; the Windows half is version-dependent — verify against the line above.
title: isMacOS ? "Show in Finder" : "File Explorer"   // v2.0.3 wording
```

Never `"Show in Folder"` — that has never been Raycast's string on either platform.

- **Audit:** `rg -n 'title[=:] *["`].*\b[Rr]eveal'` → any user-facing "Reveal" (not just "in Finder" — it hides in "Reveal Index File" and "Could Not Reveal…"); `rg -U --pcre2 -n '<Action\.ShowInFinder\b(?:[^>]|=>)*?\btitle=' src` → every hit is a finding unless its panel holds a second `ShowInFinder` and the title names only the target; one naming Finder, Explorer, or Folder is always a finding (the match stays inside one element, so a later action's `title` does not count; an attribute value containing a bare `>` would end it early). Internal identifiers (`revealOnComplete`, a `RevealInFinderAction` component) are not user-facing and don't block.
- **Evidence:** 2026-08-10 fleet audit — 8 user-facing strings across 4 self-authored extensions said "Reveal" or "Open in Finder"; `raycast-reader` branched on platform but emitted "Show in Folder". Every `Action.ShowInFinder` already omitted `title`, so the component was the only thing getting Windows right. Two `raycast-fathom` toasts labeled "Open in Finder" called bare `open(filePath)` — the file opened in its default app and Finder never appeared. **2026-08-20:** v2.0.3 renamed the Windows default from "Show in Explorer" to "File Explorer", invalidating the hand-written wording this rule had recommended ten days earlier — evidence for the omit-`title` form over any literal.

### `[both]` A completed file export offers Show in Finder AND Copy Path, both with shortcuts

**ID:** `export-actions` · **Applies:** writes a file for the user

Writing a file and reporting only "Saved to Downloads" makes the user go find it. The
success toast is the only moment the path is in hand, so it carries both ways to act on
it — and both get a shortcut, because a toast action without one is reachable only by
mouse before the toast expires.

```ts
const path = await downloadToFile(resource, format);
toast.style = Toast.Style.Success;
toast.title = `Saved ${basename(path)}`;
toast.message = "in Downloads";
toast.primaryAction = {
  // Hand-written because a toast cannot use <Action.ShowInFinder>, which would
  // supply the per-platform title for free. Verify the Windows half against the
  // installed types — see the Show-in-Finder rule above.
  title: process.platform === "darwin" ? "Show in Finder" : "File Explorer",
  shortcut: { modifiers: ["cmd"], key: "o" },
  onAction: () => showInFinder(path),
};
toast.secondaryAction = {
  title: "Copy Path",
  shortcut: { modifiers: ["cmd"], key: "c" },
  onAction: async (t) => {
    await Clipboard.copy(path);
    t.message = "Path copied to clipboard";
  },
};
```

Three further requirements on the write itself, none of which the toast can paper over:

- **Never overwrite.** `writeFile(path, contents, { flag: "wx" })` fails with `EEXIST`
  rather than clobbering; catch that and try `name 2`, `name 3`, … the way the Finder
  does. A plain `existsSync` check races its own write.
- **`await mkdir(dir, { recursive: true })` first.** `~/Downloads` is not guaranteed to
  exist, and without this every export on such a machine fails with a bare `ENOENT`.
- **Failures follow the Copy-Error rule above**, like every other failure toast. An export
  that fails with a generic message and the real error dropped into `console.error` is one
  the user cannot report.

- **Audit:** `rg -n 'writeFile' src/` → each hit needs the `wx` flag, a preceding `mkdir`,
  and a success toast whose Show in Finder and Copy Path actions **each set a `shortcut`**; every failure path in an export handler passes the
  Copy-Error pairing review.
- **Evidence:** 2026-09-08, `raycast-ios-apps` `use-export-favorites.ts` — a good
  Show-in-Finder + Copy-Path toast (the source of this rule) paired with two hand-rolled
  failure toasts carrying no Copy Error and discarding the error to `console.error`.
  `raycast-digger` had the inverse: correct failure handling, but `open()` on the
  containing directory instead of `showInFinder`, so the user landed in Downloads and had
  to hunt for the file. **`use-export-favorites.ts` was brought up to this rule the same
  day** (`showFailureToast` on both paths, `mkdir` + `wx` with Finder-style `name 2`
  fallback); the toast that inspired the rule is unchanged. One correction learned in that
  pass: the success toast must report `basename(actualPath)`, not the filename it *intended*
  to write — with a collision fallback in place those differ, and the toast would otherwise
  reveal a file that does not exist.

### `[both]` A CSV export neutralizes spreadsheet formulas, not just quotes

**ID:** `csv-formula-guard` · **Applies:** exports CSV

RFC 4180 quoting — wrap in `"`, double the embedded `"` — is about *parsing*, and it does
nothing about *execution*. Excel, Sheets and Numbers all evaluate a cell whose value begins
`=`, `+`, `-`, `@`, or a leading tab or carriage return, **quoted or not**. Any column fed by
a remote API is therefore an injection vector into the user's spreadsheet: an App Store title
of `=HYPERLINK("http://evil","click")` exports as a live formula.

Prefix the standard neutralising apostrophe, which spreadsheets strip on display, and do it in
**one cell helper every column routes through** — per-field escaping is how the next column
added forgets:

```ts
function csvCell(value: string): string {
  const neutralized = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return `"${neutralized.replace(/"/g, '""')}"`;
}
```

Non-string columns need `String(value)` at the call site, not a widened signature — a numeric
`price` that silently becomes `"undefined"` is the failure this catches. Apply it to the header
row too if any header ever becomes dynamic.

- **Audit — locate, then read.** A grep cannot tell a CSV writer from a file that only
  mentions `.csv` (a MIME table, a filename list), and the compliant helper itself contains
  `.replace(/"/g, '""')`, so both would be false findings. Find the writers —
  `rg -n 'text/csv|\.csv[`"]|toCsv|csvCell' src` — and for each one confirm that **every cell,
  header included if dynamic, passes through one helper whose first step is the formula guard**
  (`/^[=+\-@\t\r]/`). A test pins it: `csvCell("=1+1")` must start with `"'=`.
- **Evidence:** 2026-09-08, `raycast-ios-apps` `generateCSV` — correct RFC 4180 quoting on
  `name` and `sellerName`, both straight from the iTunes API, with nothing stopping a leading
  `=`. Found while fixing the export rule above, which the quoting had made *look* handled.

---

## Actions, panels, and icons

### `[build]` An ActionPanel spanning two scopes is split into `ActionPanel.Section`

**ID:** `actionpanel-sections` · **Applies:** all

A flat list of actions does not tell the user **what each one will act on**. In a list
row's panel, "Remove From Group" and "Add New Tester" sit adjacent and look like peers —
one destroys the selected tester, the other creates something in the group. Nothing in
a flat panel distinguishes them, and the destructive one is the one you can't undo.

**The section boundary is scope, not category.** Not "reads vs writes", not "safe vs
destructive" — *what does this act on?*

1. **First section: the selected item.** Everything that reads, edits, copies, or
   deletes *this row*. **Title it with the item's own name** (`betaGroup.attributes.name`,
   the tester's display name, `Build 4`). That title is the whole point: the panel now
   states its target instead of leaving the user to infer it.
2. **Following sections: the wider scope.** Actions on the collection or context —
   "Add New Tester", "Create Group", "Invite Team Member". Usually untitled; title it
   when there is a second, genuinely different scope (e.g. `Export Compliance` on a
   build, which is neither the build's identity nor the list's).

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

**Keep the destructive action inside its item's section.** Quarantining it into a
"Danger" section at the bottom is the common instinct and it is wrong here: it separates
the action from the thing it names, which is exactly the association the section titles
exist to make. Destructiveness is already carried by `Action.Style.Destructive` and the
confirm dialog.

**Three corollaries, all observed while applying this:**

- **A section title needs a display-name helper, not string concatenation.** Reaching for
  `firstName + " " + lastName` inline produces a trailing space for anyone with no
  surname, and you will now render that string in two places (row title *and* section
  title) where it must agree. Extract one helper; the duplication is what surfaces the
  bug. *(Public-link TestFlight testers have no surname — every such row had a trailing
  space.)*
- **Sectioning changes shortcut adjacency, so re-check the conflict invariant after.**
  Moving an action into a section is also the moment you notice it had no shortcut at
  all; adding `Common.New`/`Common.Remove` while sectioning is normal and is exactly when
  a collision gets introduced. `ray lint` does not check this — read the resolved panel.
- **Two actions in *different rows'* panels may share a shortcut.** A file with two
  `Common.Remove` is not a collision if each lives in a separate row's ActionPanel
  (e.g. "Revoke" on an invitation, "Remove" on a member). Count per resolved panel, not
  per file, or the audit produces false positives.

**When the rule fires — both conditions, not either.**

1. The panel resolves to **5 or more direct actions**, AND
2. those actions span **two or more scopes** by the test above.

**A single-scope panel is EXEMPT at any size.** Five actions that all act on the same
item stay flat — there is no second scope, and inventing one produces an empty or
artificial section. This is the common false positive; check condition 2 before flagging.

**"Resolved" means what the user actually sees**, for one concrete item, after
conditionals evaluate. Count accordingly:

- A `{cond && <Action/>}` counts only in the branch where it renders. A panel that is
  flat-with-4 for most rows and 6 for one state is judged per state.
- A fragment (`{copyAction(x)}` returning `<>…</>`) counts as the actions inside it, not
  as one.
- An `ActionPanel.Submenu` counts as **one** action; its children are its own scope and
  are not counted at this level.

**Deliberately `[build]`, not `[both]`.** Condition 2 is a judgment call — whether two
actions share a scope cannot be decided by grep, and an auditor that mechanically flags
every flat 5-action panel produces false positives on exactly the single-scope panels
exempted above. `ship` does not assert this; `develop` applies it while writing, and a
reviewer may raise it. Do not promote it to `[verify]` without a mechanical scope test.

Applies to `List.Item`/`Grid.Item`/`Detail` panels; a `Form`'s single submit action needs
nothing.

### `[both]` Audit the FIRST action of every ActionPanel state, not just the primary one

**ID:** `first-action` · **Applies:** all

Raycast binds Return to whatever action is first in an `ActionPanel`, per rendered state,
regardless of any explicit `shortcut` on it. So the question is never "did I assign the
shortcuts correctly" — it is **"for each state this view can render, what does Return do?"**

**Audit:** enumerate every branch that renders a different `ActionPanel` — loaded, empty,
error, mid-scan, partial results — and for each one name the first action and what Return
therefore triggers.

- A **destructive or irreversible** action (eject, delete, revoke, overwrite) must never be
  first in any state. Put a read-only action ahead of it.
- Every state must render **at least one** action. A state with an empty `ActionPanel` is a
  dead end the user can only escape with Esc.
- Adding an action to one state does not audit the others: the branch you did not touch is
  where the defect lands.

*(Real: `raycast-ejection-seat` audited the shortcut slots in the blockers state and shipped
correct ones — then in the "No Visible Blockers" state `Eject Volume` was first, so opening a
clean volume and pressing Return ejected it. The shortcut audit passed; the per-state
first-action audit did not exist.)*

### `[both]` Keyboard shortcuts follow `keyboard-conventions.md`

**ID:** `keyboard` · **Applies:** all

**The canonical rules live in [`keyboard-conventions.md`](./keyboard-conventions.md)** — the
`Common` semantic map, when a shortcut must name both platforms, the conflict invariant, and the
linter's divergence from Raycast. They are not restated here, so the two files cannot drift.

- **Audit:** the platform-form audit and the conflict invariant, exactly as `keyboard-conventions.md` defines them.

### `[both]` Every `isShowingDetail` list carries a "Toggle Sidebar" action

**ID:** `toggle-sidebar` · **Applies:** a list uses `isShowingDetail`

Any `List` that renders a detail pane (`isShowingDetail`) must let the user collapse it —
a permanently-open sidebar crushes list titles into unreadable stubs (attio 2.0, notes
view, 2026-09-01: every title truncated to ~10 chars with no way out).

The pattern, verbatim:

```tsx
const [showDetail, setShowDetail] = useCachedState<boolean>("show-detail-<view>", true);
// ...
<List isShowingDetail={items.length > 0 && showDetail} ...>
// in EVERY item's ActionPanel:
<Action
  title="Toggle Sidebar"
  icon={Icon.AppWindowSidebarRight}
  shortcut={{ macOS: { modifiers: ["cmd", "shift"], key: "d" }, Windows: { modifiers: ["ctrl", "shift"], key: "d" } }}
  onAction={() => setShowDetail((v) => !v)}
/>
```

- **`useCachedState`, not `useState`** — the preference survives relaunch; a user who
  collapses the sidebar means it.
- **Title is exactly "Toggle Sidebar"**; shortcut is exactly ⌘⇧D / Ctrl⇧D,
  platform-explicit (no `Common` constant covers it).
- **On every item's panel**, not just some — the action must be reachable from whichever
  row is selected.
- **Audit:** grep for `isShowingDetail`; every hit must have a matching
  `"Toggle Sidebar"` action in the same view and a `useCachedState`-backed flag in the
  `isShowingDetail` expression. A bare `isShowingDetail={true}` or one with no toggle
  action is a finding.

### `[build]` Prefer `updateCommandMetadata` to surface menu-bar status in the command list

**ID:** `menubar-metadata` · **Applies:** menu-bar commands

When a `menu-bar` command has a meaningful compact status, push it into the
command's `subtitle` with `updateCommandMetadata({ subtitle })` so the user sees it
in the root search without opening the menu. This is a *recommendation, not a
mandate* — a menu-bar command with no meaningful one-line status shouldn't be forced
to invent one, so it's `[build]` (judgment at build time), not a `[verify]` audit
assertion that would false-positive on every subtitle-less menu-bar command.

- **The opportunity (0 repos use this yet):** `raycast-tesla-energy/src/menu-bar-status.tsx`
  already computes a compact status string (`batteryTitle()`/`gridTitle()`, ~:8-18)
  that is a ready-made `subtitle`; `raycast-luma/src/luma-menubar.tsx` likewise.

### `[both]` A fenced code block in `Detail` markdown carries a language tag

**ID:** `detail-code-lang` · **Applies:** renders code in `Detail`

Raycast's markdown renderer colors fenced code by language. An untagged fence renders as
flat monospace, which is the difference between a 17KB `apple-app-site-association` you
can read and a grey wall you cannot.

```ts
// Not: `# ${title}\n\n\`\`\`\n${body}\n\`\`\``
const language = inferLanguage(name, contentType);   // "json" | "xml" | "html" | ""
markdown = `# ${title}\n\n\`\`\`${language}\n${body}\n\`\`\``;
```

Derive the tag from the Content-Type first and the filename second; emit an empty string
when neither settles it, since a wrong tag colors the block as the wrong language.

**And size the fence to the body.** A fixed three backticks is closed early by any
resource that itself contains ```` ``` ````, after which the remainder renders as
Markdown — headings, bold, swallowed indentation. Remote content is exactly where this
happens:

```ts
const longestRun = [...text.matchAll(/`+/g)].reduce((max, m) => Math.max(max, m[0].length), 0);
const fence = "`".repeat(Math.max(3, longestRun + 1));
```

- **Audit:** `rg -n '\\`\\`\\`' src/` → any fence built into a markdown string needs both a
  language slot and a computed length.
- **Evidence:** 2026-09-08, `raycast-digger` `ResourceDetailView` — every fetched
  well-known file, robots.txt and sitemap rendered untagged; JSON and XML were
  indistinguishable grey. The fence-length half was found by adversarial review, on the
  export path where a remote file's own backticks would have broken out of the block.

### `[both]` Empty-state assets are themed or vector

**ID:** `empty-state-assets` · **Applies:** bundles empty-state art

A single dark PNG/SVG empty-state asset renders as a dark slab on light theme. Either
`{ source: { light, dark } }` pairs or a plain `Icon`. Audit: grep `icon="empty/` and
any bare string icon path for a missing themed twin.

### `[both]` A monochrome bundled icon needs a theme-aware treatment — a bare filename is invisible in one theme

**ID:** `monochrome-icon` · **Applies:** bundles a monochrome icon

**Scope: monochrome glyphs shipped as a single asset.** Referencing one by bare filename
— `icon="artifact_file.svg"` — renders it with **its own baked-in fill**, which Raycast
does not adjust for the active theme. A glyph authored dark reads fine in light mode and
**disappears against the dark background** (and vice versa).

Two supported fixes; either satisfies this rule.

**1. Tint from the code side** (preferred for a single monochrome asset):

```tsx
const ARTIFACT_ICON: Image.ImageLike = {
  source: "artifact_file.svg",
  tintColor: Color.PrimaryText,   // theme-aware; tracks the row's title color
};
```

**2. Ship a themed source pair** — `Image.Source` accepts `{ light, dark }` directly, and
Raycast also picks up an implicit `foo@dark.png` sibling. Correct, and **not** a defect:

```tsx
const ICON: Image.ImageLike = { source: { light: "glyph-light.svg", dark: "glyph-dark.svg" } };
```

- **Which color, when tinting:** `Color.PrimaryText` for a glyph that should read like the
  row title; `Color.SecondaryText` for a de-emphasised accessory; a semantic `Color.*`
  (Red / Green / Orange) where the icon carries status. **Prefer the semantic `Color.*`
  enum over a raw hex** — not because hex is broken (`Color.Raw` is fully supported and
  documents HEX/RGB/HSL, and `Color.Dynamic` takes `{ light, dark, adjustContrast }`), but
  because the enum keeps one palette across the fleet and tracks Raycast's themes for free.
  Reach for hex only when the design genuinely needs a color the enum doesn't carry.
- **Don't count on `fill="currentColor"` in the SVG.** *Observed on `claude-artifacts`,
  2026-07-25:* the icon was switched to `currentColor` specifically to fix dark mode,
  shipped, and was **still invisible in dark mode** on the next screenshot — the fix was
  `tintColor`, not the asset. Stated as an observation, not an SDK law: Raycast's changelog
  records a `currentColor` SVG-handling fix, so behavior may differ by version, and this has
  not been re-tested since. Use one of the two supported mechanisms above and you don't have
  to care which way it currently falls.
- **Exempt:** full-color raster assets (logos, app icons, screenshots) that are
  *meant* to keep their own colors, and `Icon.*` built-ins (already theme-aware).
- **Not the same as `environment.appearance`** — that is for graphics you *render*
  yourself (SVG charts you generate). For a bundled asset handed to a component,
  `tintColor` is the mechanism.
- **Audit:** grep `icon=` / `source:` for a bare `.svg`/`.png` string that has **neither**
  an adjacent `tintColor` **nor** a `{ light, dark }` source **nor** an `@dark` sibling file
  in `assets/`, and flag it for a monochrome glyph. Do not flag a themed pair — it is
  already correct. A green `ray lint` proves nothing here: no rule checks it, and the defect
  is invisible until someone opens the other theme.

> **Check both themes before calling an icon done.** This class of defect is
> undetectable from a build, a lint, and a single screenshot — it needs the theme
> toggled. Same discipline as walking the empty/error states.

### `[build]` Pin actions use the Tack icons; person avatars use the squircle mask

**ID:** `icon-choices` · **Applies:** all

- Pin/unpin actions use `Icon.Tack` / `Icon.TackDisabled` (the paired set) — never `Icon.Pin`/`Icon.PinDisabled` (Chris preference, attio 2026-09-01).
- Person avatars rendered as icons/accessories always carry `mask: Image.Mask.RoundedRectangle` (squircle) — bare circular/unmasked avatar rectangles are a finding (attio, 2026-09-02).

---

## Copy

### `[both]` US English everywhere — UI copy, comments, docs, identifiers

**ID:** `us-english` · **Applies:** all

Every word this fleet ships is **US English**. Not just user-visible strings: comments,
docstrings, CHANGELOG entries, AGENTS.md, commit messages, PR descriptions, and
identifiers too.

catalog (not catalogue) · behavior · color · recognize · normalize · serialize ·
optimize · analyze · honor · labeled · canceled · cancelable · center · defense · license (noun and
verb) · artifact · while (not whilst) · afterward (not afterwards)

**Audit — two halves.** Tracked files, before shipping; it must print nothing:

```bash
git grep -niE '\b(un|mis|re)?(catalogue|parenthesis(ed|ing)|behaviour|colour|recognis[a-z]*|normalis[a-z]*|serialis[a-z]*|analyse[sd]?|honour[a-z]*|labell(ed|ing)|cancell(ed|ing|able)|centre|defence|artefacts?|whilst|afterwards|organis[a-z]*|summaris[a-z]*|stabilis[a-z]*|customis[a-z]*|prioritis[a-z]*|utilis[a-z]*|minimis[a-z]*|maximis[a-z]*|optimis(e|ed|es|ing|ation)|licence)\b' -- . ':!package-lock.json' ':!**/fixtures/**'
```

Exclude any other path that holds external data verbatim (below). Commit messages and PR
descriptions are not files, so the second half is `[build]`: read them before you push.

Word boundaries and explicit endings matter here: `PercentRef` matches a loose
`centre`, `optimistic` is correct US English, and **`cancellation` keeps its double L**
in US English while `canceled` / `canceling` / `cancelable` take one.


Two carve-outs, both narrow: **external data keeps its own spelling** (a CVE summary,
an upstream package description, a quoted API field), and **`@raycast/api`'s own names
are whatever Raycast called them**.

**Why it is a hard rule and not a preference.** Chris has asked for this more than once,
and the last time in capitals: *"PLEASE STOP USING BRITISH ENGLISH EVERYWHERE!! YOU MUST
WRITE US ENGLISH ACROSS THE ENTIRE FLEET."* (2026-09-21, brew). It drifts in silently
because no gate checks spelling — `tsc`, `ray lint` and Prettier are all blind to it —
and because a model writing careful prose reaches for British forms unprompted. By the
time it is noticed it is spread across dozens of files in several repos, and the fix is
a bulk rewrite touching everything, which is exactly the diff nobody wants to review.
On brew it reached 34 files, including copy already shipped to the Store.

### `[both]` Empty/error state copy: short title, one-line description, steps in the actions

**ID:** `empty-state-copy` · **Applies:** all

`List.EmptyView` (and `Toast`) copy follows one shape: an icon, a short imperative
title, and a **single-sentence** description. Multi-step guidance goes in the
`actions`, not the description.

**Why it's a hard rule, not a preference:** `List.EmptyView`'s `description`
**collapses newlines** — a multi-line string renders as one run-on line, so the steps
you carefully put on separate lines arrive as one wall of text.

> **Sourcing:** this is *observed behavior*, not a documented API guarantee — the SDK
> types specify only `description: string`. The evidence is Chris's own note at
> `https://github.com/chrismessina/raycast-airbuddy/blob/main/src/components/error-views.tsx#L43`
> (*"List.EmptyView's `description` collapses newlines — … Keep every description to ONE
> short line and put the steps in the actions."*). **Repro if you need to confirm it:**
> render a `List.EmptyView` with `description={"line one\nline two"}` and look at the
> screen. The rule is good regardless of the mechanism — a one-line description with the
> steps in the actions is the better empty state either way.

- **Error `Detail` screens** use the heading form `` `# Error\n\n${message}` ``
  (`raycast-fathom/src/search-meetings.tsx:335`,
  `raycast-reader/src/views/ArticleReaderView.tsx:120`,
  `raycast-tesla-energy/src/view-solar-production.tsx:244`), where `message` is the
  `instanceof Error` string from the prohibition above.
- **Audit:** two mechanical checks — (a) flag any `List.EmptyView` / `EmptyView`
  `description` whose string literal contains an explicit `\n` (the objective defect:
  collapsed newlines), and (b) flag any error `Detail` that doesn't use the `# Error`
  heading form. Overall description *length* is a `[build]` judgment, not a hard audit
  assertion.
- **The newline half of (a) has a reference ESLint rule — not enforced anywhere yet.**
  [`eslint-rules/no-multiline-emptyview-description.mjs`](./eslint-rules/no-multiline-emptyview-description.mjs)
  catches `List.EmptyView` / `Grid.EmptyView` / bare `EmptyView` (plus any local wrapper
  passed via `additionalComponents`), across `"…"`, `{"…"}`, and template literals. No shared
  config ships it, so an extension that wants it **copies the file into its own repo** (here,
  `eslint-rules/`) and registers it in its flat config:

  ```js
  import noMultilineEmptyViewDescription from "./eslint-rules/no-multiline-emptyview-description.mjs";

  export default defineConfig([
    ...raycastConfig,
    {
      plugins: { house: { rules: { "no-multiline-emptyview-description": noMultilineEmptyViewDescription } } },
      rules: { "house/no-multiline-emptyview-description": "error" },
    },
  ]);
  ```

  **Why lint and not a shared `<EmptyView>` component** (considered and rejected 2026-07-25):
  a wrapper can't stop anyone using `List.EmptyView` directly, `description: string` can't
  express "contains no newline" in TypeScript, and normalizing at runtime would *hide* the
  defect rather than prevent it. Lint catches it before merge; the `ship` grep stays as the
  backstop for extensions that haven't adopted the rule. A component layer would also drag
  React and JSX build surface into every consumer for 55 call sites that are mostly
  domain-specific (airbuddy's dispatches on four AirBuddy-only error classes).
  *Fleet check 2026-07-25: zero current violations — this rule is preventive, and the
  airbuddy comment that documented the trap did its job.*

### `[build]` Toggle copy states the resulting direction (on/off), never a bare "Toggled"

**ID:** `toggle-copy` · **Applies:** all

When a command **toggles** a setting, the success copy must say **which way it went** —
the resulting state — not merely that a toggle happened. "Toggled" (or a bare status
adjective like "Not Floating") makes the user open the app to find out what they just
did, which defeats the point of the command.

- **State the result as on/off (or the equivalent named state):** `"Microphone Input
  On"` / `"Microphone Input Off"`, `"Desktop Widgets Floating: On"` / `"…: Off"`,
  `"Audio Input Lock On"` / `"Audio Input Lock Off"`. A multi-value setting names the
  resulting value instead (`"Spatial Audio: Fixed"`). All five are real airbuddy toggle
  toasts (`raycast-airbuddy/src/toggle-*.ts`).
- **Read the real post-state when the API exposes it.** Prefer reading the setting's
  actual value after the toggle (poll the readable property) over assuming the direction
  from a locally-tracked "was it on before" guess — a guess silently desyncs if the
  setting is changed from the app's own UI between calls.
- **When the direction is genuinely unknowable** (no readable property anywhere in the
  API, and no reliable local state), do **not** fabricate a direction — say so, and
  point the user at where to confirm (`message: "Check <app> to confirm the current
  state."`). Honesty beats a lie that reads as certainty. *(This was airbuddy's stopgap
  for `toggle desktop widgets` / `toggle audio input lock` before AirBuddy 913 added
  readable `desktopWidgetsFloating` / `audioInputLockEnabled` properties — once the
  property existed, the toasts were upgraded to name the real state.)*
- **The defect this closes:** a "Desktop Widgets Not Floating" toast (airbuddy, pre-fix)
  reads as a passive status label, ambiguous about whether the command succeeded or what
  it changed. Naming the direction as a result (`Floating: Off`) resolves it.
- **Audit:** `[build]` judgment — grep success-toast titles on `toggle-*` commands for a
  bare `"Toggled"` / `"… Toggled"` with no on/off or named result, and flag it. Not a
  hard `[verify]` assertion (the "genuinely unknowable" carve-out is a judgment call).

### `[both]` Count-bearing copy uses correct singular/plural agreement — never `item(s)`

**ID:** `plural-copy` · **Applies:** all

Any user-facing string that interpolates a count must agree grammatically with that
count across **all three** cases: zero, one, and many. `"1 items"` and `"No devices
found"` sitting next to `"3 device found"` are defects. The lazy escape hatches —
`"${n} item(s)"`, `"${n} device(s)"`, always-plural `"${n} items"` — are prohibited in
copy the **user reads** (they're fine in `logger.*` debug output, which no user sees).

- **The shape:** three-way, e.g. `n === 0 ? "No devices found." : n === 1 ? "1 device
  found." : \`${n} devices found.\``. Don't hand-inline that ternary five times — **this
  helper now exists** as `countOf(n, "device")` / `countOf(n, "match")` in
  `@chrismessina/raycast-kit` (see `kit`). It handles the
  irregulars the hand-rolled version got wrong (`match`→`matches`, `city`→`cities`,
  `person`→`people`, `series`→`series`) and thousands separators.
- **Zero has its own copy.** `"No devices found."` reads better than `"0 devices
  found."`; use the worded-negative form for the empty case (it also matches the
  `List.EmptyView` empty-state titles this fleet already writes — `"No Known Devices"`,
  `"No Headsets Nearby"` in `raycast-airbuddy/src/list-devices.tsx`).
- **The defects this closes (real fleet):** `raycast-craft/src/tools/add-collection-items.ts:63`
  (+ `update-`/`delete-collection-items.ts`) render `${input.items.length} item(s)`;
  `raycast-fathom/src/view-action-items.tsx:71` and `raycast-at-profile/src/history.tsx:188`
  render an unconditional `${n} items` that says `"1 items"` at count 1. (Terse
  `List.Section` subtitles are the softest case — but the pattern is fleet-wide and the
  fix is cheap.)
- **Audit:** the greppable subset is what `ship` asserts (this rule is `[both]` for that
  reason — as `[build]` the check below never actually ran). Grep user-facing copy
  for the literal `(s)` / `(es)` pluralization crutch and for `length}\s*<plural-noun>`
  templates with no adjacent `=== 1` guard. General agreement across a computed message
  stays a `[build]` judgment.

---

## Project, README, and changelog

### `[build]` Organize `src/` into role folders once a command file grows past ~150 lines

**ID:** `src-folders` · **Applies:** all

Every self-authored extension beyond a handful of files splits `src/` into a subset
of these role folders — the convention is which name means what:

- **`hooks/`** — React state hooks, each file/​export prefixed `use*`.
- **`utils/`** — business logic / pure helpers. (Older/smaller repos used `lib/`;
  new work uses `utils/`.)
- **`types/`** — shared type declarations.
- **`components/`** — small reusable UI widgets.
- **`views/`** — full-screen sub-views (a whole `List`/`Detail` screen), distinct
  from `components/`.
- **`actions/`** — standalone `ActionPanel`/`Action` builders.

Evidence: `raycast-digger/src/{types,utils,components,hooks,actions}`,
`raycast-fathom/src/{tools,types,utils,components,hooks,actions,views}`,
`raycast-threads-client/src/{types,utils,hooks,actions,views}`. Not a single grep,
but the split (and the `views/` vs `components/` distinction) is the house shape —
don't pile everything into one command file, and don't invent parallel names
(`helpers/`, `lib/` in new work).

### `[verify]` Original extensions ship the social-badge preamble and `FUNDING.yml`

**ID:** `readme-preamble` · **Applies:** self-authored

**Going-forward standard, not a description of the fleet as it stands.** The badge block
post-dates a good number of already-published extensions, so a census will show plenty of
misses — that is expected backlog, not drift. Apply it to anything new, and backfill on the
next substantive touch. (Applies to `chrismessina`-authored extensions; do **not** impose
it on forks you contribute upstream.)

Two artifacts:

1. **`README.md`** follows [`readme-template.md`](./readme-template.md) — **that file is
   the single source of truth for the shape.** Do not reproduce the markup here, and do not
   infer the shape from an existing standalone repo: most of the fleet predates the current template
   and copying one propagates the old form.
2. **`.github/FUNDING.yml`** — every self-authored standalone repo carries it. All existing copies
   are byte-identical, so this is a straight copy from any repo that has one; there is
   nothing per-extension to edit.

> **The badge implies publication.** The Store badge deep-links to
> `raycast.com/chrismessina/<slug>`, which 404s until the extension is actually in
> the Store. Add the block **at publish time**, not at scaffold time — and when auditing,
> check the Store URL resolves rather than only that the block exists. `FUNDING.yml` has no
> such constraint; it is safe from day one.

- **Audit:** for self-authored extensions, assert the preamble **and** `.github/FUNDING.yml`.
  Report unpublished extensions separately rather than as violations. Watch for `.github`
  appearing in `.gitignore` — it silently prevents `FUNDING.yml` from ever being committed.
- **Census 2026-08-10:** 25 self-authored extensions, 12 published. Of those 12: 4 complete,
  3 have the badge but no `FUNDING.yml`, 5 have neither. `central-icon-system` carries the
  badge while its Store URL 404s — a live dead link, and the reason for the publish-time rule.

> 🚨 **The old three-badge form — `# Title` *above* a `<div>` of Follow/Stars/Store — is
> RETIRED.** It shipped across much of the fleet and is still visible in older standalone repos
> (`raycast-bookface`, `raycast-claude-artifacts`), which makes it easy to "match the
> fleet" and reproduce the wrong thing. The current shape puts the icon and title *inside*
> the centered block and carries four badges. Backfill old standalone repos on their next
> substantive touch; never copy from them.

The substitution traps (`<repo>` vs `<slug>`), the icon/`media/` rule, and the nav-anchor
rule all live in [`readme-template.md`](./readme-template.md).

- **Reference:** [`readme-template.md`](./readme-template.md); a current example is
  `chrismessina/raycast-ios-apps`.
- **Audit:** self-authored repo whose `README.md` lacks the centered block, embeds an image
  from `assets/` or `metadata/`, or whose Store badge URL doesn't resolve to a live Store
  page.

### `[both]` Never hand-invent a merge date — keep the `{PR_MERGE_DATE}` placeholder

**ID:** `merge-date-placeholder` · **Applies:** all

The newest, unreleased CHANGELOG entry keeps Raycast's literal `{PR_MERGE_DATE}`
token; Raycast substitutes the real date when the Store PR merges. Do **not** guess
a date before merge. Entries follow `## [<Title>] - {PR_MERGE_DATE}` under a
`# <Name> Changelog` header. Universal across all 21 self-authored CHANGELOGs
(merged entries correctly show a real date, e.g. `raycast-bookface: ## […] -
2026-06-23`; only the unreleased entry carries the token).

- **Audit:** `grep -c '{PR_MERGE_DATE}' CHANGELOG.md` — expect it only on the newest
  unreleased entry, never on an already-shipped one, and never a real date on an
  unmerged entry.

> **Retagged `[verify]` → `[both]` on 2026-09-09.** As a `[verify]`-only rule this could
> never fire when it was needed: `develop` is told to skip `[verify]` entries because they
> are "`ship`'s read-only assertions" — but the CHANGELOG entry is *written* during
> `develop`. So the placeholder got replaced with a real date at write time and nothing
> checked it until `ship`, by which point Chris had already read the wrong date and fixed it
> by hand. A rule about how to write something has to be tagged for the skill that writes it.

### `[both]` Changelog bullets are tweet-length and ordered by user benefit

**ID:** `changelog-bullets` · **Applies:** all

The CHANGELOG is read by two audiences who both skim: a Store reviewer deciding what
changed, and a user deciding whether to care. Neither reads a paragraph.

**Length: ~280 characters per bullet — tweet length.** If a bullet needs more, the
rationale belongs in the commit message, not here. A bullet that runs long is usually
carrying three things at once; the fix is to cut the mechanism and keep the outcome.

**Order by user benefit, not by diff size or chronology.** The headline capability
first, behavior changes to things that already worked next (a returning user needs to
find those), dependency and security bumps last.

**One bullet per change a user would notice.** A minor improvement does not earn its own
line — fold it into the bullet for the feature it belongs to, as a trailing clause. A
CHANGELOG where every touched file gets a bullet reads as a diff, not as release notes.

**Do name behavior changes explicitly.** A default action that moved, an action that
disappeared from a view, a renamed command — these are the entries that stop a bug
report from being filed. They go above the dependency bumps, never omitted as noise.

- **Audit:** every `- ` line in the newest entry is ≤ ~280 chars:
  ```bash
  awk '/^## \[/{n++} n==1 && /^- /{ if (length($0)-2 > 280) print length($0)-2": "$0 }' CHANGELOG.md
  ```
  Expect no output. Treat 280 as a target, not a hard gate — 300 for a bullet that
  genuinely needs it is fine; 390 is a bullet doing three jobs.

> ⚠️ **Be careful running Prettier on `CHANGELOG.md`.** It reformats whitespace inside
> headings that have **already shipped** — collapsing a double space after the dash, for
> instance — which puts unrelated churn in a diff that a Store reviewer reads as an edit to
> published history. `ray lint` does **not** require the changelog to be Prettier-clean, so
> reformatting it buys nothing.
>
> **This is cosmetic, not dangerous.** Raycast CI substitutes the literal `{PR_MERGE_DATE}`
> token and nothing else, so whitespace in an already-dated heading cannot cause a
> re-stamp — only reverting a dated heading *back to the placeholder* can (see the rule
> above). An earlier version of this note claimed otherwise; that was asserted, not
> verified. If Chris says normalize it, normalize it.
>
> Observed twice in one session (2026-08-27, brew #30598): `npx prettier --write
> CHANGELOG.md` rewrote `## [Bug fix] -  2026-05-21` to a single space on two separate
> edits, and `ray lint` stayed green both times — so only the diff against the published
> file surfaced it at all. After any reformat, check what moved:
> ```bash
> diff <(grep -E '^## \[' "$PUB_DIR/CHANGELOG.md") \
>      <(grep -E '^## \[' CHANGELOG.md | grep -v '{PR_MERGE_DATE}')
> ```

**Evidence:** written 2026-08-27 after the `brew` analytics PR, where the first draft ran
to nine bullets — one of them 391 characters, another 326 — and spent a full bullet on
"each package shows when it was installed, and pinned formulae carry a pin icon", a minor
change that Chris flagged as not warranting its own line. Condensing to seven bullets
ordered by benefit, with the minor items folded in as clauses, is the shape this rule
describes.

---

## Audit matrix

`ship` works through every row whose **Applies** condition holds for the extension, runs
that rule's **Audit**, and reports one result per ID: `pass`, `fail`, or `n/a` (with the
reason). A **block** failure stops the submission and goes back to `develop`; a **report**
failure is listed in the pre-flight report and does not stop it. `[build]`-only rules have no
row: nothing can check them after the fact.

**An audit must accept every compliant form.** A check that greps for the hand-written
form of a rule reports a regression on code that just adopted a helper encoding it — see
[`audit-coupled-to-the-hand-written-form-of-a-rule`](../learnings/workflow-issues/audit-coupled-to-the-hand-written-form-of-a-rule.md).

| ID | Tag | Applies | On failure | Rule |
|---|---|---|---|---|
| `prettierrc` | `both` | self-authored | **block** | `.prettierrc` is this exact file, in every self-authored extension |
| `no-hand-preferences` | `lint` | all | **report** | Never hand-define `Preferences` or `Arguments` types |
| `no-any` | `lint` | all | **report** | No `any` type casting |
| `catch-unwrap` | `lint` | all | **report** | Unwrap unknown catch values with the `instanceof Error` ternary |
| `tsc-gate` | `both` | all | **block** | Typecheck with `tsc --noEmit` — `ray lint` never typechecks, and a plain `ray build` does not either |
| `react-hooks-lint` | `verify` | self-authored | **report** | `eslint-plugin-react-hooks` with `rules-of-hooks: error` is present |
| `madge-cycles` | `verify` | self-authored | **report** | `madge --circular` runs as a `pretest` gate |
| `impeccable-off` | `both` | Impeccable plugin installed | **report** | Disable the Impeccable design hook — it is irrelevant to Raycast extensions |
| `monotonic-elapsed` | `both` | all | **block** | An elapsed-time check uses `performance.now()`, never `Date.now()` |
| `readiness-gate` | `both` | background prep drives `isLoading` | **block** | A readiness gate tracks *did prep finish* and *which items succeeded* separately |
| `cache-version-derived` | `both` | persists a typed payload | **block** | A cache version is DERIVED from the cached shape, never hand-maintained |
| `interval-launchtype` | `both` | a command declares `interval` | **block** | Interval-driven commands must branch on `environment.launchType` |
| `ai-access` | `both` | calls Raycast AI | **block** | Handle no-AI-access on every Raycast-AI call |
| `supportpath-internal` | `both` | writes files | **block** | `environment.supportPath` is for INTERNAL state only — user files go to a preference dir |
| `selection-api` | `verify` | reads the selection | **block** | Read the active selection via the platform API, never a shell-out |
| `copy-error` | `both` | all | **block** | Every failure toast carries a "Copy Error" action |
| `no-hud-before-actions` | `both` | a `no-view` command | **block** | In a `no-view` command, never `showHUD` before a toast that carries actions |
| `animated-means-work` | `both` | all | **block** | `Toast.Style.Animated` is a promise that work is in flight — never spin for a synchronous write |
| `toast-no-id` | `both` | all | **block** | A toast has no id — `hide()` and mutation act on whatever is on screen NOW |
| `toast-window-copy` | `both` | all | **block** | Toast copy never says "this window" — a toast is a detached HUD |
| `logger` | `both` | self-authored, makes web requests | **block** | Structured logging via `@chrismessina/raycast-logger` |
| `logger-verbose-copy` | `both` | the extension declares `verboseLogging` | **block** | The copy is fixed too — type this block verbatim |
| `logger-strict-redaction` | `both` | self-authored, installed logger 1.5.0+ | **report** | Logger 1.5.0+: declare `strictRedaction` beside `verboseLogging` |
| `kit` | `both` | self-authored, already being changed | **report** | Prefer `@chrismessina/raycast-kit` for failure toasts and count copy |
| `show-in-finder` | `both` | all | **block** | Show a file with `Action.ShowInFinder` / `showInFinder()`, never `open(path, "Finder")` |
| `export-actions` | `both` | writes a file for the user | **block** | A completed file export offers Show in Finder AND Copy Path, both with shortcuts |
| `csv-formula-guard` | `both` | exports CSV | **block** | A CSV export neutralizes spreadsheet formulas, not just quotes |
| `first-action` | `both` | all | **block** | Audit the FIRST action of every ActionPanel state, not just the primary one |
| `keyboard` | `both` | all | **block** | Keyboard shortcuts follow `keyboard-conventions.md` |
| `toggle-sidebar` | `both` | a list uses `isShowingDetail` | **block** | Every `isShowingDetail` list carries a "Toggle Sidebar" action |
| `detail-code-lang` | `both` | renders code in `Detail` | **block** | A fenced code block in `Detail` markdown carries a language tag |
| `empty-state-assets` | `both` | bundles empty-state art | **block** | Empty-state assets are themed or vector |
| `monochrome-icon` | `both` | bundles a monochrome icon | **block** | A monochrome bundled icon needs a theme-aware treatment — a bare filename is invisible in one theme |
| `us-english` | `both` | all | **block** | US English everywhere — UI copy, comments, docs, identifiers |
| `empty-state-copy` | `both` | all | **block** | Empty/error state copy: short title, one-line description, steps in the actions |
| `plural-copy` | `both` | all | **block** | Count-bearing copy uses correct singular/plural agreement — never `item(s)` |
| `readme-preamble` | `verify` | self-authored | **report** | Original extensions ship the social-badge preamble and `FUNDING.yml` |
| `merge-date-placeholder` | `both` | all | **block** | Never hand-invent a merge date — keep the `{PR_MERGE_DATE}` placeholder |
| `changelog-bullets` | `both` | all | **block** | Changelog bullets are tweet-length and ordered by user benefit |

---

## Still to enumerate

Candidates that showed up in a fleet audit (2026-07-23) but are **not yet rules** —
either emerging (adopted only in recent work) or too split to codify. Parked here so
they aren't re-discovered from scratch; promote one when it earns it.

- **Conventional Commits** (`feat:`/`fix:`/`chore:`/…). Near-100% in recent repos
  (`airbuddy` 40/40, `wrap-unwrap` 39/39) but **zero** in older ones (`digger`,
  `bookface`, `google-maps`, `fetch`, `at-profile`). A habit adopted mid-2026, not a
  standing convention — and a commit convention, not strictly extension house-style.
  Promote when it's the norm across a fresh audit.
- **Real unit-test suites** (`*.test.ts`). Only 4/21 (`happenstance`, `memory-store`,
  `reader`, `wrap-unwrap`). Emerging practice; too sparse to mandate.
- **Explicit `throttle` on live-search `List`s.** Chris sets it deliberately where a
  command does per-keystroke remote fetching (`google-maps`, `memory-store`,
  `ios-apps` on; `parallel-web-tools` off-with-intent) but many search commands omit
  it. Closer to a per-command correctness call than a blanket rule.
- **Default icon filename `extension-icon.png`.** ~10/21 use it, ~11/21 use a
  brand-specific name — a coin flip, not a convention. Not codified.
- ~~**`@raycast/api` import ordering.**~~ **Promoted 2026-08-29** — see the
  `.prettierrc` rule above. The 2026-07-23 audit found "no tooling configured
  anywhere"; a re-audit found `@ianvs/prettier-plugin-sort-imports` wired up in 12
  extensions with zero config/dependency mismatches. The tooling this entry was
  waiting on already shipped.

**Rejected outright** (checked, no real pattern): `ActionPanel.Section` usage ratio;
`showFailureToast` vs manual Failure toast (manual dominates — already covered by the
Copy-Error rule); `useCachedPromise`/`usePromise` vs manual loading state (even split);
`export default function Command()` naming (mixed).
