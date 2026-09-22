# Sparse-checkout discipline (Throughline A — hard rail)

**Never clone or sync the full `raycast/extensions` monorepo.** It is thousands of
extensions and gigabytes of assets. A full clone wastes minutes, fills the disk, and
buries the one directory you actually care about.

Cited as a hard rail by both `develop` and `ship`. Every monorepo read or write goes
through the procedure below.

## The rule

> Fetch exactly one path — `extensions/<name>/` — and nothing else.

This applies to *reads* (verifying local `main` matches the published version) just as
much as *writes* (syncing a change into the fork before a PR). The read case is the one
that gets skipped, because "I just want to look at it" feels cheap. It isn't — a naive
`git clone` of the monorepo is the expensive mistake this file exists to prevent.

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

`--filter=blob:none` defers blob download until checkout; `--cone` + `set` restricts
that checkout to one directory. Together they mean you pay for one extension, not
thousands.

Verify you got what you asked for — the working tree should contain `extensions/<name>`
and no sibling extensions:

```bash
ls extensions/          # expect exactly: <name>
git sparse-checkout list  # expect exactly: extensions/<name>
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

Keep upstream as `origin` (you fetch from it) and the fork as `fork` (you push to it).
Naming them this way makes an accidental `git push origin` fail loudly instead of
silently trying to write to `raycast/extensions`.

## Verifying local `main` against the published version

The baseline check — "is my local `main` actually what's published?" Sparse-fetch the published dir, then diff it against your working copy (`EXT_ROOT` = its extension root):

```bash
: "${EXT_ROOT:?set EXT_ROOT to your extension root}"
diff -r --brief \
  monorepo/extensions/<name>/ \
  "$EXT_ROOT"/ \
  | grep -v -E '\.git|node_modules|CLAUDE\.md|\.github'
```

Filter out the local-only artifacts that legitimately differ. For the Bookface
v1.1 ship the remainder was empty — local `main` genuinely was the published source, so
it was safe as the baseline. **A non-empty remainder means you do NOT have a clean
baseline; reconcile before syncing anything.**

## Refreshing an existing sparse checkout

Don't re-clone. Pull upstream into the existing sparse tree — **but `reset --hard` destroys
uncommitted work, so prove the tree is clean first and abort if it isn't:**

```bash
# Refuse to touch the working tree if anything is uncommitted.
if [ -n "$(git status --porcelain)" ]; then
  echo "ABORT: working tree is dirty — reset --hard would destroy these edits:"
  git status --short
  exit 1
fi

git fetch origin main
git checkout main && git reset --hard origin/main
```

**Never run the `reset --hard` on a dirty tree to "get back to a known state."** If the checkout
has local edits you didn't expect, that is information — report it and stop. This applies even
though a sparse *review/verification* clone is usually disposable: the one time it isn't, the
edits are unrecoverable. Cheapest safe alternative is a fresh clone in a new directory.

The sparse config persists across fetches — you stay scoped to `extensions/<name>`.

## Gotchas

- **A sparse checkout leaves you in the WRONG directory to run anything.** This procedure
  drops you in `monorepo/` with one extension materialized at `extensions/<name>/`. That
  monorepo root looks like the project root and is not: `npm install`, `npm run dev`, and
  `npx ray build`/`ray lint` all fail here with `npm error code ENOENT … package.json` or
  `could not determine executable to run` — npm-flavored errors that blame a dependency, not
  your path (the `npx` one reads as if `ray` were missing entirely). The
  sparse checkout is precisely what makes this misleading, because the tree is *almost*
  empty, so "the repo root" and "the extension" feel like the same place.
  **`cd extensions/<name>` first, then run.** See the `[both]` extension-root rule in
  [`house-style.md`](./house-style.md) (*Environment / tooling*) for the general invariant
  and the resolver one-liner.
- **`git sparse-checkout set` REPLACES the path list; it does not append.** Setting a
  second extension drops the first. To hold two, pass both in one call:
  `git sparse-checkout set extensions/a extensions/b`.
- **Order matters.** `git clone --no-checkout` → `sparse-checkout set` → `checkout`. If
  you check out before setting the sparse path, you have already downloaded the whole
  tree and the sparse config is closing the barn door.
- **Cone mode only takes directories, not globs.** `extensions/<name>` works;
  `extensions/<name>/src/*.tsx` does not.
- **The fork can drift behind upstream.** That's not a sparse-checkout problem — it's
  the stale-fork failure `ray publish` reports, and it's fixed in the browser (Sync
  fork → Update branch). See `ship`'s Route A.
