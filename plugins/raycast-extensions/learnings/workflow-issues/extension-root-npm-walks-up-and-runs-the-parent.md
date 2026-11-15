---
title: "npm resolves the extension by walking UP to the nearest package.json — a parent with its own scripts runs them silently, exit 0"
date: 2026-07-24
last_updated: 2026-10-31
category: workflow-issues
module: skills
component: development_workflow
problem_type: workflow_issue
severity: high
applies_when:
  - "Running `npm run dev|build|lint|publish` or `npx ray …` from anywhere other than a resolved extension root"
  - "An npm-flavored error (`ENOENT … package.json`, `could not determine executable to run`) appears while working on a Raycast extension"
  - "Working inside a monorepo checkout, a sparse checkout, a PR-review fork, or the skills plugin's own repo"
applies_to: ["develop", "ship", "review-pr"]
trigger: "when you are about to run npm or ray from anywhere but a resolved extension root"
tags:
  - extension-root
  - npm
  - ray
  - monorepo
  - sparse-checkout
  - house-style
---

# npm resolves the extension by walking UP to the nearest `package.json` — a parent with its own scripts runs them silently

The policy is the `extension-root` rule in
[`house-style.md`](../../reference/house-style.md#extension-root): resolve the root
explicitly, `cd` there, stay there. This file holds the measurements that made it a rule, and the
history of the shell resolver that `rx`'s root resolution replaced.

## Context

`npm install`, `npm run dev`, `npm run publish`, and `npx ray develop|build|lint` resolve the
manifest by walking up from the current directory to the nearest `package.json` — not by finding
"the extension." Run one from the wrong place and you either get an npm-flavored error that blames
tooling instead of your path, or — worse — you silently operate on a *different* package.

## What was measured

**Measured 2026-07-24** (`raycast-wrap-unwrap`, git 2.50.1, npm/npx; `ray` is *not* on `PATH` —
extensions invoke it via `npx` or an npm script, so always write `npx ray …`):

| Where you run it | `npm run dev` | `npx ray lint` / `npx ray build` |
|---|---|---|
| Extension root | works (`ray develop` starts) | works, exit 0 |
| **Subdirectory** of the extension (e.g. `src/`) | works — npm walks *up* to the nearest `package.json` | works |
| Parent with **no** `package.json` above it | `npm error code ENOENT … path …/package.json` | `npm error could not determine executable to run` |
| Parent that **has** its own `package.json` | **silently runs the PARENT's script, exit 0** | `could not determine executable to run` |

**The last row is the dangerous one, and it is why the rule exists.** Verified with a decoy
`{"name":"PARENT-DECOY","scripts":{"dev":"echo RAN_PARENT_SCRIPT"}}` one level up: `npm run dev`
printed `RAN_PARENT_SCRIPT` and **exited 0 with no error at all.** So the failure is not reliably
a clean error — it can be the *wrong package* quietly running or installing. The skills plugin's
own source repo is exactly such an ancestor: a `package.json` with `format` scripts and no
extension in it, so npm's upward walk finds it and runs *that* instead of erroring.

When you *do* get an error, it **names npm and never Raycast** — nothing says "manifest" — so it
reads like a broken install and sends you debugging a dependency. (`npx ray …` is the more
confusing: "could not determine executable to run" sounds like `ray` is not installed.)

**So never rely on an error to tell you you are in the wrong directory.** Resolve the root
explicitly and `cd` there before running anything.

## The two topologies

The extension root is the directory holding the `package.json` **that carries Raycast keys**
(`commands`, `title`, `icon`) — not merely any `package.json`:

| Topology | Repo root | Extension root |
|---|---|---|
| Standalone repo (e.g. `chrismessina/raycast-<name>`) | = extension root | the repo root itself |
| Monorepo (`raycast/extensions`, incl. sparse checkouts and PR-review forks) | monorepo root | `extensions/<name>/` |

After a sparse checkout or a PR-review fetch you are sitting in the monorepo root with exactly
one extension materialized under `extensions/<name>/` — it *feels* like the project root, and the
error blames tooling instead of the path.

## The shell resolver, and why it was retired

Until 2026-10 the rule shipped a bash `find_ext_root()` that tested
`jq -e '(.commands|type=="array") and (.commands|length>0)'` on each `package.json`, walking up
first and then searching descendants. Two of its bugs are worth keeping as evidence for whatever
resolves roots next:

- **Testing `.commands` alone is too loose.** `{"commands":"anything-truthy"}` passes `jq -e` and
  would misidentify the root (verified 2026-07-24). The test has to be *a non-empty array*.
- **Walk UP first, THEN search descendants.** You are usually already *inside* the extension, and
  a bare `find .` only looks downward — from `myext/src/lib` it silently returned nothing (bug
  found and the fix verified against a disposable tree, 2026-08-10).

`rx` now resolves the root for every command that takes an extension (`--root <dir>` wins;
otherwise walk up from cwd to the nearest `package.json` with a `commands` array; if none, search
downward one level; more than one candidate → `ERROR` asking for `--root`). The shell function is
gone from the policy because a resolver re-typed into a shell is the class of defect `rx` exists
to remove, not because the rule changed.
