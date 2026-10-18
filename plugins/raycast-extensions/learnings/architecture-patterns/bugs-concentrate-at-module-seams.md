---
title: "Bugs concentrate at the seams between modules, not inside them"
date: 2026-07-28
problem_type: architecture_pattern
category: architecture-patterns
component: development_workflow
module: "src/stores, src/hooks"
severity: high
related_components:
  - storage-layer
  - react-hooks
  - data-migration
tags:
  - code-review
  - module-boundaries
  - cross-module-contracts
  - data-loss
  - state-management
  - whole-branch-review
applies_when:
  - "Reviewing a multi-task or multi-commit branch where separate tasks touch different modules that share state or a data contract"
  - "One module's contract claims to preserve or own a field, and a neighboring module filters, re-derives, or overwrites the same field"
  - "A refactor reuses a rule that was correct in its original narrow context inside a new shared abstraction"
  - "A fix introduces state (a latch, cache, or flag) whose correctness depends on caller lifecycle — remount versus in-place identity change"
  - "A test suite is green but built entirely on fresh fixtures, with no coverage of pre-existing or legacy data shapes"
---

# Bugs concentrate at the seams between modules, not inside them

> **Provenance.** Written in the local checkout of the `claude` extension and moved here on 2026-10-18,
> when that checkout was deleted. Its `src/…` citations are to that extension's code as it stood on
> [raycast/extensions#29798](https://github.com/raycast/extensions/pull/29798) (closed without merging), so line numbers are historical.

## Context

A 39-commit storage refactor of this extension ([raycast/extensions#29798](https://github.com/raycast/extensions/pull/29798), open and unmerged at the time of writing) replaced a set of ad hoc per-hook persistence rules with a shared collection store (`src/stores/collection.ts`) plus an explicit migration path for legacy data (`src/stores/recentsMigration.ts`).

Same-family code reviews ran across the branch as work landed, one per task. All of them passed. Seven Critical defects were found anyway — and **five of them were not inside any single file those reviews examined.** They lived in the gap between two files that were each, individually, correct.

This is not a story about sloppy code. Every module involved has a docstring stating its contract clearly and accurately. In each case the defect was that a second module relied on an assumption the first module's contract did not promise, and nothing forced the two to be checked against each other.

## Guidance

**Review the joins, not just the units.** A task-scoped review — "does this diff do what its ticket says?" — passes every time on this class of bug, because each diff *is* internally correct. The defect exists only in the space between two diffs, possibly written weeks apart, possibly never opened in the same review.

Three of the five are worked through below — chosen because each shows a different mechanism (a filter outliving its context, a tie-break resolving the wrong way, and a fix that opened a new seam). The remaining two were variants of the first two mechanisms and are not reproduced here.

### Instance 1 — a filter versus a migration

`src/stores/recentsMigration.ts` deliberately preserves zero-turn legacy conversations (`chats: []`) — data predating the introduction of a chats-based filter, which would otherwise vanish during migration.

Separately, `src/hooks/useRecents.tsx:46` configures the shared store with:

```ts
persistFilter: (conversation) => (conversation.chats ?? []).length > 0,
```

That rule was correct in its original context: don't persist an in-flight conversation the user hasn't asked yet. It was carried into the new shared store unchanged.

Each side is defensible alone. Together they contradict. The store's `persist()` applied `persistFilter` to the *entire* next list on every write, not only to rows new to it — so calling `update()` on an already-stored, migrated zero-turn conversation re-ran the filter against a row that predated the rule, found it failing, and dropped it from storage while still returning it to the caller.

**User-visible effect: pinning a migrated conversation deleted it.** The UI showed it pinned; it was gone on reload. Not "the pin didn't stick" — the conversation was destroyed.

The fix turns `persistFilter` from a blanket per-write predicate into a write-*admission* rule that gates only rows absent from storage before the mutation begins (`src/stores/collection.ts:171-173`):

```ts
const persist = async (items: T[], previouslyPersistedIds: ReadonlySet<string>): Promise<void> => {
  const toPersist = persistFilter
    ? items.filter((item) => previouslyPersistedIds.has(item.id) || persistFilter(item))
    : items;
```

`previouslyPersistedIds` is computed from a read at the start of the same read-modify-write, before any mutation applies — so a row already in storage always passes regardless of what the filter would say about it today. Only a genuinely new row reaches the predicate. The type's docstring (`src/stores/collection.ts:17-29`) now states the invariant directly, so a future consumer inherits the constraint by reading the type.

The seam was not a bug in the filter's logic, nor in the migration's decision to keep those rows. It was that **nothing encoded which module's rule won** when a row satisfied one contract and violated the other.

### Instance 2 — ownership versus re-derivation

The migration re-runs on every mount, reconciling re-derived legacy state onto the stored row and tie-breaking on `updated_at`. Separately, no Recents mutation bumps `updated_at` — archive and rename spread the row unchanged.

So every reconcile **tied by construction**, and the tie-break handed the whole row to the re-derived side. `archived` and `title` exist only on the Recents copy, so they were discarded on every mount: archiving or renaming reverted itself the next time the extension opened, and unpinning was unrepresentable for any conversation carried over from legacy saved answers.

Each half is locally defensible. "On a tie, prefer freshly re-derived data" is a reasonable migration default; "don't bump a recency timestamp for actions that aren't about recency" is a reasonable mutation design. Together they meant ties always happened and always resolved the wrong way for two specific fields.

The fix names the ownership explicitly instead of leaving it implicit across two files (`src/stores/recentsMigration.ts:560`):

```ts
const RECENTS_OWNED_FIELDS = ["archived", "title"] as const;
```

Note the fix is per-field, not uniform. `pinned_at` needed different treatment (`src/stores/recentsMigration.ts:606-620`) because unlike `archived` and `title`, it is *also* legitimately derivable from legacy data — so it resolves by timestamp comparison against a Recents-owned `unpinned_at` rather than a blind carry-forward. "Prefer whichever side is present" does not work when both sides can legitimately produce a value.

**This instance only reproduces with pre-existing legacy data.** A fresh install never accumulates a legacy key to reconcile against, so it never hits the tie. The branch's test suite — 146 tests at the time, built entirely on fresh fixtures — missed it entirely. (Those tests were kept local and stripped before Store submission, since Raycast extensions do not ship tests, so they are not in this tree.)

### Instance 3 — a fix that created a new seam

A guard was added to stop a deleted conversation from silently reappearing. It uses a per-hook latch (`src/hooks/useAskConversation.ts:121`) seeded from the conversation prop: if the hook was handed a conversation that already existed, the latch starts `true`, so a later refused write reads as "was deleted" rather than "never existed."

That fix was correct for the case it targeted. But "Start New Conversation" (`src/views/chat.tsx`) swaps in a fresh id **in place, without remounting the hook** — same instance, new conversation identity. The latch, having no notion of *which* conversation it described, kept reporting `true` from the previous one. The new conversation's first write found no matching row, concluded it had been deleted, and refused to write it. **The answer rendered and was never saved** — silent data loss, traded for the resurrection bug the guard exists to prevent.

The fix adds an identity tracker and resets the flags when the conversation id changes (`src/hooks/useAskConversation.ts:151-162`):

```ts
if (latchedConversationIdRef.current !== conversation.id) {
  latchedConversationIdRef.current = conversation.id;
  hasEverBeenWrittenRef.current = false;
  wasDeletedRef.current = false;
}

if (wasDeletedRef.current) return;
```

The ordering is load-bearing. The reset must run *before* the early-return on the next line; swap them and "delete a conversation, then start a new one in the same view" becomes permanently unsaveable — the same bug, one step over, reintroduced by the fix meant to close it.

**This is the instance worth internalizing.** Its seam did not exist before its own fix. A correct, narrowly-scoped patch for a real bug opened a new boundary — between a ref that outlives the identity it tracks and a component that changes identity without remounting — that no review caught until independent testing found the second bug the first fix had created.

### How they were actually found

The task-by-task same-family reviews missed all five. Each was scoped to the diff in front of it, and each diff was individually correct.

They were found by three independent mechanisms:

- **An independent engine** (OpenAI Codex) reviewing the *whole branch* rather than per-task, across three passes. It named one root cause precisely: *"per-key read-modify-write mistaken for a multi-key transaction."*
- **A second independent engine** (Greptile), which found the fresh-mount resurrection case the first had not.
- **Hands-on testing by the author** against real, pre-existing data.

Codex also reopened three of its own earlier findings after the corresponding fixes landed — the fixes were themselves new, unreviewed code. Instance 3 is a direct example of why that reopening was warranted.

## Why This Matters

A per-task review checks "is this diff correct against its own stated contract." It cannot check "does this diff's contract still hold once module B, reviewed last week under a different contract, is factored in" — because that question is not about either diff. It is about the pair.

Five of seven Critical defects on this branch lived exactly there. A green test suite does not rule the class out either: instance 2 was invisible to any fixture that did not include pre-existing legacy data, which is precisely what a fresh-install-oriented suite tends not to generate.

## When to Apply

- **A new shared abstraction replaces several previously-separate implementations.** Each behavior was right in its original narrow context and may silently conflict once shared.
- **A fix touches two files that agree on data implicitly** — a filter and the data it filters, a tie-break and the field it resolves, a ref and the identity it tracks. Check whether the fix *names* the contract explicitly or merely patches the symptom.
- **A fix touches a guard, latch, or cache scoped to a component instance.** Ask what happens when the identity underneath changes without an unmount — exactly the case a fresh mount's tests never exercise.
- **Before treating a green suite as sign-off on a migration or persistence change.** Ask specifically whether any test exercises pre-existing or legacy-shaped data.
- **After fixing a seam bug, check for the new seam the fix creates.** Instance 3 was created by the fix for an earlier seam.

## Examples

The most durable outcome of this branch was moving cross-module contracts from implicit assumption into code that states them:

- **`src/type.ts:48-52` and `:69-72`** — the ownership invariant declared at the *type* level, with a rule for future fields: if a field is set by a Recents action and by nothing in the legacy keys, it is Recents-owned and must be added to the owned-fields list. This is the strongest form: the contract is unavoidable when adding a field.
- **`src/stores/collection.ts:17-29`** — the "never drop an already-persisted row" invariant stated on the type itself, so any future consumer inherits the constraint rather than relying on tribal knowledge.
- **`src/stores/recentsMigration.ts:560`** and **`:606-620`** — two mechanisms for the same underlying question (whose write wins), chosen per-field depending on whether the field is exclusively owned by one side or derivable by both.
- **`src/hooks/useAskConversation.ts:134`** and **`:151-162`** — an identity-scoped guard reset, plus the ordering constraint the fix depends on.

## Related

- [`docs/DESIGN-NOTES.md`](https://github.com/raycast/extensions/blob/0aad68241aeaa21800e19f4b555b8fd4b00d0d16/extensions/claude/docs/DESIGN-NOTES.md) at #29798's head — the "Ask vs. Recents" entry documents a *design* seam in the same codebase: two mental models (a search-result list and a conversation list) layered over one dataset. A sibling concept rather than the same lesson — that one is a deliberately deferred UX mismatch, this one is a set of correctness fixes made on that branch. Worth reading together as two kinds of seam in the same file area.
- [raycast/extensions#29798](https://github.com/raycast/extensions/pull/29798) — the branch these defects were found and fixed on.
