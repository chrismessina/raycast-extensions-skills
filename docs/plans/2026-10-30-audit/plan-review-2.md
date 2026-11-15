Revision 2 is **not yet implementation-ready**. Most round-1 fixes are present, but release isolation, reply authorization, policy bindings, and several command outcomes still need concrete contracts.

All plan line references below refer to [revision 2](../2026-10-30-raycast-harness.md). Replacement blocks are literal proposed text.

## Ranked findings

**F1 — P1: Phase 9 edits the live checkout and attempts activation over the original dirty tree.**  
**Plan:267–268; conflicts with 16, 48, 277.**

The marketplace manifest path is `$SKILLS/.claude-plugin/marketplace.json`, although that edit must happen in `$WT`. More substantially, Phase 0 deliberately preserves the main checkout’s uncommitted files. They are still there when Phase 9 instructs a squash merge into `main`. The rewrite changes many of those same files, so Git can refuse the merge because it would overwrite local changes. A clean feature worktree does not solve activation in the dirty live checkout.

Evidence: current branch is `main`; current status includes modified skills, references, scripts, CI, and hooks. `CLAUDE.md:14–20` confirms that checkout is live.

**Replacement for Phase 9.3–4:**

> “In `$WT`, pin `0.1.0`; update `$WT/plugins/raycast-extensions/.claude-plugin/plugin.json`, `$WT/.claude-plugin/marketplace.json`, and `$WT/README.md`. Run the installation smoke tests, full CI, and final review there. Before activation, compare the live checkout with the Phase 0 checkpoint and inventory any subsequent changes. Chris must approve a concrete reconciliation of that dirty checkout; do not assume a squash merge can overwrite it. Perform the reviewed squash integration in a clean release worktree, then activate the resulting commit in the live checkout only after its preserved changes have been reconciled. Verify the live plugin, then remove the implementation worktree.”

---

**F2 — P1: `can-reply` cannot perform its required scan and does not establish reply evidence.**  
**Plan:159–161, 310.**

`scan` requires `--forbidden`, but `can-reply` supplies neither that argument nor an identified stored forbidden list. A nonempty `Receipt:` line also establishes no relationship between the evidence and the finding. The command does not require finding membership in the stored round or an expected current head. For fix claims, *any* different head qualifies, including an unrelated update.

Existing obligations are stronger: `skills/raycast-pr-loop/SKILL.md:297–316` requires verified publication, the remote fix SHA, actual outgoing-text scanning, and substantive decline evidence.

**Replace line 161 with:**

> “`can-reply <N> --round <updated_at> --finding <id> --expected-head <sha> --forbidden <file> --reply <file> --evidence <file> [--claims-fix]`: require the finding to belong to the stored round and the fetched PR head to equal `--expected-head`. Evidence identifies the finding, disposition, supporting artifact or policy, and explanation. Fix claims additionally require a successful publication record identifying this PR and current remote SHA, different from the reviewed SHA. Declines permit an unchanged head. Scan the exact reply bytes using the supplied forbidden list. Record repository, PR, round, finding, expected head, evidence hash, forbidden-list hash and reply hash. Missing or mismatched evidence is ERROR; failed authorization is FAIL. Authorization applies only to those exact reply bytes and that head.”

---

**F3 — P2: `gates` has no valid unpublished-extension path.**  
**Plan:119, 140–142.**

`stale` returns `N/A (not published)` for a new extension. `gates` nevertheless unconditionally passes its published directory to preflight and fingerprints its baseline SHA. Neither value exists. The implementer must choose between an invalid argument, inventing a directory, or silently skipping unspecified checks.

**Replacement:**

> “For an unpublished extension, stale returns `data.publishedDir: null`, `data.baseline: null`, and `data.published: false`. Gates omits `--published` when invoking preflight; published-comparison checks emit N/A with that reason, while local checks still run. Fingerprint an explicit unpublished-baseline marker. A later transition to published invalidates the receipt.”

---

**F4 — P2: Missing runtime shortcut evidence can satisfy the mandatory audit.**  
**Plan:146, 166, 234; conflicts with 287.**

`shortcuts --check` records missing runtime evidence as `N/A`. The guard accepts an audit with no blocking failure, so an applicable keyboard audit can pass without the runtime verification the plan promises to preserve.

Evidence: `skills/ship/SKILL.md:668–671` requires runtime re-derivation after shortcut autofixes; house style’s `keyboard` rule is blocking (`reference/house-style.md:1958`).

**Replacement:**

> “No matching runtime table produces an unavailable-evidence result. If runtime shortcut verification is applicable, unavailable evidence prevents audit completion and guard authorization; it is not an accepted applicability N/A. N/A is accepted only with an explicit reason that the verification does not apply. Recorded-fixture CI may test this behavior without a local Raycast installation.”

---

**F5 — P2: Byte-identical CHANGELOG history forbids required privacy corrections.**  
**Plan:130, 234, 287.**

The new changelog contract requires dated history to remain byte-identical. Current policy explicitly allows—and requires—redacting forbidden examples from dated entries while preserving their dates (`skills/ship/SKILL.md:40–54`). The rewrite’s keep list does not state this exception.

**Replacement for the history requirement:**

> “Dated history must match the published history except for explicitly recorded privacy redactions required by gate −2. Each exception identifies the entry, original and replacement text hashes, and forbidden-list match; dates and unrelated text remain unchanged. Test an authorized historical redaction passing and an unrelated historical edit failing.”

---

**F6 — P2: The core/preset split still conflicts with faithful preflight porting.**  
**Plan:44, 112–115, 175–180, 215–220.**

Legacy preflight contains Chris-specific values and unconditional checks: `.prettierrc` requires `printWidth: 120` and `singleQuote: false` (`scripts/preflight.mjs:557–575`). House style scopes that rule to self-authored extensions (`reference/house-style.md:1927`). Merely adding a severity binding does not move those values into the preset or enforce applicability.

**Replacement:**

> “Classify every legacy check as ecosystem core or preset policy before porting it. Move all Chris-specific values, applicability and severity into the preset, including the complete canonical `.prettierrc` configuration. A core invocation without a preset does not enforce those policies. Evaluate applicability before invoking a preset binding. Port-equivalence comparisons use an explicit compatibility preset; test core without a preset and both self-authored and fork applicability.”

---

**F7 — P2: The preset schema and binding validator cannot represent or validate their promised inputs.**  
**Plan:146, 176–180, 219–220.**

Three concrete gaps remain:

- `requires` has no defined condition grammar.
- `preset check` requires *every* binding to exist in `rx commands --json`, including ESLint and judgment bindings, but that registry is specified as commands, flags and schemas.
- Dependency policies have no defined selection for existing 2.x extensions, no new-2.x floor, and no manifest-range comparison semantics.

**Replacement:**

> “Before Phase 3 implementation, check in the complete preset JSON Schema and a valid populated preset. Define a closed applicability grammar, its context fields and how each context value is supplied. The implementation registry lists rx check IDs, ESLint rule IDs and judgment IDs separately; validate each binding against its own registry. Dependency policy explicitly covers existing 1.x, existing 2.x and new 2.x extensions, with named selection criteria and concrete requirements. Define whether each manifest range must exclude below-floor versions, and independently compare the lockfile-resolved version. No policy selection or floor is inferred from an unstated convention.”

This is a required specification artifact, not a request to let the implementer choose the missing policy.

---

**F8 — P2: Phase 6 requires an unpublished package, preventing its own phase gate.**  
**Plan:186, 232, 249–253, 266–267.**

Development validation uses `RX_DEV`, but Phase 6 specifically requires the exported-commit pre-push checks to use the pinned npm package without a sibling checkout. Publication happens in Phase 9. The phase cannot demonstrate its stated acceptance against that package beforehand.

**Replacement:**

> “During implementation, package the candidate CLI with `npm pack` and install that tarball into an isolated validation directory. Exercise CI and exported-commit pre-push checks using that installed executable, with no sibling source-checkout dependency. Keep this test override outside shipping configuration. After npm publication, repeat the same checks against the exact published pin with all development overrides unset.”

---

**F9 — P2: PNG and freshness outcomes still lack complete authorization semantics.**  
**Plan:119, 122–124, 142, 146.**

`png` requires `--published` while promising `LOCAL-ONLY` for unpublished files; `LOCAL-ONLY` has no verdict mapping. More importantly, `OLDER-SHOT` becomes WARN even though historical membership does not establish ownership or permission to overwrite. `stale` similarly emits WARN for unresolved CHECK/NEW? outcomes, while gates accepts WARN.

Current PNG instructions require resolving `OLDER-SHOT` and stopping for contributor/restored images (`skills/ship/SKILL.md:406–411`).

**Replacement:**

> “Make `--published` optional for png. Missing published files produce `LOCAL-ONLY` as N/A with ‘keep local’. `OLDER-SHOT`, stale CHECK and stale NEW? require an explicit audit disposition tied to the path, local content hash and baseline identity before guard authorization. Historical membership alone never authorizes retaining local content. Unresolved dispositions block publication. Document png as read-only: SAME-PIXELS recommends adoption; it does not modify files.”

---

**F10 — P2: Phase 0’s shell sequence does not fail closed, and its failure claim is false.**  
**Plan:195–205.**

The temporary-index mechanism itself is sound under ordinary Git operation:

- `GIT_INDEX_FILE` selects the alternate index.
- `read-tree HEAD` seeds it.
- `add -A` updates that index from working files, respects ignore rules for newly discovered files, and continues tracking paths already in the seeded index.
- Those commands leave the real index and working files unchanged.
- A separate `worktree add` on the new, otherwise unused branch can succeed while the main worktree is dirty.

However, the listed sequence checks no exit statuses. An indexing failure can be followed by `write-tree` and a partial checkpoint. A signing failure occurs **after** object writes and temporary-index creation, contradicting “nothing else has changed.” Also, this captures working-file content, not staged-only versions or newly force-added ignored files absent from HEAD.

**Replacement for the execution/failure contract:**

> “Run the checkpoint sequence in a subshell with explicit success checks after every operation and an EXIT trap removing the temporary index. Abort before branch creation if read-tree, add, write-tree or signing fails. Verify that the source HEAD and real-index bytes are unchanged. The checkpoint captures current working-file content for HEAD-tracked paths plus untracked nonignored paths; it does not preserve separate staged versions or ignored additions absent from HEAD. Inventory those cases before approval. On failure, report which operation failed and which objects, temporary files or refs were created; do not claim no state changed.”

No mutation probe was run to verify this; the Git conclusions are based on the installed Git manuals and the command sequence.

---

**F11 — P2: The release smoke test instructs execution of destructive and interactive commands.**  
**Plan:267.**

“Run every runner command once” includes holdout moves, changelog merge writes, PR-body application paths, snapshot updates and `greptile wait`. Several require fixtures, merge state, authenticated resources or explicit destinations. This is not an executable installation test specification.

**Replacement:**

> “Use a checked-in installation-smoke manifest listing exact arguments and expected exits. Exercise command discovery and help through the published runner, and run operational cases only against disposable fixture repositories and mocked transports. Never use live PRs or extension directories for mutation smoke tests. List separately any approved live read-only probes. Test that RX_DEV is unset and package acquisition uses a fresh temporary npm cache.”

---

**F12 — P2: The self-contained claim still has explicit external dependencies.**  
**Plan:5, 186, 211, 355.**

The reports are now checked in, which resolves most of the original accessibility problem. Nevertheless:

- X11 still depends on the external `verify-agents-md` skill.
- Phase gates depend on the user-level `codex-gate` threat model.
- Phase 1 copies a hook from `~/Developer/dotfiles`, outside the two named repositories.

Job A itself identifies the external-skill availability problem (`job-A.md:236`).

**Replacement:**

> “Check in local contracts for the AGENTS/CONCEPTS verification and adversarial-review scope used by this plan. X11 links to that local contract and requires its evidence even when the external skill is unavailable. Include the session-URL hook source and local acceptance cases in the repo, or implement its stated rejection contract locally. External skills may provide convenience entry points; no required acceptance criterion depends on their availability.”

---

**F13 — P2: Agent-mode judge adoption has no satisfiable acceptance rule.**  
**Plan:46, 258–260.**

Agent mode prints a question rather than producing an answer. Adoption nevertheless requires every expected answer on “the provider in use.” Structural completeness cannot satisfy answer accuracy. The advisory contract also needs to say that provider ERROR does not turn optional judgment assistance into a submission blocker.

**Replacement:**

> “Provider-backed suggestions may be referenced after that provider passes every approved answer fixture. Agent mode is always available after its structural tests pass; it prints the question, answer schema and inputs for the agent to decide and record. It does not produce probabilities or claim fixture accuracy. Provider errors are reported and fall back to agent mode; they do not independently block submission. Required audit decisions remain mandatory.”

## Round-1 disposition table

“Resolved” means resolved in the revised **plan**, not implemented. For partial items, the cited F-number supplies the exact replacement text above.

| # | Round-1 finding | Disposition | Revision-2 evidence and remaining work |
|---:|---|---|---|
| 1 | Working-tree fingerprint | **RESOLVED** | 141–142: complete publisher-copy manifest, ignored/untracked files, separate inputs, mutation cases; no `write-tree`. |
| 2 | Gates certify checks not run | **PARTIAL** | 140–148 specify execution, invalidation and required successful results. Unpublished baseline handling remains undefined: **F3**. |
| 3 | Mandatory judgment evidence lost | **PARTIAL** | 146, 234 restore structured audit and named evidence. Applicable runtime evidence can still disappear into N/A: **F4**. |
| 4 | Activation before CLI availability | **PARTIAL** | 16, 45, 48, 226, 232 isolate development. Release edits and dirty-main integration violate that isolation: **F1**. |
| 5 | No executable pinned runner | **RESOLVED** | 45, 90, 232, 250: runner, exact pin, preset injection, generated reference and invocation validation. |
| 6 | Policy/generator ordering | **PARTIAL** | 218–221 move policy and generators earlier. Required policy/schema decisions remain unfilled: **F7**. |
| 7 | Personal dependency policy in core | **PARTIAL** | 44, 136–137 move floors into presets. Existing/new policy selection remains incomplete: **F7**. |
| 8 | Holdout moves shipped/tracked files | **RESOLVED** | 155–156: untracked only, explicit preserved files, inventory, fingerprints and nonoverwriting restoration. |
| 9 | Logger scopes narrowed incorrectly | **RESOLVED** | 115, 235, 306 separate all three logger scopes and report-only redaction behavior. |
| 10 | Incomplete plugin version bump | **PARTIAL** | 267 names both manifests and README, but targets the live marketplace manifest: **F1**. |
| 11 | Audit not self-contained | **PARTIAL** | 298–367 and checked-in jobs expand the IDs and proposals. X11/external contracts remain unresolved: **F12**. |
| 12 | False lock guarantee merely relocated | **RESOLVED** | 240, 313 require removing operative guarantees and preserving only explicitly retracted history beside the counterexample. |
| 13 | Global/domain protocol conflicts | **PARTIAL** | 55–60 establish envelope, exits and exceptions; 119/123 map most outcomes. LOCAL-ONLY and unresolved authorization remain incomplete: **F9**. |
| 14 | Unchanged port conflicts with protocol | **RESOLVED** | 215–216 define normalized comparison and reviewed protocol exceptions instead of identical raw output. |
| 15 | PNG metadata implementation omitted | **RESOLVED** | 123–124 explicitly require four color chunks, bounds checking, bit-depth limits and independent fixtures. |
| 16 | Runtime table writes into installation | **RESOLVED** | 164–166 move mutable tables to cache, identify runtime fingerprints, accept explicit ESLint tables and use recorded CI fixtures. Acceptance weakness is separately **F4**. |
| 17 | Public-repo hook installer cannot bootstrap RX | **RESOLVED** | 211 directly installs/tests the hook and accurately limits its enforcement. Source availability is separately **F12**. |
| 18 | Snapshot ownership/update migration | **RESOLVED** | 162, 242 define core ownership, explicit writable destination, snapshot identity, coordinated release and link replacement. |
| 19 | Preset cannot generate/validate promised matrix | **PARTIAL** | 175–180 add titles, anchors, bindings, coverage and matrix markers. Binding registries/applicability remain undefined: **F7**; core scope remains **F6**. |
| 20 | Command inputs/safety decisions unspecified | **PARTIAL** | 62–64, 115, 133, 151–161 resolve several inputs. Reply evidence, new-extension baselines and policy selection remain: **F2, F3, F7**. |
| 21 | Network prohibition contradicts commands | **RESOLVED** | 60–62, 118, 140, 172, 276 require per-command boundaries, recognize child scripts and explicitly identify doctor’s network probe. |
| 22 | Generators/budgets/fixtures unreproducible | **PARTIAL** | 180, 230, 240, 243, 247–253 define generators, markers, budgets and expected failing fixtures. Prepublication package validation still cannot run as specified: **F8**. |
| 23 | Sync-template executable-edit prohibition | **RESOLVED** | 242, 335, 346 permit Q21 executable changes and require verification before branch reuse. |
| 24 | Judge evaluation/adoption undefined | **PARTIAL** | 259 defines all-fixture provider acceptance and structural agent tests. Their adoption semantics conflict: **F13**. |
| 25 | Incorrect baseline counts | **RESOLVED** | 112 says 27 check IDs; 234 says 1,698 ship lines. Both agree with current source. |

**Totals: 12 RESOLVED, 13 PARTIAL, 0 NOT RESOLVED.**

## Coverage

**§10 is substantially improved, but the answer to question 3 is still no.** All four job reports now exist under `docs/plans/`; their detailed proposals make most abbreviated rows implementable using this repo. The remaining explicit external dependency is X11’s `verify-agents-md` procedure. Several rows also inherit incomplete local contracts—particularly P1-3, Q2/Q8 and X7—covered above.

Repository-state claims verified: the checkout is dirty on `main`; the named pending files are present; ship has 1,698 lines; preflight has 27 emitted check IDs. Session authorship of those changes was not independently established. The blanket two-repository dependency claim at line 5 is false.

I read revision 2, all 25 prior findings, all four job reports, root guidance, and relevant preflight, PR-body, shipping, PR-loop, dependency, house-style, keyboard and Greptile passages. This was a plan/contract review, not a comprehensive implementation audit.

No files edited, network used, tests run, or prohibited Git operations performed.

Environment: read-only Git status/branch queries succeeded despite macOS/Xcode cache warnings.


