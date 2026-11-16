---
title: "A detached helper outlives the build that spawned it: version its protocol and replace it inside the intent transaction"
date: 2026-11-15
applies_to: ["develop", "scaffold"]
trigger: "when you are about to change the messages, state file or safety rules of a long-running helper an extension spawns"
category: architecture-patterns
problem_type: architecture_pattern
component: development_workflow
module: native-helper
severity: high
tags:
  - "swift"
  - "long-running-process"
  - "detached-spawn"
  - "protocol-version"
  - "extension-update"
  - "single-writer"
applies_when:
  - "An extension spawns a helper with detached: true that keeps running after the command exits"
  - "A rebuild, ray develop restart or Store update changes what the helper understands or enforces"
  - "The extension reads a state file the helper writes, or posts it messages"
---

# A detached helper outlives the build that spawned it

Recorded 2026-11-15 from work on a Raycast extension that runs a long-lived Swift helper, compiled by
`ray build` through a `swift:` import and spawned detached. How such a helper is built and spawned,
and why it is identified by argv, is in
[raycast-swift-helper-built-from-source.md](raycast-swift-helper-built-from-source.md). This doc
covers what happens when the extension changes underneath a helper that is still running.

## Context

A helper spawned with `detached: true` and `unref()` is not tied to the command's process. It can
survive the command exiting, `ray develop` stopping, and rebuilds or updates of the extension. In
one recorded observation (a `ps` reading; no capture kept), its parent was `Raycast Backend`,
Raycast's long-lived host process. Check your own with `ps -axo pid,ppid,command`.
Replacing the binary in `assets/` does not stop it, so after a change to the helper the running
process can be the old build.

What that looks like when the contract changed between builds:

- The old helper ignores messages it predates.
- Its state file may no longer decode into the new shape, so a status read can report everything
  idle while the old helper is still working.
- Every change waits for an acknowledgment the old helper cannot give, and times out.
- It does not enforce rules the new build added.

Rebuilding alone does not establish which helper is running. The binary on disk and the TypeScript
are new, and unit tests that read source constants do not establish the live process's version.

## Guidance

### 1. Version the protocol on both sides

A constant in the helper, written into every state file it produces, and mirrored in TypeScript:

```swift
/// Bump whenever the run/message/status contract changes.
let helperProtocol = 2
```

```ts
/** Must match `helperProtocol` in the Swift helper. */
export const HELPER_PROTOCOL = 2;

export function isStale(s: HelperStatus): boolean {
  return s.running && s.protocol !== HELPER_PROTOCOL;
}
```

`status` reports the running helper's protocol, and reports `nil` when the state file does not
decode or carries no version, because a build from before the field existed wrote none. A missing
version therefore counts as stale.

**Trust the state file only when its pid equals the running helper's pid.** Otherwise it is
another process's leftovers, and its protocol and levels describe a helper that is gone.

### 2. Replace through the same single-writer transaction

Give intent exactly one writer, the extension, and route every change through one function that
holds a cross-process file lock, saves a complete snapshot, sends it, and waits for the helper to
report it back (the lock itself is
[portable-node-advisory-file-lock.md](../design-patterns/portable-node-advisory-file-lock.md)).
Replace a stale helper **inside that same locked transaction**, not as a separate startup step:

1. Read the live status and the saved intent.
2. Decide the operation (section 3) and whether the baseline was lost (section 4).
3. If stale: send the shutdown message, poll until the helper exits, and throw if it does not. Never
   start a second helper next to it.
4. Compute the next complete snapshot from the saved intent and save it. Send it to a running
   helper, or start a new helper with it only if the snapshot needs one. A snapshot that asks for
   nothing is acknowledged by no helper running.
5. Poll until a non-stale helper reports that snapshot (compare numbers within a small tolerance,
   not with `===`), and re-check both conditions on the final read-back before accepting:
   `if (isStale(after) || !acknowledged(after, intent)) throw …`. A poll that times out returns its
   last read-back, so the acceptance check has to repeat the poll's condition.

The shutdown message is the one part of the contract an old build must understand. Fix its name and
shape in the first version and never change them. The throw in step 3 is what covers a build that
ignores it.

A separate "replace on launch" step would race the transaction: two commands can both see the
stale helper, and the second can start a helper while the first is still writing intent. Inside
the lock, the stop and the restart are one decision.

The saved intent is what carries state across the replacement. An old helper's own state may be
unreadable (its file does not decode); even when it decodes, it was written under another contract.
Taking saved intent for every stale helper keeps one rule for both cases.

## Why This Matters

Each of these is easy to get wrong in the replacement path:

- **Deciding a toggle from the read-back after the stop.** Once the stale helper is stopped, the
  live status says "off" everywhere, including where it was working. A toggle decided from that
  read-back turns things on when the user meant off. Decide toggles from the status read **before**
  the stop; for a stale helper, decide from the saved intent.
- **Assuming a running helper means something is on.** An older build can idle with nothing to do,
  so "stale and running" says nothing about a toggle's direction.
- **A missing saved intent silently turning everything off.** With a stale helper and nothing
  saved, the direction is unknowable, so falling back to off is the safe choice, but it must not be
  silent. Judge "baseline lost" on the operation **as the user invoked it**, not as resolved: a
  toggle resolved to "all off" as a fallback must be disclosed, while a deliberate "all off" needs
  no warning.
- **Disclosing on some surfaces only.** Put the warning on every result surface the change can come
  from: HUD, toast, menu-bar row, the AI tool's result, and a notification if the extension posts
  one. In a menu-bar command, a menu action's result has to set the warning, not clear the row the
  launch path set. A notification behind a preference, or one that can fail, cannot be the only
  disclosure.
- **Reading protocol freshness as safety.** A fresh protocol proves which contract is running. It
  does not prove the new build's rules are sufficient.

## When to Apply

- Before shipping any change to the helper's messages, state-file shape, argv, or rules. Bump the
  protocol in the same change, on both sides. A test that reads the Swift constant from source and
  compares it with the TypeScript one catches a one-sided bump; it does not check the running
  process.
- When designing a new long-running helper: put the protocol field, the stale check and a fixed
  shutdown message in the first version. A build without the field can only be recognized by its
  absence.
- When a status read and the helper's actual behavior disagree after a rebuild, check `ps` for a
  helper started before the build before debugging the new code.

## Examples

The stale branch of the transaction:

```ts
const savedBefore = await getSaved();
const wasStale = isStale(current);
// Decide toggles BEFORE a stale stop: the stopped read-back would say "off".
const resolved = resolveOperation(op, current, wasStale, savedBefore !== undefined);
const loss = baselineLost(op, wasStale, savedBefore !== undefined);
if (wasStale) {
  await helper.stop();
  current = await poll((s) => !s.running);
  if (current.running) throw new Error("An older helper is still running and did not stop.");
}
```
