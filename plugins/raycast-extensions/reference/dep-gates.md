# Dependency gates

Known-good dependency targets for Raycast extensions. Consulted by `develop`'s
**Intent 2 — Modernization** before any *major-version* migration, and by `ship`'s dep
hygiene to know where the non-breaking ceiling is. The machine form of the `@raycast/api`
policy is the `dependencies` block of [`presets/chrismessina.json`](../presets/chrismessina.json),
which `rx api-floor` (and `rx gates`) enforces; this file is the human form, and the two must
agree. How the policy got here is evidence, not instruction:
[`raycast-api-policy-history`](../learnings/tooling-decisions/raycast-api-policy-history.md).

## Current `@raycast/api` policy

**Existing extensions stay on the major they are on unless a migration is explicitly chosen;
the 1.x floor is `1.104.25`. New extensions start on 2.x (floor `2.1.0`) and are never rolled
back to 1.x. Submit the version the extension was last exercised in Raycast; npm's newest
release is advisory, never a target, because npm publishes `@raycast/api` ahead of the Raycast
app that can run it and the Store refuses an extension whose declared API is newer than the
user's app. A ship-time bump is allowed only if the extension is re-run in Raycast at the new
version first; crossing a major is `develop`'s migration, never `ship`'s hygiene.** For a
large, popular extension already on 1.x, mention in the report that staying on 1.104 keeps its
1.x users updating, and let Chris decide (Chris, 2026-10-20).

`rx api-floor` reads the policy from the preset: lockfile-resolved major 1 → `existing-1x`,
major 2 → `2x`; a brand-new extension (`rx stale` says not published) must resolve to 2.x.
`api-floor-lockfile` FAIL below the floor; `api-floor-manifest` WARN when the range's lower
bound is below it; `api-floor-new` FAIL for a new extension on 1.x; `api-currency` WARN when
behind npm, `N/A` when npm is unreachable. The lockfile is what ships; a manifest range that
merely permits a version proves nothing.

## The two-tier model

Each dependency carries two gates. **FLOOR** is the version proven safe everywhere: an extension
at or above it needs no migration; one below it is stranded and is a genuine migration
candidate. **LEADING EDGE** is a newer major that is proven but not yet the default, named with
the extensions that prove it. Non-breaking bumps within a tier are `ship`'s dep hygiene;
crossing a major is `develop`'s modernization intent, gated on this file. Gates never move
silently: when a newer version is the real known-good target, `develop` proposes the change and
asks before editing this file. Last verified 2026-10-20 for `@raycast/api`; dates for the other
rows are in the table.

## Gates

| Dependency | FLOOR (safe everywhere) | LEADING EDGE (proven, opt-in) | Proven on / notes |
|---|---|---|---|
| `node` | 22 | — | local toolchain v22.22.3 |
| `@raycast/api` | existing extensions: `1.104.25` on the 1.x line; 2.x extensions: `2.1.0` | **2.x is the default for every NEW extension** | 2.x adopters: `dev-null`, `store-updates`, `karakeep`, `context7`. 1.x → 2.x is a soft major (details in the history learning). `2.0.3`/`2.0.4` lack `Icon.Quicklink`: never pin them |
| `@raycast/utils` | `^2.2` | `^2.3` | `ios-apps`, `context7` (2.3.0). `^1.17` is still in use and not stranded: v2 changed hook signatures, so treat `^1.17` → `^2.2` as a migration, done when the extension is being worked on anyway |
| `@chrismessina/raycast-logger` | **`^1.5`** (moved 2026-09-15) | — | **Required before `@raycast/api` 2.x**: through 1.3.0 the peer range was `^1.0.0`, a hard `ERESOLVE`; 1.4.0 widened it. 1.3.0 was a security release (a fail-open in `sanitizeArgs`); 1.5.0 adds opt-in strict redaction and exports `redactString(s, { level })`, the supported way to scrub a server-supplied string |
| `@chrismessina/raycast-kit` | **`^0.3.0`** (moved 2026-11-04) | — | `cosign` (first adopter of `onErrorToast` and the `cause` chain, which the failure-toast rules rely on; no breaking changes, so `^0.2.0` → `^0.3.0` is a version bump only); `threads` first adopted the `bytes` subpath (0.2.0). Also satisfies the 2.x peer prerequisite (≤ 0.1.3 declared `^1.0.0`; it fails *softly*, see below) |
| `@chrismessina/raycast-downloader` | **`^0.1.5`** (moved 2026-09-17) | — | `fathom`. Every release 0.1.0 → 0.1.5 fixes a distinct resume-path corruption that exits 0 with a plausible file size; below the floor it corrupts files. Peer range `^1.0.0 \|\| ^2.0.0`: no companion bump for 2.x |
| `eslint` | `^9` | `^10` | `airbuddy` (10.5.0), `tesla-energy` (10.1.0) |
| `typescript` | `^5.9` | `^6` | `airbuddy` (6.0.3), `tesla-energy` (6.0.2) |
| `@raycast/eslint-config` | `^2.1` | `^2.2` | `airbuddy` (2.2.0) |
| `prettier` | `^3` | — | fleet-wide |
| `@types/react` | `^19`, resolving to `19.3.0` with `@raycast/api` 2.10.0 | — | 2.10.0 peer-pins `@types/react 19.3.0` and `@types/node 26.6.5`. A second 19.0.x copy makes Raycast components used as JSX fail with TS2786; bump it in the same change as the API. Receipts: `docs/reference/raycast-api-changelog.md` § 2.10.0 |

## Compatibility notes

- **Peer-range failures differ by package, and the soft one is the dangerous one.** The logger at
  ≤ 1.3.0 beside `@raycast/api` 2.x is a hard `ERESOLVE`: the install aborts. The kit at ≤ 0.1.3
  only prints `npm warn ERESOLVE overriding peer dependency` and the install *succeeds*; `npm ls`
  then reports the tree `invalid` and exits `ELSPROBLEMS`, while `tsc`, `ray build` and `ray lint`
  all pass on the invalid tree. **After any `@raycast/api` 2.x bump, run `npm ls @raycast/api` and
  require a clean exit**, not just a successful install. Bump the logger and kit to their floors
  first, or the failure looks like a 2.x problem when it is not.
- **The kit's `bytes` subpath needs `"module": "Node16"` + `"moduleResolution": "Node16"`** in
  `tsconfig.json` (`store-updates`, `fathom`, `threads`). The scaffold default (`commonjs`, no
  `moduleResolution`) ignores `exports` maps and fails `TS2307`; `"bundler"` is rejected unless
  `module` is `es2015`+ (`TS5095`). The kit formats bytes base-1024 with one decimal from KB up
  (developer-tooling convention, matching the rest of the fleet) and gains `B`/`GB`/`TB`, so adopting
  it changes displayed numbers on purpose: a typical hand-rolled copy divided by 1,000,000 and
  emitted only `KB`/`MB`, so `4492333` renders `4.3 MB` where the local copy said `4.5 MB`, and the
  old shape rendered 1.5 GB as `1500.0 MB`. Do **not** pass `{ base: 1000 }` to preserve old numbers;
  pass it only when the figure sits beside something the user can also read in Finder.
- **`@chrismessina/raycast-downloader` consumers must get three things right, all of which pass
  local testing when wrong.** (1) Copy `dist/runner.bundle.js`, never `dist/runner.js`: the
  runner is spawned detached from `assets/` with no `node_modules`, and `runner.js` dies with
  `Cannot find module './curl'`. (2) The asset is named exactly `raycast-downloader-runner.js`,
  which `runnerCandidates()` looks for under `environment.assetsPath`; a misnamed asset works
  under `npm run dev` (the `cwd`/`node_modules` fallbacks resolve) and fails only in the Store
  build. (3) `assets/` is committed, because `ray publish` ships the extension root and the
  Store build never runs `copy-runner`. Enforce (1) and (2) with a `verify-runner` script that
  hashes the asset against the bundle and runs on the `publish` script, and prove it fails before
  trusting it (append a byte → exit 1; move the asset aside → exit 1). Do **not** write a
  consumer-side predicate for "is this partial safe to resume": the package records provenance
  beside the partial since 0.1.4 and decides itself; `fathom` tried four predicates, three were
  wrong, and each one stranded a half-downloaded file while defending against a rarer risk.
  Known rough edge (2026-09-16, unfixed): `withFileLockSync` runs its critical section
  unsynchronized when the lock cannot be acquired, so two consumers could both believe they hold
  a transfer; revisit before the first non-`fathom` adopter.

## Stranded extensions (real migration candidates)

| Extension | `@raycast/api` | `eslint` | `typescript` | Notes |
|---|---|---|---|---|
| `craftdocs` | `^1.47.3` | `^7.32.0` | `^4.4.3` | ESLint 7 predates flat config; 3 majors of ESLint + 2 of TS. Real work, not a version bump |
| `quick-call` | `^1.80.0` | `^8.22.0` | `^4.7.4` | ESLint 8 → 9 is the flat-config cutover |

Found by the 2026-07-13 census; everything else in the fleet was at or above the floor then.
Re-derive with the census script below before trusting the list.

## Migration rules

1. **One major at a time.** Never bump ESLint and TypeScript across majors in the same step.
2. **`npm run build`, then `npx tsc --noEmit`, then `npm run lint` after each major** — the
   order `rx gates` runs them, since the build generates `raycast-env.d.ts`. `ray lint` never
   typechecks and a plain `ray build` does not either (`ray build -e dist` does); `tsc --noEmit`
   is the gate reviewers run, so run it regardless of which build script the repo uses
   (house-style `tsc-gate`).
3. **ESLint 8 → 9 is the flat-config cutover**, not a version bump: `.eslintrc.*` →
   `eslint.config.js`. `@raycast/eslint-config` ≥ 2.x ships the flat config; pair the bump.
4. **The gate is not an instruction to migrate.** An extension on the floor stays there unless
   there is a reason to move; modernization is gated *because* it is disruptive.
5. **If a gate has moved** (ESLint 10 becomes the fleet default, say), propose an edit to the
   table and ask; then update the verified date.

## Re-running the census

To re-derive the table from ground truth rather than trusting the date:

```bash
cd "${EXTENSIONS_DIR:?set EXTENSIONS_DIR to the directory holding your extension checkouts}"
for d in raycast-*/package.json; do node -e '
const p=require(process.cwd()+"/"+process.argv[1]);
const dd={...(p.dependencies||{}),...(p.devDependencies||{})};
const g=k=>String(dd[k]??"-"), pad=(s,n)=>String(s).padEnd(n);
console.log([pad(p.name??"?",16),pad(g("@raycast/api"),12),pad(g("eslint"),10),pad(g("typescript"),10)].join(" "));
' "$d" 2>/dev/null; done | sort
```

Scope a kit or logger census to `.dependencies`, not a bare grep for the package name: the
package's own `package.json` matches on its `name` field and inflates the count by one.
