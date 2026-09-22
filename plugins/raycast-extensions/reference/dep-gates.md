# Dependency gates

Known-good dependency targets for Raycast extensions. Consulted by `develop`'s
**Intent 2 — Modernization** before any *major-version* migration, and by `ship`'s dep
hygiene to know where the non-breaking ceiling is.

- **Last verified:** 2026-09-17 for the `@chrismessina/raycast-downloader` row (floor moved to `^0.1.5`); 2026-09-15 for the `@chrismessina/raycast-logger` row (floor moved to `^1.5`); 2026-09-09 for the `@chrismessina/raycast-kit` row (floor moved to `^0.2.0`); 2026-08-27 for the `@raycast/api` row (floor moved to `^2.1`); 2026-08-25 for `@raycast/utils` /
  `@chrismessina/raycast-logger` (second adopter, `context7`, plus census of the
  13 fleet extensions that depend on it); 2026-08-21 for the `@raycast/api` /
  `@raycast/utils` rows (see the v2 section); 2026-07-13 for the rest, by census of all 34
  `chrismessina/raycast-*` working repos (`package.json` `dependencies` +
  `devDependencies`).
- **Drift guard:** gates never move silently. If `develop` finds a newer version is the
  real known-good target, it **proposes** the change and asks for confirmation before
  editing this file. Never trust a gate blind past its verified date.

## The two-tier model

A single "current version" number is a trap: it pushes every extension across a major
it never needed. So each dep carries **two** gates.

- **FLOOR** — the version that is *proven safe everywhere*. This is the dominant cluster
  across the fleet. An extension at or above the floor needs no migration. An extension
  *below* it is stranded and is a genuine migration candidate.
- **LEADING EDGE** — a newer major that is *proven, but not yet the default*. Named with
  the extensions that actually prove it. Migrating to the leading edge is a deliberate,
  gated choice — not routine hygiene.

**Non-breaking bumps within a tier are `ship`'s dep hygiene. Crossing a major — floor →
leading edge — is `develop`'s modernization intent, and it is gated on this file.**

> 🚨 **`@raycast/api` is the exception: its FLOOR is not a submission target.** Anything you
> submit must be the newest release **on the major line it is already on**, in both manifest
> and `package-lock.json` — the lockfile is what ships. The floor below exists so a
> *migration* knows what is safe fleet-wide; it is never permission to submit stale.
> `ship` enforces this as a blocking gate.
>
> **Scoped to the major on purpose — do not "simplify" it back to bare `latest`.** On
> 2026-08-20 `2.0.3` took the `latest` tag, and a gate keyed on `latest` instantly blocked
> every extension in the fleet and demanded a major migration inside a submission run.
> Crossing a major is `develop`'s job, gated here. Query the in-major target with
> `npm view "@raycast/api@^$MAJOR" version | tail -1`.
>
> The pinned versions in this table are a **snapshot, not an oracle** — they go stale by
> definition. Check the registry at submission time; if the table disagrees with `npm
> view`, the registry wins and this row needs updating.

> 🚨 **npm publishes `@raycast/api` ahead of the Raycast that can run it. Submitting npm's
> latest-in-major breaks installs for everyone.** The Store refuses an extension whose declared API
> is newer than the user's app — *"requires Raycast API v2.4.1. Update Raycast to install this
> extension"* — and when npm is ahead of every shipped app, there is nothing to update to.
>
> **Scope of "the registry wins" above: it settles what EXISTS, never what to SUBMIT.** The table
> going stale is a registry question. What is safe to ship is a runtime question, and npm cannot
> answer it.
>
> **There is no readable API ceiling — do not try to compute one.** The app bundle exposes no
> version key; the scaffolding template's range is a scaffold default, not a limit; other
> extensions' manifests are ranges, not the versions they resolve to. An earlier version of this
> callout offered two commands for this and neither answered the question.
>
> **The one decisive signal is that the version was actually RUN in the local Raycast.** If the
> extension loaded under `npm run dev`, that app supports that version.
>
> **So: submit the version the extension was last exercised at.** A ship-time bump is safe only if
> the extension is re-run in Raycast afterwards at the new version; if it will not be re-run, do not
> bump. Staleness is still worth blocking — but against the FLOOR in the table below, never against
> npm's newest.
>
> *(2026-09-15, `secret-browser-commands` 1.2.0: the currency check read 2.2.1 as BLOCKED against
> npm's 2.4.1 — published the day before — and prescribed the bump. It landed after all hands-on
> testing, so nothing ever ran it, and the merged Store release failed to install for every existing
> user: "0/1 installed 1/1 failed". Reverted in 1.2.1. The gate was right that stale APIs get
> bounced; it was wrong that npm defines current, and wrong to prescribe a version nobody had run.)*

## Gates

| Dependency | FLOOR (safe everywhere) | LEADING EDGE (proven, opt-in) | Proven on |
|---|---|---|---|
| `node` | 22 | — | local toolchain is v22.22.3 |
| `@raycast/api` | **`^2.1`** | — | 8 extensions on 2.x, incl. `store-updates` + `karakeep` (2.1.0, first with `Form` + `Grid`) and `context7` (first upstream, merged 2026-08-25). **Floor moved 1.x → `^2.1` on 2026-08-27, Chris confirmed** — see below |
| `@raycast/utils` | `^2.2` | `^2.3` | `ios-apps` (2.3.0), `context7` (2.3.0); `^1.17` still in use, see note below |
| `@chrismessina/raycast-logger` | **`^1.5`** | — | `attio`, `digger`, `ios-apps`, `karakeep`, `reader` (all 1.4.0); `fathom` on 1.5.0; **required before `@raycast/api` v2**. Floor moved `^1.4` → `^1.5` on 2026-09-15, Chris confirmed, now that 1.5.0 is published |
| `@chrismessina/raycast-kit` | **`^0.2.0`** | — | `threads` (0.2.0, first adopter of the `bytes` subpath); floor moved 0.1.4 → 0.2.0 on 2026-09-09, Chris confirmed. Still satisfies the `@raycast/api` v2 peer prerequisite — see below |
| `@chrismessina/raycast-downloader` | **`^0.1.5`** | — | `fathom` (0.1.5). Floor moved `^0.1.0` → `^0.1.5` on 2026-09-17, Chris confirmed: every release in between is a resume-path **correctness** fix, and an adopter below the floor corrupts files rather than merely missing a feature. Declares `@raycast/api` `^1.0.0 \|\| ^2.0.0`, so no companion bump for v2 — see below |
| `eslint` | `^9` | `^10` | `airbuddy` (10.5.0), `tesla-energy` (10.1.0) |
| `typescript` | `^5.9` | `^6` | `airbuddy` (6.0.3), `tesla-energy` (6.0.2) |
| `@raycast/eslint-config` | `^2.1` | `^2.2` | `airbuddy` (2.2.0) |
| `prettier` | `^3` | — | fleet-wide |
| `@types/react` | `^19` | — | fleet-wide |

### `@raycast/utils` — a split, not a gate

The fleet is genuinely split between `^1.17` and `^2.2`, and **v1 extensions are not
stranded** — they're just on the older major. Treat a `^1.17` → `^2.2` move as a real
migration (v2 changed hook signatures), not a hygiene bump. Don't bulk-migrate; do it
when the extension is being worked on anyway.

### `@raycast/api` v2 — leading edge is `^2.1` (assessed 2026-08-27)

`2.1.0` holds the `latest` tag. **Target `^2.1.0` for every new extension and every
migration — do not adopt `^2.0`.**

**The floor moved to `^2.1` on 2026-08-27 (Chris confirmed), and it is deliberately
aspirational rather than descriptive.** 33 of 41 fleet extensions were still on 1.x when
it moved, so this is the one row where FLOOR does *not* mean "the dominant cluster" — it
means "where everything should land as it is next touched." Read it that way before
treating a 1.x extension as stranded: those 33 are not broken and do not need an urgent
migration, they are simply below the target. Migrate one when it is being worked on
anyway, which is what `karakeep` did.

**Why `^2.1` and not `^2.0`: 2.1.0 walks back 2.0's two gratuitous breaks.** `Icon` is an
`enum` again (2.0 split it into `const Icon` + `type Icon`), and the deprecated
`KeyboardShortcutV1` alias is named `KeyboardShortcut` again — both restored to their
1.104.25 shapes. It also adds member namespaces on `Toast.Style` and `Alert.ActionStyle`
(`Toast.Style.Success` et al. usable as types) and 8 more deprecated `AI.Model` aliases.
`package.json` is byte-identical to 2.0.6; the whole `.d.ts` delta is 80 lines.

**Both personal packages already accept 2.1** — `@chrismessina/raycast-logger@1.4.0` and
`@chrismessina/raycast-kit@0.1.4` each declare `"@raycast/api": "^1.0.0 || ^2.0.0"`, which
covers `2.1.0`. Verified 2026-08-27: `api@^2.1` + `logger@1.4.0` + `kit@0.1.4` installs
clean, no ERESOLVE. No companion bump is needed to move to `^2.1`.

> ⚠️ **`Icon.Quicklink` does not exist in 2.0.3 or 2.0.4** — it was removed there and
> restored in 2.0.5. Those two versions are the only ones in the whole line missing an
> icon, which is reason enough never to pin them.

Verified 2026-08-27 on `claude-artifacts` (which uses `icon?: Icon` in type position — the
case the enum revert could plausibly break): 2.0.6 → 2.1.0 gave `tsc --noEmit` exit 0,
`ray build` exit 0, `ray lint` exit 0, **zero source changes**. `store-updates` and
`karakeep` were already on 2.1.0 the day it shipped and both typecheck clean.

The 2026-08-20 assessment below still describes the 1.x → 2.x change accurately — what
moved is the target, not the risk assessment.

What the original assessment found, by diffing the shipped `.d.ts` files and building a
real extension against v2:

- **It is a soft major.** `engines` (node ≥22.22.2) and `peerDependencies`
  (`@types/node`, `@types/react` 19, `react-devtools`) are **byte-identical** to 1.104.23.
  No Node or React migration.
- **Nothing we rely on was removed.** `Keyboard.Shortcut.Common` survives with the same
  17 members; `showToast`, `secondaryAction`, `showInFinder`, `Action.ShowInFinder`,
  `LocalStorage`, `Cache`, `updateCommandMetadata`, `environment.launchType` /
  `LaunchType` are all intact and undeprecated.
- **The renames are the "command → entry point" shift**, reflecting that an extension now
  exposes tools as well as commands: `environment.commandName` → `entryPointName`,
  `environment.commandMode` → `entryPointMode`, plus new `entryPointType: "command" | "tool"`.
  Old names are **deprecated aliases that still work**. Same for `KeyboardShortcut` →
  `KeyboardShortcutV1` (canonical `Keyboard.Shortcut` is unchanged) and a batch of
  `AI.Model.*` constants → `AI.Model["..."]` bracket form.

**The first 2.x extension in `raycast/extensions` merged clean (2026-08-25).** `context7`
PR [#30501](https://github.com/raycast/extensions/pull/30501) carried `@raycast/api` 2.0.5
upstream and was merged by `raycastbot` at 06:54 UTC — CI green, Greptile 5/5, no reviewer
comment on the major bump. **That retires the "no upstream extension is on 2.x" re-assess
trigger.** One guide trigger is still unmet: `developers.raycast.com/migration/v2` continues
to 404, so the migration below remains verified by diffing `.d.ts` files, not by following
docs.

> 📌 **SUPERSEDED 2026-09-06 — the floor IS `^2.1`.** This callout recorded an interim
> position (floor left at `^1.104`, leading edge `^2.1`) that Chris overrode the same day it
> was written; the operative rule is the one above at "The floor moved to `^2.1` on
> 2026-08-27": the floor is *aspirational* for this row only, and a 1.x extension is
> *below target*, not *stranded*. The reasoning below is kept because the stranded-vs-below-
> target distinction it argues for is exactly what the operative rule adopts.
>
> ~~The floor is a separate question and is left at `^1.104` deliberately. The floor is
> descriptive — "the dominant cluster, safe everywhere" — not a target. Moving it to `^2.1`
> while 33 of 41 extensions sit on 1.104 would reclassify all 33 as stranded by this file's
> own definition, putting them in the same bucket as `craftdocs` (`^1.47`) and `quick-call`
> (`^1.80`), which are genuinely three majors behind.~~
>
> Still true, and worth weighing before a broad migration: nothing in the fleet has exercised
> v2's `Form` or OAuth paths, and the first upstream adopter was a fork Chris contributes to
> rather than one he owns — the risk landed on someone else's extension, which is a thing to
> weigh deliberately next time, not to repeat by default.

Verified on that migration, against the shipped 2.0.5 `.d.ts`: all 17
`Keyboard.Shortcut.Common` members unchanged, and `canAccess`, `AI.ask`,
`Tool.Confirmation`, `launchCommand`, `LocalStorage`, `supportPath` all present with the
same shapes. `tsc`, `ray build`, and `ray lint` passed with **zero source changes** —
consistent with the soft-major assessment above. `npx ray migrate` is not usable: it
spawns `@raycast/migration@latest`, which fails `ENOENT`.

**Why the hold lifted (2026-08-21, one day later).** The 2.x line is now shipping faster
than 1.x: `2.0.4` and `2.0.5` both landed on 2026-08-21, against `1.104.25` on 2026-08-18.
That is the "1.x is winding down" signal the hold was waiting for. Note the other two
re-assess triggers are **still unmet** — `developers.raycast.com/migration/v2` continues
to 404, and no upstream extension in `raycast/extensions` is on 2.x — so an adopter is
still the first one there, and any Store-review or CI surprise is theirs to debug. *(This
paragraph predates the 2026-08-27 floor move; the floor is now `^2.1`, see above.)*

> ⛔ **Prerequisite: `@chrismessina/raycast-logger` must be `^1.4.0` first.** Through
> 1.3.0 the logger declared `peerDependencies: { "@raycast/api": "^1.0.0" }`, which does
> not match 2.x. Installing them together is a hard `npm error code ERESOLVE`, not a
> warning — the install fails outright. 1.4.0 widens the range to `^1.0.0 || ^2.0.0`.
> Verified both directions on 2026-08-24: `logger@1.3.0 + @raycast/api@2.0.5` → ERESOLVE;
> `logger@1.4.0 + @raycast/api@2.0.5` → clean install. Bump the logger *before* attempting
> the v2 migration, or the failure will look like a v2 problem when it is not.

- **Verified on `ios-apps`, 2026-08-21:** `^2.0.5` with `tsc --noEmit` exit 0, `ray build`
  exit 0, `ray lint` 0 problems, **zero source changes**. A grep for every deprecated alias
  (`commandName`, `commandMode`, `KeyboardShortcut`, `AI.Model.`) found no uses, so nothing
  in that extension depends on the compatibility shims.

**Fleet exposure if others move:** effectively zero. The only `environment.commandName` use
is in `change-case`, which is a fork (author `erics118`), and it is a deprecation, not a
removal. `raycast-reader`'s `commandName` is its own local prop, unrelated to the API.

~~**Move the FLOOR to `^2.1` when** 2.x becomes the dominant cluster.~~ **Done 2026-08-27**
— the floor moved ahead of the cluster, deliberately (see the top of this section). What
remains is the migration cadence: move a 1.x extension when it is being worked on anyway,
and do not bulk-migrate. (`developers.raycast.com/migration/v2` still 404s; migrations are
verified by diffing `.d.ts`, not by following docs.)

### `@chrismessina/raycast-logger` — floor is `^1.5` (moved 2026-09-15)

First-party, so the gate behaves differently from the third-party rows: there is no
upstream to wait on, and a fix here reaches extensions only when each one regenerates its
lockfile. **The manifest range is not what ships — the lockfile is.** An extension pinned
to `^1.x` still resolves to whatever its lockfile says until someone reinstalls.

**Two reasons the floor is `^1.4` rather than the dominant cluster:**

1. **`@raycast/api` v2 is impossible below it** — hard ERESOLVE, see the callout above.
2. **1.3.0 was a security release.** It closed a fail-open where `sanitizeArgs` returned
   the *original unredacted object* whenever serialization threw, a `toJSON()` bypass that
   moved a credential onto an innocent key, and credentials embedded in URL userinfo and
   query parameters. 1.4.0 adds v2 support and stops the redaction heuristic masking REST
   paths, filesystem paths, and Docker image names as base64.

**1.5.0 published, and the floor moved to it on 2026-09-15 (Chris confirmed).** The
2026-09-06 note here said the target was 1.5 and it was not yet on npm; that is resolved.
`npm view @chrismessina/raycast-logger version` returned `1.5.0`, and `fathom` installs it
clean alongside `@raycast/api` 2.2.1. Seven of the eleven extensions that use the logger sit below the floor
(`brew`, `threads-client`, `fetch`, `fly`, `tesla-energy`, `bookface`, `fathom`); four are
at `^1.4` (`digger`, `ios-apps`, `karakeep`, `reader`). The 2026-08-24 hold waited for
logger 2.0 so the fleet would not be bumped twice; it was lifted because the seven are
still on the redaction that had the critical `toJSON` fail-open, and for a default-config
consumer both bumps are lockfile-only. **1.5.0 adds opt-in strict redaction** (a
per-extension `strictRedaction` preference that masks URL query strings) and changes no
default behavior. It also exports `redactString(s, { level })` directly, which is the
supported way to scrub a server-supplied string before logging it — reach for that rather
than hand-rolling a URL regex (`fathom` does this for Fathom's `failure_reason`).

**So, when working in an extension that uses the logger:**

- Below the floor → bump to `^1.5.0`, stage only `package.json` and `package-lock.json`,
  verify the lockfile moved. Procedure and the per-repo `code`-key probe are in the logger
  repo's `TODO.md` rollout section. (The earlier "leave it until 1.5 publishes" hold is
  retired — 1.5.0 is on npm.)
- Moving to `@raycast/api` v2 → **bump the logger first.** That is a hard prerequisite, not
  a preference: ≤1.3.0 is an outright ERESOLVE against 2.x.
- Already at `^1.4` → bump to `^1.5` opportunistically; not urgent.

Revisit the whole row again when
logger 2.0 ships; it is a major with a new emission path (records and transports
replacing direct `console` calls), so it will be a genuine migration with its own
leading-edge tier, not a hygiene bump.

### `@chrismessina/raycast-kit` — floor is `^0.2.0` (moved 2026-09-09)

`0.2.0` adds a **`bytes` subpath** — `formatBytes` and `formatSpeed` — which is where the
floor move comes from: it replaces a hand-rolled byte formatter in every extension that
shows a download or file size, and those copies had already drifted apart.

**Its default convention differs from most hand-rolled copies, deliberately.** The kit
defaults to base-1024 with one decimal from KB up (developer-tooling convention, matching
the rest of the fleet); a typical local copy divided by 1,000,000 and emitted only `KB`/`MB`.
So adopting it *changes displayed numbers* — `4492333` renders `4.3 MB` where the local copy
said `4.5 MB` — and gains `B`/`GB`/`TB`, which is the point: the old shape rendered 1.5 GB as
`1500.0 MB`. Do **not** pass `{ base: 1000 }` to preserve old numbers; pass it only when the
figure sits next to something the user can also read in Finder.

> ⚠️ **The `bytes` subpath needs `moduleResolution: Node16`.** The scaffold default
> (`module: commonjs`, no `moduleResolution`) is node10 and ignores `exports` maps, so the
> import fails `TS2307` with a message about your `moduleResolution` setting. `"bundler"` is
> **not** the fix — it is rejected unless `module` is `es2015`+ (`TS5095`). Set
> `"module": "Node16"` + `"moduleResolution": "Node16"`, as `store-updates` and `fathom`
> already do. Verified on `threads` 2026-09-09: those two keys alone, zero source changes,
> `tsc`/`ray build`/`ray lint` all clean. Full rationale in `house-style.md`'s pure-TS
> subpaths rule.

Adopting the kit at `^0.2.0` also satisfies the `@raycast/api` v2 peer prerequisite below,
so a v2 migration needs no separate kit bump.

### `@chrismessina/raycast-kit` — the second v2 peer-range prerequisite

> 📌 **Resolved.** The 2026-08-25 note here said 0.1.4 was not yet on npm. It published, and
> `0.2.0` is now the floor (see the section above). `npm view @chrismessina/raycast-kit
> version` returned `0.2.0` on 2026-09-09.

Same shape as the logger callout above, and it bit for the same reason: through **0.1.3**
the kit declared `peerDependencies: { "@raycast/api": "^1.0.0" }`, which does not match 2.x.
0.1.4 widens it to `^1.0.0 || ^2.0.0`. **No code change was needed** — the kit's entire
`@raycast/api` surface is `Clipboard`, `Toast`, and `showToast`, all unchanged and
undeprecated in v2. Verified by building and running the suite against both majors: 83/83
under 1.104.x, 83/83 under 2.0.6.

> 🚨 **It fails DIFFERENTLY from the logger, and the difference matters.** The logger at
> 1.3.0 produced a hard `ERESOLVE` — the install aborts and you cannot miss it. The kit at
> 0.1.3 produces only `npm warn ERESOLVE overriding peer dependency`, and **the install
> succeeds**. The damage shows up one step later: `npm ls` reports the tree
> `invalid: "^1.0.0" from node_modules/@chrismessina/raycast-kit` and exits `ELSPROBLEMS`,
> and the lockfile you would ship contains a package declaring itself incompatible with the
> API version sitting next to it. A green `tsc` / `ray build` / `ray lint` says nothing about
> this — all three passed on the invalid tree.
>
> **So checking for a failed install is not sufficient. Run `npm ls @raycast/api` after any
> v2 bump** and require a clean exit, not just a successful `npm install`.

**Before migrating any kit-consuming extension to `@raycast/api` v2, bump the kit to
`^0.1.4` first** — otherwise the failure looks like a v2 problem when it is not. As of
2026-08-25 **five** extensions depend on the kit, all pinned `^0.1.3`: `claude-artifacts`,
`fathom`, `fetch`, `get-app-icon`, `store-updates`. Widening a peer range is
backward-compatible, so none of them are affected by the bump itself. Re-census with:

```bash
: "${EXTENSIONS_DIR:?set EXTENSIONS_DIR to the directory holding your extension checkouts}"
for d in "$EXTENSIONS_DIR"/*/; do p="$d/package.json"; [ -f "$p" ] || continue
  v=$(jq -r '(.dependencies // {})["@chrismessina/raycast-kit"] // empty' "$p")
  [ -n "$v" ] && echo "${d%/}  $v"; done
```

Scope that to `.dependencies`, not a bare `grep` for the package name — the kit's own
`package.json` matches on its `name` field and inflates the count by one.

### `@chrismessina/raycast-downloader` — floor is `^0.1.5` (moved 2026-09-17)

First-party. Detached, resumable downloads of large files that survive the Raycast command
being unloaded — built for `fathom`'s 250–650 MB recording downloads and intended for reuse
in `ios-app-search` and `fetch`. Published 2026-09-16; the floor is `0.1.5`.

> 🚨 **Below `^0.1.5` this package CORRUPTS FILES on resume. The floor is not a preference.**
> Each release between 0.1.0 and 0.1.5 fixes a distinct way a resumed transfer appends real
> bytes onto bytes that do not describe what the server is about to send, and every one of
> them fails silently — exit 0, a plausible file size, a corrupt payload:
>
> - **0.1.2** — an unfollowed 3xx leaves the redirect BODY in the `.part`; the rollback that
>   trims it swallowed its own failure, so `curl -C -` spliced the download onto HTML.
> - **0.1.3** — `partialUnsafe`, so contamination is machine-checkable rather than a sentence
>   glued onto an error message.
> - **0.1.4** — provenance in `<partPath>.state` plus `If-Range` on every resume. `curl -C -`
>   asserts the bytes on disk are a correct prefix and **nothing downstream can check that**:
>   measured against a Range-capable server, an 8-byte garbage prefix resumes to exit 0,
>   HTTP 206, and a wrong file.
> - **0.1.5** — validators were parsed per-FIELD across the redirect chain instead of
>   per-BLOCK, so a 302's `ETag` described bytes it had never seen.

> ⚠️ **It was `@chrismessina/raycast-download` until publication.** The name was taken, so
> the package is `raycast-downloader`. Anything written against the old name — an import, a
> `copy-runner` path, an asset filename — is stale. The local repo directory may still carry
> the old name; the package name is what matters.

**Three things a consumer must get right. All three fail in ways that pass local testing.**

1. **Copy `dist/runner.bundle.js`, never `dist/runner.js`.** The runner is spawned as a
   detached process from the consumer's `assets/`, where it has no siblings and no
   `node_modules`. `runner.js` is `tsc` output that requires `./curl`, `./status`, `./paths`
   — copying it out of `dist` copies a broken program that dies with `Cannot find module
   './curl'` before a single byte transfers. `runner.bundle.js` is the self-contained build.
   *(This shipped: every fathom download failed from inception until 2026-09-15. Finding an
   artifact and that artifact being runnable are different properties, and only the first
   one had a test.)*

2. **The asset MUST be named `raycast-downloader-runner.js`.** `runnerCandidates()`
   (`dist/detach.js`) searches `environment.assetsPath` for exactly that filename. In a
   bundled, published extension `assetsPath` is the only dependable anchor — `__dirname` is
   the bundle and `node_modules` is not shipped — so a misnamed asset falls through every
   remaining candidate and fails as `runner_failed`. **Under `npm run dev` it still works**,
   because the `cwd`/`node_modules` fallbacks resolve on a dev machine. So this breaks *only*
   in the Store build, which is the worst place to find it. *(Nearly shipped on fathom
   2026-09-16: the package rename left the asset on the old name with byte-identical
   contents.)*

   The consumer's `copy-runner` script, verbatim:

   ```
   node -e "const p=require('path'),f=require('fs'),s=p.join('node_modules','@chrismessina','raycast-downloader','dist','runner.bundle.js');if(!f.existsSync(s))throw new Error('Missing '+s+' — run the package build.');f.copyFileSync(s,p.join('assets','raycast-downloader-runner.js'))"
   ```

   Wire it into `build` and `dev` (`"build": "npm run copy-runner && ray build"`), and
   **verify the copied artifact runs from an empty directory** rather than trusting a green
   build:

   ```bash
   T=$(mktemp -d); cp assets/raycast-downloader-runner.js "$T/runner.js"
   (cd "$T" && node runner.js; echo "exit=$?")   # exit=2, no "Cannot find module" = self-contained
   ```

   `exit 2` is correct — the runner refuses to start without a payload path
   (`dist/runner.js:27-29` in 0.1.5). A `Cannot find module` is the defect in item 1.

> ✅ **Rules 1 and 2 are both enforceable — stop relying on care.** Both failed anyway, and
> each was caught by hand at a different stage. A hash check turns either into a loud
> failure, and it belongs on **`publish`**, not `build`: `copy-runner` already runs on
> `build` and `dev`, which are the paths where a mistake is harmless, and the Store build
> runs neither. Add to the consumer's `scripts`:
>
> ```
> "verify-runner": "node -e \"const f=require('fs'),p=require('path'),c=require('crypto');const a=p.join('assets','raycast-downloader-runner.js'),b=p.join('node_modules','@chrismessina','raycast-downloader','dist','runner.bundle.js');const h=x=>{if(!f.existsSync(x))throw new Error('Missing '+x);return c.createHash('sha256').update(f.readFileSync(x)).digest('hex')};const A=h(a),B=h(b);if(A!==B){console.error('Runner asset is STALE.\\n  asset : '+A+'\\n  bundle: '+B+'\\nRun: npm run copy-runner');process.exit(1)}console.log('runner asset matches ('+A.slice(0,12)+')')\"",
> "publish": "npm run verify-runner && npx @raycast/api@latest publish"
> ```
>
> **Prove it fails before trusting it** — append a byte to the asset and confirm exit 1, and
> move the asset aside and confirm exit 1. A guard that cannot fail is worse than none.
> Shipped on `fathom` 2026-09-17; it would have caught both incidents above without a human.

3. **`assets/` is not gitignored, and the runner is ~84 KB of generated JavaScript.** It has
   to be committed, because `ray publish` ships the extension root and the Store build never
   runs `copy-runner`.

**Do NOT write a consumer-side guard on resume safety. The consumer cannot see what the
sidecar sees.**

`fathom` tried four predicates for "is this partial safe to resume" and three were wrong —
each shipped, each was caught by an adversarial review, and each did DAMAGE while failing:

| Predicate | Why it was wrong |
| --- | --- |
| `error.httpStatus` is 3xx | a rollback that SUCCEEDS still carries a 3xx, and a 304 leaves the original bytes perfectly valid |
| `bytesDownloaded === 0` | also zero after an early network failure that had written real bytes |
| `partialUnsafe` on the status | a status is addressed by id and a retry takes a NEW id, so it was never readable |
| *(none — let the package decide)* | correct |

**The failure mode is the part worth remembering.** Rejecting a partial did not clean it
up. It allocated a fresh filename via `uniquePath`, downloaded a second copy, and left the
original — possibly hundreds of megabytes — orphaned in the user's directory. So a guard
meant to prevent rare corruption reliably wasted disk and bandwidth on a common path. **A
guard that strands data on the common path is a worse trade than the pathological risk it
defends against**, and that arithmetic is easy to miss while writing the guard, because the
risk is vivid and the cost is invisible.

Since 0.1.4 the package records provenance beside the partial and decides resume, reset or
fail itself. A consumer should select a candidate on what it can actually know — a terminal
transfer for this recording, final output path free, partial non-empty — and hand the path
over. Anything more is second-guessing a decision made with information the consumer does
not have.

**Peer range is already v2-ready:** `"@raycast/api": "^1.0.0 || ^2.0.0"`. It does not repeat
the logger ≤1.3.0 / kit ≤0.1.3 mistake, so no companion bump is needed for an
`@raycast/api` v2 migration. Verified 2026-09-16: `downloader@0.1.0` + `api@2.2.1` installs
clean and `npm ls @raycast/api` exits 0.

**Known rough edge, not yet fixed (2026-09-16).** `withFileLockSync` (`src/lock.ts`) runs its
critical section *unsynchronized* when the lock cannot be acquired — a deliberate "never
fatal" choice. That is also exactly when `acquireLease`'s compare-and-swap stops guaranteeing
a single owner, so two consumers could both believe they hold a transfer. Surfaced by Codex
on the fathom adoption rewrite; declined there because it needs a filesystem lock failure to
reach. Revisit before the first non-fathom adopter.

## Stranded extensions (real migration candidates)

Found by the 2026-07-13 census — these sit *below* the floor and are the honest targets
of `develop`'s modernization intent:

| Extension | `@raycast/api` | `eslint` | `typescript` | Notes |
|---|---|---|---|---|
| `craftdocs` | `^1.47.3` | `^7.32.0` | `^4.4.3` | Badly stranded. ESLint 7 predates flat config entirely; a migration here is 3 majors of ESLint + 2 of TS. Expect real work, not a version bump. |
| `quick-call` | `^1.80.0` | `^8.22.0` | `^4.7.4` | Stranded. ESLint 8 → 9 is the flat-config cutover. |

Everything else in the fleet is at or above the floor.

## Migration rules

1. **One major at a time.** Never bump ESLint and TypeScript across majors in the same
   step — when it breaks you won't know which one did it.
2. **Build + lint + `tsc --noEmit` after each major.** All three. `ray build` (esbuild)
   does *not* typecheck — a green build is not evidence the code compiles. (See the
   `[both]` tsc rule in `house-style.md`.)
3. **ESLint 8 → 9 is the flat-config cutover**, not a version bump. `.eslintrc.*` →
   `eslint.config.js`. Budget for it. `@raycast/eslint-config` ≥ 2.x ships the flat
   config; pair the bump.
4. **The gate is not an instruction to migrate.** An extension sitting happily on the
   floor should stay there unless there's a reason to move. Modernization is gated
   *because* it's disruptive, not encouraged because it's available.
5. **If you discover a gate has moved** (e.g. ESLint 10 becomes the fleet default),
   propose an edit to this table and ask for confirmation. Then update "last verified."

## Re-running the census

To re-derive this table from ground truth rather than trusting the date:

```bash
cd "${EXTENSIONS_DIR:?set EXTENSIONS_DIR to the directory holding your extension checkouts}"
for d in raycast-*/package.json; do node -e '
const p=require(process.cwd()+"/"+process.argv[1]);
const dd={...(p.dependencies||{}),...(p.devDependencies||{})};
const g=k=>String(dd[k]??"-"), pad=(s,n)=>String(s).padEnd(n);
console.log([pad(p.name??"?",16),pad(g("@raycast/api"),12),pad(g("eslint"),10),pad(g("typescript"),10)].join(" "));
' "$d" 2>/dev/null; done | sort
```
