# Sparse-checkout discipline (Throughline A — hard rail)

**Never clone or sync the full `raycast/extensions` monorepo.** It is thousands of extensions and
gigabytes of assets. A full clone wastes minutes, fills the disk, and buries the one directory you
actually care about.

Cited as a hard rail by `develop`, `ship` and `review-pr`. Every monorepo read or write goes
through one of two paths:

- **The staleness read — "is my local `main` what is published?" — is `rx stale`.** It sparse-fetches
  the published copy into the cross-repo cache itself (`cache/upstream/`), so there is nothing to
  clone by hand. See [Verifying local `main`](#verifying-local-main-against-the-published-version).
- **Everything else** (a review clone of someone else's PR, the fork write path) uses the manual
  procedure below.

## The rule

> Fetch exactly one path — `extensions/<name>/` — and nothing else.

This applies to *reads* just as much as *writes* (syncing a change into the fork before a PR). The
read case is the one that gets skipped, because "I just want to look at it" feels cheap. It is not —
a naive `git clone` of the monorepo is the expensive mistake this file exists to prevent.

## Procedure — sparse checkout of one extension

```bash
# 1. Clone with NO working tree and NO blobs. Fast: refs only.
git clone --filter=blob:none --no-checkout \
  https://github.com/raycast/extensions.git monorepo
cd monorepo

# 2. Restrict the working tree to a single extension directory.
git sparse-checkout init --cone
git sparse-checkout set extensions/<name>

# 3. NOW materialize the tree. Only extensions/<name>/ appears.
git checkout main
```

`--filter=blob:none` defers blob download until checkout; `--cone` + `set` restricts that checkout
to one directory. Together they mean you pay for one extension, not thousands.

Verify you got what you asked for — the working tree should contain `extensions/<name>` and no
sibling extensions:

```bash
/bin/ls extensions/         # expect exactly: <name>  (/bin/ls: rtk rewrites a bare `ls`)
git sparse-checkout list    # expect exactly: extensions/<name>
```

## Adding the fork remote (for the `ship` write path)

The clone above points at upstream (read-only to you). PRs are pushed from your fork:

```bash
ME=$(gh api user --jq .login)   # your GitHub login — the fork owner
git remote add fork "https://github.com/$ME/extensions.git"
git checkout -b update/<name>-<topic>
# ... copy the files that ship into extensions/<name>/ ...
git push fork update/<name>-<topic>
```

Keep upstream as `origin` (you fetch from it) and the fork as `fork` (you push to it). Naming them
this way makes an accidental `git push origin` fail loudly instead of silently trying to write to
`raycast/extensions`.

## Verifying local `main` against the published version

The baseline check — "is my local `main` actually what is published?" — is one command, run with
the extension root resolved (`--root <dir>` wins; otherwise `rx` walks up to the nearest
`package.json` with a `commands` array):

```bash
node "<plugin>/scripts/rx.mjs" stale     # <plugin> = the plugin root, two levels above a skill's directory
```

`rx stale` sparse-fetches the published copy into the cross-repo cache, compares both sides minus
only `ray`'s own copy skip list (a differing `.prettierrc` or `.eslintrc` is a real difference), and
classifies every path: `MINE` (PASS) · `CHECK` / `NEW?` (WARN — needs a recorded disposition in
`rx audit record` before `guard` allows a publish) · `REMOVE` (WARN — a published file the preset's
`holdout.localOnly` lists and local lacks; disposition `remove-published`) · `UPSTREAM` / `ONLY-PUB` /
`UNHANDLED` (FAIL).
A GitHub lookup failure other than 404 is `ERROR`, never an empty comparison; 404 is
`N/A stale not published`. Two distinct results, both exit 0:

- **No unfamiliar upstream changes** — every row is `MINE`: the published copy equals either your
  working file or your committed HEAD. A row noted `published == your HEAD; the delta is
  uncommitted` is still `MINE`: the working file differs from what is published, by your own
  uncommitted edit. That is a safe baseline to build on, not an identical tree.
- **Identical** — every `data.files[]` row carries `note: "identical"` (the summary line reads
  `identical to published`). Only this means local `main` *is* the published source byte for byte.

Anything with a WARN or FAIL row means you do **not** have a clean baseline — reconcile before
syncing anything.

The earlier recipe — `diff -r --brief` piped through `grep -v -E '\.git|node_modules|CLAUDE\.md|\.github'`
— is retired: filtering whole output lines hid a real difference whenever a filename contained one
of those strings (`.gitignore`, a source path with `node_modules` in it), and a `diff` that failed
produced no stdout and read as equality. `rx stale` applies its exclusions to traversal by exact
name and distinguishes an error from "identical".

## Refreshing an existing sparse checkout

Do not re-clone. Pull upstream into the existing sparse tree — **but only as a fast-forward**: a
dirty tree or local commits on `main` are information, not something to discard.

```bash
# Refuse to touch the working tree if anything is uncommitted.
if [ -n "$(git status --porcelain)" ]; then
  echo "ABORT: working tree is dirty — these edits would be lost:"
  git status --short
  exit 1
fi

# Every step stops the sequence on failure: a failed fetch must not merge a stale origin/main,
# and a failed checkout (main is checked out in another worktree, say) must not merge at all.
git fetch origin main || { echo "ABORT: fetch failed; origin/main is stale, not merging."; exit 1; }
git checkout main || { echo "ABORT: could not check out main."; exit 1; }
# Refuse if local main has commits origin does not: a reset would silently drop them.
# Capture the count's exit status before trusting its output.
if ! AHEAD=$(git rev-list --count origin/main..main); then
  echo "ABORT: could not compare main with origin/main."
  exit 1
fi
if [ "$AHEAD" -ne 0 ]; then
  echo "ABORT: local main has $AHEAD commit(s) not on origin/main:"
  git log --oneline origin/main..main
  exit 1
fi
git merge --ff-only origin/main || { echo "ABORT: main is not a fast-forward of origin/main."; exit 1; }
```

**Never `reset --hard` to "get back to a known state."** It destroys uncommitted edits, and on a
clean tree it silently moves a `main` that has unpushed commits back to upstream's. `--ff-only`
fails loudly instead. If the checkout has local edits or commits you did not expect, report them and
stop. This applies even though a sparse *review/verification* clone is usually disposable: the one
time it is not, the work is unrecoverable. The cheapest safe alternative is a fresh clone in a new
directory.

The sparse config persists across fetches — you stay scoped to `extensions/<name>`.

## Gotchas

- **A sparse checkout leaves you in the WRONG directory to run anything.** This procedure drops
  you in `monorepo/` with one extension materialized at `extensions/<name>/`. That monorepo root
  looks like the project root and is not: `npm install`, `npm run dev`, and `npx ray build`/`ray lint`
  fail there with npm-flavored errors that blame a dependency, not your path. **`cd extensions/<name>`
  first, then run.** See the `[build]` `extension-root` rule in [`house-style.md`](./house-style.md)
  for the general invariant and how `rx` resolves the root.
- **`git sparse-checkout set` REPLACES the path list; it does not append.** Setting a second
  extension drops the first. To hold two, pass both in one call:
  `git sparse-checkout set extensions/a extensions/b`.
- **Order matters.** `git clone --no-checkout` → `sparse-checkout set` → `checkout`. If you check
  out before setting the sparse path, you have already downloaded the whole tree.
- **Cone mode only takes directories, not globs.** `extensions/<name>` works;
  `extensions/<name>/src/*.tsx` does not.
- **The fork can drift behind upstream.** That is not a sparse-checkout problem — it is the
  stale-fork failure `ray publish` reports, and it is fixed in the browser (Sync fork → Update
  branch). See `ship`'s Route A.

## Related

The standalone mirrors (`chrismessina/raycast-<name>`) are reconciled in the other direction — from
the merged monorepo back into the mirror — by the reusable workflow
`.github/workflows/sync-from-upstream.yml` at this repo's root, which each mirror calls from a stub.
Every guard in that workflow has a dated incident behind it:
[`upstream-sync-workflow-incident-history`](../learnings/workflow-issues/upstream-sync-workflow-incident-history.md).
