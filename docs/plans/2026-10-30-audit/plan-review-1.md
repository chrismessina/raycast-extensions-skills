The plan is **not implementation-ready**. Its main blockers are the receipt design, loss of judgment gates, activation before release, and dependencies on unspecified policy data.

Below, **plan** means `docs/plans/2026-10-30-raycast-harness.md`; **P** means `plugins/raycast-extensions`. Replacement text is literal proposed plan text.

## P1 findings

**1. The receipt fingerprint does not identify the checked working tree.**  
**Plan:142, 145.** `git write-tree` hashes the index. Editing an already-tracked source file without staging it leaves that hash unchanged; hashing untracked files does not repair this. Excluding ignored files also misses files the publisher copies. The existing payload contract explicitly includes untracked and ignored files: `P/skills/ship/SKILL.md:56–60, 1389–1400`. `write-tree` also writes Git objects, conflicting with the promise to leave Git state alone.

**Replace the fingerprint sentence with:**

> “Compute a SHA-256 fingerprint without modifying Git: hash a sorted, length-delimited manifest of extension-relative paths, entry types, executable modes, symlink targets, and current file bytes for the complete publisher copy set, including ignored and untracked files. Separately fingerprint HEAD, the publish tag/range, preset bytes, forbidden-list bytes, CLI version, and published-baseline identity. Do not use `git write-tree`. Test unstaged tracked edits, deletions, renames, mode changes, ignored files, untracked files, and changed scan inputs.”

**2. `gates` can certify checks it never runs, and `guard` can accept failed results.**  
**Plan:142–145.** The task specifies execution of build, tsc and lint, followed by a receipt containing preflight, stale and scan results. It supplies neither invocation arguments nor a mechanism for acquiring those results. The guard checks existence and tree equality, without requiring successful results. A current receipt containing FAIL could therefore authorize publishing. Existing submission requirements demand that checks actually ran green: `P/skills/ship/SKILL.md:1022–1048`.

**Replace §4.8–4.9’s receipt acceptance contract with:**

> “`rx gates --preset <file> --forbidden <file>` runs stale, scan, preflight, build, tsc and lint itself, in that order, passing the fetched baseline to every dependent check. It invalidates any previous receipt before starting and writes a successful receipt only after all required checks complete without FAIL or ERROR. Guard requires every required result, matching fingerprints and matching configuration; receipt presence alone never authorizes an action. Tests include current-tree receipts containing FAIL, ERROR, missing results and interrupted runs.”

**3. Replacing the HARD GATE loses mandatory judgment evidence.**  
**Plan:208, 262, 286.** The new evidence contract requires only the `gates` receipt. That receipt has no house-style judgment results, Greptile judgment results, runtime shortcut evidence, or runtime/destination verification. Existing requirements explicitly distinguish these from deterministic checks: `P/skills/ship/SKILL.md:1046–1062`; house-style audit results and blocking/report semantics are defined at `P/reference/house-style.md:1915–1919`. The keep list does not specify how these requirements remain enforceable.

**Replace the evidence-contract sentence with:**

> “Replace the duplicate checklist with one evidence contract requiring both a current successful mechanical receipt and a structured agent audit: one result per applicable house-style ID and Greptile judgment rule, with scope, severity and evidence; runtime shortcut validation; and applicable runtime/destination verification. Blocking judgment failures stop submission; report-only failures remain visible without blocking. Preserve these requirements explicitly in ship and its handoff to raycast-pr-loop.”

**4. The hook and rewritten skills become active before their CLI exists.**  
**Plan:43, 199–220, 235–238.** Phase 4 wires the hook; Phase 5 replaces working procedures with `rx`; the package and exact pin arrive only in Phase 9. A branch does not isolate this plugin: the local marketplace loads this checkout in place, including subsequent sessions/reloads (`CLAUDE.md:14–20`). A user can acquire nonfunctional skills or a broken blocking hook during implementation.

**Replace the activation ordering with:**

> “Develop and validate replacement skills and hooks in an isolated plugin copy that the local marketplace does not load. During Phases 1–8, validation invokes the local `$RX/bin/rx.mjs` through an explicit development runner. Keep the installed plugin’s existing procedures and hooks operational. After npm publication and a clean-cache installation smoke test, atomically activate the pinned runner, hook and rewritten skills.”

**5. “Skills write `rx`” supplies no executable pinned runner.**  
**Plan:43, 146, 220.** Recording an `npx` command in a reference file does not create an `rx` executable or force skills/hooks to use that version. It also leaves preset loading implicit, so the plugin can silently execute core-only checks. Existing scripts work through explicit plugin-relative paths (`P/reference/greptile-rules.md:34–40`).

**Replace D5 with:**

> “Ship `$P/scripts/rx.mjs` as the sole plugin runner. Store the exact package version in `$P/rx-version.json`; generate reference/rx.md from it. The runner invokes that exact package’s executable with an argument array and passes the plugin’s absolute preset path to commands that support presets. Skills and hooks invoke the runner by plugin-relative absolute path. CI rejects direct bare `rx` calls and validates the complete command/subcommand/flag combinations against the pinned package.”

**6. Phase 3 requires policy and generators that later phases create.**  
**Plan:139, 195, 206–207.** `api-floor` requires Phase 5’s generated `dep-gates.json`; new preset checks need Phase 5’s preset. `rx preset table` is required in Phase 5 but has no implementation task, command contract or tests anywhere in §4. Existing dependency policy is materially contradictory (`P/reference/dep-gates.md:32–68, 81, 118–129`), so an implementer cannot safely invent a temporary floor.

**Replace the phase dependency text with:**

> “Before implementing Phase 3’s policy-dependent checks, resolve the current dependency policy and create versioned schemas for the preset and dependency data. Implement and test `rx preset table` and the dependency-data generator in Phase 3. Phase 5 consumes those completed generators and data; it does not introduce prerequisites for earlier phases.”

**7. House-specific dependency policy is placed in ecosystem core.**  
**Plan:42, 139, 207, 245.** The prescribed core `dep-gates.json` is generated from Chris’s fleet table. That table contains personal package floors and owner-specific adoption choices (`P/reference/dep-gates.md:78–90, 99–114`). This directly violates D4 and §6.

**Replace §4.7 with:**

> “`rx api-floor --preset <file>` evaluates dependency policies supplied by the preset. Chris’s fleet floors and adoption policy remain in `$P/presets/` and are generated from the canonical current-policy source. Core contains no Chris-specific floor. Define separate policies for supported existing 1.x extensions and new 2.x extensions, and inspect both the manifest requirement and resolved lockfile version.”

**8. Holdout would remove intentionally shipped files and dirty tracked trees.**  
**Plan:153–154, 210, 308.** “Plus any non-extension entry” has no definition and reasonably includes `AGENTS.md`, `CONCEPTS.md`, contributor docs and published LICENSE. Those must survive under current policy, with named TODO exceptions. Moving tracked files also blocks publishing. Evidence: `P/reference/greptile-rules.md:144–152`; `P/skills/ship/SKILL.md:701–710, 819–835, 1404–1406`.

**Replace §4.11 with:**

> “Holdout moves only explicitly classified, untracked local artifacts. It never moves tracked files. Chris’s preset preserves self-authored AGENTS.md/CONCEPTS.md, contributor docs, published LICENSE, and the brew/dev-null TODO exceptions. Other published leaks are handled as deliberate committed deletions, not temporary holdouts. Persist an inventory containing source, destination, entry type and content fingerprint; restore without overwriting changed destinations and verify exact restoration.”

**9. All fixed logger blocks are incorrectly narrowed to self-authored extensions.**  
**Plan:113, 276, 296.** The plan scopes “fixed logger preference blocks” to self-authored only. The existing `logger-verbose-copy` rule applies whenever an extension declares `verboseLogging`; only `logger-strict-redaction` has the self-authored/logger-version scope. Evidence: `P/reference/house-style.md:875–877, 1950–1952`. This purported T5 fix drops an existing rule on forks.

**Replace that clause with:**

> “Implement logger checks separately: `logger` applies to self-authored extensions making web requests; `logger-verbose-copy` applies wherever verboseLogging is declared; `logger-strict-redaction` applies only to self-authored extensions with installed logger ≥1.5.0 and remains report-only. Preserve each rule’s independent applicability and severity.”

**10. Phase 9’s version bump necessarily fails existing checks.**  
**Plan:238.** It bumps only `P/.claude-plugin/plugin.json`. Both manifests must match, and README status must match when present (`CLAUDE.md:22–27`; `check-references.sh:89–109`). Both manifests currently say `0.11.0` (`P/.claude-plugin/plugin.json:3`; `.claude-plugin/marketplace.json:9`).

**Replace Phase 9.3 with:**

> “Pin the published CLI version; bump the plugin version in both plugin.json and marketplace.json and update the README Status version in the same change. Run the complete checks, installation smoke test and final branch review before the merge approval.”

## P2 findings

**11. The audit is not a self-contained implementation specification.**  
**Plan:177, 207, 214, 268, 304, 307.** “Replacement text in job C,” “Fix Q23–Q28” and “X1–X20 … per the file each names” refer to unavailable detail rather than actionable tasks. The relevant files contain multiple distinct claims—for example measurement guidance and lock guarantees at `P/learnings/workflow-issues/answer-a-blocking-review-with-a-measurement.md:34–81`. Merely merging that file does not remove the problematic guarantee. The named raw reports were not found in the searched repo/Claude locations.

**Replace those shorthand instructions with:**

> “Before Phase 0 approval, check in a scrubbed audit appendix containing each T/P/Q/X finding separately: affected file and exact passage, required resulting behavior/text, evidence to preserve, and acceptance test or review criterion. Expand Q23–Q28 and X1–X20 individually. No task depends on an external artifact, inaccessible scratchpad or unstated replacement text.”

**12. P1-6’s proposed merge does not specify correction of its false guarantee.**  
**Plan:214, 283.** The target learning says the residual requires a crashed holder, two reclaimers and a multi-second stall, with “one lost update” as the worst case (`P/learnings/workflow-issues/answer-a-blocking-review-with-a-measurement.md:75–81`). Moving that text to another learning can preserve the very guarantee the audit rejects.

**Replace the P1-6 task with:**

> “Remove the current lock-safety guarantee from operative guidance. Preserve it only as an explicitly retracted historical claim, beside the counterexample and corrected trigger/consequence from the audit appendix. Merging or relocating the paragraph does not count as resolving P1-6.”

**13. The global verdict protocol conflicts with command-specific outputs.**  
**Plan:52–60 versus 117, 122, 134, 139, 146.** Commands introduce `PUB_DIR=`, SAME-PIXELS, OURS-SAFE and silent allows without defining their protocol representation. `api-floor` explicitly makes network failure N/A, contradicting §1’s ERROR rule. Existing preflight only reports findings and uses `where`, while the new format uses `details` (`P/scripts/preflight.mjs:334, 665–675`).

**Replace the protocol exceptions with:**

> “All command domain outcomes are structured result details, not additional verdicts. JSON includes a command-specific `data` object, including stale’s publishedDir and baseline identity. Define the verdict/exit mapping for every domain outcome. Explicit exceptions: guard uses the host hook’s allow/block transport, with silent allows; api-floor’s optional registry advisory may report N/A on lookup failure while its local floor check still runs.”

**14. “Port unchanged” conflicts with the already-required protocol changes.**  
**Plan:108, 191–192.** The old preflight silently accepts unknown arguments, emits no per-check PASS/N/A and warns on unreadable published manifests (`P/scripts/preflight.mjs:435–439, 656–675`). §1 requires different behavior before Phase 2. An empty raw-output/verdict diff is therefore impossible if the new contract is followed.

**Replace Phase 2 acceptance with:**

> “Compare legacy findings after explicit normalization: IDs, failure/warning severity, messages and locations for checks with equivalent inputs. Maintain a reviewed exception list for protocol changes required by §1, including argument errors and unreadable-input errors. Added PASS/N/A records and JSON envelope changes are expected; lost legacy findings are failures.”

**15. The PNG specification omits an acceptance-critical metadata implementation.**  
**Plan:41, 121–123, 262.** Pixel decoding alone does not specify preservation/comparison of all four required color chunks. Existing behavior names `gAMA`, `iCCP`, `sRGB`, `cHRM` and rejects >8-bit comparison (`P/skills/ship/SKILL.md:364–380`). The proposed tests cover neither color metadata nor malformed files.

**Replace the PNG behavior/tests with:**

> “Use pngjs for RGBA decoding and a bounds-checked PNG chunk reader for IHDR bit depth and gAMA/iCCP/sRGB/cHRM metadata. Equal RGBA is SAME-PIXELS only when required metadata matches; >8-bit or differing color metadata is UNDECIDED. Decode/chunk failures are ERROR. Test each metadata chunk independently, missing versus present metadata, corrupt input, changed transparency and RGB/RGBA equivalence.”

**16. Runtime shortcut extraction writes into installed package data.**  
**Plan:165.** Writing `src/rules/common-shortcuts.json` assumes a writable source checkout. An npm installation/cache is the wrong mutable state location; Linux CI also lacks Raycast.app. A bundled snapshot cannot “never again disagree” after an app update. The existing rule requires refresh when the app changes and ties evidence to the app version (`P/reference/keyboard-conventions.md:60–63`).

**Replace that task with:**

> “`rx shortcuts --runtime` emits the full table plus app version and shim fingerprint. Cache it outside the installed package, keyed by that fingerprint. ESLint accepts an explicit table path; runtime-dependent checks report unavailable evidence when no matching table exists. CI uses recorded shim fixtures and never requires Raycast.app. Do not claim a bundled table guarantees agreement with every installed runtime.”

**17. The existing commit-hook installer cannot install into the new local-only repo.**  
**Plan:31, 184–187.** The installer skips repositories with no origin and verifies public accessibility over the network before installation (`~/Developer/dotfiles/git-hooks/install-no-session-url.sh:10–17`). Phase 1 intentionally has neither a public repo nor a remote. The hook also blocks only `claude.ai/code/session_` URLs, not all attribution or session URLs (`…/git-hooks/commit-msg:2–12`).

**Replace Phase 1.3’s hook instruction with:**

> “Install the existing commit-msg hook directly into `$RX`’s resolved hooks directory, preserving any existing hook and core.hooksPath configuration. Do not run the public-repository discovery installer. Verify its accepted/rejected messages locally. Describe its enforcement accurately: it rejects Claude Code session URLs matching its pattern; broader public-attribution policy remains a separate review requirement.”

**18. Greptile snapshot migration breaks paths and the coordinated update policy unless explicitly redesigned.**  
**Plan:159, 308.** Keeping `greptile-rules.md` unchanged leaves links to `reference/greptile/` and commands targeting the removed scripts. Existing updates require snapshot, mapping and affected checks in one commit (`P/reference/greptile-rules.md:6, 15–28`; `CLAUDE.md:49–56`). After moving mechanics/snapshots to another repo, that invariant becomes impossible. `drift --update` also needs a defined writable destination; currently it writes beside the script (`P/scripts/greptile-drift.mjs:16, 114–120`).

**Replace the migration task with:**

> “Define cross-repo snapshot ownership explicitly. Core owns a versioned snapshot; drift --update requires an explicit maintainer checkout destination and never mutates an installed npm package. Rewrite every plugin snapshot/script link and maintenance command. Record the core snapshot identity in the plugin mapping; release the updated core snapshot/checks and update the plugin pin/mapping as a coordinated change. Retain or replace the old commands atomically.”

**19. Preset schema cannot yet generate the prescribed table or resolve ID mismatches.**  
**Plan:100, 112, 206.** Fields `id, tag, applies, severity, owner` omit the existing Rule column. Several check IDs differ from house-style IDs: `hand-typed-preferences` versus `no-hand-preferences`, `changelog-order` versus `merge-date-placeholder` (`P/scripts/preflight.mjs:410, 584`; `P/reference/house-style.md:1928, 1967`). Other check IDs, such as `prettierrc`, overlap only part of a broader house rule (`P/reference/house-style.md:71–75`; `P/scripts/preflight.mjs:557–575`). “When the preset names the rule” is insufficient.

**Replace the schema instruction with:**

> “Specify a versioned preset schema including rule title, policy anchor, tag, structured applicability, block/report severity, and one or more explicit implementation bindings. Bindings distinguish house-style IDs from check IDs and describe partial coverage. Generate matrix rows only for non-build rules, preserving the Rule column. Reject unknown fields, unresolved owners, duplicate IDs and bindings that would downgrade unrelated core failures.”

**20. Several command inputs and safety decisions remain free variables.**  
**Plan:74, 113–117, 129–134, 149–160.** Examples: choosing among multiple nested extensions; accepted screenshot formats; locating `--published` for contributions; author identity for PR verification; persistence/identity of the reviewed round for `can-reply`; what proves a receipt-backed decline. Current root/audit scope is extension-specific (`P/reference/house-style.md:168`), and replies currently require scanning the actual outgoing text (`P/skills/raycast-pr-loop/SKILL.md:311`).

**Add this contract requirement before §4:**

> “Before implementation, give every command a complete argument schema, root-resolution algorithm, output schema and state-location contract. Multiple root candidates require --root or ERROR. State exact screenshot formats/counting rules. Contributions requires an explicit baseline. PR verification requires an expected author and extension identity. can-reply identifies the exact reviewed round and expected head; decline receipts identify findings, evidence and scanned reply-text hash. Missing required evidence is ERROR.”

**21. Network prohibition contradicts planned commands and checks.**  
**Plan:142, 171, 247.** `doctor` checks gh authentication, and `gates` invokes npm/npx and arbitrary package scripts; these can perform network work. The whitelist omits both commands. Existing preflight is genuinely local (`P/scripts/preflight.mjs:12–16`); delegating to another tool does not preserve that guarantee.

**Replace §6’s network rule with:**

> “Document network behavior per command, including child processes. Doctor’s authentication probe is an explicit network operation. Gates’ own validation uses local installed tools and does not implicitly install missing packages; build/lint scripts may perform their documented project-defined work. Missing local tooling is ERROR. The plugin runner’s package acquisition is a separately documented network boundary.”

**22. Generated tables and future CI arrive without reproducible generation commands or budgets.**  
**Plan:102, 214, 219–221.** Learning routing tables have no named generator, markers, sorting rules or `--check` mode. Budgets are specified for only four skills, despite “per SKILL.md.” There is no checked-in fixture directory: tests create temporary fixtures in code (`P/scripts/preflight.test.mjs:53–70`). “Fixture run over `test/fixtures` in the plugin” therefore names an uncreated input.

**Replace Phase 6’s specification with:**

> “Before rewriting each affected file, add its generator and --check mode with generated-region markers and deterministic ordering. Check in an explicit budget manifest covering every SKILL.md. Create the plugin fixture directory with named expected outcomes, including intentionally failing fixtures. CI compares actual outcomes with expectations rather than requiring every fixture to pass. Pre-push runs the same checks against its exported commit without depending on sibling checkouts.”

**23. Phase 5 forbids the executable fix it simultaneously requires.**  
**Plan:216 versus 248.** The task says sync-template “executable lines untouched” while requiring Q21’s branch-reuse fix. The actual reuse path merely observes a remote branch and creates a PR against it (`P/templates/sync-from-upstream.yml:716–721`); changing that behavior requires executable edits.

**Replace the parenthetical with:**

> “Move explanatory history to evidence. Executable edits are permitted only for Q21: verify an existing remote branch contains the intended sync result before reusing it; fail closed on lookup errors or mismatched content. Preserve all other executable behavior.”

**24. Judge’s acceptance gate has no passing threshold or agent-mode semantics.**  
**Plan:224–231.** “Once its eval passes” does not define accuracy, per-case requirements, confidence calibration or agent-mode evaluation. A probability below 0.7 is an output threshold, not an eval passing criterion. Existing evaluation guidance explicitly warns against claiming more than fixtures prove (`P/learnings/workflow-issues/mocked-ai-evals-prove-only-their-assertions.md:1`).

**Replace the eval contract with:**

> “For v0.1, skill adoption requires every approved deterministic fixture expectation to pass; report per-case outputs and aggregate accuracy, with no claim of calibrated probabilities. Agent mode prints the decision schema and inputs and is tested for structural completeness, not answer accuracy. Provider/API/model availability failures are ERROR; unsupported Jev integration is omitted explicitly. Judge remains optional and never replaces required human decisions.”

## P3 findings

**25. Two current-state counts are wrong.**  
**Plan:111, 208.** Preflight contains **27**, not 24, distinct emitted IDs: 23 literal IDs plus four heuristic IDs (`P/scripts/preflight.mjs:337–636, 639–651`). Ship is **1,698**, not 1,644, lines; its last task is at `P/skills/ship/SKILL.md:1698`.

**Exact replacements:**

> “27 check IDs as of this checkout, including agent-scaffolding, dev-material and generated-files.”

> “ship/SKILL.md (target ≤450 lines from 1,698 at the reviewed baseline).”

## Claims verified TRUE

These are current-file verifications, not endorsements of the proposed implementation:

| Plan claim | Repository evidence |
|---|---|
| The plugin lives under `plugins/raycast-extensions`, and the repository license is MIT. | `CLAUDE.md:7–10`; `LICENSE:1–8` |
| `$RX` does not yet exist. | Read-only filesystem existence check returned false. |
| The listed pending Greptile, skill, CI, pre-push, README-template and Instagram-learning work exists. | `git status --short`; corresponding files are present. Attribution to particular sessions is not independently established. |
| House style has 51 rule IDs, 42 matrix rows and nine build-only rules. | `P/reference/house-style.md:49–1968`; matrix at `1913–1968`; independently counted. |
| The Greptile snapshot has 52 rules and the four named snapshot files. | `P/reference/greptile/config.json:6–386`; `P/reference/greptile/SOURCE.json:1–7`; `P/reference/greptile-rules.md:3–6` |
| Snapshot provenance records open-PR source #32933, SHA `226c2aa…`, fetched October 30. | `P/reference/greptile/SOURCE.json:2–6`. This verifies recorded provenance, not current remote state. |
| Preflight includes agent-scaffolding, dev-material, generated-files and readme-assets. | `P/scripts/preflight.mjs:513–530, 618–636` |
| Unknown CLI arguments are currently ignored. | `P/scripts/preflight.mjs:656–662` |
| Zero CHANGELOG placeholders currently escape the placeholder-count checks. | `P/scripts/preflight.mjs:400–404` |
| README extraction has the cited syntactic limitations and scans code examples indiscriminately. | `P/scripts/preflight.mjs:516–528` |
| Drift detects rule additions/removals/field changes, settings, context-file changes and rules.md changes. | `P/scripts/greptile-drift.mjs:33–67` |
| Drift discovers main first, then the configured open PR; unavailable comparison prints SKIP and exits 2. | `P/scripts/greptile-drift.mjs:81–109` |
| Existing PNG triage uses Pillow and protects 16-bit/color-metadata cases. | `P/skills/ship/SKILL.md:364–380` |
| The weaker sparse-baseline recipe occupies the cited lines 67–78. | `P/reference/sparse-checkout-discipline.md:67–78` |
| PR-body editing already has initial/splice, whole-line anchors, re-read, single-write and history-check safeguards. | `P/skills/ship/scripts/pr-body.py:8–27, 79–86` |
| Current CI runs reference checks and the wildcard script test suite. | `.github/workflows/check-references.yml:21–25` |
| Pre-push checks exported pushed commits rather than the working tree. | `githooks/pre-push:4–6, 14–28` |
| Pre-push still recommends bypassing checks; root CLAUDE already prohibits it. | `githooks/pre-push:9, 21`; `CLAUDE.md:35–37` |
| The cache-schema example writes output even when invoked with `--check`. | `P/reference/house-style.md:411–429` |
| Copy Error examples expose raw error strings. | `P/reference/house-style.md:636–657` |
| The sync template claims never to push to main while containing a default-branch push. | `P/templates/sync-from-upstream.yml:15, 627–657` |

## Coverage

- **T1–T4:** Named destinations are sensible, but T1/T2 still need the explicit baseline/input contract; T3/T4 need the specified parser fixtures.
- **T5:** Incorrectly resolved; see finding 9. **T6:** A destination is named, but the exact receipt-preservation requirement is not.
- **P1-1:** Policy consolidation is correctly targeted, but blocked by ordering/core ownership issues. **P1-2:** Argument rejection is correctly targeted. **P1-3:** Reply authorization lacks its evidence contract. **P1-4/P1-7:** Defects and destinations are verified. **P1-5:** Preservation is named. **P1-6:** A merge alone does not resolve the false guarantee.
- **Q1–Q14:** Destinations generally exist; Q2 remains unresolved by the proposed receipt, Q8 contradicts the global error protocol, and Q12 requires separate logger scopes.
- **Q15–Q17/Q22:** Optional Phase 8 is acceptable only if the Phase 5 fallback explicitly carries each fix’s acceptance criteria.
- **Q18–Q21/Q29–Q30:** Relevant current passages exist; Q21 has a direct edit prohibition conflict.
- **Q23–Q28 and X1–X20:** Not independently auditable as individual resolutions from the supplied summaries. The plan must embed their exact requirements.
- **Greptile session:** The 52-rule snapshot, source transition detection, comparison logic, file checks and tests are present. Preservation is incomplete until update ownership, links, installed-package mutability, file-policy exceptions and judgment gates are specified.
- **Order:** Porting before fixes is reasonable with normalized equivalence criteria. Policy schemas/generators must precede dependent commands; validation must accompany rewrites; activation must follow a usable CLI release.

No files were edited, no network was used, and no test suites were run because their fixtures write temporary files.

Environment: `git status` returned its listing despite macOS/Xcode temporary-cache warnings.


