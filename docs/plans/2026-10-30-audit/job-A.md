The main problem is duplicated procedure with diverging behavior. `ship` repeats its preflight as a second checklist, while references retain older submission mechanics. Today’s superset shortcut also risks discarding real contributions.

No files edited. No network or npm commands run.

Paths below are relative to `plugins/raycast-extensions/`.

## 1. Correctness findings

### P1 — CHANGELOG containment cannot authorize discarding every conflict

**Locations:** `skills/ship/SKILL.md:1507–1515`.

The new test establishes that incoming CHANGELOG sections are already present locally, then instructs the agent to take ours for **every conflicted file**.

A contributor can fix `src/download.ts` without changing the CHANGELOG. Their CHANGELOG passes the containment test; taking ours discards their source fix. After staging those resolutions, an empty `git diff --cached HEAD` merely confirms that the agent discarded everything—it does not prove that nothing valuable arrived.

**Fix:** Limit the CHANGELOG containment conclusion to `CHANGELOG.md`. Decide each other conflict from that file’s incoming content and provenance. An all-files shortcut needs proof covering all affected files.

### P1 — zsh silently disables the published-baseline checks

**Locations:** `skills/ship/SKILL.md:540`; `scripts/preflight.mjs:487–490`.

This invocation:

```sh
node "<plugin>/scripts/preflight.mjs" ${PUB_DIR:+--published "$PUB_DIR"}
```

passes one combined argument in zsh. A local probe returned:

```text
zsh: [ '--published /tmp/published' ]
bash: [ '--published', '/tmp/published' ]
```

The script recognizes only an argument exactly equal to `--published` and silently ignores unknown arguments. Consequently, zsh skips `changelog-updated` and `command-renamed`.

**Fix:** Use an explicit `if` with two literal invocations, or a shell-compatible argument array. Reject unknown CLI arguments so this cannot silently degrade.

### P1 — Reply-only review rounds are prohibited by the publishing prerequisite

**Contradictory locations:** `skills/raycast-pr-loop/SKILL.md:162–185`, `226–230`, versus `268–272`.

False-positive findings require no code changes, and reply-only rounds explicitly count toward the round bound. But step 6 allows a reply only after successful publication **and a changed remote head**.

For a round containing only invalid findings, the agent must either remain silent or manufacture a revision to earn permission to reply.

**Fix:** Require a changed remote head for replies claiming a newly published fix. Allow receipt-backed declines against the existing head without republishing.

### P2 — The new superset commands do not work from the supported monorepo extension directory

**Locations:** `skills/ship/SKILL.md:1502–1509`; supported context at `1418–1426`.

`git ls-tree -r --name-only MERGE_HEAD` enumerates the repository tree, while `$PUB_DIR` contains just the extension. The comparison consequently constructs paths such as:

```text
$PUB_DIR/extensions/<name>/src/index.ts
```

The CHANGELOG commands also address repository-root `CHANGELOG.md`, rather than the extension’s file. Missing Git objects inside process substitutions can leave `comm` printing nothing, which the instructions present as positive evidence.

**Fix:** Scope the tree comparison to the extension subtree, use extension-relative object paths, and check extraction success and nonempty heading sets before comparing. Check both file inventories before claiming exact equality.

### P2 — The new README check misses ordinary image syntax

**Locations:** `scripts/preflight.mjs:394–403`; `scripts/preflight.test.mjs:141–149`.

Read-only probes of the exact expressions showed these prohibited embeds passing:

```md
![shot](<metadata/shot.png>)

![shot][s]
[s]: metadata/shot.png
```

This valid HTML also passes:

```html
<img src = "metadata/shot.png">
```

URL decoding correctly catches today’s `metadata%2F...` case, but does not make the extractor a complete Markdown/HTML image check.

**Fix:** Cover angle-bracket destinations, reference images, and attribute whitespace. Add cases for each before replacing the manual check with unconditional script assurance.

### P2 — The new README check rejects examples inside code fences

**Locations:** `scripts/preflight.mjs:394–406`; `scripts/preflight.test.mjs:147–148`.

A README explaining the prohibited form using a fenced Markdown example receives a blocking `readme-assets` failure. The test comment mentions code blocks, but its assertion tests only prose containing a folder name.

**Fix:** Exclude fenced and inline code from embed extraction, preserving real rendered images. Add an actual fenced-example regression case.

### P2 — The final gate changes report-only findings into blockers

**Contradictory locations:** `skills/ship/SKILL.md:649–655` versus `1011–1012`; `reference/house-style.md:1915–1918`, `1928–1934`, `1951–1953`.

The procedure permits report-only failures, while the final checklist requires the house-style audit to have “zero violations.” An agent following the later hard gate can block submission for an explicitly nonblocking item.

There is another unresolved precedence case: `no-hand-preferences` is report-only in `house-style.md:1928`, but blocks through `scripts/preflight.mjs:454–460` and ship’s “Any FAIL blocks” instruction at `543`.

**Fix:** Say “zero blocking failures; report-only findings recorded.” Make the matrix explicitly defer overlapping Store blockers to preflight, or align their levels.

### P2 — Typechecking first can reject a valid fresh checkout

**Contradictory locations:** `skills/ship/SKILL.md:548–552`, `572`; `skills/raycast-pr-loop/SKILL.md:239`; versus `skills/review-pr/SKILL.md:252–262`.

The submission commands put `tsc` before build, including an `&&` chain that never reaches build when generated ambient types are absent. The review skill already explains that build generates `raycast-env.d.ts` and must run first.

**Fix:** Use build → typecheck → lint consistently where generation may be needed. Preserve the separate typecheck requirement.

### P2 — README success checks abort under the earlier strict-shell setup

**Locations:** `skills/ship/SKILL.md:109`, `812–818`, `1030–1036`.

The staleness procedure enables `set -euo pipefail`. Later bare greps are supposed to return no matches. Their successful outcome therefore exits 1 and terminates the shell before the remaining checks run.

**Fix:** Replace the duplicate greps with the corrected preflight check. Any remaining negative grep assertion should explicitly distinguish no matches, matches, and operational failure.

### P2 — CHANGELOG reconstruction assumes an exact shared heading that may not exist

**Locations:** `skills/ship/SKILL.md:1528–1543`.

The explanation says ours may retain `{PR_MERGE_DATE}` where theirs carries the stamped date. The Python reconstruction then searches ours for the **entire incoming heading**, including that date:

```python
head.index(marker)
```

That raises `ValueError` for the very unstamped/stamped case described. It also fails when a real contribution adds an incoming top heading absent from ours.

**Fix:** Establish and validate the shared entry boundary explicitly; do not assume their first complete heading exists verbatim in ours. Stop with a meaningful diagnostic when no unambiguous boundary exists.

### P2 — The cleanup reference still describes the retired submission route

**Contradictory locations:** `reference/pr-and-cleanup.md:54–60`, `70–79`; versus `skills/ship/SKILL.md:1307–1332`, `1622–1626`.

The reference prescribes manual PR creation, a `fork` remote, `update/<name>-<topic>` branches, and a feature branch already fast-forwarded into local `main`. The active route requires none of those conditions and uses `ray publish`.

Following the reference after a normal publish can target the wrong branch or fail to clean up anything. Its literal `.git/pr-body.md` recommendation at `24–25` also contradicts ship’s monorepo-safe resolution at `1154–1158`.

**Fix:** Remove the retired route from the active reference. Discover the actual PR head and repository; do not assume local integration or remote names. Use `git rev-parse --git-path`.

### P2 — API-version prose promises failure behavior the commands do not implement

**Contradictory locations:** `skills/ship/SKILL.md:609–627` versus `630–638`.

The text says npm unreachability always aborts. Without strict shell settings, empty `TARGET` is expressly allowed and a version above the floor passes. With inherited `set -euo pipefail`, an npm failure can instead terminate before advisory handling.

The last-minute rerun explanation also treats npm currency as a changing acceptance bar, although the actual blocking comparison uses a fixed floor.

**Fix:** Keep one contract: installed version below floor blocks; npm freshness is advisory. Handle advisory lookup failure explicitly and delete the obsolete currency rationale.

### P2 — The relative-link gate excludes common relative links

**Locations:** `skills/ship/SKILL.md:858–875`.

The stated assertion covers every shipping relative link, but the regex requires `./` or `../`. Common links such as `[Guide](docs/guide.md)` and `[License](LICENSE)` are invisible. The `docs/**/*.md` operand also depends on shell glob behavior and can fail when no matching directory exists.

**Fix:** Use an explicit file inventory and resolve all supported relative destinations from each source file. Until then, describe this as a partial check, not proof that all links resolve.

### P2 — Preflight does not fully enforce the documented CHANGELOG gate

**Locations:** `scripts/preflight.mjs:270–293`; `reference/greptile-rules.md:32`, `37`; `skills/ship/SKILL.md:889–907`, `914–928`.

The script rejects multiple or misplaced placeholders but accepts **zero** placeholders. With `--published`, a different hardcoded top heading passes `changelog-updated`. An empty CHANGELOG also escapes these checks. It does not compare preserved history.

**Fix:** Before shortening the manual gate, enforce a valid new top placeholder entry and the intended published-history invariant. Keep the privacy-redaction exception at ship `53–54`.

## 2. Redundancy map

Locations are the duplicates identified in the inspected scope.

| Rule | Locations | Canonical home | Action for the others |
|---|---|---|---|
| README image placement | ship `798–850`, `1030–1037`; preflight `389–406` | Corrected preflight implementation; brief folder policy in ship | Delete both grep blocks and fleet-sweep command; retain one pointer and remediation sentence |
| Screenshot dimensions | ship `418`, `851–857`, `1044–1045`; preflight `377–386`; greptile `33` | Preflight for PNG dimensions | Replace manual screenshot-size commands with pointer; retain icon check separately |
| Screenshot count | ship `438–439`, `797`, `1101` | Preflight after adding count check | Until implemented, keep one manual assertion; other locations become pointers |
| CHANGELOG placeholder/date rules | ship `880–928`, `1020–1022`; house-style `1831–1851`; greptile `32`, `37`; preflight `270–293` | Preflight for mechanics; house-style for authoring | Strengthen code first; remove duplicate commands afterward; retain bot-stamp exception |
| Typecheck/build/lint | ship `548–552`, `570–576`, `1002–1004`, `1552–1554`; loop `152–156`, `239`; house-style `138–168`, `1931`; review-pr `250–262` | One shared verification procedure | Skill call sites state when results become stale and point to procedure |
| AGENTS/CONCEPTS verification | ship `668–749`, `1093–1100` | Referenced `verify-agents-md` procedure, if available | Ship retains applicability, handoff and required evidence; delete copied procedure |
| PR titles | ship `1122`; pr-and-cleanup `3–11` | pr-and-cleanup | Ship keeps one pointer |
| PR-body transport/checklist/draft policy | ship `1150–1273`; pr-and-cleanup `13–63` | One PR-body procedure in pr-and-cleanup | Ship calls it; remove older manual-create instructions and static checklist |
| Publish copy/stage behavior | ship `56–60`, `1334–1358`, `1599–1607`; loop `247–252` | Submission’s “What ships” explanation | Other locations point there; retain their distinct scan/holdout obligations |
| Secret holdout | ship `1479–1489`; loop `242–263` | Shared submission-safety reference | Both skills call it; eliminate ship → loop → ship dependency |
| Bot-stamped date false positive | ship `914–928`; loop `162–174` | Loop’s triage procedure | Ship retains one-line exception and pointer |
| Measure implied remedies | ship `25–26`, `32`; loop `119–120`, `157–161` | Existing learning | Delete ship `32`; keep trigger-table pointers |
| Post-merge branch cleanup | ship `1618–1640`; pr-and-cleanup `65–82` | Updated pr-and-cleanup | Ship retains ordered high-level call, including CHANGELOG reconciliation |

## 3. Simplification proposals

Estimates concern active instructions removed or replaced. Moving evidence preserves it elsewhere; overlapping estimates are not additive.

| Rank | Location | Concrete proposal | Approx. lines saved | Risk |
|---|---|---|---:|---|
| 1 | ship `979–1112` | Replace the repeated hard-gate checklist with a short results contract: “Before any public write, record gate −2, freshness, preflight FAIL/WARN dispositions, verification results, blocking house-style results, weeding, and compliance. Link the evidence; do not rerun unchanged checks merely to populate this summary.” Move unique privacy exceptions into their owning procedure first. | 85–105 | Medium: some unique requirements currently exist only here |
| 2 | ship `280–464` | Retain one decoded-pixel/provenance procedure. Remove the preliminary `sips` hash loop, its verdict table, and the explanation that it cannot decide the comparison. Move detailed optimization measurements and incidents to a linked learning. | 85–115 | Low–medium: retain bit-depth/color-metadata limits and provenance decisions |
| 3 | ship `1124–1305`; pr-and-cleanup `13–63` | Consolidate PR-body work into one reference: fetch template → resolve body path → verify PR identity/state → preview/apply through helper → report. Move helper transport/concurrency internals and draft-flip incidents into linked supporting material. | 95–125 | Medium: preserve edit protection and draft-state guards |
| 4 | ship `668–749`, `1093–1100` | Replace with: “Self-authored only: run `verify-agents-md` against AGENTS/CONCEPTS; verify paths, scripts, symbols, machine paths and changed behavioral claims. Record results. Documentation edits remain inside adversarial review.” Keep one incident sentence plus evidence link. | 65–75 | Medium: confirm the external skill is actually available |
| 5 | ship `798–850`, `1030–1037`, `851–857` | After scanner fixes: “Preflight checks README image locations and screenshot dimensions. Put documentation images in `media/`; keep runtime assets in `assets/`. Verify the manifest icon is 512×512 separately.” Move fleet debt and incidents out. | 55–65 | Medium until parser coverage improves |
| 6 | ship `578–647` | Put the API-floor implementation beside the dependency policy. Ship needs: “Installed API must meet dep-gates’ floor. Do not cross majors here. Any bump requires exercising that version and rerunning verification. npm’s latest is advisory.” Preserve one incident link. | 45–55 | Low |
| 7 | loop `296–380` | Keep the bounded waiting decision and one working single-shot implementation. Move historical watcher failures, webhook installation digression, conditional-request quota arithmetic and stale-bot policy detail to supporting reference material. | 35–50 | Low: retain revision freshness and both wait bounds |
| 8 | ship `1455–1560` | Replace the linear failure narrative with a decision table: no merge → restore/retry; verified redundant incoming file → retain local; real contribution → reconcile per file; unresolved provenance → stop. Put validated recovery commands in a reference. | 30–45 | High until the superset/rebuild defects are fixed |
| 9 | pr-and-cleanup `45–82` | Delete retired manual-submission mechanics; retain transport-failure handling and cleanup against discovered PR head information. | 20–30 | Low |
| 10 | store-guidelines `3–14`, `68–74`, `88–98`, `130–141` | State live-source precedence once. Combine blocker list and signal table into one table: signal, authoritative source, required decision. Keep one sentence per incident with evidence link. | 20–30 | Low |

The best immediate cut is duplication around the script, **not the judgment gates**. Preflight already handles schema, category membership, platform names, preference types, screenshot PNG dimensions, selected configuration rules and selected source patterns. Its WARN checks remain heuristics.

These cannot yet shrink to “preflight passed”:

- CHANGELOG placeholder presence and historical preservation.
- Screenshot count, appearance/frame checks and current content.
- Icon dimensions.
- README link validity.
- LICENSE existence and intended document contents.
- Publish payload privacy.
- Runtime behavior and destination evidence.

## 4. Followability problems, ranked

1. **There are two preflights with different acceptance conditions.** Ship `36–977` gives procedure; `979–1112` repeats it with stronger or additional requirements. Keep one executable procedure and one concise evidence summary.

2. **The publication boundary runs through several distant sections.** Privacy is at `40`, holding files out is in another skill, publish-copy semantics are at `1334`, and final PR inspection is at `1609`. Group these into one submission sequence with explicit before/after steps.

3. **Freshness requires reading hundreds of lines before reaching preflight.** Ship `98–528` mixes ordinary baseline comparison, PNG analysis, screenshot CI and mirror health. Make ordinary freshness the main path; dispatch asset and mirror cases to conditional references.

4. **Recovery assumes facts before proving them.** “Same two conflicts every time” at ship `1455` and the CHANGELOG table at `1523` encourage classification by filename. Start with incoming-content provenance; filenames only select the reconciliation method.

5. **Gate order creates avoidable reruns.** Ship verifies at `548`, then changes dependencies at `553–628`, requiring verification again. Use an early diagnostic pass only when useful; place release verification after dependency/configuration changes. Preserve reruns after subsequent mutations.

6. **The ship/loop seam has a circular procedure dependency.** Ship delegates holdout to loop; loop delegates publication and contribution recovery back to ship. A shared reference removes the cycle.

7. **Automated feedback routing is underspecified across skills.** Ship’s description claims the review cycle, its opening delegates to loop, and loop directly fixes small code findings while ship always hands code back to develop. State explicitly that loop owns orchestration and invokes develop-grade implementation, then returns to submission gates.

8. **Optional dependencies on external skills lack an availability path.** `verify-agents-md` and `codex-gate` carry important obligations but are outside this plugin’s inventory. Give their existing contracts a clear local entry point or identify what evidence the caller must supply; avoid copying their full procedures.

9. **The new checklist callout follows the template that needs it.** Ship `1171–1184` is directionally correct: fetch the live checklist. Put that action before body construction so the agent never drafts from the obsolete replacement block.

## 5. Keep list

- **Freshness at both develop entry and publication:** they protect different moments. Share implementation; retain both checkpoints.
- **Separate build, typecheck and lint:** they test different properties. Fix order, preserve all three.
- **Reverification after dependencies or merge resolution change:** an earlier green applies to an earlier tree.
- **Published/local pixel comparison plus provenance:** byte differences alone cannot distinguish recompression from replaced artwork.
- **PNG bit-depth and color-metadata limitations:** removing these would overstate the comparator’s certainty.
- **Copy-versus-stage explanation:** `.gitignore` and `.git/info/exclude` have materially different publication effects.
- **Holdout inventory and verified restoration:** checking a remembered subset cannot establish recovery.
- **User-example scanning across contents, filenames, messages and public prose:** those are distinct disclosure surfaces.
- **Self-authored/fork distinctions and named TODO exceptions:** these preserve explicit ownership decisions; compact them into one applicability table.
- **PR-body edit preservation and uncertain-write handling:** user edits can otherwise disappear despite a successful command.
- **Draft-state ownership and current-head review freshness:** retain clear guards at the actual action points.
- **Human-speed concurrency model:** the autonomous-trigger exception prevents it from dismissing real races.
- **Three-round and no-re-review bounds:** one limits repeated changes; the other limits waiting.
- **Live Store-source precedence:** mechanical checks do not establish compliance with evolving policy.
- **Runtime and destination evidence:** deterministic checks cannot prove clipboard contents, saved-file behavior or visible UI.

## 6. Coverage

| Cluster A file | Coverage |
|---|---|
| `skills/ship/SKILL.md` | Read fully |
| `skills/raycast-pr-loop/SKILL.md` | Read fully |
| `reference/pr-and-cleanup.md` | Read fully |
| `reference/store-guidelines.md` | Read fully |
| `reference/greptile-rules.md` | Read fully |
| `scripts/preflight.mjs` | Read fully |
| `scripts/preflight.test.mjs` | Read fully |

Also inspected the supplied inventory and full supplied diff, `CLAUDE.md`, relevant house-style sections/matrix, develop’s freshness procedure, and targeted scaffold/review-pr handoffs. Other inventory files and upstream Raycast implementations were not independently reviewed; current external claims were not verified without network access.

The permitted test command produced **1 pass and 39 fixture-creation failures (`EPERM`, read-only sandbox)**; this is an environment limitation, not a finding. A heredoc probe was similarly blocked and replaced with a read-only inline probe. Git status succeeded despite sandbox cache warnings and showed the four supplied modified files. I made no edits.


