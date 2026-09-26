---
name: screenshots
description: Take Raycast Store screenshots of an extension that shows personal data (a bank, a CRM, meetings, health) without putting real data in them, using @chrismessina/raycast-faker to record scrubbed fixtures from the user's own account and replay them. Fires on "take / update / retake the screenshots", "the screenshots show my real data", "screenshots for the Store" when the extension displays personal or account data, and when `ship` flags stale screenshots on such an extension. Does NOT submit anything (that's `ship`) and is not needed for extensions whose screens hold no personal data.
---

# screenshots

Raycast's own guidelines forbid sensitive data in Store screenshots, and an extension that
shows personal data has only one source for realistic screens: the owner's account.
`@chrismessina/raycast-faker` closes that gap. **Record** captures real API responses and
scrubs them in memory: people and businesses become Twin Peaks characters and places, and IDs,
account numbers and free text are replaced consistently. Amounts are scaled by one hidden
factor and dates are shifted. **Replay** then serves those fixtures. Everything looks real;
nothing is.

Reference adopter: `raycast-mercury` (`src/mercury.ts` for the rules, and every
`LocalStorage` key wrapped in `fakerKey`).

## Seams

- **vs `ship`**: `ship` decides screenshots are stale and submits them. This skill produces them.
  It changes code only to wire the faker (step 2), and that code is inert in Store builds.
- **Real data leaks through more than the API.** Faking `fetch` is not enough on its own. Step 1
  exists because Mercury had three other leaks: cached balances painted before any request, an
  account name saved at setup, and PDFs downloaded through curl.

## Procedure

### 1. Inventory: where does real data come from?

List, for this extension:

- **API hosts** reached through `fetch`. These are what the faker covers.
- **Every `LocalStorage` key** (caches, stored logins or names, settings).
- **Every other cache: `useCachedPromise`, `useCachedState`, `useFetch` (it caches by default), and
  Raycast's `Cache`.** `fakerKey` covers only `LocalStorage`. These caches hold the **real** data
  from normal use and paint it before any replayed request answers, so a replay screenshot can
  show real values for a moment, or entirely. Before replaying, give them a key that includes
  `fakerKey(...)`, or clear them (Raycast's command "Clear Cache" for the extension, or bypass the
  cache while `isReplaying()`).
- **How requests are made.** `withFaker` wraps a `fetch`. `useFetch` calls the global `fetch`
  itself, so wrap it or switch to `usePromise` with the wrapped function. SDKs work only if they
  accept a custom `fetch`.
- **Transfers outside `fetch`**: curl or `raycast-downloader`, AppleScript, SDKs with their own
  transport, reading local files. **The faker can't cover these.** Plan screens that don't show
  their results.
- **Identity captured at setup** (an account name saved when a token is added). Replay starts from
  an empty store, so the setup flow must work against fixtures. That means recording the
  endpoint it calls (Mercury: Update Token re-runs `/organization`).

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

- **Everything not in `keep` is replaced, fail-closed.** Every field the UI or logic branches on
  (an enum: status, kind, type) must be in `keep`; nothing passes through automatically. A field
  that's public only sometimes gets `keepIf: { field: /pattern/ }` (Mercury: Treasury's "… posted"
  descriptions). Money fields are scaled even if unlisted, whenever their name looks like money.
- **URL hosts:** only `hosts` and `keepHosts` keep their origin; any other host becomes
  `example.com`.
- **Account-style names** (`names: { name: "account" }`) keep their words only when every word is
  common banking vocabulary ("Mercury Savings ••6333"). Anything else is replaced whole. Extend
  the vocabulary with `safeWords` if a legitimate word keeps getting replaced.
- **`fakerKey` must be called at each use, not stored in a module constant.** The mode is read
  when the function runs.
- Verify it's inert: `tsc`, lint, and build as usual. In a Store build `withFaker` returns `fetch`.

### 3. Record

```bash
npx raycast-faker record   # from the extension root; uses package.json "name"
npm run dev
```

Walk **every screen you'll screenshot**, plus the setup call from step 1. Watch the dev console:

- `[raycast-faker] Not saving GET /x: N original value(s) survived scrubbing` means a field
  holding personal data is in `keep`, or isn't classified. Fix the rules and walk that screen again.
  **A refused fixture is the kit working, not failing.**

Fixtures land in `~/.config/raycast-faker/<extension>/fixtures/`, never inside the extension
folder (`ray publish` ships everything there).

### 4. Replay

```bash
npx raycast-faker replay
```

- Reopen each command. Storage is now a separate, empty namespace, so add an account inside
  replay mode (any token works; there's no network).
- Walk every screen again. **`raycast-faker: no fixture for GET /x`** means that screen wasn't
  recorded. Go back to step 3 for it. Replay never falls through to the real API.
- Search and filters return the recorded list; the server isn't there to filter it. Screenshot
  an unfiltered view, or accept an illustrative result.

### 5. Capture

Follows Raycast's "prepare an extension for the Store" guide:

- **Window Capture**: Raycast Settings → Advanced → set a hotkey (e.g. ⌘⇧⌥M). Run in development
  mode, which hides dev-only chrome, open the command, press the hotkey, and tick **Save to
  Metadata**.
- **2000 × 1250 PNG, light theme,** up to six (three or more recommended), with one consistent
  wallpaper. Raycast Wallpapers are a good choice.
- **Plan at least one shot with the ⌘K action panel open.** Chris likes showing the actions, and
  it's where new capabilities are visible. Check the panel's text too: action titles can carry
  names ("Remove <account>"), which is fine in replay, where they're Twin Peaks names.
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

```bash
npx raycast-faker off
```

Reopen the extension. The real store is back exactly as it was: replay never wrote to it.

## Gotchas

- **The scale factor keeps shape.** Totals, running balances, and return percentages stay
  consistent with each other, so charts look right, and a chart's *shape* still reflects the real
  history. The user accepted that for Mercury (2026-09-26); ask again for anything more sensitive.
- **`npx raycast-faker clear`** deletes fixtures but keeps the secrets, so re-recording produces
  the same fake names. Deleting `config.json` gives every value a new fake.
- **A dependency on a local `file:` path cannot ship.** While the kit is unpublished, adopters
  point at the local folder. Switch to the npm version before `ship`.
