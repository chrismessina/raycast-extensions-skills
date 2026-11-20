---
name: raycast-pr-loop
description: Drive a submitted Raycast Store PR through its automated reviewers — Greptile (scored N/5), plus any bot that joins it — until every reviewer is clear for the current revision. Fetches each round from EVERY bot through the `rx` runner, triages every finding (fix the valid, answer the invalid with receipts), re-publishes through the same gates `ship` requires, replies in each finding's thread only when `rx greptile can-reply` authorizes the exact reply, and waits for the next round with ONE bounded check, never a resident poller. Fires on "address the greptile feedback", "loop until 5/5", "greptile gave us N/5", "address the review bots", or a pasted bot review. Runs AFTER `ship` has opened the PR. Does NOT mark the PR ready for review — that is always the user's click, and the plugin's guard blocks it.
metadata:
  stage: "7b — automated-review feedback loop on an open Store PR"
---

# raycast-pr-loop

Greptile is the reviewer Raycast runs on Store PRs (Chris, 2026-10-28: Greptile alone again; the
name stays generic because §1 still reads every bot). The loop: fetch the round from ALL bots → triage
each finding → fix the valid, answer the invalid → gates → re-publish → reply in every finding's thread
→ wait → repeat, until EVERY bot is clear for the CURRENT revision, the stopping rule fires, or the
no-re-review bound is hit.

Every mechanical step runs through the plugin's `rx` runner: `node`, then `"<plugin>/scripts/rx.mjs"`,
then a command, its subcommand and flags, where `<plugin>` is the `raycast-extensions` plugin directory, two
levels above this skill's base directory. Each command prints `VERDICT  check-id  message` lines and
exits 0 (PASS/WARN/N/A only), 1 (a FAIL) or 2 (an ERROR): branch on the exit code and quote the
FAIL/ERROR lines; never re-derive a check in prose or shell. Flags and `data`: [`reference/rx.md`](../../reference/rx.md).

**Marking the PR ready for review is never done here** — Chris's click; the guard blocks `gh pr ready`, `draft=false` and the GraphQL mutation.

## 1. Fetch the round — from every bot

Greptile, through the runner — even when the user pasted the round: `can-reply` (§3) only authorizes a reply against a round the runner has STORED.

```bash
PR=<N>
node "<plugin>/scripts/rx.mjs" greptile fetch "$PR" --json
# exit 0, PASS greptile-round → data.head (full SHA), data.round.{updatedAt, score, reviewedCommit, summary, findings[].{id, path, line, originalCommitId, body}}
# exit 0, N/A no Greptile review on #N yet. Without --json only the verdict line prints (counts, 7-char SHAs): use --json.
```

`data.round.summary` is the summary comment's full body: the score lives there, and so does any
**summary-only finding** (actionable text with no inline comment) — read it for those, every round.
Census of every other bot, so a reviewer Raycast adds later cannot go unread (raycastbot's "Thank you
for the update!" is not a review); a login not in the table → read that bot's comments, work out its clear signal, add a row.

```bash
for ep in issues/$PR/comments pulls/$PR/comments pulls/$PR/reviews; do
  gh api --paginate "repos/raycast/extensions/$ep" --jq '.[] | select(.user.login | endswith("[bot]")) | .user.login'
done | sort | uniq -c
```

| Bot | Login | Where its round lives | Clear when | Reply channel |
|---|---|---|---|---|
| **Greptile** | `greptile-apps[bot]` | one summary issue comment, edited in place (score `N/5`, `Last reviewed commit`), plus inline review comments | **5/5** and `reviewedCommit` is a prefix of `head` | in-thread reply prefixed **`@greptile`** |

- **Tie the score to a revision.** The score is sticky until a re-review runs. `reviewedCommit` is a
  7–40 hex prefix, `head` is full length: compare by prefix, and when `reviewedCommit` is not a prefix of
  `head` the score graded a previous revision. (Receipts: [`reading-a-greptile-round`](../../learnings/workflow-issues/reading-a-greptile-round.md).)
- **New vs carried-forward finding: `originalCommitId`, never `commit_id`**, which GitHub rewrites
  to the newest commit for every comment whose lines did not move.
- **Outdated** means *probably answered*: confirm the change addressed the concern. A fix in a
  different file leaves the comment un-badged and standing; un-badged is not unaddressed.

## 2. Triage — every finding gets a verdict, and "valid" is not automatic

> 🚨 **First: has Chris already ruled on this?** An explicit instruction from him ("make X the default
> action", "I want the extra docs shipped", "leave that as-is") is a standing verdict that outranks a
> review finding. When a finding contradicts it: **do not fix it**, not even to clear the score; name
> the conflict in your report, quoting him; draft the push-back reply with receipts for him to post; let
> him decide. Record the decision at the code (a comment at the call site naming who decided and why).

**Greptile's own rules settle some findings before any code is read**:
[`reference/greptile-rules.md`](../../reference/greptile-rules.md) (full text in the `raycast-harness`
snapshot it names). Decline by quoting the rule ID: a missing ellipsis on an `ActionPanel.Submenu`
(it adds its own, `rules.md`); code the PR does not touch (pre-existing gets one note, never a block);
a page cap, timeout or result limit called a bug (safety bounds); "use a `password` preference so it
is encrypted" (all are, `preference-storage`); "replace with `getFavicon()`" when the custom code adds
validation, racing, refresh or sources it lacks (`favicon-utility`); "replace `{PR_MERGE_DATE}`" or
"add `[Unreleased]`" (`changelog-entries`); a re-raise of a thread you answered with a reason the code
backs. `no-dev-material` on contributor `docs/` in a self-authored extension: declined, it ships by
policy (`greptile-rules.md`, *Our policy for the file rules*). Any other path those rules name is real,
`AGENTS.md` / `CONCEPTS.md` included (Chris, 2026-11-03, after a P1 on cosign #33077: *"we DO need to
remove AGENTS.md after all"*): not yet on `main` → the extension's `.gitignore` (`git rm --cached`, kept
in the mirror); on `main` → delete it in this PR (for the four mirror files, a `remove-published` disposition on `stale-remove`), except `brew`/`dev-null` `TODO.md`, a published `LICENSE`, and a published `CONTRIBUTING.md` (`brew`, `reader-mode`; Chris, 2026-11-19). Two former rules still hold on the merits: a ref-gated deferred execution is not a dropped request; Windows media-session limits are not bugs.

For each finding, decide and say which — the judgment is `review-finding-triage` (`valid` /
`valid-wrong-remedy` / `false-positive` / `conflicts-with-chris`), recorded in the round's audit:

- **Valid → fix it.** Code changes are [`develop`](../develop/SKILL.md)-grade work: house style,
  test-first where a pure helper is involved, the user-level `codex-gate` skill on its own threshold.
- **Valid symptom, wrong implied remedy → measure the implied remedy** against what you have and
  report the number, including when it loses.
- **False positive → answer with receipts, change nothing.** The canonical one, "Merge Date Is
  Hardcoded" on a CHANGELOG date raycastbot stamped: the receipt names the stamping commit ("Update
  CHANGELOG.md", author raycastbot, touching only `CHANGELOG.md`) from `gh api "repos/raycast/extensions/pulls/$PR/commits"`.
- **Confidently wrong API claim, repeated across rounds → disambiguate the code, don't debate.**
  Rewrite the call site so no reader can misread it; reply in-thread only when it cannot be made clearer.
- **The append rule ("new actions should be appended") — wrong half the time.** Apply the
  Enter-default test in [`reference/keyboard-conventions.md`](../../reference/keyboard-conventions.md),
  *Action ORDER on an update*; a section shipping for the first time in this PR (`gh api
  …/pulls/$PR/files` reports the file `added`) has no prior Enter default, so the rule does not apply.
- **Two reviewers, opposite findings → solve the underlying state**, or the other half comes back.
- **Race or concurrency finding → the human-speed test before any fix.** A Raycast extension has one
  person at a keyboard: a race is valid only if that person can hit it at human speed (typing fast
  into a search bar, pressing Enter twice, a slow response landing after they moved on); one needing
  two events within the same few milliseconds is **declined**, naming the timing in a sentence.
  **Exception:** a race the extension sets off itself from one action (a fetch and its revalidation
  resolving out of order, a double render, two handlers on one event) is valid however tight. No lock,
  mutex or split storage keys for a declined race; if a human-speed version exists, fix that one.

**The round bound:** after **three rounds** without every bot clear, stop looping autonomously and
present the round history. A round is any re-publish or reply in response to any bot; a reply-only
round of declines counts the same, so a bot that keeps re-raising declined findings hits the bound.
**The stopping rule:** if a round's findings exist only because of the previous round's fix, stop,
show the chain, and let the user call it. A review engine always has one more finding.

<!-- learnings:start -->
| When you are about to… | Read |
|---|---|
| comply with a review finding, answer a rating that will not clear, or act on a collision or value you cannot reproduce | [`verify-the-remedy-not-just-the-finding`](../../learnings/workflow-issues/verify-the-remedy-not-just-the-finding.md) |
| read or answer a greptile round on an open store pr | [`reading-a-greptile-round`](../../learnings/workflow-issues/reading-a-greptile-round.md) |
| start a third review pass that is finding defects in the previous pass's fixes | [`count-the-review-layers-not-the-findings`](../../learnings/workflow-issues/count-the-review-layers-not-the-findings.md) |
| wait for the next greptile round | [`waiting-for-greptile-without-watchers`](../../learnings/workflow-issues/waiting-for-greptile-without-watchers.md) |
<!-- learnings:end -->

## 3. Land the fix and answer the round

1. **Code changes go through `develop`**, then commit; the message names the round (`Addresses
   Greptile review on #<N>`) and **never contains the word publish — nor does any Bash command other
   than the publish itself**: the guard blocks every other command containing it.
2. **Re-publish through `ship`'s gates, in exactly this order, one Bash invocation per line** (the
   guard reads the whole tool command; a multi-line command is denied). The evidence contract — audit
   entries, the `pull-contributions` merge, the forbidden list `$FORBID` kept outside the root — is
   [`ship`](../ship/SKILL.md)'s. The holdout comes **first**: held-out files are part of the payload
   fingerprint, so moving them after `gates` would stale the receipt. `$ENTRIES` lives outside the root.

   ```bash
   node "<plugin>/scripts/rx.mjs" holdout out
   node "<plugin>/scripts/rx.mjs" gates --forbidden "$FORBID"
   node "<plugin>/scripts/rx.mjs" shortcuts runtime
   node "<plugin>/scripts/rx.mjs" audit record --entries "$ENTRIES"
   ```

   ```bash
   npm run publish
   ```

   ```bash
   node "<plugin>/scripts/rx.mjs" publication record raycast/extensions "$PR" "$REMOTE_SHA"
   node "<plugin>/scripts/rx.mjs" holdout in
   ```

   The publish is its own invocation: exactly `npm run publish`, nothing else on the line. `holdout
   out` moves only untracked local-only entries and records an inventory; `holdout in` restores and
   verifies every entry. An empty inventory while a **movable** local-only path exists (untracked, not
   in the preset's `ship.keep`) is `ERROR holdout-inventory`, never "nothing to hold out"; a **tracked**
   local-only path is `FAIL holdout-tracked`: `git rm --cached` it and list it in `.gitignore`.
   `shortcuts runtime` runs once per installed Raycast version. Any tree change after `gates` stales
   the receipt (the guard says so): `holdout in`, fix, start again. `$REMOTE_SHA` is the PR head after
   the publish (`gh api "repos/raycast/extensions/pulls/$PR" --jq .head.sha`) and must differ from the
   fetched `head`; if not, no revision landed: post no fix claim, report that. Never write under `.git/rx/`.
3. **Reply to every inline finding in its own thread, whether fixed, partly fixed or declined**
   (Chris, 2026-09-26): an unanswered finding reads as ignored and re-fires next round; a reply tunes
   the rule fleet-wide. Every reply is authorized first, then posted byte-for-byte:

   ```bash
   # $T = a session temp dir outside the extension root; $FINDING_ID = the finding's comment id. Evidence JSON:
   # { "finding": $FINDING_ID, "disposition": "fixed" | "partial" | "declined", "artifact": "<remote sha, measurement or ruling>", "explanation": "…" }
   node "<plugin>/scripts/rx.mjs" greptile can-reply "$PR" --round "<updatedAt>" --finding "$FINDING_ID" --expected-head "$EXPECTED" --forbidden "$FORBID" --reply "$T/reply-$FINDING_ID.md" --evidence "$T/evidence-$FINDING_ID.json"
   gh api -X POST "repos/raycast/extensions/pulls/$PR/comments/$FINDING_ID/replies" -F body=@"$T/reply-$FINDING_ID.md"
   ```

   `--round` is always the fetched round's `updatedAt`. `--expected-head` is checked against the
   **current** remote head for **every** disposition: `$EXPECTED` is `$REMOTE_SHA` once anything was
   published this round (declines included — a decline passed the fetched `head` after a publish fails
   `reply-head`), else the fetched `head`. `--claims-fix` only for `fixed` or `partial`: it requires
   step 2's publication record at that SHA, different from the round's `reviewedCommit`; any disposition
   other than `declined` without it is `ERROR reply-evidence`. **A partial answer is a fix claim and
   needs the publish; only a receipt-backed `declined` passes on an unchanged head**, which is what makes
   a reply-only round of declines possible. Exit 1 or 2 → post nothing and quote the line (`reply-round`,
   `reply-head`, `reply-evidence`, `reply-publication`, `reply-scan`); authorization covers exactly those bytes at that head.
   - **Terse: two or three sentences**, opening with `@greptile`, then verdict and mechanism: "Fixed
     in `<remote sha>`. <what changed, naming the function or file>" — the remote SHA, never a local one
     (`ray publish` makes its own commit). No "You're absolutely right" or "Good point". A partial fix
     says what remains; a decline gives the receipt in place of the fix. An Outdated finding still gets
     its reply. **A finding Chris ruled on** (§2): show him the draft; post only when he says to.
   - **Summary-only findings** (read from `data.round.summary`, §1; no inline comment to reply to): one
     `@greptile` issue comment, written to a file, scanned with `node "<plugin>/scripts/rx.mjs" scan --forbidden "$FORBID" --pr-text "$T/comment.md"`,
     posted with `gh api -X POST "repos/raycast/extensions/issues/$PR/comments" -F body=@"$T/comment.md"`. A score with no findings needs no reply.
   - Reply to the finding's own top-level comment (GitHub rejects a reply to a reply). Public, under
     Chris's name: no attribution, no session links, US English.

## 4. Wait for the next round — one bounded check

No resident watcher, no sleep loop at any interval, no webhook (a contributor cannot install one on
`raycast/extensions`), and the summary footer's re-trigger link is staff-only (history:
[`waiting-for-greptile-without-watchers`](../../learnings/workflow-issues/waiting-for-greptile-without-watchers.md)).
The one contributor-side lever is an `@greptile` reply (§3). A check is a single runner call:

```bash
node "<plugin>/scripts/rx.mjs" greptile wait "$PR"
# PASS  greptile-wait new round <updatedAt>  → §1, unless <updatedAt> equals the round you already fetched: then it is not new
# N/A   greptile-wait no change              → report the state and stop; resume on the user's next message
# ERROR greptile-wait …                      → "check failed", never "no change"; say so
```

- **Prefer event-free waiting:** report the state, stop, check on the user's next message (their
  Greptile dashboard beats the API). **Unattended looping only when the user asks:**
  `/loop` with a **≥ 15 minute** interval, each tick exactly the one call above; two sessions never loop the same PR.
- **Bound the wait.** Greptile is not guaranteed to re-review a draft push. No new round after **a
  few checks spanning ~2 hours** (or the user's patience) → stop and report exactly that: the fixes
  are pushed; the standing score belongs to the previous revision when `reviewedCommit` is not a
  prefix of `head`; the next likely trigger is another push or the user marking the PR ready. An
  unbounded loop is a stuck session, not diligence.
- Raycast's stale bot labels a PR `status: stalled` after **25 days** without activity and closes it
  **7 days** later; include the last-activity date in the stop report when it is past 3 weeks. A red
  `Ensure Maintainer Can Modify` check is not a reviewer: tick "Allow edits by maintainers" on the PR page.

## 5. Exit

- **Every bot clear for the current revision** (Greptile 5/5, `reviewedCommit` a prefix of `head`) →
  report it with the round-by-round history: what was fixed, what was declined and why. **Do not mark
  the PR ready for review** — the user's click, always.
- **Stopping rule fired** → present the finding chain and the current state's defense; the user decides.
- **No re-review within the bound** → report the reviewer's state honestly (§4) and stop; the loop resumes when a round arrives.
- **A round needs more than a finding-fix** (a redesign, a new control) → `develop` work; then come back.
