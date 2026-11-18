# Greptile's Raycast rules — where each one is handled

Greptile reviews every Store PR against rules Raycast keeps in `.greptile/` at the root of
`raycast/extensions`: 58 rules with stable IDs in `config.json`, review-wide guidance in `rules.md`,
and the docs pages it reads as context in `files.json`. The snapshot of those files lives in
**`raycast-harness` core**, at `src/rules/greptile/` of the package version pinned in
`rx-version.json` (see [`rx.md`](rx.md)); `SOURCE.json` there records where it came from. This file
maps each rule to where this plugin handles it, so a rule that applies to us is checked on our side
before it costs a review round.

**Core snapshot this map describes:** `@chrismessina/raycast-harness` 0.1.4, `SOURCE.json`
`{ repo: raycast/extensions, source: main, pr: 32933, sha: b6bdcb196dd5d5f228ae322a89bb5211bc535170, committed: 2026-11-03T07:07:02Z, fetched: 2026-11-07 }`.
PR [#32933](https://github.com/raycast/extensions/pull/32933), which added `.greptile/` and deleted
`.github/copilot-instructions.md`, has merged, so Greptile runs these rules from `main`. The IDs
below replace the numbers (01–35) of the older rule set exported on 2026-09-26.

**Review settings on `main`:** `strictness` is `3` (it was `2` in the PR snapshot) and `autoReview`
is `["push"]` (it was `["open"]`). Neither rx nor these skills read either setting.

## Are the rules current? `rx greptile outdated`

```bash
node "<plugin>/scripts/rx.mjs" greptile outdated                                  # PASS / FAIL / ERROR
node "<plugin>/scripts/rx.mjs" greptile update                                    # make main's rules the copy in use
node "<plugin>/scripts/rx.mjs" greptile update --dest "$MAINTAINER_CHECKOUT"      # rewrite that checkout's src/rules/greptile/
```

`<plugin>` is the `raycast-extensions` plugin directory, two levels above any skill's base directory.
`outdated` compares the rules in use with `.greptile/` on `main`. **FAIL** (exit 1) lists every
change as a detail: `rule added`, `rule removed`, `rule changed <id> <field>`,
`setting changed <key>`, `files changed`, `rules.md changed`, `source moved`. **ERROR** (exit 2)
means the live copy could not be read or compared (network, API limit: set `GITHUB_TOKEN` or
`GH_TOKEN`); it is never "current". `update` writes a new copy into rx's cache. rx uses the copy
read at the latest upstream commit (`committed` in `SOURCE.json`), so the new copy is in use unless
a copy from a later commit already is. In that case `update` WARNs and names that copy instead of claiming
it updated. A copy whose `repo` is not `raycast/extensions`, whose `committed` is in the future, or
whose rules fail validation is skipped with a warning. With `--dest`, `update` writes only into that
checkout of `raycast-harness`, all-or-nothing, never into the installed package, and refuses a
`--dest` that is the running package's own copy.

**`rx gates` keeps the rules current.** Its first step, `greptile-rules`, runs the same check and
update as `rx greptile update` and records the rules it ran under in the receipt (`greptileRules`:
repo, SHA and a digest of the rules and `files.json`). Offline it WARNs and keeps the copy it has;
live rules that fail validation are never installed. Each change it lists still needs reading
against the branch and mapping in this file.

**An update invalidates the receipt and the audit.** `rx audit record` stores the same stamp and
refuses a receipt written under other rules ("the Greptile rules changed since rx gates ran (<a> →
<b>); run rx gates again"). `rx guard` blocks a publish unless the receipt, the audit and the rules
in use agree, and names which one differs: "the Greptile rules changed since the audit was recorded
(<old> → <new>); run rx audit record again", "the audit was recorded against other Greptile rules
than the receipt (<audit> vs <receipt>); run rx audit record again", or "the Greptile rules changed
since rx gates ran (<receipt> → <now>); run rx gates, then rx audit record".

**Updating the shipped copy is one coordinated change:** a `raycast-harness` release carrying the new
`src/rules/greptile/`, with every new rule classified in core `src/audit/greptile.mjs`, then, in this
plugin, the pin in `rx-version.json`, the "Core snapshot" line above, and the table below, together.
Read each changed rule against the branch being shipped first. The judgment list in core is checked
against the rules at load, so a rule Raycast renames or removes is an ERROR in `rx audit record`,
never a silently skipped entry. Core's tests also fail on any rule in the shipped copy that is
neither bound to a preflight check (`GREPTILE_PREFLIGHT_RULES`) nor listed as judgment, so a rule
Raycast adds cannot ship unclassified.

## Deterministic rules run as code

`rx preflight` checks the mechanical rules; `rx gates` runs it (with `--published` when the extension
is published) as one of its steps. The check IDs named in the table are its result ids. The file
checks (`agent-scaffolding`, `dev-material`, `generated-files`) read only the extension's own
`.gitignore`, the one the fork-side `git add` sees (git's model: last match wins, `!` re-includes, a
trailing `/` matches directories only, nothing under an excluded directory comes back, nested
`.gitignore` files are not read), skip the names `ray publish` never copies, and count a published
file as shipping even when ignored, because the fork tracks it. Source checks strip comments with a
small lexer before matching; its one known limit (a regex literal directly after `)` reads as
division) is documented in core at `src/preflight/lexer.mjs`. Calibrated against the real fleet
(35 checkouts on 2026-09-26, the file checks on 50 on 2026-10-30; every FAIL a real defect) and
ported with no lost legacy finding (`scripts/compare-preflight.mjs` in core, 59 roots).

## Rule → handler

Severity is Greptile's (`high` / `medium` / `low`). Level is ours: FAIL and WARN are `rx preflight`
results; *judgment* means the rule is one of the **55 Greptile judgment rules** that `rx audit record`
requires an entry for (`greptile/<rule id>`, all blocking; the list is `GREPTILE_JUDGMENT_RULES` in
core `src/audit/greptile.mjs`, and the result id is `audit-greptile-<rule id>`); *triage* means
`raycast-pr-loop` uses the rule to settle a finding. A rule is preflight-only (no judgment in its
Level) only when its checks cover the whole rule text: `native-fetch`, `platforms-field` and
`no-nested-review-config`. Every other rule a preflight check covers in part is judgment too, so
the part no check reads still needs an entry. The 55 judgment ids, from that file:
`changelog-entries`, `supported-platforms`, `shortcut-platform-keys`, `launch-command-try-catch`,
`preference-types`, `action-organization`, `preference-storage`, `no-hardcoded-secrets`,
`root-navigation-title`, `ai-tools-evals`, `ai-instructions`, `readme-user-facing`,
`docs-match-behavior`, `no-native-binaries`, `failure-toasts`, `error-empty-state`,
`no-silent-failure`, `shell-command-injection`, `no-analytics-or-keychain`, `store-naming`,
`backward-compatible-updates`, `loading-navigation-placeholders`, `third-party-tos-signals`,
`owner-field`, `contributors-third-party-updates`, `deprecated-apis`, `manifest-basics`,
`menu-bar-commands`, `destructive-actions`, `list-search-filtering`, `data-hooks`,
`script-and-sql-utils`, `ai-api-usage`, `ai-skills`, `ai-model-provider`, `oauth-utils`,
`action-title-case`, `extension-overlap`, `data-hooks-bugs`, `oauth-token-bugs`,
`store-screenshots`, `unused-dependencies`, `eslint-flat-config`, `no-custom-localization`,
`extension-categories`, `prettier-config`, `npm-lockfile-registry`,
`generated-preference-argument-types`, `manifest-title-case`, `raycast-trash`, `favicon-utility`,
`launch-command-api`, `no-agent-scaffolding`, `no-generated-files`, `no-dev-material`.

| Rule ID | Sev. | What it asks | Handled by | Level |
|---|---|---|---|---|
| `generated-preference-argument-types` | low | Generated `Preferences` / `Arguments` types; no hand-written shapes, no `Preferences` import from `@raycast/api` | `rx preflight` `hand-typed-preferences`; House Style `no-hand-preferences`; judgment for shapes its pattern misses (a custom-named interface, `type CommandArguments`, the deprecated import) | FAIL / judgment |
| `changelog-entries` | medium | One new top entry with `{PR_MERGE_DATE}`; past entries untouched; breaking changes named; no internal-only bullets; a dependency-only PR needs the `skip-changelog` label, not an entry | `rx preflight` `changelog-order`, `changelog-placeholder`, `changelog-exists`, `changelog-updated` (with `--published`); the bullets are judgment | FAIL / judgment |
| `store-screenshots` | high | A new view or menu-bar extension ships `metadata/` screenshots; ask about refreshing on a rename or redesign | `rx preflight` `screenshots` (a `view` or `menu-bar` command; a published extension whose only such commands are `menu-bar` ones is a WARN), `screenshot-count`, `screenshot-format`, `screenshot-size` (the Store's 2000×1250 PNG, `store-guidelines.md`); judgment for an update's first view, deleted screenshots and the refresh question; `ship` weeding for freshness | FAIL / judgment |
| `unused-dependencies` | low | Every runtime dependency is imported somewhere in the extension; script-, test- and ESLint-only packages move to `devDependencies` | `rx preflight` `unused-dependencies` (`@types/*` exempt; it also WARNs, as a text heuristic, on a package that `src/` appears to import at runtime but that is only in `devDependencies`: an `import("x")` type or an import inside a string matches too, so a type-only use is written as `import type`); it reads `src/` only, so an import outside `src/`, whether a flagged import is real, and the script-, test- and ESLint-only cases are judgment | FAIL / judgment |
| `eslint-flat-config` | low | Flat config; `defineConfig` only from `"eslint/config"` | `rx preflight` `eslint-config`. The rule now accepts a config without `defineConfig`, so that case only warns; a `defineConfig` imported from another package is judgment | FAIL / WARN / judgment |
| `no-custom-localization` | medium | No translation catalogs; locale behavior is a preference; US spelling in UI strings | `rx preflight` `localization` (heuristic); House Style `us-english`; a translation catalog without locale sniffing is judgment | WARN / judgment |
| `prettier-config` | low | `printWidth: 120`; no explicit `singleQuote: true`; no conflicting formatter config (Biome at 80 columns) | `rx preflight` `prettierrc`; House Style `prettierrc`; a conflicting formatter config (Biome) is judgment | FAIL / judgment |
| `extension-categories` | low | At least one category; `Other` only as a last resort | `rx preflight` `categories`. Greptile skips casing (CI's `ray validate` fails it); we fail it earlier. Whether the category fits is judgment | FAIL / WARN / judgment |
| `manifest-title-case` | low | Title Case for extension, command and preference titles; follow `ray lint` and `ray validate` | `rx preflight` `title-case` (heuristic; brand and CLI names are judgment) | WARN / judgment |
| `native-fetch` | low | No `node-fetch` / `cross-fetch` / `isomorphic-fetch` | `rx preflight` `native-fetch` | FAIL |
| `raycast-trash` | medium | `trash()` for the user's files, not `rm` / `mv ~/.Trash` | `rx preflight` `trash` (heuristic); other deletes of the user's files are judgment | WARN / judgment |
| `action-title-case` | low | Title Case for literal `Action` and `ActionPanel.Submenu` titles; `@raycast/prefer-title-case` only warns, so a PR can still carry them | judgment | judgment |
| `supported-platforms` | high | `platforms` matches where the code runs, only `macOS` / `Windows`; macOS-only APIs mean `["macOS"]`; Windows testing is questioned only for a reason in the code | `rx preflight` `platforms` (the values); House Style reads `platforms` first; whether the list matches the code is judgment | FAIL / judgment |
| `platforms-field` | low | `platforms` is declared; missing on `main` is a pre-existing note | `rx preflight` `platforms`: a missing field fails, and warns when the published copy lacks it too | FAIL / WARN |
| `shortcut-platform-keys` | low | `macOS` / `Windows` keys; both platforms for ambiguous modifiers; no collisions | `rx preflight` `shortcut-platform-case`; `rx shortcuts check` `shortcut-ambiguous` / `shortcut-reserved` (embedded in `rx audit record`); `keyboard-conventions.md` | FAIL / judgment |
| `favicon-utility` | low | `getFavicon()` over a hand-built favicon URL, unless the custom code adds something | `rx preflight` `favicon` (heuristic; other favicon services and the exception are judgment) | WARN / judgment |
| `launch-command-api` | low | `launchCommand()` over a `raycast://extensions/<author>/<ext>/<command>` deeplink | `rx preflight` `launch-command` (a two-segment Store-page link is fine); a deeplink built another way, and hand-built Quicklink deeplinks (`createDeeplink`), are judgment | WARN / judgment |
| `launch-command-try-catch` | medium | Every `launchCommand` inside `try` / `.catch()` with a failure toast | judgment; House Style toast rules | judgment |
| `preference-types` | medium | No `number` type; at most 3 arguments, required before optional; `appPicker` values are objects | `rx preflight` `preference-type`; argument order is judgment | FAIL / judgment |
| `action-organization` | low | Don't change ⏎ / ⌘⏎ in an existing extension unannounced; no destructive secondary | `keyboard-conventions.md` → *Action ORDER on an update*: **did the Enter default of a section that already shipped change?** | judgment |
| `preference-storage` | low | All preferences are encrypted; suggest `password` only as a nit; no secrets in `Cache`; `concealed` copies | `raycast-pr-loop` triage (decline "use `password` for encryption"); judgment for `Cache` / `concealed` | triage / judgment |
| `no-hardcoded-secrets` | high | No keys, tokens, client secrets or real personal data, including eval mocks and README examples | `rx scan` (gate −2, inside `rx gates`); `screenshots` skill for fixtures; judgment for what the scan cannot know | judgment |
| `root-navigation-title` | medium | No `navigationTitle` on a command's root view | judgment (root vs pushed needs reading) | judgment |
| `ai-tools-evals` | medium | New tools ship evals that `@`-mention the extension; tools that are only `AI mention search` need none | `develop` row for `src/tools/`; judgment | judgment |
| `ai-instructions` | low | No persona opener; mutating tools export `confirmation`; JSDoc on `Input`; one `ai.*` file | judgment | judgment |
| `no-agent-scaffolding` | medium | No `AGENTS.md`, `CLAUDE.md`, `TODO.md`, `.claude/` … **that this PR adds or changes** | `rx preflight` `agent-scaffolding`. `AGENTS.md`, `CONCEPTS.md`, `CLAUDE.md` and `HANDOFF.md` follow the [file policy](#file-policy) (preflight's list lacks `CONCEPTS.md` and `HANDOFF.md`; holdout covers all four): the audit entry is `pass` when, after `rx holdout out`, the payload holds none of them (evidence: holdout's inventory and `agent-scaffolding`) and each one already published has its `remove-published` disposition; after publish, `rx pr files` may show them only as `removed` (`pr-local-only`). brew's and dev-null's `TODO.md` ship (`ship.keep`). Files beyond the named list ("such as") and nested copies are judgment | WARN / judgment |
| `no-nested-review-config` | high | No nested `.greptile/` or `greptile.json`, at any depth: it can switch off the repo's rules, and CI fails on it | `rx preflight` `nested-review-config` (at any depth of what `ray publish` copies; core, so no preset exempts or caps it) | FAIL |
| `readme-user-facing` | medium | README is the Store page: no Development / Build sections, no CI badges; images in `media/` | `rx preflight` `readme-assets`, `readme-links`; `ship` weeding (the template's Development section is judgment) | FAIL / judgment |
| `docs-match-behavior` | low | README, `help.md`, descriptions and CHANGELOG match what the code now does | `ship` weeding | judgment |
| `no-generated-files` | medium | No `raycast-env.d.ts`, `node_modules/`, `dist/`, Swift/Rust build output, `.DS_Store` | `rx preflight` `generated-files`: `dist/` and `.build/` fail, a stray `.DS_Store` warns. `ray publish` never copies `node_modules`, `raycast-env.d.ts` or the Swift/Rust build dirs, so those aren't checked. Other compiled output, and a `.DS_Store` deeper than the named folders, are judgment | FAIL / WARN / judgment |
| `no-native-binaries` | high | No committed or runtime-compiled binaries; Swift / Rust packages via `ray build` | judgment | judgment |
| `no-dev-material` | low | No `LICENSE`, `CONTRIBUTING.md`, `SECURITY.md`, top-level `docs/` … that this PR adds | `rx preflight` `dev-material` (named files plus top-level `docs/` and `tools/`). Contributor `docs/` ships by policy; a published `LICENSE` stays; the rest: not yet published → the extension's `.gitignore`, published → deleted in the PR (`ship`). Scratch, sample and unreferenced asset files and heavy test tooling are judgment | WARN / judgment |
| `npm-lockfile-registry` | high | `package-lock.json` only, in sync; packages only from `registry.npmjs.org` | `rx preflight` `lockfile`, `npm-registry`; `rx api-floor`; `dep-gates.md`; whether the lockfile is in sync with `package.json` is judgment (the gates do not run `npm ci`) | FAIL / WARN / judgment |
| `failure-toasts` | low | `showFailureToast` in catches; wrap selection APIs; never swallow user-triggered errors | House Style toast rules | judgment |
| `error-empty-state` | medium | A failed load renders an `EmptyView` with the error, not "No results" | House Style `empty-state-copy`; judgment | judgment |
| `no-silent-failure` | medium | No success before the operation succeeded; no empty catches around user actions | judgment | judgment |
| `shell-command-injection` | high | No interpolated shell / AppleScript / PowerShell strings; argument arrays | judgment | judgment |
| `no-analytics-or-keychain` | high | No telemetry SDKs; no Keychain access | judgment | judgment |
| `store-naming` | medium | Noun titles; no "Assistant"; "Raycast" in a new extension's name is a question, not a blocker; `<verb> <noun>` commands; subtitles name the service | judgment | judgment |
| `extension-overlap` | medium | Questions for the human reviewer: a new extension that overlaps an existing one, an open PR or a native feature; a significant update by someone other than the `author` | judgment; say it in the PR body before Greptile does | judgment |
| `backward-compatible-updates` | high | Never change a command `name`; no removed commands, renamed preferences or changed defaults unannounced | `rx preflight` `command-renamed` (with `--published`); judgment for preferences | FAIL / WARN / judgment |
| `loading-navigation-placeholders` | low | `isLoading` while loading; Navigation API, not state-swapped root views; placeholders | judgment | judgment |
| `third-party-tos-signals` | medium | Point out scraping, private endpoints, reused cookies (new extensions) | judgment; say it in the PR body before Greptile does | judgment |
| `owner-field` | medium | No new `owner` on a public extension | judgment | judgment |
| `contributors-third-party-updates` | low | A non-author updater adds their Raycast username to `contributors` | judgment (forks) | judgment |
| `deprecated-apis` | low | No new deprecated `@raycast/api` / `@raycast/utils` APIs | judgment (`tsc` does not fail on `@deprecated`; read the added lines) | judgment |
| `manifest-basics` | medium | New extensions: MIT, a real 512×512 icon, no `version`, no `react-dom` | `scaffold`; `rx preflight` `icon-size`; judgment for the rest | judgment |
| `menu-bar-commands` | medium | No identical `MenuBarExtra.Item`s; sane `interval` | judgment | judgment |
| `destructive-actions` | medium | `Action.Style.Destructive`; `confirmAlert` when it can't be undone | House Style; judgment | judgment |
| `list-search-filtering` | medium | `onSearchTextChange` without filtering makes typing do nothing | judgment | judgment |
| `data-hooks` | low | `@raycast/utils` hooks over `useState` + `useEffect`; `execute: false` until inputs are ready | judgment | judgment |
| `data-hooks-bugs` | medium | Args through the args array, not the closure; no `Map` / `Set` / class instances in cached values (`Date` and `Buffer` are restored); no inline `useStreamJSON` `filter` / `transform` | judgment | judgment |
| `script-and-sql-utils` | low | `runAppleScript` / `useSQL` over hand-rolled process calls; return `permissionView` | judgment | judgment |
| `ai-api-usage` | medium | `environment.canAccess(AI)` first; no `AI.ask` in loops | judgment | judgment |
| `ai-skills` | medium | Bundled `skills/<name>/SKILL.md` has valid frontmatter and is declared | judgment | judgment |
| `ai-model-provider` | medium | `src/<name>.ts` exports `getModels` / `streamCompletion`; README names Raycast Pro | judgment | judgment |
| `oauth-utils` | low | `OAuthService` + `withAccessToken` over a hand-rolled flow; `personalAccessToken` over hand-branching | judgment | judgment |
| `oauth-token-bugs` | medium | `getAccessToken` only inside the wrapper; the token is not read from props; a PKCE flow stores `expiresIn` and refreshes | judgment | judgment |

## `rules.md` — guidance on every comment

These settle findings in `raycast-pr-loop` triage. Quote them when declining:

- **Review only what the PR changes.** Problems already on `main` get at most one note labeled
  pre-existing, and never block. A finding about an untouched file is declined on that ground.
- **Never review `raycastbot` commits** (the post-merge CHANGELOG date, image optimization), and
  never post on a merged PR.
- **Accept the author's stated reason** (an intentional product choice, a platform limit) unless
  the code contradicts it. Don't re-raise a resolved thread unless a new commit brings it back.
- **Verify before claiming:** check the installed version against the advisory before calling a
  package vulnerable; a page cap, timeout or result limit is a safety bound, not a bug; the old
  code isn't the spec when a PR changes behavior on purpose.
- **No "You're absolutely right"** or similar in replies (`raycast-pr-loop` reply rules).
- **`ActionPanel.Submenu` adds its own ellipsis**; decline a "missing ellipsis" finding.
- **A mechanical fix comes with the code to paste** (`## Suggestions`, added on `main`). A finding
  without one is not invalid for that reason; settle it on its merits.

## Dropped from the rule set by #32933

The 2026-09-26 export had rules the new set lacks: `$schema` in `package.json` (old 16;
`rx preflight` `schema` still fails it, since Raycast's docs require it), a ref-gated deferred
execution is not a dropped request (old 22), Windows media-session (SMTC) limits are not bugs
(old 31), Inoh's action order (old 29), and Script Commands for shell-only extensions (old 35,
already inactive). Old 22 and 31 remain valid declines on the merits in `raycast-pr-loop`; they
just can't be cited as Raycast's rule anymore.

The three rules unique to `.github/copilot-instructions.md`, which the PR deletes, now live in
the set: command `name` stability in `backward-compatible-updates`, and the lockfile and registry
rules in `npm-lockfile-registry`.

## File policy

**Our policy for the file rules (Chris, 2026-10-30).** `no-agent-scaffolding` and
`no-dev-material` flag only files a PR adds or changes, and he notes the scaffolding rule isn't
strictly enforced in practice. **Updated 2026-11-03:** `AGENTS.md` and `CONCEPTS.md` no longer
ship. Greptile raised `AGENTS.md` as a P1 on cosign #33077 and Chris ruled *"we DO need to remove
AGENTS.md after all"*: keep them in the mirror, listed in the extension's `.gitignore`, and keep
freshening them there. `CLAUDE.md` and `HANDOFF.md` never ship either. Contributor `docs/` still
ships and the finding is answered, by his 2026-09-02 ruling. Holding the published copy back was
tried and doesn't work, because `ray publish` refuses a tree with uncommitted tracked changes.

Each part of the four-file ruling has its own mechanism:

- **Kept out of the payload.** The preset's `holdout.localOnly` lists `AGENTS.md`, `CONCEPTS.md`,
  `CLAUDE.md` and `HANDOFF.md` beside `.env` and `.claude`, so `rx holdout out` moves each one out
  of the extension root before `rx gates` and `rx holdout in` restores it after the publish. The
  mirror keeps them. Neither the payload `ray publish` copies nor the receipt's fingerprint includes them.
- **Untracked in the mirror.** `holdout-tracked` reads the mirror's own git index, never the
  published copy. A tracked one is a FAIL whose detail gives the fix: `git rm --cached <file>`
  (the file stays on disk), list it in the extension's `.gitignore`, commit.
- **Deleted when already published.** `rx stale` classifies a published file that the preset's
  `holdout.localOnly` lists and the local tree lacks as `stale-remove` (WARN), not the
  `stale-only-pub` FAIL. The audit answers it with a `remove-published` disposition keyed
  `{ path, localHash: "absent", baseline }`, so the publish deletes it upstream. Any other published
  path the local tree lacks stays `stale-only-pub` (FAIL).
- **Checked on the PR.** `rx pr files` reports each file's GitHub status; its `pr-local-only`
  check FAILs when any of the four is added, modified or renamed in, and accepts them as `removed`.

The other named files (`LICENSE`, `TODO.md`, …) stay out of the Store copy by the extension's
`.gitignore` while unpublished. A published `LICENSE` stays. `brew` and `dev-null` keep their
public `TODO.md` by his earlier rulings (2026-09-30, 2026-10-22), through the preset's `ship.keep`;
`rx holdout` never moves a kept or tracked file.

**Exception, `reader-mode` (Chris, 2026-11-17):** its `AGENTS.md` and `CONCEPTS.md` keep shipping,
through `ship.keep`, because the extension is tricky to maintain and its learnings should stay
public for whoever maintains it next. Answer the `no-agent-scaffolding` finding with that reason
instead of removing them. Known gap: `rx pr files`' `pr-local-only` reads only `holdout.localOnly`,
not `ship.keep`, so it FAILs on a changed kept file; for reader-mode that FAIL is expected.

Procedure: [`../skills/ship/SKILL.md`](../skills/ship/SKILL.md).
