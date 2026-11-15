---
title: "How the @raycast/api dependency policy got to where it is (2026-07 → 2026-10)"
date: 2026-10-31
category: tooling-decisions
module: publishing
component: development_workflow
problem_type: tooling_decision
severity: high
applies_to: ["ship", "develop", "api-changelog"]
trigger: "when you are about to bump, floor, or migrate @raycast/api and want to know why the policy says what it says"
applies_when:
  - "A dependency gate reports `@raycast/api` behind npm and you are tempted to bump at ship time"
  - "Deciding whether an existing 1.x extension is stranded or merely below target"
  - "Migrating an extension from `@raycast/api` 1.x to 2.x, or scaffolding a new one"
  - "Reading an older receipt or incident that cites a floor, target or hold this file no longer states"
tags:
  - raycast
  - raycast-api
  - dependency-policy
  - store-submission
  - ship
  - migration
related_components:
  - documentation
---

# How the `@raycast/api` dependency policy got to where it is

**Operative policy lives in [`reference/dep-gates.md`](../../reference/dep-gates.md) and, in machine
form, in the `dependencies` block of [`presets/chrismessina.json`](../../presets/chrismessina.json),
enforced by `rx api-floor`.** This file is the chronology: every earlier rule, the incident that
moved it, and the receipt. Nothing here is an instruction; where an earlier rule is quoted, it is
quoted as history.

## The policy today (2026-10-20, Chris)

Existing extensions stay on their major unless migrating; the 1.x floor is `1.104.25`. New
extensions start on 2.x (floor `2.1.0`) and are never rolled back. Submit the version last
exercised in Raycast; npm's newest is advisory. Crossing a major is `develop`'s migration.

## Chronology

### 2026-07-13 — the two-tier model and a census

A census of all 34 `chrismessina/raycast-*` working repos set the first table: FLOOR = the
dominant cluster, proven safe everywhere; LEADING EDGE = a newer major proven by named
extensions. `@raycast/api` floor `^1.104`; `craftdocs` (`^1.47.3`) and `quick-call` (`^1.80.0`)
were the only stranded extensions.

### 2026-08-20 — a gate keyed on `latest` blocked the whole fleet

`ship`'s currency check compared the lockfile against `npm view @raycast/api version`, bare
`latest`. The day `2.0.3` took the `latest` tag, every extension in the fleet (all on 1.104.x) was
BLOCKED and told to perform an unreviewed major migration inside a submission run, which
`dep-gates.md` assigns to `develop`. On that day every extension in `raycast/extensions` was still
on 1.x and the 1.x line was still shipping (`1.104.25`). **Rule adopted:** scope the comparison to
the current major (`npm view "@raycast/api@^$MAJOR" version`). A gate keyed on `latest` converts
someone else's major release into your emergency.

The same day's assessment of 2.x, by diffing the shipped `.d.ts` and building a real extension
against it: a **soft major**. `engines` and `peerDependencies` byte-identical to 1.104.23; nothing
relied on was removed (`Keyboard.Shortcut.Common` kept its 17 members; `showToast`,
`secondaryAction`, `showInFinder`, `LocalStorage`, `Cache`, `updateCommandMetadata`,
`environment.launchType` intact); the renames are the "command → entry point" shift
(`environment.commandName` → `entryPointName`, `commandMode` → `entryPointMode`, new
`entryPointType`), all kept as deprecated aliases, plus `KeyboardShortcut` → `KeyboardShortcutV1`
and `AI.Model.*` → bracket form. A hold was placed: wait for a sign that 1.x was winding down.

### 2026-08-21 — the hold lifted; `ios-apps` verified on `^2.0.5`

`2.0.4` and `2.0.5` both landed on 2026-08-21 against `1.104.25` on 2026-08-18: the 2.x line was
shipping faster. `ios-apps` on `^2.0.5`: `tsc --noEmit` 0, `ray build` 0, `ray lint` 0, zero
source changes, no uses of any deprecated alias. Fleet exposure: the only `environment.commandName`
use was in `change-case`, a fork. Two re-assess triggers stayed unmet (`developers.raycast.com/migration/v2`
404s; no upstream extension on 2.x). `npx ray migrate` was unusable: it spawns
`@raycast/migration@latest`, which fails `ENOENT`. That stayed true through 2.10.1, where it was
observed again on 2026-11-04. 2.11.0 runs the package through `npx` instead, but that 2.11.0 call has
not been run. See the 2.11.0 entry in
[`docs/reference/raycast-api-changelog.md`](../../../../docs/reference/raycast-api-changelog.md).

### 2026-08-24 / 2026-08-25 — the two peer-range prerequisites

- `@chrismessina/raycast-logger` ≤ 1.3.0 declared `peerDependencies: { "@raycast/api": "^1.0.0" }`:
  a hard `npm error code ERESOLVE` beside 2.x. 1.4.0 widened it to `^1.0.0 || ^2.0.0`. Verified
  both directions on 2026-08-24 (`logger@1.3.0 + api@2.0.5` → ERESOLVE; `logger@1.4.0 + api@2.0.5`
  → clean). 1.3.0 had also been a security release (a fail-open in `sanitizeArgs` returning the
  unredacted object when serialization threw, a `toJSON()` bypass, credentials in URL userinfo and
  query parameters).
- `@chrismessina/raycast-kit` ≤ 0.1.3 declared the same `^1.0.0` range but **failed softly**:
  `npm warn ERESOLVE overriding peer dependency`, the install succeeds, and `npm ls` reports the
  tree `invalid` (`ELSPROBLEMS`) while `tsc`/`ray build`/`ray lint` all pass on the invalid tree.
  0.1.4 widened the range; no code change was needed (the kit's whole API surface is `Clipboard`,
  `Toast`, `showToast`), 83/83 tests under both majors. **Rule adopted:** `npm ls @raycast/api`
  must exit clean after a 2.x bump; a successful install proves nothing.
- `context7` PR #30501 carried `@raycast/api` 2.0.5 into `raycast/extensions` and was merged by
  `raycastbot` on 2026-08-25 at 06:54 UTC, CI green, Greptile 5/5, no reviewer comment on the major bump. That
  retired the "no upstream extension is on 2.x" trigger. The first upstream adopter was a fork
  Chris contributes to, not one he owns: the risk landed on someone else's extension, which is a
  thing to weigh deliberately next time, not to repeat by default.

### 2026-08-27 — the floor moved to `^2.1`, deliberately ahead of the cluster

`2.1.0` took `latest` and walked back 2.0's two gratuitous breaks: `Icon` is an `enum` again (2.0
split it into `const Icon` + `type Icon`) and the deprecated alias is `KeyboardShortcut` again,
both restored to their 1.104.25 shapes; it added member namespaces on `Toast.Style` and
`Alert.ActionStyle` and 8 more deprecated `AI.Model` aliases; `package.json` byte-identical to
2.0.6; the whole `.d.ts` delta was 80 lines. Verified on `claude-artifacts` (which uses
`icon?: Icon` in type position): 2.0.6 → 2.1.0 with zero source changes. `store-updates` and
`karakeep` were on 2.1.0 the day it shipped.

Chris confirmed moving the `@raycast/api` floor to `^2.1` while 33 of 41 fleet extensions were
still on 1.x, so for this one row FLOOR stopped meaning "the dominant cluster" and meant "where
everything should land as it is next touched": a 1.x extension was *below target*, not
*stranded*, and was to be migrated when being worked on anyway (as `karakeep` was), never in bulk.
**Never pin `2.0.3` or `2.0.4`:** `Icon.Quicklink` was removed there and restored in 2.0.5.

### 2026-08-28 — currency can change within a session

`2.1.1` and `2.1.2` landed within hours of each other. `ship` therefore re-ran the currency check
immediately before the publish, not only at the top of the pre-flight. (`rx api-floor` now runs
inside `rx gates`, whose receipt is tied to the tree; the advisory is recomputed on every run.)

### 2026-09-06 — an interim position written and overridden the same day

A callout proposed leaving the floor at `^1.104` (descriptive) with `^2.1` as leading edge, so that
the 33 1.x extensions would not be reclassified as stranded beside `craftdocs` and `quick-call`.
Chris overrode it the same day: the floor stayed `^2.1`, aspirational for this row only. The
stranded-versus-below-target distinction the callout argued for is what the operative rule
adopted; the callout itself was marked superseded and lived in `dep-gates.md` until 2026-10-31,
when the plugin rewrite removed every superseded instruction from reference files.

### 2026-09-15 — submitting npm's newest broke installs for every user

`secret-browser-commands` 1.2.0: the currency check read the lockfile's 2.2.1 as BLOCKED against
npm's 2.4.1, published the day before, and prescribed the bump. It landed after all hands-on
testing, so nothing ever ran it, and the merged Store release failed to install for every existing
user ("0/1 installed 1/1 failed"): *"requires Raycast API v2.4.1. Update Raycast to install this
extension"*, with no Raycast to update to. Reverted in 1.2.1. **Rules adopted:** npm publishes
`@raycast/api` ahead of the app that can run it; there is no readable API ceiling (the app bundle
exposes no version key, the scaffold template's range is a default, other manifests are ranges);
the one decisive signal is that the version was actually run in the local Raycast; so **submit
the version last exercised**, block staleness against the FLOOR only, and treat npm currency as
advisory. The gate was right that stale APIs get bounced and wrong that npm defines current.

### 2026-10-20 — new extensions start on 2.x; 1.x is a suggestion for large ones

`dev-null` had been rolled back to 1.104.25 under a rule that required a 2.x-only feature to
justify 2.x. Chris: *"I don't like this rule — banish it. Keep it as a suggestion for LARGE/popular
extensions. I want all my new extensions to be on the cutting edge going forward."* The suggestion
exists because declaring 2.x makes the Store refuse an *update* for everyone still on Raycast 1.x,
a cost that scales with installs (the prompting case: `google-search`, 151K installs, 2026-10-10;
Greptile cited Raycast staff's "Restore Qobuz compatibility with Raycast 1.x", #31899, and raised
a 1.x P1 on `google-search` #32169). The agent mentions it in the report and Chris decides; the
agent never blocks, rolls back or demands a declaration on its own.

### 2026-10-30 / 2026-10-31 — the policy became data

The plan for `raycast-harness` resolved the three policies that `dep-gates.md` had accumulated
(newest-in-major; last-exercised; `^2.1` for everyone) into one, written as the preset's
`dependencies` block: `existing-1x` floor `1.104.25`, `2x` floor `2.1.0`, `new: "2x"`. `rx api-floor`
reads only that; `dep-gates.md` keeps one policy paragraph plus the table; this file keeps the
history.

## Companion-package floors (for the migration order)

| Package | Floor | Moved | Why |
|---|---|---|---|
| `@chrismessina/raycast-logger` | `^1.5` | 2026-09-15 | 1.5.0 published (opt-in `strictRedaction`, `redactString` export); seven of eleven users were still on the redaction with the `toJSON` fail-open; both bumps lockfile-only for a default-config consumer. An earlier hold had waited for logger 2.0 so the fleet would not be bumped twice |
| `@chrismessina/raycast-kit` | `^0.3.0` | 2026-11-04 | `onErrorToast` and the `cause` chain under Copy Error, which the failure-toast rules now rely on; `cosign` first adopter; a version bump only from `^0.2.0` |
| `@chrismessina/raycast-kit` | `^0.2.0` | 2026-09-09 | the `bytes` subpath (`formatBytes`, `formatSpeed`) replaced drifting hand-rolled formatters; `threads` first adopter |
| `@chrismessina/raycast-downloader` | `^0.1.5` | 2026-09-17 | 0.1.2 (redirect body spliced into the `.part`), 0.1.3 (`partialUnsafe`), 0.1.4 (provenance + `If-Range`), 0.1.5 (validators parsed per block across the redirect chain): each a silent resume-path corruption. It was `raycast-download` until publication; the name was taken |
