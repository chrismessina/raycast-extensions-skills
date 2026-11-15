# Plan: raycast-harness (`rx`) and the structural rewrite of the skills plugin

**Status:** approved direction (Chris, 2026-10-30: "B + C as a separate pass, with more up-front strategy"). Revision 3, after two Codex plan reviews (`2026-10-30-audit/plan-review-1.md`: 25 findings; `plan-review-2.md`: 12 of those resolved, 13 partial, plus F1–F13). All incorporated.
**Implementer:** Fable (`claude-fable-5-1`), phase by phase. **Reviewers:** Codex at every phase gate; Chris at the 🛑 points.
**Inputs, all checked in beside this file:** `2026-10-30-audit/job-A.md` … `job-D.md` (the four-job audit of this plugin) and `plan-review-1.md`, `plan-review-2.md`. Every finding ID used below (T, P1-, Q, X) is defined in [§10](#10-audit-appendix-every-finding-with-its-acceptance-criterion), with the report it comes from. Required acceptance criteria depend only on the two repos; §11 holds the local contracts that replace external skills (AGENTS.md verification, adversarial review scope, the session-URL rule).

---

## 0. Read this first

### 0.1 Roots

| Name | Path | What it is |
|---|---|---|
| `$SKILLS` | `~/Developer/GitHub/chrismessina/raycast-extensions-skills` | This repo. Public, MIT. The plugin is `$SKILLS/plugins/raycast-extensions` (`$P`). **The local marketplace loads this checkout in place** (`$SKILLS/CLAUDE.md:14–20`), so whatever is on disk here is live for every Claude Code session on this machine. |
| `$WT` | `~/Developer/GitHub/chrismessina/raycast-extensions-skills-harness` | A git worktree of `$SKILLS` on branch `harness`, created in Phase 0. **All plugin edits happen here.** The marketplace does not load it, so nothing is live until Phase 9 merges it. `$WP` = `$WT/plugins/raycast-extensions`. |
| `$RX` | `~/Developer/GitHub/chrismessina/raycast-harness` | The open-source project. **The public GitHub repo already exists** (`chrismessina/raycast-harness`, Apache-2.0, branch `main`, containing only `LICENSE`, created by Chris 2026-10-30). Phase 1 clones it here. Nothing is pushed until 🛑 Phase 9. |

`~` is `/Users/messina`. Paths are written with `~` because this file ships in a public repo.

### 0.2 What you are building

The skills plugin tells agents how to build and ship Raycast extensions. About half its ~15,000 lines are shell procedures that agents re-type into Chris's shell (zsh, `rtk` rewriting `ls`/`grep`, `eza` behind `ls`). Most of this year's defects came from that re-typing, not from wrong rules: `grep -P` erroring into a false pass, zsh not word-splitting `$VAR`, `${X:+--flag "$X"}` arriving as one argument, `ls` hiding `.claude` and then hanging a publish. **`rx` moves every deterministic procedure into a tested Node CLI with explicit verdicts.** Skills shrink to procedure and named judgment calls; policy gets one home; incident history moves to learnings.

### 0.3 Working rules

1. **Git state:** never `add -A`, `commit`, `stash`, `checkout <path>`, `restore`, `reset` or `pull` except where a task says so. Never edit files in `$SKILLS` itself after Phase 0; edit `$WT`. If a command dirties a tree, say so and leave it.
2. **Shell:** use `/bin/ls`, `command grep` or `rg`; never store a glob in a variable; iterate with `while IFS= read -r`; branch on exit codes explicitly. Prefer Node.
3. **Witnessed red:** every new check ships with a test that fails when the check is disabled. Show it: disable, run, paste the failure, restore, paste the pass.
4. **Receipts:** every "Done when" is commands whose raw output you paste.
5. **US English** everywhere (`$P/reference/house-style.md`, `us-english`).
6. **No Claude session URLs or Claude attribution lines** in commits, docs or anything public. `Co-Authored-By: Claude` trailers are allowed.
7. **🛑 points need Chris.** No outward action (create a remote repo, push, publish to npm, open a PR, merge to `main`) anywhere else.
8. **Evidence moves, never vanishes.** A cut narrative goes to a learning (new or existing) unless an identical account is already there; cite the destination.
9. **No `/Users/` paths** in any file under `$RX` or committed to `$SKILLS`; use `~` or repo-relative paths.

### 0.4 Decisions (do not reopen)

| # | Decision |
|---|---|
| D1 | `rx` is its own public repo `chrismessina/raycast-harness`, **Apache-2.0** (Chris's choice; keep his `LICENSE` file as is), npm package **`raycast-harness`** (`"license": "Apache-2.0"`), executables **`rx`** and **`raycast-harness`**. (`rx`, `rxh` are taken on npm; `raycast-harness` was free on 2026-10-30.) The skills plugin stays MIT. A `NOTICE` file credits third-party material `rx` vendors: the Greptile rule snapshot copied from `raycast/extensions` (MIT, Raycast), with its source commit. Code moved from the MIT plugin into `rx` (preflight, greptile-drift, the ESLint rule, pr-body) is Chris's own and is relicensed by him; say so in `NOTICE`. |
| D2 | Node ≥ 22, ESM `.mjs`, JSDoc types checked with `tsc --noEmit --checkJs`. No build step. |
| D3 | One runtime dependency: **`pngjs`**, pinned exactly. Dev: `typescript`, `eslint`. |
| D4 | **Core vs preset.** Core encodes only objective, ecosystem-wide facts: Raycast's Store requirements, its Greptile rule snapshot, and what `ray publish` does. Everything Chris-specific (house style, dependency floors, fleet adoption policy, TODO/LICENSE/AGENTS exceptions, logger rules) lives in a **preset** file in `$P/presets/chrismessina.json`, loaded with `--preset <file>`. Core contains no Chris-specific value. |
| D5 | **One runner.** The plugin ships `$P/scripts/rx.mjs`, the only way skills and hooks call `rx`. It reads the exact version from `$P/rx-version.json`, invokes that version's executable with an argument array (resolving it from a local `$RX` checkout when `RX_DEV=<path>` is set, otherwise `npx -y raycast-harness@<version>`), and always passes `--preset <absolute plugin preset path>` to commands that accept one. Skills and hooks call the runner by its absolute plugin path (`node "<plugin>/scripts/rx.mjs" <command> …`). CI rejects any bare `rx` or direct `npx raycast-harness` in skills or hooks and validates every command/flag combination used against the pinned package's `rx commands --json`. `reference/rx.md` is generated from `rx-version.json` plus `rx commands --json`. |
| D6 | **Judgment via `rx judge` (Phase 7): advisory only.** Providers in order: Jev (`TYPESAFE_API_KEY`, the name TypeSafe's own SDK reads; changed from `JEV_API_KEY` by Chris on 2026-11-04 before any use), Claude Haiku `claude-haiku-5-5` (`ANTHROPIC_API_KEY`), else `agent` mode (prints the structured question). It never blocks and never acts. Jev (TypeSafe, September 2026) returns probabilities over predefined answers; its published speed/cost numbers are from secondary sources and unverified. |
| D7 | **History.** All plugin work is on branch `harness` in worktree `$WT`. Phase 0 makes one signed checkpoint commit there of the current `$SKILLS` working tree. The final merge to `main` is **one squash commit** (Chris asked for one big commit). `$RX` keeps its own history. |
| D8 | **Activation is atomic and last.** `$SKILLS` (live) keeps its current skills, scripts and hooks unchanged until 🛑 Phase 9 merges `harness` after `raycast-harness` is published and a clean-cache install smoke test passes. |
| D9 | The one-home taxonomy in §3 governs every edit. |

---

## 1. Verdict protocol (every `rx` command)

- One line per check: `VERDICT  check-id  message`. VERDICT ∈ `PASS`, `FAIL`, `WARN`, `N/A`, `ERROR`. `N/A` states why.
- `--json` prints one document: `{ "command", "version", "fingerprint": <string|null>, "data": { …command-specific… }, "results": [ { "id", "verdict", "message", "details": [ { "file", "line", "text" } ] } ], "exit" }`. Domain outcomes (`PUB_DIR`, SAME-PIXELS, OURS-SAFE, …) go in `data` or `details`; they are never extra verdicts. Each command section below gives its verdict mapping.
- Exit **0** = only PASS/WARN/N/A; **1** = any FAIL; **2** = any ERROR (outranks FAIL).
- Silence is never a pass. Nothing to inspect → `N/A` with reason; input failed to load → `ERROR`.
- Unknown arguments → `ERROR` (exit 2).
- Network: each command documents its network boundary, including child processes it starts. A network failure inside a command's purpose is `ERROR`. **Two explicit exceptions:** `guard` speaks the host hook's allow/block transport (silent on allow); `api-floor`'s optional npm-currency advisory reports `N/A (npm unreachable)` while its local floor check still runs.
- No shelling out to `ls`, `grep`, `find`, `sed`. Git, `gh`, `npm`, `ray` run through `execFile` with argument arrays.
- Every command has: an argument schema, a root-resolution rule (below), a `data` schema, and a state location (where it reads/writes files). These go in the command's `--help` and in `$RX/docs/commands.md`, written **before** the command's code.
- **Root resolution (all commands taking an extension):** `--root <dir>` wins. Otherwise walk up from cwd to the nearest `package.json` with a `commands` array; if none, search downward one level; **more than one candidate → ERROR** asking for `--root`.
- **State locations:** run state goes under `$(git rev-parse --git-path rx)` in the extension's repo (never in the payload, never in the npm install), or under `$XDG_CACHE_HOME/raycast-harness` (default `~/.cache/raycast-harness`) for cross-repo caches.

Implemented once in `$RX/src/verdict.mjs` and `$RX/src/args.mjs`, with tests for each exit code, the unknown-argument rule and root ambiguity.

---

## 2. Layout of `$RX`

```
raycast-harness/
  bin/rx.mjs                  # dispatcher; `rx commands --json` lists commands, flags, schemas
  src/verdict.mjs src/args.mjs src/root.mjs src/git.mjs src/gh.mjs src/fingerprint.mjs
  src/commands/<name>.mjs     # one file per command (§4)
  src/rules/store.json        # Raycast Store requirements (core)
  src/rules/greptile/         # versioned Greptile snapshot: rules.md config.json files.json SOURCE.json
  src/judge/                  # Phase 7
  eslint-plugin/              # eslint-plugin-raycast-harness (§4.13)
  docs/commands.md            # argument/data/state contracts, written before code
  test/<name>.test.mjs        # node:test
  test/fixtures/extensions/<name>/ + expected.json   # checked-in fake extensions with expected verdicts
  test/fixtures/real/         # recorded real inputs, scrubbed (see Phase 3)
  README.md CONTRIBUTING.md LICENSE (Apache-2.0, exists) NOTICE SECURITY.md CHANGELOG.md
  .github/workflows/ci.yml    # node --test, tsc --checkJs, eslint, fixtures vs expected.json
  package.json                # bin: rx, raycast-harness; engines node >=22; files allowlist
```

Presets and the runner live in the plugin: `$WP/presets/chrismessina.json`, `$WP/scripts/rx.mjs`, `$WP/rx-version.json`.

---

## 3. Where every rule lives

| Layer | Holds | Lives in | Rule |
|---|---|---|---|
| Mechanics | anything a program can decide | `$RX` commands and ESLint plugin; preset-bound checks | Prose about a mechanical rule is one line: "`rx <cmd>`: `<check-id>` must pass." |
| Policy | what a rule is and why, with its ID | `$WP/reference/*.md` | One home per rule ID; elsewhere, link the ID only. |
| Procedure | when to run what; what to do with each verdict | `$WP/skills/*/SKILL.md` | No rule bodies; no shell beyond one runner line; no incident narratives. |
| Judgment | decisions with no deterministic answer | the step that needs it, named (`rx judge <id>` once Phase 7 lands) | A question with a fixed answer set; recorded in the agent audit (§4.9). |
| Evidence | receipts, incidents, measurements | `$WP/learnings/**` | Routed by frontmatter; contains no instruction that competes with policy. Superseded claims stay only as explicitly retracted history. |
| Preset data | rule IDs, scope, severity, bindings, Chris's floors and exceptions | `$WP/presets/chrismessina.json` | Schema in §4.16. Generated tables come from here. |

---

## 4. Commands

Port faithfully first (Phase 2), then apply fixes (Phase 3), each fix with its own witnessed-red test. "Fixes" names §10 IDs.

### 4.1 `rx preflight [--root d] [--published d] [--preset f] [--json]`
- **Port:** `$WP/scripts/preflight.mjs` + test (27 emitted check IDs at the reviewed baseline: 23 literal plus four heuristic, including `agent-scaffolding`, `dev-material`, `generated-files`, `readme-assets`). Network: none.
- **Fixes:** P1-2; Q10 (zero placeholders FAIL; the top entry must carry `{PR_MERGE_DATE}`); T3 and T4 (Markdown-aware image extraction: reference definitions, angle-bracket destinations, attribute whitespace, query/fragment stripped, fenced and inline code excluded; one fixture per form, including a fenced example that must pass); Q9 (every relative link in README and docs, any form, resolved from its own directory).
- **Severity:** a preset binding (§4.16) can set the block/report level of a core check only for the house-style rule it binds; it can never downgrade an unrelated core FAIL.
- **New checks:** screenshots: count ≤ 6, `.png` only (the Store's `metadata-images` job collects `.png/.jpg/.jpeg/.webp/.gif/.bmp` and rejects all but PNG; anything else in `metadata/` is FAIL), 2000×1250; icon 512×512; preset checks for preference description ≤ 80 / label < 50 (report) and logger rules as three separate checks (fixes T5, Q12): `logger` (self-authored + web requests), `logger-verbose-copy` (wherever `verboseLogging` is declared, full block compared), `logger-strict-redaction` (self-authored + installed logger ≥ 1.5.0, report-only). Absence is `N/A` with reason, never silence.

### 4.2 `rx stale [--root d] [--json]`
- **Port:** develop step 0 and ship step −1: sparse fetch of `raycast/extensions`, content diff, classifier MINE / CHECK / NEW? / UPSTREAM / ONLY-PUB / UNHANDLED, symlink and mode checks. Network: GitHub API and git fetch.
- Resolves root first (fixes Q3). Any lookup failure other than 404 → ERROR. `data`: `{ published, publishedDir, baseline }`. Unpublished (404) → `published: false`, `publishedDir: null`, `baseline: null`, one `N/A (not published)` result. Verdicts: UPSTREAM / ONLY-PUB / UNHANDLED → FAIL; MINE → PASS; CHECK and NEW? → **WARN that requires an audit disposition** (§4.9) tied to the path, local content hash and baseline SHA before `guard` authorizes publishing; an unresolved CHECK/NEW? blocks. The checkout persists under the state location for later commands.
- Replaces `$WP/reference/sparse-checkout-discipline.md:67–78` (fixes Q18).

### 4.3 `rx png --published d [--root d]`
- Signature: `rx png [--published d] [--root d]` (`--published` optional). **Read-only**: it recommends, never modifies files. Decode with `pngjs` to RGBA; read IHDR bit depth and the `gAMA`, `iCCP`, `sRGB`, `cHRM` chunks with a bounds-checked chunk reader. Equal size + RGBA + metadata → SAME-PIXELS (PASS; recommend adopting the published copy). Bit depth > 8 or differing metadata → UNDECIDED (FAIL; Chris compares by eye). No published copy (or no `--published`) → LOCAL-ONLY (`N/A`, keep local). Otherwise provenance through git history: OLDER-SHOT (WARN requiring an audit disposition tied to path, local content hash and baseline SHA; historical membership alone never authorizes keeping local) or NOT-YOURS (FAIL; needs Chris). Decode or chunk failure → ERROR. No `sips` pass (fixes X7).
- Tests: each metadata chunk independently, present vs missing, corrupt file, changed transparency, RGB vs RGBA equivalence, 16-bit.

### 4.4 `rx scan --forbidden f [--pr-text f]... [--root d]`
- Gate −2: literal matches of each forbidden line across the payload ray copies (contents and names, same skip list), the commit-message range ray uses (`HEAD...<publish tag>` or all history), and any PR/comment text files. Binary files → WARN listing them for a human look. Empty forbidden file → `N/A` with "every example approved", never PASS. `data.forbiddenHash` = SHA-256 of the forbidden file.

### 4.5 `rx changelog [--root d] [--published d] [--merge]`
- Placeholder count/position; dated history matches published **except recorded privacy redactions** required by gate −2 (`--redactions <file>`: each entry names the heading, the original and replacement text hashes and the forbidden-list line matched; dates and other text unchanged); bullets ≤ 280 (WARN). Tests: an authorized historical redaction passes; an unrelated historical edit fails. `--merge` (during a merge) rebuilds CHANGELOG from HEAD and MERGE_HEAD by heading structure; ambiguous boundary → ERROR with a diagnostic (fixes Q6).

### 4.6 `rx contributions --published d [--root d]`
- Run during a `pull-contributions` merge. For each conflicted file, scoped to the extension subtree (works from a monorepo checkout), compare the incoming blob with the published blob for that path. Equal → `OURS-SAFE` (PASS, proof in details: both blob IDs). Different → `REAL-CONTRIBUTION` (FAIL). Path sets compared in both directions; missing objects → ERROR. CHANGELOG containment only ever decides `CHANGELOG.md`. Also detects a merged PR's leftover `ext/<name>` branch whose only new commit is raycastbot's date stamp (WARN with the explanation). Fixes T1, T2.
- Required test: a contributor code fix with no CHANGELOG entry comes out `REAL-CONTRIBUTION`.

### 4.7 `rx api-floor --preset f [--root d]`
- Reads dependency policy **only from the preset** (core has none; fixes plan-review #7). The preset defines two policies: existing extensions on 1.x, and new extensions on 2.x. Checks both the manifest range and the lockfile-resolved version against the applicable floor (below floor → FAIL). npm currency is an advisory WARN; npm unreachable → `N/A`. Fixes Q8.

### 4.8 `rx gates --preset f --forbidden f [--root d]`
- **Deletes any existing receipt first.** Then runs, in order: `stale` → `scan` → `preflight` (with `--published <stale's dir>` when `stale` reports `published: true`; without it otherwise, so published-comparison checks report `N/A (not published)` while local checks run) → `api-floor` → `npm run build` (generates `raycast-env.d.ts`) → `npx --no-install tsc --noEmit` → `npm run lint` (fixes Q1). Missing local tooling → ERROR; it never installs packages. Build and lint may do whatever the project's scripts do (documented network boundary).
- **Fingerprint** (`src/fingerprint.mjs`, no git writes): SHA-256 over a sorted, length-delimited manifest of every path in the publisher copy set (extension root minus ray's fixed skip list, **including ignored and untracked files**): path, entry type, executable bit, symlink target, file bytes. Plus, separately: HEAD SHA, publish tag/range, preset bytes, forbidden-list bytes, rx version, and the published baseline SHA or the literal marker `unpublished` (so a later first publication invalidates the receipt). Tests: unstaged tracked edit, deletion, rename, mode change, new ignored file, new untracked file, changed preset, changed forbidden list — each changes the fingerprint.
- Writes `<git-path rx>/receipt.json` **only if every step finished with no FAIL or ERROR**: `{ fingerprints, results: [every step's results], rxVersion, at }`. An interrupted run leaves no receipt.

### 4.9 `rx guard` (plugin PreToolUse hook) and the agent audit
- Reads the hook payload on stdin. For a Bash command that runs `npm run publish`, `ray publish` or `npx … ray publish`: allow only if (a) `receipt.json` exists, (b) all its fingerprints match a fresh computation, (c) every required step is present with no FAIL/ERROR, and (d) `audit.json` (below) exists, matches the same fingerprint and has no blocking failure. Otherwise block with one sentence naming what is missing or stale. For `gh pr ready` in any form: always block ("marking ready is Chris's click").
- **`audit.json`** is the judgment evidence the receipt cannot hold (fixes plan-review #3, Q2). The agent writes it with `rx audit record`, which validates it: one entry per applicable house-style rule ID and Greptile judgment rule (`id`, `scope`, `severity` from the preset, `result` pass/fail/n-a, `evidence` text), runtime shortcut validation (`rx shortcuts --check`, §4.13), and runtime/destination verification entries for any external effect in the diff. Blocking failures block; report-only failures are recorded and do not block.
- Hook wiring: `$WP/hooks/hooks.json`. **Read Claude Code's current plugin-hook documentation (Context7 or the docs site) before writing it**; record the doc URL and the format you used in your report.
- Tests: recorded payloads for: no receipt; current receipt with a FAIL; receipt missing a step; stale fingerprint; valid receipt without audit; valid receipt + audit with a blocking failure; all valid (allowed); `gh pr ready` (blocked).

### 4.10 `rx pr verify|files|body` (port of `$WP/skills/ship/scripts/pr-body.py`)
- `verify <N> --author <login> --extension <name>`: author, head branch `ext/<name>`, draft, open, base `raycast/extensions:main`, each a result.
- `files <N> --extension <name> [--preset <file>]`: FAIL on any file outside `extensions/<name>/`; each file's GitHub status (added, modified, removed, renamed) in `data.files`; with `--preset`, `pr-local-only` FAILs when a file the preset's `holdout.localOnly` lists is added, modified or renamed in rather than removed.
- `body <N> --initial f | --splice edits.json [--apply]`: same safety as `pr-body.py` (initial only onto an unedited body; whole-line anchors; re-read before write; single write; history check after). `--initial` refuses a body whose checklist does not contain Raycast's template checklist (`.github/pull_request_template.md` from `raycast/extensions`) verbatim.

### 4.11 `rx holdout out|in --preset f [--root d]`
- Moves **only untracked** entries classified local-only by the preset (default `.env`, `.claude`, `.superpowers`). Never moves tracked files. Never touches files the preset keeps shipping (contributor docs, a published `LICENSE`, the brew/dev-null `TODO.md` exceptions). Since Chris's 2026-11-03 ruling, `AGENTS.md`, `CONCEPTS.md`, `CLAUDE.md` and `HANDOFF.md` are local-only too: the preset lists them, holdout moves them out of the payload, and a published one is deleted through `rx stale`'s REMOVE class and an audit `remove-published` disposition. Other published leaks are handled as committed deletions, not holdouts. Inventory records source, destination, entry type and content fingerprint; `in` restores without overwriting a changed destination and verifies exact restoration. An empty inventory while a preset-listed local-only path exists → ERROR. Fixes plan-review #8.

### 4.12 `rx greptile fetch|wait|can-reply|drift`
- `fetch <N>`: the summary (score, `updated_at`, last reviewed commit) and inline findings (`id`, `original_commit_id`), plus the PR head. Writes the round to state, keyed by summary `updated_at`.
- `wait <N>`: the single-shot ETag check from `raycast-pr-loop` §4; "check failed" is ERROR, never "no change".
- `can-reply <N> --round <updated_at> --finding <id> --expected-head <sha> --forbidden <file> --reply <file> --evidence <file> [--claims-fix]`: the finding must belong to the stored round and the fetched PR head must equal `--expected-head`. `--evidence` is JSON `{ finding, disposition: fixed|partial|declined, artifact, explanation }`. With `--claims-fix`, a publication record written by the runner's publish step must name this PR and the current remote SHA, which must differ from the round's reviewed commit. A decline permits an unchanged head. The exact reply bytes are scanned with the supplied forbidden list. Records repository, PR, round, finding, expected head and the evidence, forbidden-list and reply hashes. Missing or mismatched evidence → ERROR; failed authorization → FAIL. Authorization covers only those reply bytes at that head. Fixes P1-3.
- `drift [--update --dest <maintainer checkout>]`: port of `$WP/scripts/greptile-drift.mjs`. The snapshot lives in core at `src/rules/greptile/` and is versioned with the package. `--update` writes only to an explicit `--dest` checkout, never into an installed package. The plugin's `greptile-rules.md` records the core snapshot identity (`SOURCE.json` SHA) it maps; updating the snapshot means a core release plus a plugin pin/mapping update in one coordinated change. Every plugin link to `reference/greptile/` and to the old script is rewritten in the same change that removes them (fixes plan-review #18).

### 4.13 ESLint plugin and `rx shortcuts`
- `eslint-plugin-raycast-harness`: move `$WP/reference/eslint-rules/no-multiline-emptyview-description.mjs`; add `no-ambiguous-shortcut` (including object literals such as toast `primaryAction`, for extensions declaring macOS and Windows), `copy-error-pairing` (helper forms accepted), `no-toast-hide-in-cleanup`. RuleTester cases for each.
- `rx shortcuts --runtime` reads the installed Raycast app's API shim (the extraction in `$WP/reference/keyboard-conventions.md`) and writes the full `Keyboard.Shortcut.Common` table, app version and shim fingerprint to the cache state location. `rx shortcuts --check` compares an extension's resolved panels against that table. No matching table → `ERROR (runtime evidence unavailable)`, and when shortcut verification applies (the extension declares any shortcut), the audit cannot be completed and `guard` blocks. `N/A` is accepted only when the extension declares no shortcuts. ESLint rules take an explicit table path option. CI uses recorded shim fixtures and never needs Raycast.app. No claim that a bundled table matches every runtime (fixes plan-review #16).

### 4.14 `rx api-diff <from> <to>` (Phase 8, optional for v0.1)
- Deterministic half of `$WP/skills/api-changelog/SKILL.md`. Fixes Q15, Q16, Q17, Q22 by construction; if Phase 8 is skipped, Phase 5 fixes them in place to the same acceptance criteria (§10).

### 4.15 `rx doctor`
- Node version, `ray` resolvable from the root, `gh auth status` (an explicit network probe), git signing configured (report), Raycast app version. Report only.

### 4.16 `rx preset check|table` and the preset schema
- **Core vs preset classification of legacy checks** (F6): before porting, classify every one of the 27 legacy preflight checks as `core` (an objective Store rule) or `preset` (Chris's policy), and record it in `$RX/docs/check-classes.md`. Preset-class checks (`prettierrc` with its exact values, `hand-typed-preferences`, `agent-scaffolding`, `dev-material`, `generated-files`, title-case and any other house convention) take their values, applicability and severity from the preset; core without a preset does not enforce them. Phase 2's equivalence comparison runs with a compatibility preset that reproduces legacy behavior exactly. Tests: core with no preset; preset on a self-authored extension; preset on a fork.
- The complete preset JSON Schema (`$RX/schema/preset.schema.json`) and a populated, valid `chrismessina.json` are checked in **before** Phase 3 code. Schema (`"schema": 1`), unknown fields rejected:
  - `rules[]`: `id`, `title`, `anchor` (policy section in a reference file), `tag` (`build`/`verify`/`both`/`lint`), `applies` (an applicability expression, below), `severity` (`block`/`report`), `bindings[]` (each `{ "kind": "rx" | "eslint" | "judgment", "check": "<id>", "coverage": "full" | "partial" }`).
  - **Applicability grammar (closed):** an expression is `true`, a condition, or `{ "all": [...] }` / `{ "any": [...] }` / `{ "not": … }`. Conditions and where each context value comes from: `selfAuthored` (package.json `author` equals the preset's `owner` login), `platforms` contains `macOS`/`Windows` (package.json `platforms`, absent = `["macOS"]`), `published` (`stale`), `webRequests` (the house-style `logger` audit pattern over `src/`), `declaresPreference: <name>` (package.json preferences, extension and command level), `dependency: { name, minVersion }` (lockfile-resolved), `hasViewCommand`, `writesFiles`, `callsAI`, `declaresInterval` (package.json and source patterns listed in `$RX/docs/applicability.md`, written before code). Unknown condition → schema error.
  - `owner`: the GitHub login whose extensions are self-authored (`chrismessina`).
  - `dependencies.api` (Chris's recorded policy, from `dep-gates.md` and ship §1): extensions whose lockfile-resolved `@raycast/api` major is 1 use policy `existing-1x` (floor `1.104.25`); major 2 use `2x` (floor `2.1.0`); a brand-new extension (stale: `published: false`) uses `2x` and must not resolve to 1.x. FAIL when the lockfile-resolved version is below the floor; WARN when the manifest range's lower bound is below the floor; npm currency advisory as 4.7. Nothing else is inferred.
  - `holdout.localOnly[]`, `ship.keep[]` (named exceptions with the extensions they apply to).
- `rx preset check f`: duplicate IDs, unresolved anchors, a non-build rule with no binding, a binding that does not exist in **its own registry** (`rx` bindings against `rx commands --json` checks; `eslint` bindings against the ESLint plugin's rule list; `judgment` bindings against `src/judge/decisions/` plus a declared list of manual judgment IDs in the preset), a binding that would downgrade an unrelated core check → FAIL.
- `rx preset table f --into <reference file>`: regenerates the region between `<!-- rx:matrix:start -->` and `<!-- rx:matrix:end -->` (rows for non-build rules only, with the Rule column), sorted by file order of anchors. `--check` fails if the region differs. Known ID mismatches to bind explicitly: `hand-typed-preferences` ↔ `no-hand-preferences`, `changelog-order` ↔ `merge-date-placeholder`, `prettierrc` (partial coverage).

---

## 5. Phases

Each phase ends with: every "Done when" receipt, an adversarial review of the phase diff per §11.2 (Codex at high effort when available), fixes, and a short report. No open P1/P2 findings when the next phase starts.

### Phase 0: protect and isolate — 🛑 at step 4
1. Save `git -C $SKILLS status --short` (it holds three sessions' uncommitted work: the video-downloader session's `develop`/`ship`/`raycast-pr-loop`/preflight `readme-assets` and test edits; the Greptile session's `greptile-rules.md`, `reference/greptile/`, `greptile-drift.mjs` and test, preflight file checks, CI and pre-push changes, `readme-template.md`, `CLAUDE.md`; an Instagram learning; and this plan with its audit folder).
2. Run `node --test $P/scripts/*.test.mjs` and `bash $SKILLS/check-references.sh` in `$SKILLS`; paste results.
3. Write `docs/plans/2026-10-30-audit/baseline.md`: the status listing, the test results, `wc -l` of every SKILL.md and reference file, the preflight check-ID list (`node $P/scripts/preflight.mjs --json` over a fixture or extension, IDs only).
4. 🛑 Ask Chris to approve these exact commands, which create the checkpoint **without touching `$SKILLS`'s branch, index or files** (the live plugin keeps running from them):
   ```bash
   cd ~/Developer/GitHub/chrismessina/raycast-extensions-skills
   TMPIDX="$(mktemp)"; rm -f "$TMPIDX"                 # a fresh index file, separate from .git/index
   GIT_INDEX_FILE="$TMPIDX" git read-tree HEAD          # start from main's tree
   GIT_INDEX_FILE="$TMPIDX" git add -A                  # + every tracked change and untracked non-ignored file
   TREE="$(GIT_INDEX_FILE="$TMPIDX" git write-tree)"
   SHA="$(git commit-tree -S "$TREE" -p HEAD -m "Checkpoint: uncommitted work from three sessions, 2026-10-30")"
   git branch harness "$SHA"
   git worktree add ~/Developer/GitHub/chrismessina/raycast-extensions-skills-harness harness
   rm -f "$TMPIDX"
   ```
   Run it in a subshell with `set -e`, an EXIT trap that removes `$TMPIDX`, and an explicit check after every command; abort before `git branch` if `read-tree`, `add`, `write-tree` or signing fails. Before running, record the SHA-256 of `.git/index` and `git rev-parse HEAD`; after, verify both are unchanged. What it captures: current working-file content of HEAD-tracked paths plus untracked non-ignored files. It does **not** preserve a separately staged version of a file, or ignored files force-added but absent from HEAD; inventory those (`git diff --cached --name-only`, `git ls-files -ci --exclude-standard`) and show Chris before he approves. On any failure, report which step failed and which objects, temp files or refs were created; never claim nothing changed.
- **Done when:** `git -C $SKILLS status --short` is byte-identical to step 1's output; `git -C $WT log -1` shows the signed checkpoint; `git -C $WT status --short` is empty.

### Phase 1: scaffold `$RX`
1. `gh repo clone chrismessina/raycast-harness $RX` (the remote exists, with `LICENSE` only). Do not modify `LICENSE`. Add the §2 layout, `NOTICE` (per D1), README (purpose, `npx raycast-harness`, verdict protocol, commands, core vs preset, Apache-2.0 license section), CONTRIBUTING (witnessed red, verdict protocol, fixtures; contributions under Apache-2.0), SECURITY.md, CHANGELOG (`Unreleased`). Work on a local branch `scaffold`; commit locally (signed); **do not push**.
2. `docs/commands.md`: argument, root, data and state contract for every §4 command, before any command code.
3. `verdict.mjs`, `args.mjs`, `root.mjs`, `rx commands --json`, `rx doctor`, with tests.
4. Implement and install the session-URL commit hook per §11.3 (checked-in `scripts/commit-msg` plus tests). Chris's dotfiles installer (`bash ~/Developer/dotfiles/git-hooks/install-no-session-url.sh`, run inside `$RX`; it works now that the repo is public with a remote and never overwrites a different existing hook) may be run in addition; read its output. Verify locally: a message containing `claude.ai/code/session_x` is rejected, one with only a `Co-Authored-By: Claude` trailer is accepted. It rejects session URLs only; other attribution rules remain a review requirement.
- **Done when:** `node --test` green; `npx tsc --noEmit --checkJs -p .` exit 0; `node bin/rx.mjs bogus --x` exits 2 with an unknown-argument ERROR; a two-extension temp tree makes any root-taking command exit 2 asking for `--root`; hook accept/reject outputs pasted.

### Phase 2: port what exists
`preflight` (4.1, behavior only), `greptile drift` (4.12), `pr body` (4.10), into `$RX`. Port the existing tests.
- **Done when:** a comparison script runs old and new preflight over every checkout matching `~/Developer/GitHub/chrismessina/raycast-*` and over the test fixtures, normalizes both to `(id, severity, file, line)` for checks with equivalent inputs, and shows **no lost legacy finding**. Expected differences (new PASS/N/A lines, JSON envelope, unknown-argument and unreadable-input ERRORs required by §1) are listed in a reviewed exceptions file `test/port-exceptions.json`.

### Phase 3: policy data, generators, new mechanics
1. **Resolve current dependency policy first** with Chris's recorded decisions: existing extensions stay on their major unless migrating (1.x floor `1.104.25`); new extensions start on 2.x; submit the version last exercised in Raycast; npm newest is advisory (`$WP/reference/dep-gates.md` Oct 20 section and `ship` §1). Write it as the preset's `dependencies` block.
2. Write the preset (§4.16) from `house-style.md` (51 rule IDs, 42 matrix rows, 9 build-only at the reviewed baseline) with explicit bindings. Implement `rx preset check|table`.
3. Implement 4.1 fixes and new checks, 4.2–4.8, 4.10 `verify`/`files`, 4.11, 4.12 `fetch`/`wait`/`can-reply`.
4. **Real-data fixtures:** create scrubbed fixtures under `test/fixtures/real/` for: a dubbed-YouTube format list (shape of yt-dlp `--dump-json`), a pull-contributions merge whose incoming side equals published, one whose incoming side is an older CHANGELOG plus a code change, and a URL-encoded README embed. Use only fake IDs (`AbCdEfGhIjK`) and generic titles; no real video IDs, titles or names.
- **Done when:** witnessed red for every check; `rx stale` and `rx contributions` run read-only against a real sparse fetch of one published extension with output pasted; `rx preset check` passes on the new preset and fails on a planted duplicate.

### Phase 4: enforcement
4.8 receipt and fingerprint, 4.9 guard + audit, 4.13 ESLint plugin and shortcuts. **Wire the hook only in `$WP`.**
- **Done when:** the eight guard payload tests (4.9) pass; fingerprint tests (4.8) pass; each ESLint rule has RuleTester valid/invalid cases including the toast `primaryAction` case.

### Phase 5: structural rewrite of `$WP`
Order (largest drift risk first). One commit per numbered item on `harness`. Before editing a file that gets a generated region, add its generator and `--check` mode.

1. **Runner and pin.** `$WP/scripts/rx.mjs` and `$WP/rx-version.json` (D5); during Phases 5–8 validation uses `RX_DEV=$RX`. Generate `$WP/reference/rx.md`.
2. **`dep-gates.md`**: one current-policy paragraph plus the table; every superseded instruction removed; chronology to new learning `learnings/tooling-decisions/raycast-api-policy-history.md` (P1-1, X1, X17, Q19).
3. **`ship/SKILL.md`** (≤ 450 lines from 1,698): steps become runner calls plus verdict handling plus named judgment calls. The HARD GATE checklist becomes the evidence contract: current successful `rx gates` receipt **and** a valid `rx audit record` (4.9), with house-style judgment results, Greptile judgment rules, shortcut validation and destination verification preserved and named (plan-review #3, X8, Q2). PR-body procedure moves to `pr-and-cleanup.md`, which loses the retired manual route and uses `git rev-parse --git-path` (X5, Q7). PNG triage, README/screenshot greps, staleness classifier, API floor, CHANGELOG rebuild and pull-contributions narratives become runner calls (X7, X13, X16, Q5, Q6, T1, T2). Keep list (§8) intact.
4. **`develop/SKILL.md`** (≤ 300): root, then `rx stale` (Q3); dev loop keeps launch, one watcher lifecycle (keep it alive through testing, stop it before handoff unless handing Chris the running watcher, said explicitly) (Q13), state checklist and destination verification; history to learnings (X4). Autofix callout becomes a pointer to the three hazards (P1-5). Copy-audit section names `us-english`, `empty-state-copy`, `pref-description-length`, `logger-verbose-copy`, `logger-strict-redaction`, each with its own scope from the preset (T5, T6).
5. **`raycast-pr-loop/SKILL.md`** (≤ 220): runner `greptile` calls, the reply rule via `can-reply` (P1-3), one bounded wait (X19), holdout via `rx holdout` (removes the ship ↔ loop cycle).
6. **`review-pr/SKILL.md`** (≤ 260): one recipe per operation (X10); delete the gotcha contradicting step 3 (Q20); build-before-tsc wording from `tsc-gate` (Q19); learning routes via frontmatter (item 9).
7. **`scaffold/SKILL.md`** (≤ 220): flat ESLint config and canonical `.prettierrc` included (Q4); build-before-tsc; one completion boundary.
8. **`house-style.md`**: policy only per rule; narratives to learnings (X9, X15, X18, X20); cache-schema script fixed to check without writing and hash the import closure, or removed with its gate claims (P1-4); Copy Error example redacts at the boundary (P1-7); the matrix becomes the generated region (§4.16).
9. **Learnings**: frontmatter `applies_to: [<skill>…]` and `trigger: "<when you are about to …>"` on every learning; generator `rx`-independent script `$WP/scripts/learnings-routes.mjs` writes each skill's routing table between `<!-- learnings:start -->` / `<!-- learnings:end -->`, sorted by trigger, with `--check`. Merge the procedures of `answer-a-blocking-review…` and `wrong-vendor-docs…` into `verify-the-remedy…`, keeping each incident as an evidence section (X3). **P1-6:** remove the lock-safety guarantee from operative text; keep it only as an explicitly retracted historical claim beside the counterexample from `portable-node-advisory-file-lock.md:129–141, 188–204`. Add the "which evidence is missing?" selector (X6). Fix Q23–Q28 and shorten `quadratic…` (X14) per §10.
10. **`keyboard-conventions.md`**: one precedence statement (current docs acceptable; runtime wins disagreements) (Q11), decision table first, chronology to evidence (X12).
11. **Remaining files:** `readme-template.md` (Q14), `sparse-checkout-discipline.md` (Q18), `templates/sync-from-upstream.yml` (explanatory history to a learning, X2; executable edits **only** for Q21: before reusing an existing remote branch, verify it contains this run's computed result, fail closed on lookup errors or mismatch; Q30 wording at the top), root `CLAUDE.md` and `githooks/pre-push` (Q29: remove `--no-verify` advice; preflight-order wording), `api-changelog/SKILL.md` (Q15–Q17, Q22 via `rx api-diff` or in place), `greptile-rules.md` (links and commands rewritten for the core snapshot per 4.12).
12. **Budgets for the other skills:** `api-changelog` ≤ 220, `screenshots` ≤ 160.
- **Done when:** for every §10 ID, the report names the commit and line that resolves it; every SKILL.md is within budget (`wc -l`); all generators pass `--check`; `check-references.sh` and all tests green in `$WT` with `RX_DEV=$RX`.

### Phase 6: CI for `$SKILLS` (in `$WT`)
- A checked-in budget manifest `$WP/budgets.json` covering every SKILL.md; a check failing on overrun.
- No `SUPERSEDED` / `Corrected …` markers in `skills/` or `reference/`.
- `rx preset check`, `rx preset table --check`, `learnings-routes.mjs --check`.
- Runner check (D5): no bare `rx`/`npx raycast-harness` in skills or hooks; every runner call's command and flags exist in the pinned version's `rx commands --json`.
- `$WP/test/fixtures/<name>/` with `expected.json` per fixture (including intentionally failing ones); CI compares actual verdicts to expected, not "all pass".
- Pre-push runs the same against the exported commit, with no sibling-checkout dependency. **Before publication** (Phases 5–8), validate with a candidate package: `npm pack` in `$RX`, install the tarball into an isolated temp directory, and point the runner at it with `RX_TARBALL=<path>` (a test-only override, never in shipped config). After Phase 9.2, repeat every check against the exact published pin with all overrides unset.
- **Done when:** each check's witnessed red (plant the violation, see CI fail).

### Phase 7: `rx judge`
- `src/judge/decisions/<id>.json`: `id`, `question`, `answers` (enum), `inputs` schema, `fixtures` (inputs + expected answer). Four decisions: `changelog-user-visible` (`user-visible` / `internal` / `branch-only-bug`), `review-finding-triage` (`valid` / `valid-wrong-remedy` / `false-positive` / `conflicts-with-chris`), `needs-code` (`code` / `metadata-only`), `png-provenance` (`ours-newer` / `contributor` / `unclear`). Fixtures come from receipts in `$WP/learnings` and this audit.
- Providers per D6. **Jev:** read TypeSafe's current public API docs first; if none are public, omit the adapter and say so in the README.
- Output (provider modes): answer probabilities, provider, latency; `defer-to-agent` when the top answer < 0.7. **Agent mode** prints the question, the answer schema and the inputs; it produces no probabilities and claims no accuracy. Provider errors are reported and fall back to agent mode; they never block submission by themselves.
- `rx judge eval <id>`: runs fixtures and prints per-case output and accuracy. **Adoption rule for v0.1:** a skill may present a *provider suggestion* for a decision only after that provider produces every fixture's expected answer; no calibration claims. Agent mode is always available once its structural tests pass. Required audit decisions stay mandatory whatever the provider does.
- **Done when:** eval output pasted for each provider available on this machine; agent mode works with no keys.

### Phase 8 (optional): `rx api-diff` (4.14)

### Phase 9: release and activation — four 🛑
1. 🛑 Push `$RX` to the existing public repo: merge the local work into `main` and push (Chris approves the push; the repo is public, so everything pushed is published).
2. 🛑 `npm publish` `raycast-harness@0.1.0` (Chris runs it or approves a token; npm 2FA is his).
3. In `$WT` only: set `$WP/rx-version.json` to `0.1.0`; bump the version in `$WT/plugins/raycast-extensions/.claude-plugin/plugin.json`, `$WT/.claude-plugin/marketplace.json` and the `$WT/README.md` "Status" line (`check-references.sh` compares them). Installation smoke test from a checked-in manifest `$WP/test/install-smoke.json` (exact arguments and expected exits): command discovery and `--help` for every command through the runner, plus operational cases run **only** against disposable fixture repos and mocked transports; never live PRs or real extension directories. `RX_DEV` and `RX_TARBALL` unset; a fresh temporary `npm_config_cache`. Full CI; final adversarial review of the whole `harness` diff against `main`.
4. Reconcile the live checkout. Compare `$SKILLS`'s current working tree with the Phase 0 checkpoint commit and list every change made since (other sessions keep working there). Write that inventory to `docs/plans/2026-10-30-audit/activation-inventory.md`.
5. 🛑 Chris approves the integration: (a) in a clean release worktree from `main`, squash `harness` (rebased onto any reconciled post-checkpoint changes from step 4) into one commit (D7); (b) only then activate it in `$SKILLS`, using the reconciliation Chris approved for its uncommitted files (no merge may overwrite them); (c) verify the live plugin loads (`/plugin` lists the new version; one runner call succeeds); (d) remove `$WT` and the release worktree.

---

## 6. What not to do

- No Chris-specific value in `rx` core (D4).
- `rx judge` never blocks or acts (D6).
- No network outside each command's documented boundary (§1).
- No edits in `$SKILLS` itself after Phase 0; no activation before Phase 9 (D8).
- No deletion of a learning's evidence while shortening it (0.3.8).
- No porting of `setup-mirror.sh` or a Codex wrapper into `rx` v0.1 (both are specific to Chris's setup). List the Codex launch/wait wrapper as follow-up for the user-level `codex-gate` skill in the final report.

## 7. Judgment that stays with the agent

Whether a CHANGELOG line is something a user notices; which side wins a genuine contribution conflict; whether a review finding conflicts with something Chris decided (always goes to Chris); UI copy quality; feature design; fork etiquette beyond the preset's scopes; when to stop a review loop. `rx judge` may suggest; the agent decides and records it in the audit.

## 8. Keep list

Staleness at both develop entry and ship (one command, both checkpoints) · separate build, tsc and lint · re-running gates after any dependency change or merge · decoded-pixel plus provenance screenshot triage and its 16-bit/color-metadata limits · the copy-versus-stage explanation of what `ray publish` ships · holdout inventory with verified restore · example-value scanning across contents, names, commit messages and PR prose · PR-body edit preservation and draft-state ownership · the human-speed race model and its self-triggered exception · the three-round and no-re-review bounds · resolved-panel shortcut semantics and all three `--fix` hazards · Copy Error per call site · toast ownership and update-order distinctions · self-authored vs fork scope · runtime and destination evidence · the audit matrix (generated, not deleted) · learning trigger pointers at every entry point · the four distinct verification learnings.

## 9. Open questions for Chris (none block Phases 0–8)

1. npm 2FA: run `npm publish` yourself, or approve a token?
2. Publish the `chrismessina` preset as an example in `$RX/examples/`, or keep it only in the plugin?
3. Two P3s from the Wave 3 Codex round 4 (2026-10-31), accepted as open items rather than fixed: (a) `rx guard` lets a `cd` target that is a FILE (`cd ./package.json && npm run publish`) reach the receipt check of the containing extension instead of blocking first; bash's own `cd` fails, so nothing publishes, but the guard could add `statSync(dir).isDirectory()`. (b) When `resolveRoot` finds the extension one level DOWN through a symlinked child, the guard reports and checks that lexical path (`/container/link`), not the physical target; the state and fingerprints still come from the right repository through git, but `data.roots` is not canonical. Fix both in one small change when the guard is next touched. **Done 2026-11-06 (Wave 7, `a3c1a08`).**
4. Artifact provenance (`docs/commands.md` §4.9 "Threat model", limitation 2): the receipt and audit are files the agent could write. Deferred past v0.1; an attestation keyed outside the agent's reach is the candidate. **Done 2026-11-06 (Wave 7, `a3c1a08`, `ddb4cf0`):** a per-machine HMAC key outside every repo, checkout and generation binding, and guard write protection. Nothing running as the same user is truly out of the agent's reach; the residuals are listed in `2026-10-30-audit/progress.md`.

---

## 10. Audit appendix: every finding with its acceptance criterion

Source column: report file in `2026-10-30-audit/` and its section. Each row's "Done when" is the acceptance criterion; the resolving phase is in parentheses.

| ID | Source | Finding | Done when (phase) |
|---|---|---|---|
| T1 | job-A §1 P1; job-C P1; job-D 2 | ship's superset test takes ours for every conflicted file after checking only CHANGELOG | `rx contributions` per-file decision; fixture "code fix, no CHANGELOG entry" → REAL-CONTRIBUTION; ship text gone (3, 5.3) |
| T2 | job-A P2; job-D 2 | superset test: repo-root paths vs extension-only PUB_DIR, unchecked `$bad`, one-directional, silence = pass | monorepo fixture; both-direction path comparison; missing object → ERROR (3) |
| T3 | all four jobs | readme-assets misses `<…>` targets, reference images, query strings, `src = ` whitespace | one fixture per form fails (3) |
| T4 | job-A, B, D | readme-assets fails on fenced/inline code examples | fenced-example fixture passes (3) |
| T5 | job-B P2 | develop bullet applies strict-redaction copy to forks | three separate logger checks with their own scopes (3, 5.4) |
| T6 | job-C 8; job-D rank 7 | develop receipt paragraph adds length | one line + learning link (5.4) |
| P1-1 | job-C P1 | dep-gates.md: incompatible `@raycast/api` policies | one policy paragraph; no superseded instruction remains (`rg -n "SUPERSEDED\|supersed" dep-gates.md` empty) (3.1, 5.2) |
| P1-2 | job-A P1 | zsh passes `--published "$X"` as one argument; preflight ignores unknown args | unknown arg → exit 2; skills call through the runner (1, 5.1) |
| P1-3 | job-A P1 | PR loop forbids replies to decline-only rounds | `can-reply` without `--claims-fix` succeeds on unchanged head with a receipt line (3, 5.5) |
| P1-4 | job-B P1 | cache-schema script writes under `--check` and hashes one file | fixed with tests, or removed with its claims (5.8) |
| P1-5 | job-B P1 | develop names one `--fix` hazard; keyboard-conventions has three | develop points to the three (5.4) |
| P1-6 | job-D 1 | `answer-a-blocking-review…:75–84, 139–144` teaches a lock guarantee retracted in `portable-node-advisory-file-lock.md:129–141, 188–204` | guarantee absent from operative text; kept only as retracted history beside the counterexample (5.9) |
| P1-7 | job-D 3 | house-style Copy Error example shows/copies raw `error.message` | example redacts both surfaces per `error-display-is-a-credential-disclosure-surface.md:84–96` (5.8) |
| Q1 | job-A, B, C | tsc before build in ship, scaffold, pr-loop | `rx gates` order; skills say build → tsc → lint (3, 5) |
| Q2 | job-A, B | "zero violations" makes report-only rules block; preflight vs matrix severity | evidence contract + preset severity bindings (3, 4, 5.3) |
| Q3 | job-B | develop runs staleness before resolving root | `rx stale` resolves root first (3, 5.4) |
| Q4 | job-B | scaffold has no ESLint config or `.prettierrc` | scaffold output passes `rx preflight` and `npm run lint` in a temp dir (5.7) |
| Q5 | job-A | bare negative greps abort under `set -euo pipefail` | greps replaced by runner calls (5.3) |
| Q6 | job-A | CHANGELOG rebuild raises ValueError when the shared heading differs | `rx changelog --merge` fixture with stamped vs placeholder heading (3) |
| Q7 | job-A | pr-and-cleanup describes the retired manual route and literal `.git/pr-body.md` | route removed; `git rev-parse --git-path` (5.3) |
| Q8 | job-A | API-floor prose promises aborts the commands lack | `rx api-floor` semantics in 4.7 (3) |
| Q9 | job-A | relative-link gate misses links without `./`/`../` | `[x](docs/a.md)` and `[x](LICENSE)` fixtures checked (3) |
| Q10 | job-A | zero placeholders accepted | fixture with no placeholder → FAIL (3) |
| Q11 | job-B | keyboard-conventions contradicts itself on docs vs runtime | one precedence statement (5.10) |
| Q12 | job-B | logger copy audits check partial blocks; silence passes | full-block comparison; absence `N/A` (3) |
| Q13 | job-B | develop: leave watcher running vs stop it | one lifecycle sentence (5.4) |
| Q14 | job-B | readme-template carries the loose grep | pointer to `rx preflight` (5.11) |
| Q15 | job-C | api-changelog `#` comment inside `node -e` | fixed (8 or 5.11): command runs; extraction failure exits non-zero |
| Q16 | job-C | api-changelog loop uses `break` after failure | exits non-zero on any pack/extract failure (8 or 5.11) |
| Q17 | job-C | digit-only diffs taken as proof of an empty release | changes must be the version fields (8 or 5.11) |
| Q18 | job-C | sparse-checkout `grep -v` hides real differences | recipe replaced by `rx stale` (3, 5.11) |
| Q19 | job-C | "ray build doesn't typecheck" in review-pr and dep-gates | `tsc-gate` wording (5.2, 5.6) |
| Q20 | job-C | review-pr gotcha contradicts step 3's baseline | gotcha deleted (5.6) |
| Q21 | job-C | sync template reuses a stale branch | verify-before-reuse; fails closed (5.11) |
| Q22 | job-C | api-changelog output path assumes this checkout | states it needs a repo checkout and resolves it explicitly (8 or 5.11) |
| Q23 | job-D 4 | `test-against-the-dependency…:64–75` "offline" probe can dispatch | recording transport injected; promise awaited (5.9) |
| Q24 | job-D 5 | wrong-base learning claims `-f base=main` changes the base repo | text says it sets a branch; separate observed vs claimed (5.9) |
| Q25 | job-D 6 | green-falsification misexplains `gh api -f` and `bash -c` | `-f` selects POST; exported env is inherited (5.9) |
| Q26 | job-D 7 | audit learning's "RIGHT" examples are still proxies | points to house-style per-call-site audit (5.9) |
| Q27 | job-D 9 | rendered-output learning prescribes the retracted hide-and-reshow | marked historical; routes to `animated-means-work`, `toast-no-id` (5.9) |
| Q28 | job-D 10 | quadratic learning's opening mandate contradicts its scope | three-condition scope first (5.9) |
| Q29 | job-C P3 | pre-push recommends `--no-verify` | advice removed (5.11) |
| Q30 | job-C P3 | sync template "never pushes to main" | content-vs-bookkeeping distinction at the top (5.11) |
| X1 | job-C rank 1 | dep-gates chronology (170–210 lines) | (5.2) report lines moved |
| X2 | job-C rank 2 | sync template narrative comments (110–145) | (5.11) executable lines unchanged except Q21 |
| X3 | job-D rank 1 | merge three review-premise learnings (100–140) | (5.9) |
| X4 | job-B rank 1 | develop dev-loop history (95–110) | (5.4) |
| X5 | job-A rank 3 | one PR-body procedure (95–125) | (5.3) |
| X6 | job-D rank 2 | verification learnings selector (90–120) | (5.9) |
| X7 | job-A rank 2 | PNG triage to one procedure (85–115) | `rx png` (3, 5.3) |
| X8 | job-A rank 1 | ship's second checklist (85–105) | evidence contract (5.3) |
| X9 | job-B rank 2 | house-style kit section (75–90) | (5.8) |
| X10 | job-C rank 3 | review-pr one recipe per operation (65–85) | (5.6) |
| X11 | job-A rank 4 | ship AGENTS.md section → pointer to the local contract in §11.1 (65–75) | (5.3) |
| X12 | job-B rank 3 | keyboard-conventions restructure (60–75) | (5.10) |
| X13 | job-A rank 5 | ship README/screenshot greps (55–65) | runner calls (5.3) |
| X14 | job-D rank 3 | quadratic learning shortened (55–75) | (5.9) |
| X15 | job-B rank 4 | logger blocks once (45–60) | (5.8) |
| X16 | job-A rank 6 | API floor in ship (45–55) | (5.3) |
| X17 | job-C rank 4 | dep-gates runner history (45–65) | (5.2) |
| X18 | job-B rank 5 | house-style sectioning rule (40–50) | (5.8) |
| X19 | job-A rank 7 | pr-loop waiting section (35–50) | (5.5) |
| X20 | job-B rank 6 | house-style extension-root (35–45) | (5.8) |
| Greptile session | plan-review-1 #18 | snapshot, drift script, 52-rule map, preflight file checks, ship-file policy, CI/pre-push additions | 4.12 drift + snapshot ownership; 4.1 port keeps `agent-scaffolding`/`dev-material`/`generated-files`; policy text stays in `greptile-rules.md`; CI/pre-push kept and extended (Phase 6) |

For X items, the line ranges and full proposals are in the cited report rank; the report's "Risk" column applies. Report lines actually saved against each estimate.

---

## 11. Local contracts (replace external skills for acceptance purposes)

### 11.1 AGENTS.md / CONCEPTS.md verification (self-authored extensions only; skip on forks)
Four assertions, each a check in `rx preflight` (preset-bound, Phase 3): every repo path the doc names in backticks exists; every `npm run <x>` it names exists in `package.json` scripts; no `/Users/` path appears; every backticked `symbol()` it names exists in `src/`. Plus a judgment entry in the audit: the doc's behavioral claims about the area this branch changed were re-read against the code, with each cited line printed back. A user-level `verify-agents-md` skill may be used as a convenience; acceptance depends only on this contract.

### 11.2 Adversarial review scope (every phase gate)
Review the phase's whole diff (committed and uncommitted) from the phase's starting commit. Give the reviewer: what the diff is for; that the diff is the entry point, not the boundary; the seams to check (command ↔ skill, preset ↔ check, receipt ↔ guard, generator ↔ generated region); the threat model (a CLI and plugin used by one developer and their agents; races only at human speed or self-triggered count); and a demand for findings ranked P1/P2/P3 with file:line and a trigger sentence, the invariants that held, and a per-seam disposition. Report only; the reviewer edits nothing. No open P1/P2 at the gate.

### 11.3 Session-URL rule (both repos)
Commit messages must not contain `claude.ai/code/session_`. In `$RX`, implement it as `scripts/commit-msg` (Node, checked in) with tests for one rejected and one accepted (`Co-Authored-By: Claude` trailer only) message, and install it into the repo's resolved hooks directory. Chris's dotfiles installer may be used in addition; acceptance depends only on the checked-in script and its tests.
