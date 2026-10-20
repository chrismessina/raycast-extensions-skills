---
title: "An AI tool's confirmation runs in a different process from the tool: hand state over through LocalStorage"
date: 2026-10-20
category: design-patterns
module: ai-extensions
component: ai-tool-confirmation
problem_type: design_pattern
severity: high
applies_when:
  - "An AI tool (`src/tools/*.ts`) exports a `confirmation` that computes something the tool body needs afterward"
  - "A confirmation shows the user data (a file, a preview, a price) that the tool must later act on unchanged"
  - "Anything is stored in a module-level variable in `src/tools/` and read by a different export"
symptoms:
  - "A value the confirmation stored in a module-level Map or variable is always missing when the tool runs"
  - "A safety check that compares the tool's input with what the user approved never fires, with no error"
root_cause: integration_issue
resolution_type: code_fix
related_components:
  - raycast-api
  - local-storage
tags:
  - ai-extensions
  - tool-confirmation
  - process-isolation
  - local-storage
---

# An AI tool's confirmation runs in a different process from the tool: hand state over through LocalStorage

## Context

The `dev-null` extension ([raycast/extensions#32595](https://github.com/raycast/extensions/pull/32595)) has a `post-commit` AI tool that posts images publicly. Its `confirmation` reads each image, lists every image's name, previews the first, and records the SHA-256 of every image's bytes. The tool was meant to refuse if a file changed between the user's approval and the post.

The first version kept those hashes in a module-level `Map` in `src/tools/post-commit.ts`: `confirmation` wrote it, the default export read it. Both are exports of one module, called for one invocation, with the same input, and Raycast's own typing says the confirmation receives "the same input" as the tool. Nothing suggests two processes.

Two adversarial reviews flagged the Map as "conditional on Raycast's process behavior" and could not settle it from the source. A log line that recorded whether the comparison happened settled it on the first live post: `Checked commit { images: 1, approval: 'not recorded' }`. **The confirmation and the tool ran in separate processes, and the Map was always empty.** The check had silently done nothing on every earlier post, including several real ones.

This is a sharper case of [Command process isolation](../../../../CONCEPTS.md#command-process-isolation): that entry says *commands* don't share memory. Here it is two exports of the *same tool*, in one AI request.

## Guidance

### 1. Treat `confirmation` and the tool as two processes

Never pass state between them through module scope. Use `LocalStorage`, which is shared by every process of the extension. Compute what you need in `confirmation`, store it, and read it back in the tool.

### 2. Make the record's lifecycle explicit

The handover is now a stored record, and a stored record outlives the request unless you end it. Each of these was a real finding on #32595:

| Problem | Fix |
| --- | --- |
| A second confirmation overwrites the first one's record before its tool runs | One key per distinct request: a hash of the normalized input (`approval:<sha256>`) |
| A **canceled** confirmation never reaches the tool, so its record is never removed | The tool removes its record when it runs, and a record carries a timestamp and expires (10 minutes) |
| Expired records still pile up in storage (Greptile, P2) | `confirmation` deletes expired records via `LocalStorage.allItems()` before saving its own |

What remains is accepted, not solved: requests with *identical* input share one key, and `takeApproval()` reads and then removes in two separate awaits. So a newer confirmation can overwrite an older one's record, two tools can read the same record, or a tool can delete a newer record while returning the older one. `LocalStorage` offers no compare-and-set to close this, and `dev-null` chose to accept it because it needs two simultaneous identical requests. Say so in `AGENTS.md` and stop. (See the "name the floor" section of [reading Reddit programmatically](../tooling-decisions/reading-reddit-programmatically-in-2026.md).)

### 3. Decide fail-open or fail-closed on purpose

When the tool finds no record, it can't tell "the user skipped confirmation" from "the record was lost". `dev-null` stays **fail-open**: the commit is still validated, just not compared with what was shown, so posting keeps working if confirmations are ever skipped. Pick one explicitly and document it.

### 4. Log which path ran

The comparison has no visible effect when it passes or when it never happens, so log which one occurred. `dev-null` logs `approval: "matched"` or `"not recorded"` on every post; it goes through `@chrismessina/raycast-logger`, so it shows only with Debug Logging on. Without that one field, the separate-process fact would still be a guess.

## Why This Matters

A confirmation is often a *promise*: "this is what will be posted." When state set in `confirmation` disappears, nothing errors, types still pass, unit tests pass (`dev-null`'s test the library and hand `postCommit()` the hashes directly, so the handover is never exercised), and mocked evals never run the confirmation at all (see [mocked AI evals](../workflow-issues/mocked-ai-evals-prove-only-their-assertions.md)). The only evidence is a live run with a log line that distinguishes the two outcomes.

## When to Apply

- Any AI tool whose `confirmation` computes, fetches, or snapshots something the tool reuses.
- Before trusting a check that compares "approved" against "executed": confirm live that the approved side actually arrives.

## Examples

Before, which never compared anything, because the tool ran in a fresh process:

```ts
const approvedHashes = new Map<string, string[]>();

export const confirmation: Tool.Confirmation<Input> = async (input) => {
  const { images } = await prepareCommit(commitOf(input));
  approvedHashes.set(keyOf(input), images.map((i) => i.sha256));
  // …
};

export default async function tool(input: Input) {
  const approvedImageHashes = approvedHashes.get(keyOf(input)); // always undefined
  // …
}
```

After (`dev-null`, `src/tools/post-commit.ts`): `approvalKey()` hashes the input into the key, `takeApproval()` reads and removes the record and rejects it once it's older than `APPROVAL_TTL_MS`, `pruneApprovals()` clears expired ones, and `confirmation` prunes before it saves:

```ts
export const confirmation: Tool.Confirmation<Input> = async (input) => {
  const { message, images } = await prepareCommit(commitOf(input));
  await pruneApprovals();
  await LocalStorage.setItem(
    approvalKey(input),
    JSON.stringify({ at: Date.now(), hashes: images.map((image) => image.sha256) }),
  );
  // …
};

export default async function tool(input: Input) {
  const approvedImageHashes = await takeApproval(input);
  // …
}
```

Verified live after the change: `Checked commit { images: 1, imageBytes: 160380, approval: 'matched' }`.
