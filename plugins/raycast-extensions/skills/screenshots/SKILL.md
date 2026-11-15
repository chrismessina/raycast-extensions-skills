---
name: screenshots
description: Take Raycast Store screenshots of an extension that shows personal data (a bank, a CRM, meetings, health) without putting real data in them, using @chrismessina/raycast-faker to record scrubbed fixtures from the user's own account and replay them. Fires on "take / update / retake the screenshots", "the screenshots show my real data", "screenshots for the Store" when the extension displays personal or account data, and when `ship` flags stale screenshots on such an extension. Does NOT submit anything (that's `ship`) and is not needed for extensions whose screens hold no personal data.
---

# screenshots

Raycast's own guidelines forbid sensitive data in Store screenshots, and an extension that
shows personal data has only one source for realistic screens: the owner's account.
`@chrismessina/raycast-faker` closes that gap. **Record** captures real JSON API responses and
scrubs them in memory: **string** values are replaced consistently (people and businesses become
Twin Peaks characters and places; IDs, account numbers and free text get fakes), money amounts are
scaled by one hidden factor and dates are shifted. **Replay** then serves those fixtures. The
guarantee is type-specific: **numbers that are not money, booleans and `null` pass through
unchanged** (`src/scrub.ts`, `walk`), and so does any non-JSON response, so a numeric identifier
on the wire is real data on the screen until step 1 handles it. Reference adopter:
`raycast-mercury` (`src/mercury.ts` for the rules; every `LocalStorage` key wrapped in `fakerKey`).

<!-- learnings:start -->
| When you are about to… | Read |
|---|---|
<!-- learnings:end -->

## Seams

- **vs `ship`**: `ship` decides screenshots are stale and submits them. This skill produces them.
  It changes code only to wire the faker (step 2), and that code is inert in Store builds.
- **Real data leaks through more than the API.** Step 1 exists because Mercury had three other
  leaks: cached balances painted before any request, an account name saved at setup, PDFs via curl.

## Procedure

### 1. Inventory: where does real data come from?

List, for this extension:

- **API hosts** reached through `fetch`. These are what the faker covers — and only these: a
  request to a host not listed in `hosts` goes to the real network in record **and** replay.
- **Sensitive numeric fields**: an account or card number, a customer or transaction id, a
  balance under a name the money heuristic does not match. The scrubber cannot fake a number, and
  it runs once, on the JSON body at **record** time; replay serves the saved fixture as is, so a
  `String(id)` at render time comes after scrubbing and shows the real number. Either add the field
  to `scale` (money-like), transform or drop it **before** the body reaches the scrubber (a fetch
  wrapper inside `withFaker`'s `fetchImpl`), or replace it explicitly while `isReplaying()`.
- **Short strings**: a printable-ASCII value of two characters or fewer with no `names` rule is
  kept as a code ("CA", "US"; `src/scrub.ts`, `SHORT`), so `{"contact":"Li"}` survives. Classify
  such a field in `names` or replace it yourself.
- **Every `LocalStorage` key** (caches, stored logins or names, settings).
- **Every other cache: `useCachedPromise`, `useCachedState`, `useFetch` (it caches by default), and
  Raycast's `Cache`.** `fakerKey` covers only `LocalStorage`. These hold the **real** data from
  normal use and paint it before any replayed request answers. Before replaying, give them a key
  that includes `fakerKey(...)`, or clear them ("Clear Cache", or bypass while `isReplaying()`).
- **How requests are made.** `withFaker` wraps a `fetch`. `useFetch` calls the global `fetch`
  itself, so wrap it or switch to `usePromise` with the wrapped function. SDKs need a custom `fetch`.
- **Transfers outside `fetch`**: curl or `raycast-downloader`, AppleScript, SDKs with their own
  transport, local files. **The faker can't cover these.** Plan screens that don't show their results.
- **The extension runs a CLI for its data** (`dayone`, `brew`, `gh`): no `fetch` to wrap, so skip steps 2–3 and
  replay hand-written fixtures where it runs the CLI (`raycast-faker/docs/CLI-EXTENSIONS.md`; adopter
  `raycast-day-one`). Agree on the fixture story with the user first. Until the kit is published, run
  `node ~/Developer/GitHub/chrismessina/raycast-faker/dist/cli.js replay` (or `off`) from the root. *(Day One, 2026-11-11.)*
- **Identity captured at setup** (an account name saved when a token is added). Replay starts from
  an empty store, so the setup flow must work against fixtures: record the endpoint it calls
  (Mercury: Update Token re-runs `/organization`).

### 2. Wire it (once per extension)

```ts
import { fakerKey, withFaker } from "@chrismessina/raycast-faker";

const apiFetch = withFaker(fetch, {
  hosts: ["api.example.com"],
  keep: [/* enums and public data the UI or logic reads: status, kind, type… */],
  names: { counterpartyName: "company", nameOnCard: "person", name: "account" },
  scale: [/* money fields */],
});
// …and every LocalStorage key: LocalStorage.getItem(fakerKey("logins"))
```

- **Every string not in `keep` is replaced, fail-closed, with two exceptions.** Short strings stay
  as codes (step 1), and a URL keeps its path except UUIDs and runs of four or more digits
  (`mapSegment` in `src/scrub.ts`), so `/users/jane-doe` survives and the kit does not refuse it:
  grep the recorded fixtures for paths naming a person before you replay. Only `hosts` and
  `keepHosts` keep their origin; any other host becomes `example.com`. Every string the UI or logic
  branches on (an enum: status, kind, type) goes in `keep`; a field public only sometimes gets
  `keepIf: { field: /pattern/ }` (Mercury: Treasury's "… posted" descriptions). Money fields are
  scaled even if unlisted, whenever their name looks like money (step 1).
- **Account-style names** (`names: { name: "account" }`) keep their words only when every word is
  common banking vocabulary ("Mercury Savings ••6333"); anything else is replaced whole. Extend the vocabulary with `safeWords`.
- **`fakerKey` must be called at each use, not stored in a module constant** (the mode is read
  when the function runs). Verify it's inert: build, `tsc`, and lint as usual; in a Store build
  `withFaker` returns `fetch`.

### 3. Record

```bash
npx raycast-faker record   # from the extension root; uses package.json "name"
npm run dev
```

Walk **every screen you'll screenshot**, plus the setup call from step 1. Watch the dev console:

- `[raycast-faker] Not saving GET /x: values from <field, …> survived scrubbing. See refused.json.`
  means a field holding personal data is in `keep`, or isn't classified. The refusal is recorded in
  `~/.config/raycast-faker/<extension>/refused.json` (field names only, never values). Fix the
  rules and walk that screen again. **A refused fixture is the kit working, not failing.**

Fixtures land in `~/.config/raycast-faker/<extension>/fixtures/`, never inside the extension folder (`ray publish` ships everything there).

### 4. Replay

Run `npx raycast-faker replay`, then:

- Reopen each command. Storage is now a separate, empty namespace, so add an account inside
  replay mode (any token works; covered hosts never reach the network).
- Walk every screen again. **`raycast-faker: no fixture for GET /x`** means that screen wasn't
  recorded. Go back to step 3 for it. For a host in `hosts`, replay never falls through to the real
  API — but a host **not** in `hosts`, and any transfer outside the wrapped `fetch`, is a real
  request in replay too (`src/index.ts`, `withFaker`). Before capturing, confirm every request a
  screenshot depends on uses a covered host and the wrapped transport (step 1's inventory).
- Search and filters return the recorded list; the server isn't there to filter it. Screenshot
  an unfiltered view, or accept an illustrative result.

### 5. Capture

Follows Raycast's "prepare an extension for the Store" guide:

- **Window Capture**: Raycast Settings → Advanced → set a hotkey (e.g. ⌘⇧⌥M). Run in development
  mode (it hides dev-only chrome), open the command, press the hotkey, and tick **Save to Metadata**.
- **2000 × 1250 PNG, light theme,** up to six (three or more recommended), with one consistent
  wallpaper. Raycast Wallpapers are a good choice. Count, format and size are mechanical: from the
  extension root, `node "<plugin>/scripts/rx.mjs" preflight` (`<plugin>` = two levels above this
  skill's base directory) reports `screenshot-count`, `screenshot-format` and `screenshot-size`;
  any FAIL names the file.
- **Raycast's CI fails two more things** (`scripts/check_metadata_images.py`, read 2026-10-18): a
  screenshot showing your local dev icon in the bottom bar, and any screenshot with no detectable
  Window Capture frame. That rules out menu bar screenshots; don't plan a shot of a menu bar command.
- **Plan at least one shot with the ⌘K action panel open.** Chris likes showing the actions, and
  it's where new capabilities are visible. Action titles can carry names ("Remove <account>"),
  which is fine in replay, where they're Twin Peaks names.
- **Window Capture saves with a timestamp name** ("Raycast 2026-09-26 12.27.56.png") straight into
  `metadata/`. Rename the keepers to `<extension>-1.png` … `-6.png`, and move out anything shot
  outside replay: `metadata/` ships.

### 6. Audit (eyes-only, then mechanical)

- **Look at every image.** Names should be Twin Peaks, amounts plausible, nothing recognizable.
  Only a human can sign off on a screenshot; hand the user the list of files and ask them to look.
- Then check that nothing real survived: the images must not contain the user's name, company,
  or account digits. If the fleet's `screenocr` extension is set up, OCR each image and search for
  those strings.

### 7. Off

`npx raycast-faker off`, then reopen the extension. The real store is back exactly as it was:
replay never wrote to it.

## Gotchas

- **The scale factor keeps shape.** Totals, balances and percentages stay consistent, so charts look
  right, and a chart's *shape* still reflects the real history. Accepted for Mercury (2026-09-26); ask again for anything more sensitive.
- **`npx raycast-faker clear`** deletes fixtures but keeps the secrets, so re-recording produces
  the same fake names. Deleting `config.json` gives every value a new fake.
- **A dependency on a local `file:` path cannot ship.** While the kit is unpublished, adopters
  point at the local folder. Switch to the npm version before `ship`.
