The biggest simplification opportunity is `dep-gates.md`: it preserves several generations of policy as executable instructions. Shortening it would also fix correctness problems. `review-pr` mostly needs consolidation within itself; its inbound-review safeguards should remain separate from submission gates.

No files were edited. The four modified files reported by Git match today’s supplied diff.

Paths below are relative to `plugins/raycast-extensions/`, except root files explicitly named.

## 1. Correctness findings

### P1 — Three incompatible API dependency policies remain active

**Locations:** `reference/dep-gates.md:32–46`, `:65–68`, `:81`, `:120–129`, `:180–185`, `:230–234`; `skills/ship/SKILL.md:578–587`.

The reference tells agents to:

- Submit the newest release on the current major.
- Submit the version last exercised in Raycast; npm currency is advisory.
- Target `^2.1.0` for every new extension and migration.
- Treat 1.x as the existing-extension floor, while another callout explicitly says that policy was superseded by a `^2.1` floor.

An agent consulting the dependency reference can prescribe the exact untested ship-time bump that `ship` prohibits, or unnecessarily migrate an existing 1.x extension.

**Fix:** Make the current table and exercised-version policy authoritative. Move the August/September policy sequence into historical evidence, removing its imperative language from this reference. Retain the October decision about new extensions and the distinction between compatibility minimums and fleet targets.

### P1 — Today’s merge shortcut can discard a real contribution

**Location:** `skills/ship/SKILL.md:1507–1515`.

The second test examines only CHANGELOG headings and matching historical sections, but its conclusion authorizes taking ours for **every conflicted file**.

**Failure trace:** An incoming branch contains a genuine code fix without a new changelog entry. Its changelog is fully contained in ours; its code fix conflicts with our edits. Taking ours discards that fix. An empty `git diff --cached HEAD` then passes precisely because the contribution was discarded.

**Fix:** Changelog containment may justify a changelog resolution only. Applying ours to other files requires evidence about those files or the complete incoming tree.

The first test is also incomplete: it checks only paths present in `MERGE_HEAD`, never checks `$bad`, and interprets silence as success. It cannot establish complete tree equality, including deletions.

### P2 — The changelog skill’s CLI-manifest command cannot execute

**Location:** `skills/api-changelog/SKILL.md:224–231`.

The JavaScript passed to `node -e` contains:

```js
const m = require(require("path").resolve(process.argv[1]));   # bare relative path != a module
```

`#` is invalid JavaScript here. A read-only compilation probe returned `SyntaxError: Invalid or unexpected token`.

Both process substitutions can therefore produce empty stdout; `diff … || true` suppresses the unsuccessful investigation.

**Fix:** Use `//` for the comment and require successful manifest extraction before comparing the outputs.

### P2 — “Fetch and extract, failing loudly” actually continues after failure

**Location:** `skills/api-changelog/SKILL.md:86–100`.

Each failure uses `break`. That exits the loop successfully and execution continues to assign `OLDD` and `NEWD`. A missing intermediate release can silently remove the evidence needed to attribute changes to their introducing version.

**Fix:** Exit unsuccessfully on packing, extraction, or required-file failure. Establish that the whole requested window was extracted before proceeding.

### P2 — Digit changes do not prove an empty release

**Location:** `skills/api-changelog/SKILL.md:153–160`.

The procedure concludes that a handful of digit-to-digit changes **is** the version string. A changed timeout, numeric flag default, or limit also satisfies that test.

**Consequence:** A functional change can be published as “zero functional change.”

**Fix:** Require the differing positions to belong to the actual version fields/string occurrences. Digit changes alone are an investigation cue.

### P2 — The published-baseline comparison can hide real differences

**Location:** `reference/sparse-checkout-discipline.md:67–78`.

The exclusion regex filters entire `diff` output lines:

```bash
grep -v -E '\.git|node_modules|CLAUDE\.md|\.github'
```

A legitimate source filename containing `node_modules`, for example, suppresses the whole difference. It also suppresses filenames such as `.gitignore`, regardless of whether they are legitimate published differences. A failed `diff` can leave no stdout and be mistaken for an empty comparison.

**Fix:** Apply exclusions to traversal with exact intended names, and distinguish comparison errors from equality. Point submission callers to the stronger staleness procedure rather than retaining this weaker alternative.

### P2 — Today’s README-assets gate misses normal Markdown forms

**Locations:** `scripts/preflight.mjs:394–406`; `scripts/preflight.test.mjs:141–148`.

The new check catches direct inline targets and quoted HTML `src` attributes. It does **not** generally establish that README images avoid the forbidden directories.

Read-only probes confirmed these targets escape:

```md
![shot](<metadata/good.png>)

![shot][s]
[s]: metadata/good.png

![shot](assets/shot.png?raw=1)
```

The extension test on `assets/` requires the image suffix at the very end. Reference images and angle-bracket destinations are not resolved. The regex also scans fenced examples as though they were rendered embeds; the new test’s comment mentions code blocks, but its test body exercises only prose.

**Fix:** Resolve supported Markdown destinations, strip query/fragment components before classifying local image paths, and exclude code examples. Add meaningful cases for these forms before treating this gate as the replacement for prose checks.

### P2 — `review-pr` retains a corrected-away claim about builds

**Locations:** `skills/review-pr/SKILL.md:253–255`; `reference/dep-gates.md:488–490`; conflicting correction at `reference/house-style.md:146–154`.

The first two say `ray build` does not typecheck. House Style explicitly documents that `ray build -e dist` does, and warns against telling contributors otherwise.

**Fix:** Keep the independent `tsc --noEmit` requirement, but use the qualified explanation from `tsc-gate`. Preserve build-before-tsc ordering for generated declarations.

### P2 — Review gotchas recommend the baseline the main procedure forbids

**Locations:** `skills/review-pr/SKILL.md:173–201` versus `:381–387`.

Step 3 correctly requires the authoritative PR diff because the contributor’s `main` may be stale. The gotchas then suggest fetching `origin/main` and using a two-dot comparison against it.

**Consequence:** An agent reaching for the condensed instructions can review unrelated fork drift or miss the intended PR boundary.

**Fix:** Delete the alternative diff recipe. Keep one line: “Use the GitHub PR diff from step 3; the review clone does not contain a trustworthy PR baseline.”

### P2 — Existing sync branches are reused without verifying their contents

**Location:** `templates/sync-from-upstream.yml:698–721`.

An open PR causes an immediate return. An existing branch without an open PR is reused without incorporating the newly computed reconciliation.

**Failure trace:** A run pushes its branch, but PR creation fails. The mirror then receives a local fix while upstream stays at the same commit. The next run computes a different safe reconciliation, finds the old branch, and opens a PR from that old branch instead. The computed result is discarded.

**Fix:** Before reusing a branch or PR, verify that its content still represents the reconciliation against current main. If it does not, report the stale branch for reconciliation; do not silently describe it as covering this run.

### P2 — The changelog output path assumes the source checkout layout

**Locations:** `skills/api-changelog/SKILL.md:270–272`; root `.claude-plugin/marketplace.json:33` (`source`).

The marketplace source is `./plugins/raycast-extensions`, but the skill’s output link traverses four levels up to repository-root `docs/reference/`. That layout exists in this source checkout, not within the declared plugin payload.

**Consequence:** A GitHub-installed skill has no established destination for the promised changelog update.

**Fix:** State that writing the corpus requires a checkout of this repository, and resolve that checkout explicitly. Do not infer it from the installed skill directory.

### P3 — Root and workflow descriptions overstate their guarantees

- **Root `CLAUDE.md:41`** says preflight runs “before anything is read”; `skills/ship/SKILL.md:99–540` performs substantial earlier work. Say “at step 0, after baseline verification.”
- **`templates/sync-from-upstream.yml:15–16`, `:766`** say it never pushes to main / merging a PR is the only write to main. Lines `632–657` directly commit and push baseline bookkeeping. State the content-versus-bookkeeping distinction already explained at `649–651`.
- **Root `CLAUDE.md:36–37`** forbids bypassing the hook, while root `githooks/pre-push:9`, `:21` recommends `--no-verify`. Remove the contradictory bypass advice.

## 2. Redundancy map

This maps the concrete duplicate groups identified, rather than claiming a repository-wide exhaustive census.

| Rule | Locations | Canonical home | Action for the others |
|---|---|---|---|
| API submission version | `reference/dep-gates.md:32–74`, `:99–129`, `:180–234`; `skills/ship/SKILL.md:578–623` | Current policy in `dep-gates.md`; executable gate in `ship` | Remove obsolete instructions; ship points to policy instead of retelling incidents |
| Logger/kit v2 prerequisites | `reference/dep-gates.md:83–84`, `:138–141`, `:213–219`, `:252–274`, `:304–305`, `:307–346` | Gates table plus one compatibility note | Archive historical minimums and fleet snapshots; delete repeated bump instructions |
| Sparse clone order and scope | `reference/sparse-checkout-discipline.md:19–45`, `:120–124`; `skills/review-pr/SKILL.md:25–30`, `:113–136`, `:153–156`, `:373–375` | Sparse discipline reference | Keep review-specific scratch/ref parameters; replace repeated explanation with a pointer |
| Extension-root requirement | `reference/sparse-checkout-discipline.md:106–116`; `skills/review-pr/SKILL.md:138–163`, `:398`; `reference/house-style.md:140–168` for typecheck context | House Style’s `extension-root` rule | Retain `cd` at its execution point; remove repeated error narratives |
| Correct PR diff baseline | `skills/review-pr/SKILL.md:169–201`, `:381–388` | Review step 3 | Delete contradictory gotcha recipe |
| Personal conventions versus third-party code | `skills/review-pr/SKILL.md:48`, `:281–286`; `skills/develop/SKILL.md:288`; root `CONCEPTS.md:61–62` | Develop’s fork caveat | Review keeps a short boundary reminder and Owner-mode exception; glossary keeps definition only |
| Typecheck requirement and explanation | `skills/review-pr/SKILL.md:250–262`; `reference/dep-gates.md:488–490`; `reference/house-style.md:138–168`; `skills/ship/SKILL.md:548–552` | House Style `tsc-gate` | Keep commands where executed; replace repeated explanations with pointers |
| README asset placement | `reference/readme-template.md:167–206`; `reference/house-style.md:1827–1828`; `skills/ship/SKILL.md:798–819`, `:1030–1040`; `scripts/preflight.mjs:389–406` | README template for policy; preflight for enforcement | After fixing coverage, remove duplicate grep procedures; checklist records gate result |
| Screenshot capture requirements | `skills/screenshots/SKILL.md:109–125`; `skills/ship/SKILL.md:432–441`, `:797`; `scripts/preflight.mjs:377–386` | Screenshots capture step | Ship retains submission validation and pointer; script owns dimensions, and should also own count/format |
| Plugin installation/release maintenance | root `README.md:53–65`; root `CLAUDE.md:13–37` | README for human procedure | CLAUDE retains reload warning and points to release procedure |
| Learning must have an incoming citation | root `CLAUDE.md:51–55`, `:60–62` | First paragraph in that section | Delete repeated explanation |

## 3. Simplification proposals

Estimates are net reductions in the operational documents, with incident evidence retained in linked historical/learnings files. They overlap; do not sum them blindly.

| Rank | Location | Concrete proposal | Lines saved | Risk |
|---|---|---|---:|---|
| 1 | `reference/dep-gates.md:118–279`, `:307–346`, `:472–482` | Move release chronology and dated fleet lists to evidence. Replace with current targets, compatibility minimums, required verification, and one linked receipt per decision. | 170–210 | Medium: distinguish current floor from historical compatibility minimum |
| 2 | `templates/sync-from-upstream.yml:18–24`, `:52–70`, `:135–140`, `:195–201`, `:236–281`, `:312–337`, `:378–396`, `:582–590`, `:704–715` | Keep the decision table and short comments describing invariants. Move incident narratives into one linked sync learning. Preserve comments explaining non-obvious Git semantics. | 110–145 | Low if executable lines remain untouched |
| 3 | `skills/review-pr/SKILL.md:71–76`, `:131–136`, `:153–163`, `:177–184`, `:198–201`, `:339–362`, `:371–398` | Keep one recipe per operation. Collapse measured error stories to one-line receipts. Remove gotchas already enforced or explained beside commands. | 65–85 | Low; retain destructive-operation guards |
| 4 | `reference/dep-gates.md:348–470` | Keep package floor, exact runner artifact/name, copy/verification commands, and consumer-versus-package responsibility. Move version-by-version corruption history and failed predicate table into a learning. | 45–65 | Medium: runner packaging invariants must remain visible |
| 5 | `skills/api-changelog/SKILL.md:34–44`, `:78–83`, `:140–145`, `:170–182`, `:261–266` | Replace narrative warnings with direct constraints and one linked evidence line each. Example: “Loop over newline-separated versions with `while IFS= read -r`; zsh does not split `$VERSIONS`.” | 20–30 | Low |
| 6 | Root `CONCEPTS.md:24–57`, `:64–83` | Restore glossary scope: definition, key distinction, link. Move operational lease/replay/cache instructions to their existing learnings. | 15–25 | Low only if operative skill links remain |
| 7 | Root `README.md:53–65`; root `CLAUDE.md:13–37`, `:49–62` | One maintenance procedure, one reload warning, one learning-citation rule. | 10–15 | Low |

A concrete replacement for the competing API policy blocks could be:

> Existing extensions retain their major unless a migration is explicitly chosen. New extensions start on 2.x. Submit the version last exercised successfully in Raycast; npm’s newest version is advisory. A dependency bump requires another runtime exercise. Current targets and compatibility prerequisites are listed below; historical decisions are linked as evidence.

## 4. Followability problems, ranked

1. **Current dependency guidance cannot be identified by reading order.**  
   `dep-gates.md:32–74` contradicts itself before the table; later “SUPERSEDED” text points to a policy that itself conflicts with the table. This needs deletion of obsolete instructions, not another supersession paragraph.

2. **Owner mode arrives after most review decisions have already been made.**  
   `review-pr:288–311` requires reading the thread and trusted design contract, but appears after diff review, installation, runtime exercise, and reporting. Move ownership detection and thread intake into step 1. Keep posting mechanics near reporting.

3. **The shortest review instructions are less trustworthy than the long procedure.**  
   The gotchas’ fork-main diff recipe contradicts step 3. Condensed material must point to the canonical procedure rather than provide an alternative.

4. **Script enforcement is being added without retiring manual enforcement.**  
   Today adds `readme-assets`, but ship still has two grep procedures and the README reference has another. Fix script coverage, then use one gate result. Conversely, screenshot count and prohibited formats remain prose checks although they are deterministic.

5. **The review/submission boundary is mostly sound, but root routing overpromises.**  
   Root `README.md:27` says triggers do not overlap; its `ship` row owns “address review feedback,” while `raycast-pr-loop` owns automated feedback. `ship:34` supplies the missing routing rule. Put that distinction in the root table and trigger descriptions.

6. **`api-changelog` interleaves execution with lengthy interpretation warnings.**  
   Keep runnable preparation together, then interpretation rules. Its standalone fence at line 84 also disrupts the Markdown structure immediately before the next command block.

7. **The sync workflow’s headline guarantee is broader than its implementation.**  
   Readers must reach line 649 to discover the bookkeeping exception to “never pushes to main.” Put the qualified guarantee at the top.

8. **Today’s preference-copy addition repeats a lesson without improving enforcement.**  
   `develop:302–312` adds another imperative and receipt for rules already in House Style. The useful addition is the trigger to read fixed copy. Preference lengths and fixed logger text are mechanically checkable; the incident paragraph can become one linked receipt.

**Stacking assessment:** `review-pr` does not need to inherit ship’s full audit: that would impose submission work and personal conventions on inbound reviews. Build/lint/runtime checks in both flows are justified because they validate different work. Likewise, develop→ship validation should rerun after dependency or source changes; the redundant material is the explanation and competing procedure, not necessarily the execution.

## 5. Keep list

- **Review installation after dependency inspection** — `review-pr:145–151`, `:214–231`. The reminder belongs beside installation even when explained earlier.
- **Scratch collision refusal and guarded cleanup** — `review-pr:94–119`, `:344–366`. Creation and deletion have distinct failure modes.
- **Build before standalone TypeScript checking** — `review-pr:253–262`. Generated declarations make order consequential.
- **Trusted ownership/design sources and head revalidation** — `review-pr:290–305`, `:318–322`. These prevent reviewing against contributor-controlled policy or posting against an outdated revision.
- **Third-party convention boundary and Owner-mode exception.** They answer different questions; consolidate their explanation without erasing either.
- **Faker transport, storage, cache, and setup inventory** — `screenshots:29–49`. These are separate leak surfaces, not repeated versions of “scrub the API.”
- **Visual screenshot inspection plus mechanical checks** — `screenshots:127–133`. Dimensions and OCR cannot establish that an image is appropriate.
- **Artifact hierarchy and claim/inference table** — `api-changelog:24–48`, `:279–292`. These constrain conclusions, beyond merely prescribing commands.
- **Sync tree-truncation, hash, deletion, and lockfile protections.** They guard different failure classes. Compress their incident histories, not their checks.
- **No-op baseline persistence** — sync template `591–657`. It is necessary behavior; document its main-branch exception accurately.
- **Targeted learning triggers.** Preserve links at decision points when moving narratives out of operational files.

## 6. Coverage

| Cluster file | Coverage |
|---|---|
| `skills/review-pr/SKILL.md` | Read fully |
| `skills/api-changelog/SKILL.md` | Read fully |
| `skills/screenshots/SKILL.md` | Read fully |
| `reference/dep-gates.md` | Read fully |
| `reference/sparse-checkout-discipline.md` | Read fully |
| Root `CONCEPTS.md` | Read fully |
| Root `CLAUDE.md` | Read fully |
| Root `README.md` | Read fully |
| `templates/sync-from-upstream.yml` | Read fully |
| `scripts/setup-mirror.sh` | Read fully |

Also read the supplied inventory and complete supplied diff; inspected preflight implementation and targeted portions of its tests, related skills/references, manifests, CI, reference checker, and pre-push hook.

No cluster files were left unread. External claims about Raycast, npm, GitHub, and faker behavior were not refreshed because network use was prohibited. Workflow execution and cross-repository calibration were not performed.

Validation limitations: preflight fixture tests were blocked by sandbox `EPERM`; Git status completed despite Darwin temporary/cache warnings. Neither is a finding. No network commands or npm were run.


