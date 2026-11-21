---
title: A fork's package-lock.json lags upstream — clearing stale-upstream without reverting Raycast's bump
date: 2026-11-21
category: workflow-issues
module: publishing
component: development_workflow
problem_type: workflow_issue
severity: medium
applies_when:
  - "rx stale reports FAIL stale-upstream on package-lock.json of a forked Store extension"
  - "ray publish says 'some contributions are available' and pull-contributions conflicts only on package-lock.json"
tags:
  - rx-stale
  - package-lock
  - pull-contributions
  - fork
related_components:
  - development_workflow
applies_to: ["ship", "develop"]
trigger: "when you are about to clear stale-upstream on a fork's package-lock.json or resolve a pull-contributions conflict that touches only the lockfile"
---

# A fork's package-lock.json lags upstream

## Context

sf-symbols-search (PR raycast/extensions#33802, 2026-11-20) was a fork of an extension whose single local
commit equalled the Store copy at fork time. By the time it shipped, the Store copy's `package-lock.json`
had moved: Raycast's dependency tooling bumped esbuild from 0.25.11 to 0.27.7 after the fork. Nothing
else under the extension had changed upstream.

## Symptom

`rx gates` (rx 0.2.0) failed `stale-upstream` on `package-lock.json`: "published blob not found in this
path's history". Publishing would have reverted the bump. (rx 0.1.4 classified the same state as `CHECK`,
a WARN; 0.2.0 reads the path's own history, so a lock that never passed through it is `UPSTREAM`.)

## Fix, in this order

1. Copy the published lockfile verbatim into the tree and commit it alone. The sparse copy `rx stale`
   fetches is under `~/.cache/raycast-harness/upstream/extensions/<name>/package-lock.json`. The commit
   exists so the published blob is in the path's history.
2. Run `npm install` and commit the regenerated lockfile. Our `package.json` has moved on, so the lock
   must too; it now builds on the published one instead of ignoring it.
3. Re-run `rx gates`: `package-lock.json` is now `CHECK` (WARN). Record `keep-local` for it in the audit,
   reason naming both commits.
4. `ray publish` may still stop at "some contributions are available". Commit first, keep the holdout out,
   then `npx @raycast/api@latest pull-contributions --non-interactive`. The only conflict was
   `package-lock.json`; `rx contributions --published "$PUB_DIR"` reported `OURS-SAFE` (incoming blob ==
   published blob). Take ours for that file, `git add` it, `git commit --no-edit`, then re-run gates and
   the audit, because HEAD moved.

## Why not the shortcuts

Taking the published lock wholesale drops our dependency changes and breaks `npm ci`. Publishing the
regenerated lock without step 1 keeps the FAIL, and a forced override would revert Raycast's bump.

## Prevention

`develop` runs `rx stale` at entry. On a fork, do steps 1 and 2 before the first feature commit, so the
lockfile never diverges silently.
