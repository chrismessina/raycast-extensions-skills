# PR prep & post-merge cleanup

The one PR-body procedure for a Store PR that `ray publish` opened, and the sweep after it merges.
`<plugin>` below is the plugin root, two levels above a skill's base directory; every `rx` call
goes through the runner `"<plugin>/scripts/rx.mjs"` (for example `node "<plugin>/scripts/rx.mjs" stale --json`), which exits 0 (PASS/WARN/N/A), 1 (a FAIL) or 2 (an
ERROR) and prints one `VERDICT  check-id  message` line per check.

## PR title

- **Update:** `Update <Title> extension` (default: several changes, none dominant).
- **Single dominant fix:** `[<Title>] <short fix>`.
- **New extension:** `Add <Title> extension`.
- **No Conventional Commits.** Raycast does not use them for extension PRs.

Verified examples: `Add bookface extension` (#28614, initial), `Update Bookface extension`
(#28961, v1.1).

## PR body

`ray publish` opens the PR as a **draft whose body is Raycast's PR template**. Draft the body from
the real diff and post it so Chris reviews prose instead of composing it; **the PR stays a draft.**
Clicking "Ready for review" submits it to Raycast's reviewers, an outward action Chris takes after
reading the body. The plugin's guard blocks any Bash command that mentions marking a PR ready.

1. **Ground the body in what changed, never in session memory.** Read the CHANGELOG's top
   (unreleased) entry, the commits since the publish tag, and the PR's own file list:

   ```bash
   PR=<N>                                     # the PR number ray printed
   EXT="$(jq -r .name package.json)"
   awk '/^##/{n++} n==1' CHANGELOG.md
   T="__raycast_latest_publish_ext/${EXT}__"   # ray's own tag; absent → all history, as ray logs it
   if git rev-parse -q --verify "refs/tags/$T" >/dev/null; then git log --oneline "$T..HEAD"; else git log --oneline; fi
   node "<plugin>/scripts/rx.mjs" pr files "$PR" --extension "$EXT"
   ```

   If the CHANGELOG's top entry and the diff disagree, **the diff wins**, and say so in the
   report: a CHANGELOG that misdescribes the change is itself a review finding.

2. **Write the body to a file outside the payload**, resolved through git: `.git/` is a directory
   only at the repo root, and in a monorepo extension directory a literal `.git/pr-body.md` fails
   with "no such file or directory" (verified 2026-07-29).

   ```bash
   BODY="$(git rev-parse --git-path pr-body.md)"   # never tracked, never copied by ray
   gh api repos/raycast/extensions/contents/.github/pull_request_template.md --jq .content \
     | base64 -d | sed -n '/## Checklist/,$p' > "$(git rev-parse --git-path pr-checklist.md)"
   ```

   Shape: `## Description` (2–4 sentences, the user-visible effect first), `### Changes` (one bullet
   per CHANGELOG entry, rewritten for a reviewer who has never seen the code), then **Raycast's
   `## Checklist` verbatim** from the file above, then two of ours: `I ran npm run lint and
   npx tsc --noEmit, both clean` and `I updated CHANGELOG.md per the changelog conventions`.
   `rx pr body` in `--initial` mode refuses a body whose checklist does not contain Raycast's template
   checklist verbatim, because `--initial` replaces the template body and a hand-written checklist
   silently drops their items (video-downloader #32975, 2026-10-30: the first post replaced their
   five items with our six; restored with a splice before anyone reviewed it).

   **Every box ships unticked, and a box is ticked only after naming the run that earned it.** A
   pre-ticked block is a public claim in Chris's name that nobody verified. The build/lint/tsc
   boxes are earned by the `rx gates` receipt of this session; "I tested this build in Raycast" is
   a claim only Chris can make, so leave it to him and say so in the report.

3. **Verify the PR before mutating it.** `$PR` is a number copied by hand into a repo with
   thousands of open PRs; a typo targets a stranger's PR and the body you post is public.

   ```bash
   EXT="$(jq -r .name package.json)"
   node "<plugin>/scripts/rx.mjs" pr verify "$PR" --author "$AUTHOR" --extension "$EXT"
   ```

   `pr-author`, `pr-head` (`ext/<name>`), `pr-open` and `pr-base` (`raycast/extensions:main`) must
   PASS, or STOP. `pr-draft` must PASS for the **first** body post (`--initial` goes onto a draft);
   a FAIL there means the PR is already submitted: do not post; tell Chris and let him decide. On a
   later splice or a re-publish to a PR Chris already marked ready, `pr-draft` FAIL is the normal
   state: run the timeline attribution query (*If the draft state changed* in `ship`), continue when
   he flipped it, STOP only when you cannot attribute it. `pr-base` FAIL means `ray publish` opened the PR against the
   fork's `main` and the diff balloons to hundreds of files (cursors #29493, 2026-07-17, 143 files):
   retarget the base branch with `gh api -X PATCH "repos/raycast/extensions/pulls/$PR" -f base=main`,
   never by resetting fork `main`, then re-run `pr verify` and `pr files`. Full write-up:
   [`raycast-store-pr-base-diverged-fork-main`](../learnings/workflow-issues/raycast-store-pr-base-diverged-fork-main.md).

4. **Scan the exact bytes you are about to send** with the examples gate's forbidden list
   (`ship` step −2); GitHub keeps every revision of a body in its edit history, so a forbidden
   value is public the moment it is posted. `rx pr body` takes no forbidden list, so this runs
   before **every** write: on the first post over `$BODY`; on every later splice over the **whole
   composed body**, which the dry run writes with `--prospective <file>` (the exact bytes a later
   `--apply` sends, so a value already in the live body that has since become forbidden is caught
   too; a diff would show only the changed lines). Pass the same `--prospective <file>` to the
   `--apply` run: it refuses (`pr-body-write` FAIL, nothing written) unless the body it composes
   now equals the scanned file byte for byte, so an edit Chris makes between the scan and the
   apply can never ship unscanned bytes. Keep the file outside the extension root:

   ```bash
   node "<plugin>/scripts/rx.mjs" scan --forbidden "$SCRATCHPAD/forbidden.txt" --pr-text "$BODY"
   node "<plugin>/scripts/rx.mjs" pr body "$PR" --splice edits.json --prospective "$WORK/prospective.md"
   node "<plugin>/scripts/rx.mjs" scan --forbidden "$SCRATCHPAD/forbidden.txt" --pr-text "$WORK/prospective.md"
   ```

   (`$WORK` is the `mktemp -d` directory from `ship`'s publish sequence, outside the extension root.)

5. **Post through `rx pr body`, and never PATCH a whole body from a local file.** Once the draft
   exists Chris edits it by hand: he uploads a screenshot and ticks the boxes only he can tick. A
   whole-body PATCH from your copy discards all of that without an error (brew #31534, 2026-09-24:
   two follow-up updates overwrote his uploaded screenshot and all five ticked boxes).

   ```bash
   node "<plugin>/scripts/rx.mjs" pr body "$PR" --initial "$BODY"            # dry run: prints the diff
   node "<plugin>/scripts/rx.mjs" pr body "$PR" --initial "$BODY" --apply
   node "<plugin>/scripts/rx.mjs" pr body "$PR" --splice edits.json --prospective "$WORK/prospective.md"   # every later update: dry run, then scan the file (step 4)
   node "<plugin>/scripts/rx.mjs" pr body "$PR" --splice edits.json --prospective "$WORK/prospective.md" --apply
   ```

   The contract (`reference/rx.md`, `rx pr body`): `--initial` writes only while the live body is
   still the one the PR was created with. `--splice` takes `[{ "find", "replace" }]`, builds from the
   **live** body, and every `find` is one or more **whole lines** occurring exactly once (a
   fragment still matches inside a line he extended); all anchors are located in the original
   body and applied at once, so one edit cannot create or destroy another's anchor. A missing
   anchor means he rewrote or deleted that line: nothing is written, and you show him the edit
   instead of forcing it. To add a line, anchor on the line it goes after and replace it with
   both. The body is re-read immediately before the single PATCH, and the edit history is checked
   after it: `pr-body-write` PASS, WARN when the history had not caught up, FAIL when the live body
   moved (nothing written) or an edit landed in the millisecond gap (the overwritten version is in
   the details; splice it back in), `ERROR` when the outcome is unknown. Bodies are exact strings;
   CRLF from web edits survives. Every live body read is backed up under the cross-repo cache
   (`~/.cache/raycast-harness/pr-body/<repo>/<N>/`), so a clobbered body is recoverable. The PATCH
   sends only `body` and cannot flip draft state; step 3 is the real guard.

6. **Report, then stop.** Give Chris the PR URL, the body as posted, and the next step: *read it,
   then click "Ready for review" yourself.*

### `gh` writes can hang in this sandbox

A `gh` write to `raycast/extensions` can hang (~2 min, auto-backgrounds, no output) while reads
work. On a hang: **do not retry three times.** Check whether it landed by reading the live body
(`gh pr view "$PR" --repo raycast/extensions --json body --jq .body`) for your lines. Never re-run
a splice without that check: an insertion keeps its anchor line, so running it twice inserts the
new line twice. If it did not land, hand Chris the same `rx pr body` command (with `--apply`) and the
same `edits.json` (or `$BODY`) to run in his own shell; never a raw whole-body PATCH. His one paste
beats your three timeouts.

## Post-merge cleanup

Raycast **squash-merges**, which re-SHAs the commit, so git ancestry (`git branch --merged`) never
shows a branch as merged. **Track by PR state and head instead:**

```bash
gh api "repos/raycast/extensions/pulls?state=closed&head=<you>:ext/<name>" \
  --jq '.[] | "#\(.number) \(.state) merged=\(.merged_at)"'
```

Once the PR shows `merged=<date>`, in order; each step is skippable when it does not apply:

1. **Run `rx post-merge`** from the extension root (`rx` 0.5.0 or later). Before the squash,
   raycastbot pushes its own commit onto `ext/<name>`: it replaces `{PR_MERGE_DATE}` with the merge
   date, and it recompresses the screenshots, which strips `iCCP`. Those bytes exist in no local
   commit, so every later `rx stale` FAILs `stale-upstream` until they are adopted. `rx post-merge`
   attributes them from the PR's own commit list, then copies in exactly those files. It commits
   them alone, and a new CHANGELOG entry you have not staged yet stays unstaged. The commit is
   signed with rx's dedicated signing key, so it works while 1Password is locked. Without
   `--dry-run` it applies, and `--dry-run` previews. It refuses rather than guesses:
   - a file changed upstream after the merge → `pull-contributions`;
   - a file changed here since → adopt it by hand;
   - an unregistered key → it prints the two `gh` commands, which Chris runs.

   This replaces copying the stamped date by hand. A real date is still never written by hand
   into a submission (`ship`, CHANGELOG).
2. **Push.** `rx post-merge` pushes its commit to the branch's upstream (the mirror), but only
   when that push sends exactly the one cleanup commit. When it WARNs (other unpushed commits, a
   remote that moved, several push URLs), push yourself after looking.
3. **Sweep the local feature branch** once step 2 is on the remote. Integrate it into local
   `main` first: the feature tip (with the date-stamp commit) is usually pushed as `HEAD:main`
   while local `main` is behind, so `git branch -d` would refuse it. `git switch main && git merge
   --ff-only <branch>` (or `git pull --ff-only` from the mirror), then verify with
   `git merge-base --is-ancestor <branch> main` (exit 0), then `git branch -d <branch>`. Never `-D`.
   The fork's `ext/<name>` branch is ray's: it outlives the PR, ray reuses it on the next publish,
   and raycastbot's merge-time date stamp sits on it, which is what `rx contributions` reports as
   `contribution-branch` during the next `pull-contributions` merge (`ship`, Submission).
4. **Refresh "open at time of writing" references** in any doc or learning this session wrote
   that described the PR as open.
5. **First release of a new extension: set up its mirror** with `<plugin>/scripts/setup-mirror.sh`
   from the extension root, once Chris has created the repo empty and added it as `origin`; it
   commits and pushes nothing and prints the steps that need his go-ahead. Procedure and the
   sync-workflow states that count as a finished setup: the `raycast-mirror` plugin's `mirror`
   skill. `.github/` never reaches the Store; `ray publish` leaves it out.

Record the PR number in the project's `docs/reviews/` so a later session can route review
feedback (code → `develop`; metadata and screenshots → `ship`).
