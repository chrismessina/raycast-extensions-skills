---
name: greptile-loop
description: Drive a submitted Raycast Store PR's Greptile review to 5/5 — fetch each review round, triage every finding (fix the valid, answer the invalid with receipts), re-publish, and wait for the next round WITHOUT resource-hungry polling. Fires on "address the greptile feedback", "loop until 5/5", "greptile gave us N/5", or a pasted Greptile review. Runs AFTER `ship` has opened the PR; hands code changes through the same gates ship requires. Does NOT mark the PR ready for review — that is always the user's click.
metadata:
  stage: "7b — automated-review feedback loop on an open Store PR"
---

# greptile-loop

Raycast runs Greptile on Store PRs. It posts a summary comment with a confidence score
(`N/5`) plus inline findings, and re-reviews after pushes — with lag, and not
always.
This skill is the loop from "Greptile gave us N/5" to "5/5, over to the user":

```
fetch round → triage each finding → fix valid / answer invalid → gates → commit →
re-publish → wait for next round → repeat, until 5/5 for the CURRENT revision,
OR the stopping rule fires, OR the no-re-review bound is hit
```

**Receipt for the whole shape:** attio 2.0 (#30881) went 3/5 → 4/5 → 5/5 across three
rounds, and the create/AI release (#30956) went 4/5 → 5/5 in one — every round triaged,
some findings fixed, some answered with receipts.

## 1. Fetch the round

Greptile's summary lands as an **issue comment that it EDITS IN PLACE on every
re-review** — one comment, updated forever, so `created_at` never moves and only
`updated_at` (or the body itself) signals a new round. Line findings land as **review
comments**, which persist per-round: GitHub marks one **Outdated** when the lines it
anchors to change, but a comment whose lines didn't move stays standing even after the
concern was addressed elsewhere. Read both — the score is in the
summary, the actionable list is often only inline. Substitute the PR number; the
blocks are templates, not verbatim-runnable.

```bash
PR=<N>
# Summary + score. FULL bodies — a truncated finding cannot be triaged.
# (Public repo: unauthenticated curl works and avoids gh's credential helper.)
curl -s --max-time 20 "https://api.github.com/repos/raycast/extensions/issues/$PR/comments?per_page=100" \
  | jq -r '[.[] | select(.user.login | test("greptile"))] | min_by(.created_at) | "\(.updated_at)\n\(.body)"'
# Inline findings — full bodies here too.
curl -s --max-time 20 "https://api.github.com/repos/raycast/extensions/pulls/$PR/comments?per_page=100" \
  | jq -r '.[] | select(.user.login | test("greptile")) | "── \(.path):\(.line // .original_line)  [id \(.id), commit \(.commit_id[0:7])]\n\(.body)\n"'
```

- `per_page=100` with no pagination is a deliberate simplification: a Store PR's
  comment thread stays far below 100. If a thread ever approaches that, follow the
  `Link` header — do not assume page one is everything.
- **Tie the round to a revision.** Record the summary's `updated_at` and compare it
  to the wall-clock time you observed the publish/push COMPLETE — not
  `git log --format=%cI`, which is the commit's authoring time and can predate the
  push by hours. The score is
  STICKY: it does not drop or refresh on a push — it stays at its last-evaluated value
  until a re-review actually runs. A score older than the newest push graded a
  **previous** revision — never report it as the current one.
- **Check the Outdated badge first, then map the rest to their commits.** GitHub
  auto-marks an inline comment **Outdated** when the diff lines it anchors to change
  (receipt: digger — themeUtils/colorUtils/fetcher comments badged Outdated as fixes
  landed). Treat Outdated as *probably answered*, then confirm the change actually
  addressed the concern — an edit that moves the anchored lines without touching the
  logic earns the badge without earning the fix. And a fix that lands in a DIFFERENT
  file leaves the comment un-badged and standing: reader-mode #29451 (2026-07-15)
  carried 7 such comments across 4 commits after the root cause was fixed. Un-badged
  is not the same as unaddressed — the edited summary reflects the revision it LAST
  REVIEWED (not necessarily current HEAD, per the sticky-score rule); the inline
  trail may lag further still.
- **The user often pastes the round faster than the API surfaces it** — their Greptile
  dashboard updates before the PR comments. A pasted round is authoritative; don't
  re-fetch to "confirm" it.

## 2. Triage — every finding gets a verdict, and "valid" is not automatic

| When you are about to… | Read |
|---|---|
| comply with a correct finding whose fix is only implied | [`verify-the-remedy-not-just-the-finding`](../../learnings/workflow-issues/verify-the-remedy-not-just-the-finding.md) |
| answer a rating that will not clear | [`answer-a-blocking-review-with-a-measurement`](../../learnings/workflow-issues/answer-a-blocking-review-with-a-measurement.md) |
| act on a collision or value you cannot reproduce | [`wrong-vendor-docs-manufacture-review-findings`](../../learnings/workflow-issues/wrong-vendor-docs-manufacture-review-findings.md) |
| start a third round that is finding defects in the last round's fixes | [`count-the-review-layers-not-the-findings`](../../learnings/workflow-issues/count-the-review-layers-not-the-findings.md) |

> 🚨 **FIRST, before any verdict: has Chris already ruled on this?**
>
> An explicit instruction from him — "make X the default action", "I want the extra docs
> shipped", "leave that as-is" — is a **standing verdict that outranks a review finding.**
> A reviewer does not know what he asked for, and the loop's job is to reach 5/5 *without
> quietly undoing his decisions to get there*. Silently complying is the worst outcome
> available: he loses the behavior he asked for, and finds out after the release.
>
> **When a finding contradicts something he specified:**
>
> 1. **Do not fix it.** Not even "temporarily to clear the score."
> 2. **Say so, and quote him.** Name the instruction in your report — the finding, what he
>    asked for, and that the two conflict.
> 3. **Draft the push-back reply** with the reasoning and receipts, for him to post.
> 4. **Let him decide.** He may well say "comply anyway, I want the score" — that is a
>    different answer from you deciding it for him, and it is his to give.
>
> **Record the decision at the code**, so the next round gets an answer instead of a
> second silent revert: a comment at the flag or call site stating that the behavior is
> deliberate, who decided it, and the argument against the rule.
>
> *(2026-09-11, `digger` #30957: the append-rule finding hit `sectionActionsFirst`, a
> default Chris had asked for twice in the same session. It was complied with without
> flagging the conflict, shipped reverted, and had to be restored in the following
> release. The score went to 5/5 by removing the thing he asked for.)*

For each finding, decide and say which:

- **Valid → fix it directly.** Test-first where a pure helper is involved (witnessed
  red), then the full gates (`tsc` / `build` / `lint` / tests). Code changes here are
  `develop`-grade work: house style applies, and the user-level **`codex-gate` skill**
  applies on its own threshold — more than one file changed with at least one code
  file — before the round's fix is called done.
- **Valid symptom, wrong implied remedy → build the measurement.** A correct finding
  does not make its implied fix correct, and a score that won't clear pressures you to
  ship *any* responsive change. Measure the implied remedy against what you have and
  report the number, including when it loses. (See
  [`answer-a-blocking-review-with-a-measurement`](../../learnings/workflow-issues/answer-a-blocking-review-with-a-measurement.md).)
- **False positive → answer with receipts, change nothing.** The canonical one:
  **"Merge Date Is Hardcoded" on a CHANGELOG date that raycastbot itself stamped.**
  The receipt must name the commit that changed the date, not merely show a bot exists
  somewhere in the PR:
  ```bash
  gh api "repos/raycast/extensions/pulls/$PR/commits?per_page=100" \
    --jq '.[] | {msg: (.commit.message | split("\n")[0]), author: .commit.author.name, at: .commit.author.date}'
  # The date-stamping commit is the one titled "Update CHANGELOG.md" — its author
  # must read raycastbot, AND its patch must touch only CHANGELOG.md:
  #   gh api repos/raycast/extensions/commits/<sha> --jq '.files[].filename'
  # That pairing is the receipt (attio #30910: stamp at 04:10:54Z, merge at
  # 04:11:29Z). Full rule: ship's CHANGELOG section.
  ```
  Another recurring shape: a finding contradicted by a reviewer you already satisfied —
  say so with the earlier round's text.
  **Delivering the answer: reply in-thread, prefixed `@greptile`.** A plain reply is
  ignored, but an `@greptile`-prefixed reply draws the bot's attention and works —
  verified by Chris. Replies also TUNE the rule fleet-wide ("I'll remember it for next
  time!"), and a declined finding left unanswered just re-fires on the next PR.
  Receipt: claude-artifacts #30626 — a posted reasoning drew "I reconsidered it …
  I'm withdrawing the concern. No change is needed." Draft the reply with receipts and
  mechanism, no snark, one exchange; **posting it is Chris's call** (same standing
  rule as never running `gh pr ready`) unless he has already told you to post in this
  loop.
- **Confidently wrong API claim, repeated across rounds → disambiguate the code, don't
  debate.** Receipt: get-app-icon #29739 (2026-07-27) — Greptile insisted
  `FileManager.replaceItemAt` throws on a missing destination; verified false three
  times on a live system, and the claim survived re-reviews anyway. The move that
  cleared it was rewriting the call site to branch explicitly on file existence, so no
  reader (bot or human) could misread the path. When the code genuinely can't be made
  more explicit, reply in-thread instead — see the @greptile channel above.
- **The append rule — Greptile's most recurring finding, wrong half the time. READ THE
  REFERENCE BEFORE DECIDING; this bullet is a pointer, not a summary.**
  *"New action panel actions should be appended"* has fired on Chris's extensions with
  OPPOSITE correct answers under identical comment text. The test, the two receipts
  (#30529 valid, #30626 declined-and-withdrawn), and why literal compliance is an
  information-architecture regression live in
  `reference/keyboard-conventions.md` → "Action ORDER on an update" — apply that
  section's Enter-default test rather than re-deriving it. **A third case was added
  2026-09-11: a section shipping for the first time in this same PR has no prior Enter
  default, so the rule does not apply to it.** Check with
  `gh api .../pulls/$PR/files --jq '.[] | select(.filename|test("<Component>")) | .status'`
  — `added` means decline the finding.
- **Two reviewers, opposite findings → solve the underlying state, not the ping-pong.**
  Receipt: Codex flagged "untouched checkbox displays unchecked while the server default
  writes true"; Greptile later flagged "untouched checkbox overrides the workspace
  default." Omitting *and* seeding the static default into the display satisfied both.
  If you fix only the current reviewer's half, the other half comes back next round.

**The round bound:** after **three fix rounds** without reaching 5/5, stop looping
autonomously and present the round history — by then the cheap findings are gone and
each further round needs the user's judgment on cost versus score.

**The stopping rule (borrowed from the codex-gate skill):** if a round's findings exist
only because of the previous round's fix, stop, show the user the chain, and let them
call it. A review engine always has one more finding; the loop has no natural end
unless you supply one. Do not chase the score with changes you can't defend.

## 3. Land the fix

1. Gates green (`npx tsc --noEmit`, `npm run build`, `npm run lint`, test suite).
2. Commit with a message that names the round (`Addresses Greptile review on #<N>`).
3. **The secret holdout comes BEFORE the publish** — see step 5 for the procedure;
   run its move-out half first, publish, then its restore half.
4. **Re-publish the way `ship` does** — `npm run publish`. Expect and handle
   the `pull-contributions` dance per `ship` (CHANGELOG rebuilds from
   HEAD + MERGE_HEAD; never `--ours`).
5. **The secret holdout procedure — defined here, since `ship` documents only the
   underlying rule** (`ray publish` copies everything except its nine hardcoded names, so any
   secret or local-only path inside the extension root ships):
   - **Move out, recording an inventory:** before publish, move every local-only
     entry (`.env`, `.claude`, `.superpowers`, and anything else `ls -A` shows that
     is not part of the extension) to a session temp dir, writing each name to an
     inventory file as you go.
   - **Restore from the inventory, then verify against it:** after publish, move each
     recorded name back and confirm **every inventory line** exists in the extension
     root again and the temp dir is empty. Verifying a hardcoded subset misses a
     stranded entry; verifying names that never existed fails spuriously.
   - **Never sequence the restore behind a long-running step inside one backgrounded
     command.** On 2026-09-10 the OS killed exactly such a compound command mid-run;
     the restore had happened, but only an explicit check proved it.

## 4. Wait for the next round — the part that went wrong, codified

**Observed 2026-09-10 (cause inferred, not proven):** three background watcher shells
in a row (30s-, 60s-, and 300s-interval sleep loops) were killed with the harness
reporting low system memory, and `gh`'s 1Password credential helper stalled
(`authorization timeout`) in the same window. Whatever the precise kill order, the
lesson stands: **a resident background shell is unreliable on this machine and burns
resources the whole time it waits.**

**Rules:**

- **The summary footer's re-trigger link is a KNOWN DEAD END — don't spend a session
  on it.** (`https://app.greptile.com/api/retrigger?id=<PR_ID>`) looks like the lever,
  but it only works for Raycast staff — verified by Chris, who tried. Contributors
  wait for Greptile's own cadence (it re-reviews after pushes, with lag), and an
  `@greptile` reply on a finding (see §2) is the one contributor-side way to draw the
  bot's attention.
- **No persistent background sleep-loop watchers. At all.** Not "longer intervals" —
  the 300s version died the same death as the 30s version.
- **No GitHub webhooks either — they are not available to you.** Configuring a repo
  webhook requires admin on `raycast/extensions`; a contributor cannot. (On a repo you
  DO own, `gh webhook forward` exists via the official `cli/gh-webhook` extension —
  `gh extension install cli/gh-webhook` — but a Store PR lives upstream.) Don't spend
  a session rediscovering this.
- **Prefer event-free waiting:** report the state, stop, and check on the user's next
  message. The user's Greptile dashboard beats the API to every round anyway.
- **When the user explicitly wants unattended looping,** use `/loop` with a **≥ 15
  minute** interval — its scheduler does not hold a shell process between ticks (an
  improvement over a resident watcher, not a survival guarantee). Each tick is one
  single-shot, time-bounded check.
- **The single-shot check** — unauthenticated `curl` (no credential helper),
  `--max-time` so a stalled connection can't outlive its tick, per-PR temp paths so
  concurrent sessions can't cross-read (ship's per-run-temp-dir rule), an explicit
  status branch so failures read as "check failed", never as "no change", and a
  conditional request to keep quiet polls cheap. (GitHub documents the
  304-doesn't-count exemption for *authenticated* conditional requests; treat the
  unauthenticated saving as bandwidth, not quota — the 60/hr anonymous budget minus a
  15-minute cadence's 4 calls leaves ample headroom either way.)
  ```bash
  D="${TMPDIR:-/tmp}/greptile-$PR"; mkdir -p "$D"
  ETAG="$(cat "$D/etag" 2>/dev/null)"
  code=$(curl -s --max-time 20 -o "$D/body" -D "$D/headers" -w '%{http_code}' \
    ${ETAG:+-H "If-None-Match: $ETAG"} \
    "https://api.github.com/repos/raycast/extensions/issues/$PR/comments?per_page=100")
  case "$code" in
    304) echo "no change" ;;
    200) last=$(jq -r '[.[] | select(.user.login | test("greptile"))] | min_by(.created_at) | .updated_at // "none"' "$D/body" 2>/dev/null)
         if [ -z "$last" ]; then echo "CHECK FAILED (unparseable body)"; else
           # Persist state only after a successful parse.
           awk 'tolower($1)=="etag:"{$1="";print substr($0,2)}' "$D/headers" | tr -d '\r' | sed 's/[[:space:]]*$//' > "$D/etag"
           prev=$(cat "$D/seen" 2>/dev/null || echo "")
           if [ "$last" != "none" ] && [ "$last" != "$prev" ]; then
             echo "$last" > "$D/seen"; echo "NEW GREPTILE ROUND at $last"
           else echo "no new greptile round"; fi
         fi ;;
    *)   echo "CHECK FAILED (http $code) — not the same as no change" ;;
  esac
  ```
  The `seen` marker keys on the **summary comment's `updated_at`** — the summary is
  Greptile's FIRST issue comment (`min_by(.created_at)`), edited in place forever, so
  `created_at` never changes and later bot replies in the thread must not shadow it.
  State files are per-PR so successive ticks share them; the corollary is that two
  sessions must never loop the same PR concurrently. A human commenting must not read as a new round. Inline-only updates
  (rare) won't trip this endpoint; when a round seems missing, fetch both endpoints
  from §1 once.
- **Bound the wait.** Greptile does not always re-review a draft push. If no new
  round arrives after **a few checks spanning ~2 hours** (or the user's patience, whichever
  ends first), stop and report exactly that: the fixes are pushed, the standing score
  belongs to the previous revision, and the next likely trigger is another push or the
  user marking the PR ready for review. An unattended loop with no bound is a stuck
  session, not diligence.

## 5. Exit

- **5/5 for the current revision** (check the round's timestamp against the latest
  push) **→** report it plainly with the round-by-round history: what was fixed, what
  was declined and why. **Do not mark the PR ready for review** — same rule as `ship`:
  that click is the user's, always.
- **Stopping rule fired →** present the finding chain and the defense for the current
  state; the user decides whether to push back on the review or concede a change.
- **No re-review within the bound →** report the wait state honestly (see §4) and
  stop; the loop resumes on the next round's arrival, from whatever channel.
- **Round needs a code change bigger than a finding-fix** (a redesign, a new control) →
  that is `develop` work; hand it there with the finding as the brief, then come back.
