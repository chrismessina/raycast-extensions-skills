---
title: Reading a Greptile round — the receipts behind the loop's triage rules
date: 2026-10-31
category: workflow-issues
module: publishing
component: development_workflow
problem_type: workflow_issue
severity: medium
applies_when:
  - "Reading a Greptile score or inline finding on an open Store PR"
  - "Deciding whether an inline finding is new or carried forward from an earlier round"
  - "About to comply with a finding that contradicts something Chris asked for"
  - "A reviewer repeats an API claim you have verified false"
  - "Answering a finding in its thread"
tags:
  - greptile
  - code-review
  - store-pr
  - receipts
related_components:
  - development_workflow
applies_to: ["raycast-pr-loop"]
trigger: "read or answer a greptile round on an open store pr"
---

# Reading a Greptile round — the receipts behind the loop's triage rules

## Context

`raycast-pr-loop` states each rule in one line. This file holds the incidents that produced them,
moved out of the skill on 2026-10-31 so the skill stays procedure. `rx greptile fetch` now returns
the fields these incidents taught the loop to read (`reviewedCommit`, `originalCommitId`, the
summary's `updatedAt`), and `rx greptile can-reply` enforces the reply rule.

## The loop's shape

attio 2.0 (raycast/extensions#30881) went 3/5 → 4/5 → 5/5 across three rounds, and the create/AI
release (#30956) went 4/5 → 5/5 in one. Every round was triaged; some findings were fixed, some
answered with receipts. Neither needed a fourth round, which is where the three-round bound comes
from.

## The score is sticky, and the summary is one comment edited in place

Greptile's summary is its first issue comment on the PR, edited in place on every re-review, so
`created_at` never moves and only `updated_at` (or the body) signals a new round. The score does not
drop or refresh on a push: it stays at its last-evaluated value until a re-review runs. A score older
than the newest push graded a previous revision. Compare the summary's `updated_at` with the time the
push *completed*, not `git log --format=%cI`, which is the authoring time and can predate the push by
hours. `rx greptile fetch` exposes this as `reviewedCommit` beside `head`.

## `commit_id` is rewritten; `original_commit_id` is not

On #31927 a comment raised at `cb9a51a` read `commit_id 2debfc1` an hour after a push, with no new
review: GitHub rewrites `commit_id` to the newest commit for every comment whose lines did not move,
so an old finding carried forward looks new. Filter on `original_commit_id` (`originalCommitId` in the
fetch data). The `commit` an inline listing prints is where the comment sits now, not where it was
raised.

## The Outdated badge is a hint, not a verdict

GitHub marks an inline comment Outdated when the diff lines it anchors to change. On digger, the
themeUtils/colorUtils/fetcher comments were badged as fixes landed, which was right. But an edit that
moves the anchored lines without touching the logic earns the badge without earning the fix, and a
fix that lands in a different file leaves the comment un-badged and standing: reader-mode #29451
(2026-07-15) carried seven such comments across four commits after the root cause was fixed. Read
the badge as *probably answered*, confirm against the change, and reply either way so the thread shows
it was seen.

## The `@greptile` reply channel works, and tunes the rule fleet-wide

A plain reply is ignored; one prefixed `@greptile` draws the bot. On #31927 it answered both fix
replies within about 25 seconds and withdrew both findings. On claude-artifacts #30626 a posted
reasoning drew "I reconsidered it … I'm withdrawing the concern. No change is needed." Replies also
tune the rule ("I'll remember it for next time!"), and a declined finding left unanswered re-fires on
the next PR. Chris made "reply to every finding, fixed or declined" a standing instruction on Mercury
#31611 (2026-09-26). The reply opens with `@greptile`, then the verdict and mechanism, in two or three
sentences, and never with "You're absolutely right" (Raycast's `rules.md` asks the bot not to write
that way, and a reply that opens with it reads the same).

**Why the reply rule had to become `rx greptile can-reply` (audit P1, 2026-10-30).** The skill used
to allow a reply only after a successful publish *and* a changed remote head, which made a round of
receipt-backed declines impossible to answer without manufacturing a revision. `can-reply` separates
the two: `fixed` and `partial` are fix claims and need `--claims-fix`, which requires a publication
record at a new remote SHA (any other disposition without the flag is `ERROR reply-evidence`); only a
receipt-backed `declined` passes on an unchanged head. It also scans the exact reply bytes with the forbidden list and
records the authorization, so a reply that quotes a reproduction URL cannot slip past the way a
commit message would be caught.

## A standing ruling from Chris outranks a finding

digger #30957 (2026-09-11): the append-rule finding hit `sectionActionsFirst`, a default Chris had
asked for twice in the same session. It was complied with without flagging the conflict, shipped
reverted, and had to be restored in the following release. The score went to 5/5 by removing the
thing he asked for. The rule since: do not fix it, name the conflict quoting him, draft the push-back,
let him decide, and record the decision at the code.

## A confidently wrong API claim does not yield to debate

get-app-icon #29739 (2026-07-27): Greptile insisted `FileManager.replaceItemAt` throws on a missing
destination. Verified false three times on a live system, and the claim survived re-reviews anyway.
What cleared it was rewriting the call site to branch explicitly on file existence, so no reader, bot
or human, could misread the path. When the code genuinely cannot be made more explicit, the
`@greptile` reply is the fallback.

## Two reviewers, opposite findings

Codex flagged "untouched checkbox displays unchecked while the server default writes true"; Greptile
later flagged "untouched checkbox overrides the workspace default." Omitting *and* seeding the static
default into the display satisfied both. Fixing only the current reviewer's half brings the other half
back next round.

## The holdout and `ls`

On #32975 (2026-10-30) the secret holdout's `/bin/ls -A` listing was typed as bare `ls`, which Chris's
shell rewrites to a filtering `eza`: `.claude` was hidden, nothing moved, the inventory came back
empty, and the listing then hung so the publish never started. `rx holdout out` replaces the hand
procedure; its `holdout-inventory` check is an ERROR, not a pass, when the inventory is empty while a
preset-listed local-only path exists.
