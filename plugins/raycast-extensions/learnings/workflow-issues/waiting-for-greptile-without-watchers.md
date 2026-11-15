---
title: Waiting for Greptile without watchers — why the wait is one bounded check
date: 2026-10-31
category: workflow-issues
module: publishing
component: development_workflow
problem_type: workflow_issue
severity: medium
applies_when:
  - "Waiting for a Greptile re-review on an open Store PR"
  - "Tempted to leave a background shell polling the GitHub API"
  - "Looking for a way to make Greptile re-review sooner"
  - "Deciding when to stop waiting and report"
tags:
  - greptile
  - polling
  - store-pr
  - resource-limits
related_components:
  - development_workflow
applies_to: ["raycast-pr-loop"]
trigger: "wait for the next greptile round"
---

# Waiting for Greptile without watchers — why the wait is one bounded check

## Context

`raycast-pr-loop` §4 is one runner call, `rx greptile wait <N>`, and two bounds. This file holds
the history behind that shape, moved out of the skill on 2026-10-31.

## Resident watchers die on this machine

Observed 2026-09-10 (cause inferred, not proven): three background watcher shells in a row, with
30-second, 60-second and 300-second sleep loops, were killed with the harness reporting low system
memory, and `gh`'s 1Password credential helper stalled (`authorization timeout`) in the same window.
Whatever the exact kill order, a resident background shell is unreliable here and burns resources the
whole time it waits. A longer interval did not help: the 300-second version died the same death as
the 30-second one. The rule since is no persistent sleep-loop watcher at any interval. When the user
explicitly wants unattended looping, `/loop` with a ≥ 15 minute interval runs one single-shot check
per tick and holds no shell between ticks; an improvement over a resident watcher, not a survival
guarantee.

## The single-shot check, and why "check failed" is never "no change"

The hand-written check was an unauthenticated `curl` (no credential helper) with `--max-time`, a
per-PR temp path so concurrent sessions could not cross-read, an ETag conditional request so quiet
polls stayed cheap, and an explicit status branch so a failure read as "check failed" rather than
"no change". The `seen` marker keyed on the summary comment's `updated_at` (the summary is Greptile's
first issue comment, edited in place forever, so later bot replies in the thread must not shadow it),
and a human commenting must not read as a new round. Inline-only updates are rare and do not trip the
issue-comments endpoint; when a round seemed missing, both endpoints were fetched once.

That curl recipe is history. `rx greptile wait` keeps three things from it and changes the transport:
one ETag-conditional request per call, summary-round detection keyed on the summary comment's
`updated_at` (stored as `seen`), and distinct failure reporting (`PASS new round <updated_at>`,
`N/A no change (304)` when nothing on the endpoint changed, `N/A no new round` when the endpoint
answered 200 but the summary's `updated_at` still equals `seen` (a human comment or an inline-only
edit changed the ETag without a new round), `N/A` with "has not reviewed" when there is no summary
yet, `ERROR greptile-wait` on anything else, never a bare "no change"). It does **not**
reproduce the unauthenticated curl: it runs `gh api --include` through the shared `gh` wrapper
(`src/pr/transport.mjs` in core), so the request is authenticated, the credential helper is in the
path, and there is no explicit `--max-time`. The anonymous-quota arithmetic below describes the old
recipe only. The state (etag, seen) lives under the extension's repo state, so two sessions must never
loop the same PR concurrently. `fetch` writes `seen` too (the round it fetched is the wait baseline),
so the first `wait` after a fetch reports that round as `N/A no new round`, not as a new one; an
earlier build left `seen` unset after a fetch and the first `wait` re-announced the fetched round.

The old recipe's quota reasoning, for the record: GitHub exempts *authenticated* 304s from the limit,
so the unauthenticated saving was bandwidth, not quota; 60 anonymous requests an hour minus a
15-minute cadence's four calls left ample headroom either way.

## Levers that do not exist for a contributor

- **The summary footer's re-trigger link** (`https://app.greptile.com/api/retrigger?id=<PR_ID>`)
  looks like the lever, but it works only for Raycast staff; Chris tried. Contributors wait for
  Greptile's own cadence (it re-reviews after pushes, with lag), and an `@greptile` reply on a finding
  is the one contributor-side way to draw the bot's attention.
- **GitHub webhooks** need admin on `raycast/extensions`, which a contributor does not have. On a repo
  you do own, `gh webhook forward` exists via the official `cli/gh-webhook` extension
  (`gh extension install cli/gh-webhook`), but a Store PR lives upstream.

Neither is worth a session rediscovering.

## The two bounds

Greptile is not guaranteed to re-review a draft push. The loop stops after a few checks spanning
about two hours (or the user's patience, whichever ends first) and reports exactly that: the fixes
are pushed; a standing score whose `Last reviewed commit` is older than the head belongs to the
previous revision; the next likely trigger is another push or the user marking the PR ready. The
other bound is the three-round bound on changes. One limits waiting, the other limits repeated
changes; the audit's keep list names both.

## The PR's own clock

Raycast's `stale.yml` labels a PR `status: stalled` after 25 days with no activity and closes it 7
days later, unless it carries an exempt label (`api`, `documentation`, `dev tools`, `app`,
`status: blocked by API`, `rename`, `Dont close`). It scans every 4 hours, so a push or comment clears
the label on the next scan, not instantly. A red `Ensure Maintainer Can Modify` check is a different
thing: it fails a fork PR whose "Allow edits by maintainers" box is off, and ticking the box on the
PR page fixes it with no code change.
