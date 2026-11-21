---
title: "Ship-time incidents behind the rules: PNG triage, AGENTS.md drift, mirror sync state, contribution conflicts"
date: 2026-10-31
category: workflow-issues
module: publishing
component: development_workflow
problem_type: workflow_issue
severity: high
applies_to: ["ship"]
trigger: "when you are about to triage a png, a readme, an agents.md or a contribution conflict and want the incident behind the rule"
applies_when:
  - "`rx png` reports OLDER-SHOT, NOT-YOURS or UNDECIDED and you want to know what a wrong call costs"
  - "Freshening AGENTS.md / CONCEPTS.md before a self-authored Store PR"
  - "A mirror's sync workflow is red, or you are about to seed ray's publish tag or run pull-contributions by hand"
  - "Adopting @chrismessina/raycast-downloader and tempted to guard resume safety consumer-side"
tags:
  - raycast
  - ray-publish
  - screenshots
  - agents-md
  - pull-contributions
  - mirror
  - store-submission
related_components:
  - documentation
---

# Ship-time incidents behind the rules

**Operative procedure lives in [`skills/ship/SKILL.md`](../../skills/ship/SKILL.md), where every
incident below is a one-line receipt.** This file keeps the full accounts, verbatim from the
pre-`rx` skill (checkpoint `aa3f4c3`, 2026-10-30) and the pre-rewrite `reference/dep-gates.md`, so
that shortening the skill removed no evidence (plan rule 0.3.8). Shell shown here is the procedure
*as it was run then*; today the mechanics are `rx png`, `rx stale`, `rx contributions`,
`rx preflight`'s `agents-md-*` checks and the `raycast-mirror` skill. Nothing here is an instruction
that competes with the skill.

## 1. PNG triage: the `sips` hash loop, why it could not decide, and the 2026-08-29 correction

The skill's screenshot triage went through three generations. The first compared against `HEAD`
(retracted after karakeep, §3). The second normalized with `sips` and hashed; the callout written
beside it then explained why that was not a pixel comparison and replaced it with a decode. Both
generations, as they stood on 2026-10-30.

**2026-07-28, `get-app-icon` — the measurement that showed `Files … differ` on a screenshot is
real, not noise.** Raycast CI recompresses screenshots on merge, so the published copy is smaller
than what was submitted and the local copy never learns about it: upstream
`metadata/get-app-icon-1.png` was **1,021,474 bytes against 1,619,195 locally**, the same image,
CI-optimized. A name-only gate could never see this (the filenames match perfectly); the re-encode
is lossless but the bytes differ, so a plain file hash cannot tell it apart from a replaced
screenshot, and only a decoded-pixel comparison can.

**PNG triage — never blanket-adopt, and never blanket-keep.** "Adopt the upstream
copies" is right for a recompression and **destroys a screenshot the user just
replaced.** Both cases look identical to `diff`: same name, same dimensions, upstream
smaller. Size is *not* the discriminator — a new screenshot of a similar-looking
screen is also ~1.6 MB against a ~1.0 MB published copy.

**The discriminator is the pixels — but `HEAD` is NOT a safe baseline.** `HEAD` only
means "unchanged" while the new assets are still *uncommitted*. The moment they are
committed — which is the normal state when `ship` runs, and the whole point of
committing before submitting — `local == HEAD` is trivially true for a brand-new image,
and it misreports as `RECOMPRESS`. Acting on that **reverts the user's new artwork**.

**Compare the three copies directly and fail closed.** The only safe automatic action
is adopting upstream when the pixels are *provably identical*; anything else keeps
local and is reported for a human decision.

```bash
norm() { sips -s format png --out "$2" "$1" >/dev/null 2>&1 && shasum -a256 < "$2" | cut -c1-16; }
for f in $(git ls-files 'metadata/*.png' 'media/*.png' 'assets/*.png'); do
  # `${PUB_DIR:-}`: a never-published extension has no baseline, so every PNG is new.
  [ -n "${PUB_DIR:-}" ] && [ -f "$PUB_DIR/$f" ] || { echo "LOCAL-ONLY $f — new file; KEEP LOCAL"; continue; }
  # `|| ph=`: a failed sips must reach the UNREADABLE branch, not trip `set -e`.
  ph=$(norm "$PUB_DIR/$f" /tmp/p.png) || ph=; lh=$(norm "$f" /tmp/l.png) || lh=
  # A failed normalization must never look like a match.
  [ -n "$ph" ] && [ -n "$lh" ] || { echo "UNREADABLE $f — KEEP LOCAL (cannot compare)"; continue; }
  if [ "$ph" = "$lh" ]; then
    # Identical pixels. Adopt upstream ONLY if that actually saves bytes.
    if [ "$(stat -f%z "$PUB_DIR/$f")" -lt "$(stat -f%z "$f")" ]; then
      echo "RECOMPRESS $f — same pixels, upstream smaller; safe to adopt"
    else
      echo "IDENTICAL  $f"
    fi
  else
    echo "DIFFERENT  $f — run the decode and provenance check below"
  fi
done
```

| Verdict | Meaning | Action |
| --- | --- | --- |
| `DIFFERENT` | the normalized hashes differ (true for a CI re-encode too) | never auto-adopt — the decode and provenance check below decides |
| `RECOMPRESS` | pixels byte-identical after normalization, upstream smaller | safe to adopt (`cp "$PUB_DIR/$f" "$f"`) — saves churn |
| `LOCAL-ONLY` / `UNREADABLE` | no baseline, or normalization failed | **keep local** |
| `IDENTICAL` | same pixels, no size win | nothing to do |

**`DIFFERENT` is not a prompt to adopt, and not proof the user replaced the shot.** A
contributor who replaced a screenshot upstream produces the same verdict, and keeping
local then reverts *their* image. Settle it with the decode and provenance check in the
callout below.

> 🚨 **`norm()` above uses `sips`, which CANNOT decide this. Compare decoded pixels.**
> Raycast CI's re-encode is **lossless** — it strips a fully-opaque alpha channel and
> recompresses. Measured on `claude-artifacts` for both releases that changed a
> screenshot (#30529 and #30626): `RGBA -> RGB`, the submitted alpha plane holds the
> single value `255`, neither copy is palettized, and **all 7,500,000 RGB bytes are
> identical**. Not one pixel changes; the 36–37% saving is the dropped channel plus
> better zlib.
>
> **`sips -s format png` preserves channel count**, so it re-encodes RGBA as RGBA and RGB
> as RGB and their hashes differ no matter what the pixels hold. It is not a pixel
> comparison. Reading it as one is what previously made this callout claim the
> optimization was "lossy / palette-reduced" and that the two cases were inseparable —
> wrong on both counts, corrected 2026-08-29.
>
> **Decode instead, and the verdict is decidable.** Compare size and RGBA: an opaque
> image decodes with a `255` alpha plane, so the CI's dropped plane still matches, while
> a real transparency change does not. Two things RGBA cannot see send the file to a
> human instead: a 16-bit PNG (decoding to 8 bits merges distinct values) and differing
> color metadata (`gAMA`, `iCCP`, `sRGB`, `cHRM`), which renders the same bytes
> differently. When the pixels differ, the published image is either an older shot of
> yours or someone else's, and history can only narrow that down.
>
> ```bash
> # Exit 0: same size, RGBA pixels and color metadata. 1: different. 2: cannot tell.
> same_px() { python3 -c "
> from PIL import Image; import sys
> if any(open(p, 'rb').read(25)[24] > 8 for p in sys.argv[1:3]): sys.exit(2)  # IHDR bit depth
> a, b = Image.open(sys.argv[1]), Image.open(sys.argv[2])
> meta = lambda im: [im.info.get(k) for k in ('gamma', 'icc_profile', 'srgb', 'chromaticity')]
> sys.exit(0 if a.size == b.size and meta(a) == meta(b) and
>          a.convert('RGBA').tobytes() == b.convert('RGBA').tobytes() else 1)" "$1" "$2"; }
>
> # Call once per DIFFERENT path: png_triage metadata/<name>-1.png
> png_triage() {
>   local f=$1 r=0 prior tmp
>   same_px "$PUB_DIR/$f" "$f" || r=$?
>   case $r in
>     0) echo "SAME-PIXELS $f"; return ;;
>     2) echo "UNDECIDED   $f — 16-bit PNG → look at both by eye"; return ;;
>   esac
>   tmp=$(mktemp)
>   # `|| true`: `break` closes the pipe, and git's SIGPIPE must not trip pipefail.
>   prior=$(git --literal-pathspecs log --full-history --diff-filter=d --format=%H HEAD -- "$f" |
>     while IFS= read -r c; do
>       git show "$c:./$f" > "$tmp" 2>/dev/null || continue
>       same_px "$PUB_DIR/$f" "$tmp" && { echo "$c"; break; }
>     done || true)
>   rm -f "$tmp"
>   if [ -n "$prior" ]; then
>     echo "OLDER-SHOT  $f — published == the version in ${prior:0:7} → resolve like CHECK"
>   else
>     echo "NOT-YOURS   $f — published matches no version in your history → STOP"
>   fi
> }
> ```
>
> | Result | Case | Action |
> | --- | --- | --- |
> | `SAME-PIXELS` | CI re-encoded the shot you have | **adopt upstream** — it is what ships |
> | `OLDER-SHOT` | published is a version in your history; local is a different shot | **resolve before publishing**: keep local only if that commit is the shot you last submitted and the local one is your newer replacement. A contributor's shot pulled in by a sync, or an old shot upstream restored, also lands here → **STOP** |
> | `NOT-YOURS` | in none of your commits: a contributor's shot, or one you never committed | **STOP** — look at both images and ask the user; keeping local reverts a contributor's shot |
> | `UNDECIDED` | 16-bit PNG | **STOP** — compare by eye and ask the user |
>
> Confirm by eye on the way past — it costs one look — but the decode is the decider, not
> the eyeball. Adopt whenever pixels match, smaller or not: the published bytes are what
> users see, and keeping the local original leaves the file differing from upstream on
> every future run.

## 2. Raycast's `metadata-images` CI job, run locally (read from the scripts 2026-10-18)

Then assert the kept files still meet spec (`2000 × 1250`) — a replaced screenshot is
the most likely thing in the tree to be the wrong size.

**Then run Raycast's own screenshot CI check on the set that will SHIP.** The
`metadata-images` job (`scripts/check_metadata_images.py`, which imports its sibling
`check_raycast_images.py`) compares every screenshot's background against the first one
(RMS limit 12.0) and requires one light/dark appearance across the set. Only the files
you change get pushed, so **replacing one screenshot tests it against the OLD published
captures**. A fresh shot beside old ones fails even though your local set is consistent.
Either retake the whole set or check against the published copies. Local run: put both
scripts under `<tmp>/mono/scripts/`, symlink the extension to
`<tmp>/mono/extensions/<name>`, then `python3 scripts/check_metadata_images.py
extensions/<name>` in a venv with `numpy pillow`.

The same job also fails, per screenshot (read from the scripts 2026-10-18):
- **your local dev icon visible in the bottom bar.** The checker's own fix: recapture
  with Window Capture and *Save to Metadata*.
- **any screenshot with no detectable Window Capture frame.** When the extension has a
  menu-bar command, the message calls it a menu bar screenshot, which `metadata/` does
  not support at all.
- **more than 6 screenshots, or a `.jpg`/`.jpeg`/`.webp`/`.gif`/`.bmp` one.** Only
  those suffixes and `.png` are collected, so an `.avif` is silently ignored.

The cross-screenshot background and appearance comparison runs only when `platforms`
lists exactly one platform. macOS and Windows captures may legitimately differ.

*(2026-09-24, brew #31534: one new `brew-4.png` scored 42.3 against the published
`brew-1.png`, and 0.1 against the local one it was captured alongside.)*

## 3. karakeep 2.4.0 (2026-07-30) and get-app-icon (2026-07-29): the two PNG incidents

*(2026-07-30, `karakeep` 2.4.0: the previous `HEAD`-based script reported
`RECOMPRESS → ADOPT UPSTREAM` for **all six screenshots AND the extension icon** — every
one of which the user had just replaced that session. Because the assets were already
committed (as they should be before shipping), `local == HEAD` held trivially and the
"did the user change it?" test could never fire. Following the verdict would have
reverted the entire visual refresh. Caught only because the agent knew the images were
new and checked the pixels by hand: `published 4.0K / local 48K, normalized sha differs`.
Hence the rewrite above — compare published against local, never against `HEAD`, and
auto-adopt **only** on a proven pixel match.)*

*(2026-07-29, `get-app-icon`: five images differed. Three were pure recompression —
adopting them saved 1.9 MB of pointless churn, and they correctly showed **no diff** in
the resulting PR. Two were screenshots the user had just updated that morning; the
blanket "adopt upstream" this file previously prescribed would have silently reverted
them, and the PR would have shipped the old screens. The same two then reappeared as
merge conflicts during `pull-contributions` — see the CHANGELOG/PNG conflict protocol
in the `pull-contributions` section — where "take theirs" is wrong for the identical
reason.)*

## 4. Mirror sync state before publishing: the `gh` block and the 2026-10-22 `--branch` flakiness

**Then, if the extension has a mirror, ask the sync workflow what it already knows.** A
mirror's `sync-from-upstream.yml` runs daily and compares upstream with the mirror, so when it
is failing it may have found the staleness this gate is looking for, possibly weeks earlier.
Read its state before anything else.

Pin the repo to `origin` (same parsing as `setup-mirror.sh`). Bare `gh` uses its configured
default repo, which can be a different mirror. **From a monorepo or fork checkout, `origin` is
not the mirror:** set `MIRROR=<owner>/raycast-<name>` first. The block checks for the workflow
on the mirror's default branch, not in your working tree, so a feature branch without the file
cannot skip it. Filter runs to the default branch, because a
manual dispatch on another branch can be newer than a failing default-branch run. Filter in `jq`, not
with `--branch`: on 2026-10-22 the same `--branch main` query returned 0, 1 and 1 runs in a row. Find sync PRs by
their `sync/upstream-<sha>` head branch, not with `--search`: the search index lags, and a
title search missed an hour-old sync PR on `threads` that the branch filter found. The block
runs in a subshell, so an `exit` aborts the check and leaves a pasted-into shell open.

```bash
(
  R=${MIRROR:-$(git remote get-url origin | sed -E 's#^(https://github\.com/|git@github\.com:|ssh://git@github\.com/)##; s#\.git$##; s#/$##')}
  [[ $R =~ ^[A-Za-z0-9._-]+/[A-Za-z0-9._-]+$ ]] || { echo "ABORT: not a GitHub repo: $R"; exit 1; }
  B=$(gh repo view "$R" --json defaultBranchRef --jq .defaultBranchRef.name) || { echo "ABORT: cannot read $R"; exit 1; }
  gh api "repos/$R/contents/.github/workflows/sync-from-upstream.yml?ref=$B" --silent 2>/dev/null \
    || { echo "NO SYNC WORKFLOW on $R@$B (not a mirror, or set MIRROR)"; exit 0; }
  RUN=$(gh run list -R "$R" --workflow sync-from-upstream.yml --limit 100 \
    --json databaseId,headBranch,status,conclusion,createdAt \
    --jq "map(select(.headBranch == \"$B\")) | .[0] // empty | \"\\(.status)/\\(.conclusion)  \\(.createdAt)  id=\\(.databaseId)\"") \
    || { echo "ABORT: cannot read sync runs"; exit 1; }
  echo "LATEST $B RUN: ${RUN:-NONE}"
  gh issue list -R "$R" --label upstream-sync --state open --json number,title,createdAt \
    --jq '.[] | "OPEN ISSUE #\(.number)  \(.createdAt)  \(.title)"' || { echo "ABORT: cannot read issues"; exit 1; }
  gh api --paginate "repos/$R/pulls?state=open&per_page=100" \
    --jq '.[] | select(.head.ref | startswith("sync/upstream-")) | "OPEN SYNC PR #\(.number)  \(.title)"' \
    || { echo "ABORT: cannot read PRs"; exit 1; }
)
```

| Result | Meaning | Action |
| --- | --- | --- |
| open `upstream-sync` issue | a file changed on both sides since the baseline | **STOP**: the issue names the file; reconcile it, rerun the workflow, and once that run is `completed/success`, close the issue (the workflow never closes it). Then rerun this gate |
| latest run `completed/failure`, no issue | the job failed somewhere else: API or download errors, a lockfile regeneration, a rejected baseline push | **STOP**: read the failed step's log (`gh run view <id> -R "$R" --log-failed`). Reconcile content only if the log shows a content problem; otherwise fix or rerun the workflow |
| an open sync PR | upstream has changes the mirror has not adopted, or a PR left behind after you already adopted them | **STOP**: diff its head against the default branch (`$B`). If it brings real changes, merge it and pull; if it only moves the baseline timestamp, close it. Then rerun this gate |
| `NONE`, `in_progress`/`queued`, `cancelled`, `timed_out`, or any state other than `completed/success` | no completed verdict on the default branch | **STOP**: dispatch the workflow (`gh workflow run sync-from-upstream.yml -R "$R"`), wait for it, rerun this gate | <!-- us-english-ok: GitHub API enum -->

A green sync doesn't show that the mirror matches upstream. It reports one past run, and a run
with no recorded baseline keeps any local file that differs, logging it under "kept" instead of treating it as a conflict or failing the run. That is why
the content diff above still has to run. A red sync is a STOP even when the content diff looks
explainable.

*(2026-10-21, `threads`: the sync had been failing daily since 2026-10-14 with "Sync halted:
README.md", and issue #1 had been open the whole time. The content diff found the same
problem, a contributor's merged Analytics and Giveaway release, but only after the release
work was finished. The issue named it a week earlier.)*

## 5. AGENTS.md / CONCEPTS.md freshening: the two passes and the digger and threads incidents

### History: whether AGENTS.md ships (four rulings, the last one current)

The default is still the 2026-11-03 ruling: `AGENTS.md`, `CONCEPTS.md`, `CLAUDE.md` and
`HANDOFF.md` never ship in a Store PR. They stay in the mirror, listed in the extension's
`.gitignore`, and a published one is deleted in the PR. Since 2026-11-20 a published one may stay
at Chris's discretion, through the preset's `ship.keep` (Greptile no longer raises a file already
on `main`), as `reader-mode`'s already do. The mechanisms are in
[`reference/greptile-rules.md`](../../reference/greptile-rules.md#file-policy) (*File policy*). Everything
else in this subsection is history, preserved from the live ship skill's receipt (`SKILL.md`
around lines 1100–1125 before the harness port), so the reversal can be read in order:

1. **2026-09-09, `threads`: AGENTS.md ships.** The receipt then read: "`AGENTS.md` and
   `CONCEPTS.md` are NOT leaks on a self-authored extension. They are repo documentation for
   whoever works on the extension next, which is exactly who reads `extensions/<name>/` in the
   monorepo." Chris: *"because this is MY extension, I will ship AGENTS.md, and the tests."* The
   leak list had named `AGENTS.md` as something that must never appear there, which contradicted the
   next checklist item (keep `AGENTS.md` / `CONCEPTS.md` accurate *because* "they ship to the
   monorepo, so a stale claim in them is published guidance that a contributor will act on"). The
   `LEAKS` regex never listed `AGENTS.md`, so the executable check already allowed what the prose
   forbade; the prose was corrected to say they ship. `WARP.md` stayed on the leak list. A document
   about architecture and conventions is for contributors, while a working note (branch state, next steps,
   machine paths) is private whatever it is called. `threads` had a published `WARP.md`, which that PR
   removed. Forks were the exception then and still are: never add your own `AGENTS.md` to an
   extension you do not own.
2. **2026-10-30: reaffirmed.** Greptile's `no-agent-scaffolding` flags an `AGENTS.md` a PR adds or
   changes. Chris chose to keep shipping the freshened file and to answer the finding
   (`raycast-pr-loop` carried the reply).
3. **2026-11-03, cosign #33077: reversed.** Greptile raised `AGENTS.md` as a P1 in a score-2/5
   review, and Chris ruled: *"looks like we DO need to remove AGENTS.md after all."* The live skill
   marked the two earlier rulings as overridden in place; the harness keeps the current rule in the
   skills and this receipt here.

Freshening did not change with the reversal. Contributors read the mirror copy, so its claims
still have to be true, and the passes below still run, before `rx holdout out` moves the files.

The ship-time contract is now `rx preflight`'s four `agents-md-*` checks plus the `agents-md-claims`
audit entry (plan §11.1). The hand-run assertions and the read pass as they stood, with the
incidents that made the step unconditional:

**The procedure lives in the `verify-agents-md` skill** — the four assertions, the read
pass, and the failure modes. Load it rather than re-deriving them here; the summary below is
the ship-time contract, not the full method.

Run **both** passes. The first is cheap and mechanical; the second is the one that
actually finds things.

**Pass 1 — assertions. All four must come back clean:**

```bash
# a) every repo path the doc names still exists
grep -ohE '`(src|assets|metadata|media)/[A-Za-z0-9_./-]+`' AGENTS.md CONCEPTS.md 2>/dev/null \
  | tr -d '`' | sort -u | while read -r f; do [ -e "$f" ] || echo "MISSING PATH   $f"; done

# b) every npm script it names still exists
grep -ohE 'npm (run [a-z:-]+|test)' AGENTS.md CONCEPTS.md 2>/dev/null | sort -u \
  | while read -r c; do s=${c#npm run }; s=${s#npm }
      jq -e --arg s "$s" '.scripts[$s]' package.json >/dev/null 2>&1 || echo "MISSING SCRIPT $c"; done

# c) no ABSOLUTE machine paths (written when this file shipped to a PUBLIC repo; see the history above)
grep -n '/Users/' AGENTS.md CONCEPTS.md 2>/dev/null && echo "^^ machine path would be PUBLISHED"

# d) every symbol it names in backticked call form still exists in src/
grep -ohE '`[a-z][A-Za-z0-9_]+\(\)`' AGENTS.md 2>/dev/null | tr -d '`()' | sort -u \
  | while read -r sym; do rg -q "\b$sym\b" src || echo "MISSING SYMBOL $sym()"; done
```

> **(c) is not a style rule.** These docs are cited by absolute path in Chris's *other*
> prose, because those files relocate — but an `AGENTS.md` sits **beside** the source it
> cites, so an absolute path there is unnecessary. The rest of this rationale, that an
> `AGENTS.md` "bound for `raycast/extensions`" publishes a machine path (the `HANDOFF.md`
> failure in miniature), is no longer current: since 2026-11-03 the file stays in the mirror.
> The mirror is a public repo too, so the check still holds. Repo-relative throughout, and say
> so at the top of the file so the next editor knows why.

**Pass 2 — read the claims about what this branch changed, against the code you just
wrote.** No grep finds this: the doc still names real symbols while describing what they
used to do. **Verify a claim by printing the cited line back**, not by confirming the path
resolves — a citation can be in range, resolve clean, and point at unrelated code.

Four failure modes, all observed:
- **A named symbol moved or changed meaning** — a wrong pointer sends a contributor to
  the wrong file.
- **A behavioral claim quietly became false** — the expensive one. Widening an accepted
  set is the classic shape: `threads` documented "requires `image/*` or `video/*`" for a
  release whose headline feature was audio.
- **A path to something the branch DELETED.** Tooling migrations do this every time —
  `threads` pointed at a `tools/` directory the vitest migration had removed.
- **A blanket search-and-replace that made a true line false.** Renaming a script across
  the doc with `sed` turned "runnable check … hits the live site" into "`npm test` … hits
  the live site", which is the opposite of true. **Re-read every line a bulk edit
  touched.**

**Never invent a claim to fill a gap.** If you cannot verify what the current behavior
is, delete the stale line and say so in the report.

> ⚠️ **`ce-compound-refresh` does NOT do this job — do not route here to it.** It audits
> the **learnings store** under `<root>/solutions/`, and touches `AGENTS.md` only to add a
> *discoverability pointer* to that store plus `CONCEPTS.md` vocabulary. It never checks
> whether `AGENTS.md`'s own claims are true. On an extension with no `docs/solutions/` —
> which is most of them — it finds an empty store and has nothing to refresh. Reach for it
> when the repo *has* a learnings store that needs auditing; reach for the two passes above
> when `AGENTS.md` needs to be true. (Corrected 2026-09-09: this section previously sent
> large drift to `ce-compound-refresh`, which would have refreshed the wrong file.)

A doc-only edit stays in `ship` — it needs no hand-back to `develop`. It does **not** skip
the adversarial review: an `AGENTS.md` (shipped then, mirror-only by default now) is inside the `codex-gate` (the docs-only
exemption was retired 2026-09-09), and a docs review is pointed at *truth, not style*.

*(2026-09-04, `digger`: writing `AGENTS.md` fresh took five adversarial passes, four of
which found a false claim — including two the author introduced while fixing the first
one, both copied from a code comment that was itself wrong. 2026-09-09, `threads`: the
diff-scoped version of this check passed — it caught one renamed script — while the file
still carried six false claims and an absolute machine path that had already shipped into
the open PR. Scoping to the diff is what let the rest through, which is why this step is
now unconditional.)*

## 6. README checks: the incidents behind `readme-assets`, `readme-links` and the nav/badge judgment

`rx preflight`'s `readme-assets` and `readme-links` now assert the mechanical half; the anchor and
badge checks are the `readme-preamble` judgment entry. The incidents, as the skill recorded them:

**2026-07-23, reddit-search #29703.** Embedding `![...](metadata/…)` fails the submission checklist
verbatim (*"assets used by the README are placed outside of the `metadata` folder"*); it was caught
only at PR time, forcing a re-publish.

**2026-07-25, `get-app-icon`.** The `assets/` half of the rule was added that day: the pre-flight
moved README images out of `metadata/` **into `assets/`**, satisfying the rule as written while
silently adding **3.3 MB** to the bundle, since `assets/` ships inside the extension and is
downloaded by every user, forever. The old wording ("move the image to a repo-root path") permitted
exactly that mistake, which is why the destination (`media/`) is now named explicitly.

**2026-08-26, `nerd-font-picker`: the template's own source had the dead-anchor bug.** It links
`[Features](#-features)` against a plain `## Features` heading; all five of its nav links are dead.
The leading dash is GitHub's slug for an *emoji-prefixed* heading, so copying that top-matter without
copying emoji headings inherits five broken links. Hence the anchor check.

**2026-08-26, `get-app-icon`: match the link syntax, not the bare word.** A loose
`grep -o 'metadata/[^)]*'` also hits a `metadata/` line inside a *Project Structure* code block and
reported a compliant, template-shaped README (which documents its own folders) as failing. The
stricter link-syntax form still caught the real thing (all six embeds in `ios-apps`). `rx preflight`
excludes fenced, inline and indented code for the same reason.

**The fleet-debt sweep (2026-07-25):**

- **Known fleet debt (swept 2026-07-25, unfixed at time of writing).** Six extensions fail this,
  so treat it as the default state of an older extension rather than a rare slip:
  - embed `metadata/` images → `at-profile`, `craftdocs`, `ios-apps`, `screenocr`, `store-updates`
  - embeds an `assets/` image (ships to users) → `tesla-energy`

  Each will bounce, or quietly bloat, on its next submission. Re-run the sweep across the fleet
  with:
  ```bash
  for d in raycast-*/; do r="${d}README.md"; [ -f "$r" ] || continue
    m=$(grep -o 'metadata/[^)]*' "$r" | head -1)
    a=$(grep -oE '\(assets/[^)]*\.(png|jpg|jpeg|gif)' "$r" | head -1)
    [ -n "$m$a" ] && printf '%s  metadata:%s  assets:%s\n' "${d%/}" "${m:-—}" "${a:-—}"
  done
  ```

## 7. Seeding ray's publish tag by hand (`seed_tag`)

Context: `ray publish` failing with `git checkout .` / `pathspec '.' did not match any file(s)
known to git` on the first publish of an already-published extension from a monorepo clone with no
local `__raycast_latest_publish_ext/<name>__` tag. The function as written and used:

**The tag decides what ray treats as a contribution, so creating one by hand switches that
check off.** Make it only after the staleness gate (−1) is clean against current upstream,
which is the real proof that no contributor's change is about to be overwritten. Put it on
your branch's base commit, and only if that commit's copy of the extension equals upstream's.
Then re-run `publish`. **Historical, not for pasting:** the block is a `text` fence because its tag
message contains the word the plugin's guard denies in any Bash command other than the publish
itself; the current skill seeds the tag with `-m "baseline"`.

```text
# From any directory. Ray compares against UPSTREAM main, not your fork's main.
# Each step stops on its own failure, with its own message; nothing falls through to the tag.
BASE=<base>; P=":(top)extensions/${EXT}"; T="__raycast_latest_publish_ext/${EXT}__"
seed_tag() {
  git fetch -q upstream main                         || { echo "STOP: fetch failed"; return 1; }
  [ -n "$(git ls-tree -d --name-only upstream/main -- "$P")" ] || { echo "STOP: not on upstream"; return 1; }
  [ -n "$(git ls-tree -d --name-only "$BASE" -- "$P")" ]       || { echo "STOP: not in $BASE"; return 1; }
  local rc=0; git diff --quiet "$BASE" upstream/main -- "$P" || rc=$?
  case $rc in 0) ;; 1) echo "STOP: $BASE differs from upstream; reconcile first"; return 1 ;;
              *) echo "STOP: diff failed (exit $rc)"; return 1 ;; esac
  git rev-parse -q --verify "refs/tags/$T" >/dev/null && { echo "STOP: $T already exists"; return 1; }
  git tag -a "$T" -m "baseline for first ray publish" "$BASE" || { echo "STOP: git tag failed"; return 1; }
  echo "TAGGED $T -> $(git rev-parse --short "$BASE")"; }
seed_tag
```

The tag stays local (ray pushes only the branch). Ray moves it with `git tag -f` once the
branch push succeeds, even if opening the PR then fails. *(Read from `@raycast/api` 2.9.0 `publish-to-public-repo.js`; instagram-media-downloader
#32858, 2026-10-27: this fixed it on the first retry.)*

## 8. `pull-contributions`: the blob-SHA probe for "is there a real contribution at all?"

Replaced by `rx contributions` (per-file incoming-vs-published decision). The probe as it was run:

**Known failure — `checking for new contributions` → run `pull-contributions`, then resolve
the SAME two conflicts every time.** `ray publish` stops with:

> `error - checking for new contributions` … *"some contributions are available. Pull them
> using `npx @raycast/api@latest pull-contributions`"*

This is routine, not a problem with your code. **Before running it, prove your work is
recoverable and find out whether there is a real contribution at all:**

```bash
# 1. Commit first. pull-contributions starts a MERGE in your working tree.
git status --porcelain    # must be clean; commit before proceeding

# 2. Is there actually an upstream change to THIS extension? Compare blob SHAs;
#    a diverged fork `main` carrying unrelated commits is the usual cause and is harmless.
ME=$(gh api user --jq .login)   # your GitHub login — the fork owner
for f in $(git ls-files); do
  fk=$(gh api "repos/$ME/extensions/contents/extensions/$EXT/$f?ref=main" --jq .sha 2>/dev/null)
  up=$(gh api "repos/raycast/extensions/contents/extensions/$EXT/$f?ref=main"   --jq .sha 2>/dev/null)
  [ -n "$fk" ] && [ "$fk" != "$up" ] && echo "REAL CONTRIBUTION: $f"
done
echo "(no output = fork and upstream agree; the merge will be pure noise)"
```

## 9. `@chrismessina/raycast-downloader`: the consumer incidents and fathom's four resume-safety predicates (from `dep-gates.md`)

The package exists for `fathom`'s **250–650 MB recording downloads**, which must survive the Raycast
command being unloaded; it was published 2026-09-16 and is intended for reuse in `ios-app-search`
and `fetch`.

**Until 2026-09-15, every fathom download failed from inception.** The consumer copied
`dist/runner.js` (tsc output that requires `./curl`, `./status`, `./paths`) instead of the
self-contained `dist/runner.bundle.js`, so the detached runner died with `Cannot find module
'./curl'` before a single byte transferred. Finding an artifact and that artifact being runnable are
different properties, and only the first one had a test.

**2026-09-16, the rename.** The package was `@chrismessina/raycast-download` until publication; the
name was taken, so it became `raycast-downloader`. The rename left fathom's asset on the old
filename with byte-identical contents, and `runnerCandidates()` looks for exactly
`raycast-downloader-runner.js` under `environment.assetsPath`; under `npm run dev` the
`cwd`/`node_modules` fallbacks still resolved, so it would have broken only in the Store build.
Nearly shipped.

**The 8-byte experiment behind 0.1.4's provenance check.** `curl -C -` asserts that the bytes on
disk are a correct prefix and nothing downstream can check that: measured against a Range-capable
server, an **8-byte garbage prefix resumed to exit 0, HTTP 206, and a wrong file**. 0.1.4 therefore
records provenance in `<partPath>.state` and sends `If-Range` on every resume.

**Do NOT write a consumer-side guard on resume safety. The consumer cannot see what the
sidecar sees.**

`fathom` tried four predicates for "is this partial safe to resume" and three were wrong —
each shipped, each was caught by an adversarial review, and each did DAMAGE while failing:

| Predicate | Why it was wrong |
| --- | --- |
| `error.httpStatus` is 3xx | a rollback that SUCCEEDS still carries a 3xx, and a 304 leaves the original bytes perfectly valid |
| `bytesDownloaded === 0` | also zero after an early network failure that had written real bytes |
| `partialUnsafe` on the status | a status is addressed by id and a retry takes a NEW id, so it was never readable |
| *(none — let the package decide)* | correct |

**The failure mode is the part worth remembering.** Rejecting a partial did not clean it
up. It allocated a fresh filename via `uniquePath`, downloaded a second copy, and left the
original — possibly hundreds of megabytes — orphaned in the user's directory. So a guard
meant to prevent rare corruption reliably wasted disk and bandwidth on a common path. **A
guard that strands data on the common path is a worse trade than the pathological risk it
defends against**, and that arithmetic is easy to miss while writing the guard, because the
risk is vivid and the cost is invisible.

Since 0.1.4 the package records provenance beside the partial and decides resume, reset or
fail itself. A consumer should select a candidate on what it can actually know — a terminal
transfer for this recording, final output path free, partial non-empty — and hand the path
over. Anything more is second-guessing a decision made with information the consumer does
not have.
