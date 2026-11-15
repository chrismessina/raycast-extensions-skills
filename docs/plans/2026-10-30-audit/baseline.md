# Phase 0 baseline — `$SKILLS` on 2026-10-30, before the `harness` checkpoint

Recorded by Phase 0 steps 1–3 of `../2026-10-30-raycast-harness.md`. Everything below is raw command output from `~/Developer/GitHub/chrismessina/raycast-extensions-skills` at HEAD `81326b06e80c1ddb78751a3d124afc8e0c85e6b6` (`main`).

## 1. `git status --short` (step 1)

SHA-256 of the saved listing: `f068ef221ce4a9f5d8e163a9c37fd34f69262797f99ead381335a81031701065`

```
 M .github/workflows/check-references.yml
 M CLAUDE.md
 M githooks/pre-push
 M plugins/raycast-extensions/reference/greptile-rules.md
 M plugins/raycast-extensions/reference/readme-template.md
 M plugins/raycast-extensions/scripts/preflight.mjs
 M plugins/raycast-extensions/scripts/preflight.test.mjs
 M plugins/raycast-extensions/skills/develop/SKILL.md
 M plugins/raycast-extensions/skills/raycast-pr-loop/SKILL.md
 M plugins/raycast-extensions/skills/ship/SKILL.md
?? docs/plans/
?? plugins/raycast-extensions/learnings/tooling-decisions/reading-instagram-media-from-the-browser-tab-in-2026.md
?? plugins/raycast-extensions/reference/greptile/
?? plugins/raycast-extensions/scripts/greptile-drift.mjs
?? plugins/raycast-extensions/scripts/greptile-drift.test.mjs
```

Step 4 inventory (what the checkpoint cannot capture):

```
$ git diff --cached --name-only                       # separately staged versions
(empty)
$ git ls-files -ci --exclude-standard                 # ignored files that are tracked
(empty)
$ git ls-files -o -i --exclude-standard --directory   # ignored untracked files add -A would skip
(empty)
$ shasum -a 256 .git/index
3655353b9bf2ef5e07a93c6aa955c445b84d2acea209d4e2be568d7b1741ba82  .git/index
```

## 2. Tests and check-references (step 2)

```
$ node --test plugins/raycast-extensions/scripts/*.test.mjs
1..60
# tests 60
# suites 0
# pass 60
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 1577.211375
EXIT=0
```

```
$ bash check-references.sh
[... every reference, learning and skill: ok ...]
Checking relative Markdown links resolve

  BROKEN   docs/plans/2026-10-30-audit/plan-review-2.md:3  docs/plans/2026-10-30-raycast-harness.md

FAIL: see MISSING / UNLISTED / VERSION MISMATCH / ORPHAN / BROKEN above.
EXIT=1
```

The one failure is pre-existing and lives in the plan's own inputs: `plan-review-2.md:3` links `docs/plans/2026-10-30-raycast-harness.md` relative to its own directory, so it resolves to `docs/plans/2026-10-30-audit/docs/plans/…`. The correct relative target is `../2026-10-30-raycast-harness.md`. Fix on `harness` (Phase 5.11 or earlier), not in `$SKILLS`.

## 3. Line counts (step 3)

```
$ wc -l plugins/raycast-extensions/skills/*/SKILL.md
 303 api-changelog/SKILL.md
 522 develop/SKILL.md
 426 raycast-pr-loop/SKILL.md
 398 review-pr/SKILL.md
 196 scaffold/SKILL.md
 151 screenshots/SKILL.md
1698 ship/SKILL.md
3694 total

$ wc -l plugins/raycast-extensions/reference/*.md
 512 dep-gates.md
 152 greptile-rules.md
2000 house-style.md
 307 keyboard-conventions.md
  82 pr-and-cleanup.md
 301 readme-template.md
 127 sparse-checkout-discipline.md
 141 store-guidelines.md
3622 total
```

Phase 5 budgets for comparison: ship ≤ 450, develop ≤ 300, raycast-pr-loop ≤ 220, review-pr ≤ 260, scaffold ≤ 220, api-changelog ≤ 220, screenshots ≤ 160.

## 4. Legacy preflight check IDs (step 3)

Derived from `plugins/raycast-extensions/scripts/preflight.mjs` at this baseline: every literal first argument to `add(id, …)` plus the four heuristic IDs emitted through the `heuristics` table (the only non-literal `add()` call, line 651). 23 + 4 = 27, as §4.1 states.

```
$ rg -o 'add\(\s*"([a-z][a-z0-9-]*)"' -r '$1' plugins/raycast-extensions/scripts/preflight.mjs | sort -u
agent-scaffolding
categories
changelog-exists
changelog-order
changelog-updated
command-renamed
dev-material
eslint-config
generated-files
hand-typed-preferences
lockfile
native-fetch
npm-registry
package-json
platforms
preference-type
prettierrc
readme-assets
schema
screenshots
shortcut-platform-case
title-case
unused-dependencies
(23)

heuristics table (warn-only): launch-command, favicon, trash, localization
```

Live sample, `raycast-brew` without `--published` (`--json` lists only fail/warn findings; the legacy script has no PASS or N/A lines, which is what §1 changes):

```
$ cd ~/Developer/GitHub/chrismessina/raycast-brew && node <plugin>/scripts/preflight.mjs --json
[ { "id": "categories", "level": "fail", ... },
  { "id": "changelog-order", "level": "fail", "message": "dates must descend: 2024-06-14 is above 2024-07-03" },
  { "id": "agent-scaffolding", "level": "warn", "message": "agent or planning files present (...): TODO.md" },
  { "id": "dev-material", "level": "warn", ... } ]
```
