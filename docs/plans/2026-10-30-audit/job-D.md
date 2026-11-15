**The learnings are all reachable, but they are not a consistent rule set.** All 21 appear in at least one skill’s routing table, and every learning target in those tables exists. The largest problem is amendment chains: later learnings correct earlier advice without removing the earlier instruction.

No files were changed. The permitted tests produced 1 pass and 39 sandbox `EPERM` fixture-creation failures; those failures are not findings. No network or npm commands ran.

Paths below are relative to `plugins/raycast-extensions/`. Abbreviations: **D** = `skills/develop/SKILL.md`, **S** = `skills/ship/SKILL.md`, **R** = `skills/review-pr/SKILL.md`, **P** = `skills/raycast-pr-loop/SKILL.md`, **C** = `skills/scaffold/SKILL.md`, **H** = `reference/house-style.md`. Learning names refer to the exact filenames in the per-learning table.

**1. Correctness findings**

1. **P1 — The blocking-review learning still teaches the lock guarantee its technical sibling explicitly retracts.**  
   `learnings/workflow-issues/answer-a-blocking-review-with-a-measurement.md:75–84,139–144` says reclamation requires a crashed holder, two reclaimers and a multi-second stall, with at most one lost update.  
   `learnings/design-patterns/portable-node-advisory-file-lock.md:129–141,188–204` explains that neither the crash nor a multi-second stall is required, one reclaimer can suffice, and multiple committed updates can be erased.  
   **Failure:** an agent answering a blocking review supplies a materially false safety argument, following precisely the ship-side routing intended for that situation.  
   **Fix:** replace the residual explanation and example in the blocking-review learning with a pointer to the lock learning. Keep the technical guarantee in one place.

2. **P1 — Today’s CHANGELOG containment test authorizes discarding unrelated contributions.**  
   **S:1507–1515** checks whether incoming CHANGELOG headings and sections are contained locally, then instructs “take ours for every conflicted file.” CHANGELOG containment establishes nothing about an incoming TypeScript fix or other conflicted file.  
   The preceding “exactly the published version” test at **S:1503–1506** is also one-directional: it checks incoming paths against published paths, misses published-only paths, never tests `bad`, and can print nothing after a failed/empty `git ls-tree`.  
   **Failure:** an older incoming CHANGELOG plus a genuine incoming code change can enter the discard-all branch. An empty cached diff then merely confirms that the incoming change was discarded.  
   **Fix:** make containment decisions per file. CHANGELOG containment may decide CHANGELOG only. Compare complete path sets and bytes for whole-tree equality, explicitly propagate extraction failures, and consume an actual success status.

3. **P1 — The canonical Copy Error example bypasses the redaction learning it tells agents to read.**  
   **H:614–616** routes raw server errors to the security learning. That learning requires boundary redaction at `learnings/security-issues/error-display-is-a-credential-disclosure-surface.md:84–96,156–170`. But **H:635–645** derives raw `error.message`, displays it, and copies it unchanged.  
   **Failure:** an agent copying the canonical example on a fork without the kit exposes an SDK/server credential in both surfaces.  
   **Fix:** make the canonical example apply the stated boundary redaction to both surfaces. The link cannot compensate for executable example code that demonstrates the opposite.

4. **P2 — The “offline” dependency probe has no transport barrier and ignores returned rejections.**  
   `learnings/workflow-issues/test-against-the-dependency-not-your-own-constant.md:64–75` claims no request is made, then invokes `client.messages.create()` with neither a fake transport nor an awaited result. Its own results at **:80–86** include accepted pairs.  
   **Failure:** the synchronous `catch` handles the rejected pairs only. Accepted pairs can proceed to dispatch; later authentication/network rejections escape this `catch`. A dummy API key does not disable transport.  
   **Fix:** inject a transport that records dispatch and returns a controlled response, and handle the returned promise. Distinguish “synchronous validation accepted” from “request succeeded.”

5. **P2 — The wrong-base learning describes a repository change that its PATCH cannot perform.**  
   `learnings/workflow-issues/raycast-store-pr-base-diverged-fork-main.md:42–48,54–69,96–109`, repeated at **S:1562–1581**, claims `-f base=main` changes `base_repo` from the fork to upstream. That body selects a base **branch**, not another base repository. The endpoint already identifies a PR in `raycast/extensions`.  
   **Failure:** an agent diagnoses an actual fork-repository PR and repeatedly patches the upstream endpoint, or mistakes a branch-base repair for a repository retarget.  
   **Fix:** retain the incident result, but separate observed branch retargeting from the claimed repository switch. Check both identities and describe the remedy supported by the actual endpoint.

6. **P2 — The green-falsification learning gives incorrect explanations for two shell/CLI failures.**  
   `learnings/workflow-issues/green-falsification-that-tested-nothing.md:78–85` says `gh api -f` sends a body parameter on GET and falls back to the default branch. Supplying fields makes `gh api` default to **POST** unless the method is overridden; the observed 404 does not establish the narrated GET behavior.  
   At **:106**, “`bash -c` does not inherit the shell’s `GH_TOKEN`” is also incorrect as a general rule: exported environment variables are inherited.  
   **Fix:** describe the first as unintended method selection; prescribe an explicit GET with query parameters. Describe the second as the observed missing-authentication environment, without attributing it inherently to `bash -c`.

7. **P2 — The audit learning’s “RIGHT” example still counts spellings rather than verifying compliance.**  
   `learnings/workflow-issues/audit-coupled-to-the-hand-written-form-of-a-rule.md:58–67` labels a line-filter and a global marker count as corrected checks. A multiline raw toast still appears in the first result even when its action is compliant; one helper/string elsewhere can inflate the second result without fixing another site.  
   **H:627–631** now correctly requires per-call-site pairing and explicitly rejects global counts.  
   **Fix:** replace both “RIGHT” commands with a pointer to that canonical audit. Preserve the old commands as the incident’s failed proxies, if useful.

8. **P2 — The new README gate confuses source examples with rendered embeds and misses ordinary embed syntax.**  
   `scripts/preflight.mjs:392–406` scans raw README text. A fenced or inline example containing `![example](assets/icon.png)` fails although it renders as code. Conversely, reference-style images such as `![shot][preview]` with `[preview]: metadata/shot.png`, and angle-bracket destinations, escape the check.  
   `scripts/preflight.test.mjs:147–148` comments that code blocks are not embeds, but tests only a bare path in prose.  
   **Fix:** extract rendered image/link destinations with Markdown-aware handling, excluding code, and add tests for those cases. Until then, describe the check as a heuristic rather than a complete deterministic gate.

9. **P2 — The rendered-output learning still prescribes the workaround that current house style supersedes.**  
   `learnings/workflow-issues/rendered-output-is-invisible-to-code-review.md:63–68,128–133` presents hide-and-reshow as unconditional and recommends it generally for mutation-after-present. **H:706–709** explicitly retracts the general mutation diagnosis; **H:711–737** explains why a retained handle can affect a newer toast, making hide-and-reshow unsafe without ownership.  
   **Failure:** an agent loads the learning to fix a visual defect and introduces dismissal of another run’s toast.  
   **Fix:** keep the witnessed spinner incident, mark the workaround historical, and route terminal-state implementation to `animated-means-work` and `toast-no-id`.

10. **P2 — The performance learning’s opening mandate contradicts its applicability test.**  
    `learnings/design-patterns/quadratic-accumulator-paths-in-text-reflow.md:74–76` requires a committed timing test for **any** accumulating function. At **:212–216**, all three conditions must hold, and append-only loops or tiny bounded inputs are explicitly exempt.  
    **Failure:** an agent follows the prominent mandate and adds timing tests to trivial append loops.  
    **Fix:** replace the opening mandate with the three-condition scope. Keep the generous timing margin, correctness assertion and caller-controlled-budget counterexample.

**2. Redundancy map**

These are the operational repetitions worth consolidating; trigger links themselves should remain.

| Rule | Locations | Canonical home | Action for the others |
|---|---|---|---|
| Separate finding, premise, remedy and measurement | `answer…:45–97`; `verify…:38–69`; `wrong-vendor…:59–81`; S:32; P:157–161 | `verify-the-remedy-not-just-the-finding.md` | Merge the three learning procedures there; retain incident sections as evidence; skills get one-line pointers. |
| Describe the portable-lock residual | `portable…:95–141,188–204`; `answer…:75–84,139–153` | `portable-node-advisory-file-lock.md` | Delete the stale technical explanation from `answer…`; link the canonical residual. |
| Copy Error must accept helper and handwritten forms | `audit…:46–85`; H:627–631,1921–1923; D:262 | H:627–631 | Learning retains why the old proxy failed; other procedure sites point to the per-site audit. |
| Instant operations need no spinner; terminal toast handling | `rendered…:63–80,128–133`; H:699–737 | H’s `animated-means-work` / `toast-no-id` | Replace learning implementation advice with the historical symptom and rule links. |
| Shared-kit eligibility and scope | `deciding…:51–62,105–113`; H:993–1025; D:270–274 | H’s `kit` rule | Learning keeps the extraction decision evidence; develop uses a short eligibility pointer. |
| Runtime verification exceeds green static gates | `use-cached…:147–162`; `count…:100–108`; `self-review…:138–170`; `rendered…:108–133`; D:319–326,487,493–495; R:46; C:31; H:277–284 | H’s `launch-before-done` for required action | Keep distinct examples in learnings; remove repeated general sermons and make skill reminders pointers. |
| Verify Store PR base after publication | `raycast-store…:39–90`; S:1562–1581 | S’s post-publish verification | Learning keeps the incident and corrected explanation, not another full repair procedure. |
| README asset-folder check | S:812–829,1030–1036; `scripts/preflight.mjs:389–406` | Corrected preflight check | Replace both shell implementations with the check ID/result; retain folder rationale once. |
| Historical kit compliance numbers | `deciding…:73–86`; H:1012–1025 | Extraction learning | House style needs one evidence sentence plus link, not the duplicated table. |

**3. Simplification proposals, ranked**

Savings are approximate, non-additive where proposals overlap. Preserve unique incident evidence.

| Rank | File/range | Concrete proposal | Lines saved | Risk |
|---|---|---|---:|---|
| 1 | `answer…:43–155`; `verify…:36–94`; `wrong-vendor…:57–117` | One current procedure in `verify…`: “Check the finding’s external premise and the remedy’s premise. Consult the installed artifact when values or behavior matter. Benchmark alternatives when needed to settle a disputed tradeoff. Report remaining limits; retain rationale at the code.” Keep each unique incident in an evidence section; remove amendment chains and repeated conclusions. | 100–140 | Medium: preserve the cheap-premise-check versus expensive-benchmark distinction. |
| 2 | `self-review…:174–210`; `test-against…:42–44,139–158,169–185`; `rendered…:42–44,116–124,135–150`; `bugs…:129–150` | Remove repeated retellings and explanations of how each sibling differs. Put a four-row “which evidence is missing?” selector in the verification learning, with links to the distinct cases. | 90–120 | Low if the cases themselves remain. |
| 3 | `quadratic…:67–92,210–306` | Put the three applicability conditions first, followed by one complete timing-and-correctness test. Keep cause 4’s user-controlled-budget counterexample. Replace adjacent-test listings and repeated explanations with links to the source tests. | 55–75 | Medium: do not lose Unicode-boundary coverage or wide-budget coverage. |
| 4 | `deciding…:115–174`; H:1012–1025 | Keep the fleet table, six decision steps and reject list. Replace repeated conclusions/API history with one sentence and source link; remove the duplicate house-style table. | 30–45 | Low. |
| 5 | `rendered…:70–80,108–133` | Drop the historical helper-call census from the decision path. Replace procedure with: “Observe the rendered result; state any unverified visual criterion. A state assertion does not verify pixels. Follow current toast rules for implementation.” Keep the census as linked evidence if needed. | 25–35 | Low. |
| 6 | S:812–829,1030–1036 | After fixing the parser, use “`readme-assets`: pass” in the final checklist and one explanation of `media/` versus runtime assets. | 20–25 | Low; avoids maintaining three implementations. |
| 7 | D:309–317 | Replace each receipt with one line plus a link to its evidence record: “Logger preference copy drifted twice despite existing rules; use the named canonical blocks.” | 5–7 | Low. |

Do not achieve these savings by deleting the only surviving measurements. Move evidence out of the mandatory decision path; retain it under stable headings or linked evidence files.

**4. Followability and stacking problems, ranked**

1. **Current instructions are distributed across amendments.**  
   `verify…:60–69` narrows `answer…`’s “last finding” rule; `wrong-vendor…:77–81` amends `verify…`’s refactor exception; `portable…:188–204` corrects the residual still taught by `answer…`. Replace amended instructions at their original locations. An agent should not need to discover precedence by reading Related sections.

2. **Routing coverage is complete globally, incomplete at several actual entry points.**  
   Develop routes all four verification learnings at D:47–50, but review-pr’s table at R:36–44 omits module seams, inert probes, wrong test oracles and rendered-output limits. It also routes mocked AI evals without routing confirmation-process isolation. A contributor review need not pass through develop first.

3. **Two authoring triggers are available only after handoff.**  
   Audit-helper coupling is routed from S:29 and H:1921–1923, but not D’s table, even though its required action is “update the audit in the same change.” Remedy validation and review-layer convergence likewise apply when develop repairs code, not only when ship or the PR loop processes reviews.

4. **The PR-loop branch starts with implementation before the premise check is explicit.**  
   P:152 says “Valid → fix it directly”; P:157–161 then requires measurement for the wrong-remedy branch. The routing table points to the nuanced distinction, but the operational branches should briefly state that premise validation precedes both.

5. **The general shared-limiter lesson is hidden behind a Reddit-only trigger.**  
   `reading-reddit…:197–233` is substantial cross-process coordination guidance. D:42 routes it only for reading Reddit. Its “needs a server-side coordinator” conclusion at :228 also needs scoping: the portable-lock learning documents another coordination option with its own residual. Keep the lightweight limiter’s accepted tradeoff, without presenting it as a universal platform limit.

6. **Learnings repeatedly restart the procedure after teaching it.**  
   Guidance, Why This Matters, When to Apply and Examples often repeat the same action. Keep the trigger and current action first; retain the rest as evidence. The 306-line performance learning is the clearest example.

7. **Today’s mechanical gate is added without retiring the manual copies.**  
   The README rule now runs in preflight and remains two separately maintained shell audits. Their syntax coverage already differs. This is exactly the audit-maintenance problem the plugin’s own learning describes.

`check-references.sh:123–153` verifies that **some** skill/reference cites each learning. It does not verify that every applicable workflow routes it. Its current behavior is useful, but it cannot establish semantic routing completeness.

**5. Per-learning table and coverage**

“Only linked” means there is no separate complete operational rule in the inspected skills/reference passages. Every learning below was **read fully**. No contradiction found means no textual conflict found in this review; it does not certify historical external claims.

| Learning file under `learnings/` | Encoded in | Routed from | Verdict |
|---|---|---|---|
| `architecture-patterns/bugs-concentrate-at-module-seams.md` | Partial overlap D:502; full seam method remains in learning :42–141 | D:47; missing R route | **Keep** distinct seam examples, especially identity changes without remount. No contradiction found. |
| `architecture-patterns/raycast-applescript-jxa-integration.md` | Only linked; seven-part method remains :42–153 | D:39, C:27 | **Keep**; unusually concrete transport guidance. Scope AirBuddy-specific behavior to verified builds. |
| `design-patterns/ai-tool-confirmation-runs-in-its-own-process.md` | Only linked; lifecycle/fail-open choice remains :42–64 | D:45; missing R AI-review route | **Keep**; distinct process boundary and live verification. Do not generalize dev-null’s accepted residual into a mandatory policy. |
| `design-patterns/portable-node-advisory-file-lock.md` | Only linked; lock guarantees remain :36–141 | D:37, R:40, C:25 | **Keep** as canonical technical account; correct conflicting `answer…` text. |
| `design-patterns/quadratic-accumulator-paths-in-text-reflow.md` | No separate complete performance rule | D:40, R:41 | **Keep**, shorten; reconcile broad :74 mandate with :212 applicability. |
| `design-patterns/read-installed-raycast-extensions-from-config-not-application-support.md` | H:533–534 encodes the wrong-source prohibition; algorithm remains in learning | D:38; H inline | **Keep**; `null` versus empty/partial set and missing-versus-broken manifest distinctions are valuable. |
| `design-patterns/use-cached-promise-caching-semantics.md` | Partial H:332–345; its other three behaviors remain in learning | D:36, R:39, C:24 | **Keep**; partial overlap is not sufficient replacement. No contradiction found. |
| `security-issues/error-display-is-a-credential-disclosure-surface.md` | Partial H:614–616; canonical example violates it | D:41, R:38, C:26; H inline | **Keep** adversarial shapes and boundary tests; fix canonical example. |
| `tooling-decisions/deciding-whether-to-extract-a-shared-package.md` | H:993–1025; D:270–274 | D:43; H:998 | **Keep** decision evidence; remove duplicate eligibility instructions/statistics elsewhere. |
| `tooling-decisions/reading-reddit-programmatically-in-2026.md` | Only linked | D:42; generic limiter trigger absent | **Keep**, split or clearly separate dated endpoint evidence from generic limiter guidance. Scope platform-floor claims. |
| `workflow-issues/answer-a-blocking-review-with-a-measurement.md` | S:32; P:157–161 | S:25, P:120 | **Merge into `verify-the-remedy-not-just-the-finding.md`**; preserve experiment/review outcome, remove stale residual argument. |
| `workflow-issues/audit-coupled-to-the-hand-written-form-of-a-rule.md` | H:627–631,1921–1923 | S:29; H inline; missing D trigger | **Keep** the incident as why; replace faulty “RIGHT” audits with canonical pointer. |
| `workflow-issues/count-the-review-layers-not-the-findings.md` | Mostly only linked; partial D:502 | S:28, P:122 | **Keep**; convergence on one symbol is distinct from merely requiring another review. |
| `workflow-issues/green-falsification-that-tested-nothing.md` | Only linked; no complete operational equivalent found | D:48; missing R/P probe-verification routes | **Keep**, correct CLI/environment explanations and shorten repeated examples. |
| `workflow-issues/mocked-ai-evals-prove-only-their-assertions.md` | R:326–332 encodes live questions/Copy Eval | D:44, R:44 | **Keep** real-data-window and empty-string examples; shorten duplicate live-run procedure. |
| `workflow-issues/raycast-store-pr-base-diverged-fork-main.md` | S:1562–1581 | S:24 and inline :1562 | **Keep incident; fold current procedure into S** after correcting branch/repository distinction. Remove stale “repo-local cursors” framing at :114–118. |
| `workflow-issues/rendered-output-is-invisible-to-code-review.md` | H:277–284,699–737; D:319–430 | D:50; missing R route | **Keep evidence**, mark toast workaround historical; current implementation advice belongs in H. |
| `workflow-issues/self-review-does-not-catch-diagnostic-errors.md` | Partial D:506–520 for renderer replay; general diagnostic method remains in learning | D:46, R:43 | **Keep** distinguishing probes and sweeps; cut repeated case summaries. |
| `workflow-issues/test-against-the-dependency-not-your-own-constant.md` | Only linked | D:49; missing R route | **Keep** oracle distinction; repair supposedly offline SDK probe. |
| `workflow-issues/verify-the-remedy-not-just-the-finding.md` | Partial P:150–161 and S:32 | S:26, P:119 | **Keep as canonical merged review-premise procedure**; absorb sibling amendments. |
| `workflow-issues/wrong-vendor-docs-manufacture-review-findings.md` | `reference/keyboard-conventions.md:84` routes historical incident; P:121 routes review use | R:42, S:27, P:121 | **Merge procedure into `verify…`**; preserve resolved-upstream incident and artifact evidence as a named evidence section. |

**6. Keep list and remaining scope**

Keep these apparent repetitions or lengthy details:

- **Trigger pointers in multiple skills.** Scaffold, develop and contributor review are independent entry points. Removing their pointers would recreate the original discoverability failure.
- **The three file-lock guards and precise residual.** They address different interleavings. Preserve the correction, not the superseded claim.
- **The four `useCachedPromise` behaviors.** Key identity, cached-data/error coexistence, fetch-versus-restore and toast ownership are separate contracts.
- **The four verification distinctions.** Module seam, inert probe, wrong oracle and unobserved pixels require different remedies. Consolidate navigation and repeated explanations, not the distinctions.
- **Live confirmation handover and Copy Eval evidence.** Unit tests and mocks can omit precisely these host/model boundaries.
- **Performance correctness assertions, Unicode boundary and caller-controlled budget counterexample.** A fast result alone can mean skipped work.
- **Resolved-upstream and historical-source labels.** These prevent dated evidence from becoming a present-tense allegation.

Coverage beyond the cluster: supplied inventory and diff read fully; `preflight.mjs` read fully; changed test block and fixture setup read; develop, ship, review-pr, scaffold, PR-loop and referenced house-style/keyboard passages selectively inspected. `check-references.sh`’s learning/link checks were inspected. Other reference files, workflow/template implementations and external historical sources were not comprehensively reviewed. All supplied diff hunks were inspected; the preference-copy addition revealed no additional substantive defect.


