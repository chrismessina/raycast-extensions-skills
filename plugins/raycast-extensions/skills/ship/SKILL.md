---
name: ship
description: Get an existing Raycast extension into raycast/extensions and clean up — runs the pre-flight (dep hygiene + house-style AUDIT + weeding), fetches Store-compliance docs, submits the PR via `ray publish`/`npm run publish`, preps the PR title/body, drives the review-feedback cycle, and sweeps merged branches. Fires on "submit / publish / ship to the Store", "npm run publish", or "address review feedback (metadata/screenshots)." Does NOT change code behavior — if feedback needs code, hands BACK to `develop`.
metadata:
  stage: "2a + 3 + 5 + 6 + 7 — pre-flight, compliance, PR, review, cleanup"
---

# ship

## The seam: `ship` never changes code behavior

> **Reviewing someone else's PR is not this skill.** `ship` submits *your* extension and drives
> feedback *on* it. A PR authored by a contributor against an extension you help maintain is
> the inbound direction — [`review-pr`](../review-pr/SKILL.md).

`ship` runs *non-breaking* dep hygiene, the *read-only* house-style audit, weeds metadata, gates compliance, submits, and cleans up. The moment a code change is needed (a failing house-style audit, or Store review feedback that needs code), it **hands back to `develop`** with context, then receives the change forward again. The arrow is two-way.

## Documented learnings — read before the review cycle, not after it

`learnings/` in this plugin holds write-ups of defects and decisions from previous runs of these skills, each with the trigger that makes it relevant. **Read the row that matches what you are about to do — before doing it.** A learning is only useful at the moment it applies; rediscovering one after the review costs a round.

| When you are about to… | Read |
|---|---|
| a Store PR shows far more changed files than the branch touched | [`raycast-store-pr-base-diverged-fork-main`](../../learnings/workflow-issues/raycast-store-pr-base-diverged-fork-main.md) |
| an automated reviewer is holding the PR with a rating that will not clear | [`answer-a-blocking-review-with-a-measurement`](../../learnings/workflow-issues/answer-a-blocking-review-with-a-measurement.md) |
| complying with a correct finding whose fix is only implied | [`verify-the-remedy-not-just-the-finding`](../../learnings/workflow-issues/verify-the-remedy-not-just-the-finding.md) |
| a reviewer reports a collision or value you cannot reproduce | [`wrong-vendor-docs-manufacture-review-findings`](../../learnings/workflow-issues/wrong-vendor-docs-manufacture-review-findings.md) |
| a third review pass is still finding defects in the previous pass's fixes | [`count-the-review-layers-not-the-findings`](../../learnings/workflow-issues/count-the-review-layers-not-the-findings.md) |
| introducing a helper that encodes a rule an audit already greps for | [`audit-coupled-to-the-hand-written-form-of-a-rule`](../../learnings/workflow-issues/audit-coupled-to-the-hand-written-form-of-a-rule.md) |


> **On a blocking finding from an automated reviewer:** a finding being correct does not make the remedy it implies correct, and a rating that will not clear creates pressure to ship *any* responsive change. Build the implied remedy, measure it against what you have, and report the number — including when it loses. See [`answer-a-blocking-review-with-a-measurement`](../../learnings/workflow-issues/answer-a-blocking-review-with-a-measurement.md).

> **Once the PR is open and Greptile posts a scored review, the round-by-round loop is its own skill:** [`greptile-loop`](../greptile-loop/SKILL.md) — triage per finding, re-publish with the secret holdout, and wait for the next round without resident background pollers (repeatedly killed under memory pressure on 2026-09-10; see its §4 for the bounded waiting mechanics).

## Pre-flight checklist (the "cake")

Run before PR. Each layer is gardening, not engineering:

−1. **STALENESS GATE — is the local tree behind the PUBLISHED extension?** This runs
   *before* the typecheck because a green build on a stale baseline is the dangerous
   case: publishing it **deletes whatever upstream has that you lack.**

   **Diff the actual publishable file set — names are not enough.** An upstream *edit* to
   a file you also have (a bugfix in an existing `src/*.tsx`, a changed asset, a lockfile
   bump) is invisible to a name-only comparison and is exactly what a re-publish
   overwrites. Compare content, and **fail closed** — a fetch that errors must stop the
   run, never fall through to "no differences found."

   ```bash
   set -euo pipefail
   EXT="$(jq -r .name package.json)"

   # Per-run temp dir. Shared /tmp paths collide between concurrent runs and leave a
   # previous run's file to be read as if it were this one's.
   WORK="$(mktemp -d "${TMPDIR:-/tmp}/staleness-$EXT.XXXXXX")"
   trap 'rm -rf "$WORK"' EXIT

   # Is it published at all? Distinguish a REAL 404 from a failed request — a rate
   # limit or network error must ABORT, never silently mean "not published."
   HTTP="$(gh api "repos/raycast/extensions/contents/extensions/$EXT" \
            --silent --include 2>/dev/null | head -1 | grep -oE '[0-9]{3}' | head -1)"
   case "$HTTP" in
     200) PUBLISHED=yes ;;
     404) PUBLISHED=no  ;;
     *)   echo "ABORT: baseline lookup returned '${HTTP:-no response}' (not 200/404)."
          echo "Rate limit, auth, or network — cannot prove freshness. Do NOT publish."
          exit 1 ;;
   esac

   if [ "$PUBLISHED" = no ]; then
     echo "NOT PUBLISHED — no baseline; skip this gate"
   else
     # Sparse, blobless checkout of just this extension — never the full monorepo.
     git -C "$WORK" init -q
     git -C "$WORK" remote add origin https://github.com/raycast/extensions.git
     git -C "$WORK" config core.sparseCheckout true
     git -C "$WORK" sparse-checkout init --cone
     git -C "$WORK" sparse-checkout set "extensions/$EXT"
     git -C "$WORK" fetch -q --depth 1 --filter=tree:0 origin main
     git -C "$WORK" checkout -q FETCH_HEAD

     PUB_DIR="$WORK/extensions/$EXT"

     # FAIL-CLOSED ASSERTION — do not delete this, and do not rely on `set -e` alone.
     # `set -e` does NOT fire when a command's status is swallowed by a pipeline
     # (`git fetch … | tail`), so a failed fetch can fall through to `diff`. If
     # PUB_DIR is then missing-or-empty, `diff -r -q` outputs nothing and the `&&`
     # branch prints "IN SYNC" — a false pass on the exact case this gate exists to
     # catch. Verified 2026-07-28: piping the fetch made `set -e` silently ineffective.
     [ -d "$PUB_DIR" ] && [ -n "$(ls -A "$PUB_DIR")" ] || {
       echo "ABORT: baseline fetch failed or is empty — cannot prove freshness. Do NOT publish."
       exit 1
     }

     # Content diff across everything that actually ships.
     #
     # The -x list is load-bearing and every entry earns its place — a gate that
     # reports noise on every run is a gate you learn to skim.
     #   node_modules/.git/dist/.DS_Store — never published
     #   raycast-env.d.ts                 — generated by `ray develop`, gitignored
     #   .prettierrc / .eslintrc*         — inherited from the monorepo root upstream,
     #                                      so they appear as "Only in PUB" forever
     diff -r -q \
       -x node_modules -x .git -x dist -x .DS_Store \
       -x raycast-env.d.ts -x '.prettierrc*' -x '.eslintrc*' \
       "$PUB_DIR" .
     case $? in
       0) echo "IN SYNC — no content differences" ;;
       1) echo "DIFFERENCES — classify each line below before proceeding" ;;
       *) echo "ABORT: diff failed (exit 2 = operational error, not a difference)."
          echo "Cannot prove freshness. Do NOT publish."
          exit 1 ;;
     esac
   fi
   ```

   > ⚠️ **`diff` exit 2 means the comparison FAILED; exit 1 means it found differences.**
   > `diff … && echo "IN SYNC" || echo "review"` collapses both into the same message —
   > verified 2026-07-29: a missing operand exits 2 and prints the review text, reading as
   > an ordinary difference. Branch on the status explicitly; never use `&&/||` here.

   **`Files … differ` is ambiguous on its own — and this is the step people skip.** It
   fires identically whether *upstream* changed the file or *you* did. Shipping an update
   necessarily changes files, so treating every `differ` as staleness blocks every normal
   update, and waving them all through defeats the gate. **You must classify each one.**

   Ask git, not your memory: does the published blob match the commit your local work
   started from?

   ```bash
   # For each differing path, is the PUBLISHED version something you already had?
   for f in $DIFFERING_PATHS; do
     if git cat-file -e "HEAD:$f" 2>/dev/null && \
        [ "$(git hash-object "$PUB_DIR/$f")" = "$(git rev-parse "HEAD:$f")" ]; then
       echo "MINE   $f — published == your HEAD; the delta is your uncommitted edit"
     elif git cat-file -e "HEAD:$f" 2>/dev/null && \
          git merge-base --is-ancestor HEAD @{u} 2>/dev/null; then
       echo "CHECK  $f — diverged from HEAD; inspect before publishing"
     else
       echo "UPSTREAM $f — published differs from anything in your history → STOP"
     fi
   done
   ```

   | Classification | Meaning | Action |
   | --- | --- | --- |
   | `Only in <PUB_DIR>` | upstream has a file you do not | **STOP** — publishing deletes it |
   | `UPSTREAM` | published content is not in your history | **STOP** — publishing reverts their fix |
   | `MINE` | published matches your `HEAD`; you edited locally | expected — this is your change |
   | `Only in .` | your new local work | expected |

   **When in doubt, diff the content and read it** (`diff "$PUB_DIR/<f>" <f>`). A file you
   cannot confidently classify is an upstream change until proven otherwise — fail closed.

   > **`Files … differ` on `metadata/*.png` or `media/*.png` is usually real, not noise.**
   > Raycast CI **recompresses screenshots on merge**, so the published copy is smaller
   > than what you submitted and your local copy never learns about it. Verified 2026-07-28 on
   > `get-app-icon`: upstream `metadata/get-app-icon-1.png` is 1,021,474 bytes against
   > 1,619,195 locally — same image, CI-optimized. A name-only gate could never see this:
   > the filenames match perfectly. **The re-encode is lossless, but the BYTES still differ**,
   > so a plain file hash cannot tell it apart from a replaced screenshot — only a
   > decoded-pixel comparison can. See the callout under the triage table below.

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
     [ -f "$PUB_DIR/$f" ] || { echo "LOCAL-ONLY $f — new file; KEEP LOCAL"; continue; }
     ph=$(norm "$PUB_DIR/$f" /tmp/p.png); lh=$(norm "$f" /tmp/l.png)
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
       echo "DIFFERENT  $f — pixels differ; KEEP LOCAL (assume the user replaced it)"
     fi
   done
   ```

   | Verdict | Meaning | Action |
   | --- | --- | --- |
   | `DIFFERENT` | published and local pixels differ | **keep local** — never auto-adopt; adopting reverts new artwork |
   | `RECOMPRESS` | pixels byte-identical after normalization, upstream smaller | safe to adopt (`cp "$PUB_DIR/$f" "$f"`) — saves churn |
   | `LOCAL-ONLY` / `UNREADABLE` | no baseline, or normalization failed | **keep local** |
   | `IDENTICAL` | same pixels, no size win | nothing to do |

   **`DIFFERENT` is not a prompt to adopt.** It means the image changed and only a human
   knows whether that was intentional. In practice it almost always was — the user
   replaced a screenshot. If you genuinely suspect upstream holds a fix you lack, *look at
   both images* before touching either.

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
   > **Decode instead, and the verdict is decidable:**
   >
   > ```bash
   > python3 -c "
   > from PIL import Image; import sys
   > a, b = Image.open(sys.argv[1]), Image.open(sys.argv[2])
   > print('SAME-PIXELS' if a.convert('RGB').tobytes()==b.convert('RGB').tobytes()
   >       else 'DIFFERENT-IMAGE')" "$PUB_DIR/$f" "$f"
   > ```
   >
   > | Result | Case | Action |
   > | --- | --- | --- |
   > | `SAME-PIXELS`, upstream smaller | CI re-encoded *your* submission | **adopt upstream** — it is what ships |
   > | `DIFFERENT-IMAGE` | the user replaced the shot | **keep local** — adopting reverts their work |
   >
   > Confirm by eye on the way past — it costs one look — but the decode is the decider, not
   > the eyeball. Adopt whenever pixels match: the published bytes are what users see, and
   > keeping the local original leaves the file differing from upstream on every future run.

   Then assert the kept files still meet spec (`2000 × 1250`) — a replaced screenshot is
   the most likely thing in the tree to be the wrong size.

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

   **Either STOP condition → hand to `develop`'s staleness gate for reconciliation.** Do
   not publish. Your local copy never learns about upstream changes on its own; other
   people contribute to published extensions directly in `raycast/extensions`, and the
   author may not know it happened.

   *(2026-07-28, `raycast-store-updates`: the CHANGELOG diff in step 3's weeding check was
   the only thing that caught a local copy missing an entire shipped menu-bar command and a
   `githubToken` preference. It was found at the very end of a long session, after all the
   work was done. Promoted here, and to `develop` step 0, so it is the first thing checked
   rather than the last.)*

0. **Typecheck gate — `npx tsc --noEmit`.** `ray build` (esbuild) and `ray lint`
   strip/skip types; they pass on code that does NOT typecheck, and an external
   reviewer running `tsc` will catch it. Run `tsc --noEmit` AND `npm run build` AND
   `npm run lint` — a non-zero `tsc` is a failure even when build/lint are green.
   A type error needing code → hand to `develop`. (See house-style.md `[both]` tsc rule.)
1. **Dep hygiene** — non-breaking bumps only. Major migrations are NOT here — they're
   `develop` (gated by `reference/dep-gates.md`).

   > 🚨 **Never run bare `npm audit fix`, and never leave a dep change unverified.** The
   > gates in step 0 prove the tree that existed *when they ran*. Any mutation to
   > `package.json` or `package-lock.json` invalidates all three — and `npm audit fix`
   > rewrites the lockfile transitively, so the artifact you ship is not the artifact you
   > typechecked. A green step 0 followed by a dep mutation is a **false green**.

   ```bash
   npm outdated                      # review — do not blanket-upgrade
   npm audit --json > /tmp/audit.json # inspect FIRST; decide per advisory
   ```

   Apply fixes **explicitly** (`npm install <pkg>@<version>`), one decision at a time.
   `npm audit fix` may only be used with `--dry-run` to preview. Then:

   ```bash
   git diff --stat package.json package-lock.json   # review the actual dep delta
   npx tsc --noEmit && npm run build && npm run lint  # RE-RUN all three — non-negotiable
   ```

   **The re-run is the gate, not a formality.** If any dep changed and you did not re-run
   all three, step 0's result is stale and you cannot claim the build is green.

   **`@raycast/api` must be at or above the FLOOR — this blocks submission. It must NOT be
   bumped to npm's newest.** npm publishes `@raycast/api` days ahead of the Raycast release that
   can run it, and the Store refuses an extension whose declared API is newer than the user's app.
   Submitting npm's latest-in-major is how you ship a release nobody can install — see the callout
   in `dep-gates.md`. **Crossing a major is a migration and belongs to `develop`**, never here.

   > 🚨 **Submit the version the extension was last EXERCISED at.** A bump here lands after all
   > hands-on testing, so nothing runs it. If this gate reports the version is behind npm, that is
   > information — acting on it requires re-running the extension in Raycast at the new version
   > first. If it will not be re-run, do not bump.

   ```bash
   # Locate the lockfile: the extension dir normally, a parent under workspaces.
   LOCK="$(node -e 'const f=require("path");let d=process.cwd();for(;;){const p=f.join(d,"package-lock.json");if(require("fs").existsSync(p)){console.log(p);break}const u=f.dirname(d);if(u===d)process.exit(1);d=u}' 2>/dev/null)"
   [ -n "$LOCK" ] || { echo "ABORT: no package-lock.json found — the Store requires one."; exit 1; }

   # v2/v3 lockfiles use .packages; a v1 lockfile uses .dependencies. Try both.
   INSTALLED="$(jq -r '
     (.packages["node_modules/@raycast/api"].version)
     // (.dependencies["@raycast/api"].version)
     // empty' "$LOCK")"
   [ -n "$INSTALLED" ] || { echo "ABORT: @raycast/api not resolvable in $LOCK (workspace hoisting?)."; exit 1; }

   MAJOR="${INSTALLED%%.*}"
   # The FLOOR from dep-gates.md — the only blocking bar. Keep in sync with that table.
   FLOOR="2.1.0"
   # npm's newest on this major: ADVISORY ONLY. Never the blocking target — it is routinely
   # ahead of every shipped Raycast, and submitting it breaks installs for all existing users.
   TARGET="$(npm view "@raycast/api@^$MAJOR" version 2>/dev/null | tail -1 | awk '{print $NF}' | tr -d "'")"
   NEWEST="$(npm view @raycast/api version 2>/dev/null)"

   echo "lockfile=$INSTALLED  floor=$FLOOR  latest-in-major=${TARGET:-unreachable}  newest-overall=${NEWEST:-unreachable}  ($LOCK)"

   # BLOCK only when genuinely stale — below the floor. sort -V avoids a semver dependency.
   [ "$(printf '%s\n%s\n' "$INSTALLED" "$FLOOR" | sort -V | head -1)" = "$FLOOR" ] || {
     echo "BLOCKED: @raycast/api $INSTALLED is below the $FLOOR floor."
     echo "Bump to at least $FLOOR, RE-RUN the extension in Raycast at that version, then re-gate."
     exit 1
   }

   # Behind npm is a NOTE, not a blocker. Acting on it requires re-running in Raycast first.
   [ -z "$TARGET" ] || [ "$INSTALLED" = "$TARGET" ] || \
     echo "NOTE: npm has $TARGET on the v$MAJOR line. Do NOT bump unless you will re-run the extension in Raycast at $TARGET — npm ships ahead of the app that can run it."

   # A newer MAJOR is information, not a blocker. Do not bump it here.
   [ "${NEWEST%%.*}" = "$MAJOR" ] || \
     echo "NOTE: @raycast/api v${NEWEST%%.*} exists ($NEWEST). That is a migration → hand to \`develop\`, not a ship-time bump."
   ```

   > ⏱️ **Re-run this check immediately before `publish`, not only at the top of the pre-flight.**
   > `@raycast/api` ships most days — 2.1.1 and 2.1.2 both landed within hours of each other on
   > 2026-08-28 — so a currency check that passed when the pre-flight started can be false by the
   > time the work is finished. It is one `npm view` call; run it again as the last gate.

   **This is a hard compare that exits non-zero — not a printout to eyeball.** Every
   failure path (npm unreachable, no lockfile, unresolvable version) aborts rather than
   passing quietly: an unprovable claim about currency is not a pass. A manifest range
   that merely *permits* the target is insufficient; **the lockfile is what ships.**

   > 🚨 **Why this is scoped to the major, added 2026-08-20.** The earlier version compared
   > against `npm view @raycast/api version` — bare `latest`. The day `2.0.3` took the
   > `latest` tag, that gate began **blocking every extension in the fleet** (all on
   > 1.104.x) and demanding an unreviewed major migration inside a submission run — which
   > `dep-gates.md` explicitly assigns to `develop`. It also would have pushed you ahead of
   > the entire ecosystem: on 2026-08-20 every extension in `raycast/extensions` was still
   > on 1.x, and the 1.x line was still shipping (1.104.25). **A gate keyed on `latest`
   > silently converts someone else's major release into your emergency.**

2. **House-style audit** (read-only — the `npm audit` twin). Walk the **Audit matrix** at the
   end of `reference/house-style.md`: for every row whose *Applies* condition holds, run that
   rule's **Audit** and record `pass`, `fail`, or `n/a` with the reason — one line per ID, in
   the pre-flight report. Every row gets a result; a row you skipped is a row you did not audit.
   - **A `block` failure stops the submission** and goes to `develop`'s house-style audit fix.
     A `report` failure goes in the report and does not stop it — never hand back to `develop`
     or open a PR for a `report` item alone.
   - **`copy-error` is the one most often gotten wrong:** it is a per-call-site pairing review.
     A count of `"Copy Error"` strings proves nothing, and kit-using code has none at all.
   - **`keyboard` follows `reference/keyboard-conventions.md`, never a green `ray lint`.**
     `@raycast/eslint-plugin` disagrees with the runtime and the published docs on five
     `Common` constants, and it never checks the conflict invariant. If `ray lint --fix`
     touched a shortcut, re-derive every rewritten binding from the runtime before shipping.
   - **`kit` (report only):** note the adoption opportunity in one line. The `^0.2.0` floor, the
     `bytes` subpath, its `Node16` tsconfig requirement, and the base-1024 display change are
     in `reference/dep-gates.md`.
   - **Disable the Impeccable design hook first** if it is installed (`impeccable-off`), so a
     design false positive cannot pass for a house-style finding.
3. **Weeding** — screenshots current (did we add a command/view?), README current, CHANGELOG updated.
   - 🚨 **FRESHEN `AGENTS.md` (and `CONCEPTS.md`) — every self-authored PR push, no
     exceptions.** Not "if it looks stale": the doc is part of the deliverable, on the same
     footing as the CHANGELOG entry. It ships to the monorepo, so a wrong claim is published
     guidance a contributor will act on — and it drifts silently, because nothing compiles it,
     no gate reads it, and the release that invalidates a line is exactly the release too busy
     to notice. **Forks: skip entirely** — never add or edit your own `AGENTS.md` on an
     extension you do not own.

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

     # c) no ABSOLUTE machine paths — this file ships to a PUBLIC repo
     grep -n '/Users/' AGENTS.md CONCEPTS.md 2>/dev/null && echo "^^ machine path would be PUBLISHED"

     # d) every symbol it names in backticked call form still exists in src/
     grep -ohE '`[a-z][A-Za-z0-9_]+\(\)`' AGENTS.md 2>/dev/null | tr -d '`()' | sort -u \
       | while read -r sym; do rg -q "\b$sym\b" src || echo "MISSING SYMBOL $sym()"; done
     ```

     > **(c) is not a style rule.** These docs are cited by absolute path in Chris's *other*
     > prose, because those files relocate — but an `AGENTS.md` bound for `raycast/extensions`
     > sits **beside** the source it cites, so an absolute path there is both unnecessary and
     > a leak. It publishes a machine path, which is the `HANDOFF.md` failure in miniature.
     > Repo-relative throughout, and say so at the top of the file so the next editor knows why.

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
     the adversarial review: a shipped `AGENTS.md` is inside the `codex-gate` (the docs-only
     exemption was retired 2026-09-09), and a docs review is pointed at *truth, not style*.

     *(2026-09-04, `digger`: writing `AGENTS.md` fresh took five adversarial passes, four of
     which found a false claim — including two the author introduced while fixing the first
     one, both copied from a code comment that was itself wrong. 2026-09-09, `threads`: the
     diff-scoped version of this check passed — it caught one renamed script — while the file
     still carried six false claims and an absolute machine path that had already shipped into
     the open PR. Scoping to the diff is what let the rest through, which is why this step is
     now unconditional.)*
   - **README structure — self-authored extensions follow [`reference/readme-template.md`](../../reference/readme-template.md).**
     Centered top-matter (H1, badge row, one-sentence tagline, nav), then Features /
     Requirements / Quick Start / Usage / Development / Tech Stack. **Report gaps; do not
     rewrite prose at ship time** — a thin README is a `develop` task, not a submission
     blocker. Two things *are* assertable here and both are cheap:

     ```bash
     # a) every nav anchor resolves — lines printed on the LEFT are dead links
     diff <(grep -oE '\(#[a-z-]+\)' README.md | tr -d '()' | sort -u) \
          <(grep -E '^## ' README.md | sed 's/^## //' | tr 'A-Z' 'a-z' | tr ' ' '-' | sed 's/^/#/' | sort -u) \
     | grep '^<' && echo "BROKEN nav links ^^"

     # b) the badge row points at THIS extension, not a copy-paste of another
     SLUG="$(jq -r .name package.json)"
     grep -o 'img.shields.io/github/stars/chrismessina/[a-z0-9-]*' README.md
     grep -o 'raycast.com/chrismessina/[a-z0-9-]*' README.md   # must end in $SLUG
     ```

     > ⚠️ **The dead-anchor check exists because the template's own source had the bug.**
     > `nerd-font-picker` links `[Features](#-features)` against a plain `## Features`
     > heading; all five of its nav links are dead (verified 2026-08-26). The leading dash
     > is GitHub's slug for an *emoji-prefixed* heading. Copying that top-matter without
     > copying emoji headings inherits five broken links.
     >
     > ⚠️ **Check (b) because the badge row is the most copy-pasted block in the fleet.**
     > A stars badge still naming the extension you cloned from is wrong on a page users
     > actually read, and nothing else in the pipeline looks at it.

     **Forks: skip this entirely.** The follow/stars badges are personal identity; putting
     them on someone else's extension is a defect, not a courtesy.
   - **`.github/FUNDING.yml` — standalone-repo only, never a blocker.** It belongs in the
     extension's own GitHub repo and is dropped on publish (a published extension directory
     has no `.github/` at all). Note its absence in the report; never hold a submission for it.
   - 🚨 **A `LICENSE` file is MANDATORY on every self-authored extension — MIT, and it must
     exist as a file.** `package.json` `"license": "MIT"` is only a declaration; the README's
     License badge is a **relative link to `LICENSE`**, so without the file it is a live 404
     on both GitHub and the Store page. Nothing in `ray build` or `ray lint` checks this.
     ```bash
     [ -f LICENSE ] || echo "BLOCKED: no LICENSE file (MIT required on self-authored extensions)"
     grep -q '](LICENSE)' README.md && [ ! -f LICENSE ] && echo "BLOCKED: License badge links to a file that does not exist"
     ```
     Add the standard MIT text with `Copyright (c) <year> Chris Messina`. It ships to the
     monorepo (verified: `extensions/digger`, `extensions/reader-mode`), which is what makes
     the badge resolve for Store visitors. **Fork caveat:** do not add or change a `LICENSE`
     on an extension you don't own — that is the owner's call.
     **Fleet debt (2026-08-29):** `raycast-ios-apps` and `raycast-get-app-icon` carry the
     badge with no `LICENSE` file. Fix on next touch; never propagate.
   - **Screenshot count ≤ 6.** The Store hard-caps `metadata/` screenshots at 6; `ray build`/`ray lint` do NOT flag an over-count, but a reviewer will bounce it. `ls metadata/*.png | wc -l` and trim to the 6 most distinct before submitting.
   - **README images go in top-level `media/` — not `metadata/`, and not `assets/`.** Three folders,
     three jobs; mixing them fails the checklist two different ways:

     | Folder | Holds | Bundled into the built extension? |
     | --- | --- | --- |
     | `metadata/` | Store-listing screenshots **only** | no (listing only) |
     | `assets/` | **runtime** files the extension loads (512×512 icon, images used in code) | **YES** |
     | `media/` | README / docs images | no |

     - Embedding `![...](metadata/…)` fails the submission checklist verbatim — *"assets used by the
       README are placed outside of the `metadata` folder"* — and a reviewer will bounce it.
     - Parking them in `assets/` clears *that* rule but creates a quieter one: `assets/` ships inside
       the extension, so a 1.6 MB README screenshot is downloaded by **every user, forever**. The Store
       docs also say to "remove unused icon assets." Don't trade a visible violation for a payload.
     - **Assert BOTH — the `metadata/` grep alone is not sufficient:**
       ```bash
       # Match only markdown image/link TARGETS — all must be EMPTY.
       grep -oE '!?\[[^]]*\]\((\./)?metadata/[^)]*\)' README.md
       grep -oE '!?\[[^]]*\]\((\./)?assets/[^)]*\.(png|jpg|jpeg|gif)\)' README.md
       # …and the HTML form, which the markdown patterns above cannot see.
       grep -oE 'src="(\./)?(assets|metadata)/[^"]*"' README.md
       ```
       > ⚠️ **The third grep is not optional.** The current template's header is an
       > `<img src="media/…">` tag, so the HTML form is now the *normal* way an image
       > enters a README — and `src="./assets/icon.png"` (the shape used by upstream
       > `filezilla`) is invisible to both markdown patterns. Checking only the markdown
       > syntax passes a README that embeds straight out of the runtime folder.
       > ⚠️ **Match the link syntax, not the bare word.** A loose `grep -o 'metadata/[^)]*'`
       > also hits a `metadata/` line inside a *Project Structure* code block and reports a
       > compliant README as failing — observed 2026-08-26 on `get-app-icon`, whose
       > template-shaped README documents its own folders. The stricter form still catches
       > the real thing (it flags all six embeds in `ios-apps`).

       Fix by moving the files to `media/` and re-pointing the embeds, or drop the embeds.
     - (Hit on reddit-search #29703, 2026-07-23 — caught only at PR time, forcing a re-publish. The
       `assets/` half was added 2026-07-25: `get-app-icon`'s pre-flight moved README images out of
       `metadata/` **into `assets/`**, satisfying the rule as written while silently adding 3.3 MB to
       the bundle. The old wording — "move the image to a repo-root path" — permits exactly that
       mistake, which is why the destination is now named explicitly.)
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
   - **Screenshot + icon dimensions — assert, don't eyeball.** The Store requires screenshots at
     **2000 × 1250 px (16:10), PNG**, and the extension icon at **512 × 512**. `ray build` and
     `ray lint` check neither, so a wrong-size screenshot reaches the reviewer.
     ```bash
     for f in metadata/*.png; do sips -g pixelWidth -g pixelHeight "$f"; done  # want 2000 × 1250
     sips -g pixelWidth -g pixelHeight assets/<icon>.png                       # want 512 × 512
     ```
   - **Relative doc links resolve — including past anything you EXCLUDE from the submission.**
     Excluding a file silently breaks every link pointing *at* it, and nothing in `ray build`,
     `ray lint`, or CI checks relative Markdown links, so a dead pointer merges clean and 404s
     for every reader. `ray publish` drops files (`.github/`, untracked docs) just as any
     hand-copied allow-list does. Assert both halves:
     ```bash
     # a) nothing shipping links AT an excluded file ($EXCLUDED = shelf.md, HANDOFF.md, CLAUDE.md, …)
     for f in $EXCLUDED; do grep -rn "$(basename "$f")" README.md docs/ CHANGELOG.md 2>/dev/null; done
     # b) every link that DOES ship resolves — from its own dir, not the repo root
     grep -rn -oE '\]\((\.{1,2}/[A-Za-z0-9_./-]+\.(md|sh|ts|tsx|json|svg|png))\)' \
       README.md docs/**/*.md CHANGELOG.md 2>/dev/null \
     | sed -E 's/:[0-9]+:\]\(/\t/; s/\)$//' | sort -u \
     | while IFS=$'\t' read -r src rel; do
         [ -e "$(dirname "$src")/$rel" ] || echo "BROKEN  $rel  <- $src"; done
     ```
     Both must print nothing. Resolve each link from **its own directory** — a `../` link in
     `docs/` resolves differently than the same string in `README.md`, so a repo-root check
     passes files that are actually broken. Fix by rewriting the prose to stand alone, not by
     deleting the sentence — the idea is usually still worth stating without the pointer.
     (`claude-artifacts` v1.0 shipped a dead `docs/shelf.md` link, 2026-07-27 — the file was
     deliberately excluded, the README kept pointing at it, and it was caught only after merge.
     A merged README costs a patch PR.)
   - **CHANGELOG: add a NEW top entry with `{PR_MERGE_DATE}` for THIS update. Never
     touch entries that already carry a real date.** Raycast CI stamps the
     placeholder on merge; reverting an already-dated older entry (e.g. Initial
     Version) back to `{PR_MERGE_DATE}` makes it re-stamp with the new merge date,
     so it looks like the whole history launched today. (Bookface #28961 review
     flagged exactly this — it only came out right because CI/maintainer preserved
     the old date. Don't rely on that.) Diff the CHANGELOG against the published one
     and confirm only the new entry differs.

     **Assert it — the placeholder count is the whole check.** Exactly one
     `{PR_MERGE_DATE}` may exist, and it must be on the **top** entry. Every heading
     below it must already carry a real date, byte-identical to the published copy:

     ```bash
     # 1. exactly one placeholder, and it is the FIRST heading
     n=$(grep -c '{PR_MERGE_DATE}' CHANGELOG.md)
     first=$(grep -nE '^## \[' CHANGELOG.md | head -1)
     [ "$n" -eq 1 ] || echo "FAIL: $n placeholders (want exactly 1)"
     echo "$first" | grep -q '{PR_MERGE_DATE}' || echo "FAIL: top entry is not the placeholder"

     # 2. every OTHER heading matches the published file exactly
     diff <(grep -E '^## \[' "$PUB_DIR/CHANGELOG.md") \
          <(grep -E '^## \[' CHANGELOG.md | grep -v '{PR_MERGE_DATE}') \
       && echo "history intact" || echo "FAIL: an already-dated entry changed"
     ```

     Both must pass. `2` placeholders means a shipped entry got reverted — the exact
     defect this rule exists to prevent, and it is invisible on casual reading because
     the two headings look alike.

     **INVIOLABLE: the submission NEVER carries a hardcoded date on its new entry —
     `{PR_MERGE_DATE}` goes up, machines stamp it.** Two distinct bots touch that
     placeholder AFTER submission, and knowing which did what is the difference between
     a receipt and a false confession:
     - **raycastbot stamps the placeholder ON THE PR BRANCH seconds before merging**
       (verified 2026-09-09, attio #30910: bot commit "Update CHANGELOG.md" at
       04:10:54Z, merge at 04:11:29Z). A review bot (Greptile) that then re-reads the
       branch flags "Merge Date Is Hardcoded" — it is critiquing raycastbot's own
       stamp. Answer with the commit-author receipt
       (`gh api repos/raycast/extensions/pulls/<N>/commits --jq '.[].commit.author.name'`);
       do NOT "fix" it, and do not accept blame for it.
     - **Hardcoding a date yourself is only ever the POST-MERGE reconciliation step**
       (copying the CI-stamped date back into your local copy so history matches
       published). If a real date is about to go UP in a submission on the new entry,
       stop — that is the violation.

     **The entries must describe what a USER notices, not how the code works.** A
     changelog line explaining an internal mechanism is stale the moment that mechanism
     is refactored, and nobody notices because the changelog isn't compiled. Rewrite each
     entry to the observable effect and check it against the diff, not against memory of
     what you built. *(2026-07-30, `get-app-icon`: three entries described timestamp
     stamping and per-visit re-extraction — internals that a rewrite later in the same PR
     deleted entirely. They would have shipped as a description of code that no longer
     existed.)*

   - **Comments in the diff must earn their keep.** Read every comment the branch adds or
     touches and delete the ones that don't survive these questions:

     | Ask | Delete if |
     | --- | --- |
     | Does it describe code that still exists? | it argues against an approach the branch replaced — "the previous design…", "this used to…" |
     | Could a reader verify it from the file? | it cites a mechanism, file, or symbol that is gone |
     | Is it true anywhere but this machine? | it hardcodes a local census — "150 of 327 apps here" |
     | Does it say something the code doesn't? | it restates the next line in prose |

     **Long is not the same as unnecessary.** A comment explaining why each element of a
     list is required — where dropping one silently breaks something — earns its length.
     A comment relitigating a design decision for reviewers does not: that belongs in the
     commit message, which is where history is supposed to live.

     Iterative review cycles are what generate this. Each round leaves behind an
     explanation aimed at the last reviewer, and after several the file argues with
     ghosts. Sweep before shipping:

     ```bash
     # comment-to-code ratio; investigate anything approaching parity
     total=$(wc -l < src/<file>); cmt=$(rg -c '^\s*(\*|//|/\*)' src/<file>)
     echo "total $total | comment $cmt | code $((total-cmt))"
     # the usual archaeology
     rg -n "previously|used to|the old |v1|earlier (design|version)|no longer" src/
     ```

     Verify the sweep touched nothing else — a comment-only change should produce a diff
     with no code lines:

     ```bash
     git diff -U0 | rg "^[+-]" | rg -v "^(\+\+\+|---)" | rg -v "^[+-]\s*(//|\*|/\*)" | rg -v "^[+-]\s*$"
     ```

     *(2026-07-30, `get-app-icon`: after four review rounds the icon cache carried more
     comment than code — 227 lines against 214 — most of it defending a rewrite against
     the design it replaced. Two comments had also gone stale unnoticed: one documented a
     TAB-delimited wire format that had become space-delimited base64, the other explained
     a result-pairing contract the rewrite had deleted.)*

## HARD GATE — no PR without a green pre-flight

**The pre-flight above is a gate, not a suggestion. Do not open OR update a Store PR —
`ray publish`, `gh pr create`, or a push to an existing PR branch — until steps 0–3 have
actually been RUN and are green.**

This exists because it was violated. On 2026-07-13 the house-style audit was skipped
before publishing producthunt, and ⌘-only shortcuts (on a cross-platform extension) plus
Copy-Error-less failure toasts shipped into an open PR. The linter and the human reviewer
caught them *after* submission. The audit is worthless if it runs after the PR.

Before any submission command, state explicitly which of these you ran and what they
returned — paste the actual output, don't assert it:

- [ ] **staleness gate** (step −1) → `diff -r -q` against the sparse-fetched published tree
      shows no `Only in <PUB_DIR>` and no `Files … differ`. Paste the actual output. A stale
      baseline publishes as a **deletion** of whatever upstream added — and a *content*
      difference publishes as a **revert** of someone else's fix, which a name-only check
      cannot see.
- [ ] `npx tsc --noEmit` → exit 0
- [ ] `npm run build` → exit 0
- [ ] `npm run lint` → exit 0
- [ ] **house-style audit** (step 2) → zero violations, having **read `package.json`
      `platforms` first** (absent ⇒ macOS-only; see `reference/house-style.md`)
- [ ] 🚨 **keyboard shortcut validation** (step 2) → state which runtime version you validated
      against (`plutil -p /Applications/Raycast.app/Contents/Info.plist | grep CFBundleShortVersionString`),
      paste the extracted `Common` table, and name every shortcut in the diff with the binding it
      resolves to. **Say explicitly whether `ray lint --fix` touched any shortcut** — if it did,
      each rewritten binding is re-derived from the runtime, not assumed. A green `ray lint` is
      NOT evidence here; it does not check collisions and its `Common` values are stale on five
      constants.
- [ ] weeding (step 3) → CHANGELOG top entry is new + `{PR_MERGE_DATE}`, and no already-dated
      entry was touched (diff against the published CHANGELOG). Entries describe what a user
      notices, not internals a later refactor can silently invalidate.
- [ ] **comments in the diff earn their keep** (step 3) → no comment argues against a design this
      branch replaced, cites a symbol that no longer exists, or hardcodes a local census. Say what
      you deleted; "none needed removing" is a valid answer only if you actually read them.
- [ ] **README nav anchors** (self-authored only) → the anchor `diff` in step 3 prints nothing on
      the left. A dead nav link ships to the Store page and stays there until the next PR.
- [ ] **README badge row** (self-authored only) → the stars/Store badges name THIS extension's
      slug, not the one it was copy-pasted from.
- [ ] **README asset folders** → ALL THREE greps empty. `assets/` is not an acceptable home for
      README images — it ships to every user. The third catches the HTML form the markdown
      patterns cannot see, which the current template makes the normal case:
      ```bash
      grep -oE '!?\[[^]]*\]\((\./)?metadata/[^)]*\)' README.md
      grep -oE '!?\[[^]]*\]\((\./)?assets/[^)]*\.(png|jpg|jpeg|gif)\)' README.md
      grep -oE 'src="(\./)?(assets|metadata)/[^"]*"' README.md
      ```
- [ ] **`LICENSE` file exists** (self-authored only — never add one to a fork). MIT. Required
      whether or not the README carries the License badge; if it does, the badge is a relative
      link and 404s without the file:
      ```bash
      [ -f LICENSE ] || echo "BLOCKED: no LICENSE file"
      ```
- [ ] **dimensions** → `metadata/*.png` are 2000 × 1250; the icon is 512 × 512 (`sips -g pixelWidth
      -g pixelHeight`). Neither `ray build` nor `ray lint` checks this.
- [ ] **no local-only working artifacts in the monorepo copy — and none already published.**
      `.private/`, `docs/`, `TODO.md`, `WARP.md`, `.claude/`, `.windsurf/` belong in your own
      working repo, never in `extensions/<name>/`. A dot-prefix is not privacy: everything under that path
      in `raycast/extensions` is world-readable. **Check the PUBLISHED directory too, not just what
      you are about to copy** — an allow-list copy silently preserves an earlier leak, because
      published and local agree and every staleness check passes clean:

      > ✅ **`AGENTS.md` and `CONCEPTS.md` are NOT leaks on a self-authored extension — they SHIP.**
      > They are repo documentation for whoever works on the extension next, which is exactly who
      > reads `extensions/<name>/` in the monorepo. Chris confirmed this 2026-09-09 while shipping
      > `threads`: *"because this is MY extension, I will ship AGENTS.md, and the tests."*
      >
      > This list previously named `AGENTS.md` as something that must never appear there, which
      > **contradicted the very next checklist item** — the one requiring `AGENTS.md`/`CONCEPTS.md`
      > to stay accurate *because* "they ship to the monorepo, so a stale claim in them is published
      > guidance that a contributor will act on." Both cannot be true. The `LEAKS` regex below never
      > listed `AGENTS.md` either, so the executable check already permitted what the prose forbade;
      > only the prose was wrong.
      >
      > **`WARP.md` stays on the leak list, and the distinction is not the file extension.** A
      > document describing the extension's architecture and conventions is for contributors and
      > belongs upstream. A *working* note — branch state, next steps, machine paths, one agent's
      > scratch — is private and does not, whatever it is called. `WARP.md` in practice is the
      > latter, and `threads` had one published from an earlier release; that PR removed it.
      >
      > **Forks are the exception:** never add your own `AGENTS.md` to an extension you do not own.
      ```bash
      LEAKS='^(\.private|\.claude|\.windsurf|\.cursor|TODO\.md|CLAUDE\.md|WARP\.md)$'
      gh api "repos/raycast/extensions/contents/extensions/$EXT" --jq '.[].name' | grep -E "$LEAKS" \
        && echo "^^ public right now — git rm -r these in THIS PR"
      ```
      *(2026-09-02, `digger`: `.private/docs/` — 4 internal notes — had been public since an earlier
      release and no gate saw it. The same session's first push would separately have added
      `extensions/threads/TODO.md` and an eslint upgrade guide to the monorepo.)*
- [ ] **`AGENTS.md` / `CONCEPTS.md` FRESHENED** (self-authored only; skip on forks). Both
      passes of the freshening step ran: the four assertions came back clean — named paths,
      named scripts, named symbols, and **no `/Users/` machine path**, which would be published
      — and the behavioral claims about the area this branch changed were re-read against the
      code, with cited lines printed back. Say what you changed in the doc; "no changes needed"
      is a valid answer only if both passes actually ran. **Not** a job for
      `/compound-engineering:ce-compound-refresh` — that audits the learnings store, not this
      file.
- [ ] screenshot count ≤ 6 (`ls metadata/*.png | wc -l`)
- [ ] **external effects were verified at their destination** — for any action in the diff whose
      result leaves the extension (clipboard/paste, a written file, a Finder reveal, an `open`
      handoff), someone confirmed the payload **where it lands**, not just that a success toast
      appeared. `ship` does not run the extension, so this is a *hand-back*, not a check you
      perform: if the diff touches such an action and no destination evidence exists, STOP and
      send it to `develop`'s walk-the-states step. A green pre-flight is not evidence here —
      on 2026-07-26 this exact pre-flight passed a build whose "Copy Icon" pasted a file path
      instead of an image, because every gate it runs was genuinely green.

**Any violation that needs code → STOP and hand to `develop`.** Do not fix it here and do
not ship around it. `ship` never changes code behavior.

## Store compliance gate

Fetch authoritative Store docs (absorbs the old `raycast-extension-review` skill).
**Fetch — do not audit from memory.** Prefer context7 (`/llmstxt/developers_raycast_llms-full_txt`),
falling back to WebFetch. Full procedure: `reference/store-guidelines.md`. Audit, don't guess.

## PR prep

Title convention: `Update <Title> extension` by default; `[Title] <fix>` when one change dominates. No Conventional Commits. See `reference/pr-and-cleanup.md`.

### Draft the PR body and post it — the PR stays a DRAFT

`ray publish` opens the PR as a **draft with an empty description**. Write the first
draft of that body from the real diff and post it, so the user reviews prose instead of
composing it.

> 🚧 **Post the body. Do NOT mark the PR ready for review.** Marking it ready submits it
> to Raycast's reviewers — an outward-facing action that is the user's call, and one they
> make *after* reading the body. Posting a body onto a draft is reversible (one more
> PATCH); publishing a submission is not. **Never run `gh pr ready`.**

**1. Ground the body in what actually changed — never in session memory.** The point of
the draft is to save the user writing, which it only does if the content is right.

```bash
PR=<N>                                     # from ray publish's output
EXT="$(jq -r .name package.json)"
awk '/^##/{n++} n==1' CHANGELOG.md         # the top (unreleased) entry = the change list
git log --oneline "$(git describe --tags --abbrev=0 2>/dev/null || echo HEAD~10)"..HEAD
gh pr diff "$PR" --repo raycast/extensions --name-only   # what the PR really contains
```

If the CHANGELOG's top entry and the diff disagree, **the diff wins** — and say so in
the report, because a CHANGELOG that misdescribes the change is itself a review finding.

**2. Write the body to a file.** Multi-line content with backticks and checklists gets
mangled through inline flags. Keep it out of the extension directory — `.git/` is never
published and never tracked:

```bash
# Resolve via git — `.git/` is a DIRECTORY only at the repo root. In a monorepo
# extension dir (Route A's normal case) `.git` is a parent, so a literal
# `.git/pr-body.md` fails with "no such file or directory". Verified 2026-07-29.
BODY="$(git rev-parse --git-path pr-body.md)"   # never tracked, never published
cat > "$BODY" <<'EOF'
## Description

<2–4 sentences: what changed and why, in the user's terms. Lead with the user-visible
effect, not the implementation.>

### Changes

- <one bullet per CHANGELOG entry, rewritten for a reviewer who has never seen this code>

## Checklist

- [ ] I read the [extension guidelines](https://developers.raycast.com/basics/prepare-an-extension-for-store)
- [ ] I read the [documentation about publishing](https://developers.raycast.com/basics/publish-an-extension)
- [ ] I ran `npm run build` and tested this distribution build in Raycast
- [ ] I ran `npm run lint` and `npx tsc --noEmit` — both clean
- [ ] I checked that this change does not break existing commands or remove functionality
- [ ] I updated `CHANGELOG.md` per the changelog conventions
EOF
```

> **The template ships every box UNTICKED on purpose. Tick each one only after naming the
> run that earned it.** An agent that copies a pre-ticked block makes public claims in the
> user's name that nobody verified — and "I tested this build in Raycast" is a claim only
> the *user* can truthfully make, since it requires launching the app. Leave that one for
> them and say so in your report.

> **Tick a box only if that command actually ran green in THIS session, and paste the
> output in your report.** Pre-ticking a checklist you did not verify is a false claim
> made in the user's name, in public, to a reviewer who is trusting it. If the pre-flight
> gates ran green (step 0), the build/lint/tsc boxes are earned — say which run they came
> from. Otherwise leave them unticked and flag it.

**3. Verify the PR is the right one — BEFORE mutating it.**

`$PR` is a number you copied by hand into a repo of ~1,000 extensions and thousands of
open PRs. A typo targets a **stranger's** PR, and the body you post is public. Confirm
it's yours, it's for this extension, and it's still a draft — then act on the result:

```bash
gh api "repos/raycast/extensions/pulls/$PR" \
  --jq '{author:.user.login, head:.head.ref, draft:.draft, state:.state, files:.changed_files}'
```

**All four must hold, or STOP:** `author` is yours, `head` names this extension,
`draft` is `true`, `state` is `open`. If `draft` is `false`, the PR is already submitted —
do not post; tell the user and let them decide.

**4. Post it onto the draft.**

```bash
gh api -X PATCH "repos/raycast/extensions/pulls/$PR" -F body=@"$BODY" \
  --jq '{draft:.draft, len:(.body|length)}'
```

> The PATCH sends **only** `body`, so it cannot flip draft state. The check above is the
> real guard — reading `.draft` *after* the write cannot prevent one. `len` confirms the
> body actually landed (a `0` means the file was empty or the flag was wrong).

> ⚠️ **`-F` (uppercase) reads `@file`. `-f` (lowercase) does NOT** — it posts the literal
> string `@.git/pr-body.md` as the PR body, publicly, on the user's submission. Verified
> 2026-07-28 against the live API: only `-F key=@path` expands the file (newlines and
> backticks preserved intact). This is a one-character difference with a visibly wrong,
> public result.

**The `--jq '.draft'` must print `true`.** If it prints `false`, the PR was already out
of draft — say so plainly rather than quietly leaving a submission live.

**If the PATCH hangs (~2 min, auto-backgrounds):** that is the documented sandbox
behavior for `gh` writes — see `reference/pr-and-cleanup.md`. **Do not retry it three
times.** Check whether it landed anyway (`gh pr view "$PR" --repo raycast/extensions
--json body --jq '.body | length'`), and if not, hand the user the exact command with the
body file already written. Their one paste beats your three timeouts.

**4. Report, then stop.** Give the user the PR URL, the body as posted, and the explicit
next step: *read it, then click "Ready for review" yourself.* Do not do it for them.

### If the draft state changed, ASK GITHUB WHO DID IT before saying anything

Chris works solo. When a PR's `draft` flips between two of your reads, **he is the
overwhelmingly likely actor** — the two of you get ahead of each other, and he marks his
own submission ready without narrating it. Treat a flip as *the two of us out of sync*
until GitHub says otherwise, not as something that happened *to* the PR.

**The timeline names the actor. It costs one call, so make it before reporting:**

```bash
gh api "repos/raycast/extensions/issues/$PR/timeline?per_page=100" \
  -H "Accept: application/vnd.github+json" \
  --jq '.[] | select(.event=="ready_for_review" or .event=="convert_to_draft")
        | {event, actor:.actor.login, at:.created_at}'
```

- **Actor is Chris** → say nothing alarming. One line at most, and only if it changes what
  he should do next ("PR is ready-for-review as of 00:51, so this push updates a live PR").
- **Actor is someone else, or the timeline is empty and you cannot attribute it** → *then*
  raise it, and say plainly that you could not attribute it.

**Do not infer the actor from timing.** Verified 2026-08-27 on brew #30598: an agent
observed `draft: false` immediately after its own `npm run publish`, concluded `ray publish`
had flipped it, and opened its report with a STOP. The timeline showed all three flips were
Chris's, one of them six minutes *before* the publish. `ray publish` prints "It will be
reviewed by the Raycast team shortly" on every update regardless of draft state, which is
what made the wrong inference feel confirmed. It cost a turn and, in Chris's words, was a
"freak-out" that "isn't warranted when it's just the two of us."

**The `ship` rule that stands is narrower than it looks:** *you* never run `gh pr ready`.
That is about your own actions. It is not a licence to police his.

## Submission — `ray publish`

**`ray publish` covers every submission** — a first submission or an update, your extension
or one you contribute to. It needs no standalone repo, no git remote, and no published
baseline. (Earlier versions of this skill routed some updates through a hand-synced
standalone repo instead; that flow is outside this plugin. If you run one, it is yours.)

**Do NOT ask the user a repo/PR-destination decision tree.** `ray publish` always targets
`raycast/extensions`; there is no destination to choose.

### Route A — `ray publish` (the only route this skill runs)

`ray publish` (`npm run publish`) IS the whole submission flow. It syncs your
`<you>/extensions` fork, clones/prepares the extension, pushes the branch, and
opens a **draft** PR to `raycast/extensions` — no standalone repo, no git remote on
the working repo, and no hand-rolled `gh pr create` needed. A missing/absent local
git remote is NOT a blocker here; `ray publish` does not use it.

1. Ensure the pre-flight above is green and the change is committed (signed).
2. Run `npm run publish`. It runs its own validate/lint/Prettier gates, then
   `getting fork → preparing clone → pushing extension → opening PR`.
3. On success it prints the draft PR URL (`raycast/extensions/pull/<N>`). Relay it.
   The PR opens as a **draft with an empty description**.
4. **Draft and post the PR body** — see *PR prep → Draft the PR body and post it*. Do
   this by default; the user reviews prose rather than writing it. **The PR stays a
   draft:** clicking "Ready for review" is the user's step, never yours.

> 🚨 **`ray publish` never consults git — it copies the extension root minus its OWN fixed
> exclusion list.** Verified against `@raycast/api` 2.1.2
> (`node_modules/@raycast/api/dist/utils/publish/copy-dir.js`): zero references to `.gitignore`,
> and the excluded names are exactly `.git`, `.github`, `.direnv`, `.swiftpm`,
> `.raycast-swift-build`, `compiled_raycast_rust`, `compiled_raycast_swift`, `node_modules`,
> `raycast-env.d.ts`. **Anything else on disk ships, however thoroughly git ignores it** —
> `.gitignore` and `.git/info/exclude` only hide a file from `git status`, which is all the
> clean-tree check reads. A file you are not ready to publish must live **outside the extension
> root**; the only in-repo exceptions are the nine names above.
> *(2026-08-28, karakeep: a learning doc deliberately held back was excluded via
> `.git/info/exclude` to get past the dirty-tree check. It shipped into the PR, had to be deleted
> from the fork branch by API, and that deletion then blocked the next publish as "edits were made
> on your PR".)*

**Known failure — stale fork (expected, not a bug).** `ray publish` may stop with:

> `error - getting fork` … *"could not get the latest changes. Head to
> https://github.com/<you>/extensions, select the Sync fork dropdown … click
> Update branch. Once you've done that, try running this command again"* (often an
> `HTTP error: 500`).

This means the `<you>/extensions` fork has drifted behind upstream. It's
routine and needs the user's browser session — you cannot fix it headlessly. Relay
the three steps verbatim (open the fork → **Sync fork** dropdown → **Update
branch**), then **re-run `npm run publish`** once they confirm. Nothing is wrong with
the code; don't start debugging the extension.

> 🚨 **The `422 … without `workflow` scope` variant is NOT fixable from the terminal, and
> `gh auth refresh -s workflow` does NOT fix it.** When upstream's pending commits touch
> `.github/workflows/*`, the fork sync is refused:
>
> ```
> Error: HTTP error: 422 - {"message":"refusing to allow an OAuth App to create or update
> workflow `.github/workflows/npm_check.yml` without `workflow` scope"}
> ```
>
> Read *"an OAuth App"* literally: the refusal is aimed at **Raycast's** OAuth app making
> the merge-upstream call, not at `gh`. Refreshing `gh`'s scopes changes a credential
> `ray publish` never consults. `gh repo sync <you>/extensions` hits the same wall
> from the other side and suggests the same dead-end remedy in its error text.
>
> **The remedy is the browser Sync-fork button**, because that acts as you, not as an
> OAuth app, and no scope applies. It is the same three steps the stale-fork message
> above prescribes; this variant just cannot be worked around headlessly.
>
> **The durable fix is a scheduled workflow in your fork** (`gh repo sync` on a cron
> inside `<you>/extensions`, running with `secrets.GITHUB_TOKEN`). In Actions the token is repo-scoped and merges workflow files
> without this refusal, so the fork never falls far enough behind to hit it mid-publish.
>
> **Do not sync the fork with a git push instead.** Fork `main` is *diverged*, not merely
> behind (measured 2026-09-20: 18 ahead, 95 behind), so it carries the fork.s own commits and
> the sync is a merge, not a fast-forward. Pushing that merge over SSH would bypass the
> scope check — and is an unrequested, visible mutation of a public repo. Ask.

**Two different messages, two different causes — read which one you got.** *"some contributions
are available"* means the fork's `main` moved (usually unrelated extensions; often pure noise).
*"some edits were made on your PR"* means the **PR branch itself** changed — which, if you edited
that branch by API, is your own commit coming back. In that second case `pull-contributions`
correctly reports `no new contributions` and starts no merge, because the edit was a deletion of a
file that does not exist locally either. **That is success, not a loop — re-run `publish`, do not
run `pull-contributions` again.**

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

Then `npx @raycast/api@latest pull-contributions --non-interactive` (there is **no
`--dry-run`**). It leaves a merge in progress. **Two conflict classes recur every single
time, and the naive resolution is wrong for both:**

| Conflicted file | ❌ Wrong | ✅ Right |
| --- | --- | --- |
| `CHANGELOG.md` | `--ours` | **theirs for the history, ours for the new entry** |
| `metadata/*.png`, `media/*.png` | `--theirs` | **ours** when the user replaced the shot; **theirs** when it's a CI re-encode of a shot you already submitted. Run the PNG triage above and use its decoded-pixel check — a file hash says "differs" for BOTH cases; only the decode separates them. |

**CHANGELOG — never `git checkout --ours`.** Your side holds `{PR_MERGE_DATE}` on entries
that *already shipped*; their side holds the real dates. Taking ours re-stamps shipped
history with today's date. Don't hand-edit the conflict markers either — diff3 base
markers (`||||| <sha>`) make a naive parse produce duplicate headings. **Rebuild from the
two known-good sources instead:**

```bash
python3 - <<'PY'
import io, subprocess
head   = subprocess.run(["git","show","HEAD:CHANGELOG.md"],capture_output=True,text=True,check=True).stdout
theirs = subprocess.run(["git","show","MERGE_HEAD:CHANGELOG.md"],capture_output=True,text=True,check=True).stdout
# The first heading that exists on THEIR side is where your new entry stops.
import re
m = re.search(r'^## \[.*$', theirs, re.M)
marker = m.group(0)
io.open("CHANGELOG.md","w",encoding="utf-8").write(head[:head.index(marker)] + theirs[theirs.index(marker):])
PY
# Verify BOTH halves came from where you think they did:
diff <(git show HEAD:CHANGELOG.md | sed -n "1,$(( $(grep -n '^## \[' CHANGELOG.md | sed -n 2p | cut -d: -f1) - 1 ))p") \
     <(sed -n "1,$(( $(grep -n '^## \[' CHANGELOG.md | sed -n 2p | cut -d: -f1) - 1 ))p" CHANGELOG.md) \
  && echo "new entry matches your commit"
grep -c '{PR_MERGE_DATE}' CHANGELOG.md   # must be exactly 1
```

Then re-run the three gates (`tsc` / `build` / `lint`) **before** `git commit --no-edit` —
the tree changed, so the earlier green is stale. Sealing a merge you have not re-verified
is how a broken tree reaches the PR.

*(2026-07-29, `get-app-icon` #29845: this blocked the publish, and all three conflicts were
in this table — the CHANGELOG plus the two screenshots the user had replaced that morning.
`--ours` on the CHANGELOG would have re-dated the shipped July 27 entry; `--theirs` on the
PNGs would have reverted the new screenshots. Neither is detectable after merge without
re-reading the published copy.)*

**Known failure — wrong PR base / diverged fork main → huge diff (verify after every publish).** Full write-up: [`raycast-store-pr-base-diverged-fork-main`](../../learnings/workflow-issues/raycast-store-pr-base-diverged-fork-main.md).
`ray publish` sometimes opens the PR against **`<you>:main` (the fork) instead of
`raycast/extensions:main` (upstream)**. Worse, a fork `main` can periodically diverge
from upstream via GitHub "Sync fork" **merge** commits (it merges rather than
fast-forwards, and any commits made directly on fork `main` mean it can't fast-forward). When the base is the diverged fork main,
GitHub diffs the branch against it and the PR balloons to **100s of files** — every
unrelated extension change since the divergence — even though the branch itself only
touches `extensions/<name>/`. A reviewer will (rightly) flag it. (Observed 2026-07-17 on
cursors PR #29493: 143 files, base `chrismessina:main`.)

- **Always verify the base after publish:** the PR must read
  `raycast/extensions:main ← <you>:<branch>`, and Files-changed must be only your
  extension's files. Check with:
  `gh api repos/raycast/extensions/pulls/<N> --jq '{base_repo:.base.repo.full_name, base:.base.ref, changed_files}'`
  (REST — works with a `repo`-scoped token; `gh pr edit`/GraphQL needs `read:org` and may fail).
- **Fix — retarget the base, do NOT rebuild:** the branch is already correct; only the
  base pointer is wrong. `gh api -X PATCH repos/raycast/extensions/pulls/<N> -f base=main`.
  The diff collapses to just your extension instantly. No re-clone, no new commits.
- **Do NOT "fix" this by resetting fork `main`** — it may carry commits of your own. Retargeting the PR base is the correct, non-destructive fix.
  Fork-main divergence is then harmless.

> **Deletions reach the PR on every publish except a brand-new extension's first push.**
> `ray publish`'s "preparing extension" step checks out the submission branch in a local fork
> clone, then — if that clone already holds the extension (`existsSync(<extension dir>/package.json)`)
> — runs `rmSync` on the extension's directory before copying your extension root back in. The
> directory is already there for an extension published upstream **and** for a re-publish to an
> open first-submission PR, so both are wiped; only the very first push of a new extension skips
> the wipe, and it has nothing to delete. Read from the bundled CLI
> (`node_modules/@raycast/api/dist/commands/publish/index.js`, search `preparing extension`), same
> flow in 1.103.10 and 2.4.1; confirmed 2026-09-23 on `raycast-store-updates` #31447, where a
> locally deleted `eslint.config.mjs` arrived as `removed`.
>
> What that means in practice:
> - **A committed deletion always lands.** Delete the file, commit, publish — it is removed in
>   the PR. No manual cleanup of the fork branch is needed.
> - **Anything upstream has that you lack is deleted by your publish.** This is why the staleness
>   gate's `Only in <PUB_DIR>` is a STOP, not noise.
> - **What shows up uninvited is a GITIGNORED file still on disk.** Publishing refuses a dirty tree
>   (`please commit or discard your uncommited changes first`), so an ordinary untracked file
>   blocks rather than ships — but git status does not list ignored files, and the copy reads the
>   disk minus its own fixed exclusion list (`.git`, `.github`, `node_modules`, `raycast-env.d.ts`,
>   `.direnv`, and the Swift/Rust build folders). A gitignored `CLAUDE.md` or `.claude/` in the
>   extension root ships on every publish; move it outside the root first. The 2026-07-14 case
>   this note once generalized from — `.windsurf/` persisting in an open PR — fits this if the
>   folder was ignored and still present; the record does not say, and the current code gives a
>   tracked, committed deletion no way to linger.
>
> **Still read the PR's full file list after every publish**, unfiltered —
> `gh api repos/raycast/extensions/pulls/<N>/files --paginate --jq '.[] | .status+" "+.filename'`
> (or `curl` the same endpoint when `gh` is unavailable). It is the only view of what actually
> shipped, including anything gitignored that rode along. To remove a file from an open PR after
> the fact, delete it on disk and re-publish; the fork-branch API delete
> (`gh api -X DELETE repos/<you>/extensions/contents/extensions/<name>/<path> -f sha=<blob> -f branch=ext/<name> -f message=…`)
> is the fallback when a re-publish is not possible. Verify PR *content*, not just the file list,
> by the same route — a staging race can push a commit whose message claims a fix its code lacks.

## Post-merge cleanup

Once the Store PR is **merged**, the same handful of steps run every time. They're written out here so the agent executes them directly instead of re-deriving the discovery each merge (which burns tokens on a solved problem). Run in order; each is skippable when it doesn't apply.

1. **Stamp the CHANGELOG to the merge date — the one genuinely manual, recurring step.** Raycast CI replaces `{PR_MERGE_DATE}` with the merge date *in the merged monorepo copy*, but your **local copy still shows the placeholder**. Read the merged Store CHANGELOG (`curl -sL https://raw.githubusercontent.com/raycast/extensions/main/extensions/<ext-dir>/CHANGELOG.md | head`), copy the stamped date onto the matching entry in your local `CHANGELOG.md`, and commit. Do this so your copy matches what shipped. **Only stamp the entry that just merged** — never touch an entry that already carries a real date (see the weeding rule above).

2. **Push it** if the extension has its own remote, so that repo matches what shipped too.

3. **Sweep the merged branch.** Delete the merged feature branch. Squash-merge re-SHAs, so identify merged branches by PR state (`gh pr list --head`), not git ancestry.

4. **Refresh any "open at time of writing" references.** If this session wrote docs or a ce-compound learning that described the PR as open/unmerged, update those merge-state phrasings to "shipped." (Narrow — only when such docs exist.)

See `reference/pr-and-cleanup.md` for the branch-sweep mechanics.

## Throughline A (hard rail)

**Never sync the full monorepo.** Sparse-checkout discipline — see `reference/sparse-checkout-discipline.md`.
