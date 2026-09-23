---
title: "Advisory file locks on portable Node fs: the three guards and the residual you keep"
date: 2026-08-17
category: design-patterns
module: extension-storage
component: cross-process-locking
problem_type: design_pattern
severity: high
applies_when:
  - "Two OS processes mutate the same store and neither can be made the sole writer"
  - "A desktop-extension runtime spawns one process per command (Raycast, VS Code, Electron helpers)"
  - "An AI tool can mutate a store while a UI command holding the same store is open"
  - "Only portable node:fs is available — no native dependency, no OS advisory lock"
  - "A reviewer's remedy for a concurrency finding is structural and sounds obviously correct"
root_cause: concurrency
tags: [concurrency, file-lock, atomic-write, raycast, node-fs, toctou]
---

# Advisory file locks on portable Node fs: the three guards and the residual you keep

## Context

Raycast runs each command in its own process. `src/lib/my-libraries.ts` keeps a manifest in
`LocalStorage` and `src/lib/my-snippets.ts` keeps snippets in a file under
`environment.supportPath` — and an AI tool can mutate either while a command is open. An
in-process write queue does not serialize across processes, so read-modify-write cycles
interleaved and updates were lost.

Four constructions were tried before the shipped one, and successive review rounds each found a
different reachable interleaving in the survivor. The durable learning is not "use a lock" —
it is **which guards are load-bearing, and that the last residual is not removable in portable
`fs` no matter how the reviewer phrases it.**

## Guidance

### 1. Atomic write and mutual exclusion are different problems

Write to a unique temp file and `rename` it into place
(`extensions/context7/src/lib/atomic-file.ts:16`). `rename` is
atomic within a filesystem, so a reader sees the whole old file or the whole new one — never a
truncated one.

That makes writes atomic, **not transactional**. Two processes can each write a complete,
well-formed file and still lose one update, because both read the same "before" state. Atomic
writes prevent corruption; only a lock prevents lost updates.

### 2. Compare-and-swap is not a substitute — measured, not assumed

Re-reading the file to verify it is unchanged before writing leaves a window between the
verification read and the write, and a lockstep interleave lands in it every time. Measured on
this codebase: **1 of 8 concurrent writes survived without a lock, 8 of 8 with one**
(`extensions/context7/src/lib/atomic-file.ts:47`). CAS was
built, measured, and removed.

### 3. Decide inside the lock, never before it

Route every mutation through one `mutate()` whose `apply` callback runs *inside* the lock, so
read, decide, and write are one indivisible step
(`extensions/context7/src/lib/my-libraries.ts:39`). A toggle
that reads "is it saved?" before acquiring lets two processes both observe "not saved" and both
add.

The corollary that actually bit: **one mutator bypassing the lock defeats every careful one.**
`clearMySnippets` once wrote directly and discarded concurrent writes no matter what the others
did.

### 4. Cleanup belongs inside the lock, after the commit

Payload deletion runs as an `afterCommit` inside `mutate`
(`extensions/context7/src/lib/my-libraries.ts:47`). Releasing
first lets a concurrent save slip between the manifest write and the cleanup, and the cleanup
then deletes the cache that save just wrote.

Same shape, one level up: **a prune's keep-set must be read inside the lock that guards the
delete.** `pruneOrphanedCaches()` re-reads the manifest under the lock rather than accepting a
caller snapshot
(`extensions/context7/src/lib/my-libraries.ts:94`), because
the caller does `stat` calls and React state updates between its read and the prune.

### 5. The three guards on the lock itself

`open(path, "wx")` is the primitive — exclusive create is atomic, so exactly one process wins.
Everything else exists to handle a holder that died
(`extensions/context7/src/lib/atomic-file.ts:69`, inside
`withFileLock` at `:56`):

| Guard | Line | The interleaving it closes |
|---|---|---|
| **Ownership token** | `atomic-file.ts:61` | An unconditional `unlink` deletes a lock this process does not hold, admitting a second writer. Only the holder removes one. |
| **1 s heartbeat** | `atomic-file.ts:36`, `:130` | A live holder slower than the stale threshold gets reclaimed. Refreshing mtime while held means only a genuinely dead holder is reclaimable. |
| **Age re-check before unlink** | `atomic-file.ts:185` | Two reclaimers judge one stale lock; the first reclaims, a third acquires the freed path, the second's delete removes *that successor's* lock. |

All three were reported by reviewers as separate findings. None is redundant.

### 6. The residual is structural — stop trying to close it

Node's portable `fs` has **no conditional unlink**. Every scheme relocates the same
check-then-act window rather than removing it. Three were built and measured in the session
that produced this doc; none survives in the repository, so the comparisons below are session
measurements rather than something a later reader can re-derive from git history:

- **`rename`-to-claim** — moves the window; a reclaimer that grabs a live successor's lock has
  to put it back, which is worse than the original defect.
- **`link`-based** — identical check-then-act gap.
- **Generation-numbered lock files** (`<resource>.lock.<generation>`, so each acquisition owns a
  unique path a reclaimer physically cannot target) — closes the described race and opens a
  structural one. **When the directory empties, the numbering resets**, so a process holding a
  stale observation can claim generation 3 while another claims generation 1 from an empty
  directory. Two holders at two paths; the higher one's sweep deletes the lower one's lock.
  Measured: **5 of 6 writes survived, against 6 of 6 for the shipped design.**

Per its own documentation, `proper-lockfile` carries the same caveat and resolves it the same
way — it is not a dependency here, so that is a claim about the package, not something this
codebase demonstrates. Closing the residual fully needs an OS-level advisory lock (`flock`)
or a single-owner process.

## Why This Matters

The pattern that cost the most time here was **fixing what the reviewer described instead of
what the reviewer's finding implied.** A review that says "reclamation can still delete a
successor lock" is correct, and the literal fix — give each lock a unique path — is a
regression. The finding was valid; the implied remedy was not.

The way out is not argument, it is measurement. A harness that runs N processes against the real
compiled module converts "which design is safer" from a debate into a number, and the number
said the sophisticated design was worse. That measurement is also what made the position
defensible to the reviewer, which is what actually unblocked the PR.

Second: **bound the failure, then accept it.** With atomic writes underneath, the residual costs
one lost add/remove — never a corrupted store. A residual whose worst case is bounded and whose
trigger requires a >10 s stall between two adjacent syscalls is a different object from an
unbounded one, and worth saying out loud rather than leaving as an unqualified "known race."

## When to Apply

- Any store mutated by more than one OS process where a single-owner process is not available.
- Before adding a native locking dependency to a codebase you do not own — the three guards get
  close enough that the dependency has to justify itself.
- When a reviewer's remedy is structural: build it, measure it against the current design, and
  let the number decide. Do not ship it on plausibility.

## Examples

**Deciding before the lock (lost update):**

```ts
// Both processes observe "not saved" and both add.
const saved = await isSavedLibrary(library.id);
await withFileLock(RESOURCE, async () => {
  if (!saved) await add(library);
});
```

**Deciding inside the lock:**

```ts
// src/lib/my-libraries.ts:39 — read, decide, and write are one step.
async function mutate(apply, afterCommit) {
  return withFileLock(LOCK_RESOURCE, async () => {
    const next = apply(parseStored(await readRaw()));
    await LocalStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    await afterCommit?.();   // cleanup INSIDE the lock, after the commit
    return next;
  });
}
```

**Reclaiming a stale lock — token and age, re-read immediately before the unlink:**

```ts
// src/lib/atomic-file.ts:185
const [content, stats] = await Promise.all([readFile(lockPath, "utf8"), stat(lockPath)]);
if (content !== staleToken || Date.now() - stats.mtimeMs <= LOCK_STALE_MS) {
  return;   // a successor's lock is brand new, so its age fails this check
}
await unlink(lockPath);
```

Deleting a successor now requires stalling past `LOCK_STALE_MS` (10 s) *between those two
statements* — at which point this process's own heartbeat has stopped and it is the hung holder.

## Verification

Never trust a concurrency harness that has not been shown to run. One reported a clean pass
having never executed (session experience, not preserved in this repo): a `.ts` file was
renamed to `.mjs`, every spawned process died on a
syntax error, and the untouched initial file read as the expected result. **Compile the real
module** (`npx esbuild`), spawn real processes, and assert the count of surviving writes — not
the absence of an error.

## Related

- Upstream PR: https://github.com/raycast/extensions/pull/30311 (opened against
  `raycast/extensions`; unmerged as of 2026-08-17)
- `extensions/context7/CLAUDE.md` — "Storage — two stores,
  split by size" carries the in-repo version of these rules
- `extensions/context7/src/lib/atomic-file.ts` — the
  implementation, with the rationale in comments so the guards are not "simplified" away
