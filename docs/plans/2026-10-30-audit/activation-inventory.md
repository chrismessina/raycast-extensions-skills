# Activation inventory (Phase 9 step 4), 2026-11-15

This inventory compares the live checkout `~/Developer/GitHub/chrismessina/raycast-extensions-skills` (branch `main`, HEAD `c962469`) with the Phase 0 checkpoint (`aa3f4c3`, 2026-10-30) and with what the harness has carried since then. The harness forked from `81326b0`. Its Wave 13 sync (`7bef479`, 2026-11-09 12:50 -0800) carried every live change up to that time. This inventory therefore turns on what changed after the sync.

## Live commits since the fork

| Commit | Date | What | In the harness? |
|---|---|---|---|
| `2f3503f` | 2026-11-02 | Learnings: drifted Greptile rules, list-detail toggle | Yes. `7bef479` carried it, rewritten for `rx greptile`. |
| `6e92513` | 2026-11-04 | Kit 0.3.0 floor, kit at write time, wide accessories | Yes. `7bef479` carried it. |
| `c962469` | 2026-11-11 | `screenshots`: extensions that get their data from a CLI | **No.** It also cites `/Users/messina/…/raycast-faker/dist/cli.js`, which the harness's `home-paths` check rejects. It needs a `~/` path when it is carried over. |

## Live uncommitted files

There are 16 `git status` entries, 26 files in all.
- **Seventeen files last changed on 2026-10-30 or 2026-10-31.** They are the checkpoint's own content, committed as `aa3f4c3` and rewritten since. They include `docs/plans/`, `greptile-drift.*`, `preflight.*`, `readme-template.md`, `CLAUDE.md`, `githooks/pre-push`, `check-references.yml` and the Instagram learning.
- **Seven files last changed on 2026-11-02 or 2026-11-04.** These are `greptile-rules.md`, `reference/greptile/*`, `raycast-pr-loop/SKILL.md` and `develop/SKILL.md`, and `7bef479` carried them.
- **Two files changed after the sync.**

**`skills/ship/SKILL.md`** (modified 2026-11-10 23:20). Its diff against live `main`, hunk by hunk:

| Hunk | In the harness? |
|---|---|
| The 2026-11-03 AGENTS.md / CONCEPTS.md ruling | Yes, enforced by the preset holdout, `stale-remove` and the audit. |
| LICENSE kept in the mirror; the badge links it by absolute URL | Yes (`ship/SKILL.md`, `reference/readme-template.md`). |
| Raycast's PR checklist copied verbatim (#32975) | Yes (`reference/pr-and-cleanup.md`). |
| A file the fork already tracks ships whatever `.gitignore` says | Yes (`ship/SKILL.md`). |
| "Edits were made on your PR" also fires after a merge (stale `ext/<name>` branch) | Yes (`reference/pr-and-cleanup.md:149`, `rx contributions`). |
| A URL-encoded `metadata%2F` README link | Yes, in rx: `src/preflight/markdown.mjs:239` decodes targets before `readme-assets` judges them. |
| `greptile-drift` steps | Superseded by `rx greptile` and the gates `greptile-rules` step. |
| A "SUPERSEDED" history callout | Dropped on purpose (`ci.mjs` `markers`). |
| **A gitignored local folder alone makes `ray` report contributions** (day-one #33409, 2026-11-11). The tell, and the fix: hold the folder out, re-publish, restore. | **No.** |
| "Which side contains the other" before resolving a `pull-contributions` conflict (#32975) | Yes, in rx: `rx contributions` reports `OURS-SAFE` when the incoming side equals the published copy or its CHANGELOG is contained in ours (`ship/SKILL.md`, Submission, step 3). The first pass of this inventory missed it. |
| "Moving a tracked file leaves a deletion, and `publish` refuses a dirty tree" | Covered: `rx holdout` never moves a tracked file, and ship says a file leaves a PR by a committed deletion. |
| An `agent-scaffolding` or `dev-material` WARN is answered by step 3 | Covered differently: the preset and holdout decide what ships. No port needed. |

**`docs/reference/raycast-api-changelog.md`** (modified 2026-11-12). The live copy has 2.12.0, 2.11.1, 2.11.0 and 2.10.1 entries. The harness wrote its own 2.11.0 and 2.10.1 in Phase 8 (`ce38165`), so the two copies conflict there. **Not in the harness.**

## Proposed reconciliation (for Chris's approval, step 5)

1. **Port the three changes the harness lacks into `harness`, in its form, before the squash:**
   - `c962469`, with the faker path written as `~/Developer/GitHub/chrismessina/raycast-faker/dist/cli.js`;
   - the one `ship` hunk marked **No** (day-one #33409), added to the contributions known failure in `ship/SKILL.md`;
   - the live api-changelog file, verbatim. Its 2.11.0 entry replaces the harness's own Phase 8 write-up: it is the later derivation and also covers 2.11.1 and 2.12.0. A three-way merge from `81326b0`, resolved to the live side, gives the same bytes.
2. **Back up the live uncommitted files before activation.** Every one is then either in the harness or superseded by it. A tarball of the 26 files goes into the scratchpad; nothing in the live tree is deleted without that backup.
3. **Then step 5:** squash `harness` onto live `main` in a clean release worktree, activate, and verify.
