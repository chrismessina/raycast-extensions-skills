The main simplification opportunity is to **keep policy in house style, procedures in skills, and mechanical checks in code**. Several duplicated explanations have already drifted into contradictory instructions.

I changed nothing. No network or npm commands ran.

Paths below are relative to `plugins/raycast-extensions/`: **H** = `reference/house-style.md`; **D** = `skills/develop/SKILL.md`; **S** = `skills/scaffold/SKILL.md`; **K** = `reference/keyboard-conventions.md`; **R** = `reference/readme-template.md`; **Ship** = `skills/ship/SKILL.md`.

## 1. Correctness findings

| Severity | Location | What goes wrong | Fix |
|---|---|---|---|
| **P1** | **H:410–429, 436–454** | The prescribed cache-schema script **always writes** its output. It never examines `--check`, despite `prelint` invoking that flag and the prose promising stale fingerprints fail. It also hashes only `src/types/index.ts`, despite requiring transitive imports. Copying this implementation produces a gate that silently repairs stale output and misses imported type changes. | Supply an implementation that checks without writing, exits nonzero on mismatch, and hashes the required dependency closure. Otherwise remove the implementation and its unsupported gate claims. |
| **P1** | **D:281–285** versus **K:197–215** | Develop says the “one genuine `--fix` hazard” is cross-platform ambiguity, and otherwise describes rewriting as canonicalizing an existing collision. Keyboard documents **three hazards**, including a macOS-only literal matching a Windows binding and five divergent linter/runtime constants. Following develop can accept an autofix that changes a shortcut and introduces a collision. | Replace D:281–285 with a pointer to K’s three hazards and transformation contract. |
| **P2** | **D:63–78, 177–185** versus **H:247–274** | Develop runs the staleness gate **before resolving the extension root**, but immediately reads `package.json` in the current directory. From a monorepo root it fails or chooses an unrelated package name; from `src/` the direct `jq` read fails even though npm’s upward lookup would work. | Resolve and enter the extension root first; then run staleness before reading implementation or planning. |
| **P2** | **S:68–163** versus **H:47–65** and **scripts/preflight.mjs:422–451** | The “executable” scaffold creates no ESLint config or `.prettierrc`. Installing `@raycast/eslint-config` does not register a project configuration. The prescribed ESLint 9/10 path therefore cannot reliably pass `npm run lint`; preflight explicitly fails the missing `.prettierrc`. | Include the minimal flat config and canonical Prettier config/dependency before verification. Keep their contents canonical rather than duplicating another independently maintained template. |
| **P2** | **S:153–163**; **Ship:548–551** versus **skills/review-pr/SKILL.md:253–262** | Scaffold and ship put `tsc` before build. Review-pr explicitly documents that a fresh checkout lacks generated `raycast-env.d.ts` until build/dev, causing valid generated `Preferences` references to fail. An agent can diagnose missing generated declarations as a source defect. | Standardize the order: build/generate declarations → explicit `tsc --noEmit` → lint. |
| **P2** | **H:1928** versus **scripts/preflight.mjs:454–460**, **Ship:543–545** | `no-hand-preferences` is **report-only** in the matrix, but preflight emits a blocking `hand-typed-preferences` failure for matching declarations. Ship blocks every script failure before reaching the report-only matrix row. | Reconcile the two policies explicitly: either make the matrix blocking for the enforced subset or downgrade that script result. |
| **P2** | **K:13–16, 64–67** versus **K:62, 79–84** | One passage says current docs independently establish a binding; later passages say “never” use prose docs and require the runtime artifact. A reviewer can accept or reject the same evidence depending on which paragraph it follows. | Retain one precedence statement: current docs are acceptable; runtime wins disagreements. Move the former distrust into dated history. |
| **P2** | **D:302–307** versus **H:922, 956–959** | Today’s new bullet requires verbatim `strictRedaction` copy for preferences the agent writes, including on forks. The canonical strict-redaction rule is self-authored-only and explicitly says to leave non-authored extensions alone. A touched fork preference gets conflicting instructions. | Have the bullet defer to each canonical rule’s scope. Retain the explicit changed-preferences-only limit for forks. |
| **P2** | **H:910–918, 934–949** | The fixed-copy audits do not verify the promised verbatim blocks. Verbose checks only three copy fields; strict checks only title/description, omitting label, type, required and default. Both selectors can print nothing when the preference is absent. A green shell exit does not prove compliance. | Validate the complete required object with an explicit applicability/presence result. Do not treat output absence or exit 0 as proof. |
| **P2** | **D:406–407** versus **D:458–459** | Develop permits launching a background watcher and explicitly requires leaving it running; later it requires stopping the dev process before handoff. These prescribe different final installation states. | State one lifecycle: keep it alive through testing, then either stop it or explicitly hand over the still-running watcher. |
| **P2** | **R:178–184** versus **Ship:812–829** | README template still supplies the loose `metadata/` grep that ship expressly rejects because it flags folder listings in code blocks. Its assets check also misses the template’s normal HTML image form. Following the canonical template produces both false findings and missed embeds. | Delete the template’s duplicated commands; point to the canonical mechanical check. |
| **P2** | **scripts/preflight.mjs:389–406**; today’s tests at **scripts/preflight.test.mjs:141–148** | The new README check scans raw Markdown. A fenced example containing `![shot](metadata/shot.png)` blocks submission despite rendering as code. Conversely, reference-style images such as `![shot][s]` with `[s]: metadata/shot.png` escape detection. The new test checks a bare folder mention, not a fenced image example. | Check rendered image/link destinations, excluding code spans/blocks and resolving reference definitions. Add these two cases before treating the check as comprehensive. |

Two additional consistency details:

- **S:157** still says build does not typecheck, although its own build script is `ray build -e dist` at **S:99**, the explicit exception documented at **H:146–154**. Keep the explicit `tsc` gate; correct its justification.
- **H:1876–1881** makes 280 characters advisory, allowing justified exceptions; **H:1968** labels the whole changelog rule blocking. Clarify that the numeric target alone cannot trigger a block.

**Today’s develop addition:** the numeric limits match H:974–990, and both canonical logger blocks fit those limits. The problems are scope drift, duplicated instructions, and reliance on incomplete audits—not the numbers themselves.

## 2. Redundancy map

These locations contain substantive repetitions; brief links alone are not counted as duplication.

| Rule | Locations | Canonical home | Action for the others |
|---|---|---|---|
| Extension-root resolution and wrong-directory consequences | H:196–275; D:177–185, 496–499 | H `extension-root` | Develop: one prerequisite plus link. Delete repeated diagnosis. |
| Explicit type gate | H:138–168; D:278–279, 321–326; S:153–160; Ship:548–552, 570–572, 1002; review-pr:250–262 | H policy; review-pr’s generation-order detail incorporated there | Skills retain the executable gate sequence and evidence checklist, linking for rationale. |
| Shortcut collision/autofix rules | K:183–230; D:267, 277, 281–285, 424–425, 501, 503; H:1341–1348; Ship:658–661, 1013 | K | Replace develop’s callout and gotchas with pointers. H’s sectioning rule needs only “recheck resolved-panel collisions.” |
| Launch and verify actual behavior | H:277–284; D:319–332, 414–476, 487, 493–495 | D dev-loop procedure | H retains one-line obligation and link; delete repeated develop gotcha. Keep handoff evidence requirement. |
| Preference limits and logger copy | H:875–991; D:302–312 | H, with deterministic fields checked in preflight | Develop: one changed-copy checkpoint linking IDs. Move receipt out of the procedure. |
| README image destinations | R:167–206; H:1822–1829; Ship:798–829, 1030–1039; scripts/preflight.mjs:389–406 | R policy; preflight implementation | House style points to R; ship invokes/checks the script result rather than maintaining three regexes twice. |
| Store badge requires publication | R:238–242; H:1802–1806, 1808–1813, 1827–1829 | R | H retains applicability/result mapping only. |
| Funding is standalone-only and nonblocking | R:284–300; H:1798–1800, 1808–1810; Ship:780–782 | R | House/ship use one-line pointers, preserving the nonblocking qualification. |
| Changelog placeholder | H:1831–1851; Ship:880–918; scripts/preflight.mjs:270–293 | H policy; preflight structural checks | Ship keeps “add the entry,” history reconciliation and result evidence; remove parallel structural grep procedure. |
| Why EmptyView enforcement belongs in lint | H:1662–1689; reference/eslint-rules/no-multiline-emptyview-description.mjs:4–22 | H rule and installation pointer | Rule file gets a short purpose comment and link; move the design-decision narrative to learnings. |

## 3. Simplification proposals

Estimates are net reductions in the cited passages, including replacement pointers. They are not additive where proposals overlap.

| Rank | Range | Concrete proposal | Estimated lines saved | Risk |
|---|---|---|---:|---|
| 1 | **D:319–476** | Keep the launch command, watcher lifecycle, state checklist, destination verification, and reporting requirements. Move pre-v2 targeting, old preference reload behavior and clipboard incident history to learnings. Replace each with one symptom-triggered link. | **95–110** | Low if the watcher warning remains beside the command. |
| 2 | **H:993–1133** | Reduce kit guidance to applicability, report-only status, four helper mappings, abort behavior and the root/subpath import table. Move census, adoption history, resolver repro and rejected-helper discussion to the extraction learning; dep-gates owns versions/resolver prerequisites. | **75–90** | Medium: preserve headless-module import boundaries. |
| 3 | **K:5–84, 193–217** | Open with authority precedence, then the semantic/platform decision table. Retain the five divergent bindings and three distinct autofix hazards. Move the chronology, repeated authority claims and extraction procedures into a dated evidence/troubleshooting section or learning. | **60–75** | Medium: all three hazards must survive. |
| 4 | **H:854–991; D:302–312** | Keep the two JSON blocks once. Consolidate scope and validation around them; replace repeated explanations with one evidence line/link. Put length and exact-field checks in preflight. | **45–60** | Low after scope is reconciled. |
| 5 | **H:1293–1376** | Lead with: “For each resolved panel: section only if it has ≥5 direct actions spanning ≥2 scopes. Submenus count as one. Title the item section with its display name; keep destructive actions with their target.” Keep one example and collision pointer; move tester-specific history to learnings. | **40–50** | Medium: preserve single-scope exemption and resolved counting. |
| 6 | **H:196–275** | Keep root definition, the upward-then-downward resolver, ambiguity handling and one sentence about parent-package false success. Replace the measured table and repeated diagnosis with one evidence link. | **35–45** | Low. |
| 7 | **H:711–821** | Keep the five toast rules, provenance distinctions and corrected example. Replace the two long incident sequences with one evidence sentence/link. | **30–40** | Medium: ownership and update-order exceptions are substantive. |
| 8 | **H:1782–1829** | Replace with scope, publication condition, report-only status and a link to R for markup, images and funding. The section currently announces R as canonical, then repeats its rules. | **30–35** | Low. |
| 9 | **D:292–317, 491–505** | Replace the copy section with: “Review changed copy against `us-english`, `empty-state-copy`, and `pref-description-length`; apply each rule’s scope. Use canonical logger blocks when applicable.” Delete gotchas already covered by the main procedure; preserve unique gotchas. | **20–30** | Low. |
| 10 | **H:1639–1689; ESLint rule:4–22** | Retain observed behavior, exact enforcement limits and configuration example. Replace duplicated wrapper-versus-lint argument with one learning link. | **20–30** | Low. |

The first three cuts alone remove roughly **230–275 lines** while bringing the decisions and commands closer to the top.

## 4. Followability problems, ranked

1. **Prerequisites appear after their consumers.** Root discovery follows staleness; declaration generation follows `tsc` in some flows; scaffold’s house-style requirement appears after verification. Put prerequisites immediately before the first dependent command.

2. **Skills claim not to restate policy while doing so.** D:480–483 and H:1406–1408 promise canonical references, but develop maintains its own shortcut policy. This gives agents two apparently authoritative answers. Replace summaries of exceptions with links.

3. **The matrix requires repeated navigation through 2,000 lines.** H:1925–1968 repeats rule titles but provides no direct rule links or check ownership. Make the rule column link to the body and identify results supplied by preflight/ESLint. Keep manual checks separately identifiable.

4. **Tagging can prevent deferred fixes from ever reaching the writer.** Develop’s retrofit explicitly skips `[verify]` rules at D:260. Yet `react-hooks-lint` and `madge-cycles` say “add next time changed” at H:179–194. That next-touch instruction is invisible to the prescribed develop pass; ship only reports it. Align those tags with their intended next-touch behavior.

5. **Scaffold’s handoff threshold changes.** S:3, 171 say hand off once files exist; S:162–163 requires all verification first. State one completion boundary. Also make clear which house-style tags scaffold applies: S:196 names only `[build]`, omitting `[both]` and `[lint]`.

6. **Audit results have inconsistent meaning.** Some checks are commands that fail, others print violations with exit 0, others are reading instructions. “Run the Audit” does not tell an agent whether silence means compliant, inapplicable, absent input or a failed search. Mechanical checks should return explicit results; manual ones should name the evidence required.

7. **Handoff ownership has an undocumented exception.** Develop says code changes belong there; `raycast-pr-loop` directly fixes valid code findings at its lines 150–156. Clarify that the loop performs develop-grade work under those rules, rather than implying a mandatory skill bounce for every change.

8. **Repeated gates are not all waste, but their invalidation conditions are obscured.** Develop → ship checks different moments; ship’s dependency mutations justify rerunning build/type/lint. Within an unchanged tree, running the same type gate again through the matrix adds no evidence. Reuse the recorded result until relevant files or dependencies change.

Mechanical candidates with the best payoff:

- Preference description/label lengths, including command preferences: **preflight**, report-level.
- Fixed logger preference fields and applicable presence: **preflight**, with reconciled scope/severity.
- Prettier config/dependency pairing: **preflight**.
- Existing changelog structure checks: reuse **preflight** instead of parallel shell checks.
- EmptyView literal newlines: retain the **ESLint** implementation; document its actual limits.

## 5. Keep list

- **Resolved-panel semantics and collision precedence.** Conditions, composed actions and submenus make source-level counts unreliable. K:185–189 and 225–230 contain necessary distinctions.
- **All three autofix hazards.** They lead to different behavior changes; combining them into “check after lint” loses actionable information.
- **Copy Error’s per-call-site pairing review**, H:627–631. Global string counts cannot establish compliance; helper-backed forms must remain accepted.
- **Toast ownership, abort and update-order distinctions.** These look repetitive but cover different failure traces. Cut history, not the distinctions.
- **Self-authored versus fork scope.** Especially for personal dependencies, badges and funding. These qualifications prevent unrelated upstream churn.
- **Evidence provenance:** observed behavior, inspected implementation and inference. Toast and icon rules appropriately distinguish them; preserve that in shortened versions.
- **External-effect verification**, D:426–470. A successful toast cannot prove clipboard contents or the written artifact.
- **Separate build, explicit typecheck and lint gates.** Their coverage differs; fix ordering and duplicate execution rather than deleting a gate.
- **Report-only adoption opportunities.** Kit, hooks lint and cycle detection should not become submission blockers accidentally.
- **Git’s `grep -P` distinction.** H:1603 uses `git grep`, not macOS BSD `grep -P`; those are different commands. I did not classify that command as a BSD-grep defect.
- **The audit matrix itself.** It provides stable IDs, scope and failure policy. Link it better and reconcile implementation differences rather than removing it.

## 6. Coverage and verification

| Cluster file | Coverage |
|---|---|
| `skills/develop/SKILL.md` | **Read fully**, including today’s addition |
| `skills/scaffold/SKILL.md` | **Read fully** |
| `reference/house-style.md` | **Read fully** |
| `reference/keyboard-conventions.md` | **Read fully** |
| `reference/readme-template.md` | **Read fully** |
| `reference/eslint-rules/no-multiline-emptyview-description.mjs` | **Read fully**; only file in that directory in the supplied inventory |

Supporting coverage:

- **Read fully:** inventory, supplied diff, `CLAUDE.md`, `scripts/preflight.mjs`.
- **Skimmed/targeted reads:** preflight tests, ship, review-pr, raycast-pr-loop, dep-gates.
- Other clusters and historical learnings were **not reviewed comprehensively**. Ship-only changes in today’s diff are outside this report’s correctness coverage except where they intersect cluster B.

A read-only parser check found **51 rule IDs: nine build-only rules and 42 matrix rows**, with **no missing non-build IDs, orphan rows or tag mismatches**. The problems above concern scope, severity and actual enforcement. The build-only `toggle-copy` rule has an explicitly judgment-only Audit; its absence from the matrix is intentional.

The ESLint rule checks literal values and template quasis; it does not resolve variables, concatenations or interpolation values. A small in-memory invocation also confirmed it matches any `*.EmptyView` member by property name, including unrelated objects—not only `List` and `Grid`.

I did not run the preflight suite because its fixtures create temporary files, conflicting with this run’s no-writes constraint. A heredoc was blocked by the sandbox; Git emitted macOS cache warnings. Neither is a finding. The four modified files reported by Git match the supplied uncommitted-change inventory; I made no edits.


