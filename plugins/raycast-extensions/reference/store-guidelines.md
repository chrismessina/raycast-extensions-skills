# Store compliance gate

`ship`'s compliance gate. Absorbs the standalone `raycast-extension-review` skill —
**including its core principle, which is the whole point of this file:**

> **Do not rely on hardcoded rules. Fetch the live docs and audit against what they
> actually say.** If the docs conflict with prior knowledge — or with this file —
> **the docs win.**

That principle is why this file is a **procedure**, not a transcription of the Store
rules. A static copy of Raycast's requirements would go stale silently and start
producing confidently-wrong audits, which is worse than no audit at all. The small
cached section at the bottom is deliberately limited to facts that are structural and
slow-moving, and every one of them is stamped and re-checkable.

## Authoritative sources

- **Prepare an Extension for Store** —
  https://developers.raycast.com/basics/prepare-an-extension-for-store
- **Manifest reference** — https://developers.raycast.com/information/manifest

## Procedure

1. **Fetch.** Prefer **context7** — it indexes the Raycast developer docs and is faster
   than a raw page fetch:

   - `resolve-library-id("Raycast API")` → use `/llmstxt/developers_raycast_llms-full_txt`
     (High reputation, full-text index; verified 2026-07-13).
   - Then `query-docs` with a **scoped** question — one concept per call. Good:
     *"required package.json manifest fields for a Raycast extension"*. Bad: *"store rules"*.

   Fall back to `WebFetch` on the two URLs above if context7 is unavailable or returns
   nothing useful. Either way: **fetch before auditing.** Do not audit from memory.

2. **Audit against the fetched text**, not against recall and not against this file.

2b. **Route to conditional sources by what the code actually contains.** Fetching the two
   core pages is necessary but not sufficient — the Store rules below are easy to pass
   over on a long page, and each maps to a **detectable signal**. Run the greps; fetch the
   extra source only when its trigger fires. This turns "remember the whole page" into
   "answer what the tree says."

   ```bash
   # ── Always-check signals (cheap; run all of them) ────────────────────────────
   # Scan the WHOLE extension, not just src/ — prohibited code hides in scripts/,
   # tools/, and build helpers just as effectively.
   SCAN=(--glob '!node_modules' --glob '!dist' --glob '!*.lock' --glob '!package-lock.json')

   jq -r '.license, .platforms, (.categories|tostring)' package.json  # MIT? scope? categories?
   git ls-files --error-unmatch package-lock.json   # must exist AND be COMMITTED (npm only)

   # PROHIBITED — Keychain. Case-insensitive; covers the CLI, the framework, and node bindings.
   rg -in "${SCAN[@]}" 'keychain|security +(find|add|delete)-(generic|internet)-password|SecItem(Copy|Add|Update|Delete)|node-keytar|\bkeytar\b' .

   # PROHIBITED — analytics/telemetry of ANY kind.
   rg -in "${SCAN[@]}" 'analytics|telemetry|mixpanel|amplitude|posthog|sentry|datadog|bugsnag|segment\.(io|com)|google-analytics|gtag|\.track\(|\.capture\(' .

   # NOT ALLOWED — custom localization (US English only).
   rg -in "${SCAN[@]}" 'i18n|i18next|react-intl|intl-messageformat|@lingui|formatjs|\bgettext\b|translations?/' .

   rg -n "${SCAN[@]}" 'LocalStorage\.|Cache\(' .          # must not store secrets

   # Opaque binaries — match by TYPE, not extension: a committed Mach-O/ELF often has none.
   fd --hidden --no-ignore -t f --exclude node_modules --exclude .git . \
     -x sh -c 'file -b "$1" | grep -qiE "mach-o|elf |pe32|wasm" && echo "BINARY: $1"' _ {}
   ```

   > ⚠️ **Every one of these is a *blocker*, so a false negative is the expensive
   > direction.** Verified 2026-07-29: the previous `rg 'Keychain|security
   > find-generic-password' src` reported **CLEAN** on a file containing
   > `SecItemCopyMatching` and `security add-generic-password` — a hard Store blocker
   > passing silently. Case-insensitivity, the framework symbols, and scanning outside
   > `src/` are all load-bearing. **A clean result is only meaningful if you also state
   > what you scanned.**

   | Trigger (signal in the tree) | Fetch this source | What it gates |
   | --- | --- | --- |
   | `tools` or `ai` key in `package.json` | [AI Extensions](https://developers.raycast.com/ai/getting-started) | tool naming, confirmation, eval expectations |
   | `mode: "menu-bar"` in any command | [Menu Bar Commands](https://developers.raycast.com/api-reference/menu-bar-commands) | title length, refresh cadence |
   | `interval` on any command | [Background Refresh](https://developers.raycast.com/information/lifecycle/background-refresh) | allowed intervals, no user-visible side effects |
   | bundled binary / `.node` / `.wasm` | [Prepare for Store](https://developers.raycast.com/basics/prepare-an-extension-for-store) | **provenance + integrity hash + build-from-source**; opaque or heavy binaries are rejected |
   | a setup/login/configure *command* | [Preferences](https://developers.raycast.com/api-reference/preferences) | config belongs in `preferences`, **not** a command |
   | any `<Action>` / `ActionPanel` | [Best Practices](https://developers.raycast.com/information/best-practices) | action titles, icons, submenus, native navigation |
   | any `<List>` / `<Grid>` / `<Detail>` | [Best Practices](https://developers.raycast.com/information/best-practices) | loading, empty, and placeholder states |
   | `useFetch` / `fetch` / `axios` | [Best Practices](https://developers.raycast.com/information/best-practices) | error handling, no analytics, third-party terms |
   | third-party API or scraped source | [Prepare for Store](https://developers.raycast.com/basics/prepare-an-extension-for-store) | the service's terms must permit it |

   **Hard blockers to assert explicitly** (each is a *silent* rejection — the extension
   builds and lints clean):

   - **`license` must be `MIT`** in `package.json`.
   - **`package-lock.json` must exist and be committed** (npm only — not yarn/pnpm).
   - **No Keychain access.** No exceptions.
   - **No external analytics or telemetry** of any kind.
   - **US English only**; no custom localization layer.
   - **`platforms` must match reality** — don't claim `Windows` for a `macOS`-only
     extension (an AppleScript/`osascript` call is macOS-only by definition).
   - **Binaries need provenance**: source, build instructions, and an integrity hash.

3. **Report** findings in three buckets, each citing the source URL:
   - **Compliant** — what already passes (say so; a silent pass reads as an audit that
     didn't run).
   - **Must fix** — blocks submission.
   - **Optional** — improves the listing but won't block.

4. **Route the fixes.** Compliance findings are metadata/asset work — README, CHANGELOG,
   icon, screenshots, categories, manifest fields — and stay in `ship`. **Anything that
   needs a code change hands back to `develop`.** `ship` never changes code behavior.

## Cached stable facts

*Last verified 2026-07-13 via context7. Re-fetch if older than ~90 days, and re-fetch
regardless before any first-time submission.* These are cached only because they are
structural; **the fetched docs remain authoritative over anything below.**

- **Icon:** 512×512px PNG. Light/dark variants via `icon.png` + `icon@dark.png`.
- **`CHANGELOG.md` is required** to document changes between releases. See the
  `{PR_MERGE_DATE}` rule in `ship`'s pre-flight — new top entry only; never re-stamp an
  entry that already carries a real date.
- **Raycast-specific manifest fields:** `name`, `title`, `description`, `icon`, `author`,
  `platforms`, `categories`, `commands`, `tools`, `ai`, `owner`, `access`. The manifest
  is a *superset* of npm's `package.json` — one file, both roles.
- **Naming convention — be specific, not generic.** If the extension only searches Notion
  pages, name it **"Notion Search"**, not "Notion". A generic name is only appropriate
  when the extension genuinely covers broad functionality. This sets correct user
  expectations and is called out explicitly in the Store prep docs.
- **Preferences** support `"required": true`, which makes Raycast prompt the user before
  the extension can run.

## Gotchas

- **A clean audit with zero findings is suspect.** If nothing came back, confirm the
  fetch actually returned content before reporting "compliant" — an empty fetch and a
  passing audit look identical in the output.
- **Screenshots are the most common staleness miss.** If a command or view was added,
  the screenshots are wrong. That's a `ship` weeding item, and it's easy to skip because
  the code is fine.
- **Don't let the cache above become the audit.** It exists to save a round-trip on
  structural questions, not to replace step 1.
