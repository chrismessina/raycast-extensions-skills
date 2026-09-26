# Greptile's Raycast rules — where each one is handled

Greptile reviews every Store PR against a set of custom rules Raycast maintains. This file maps each
rule (as exported 2026-09-26, 32 files numbered 01–35) to where this plugin handles it, so each
rule that applies to us is checked on our side before it costs a review round.

**Deterministic rules run as code, not as reading.** `scripts/preflight.mjs` checks them in about
40 ms with no dependencies, and `ship` runs it first in the pre-flight. Everything else is judgment
and lives in the skill or reference named in the table.

```bash
node <plugin>/scripts/preflight.mjs                          # from the extension root
node <plugin>/scripts/preflight.mjs --published "$PUB_DIR"   # also checks the CHANGELOG got a new entry
```

`<plugin>` is the `raycast-extensions` plugin directory — two levels above any skill's base
directory. FAIL exits 1; WARN never does. Tests: `node --test scripts/preflight.test.mjs`.

**Calibrated against the real fleet** (35 extension checkouts, 2026-09-26): every FAIL was a real
defect on inspection. The one false positive found — a JSDoc comment describing a Store-page link —
led to two fixes: comments are stripped before any source check (by a small lexer that leaves
strings, template literals including their `${}` parts, and regex literals alone), and only
three-segment `raycast://extensions/` command links warn. **Known limit:** a regex literal directly
after `)` — `if (x) /re/` — reads as division, so a `//` inside it would hide the rest of that line.
Telling the two apart needs a parser, and the style is rare in extension code.

## Rule → handler

| # | Rule | Handled by | Level |
|---|---|---|---|
| 01, 13 | Generated `Preferences` / `Arguments` types; no inline `getPreferenceValues<{…}>` | `preflight` `hand-typed-preferences`; House Style `no-hand-preferences` | FAIL |
| 02, 07 | CHANGELOG: `{PR_MERGE_DATE}` on the new top entry only, never "Unreleased", dates descending | `preflight` `changelog-order`; House Style `merge-date-placeholder` | FAIL |
| 03 | A view command needs screenshots in `metadata/` | `preflight` `screenshots`. The same check also asserts 2000×1250 PNG — that size is the Store's own requirement (`store-guidelines.md`), not part of rule 03 | FAIL |
| 04 | Every dependency is imported under `src/` | `preflight` `unused-dependencies` — `@types/*` packages are exempt, since nothing imports them at runtime | FAIL |
| 05, 14 | ESLint flat config; `defineConfig` from `"eslint/config"`, not `"eslint"` | `preflight` `eslint-config` (legacy `.eslintrc*` fails; no `defineConfig` warns) | FAIL / WARN |
| 06 | No custom localization; locale-dependent behavior is a preference | `preflight` `localization` (heuristic); House Style `us-english` | WARN |
| 08 | CHANGELOG created or updated in every PR | `preflight` `changelog-exists`, and `changelog-updated` with `--published` | FAIL |
| 09 | `.prettierrc` has `printWidth: 120`, `singleQuote: false` | `preflight` `prettierrc`; House Style `prettierrc` (the four-key form passes) | FAIL |
| 10 | At least one category, from the fixed list, exact case; `Other` only as a last resort | `preflight` `categories` | FAIL / WARN |
| 11 | Title Case for titles in `package.json` | `preflight` `title-case` (heuristic — binary names like `ipatool` are judgment) | WARN |
| 12 | No `node-fetch` / `cross-fetch` import; `fetch` is global | `preflight` `native-fetch` | FAIL |
| 15, 26 | Append new actions / order actions by frequency | `keyboard-conventions.md` → *Action ORDER on an update*. The two rules pull in opposite directions; ours settles it with one test: **did the Enter default of a section that already shipped change?** | judgment |
| 16 | `$schema` in `package.json` | `preflight` `schema` | FAIL |
| 17 | `trash()` instead of shelling out to `mv … ~/.Trash` / `rm` | `preflight` `trash` (heuristic) | WARN |
| 18 | `platforms` only `macOS` and/or `Windows` | `preflight` `platforms` | FAIL |
| 19 | Shortcut platform keys are `Windows` and `macOS` | `preflight` `shortcut-platform-case`; `keyboard-conventions.md` | FAIL |
| 20, 34 | `getFavicon()` over a hand-built favicon URL — unless the custom code adds validation, racing, force refresh, or sources `getFavicon` lacks | `preflight` `favicon` (heuristic; the exception is judgment) | WARN |
| 21 | `launchCommand()` over a `raycast://extensions/<author>/<ext>/<command>` deeplink | `preflight` `launch-command` (a two-segment Store-page link is fine) | WARN |
| 22 | Deferred execution gated on a ref: trace the re-run path before calling a request dropped | `greptile-loop` triage — a reviewer instruction; answer with the dependency-array trace | triage |
| 24 | There is no `number` preference type | `preflight` `preference-type` (any type outside the seven Raycast supports fails) | FAIL |
| 25 | A PR must be undrafted before the team reviews it | `ship` keeps the PR a draft and **you** mark it ready — unchanged | process |
| 27 | No "You're absolutely right" in review replies | `greptile-loop` reply rules | process |
| 28 | Preferences are encrypted regardless of type | `greptile-loop` triage — decline a finding that asks for `password` type *for encryption* | triage |
| 29 | Inoh-specific action order | Not applicable outside that extension | — |
| 30 | `ActionPanel.Submenu` adds its own ellipsis | `greptile-loop` triage — decline a "missing ellipsis" finding | triage |
| 31 | Windows media sessions (SMTC) limitations are not bugs | `greptile-loop` triage | triage |
| 35 | Shell-only extensions → Script Commands | Marked **inactive** by Raycast; not applied | — |

Numbers 23, 32, and 33 are absent from the export.

**Two rules as exported carry broken examples.** Rule 11's "Good" and "Bad" are identical, and rule
14's "Good" block repeats its "Bad" import. The handlers above follow each rule's stated *What*.
