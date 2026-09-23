---
title: Building a Raycast extension that drives a third-party app's AppleScript dictionary via JXA
date: 2026-08-19
category: architecture-patterns
problem_type: architecture_pattern
component: airbuddy-jxa-transport
track: knowledge
applies_when: "Building a Raycast extension (or any Node tool) that controls a native macOS app through its AppleScript scripting definition, using osascript/JXA as the transport"
tags:
  [
    jxa,
    applescript,
    osascript,
    sdef,
    raycast-extension,
    apple-shortcuts,
    scripting-bridge,
    fire-and-forget,
    polling,
    injection-safety,
  ]
related:
  - https://github.com/chrismessina/raycast-airbuddy/blob/main/docs/solutions/logic-errors/ambiguous-target-selection-in-unordered-collections.md
---

# Building a Raycast extension that drives a third-party app's AppleScript dictionary via JXA

## Context

Built the AirBuddy Raycast extension from an empty scaffold: it controls AirBuddy (a macOS
AirPods/Bluetooth manager) entirely through the app's AppleScript scripting definition, reached from
Node via `osascript -l JavaScript` (JXA). There is no SDK, no HTTP API, no IPC — the scripting
dictionary is the whole contract. This is the reusable shape for that class of extension: Raycast (or
any Node process) ↔ `osascript` ↔ a third-party app you do not control.

The pitfalls are not obvious and cost real time to rediscover. They cluster into seven durable rules
below, each verified against live hardware and against `https://github.com/chrismessina/raycast-airbuddy/blob/main/src/airbuddy.ts` / `https://github.com/chrismessina/raycast-airbuddy/blob/main/src/poll.ts` /
`https://github.com/chrismessina/raycast-airbuddy/blob/main/src/types.ts` in this repo.

## Guidance

### 1. The installed `.sdef` is ground truth — not the docs, not memory

The scripting definition file inside the app bundle
(`/Applications/AirBuddy.app/Contents/Library/LoginItems/AirBuddyHelper.app/Contents/Resources/AirBuddyHelper.sdef`)
is the authoritative contract. Parse it directly — commands, their direct-parameter and named-parameter
types, `<result type=...>`, and `<enumeration>` values:

```bash
python3 -c "
import xml.etree.ElementTree as ET
r = ET.parse('<app>.sdef').getroot()
for cmd in r.iter('command'):
    print(cmd.get('name'), '->', [(p.get('name'), [t.get('type') for t in p.findall('type')]) for p in cmd.findall('parameter')])
"
```

Author docs (even the app author's own) can lag or lead the shipped binary. **Read the sdef, then
live-verify against real hardware** with a throwaway `osascript` probe before wiring anything. A
green `tsc` proves the TypeScript types agree with each other, never that the JXA payload matches
what the app actually returns — only a live call proves that.

### 2. JXA transport: static script + serialized argv, never string interpolation

The command string handed to `osascript -e` must be a **static literal**. Pass every runtime value
as a separate argv token, read inside the script from `run(argv)`. Interpolating a device name into
the source is an injection hole — a device named `"); doSomething((` would execute. This repo's
`runJXA` (`https://github.com/chrismessina/raycast-airbuddy/blob/main/src/airbuddy.ts#L100`) is the canonical wrapper:

```ts
const { stdout } = await execFileAsync(
  "/usr/bin/osascript",
  ["-l", "JavaScript", "-e", script, "--", ...args], // "--" ends option parsing so a value like "-x" isn't read as a flag
  { timeout: TIMEOUT_MS, killSignal: "SIGKILL", signal }, // signal kills the orphaned osascript child on unmount
);
```

Two non-obvious details both matter: `--` terminates option parsing (a user-editable value beginning
with `-` otherwise becomes an illegal `osascript` flag), and passing an `AbortSignal` is what actually
kills the `osascript` subprocess when the user navigates away — without it the child runs to the full
timeout. Use **JXA, never native AppleScript**: AppleScript's grammar collides `set` with command
names beginning with "set", and a `device`-typed parameter cannot be built from a raw text id
(coercion error `-1700`). JXA sidesteps both.

### 3. Actions are fire-and-forget — poll the postcondition, don't claim instant success

Scripting commands return when the request is **accepted**, not when Bluetooth/audio actually
settles. Reporting success on the command's return produces a green toast for something that hasn't
happened (or a "success" naming the wrong target). Poll the real postcondition instead — `pollUntil`
(`https://github.com/chrismessina/raycast-airbuddy/blob/main/src/poll.ts#L26`) reads the state until it matches, with a bounded timeout and a human-readable
description per call site.

**But when the app exposes an `operation result` record, use it to fail fast.** If a command's sdef
declares `<result type="operation result">` and it is actually retrievable (see rule 6), check
`outcome`/`applied` and surface the app's own `reason` on rejection **instead of** polling toward a
postcondition the app already said won't happen — that turns a 10s timeout with a generic message
into an instant, accurate one. `assertApplied` (`https://github.com/chrismessina/raycast-airbuddy/blob/main/src/poll.ts#L83`) throws `OperationRejectedError`
carrying `result.reason`. Keep `pollUntil` as the settle-state net for commands that return no result
(spatial-audio and other UI-dispatch toggles) and for the gap between "operation applied" and
"UI-visible state settled".

### 4. Read capability from the app's own state-aware signal, not from `kind`

If the app exposes a per-object, per-state capability list (AirBuddy's `supportedActions`), gate every
action on the matching string, not on a `kind ===` guess. The same device kind has different
capabilities in different states (a connected headset gains `"disconnect"` a disconnected one lacks).
Default the list defensively (`(device.supportedActions ?? [])`, `https://github.com/chrismessina/raycast-airbuddy/blob/main/src/types.ts#L157`) — the JXA payload
is cast, not validated, and a mid-restart app can return a transiently incomplete object. Full
treatment of the target-selection half of this in
[`ambiguous-target-selection-in-unordered-collections.md`](https://github.com/chrismessina/raycast-airbuddy/blob/main/docs/solutions/logic-errors/ambiguous-target-selection-in-unordered-collections.md).

### 5. For high-frequency polling, prefer a snapshot accessor over per-property reads

Each AppleScript property read is a separate Apple-event round-trip. A list command that reads ~15
properties per device across a 26-device roster measured **8.6s**; the app's batch snapshot accessor
(`liveDeviceSnapshots()`) returned the same data in **0.15s** — one round-trip, ~59x faster. Critical
JXA syntax difference: **snapshot records expose fields as plain values (`d.id`), object proxies
expose them as method calls (`d.id()`)** (`https://github.com/chrismessina/raycast-airbuddy/blob/main/src/airbuddy.ts#L189`). Copy-pasting a `devices()` loop and
swapping the accessor silently breaks every field. Snapshot feeds are typically live-only — keep the
full-roster accessor for the cases that need offline/stored entries.

### 6. The app's build version changes the contract — pin it and re-verify per build

The scriptable surface is not stable across app builds, and the changes are silent:

- **911 → 912:** `operation result` was returned `undefined` through JXA in 911 (a real
  bridging limitation, verified), then became fully retrievable in 912 — reversing a documented
  "unreachable" finding.
- **912 → 913:** a command was renamed *and* re-scoped (`toggle desktop widgets` →
  `toggle desktop widgets floating`, now controlling float-above-windows rather than visibility), and
  two new readable properties appeared (`desktopWidgetsFloating`, `audioInputLockEnabled`) that
  converted two direction-less "Toggled" toasts into real on/off state reports.

Consequences for the extension: state the minimum app build in the README requirement; re-read the
sdef on every new build the author ships; and **annotate each learning with the build it was verified
against**, so a future reader knows whether it still holds. A claim true for one build is not a claim
true for the app.

### 7. JXA naming and property-vs-command; classify errors by message, not code

- **Command name → JXA method:** sdef `"set low battery alert"` becomes `app.setLowBatteryAlert(...)`
  — words joined, camelCased, leading char lowercased. Confirm the method exists with
  `typeof app.someMethod === "function"` before building on it.
- **Property vs command:** a `access="rw"` property is set by assignment inside the script
  (`d.pinned = true`, `https://github.com/chrismessina/raycast-airbuddy/blob/main/src/airbuddy.ts#L245`), not by a command call. `.whose()` filters throw
  `"Can't convert types"` when passed a resolved object across the JXA boundary — match by id in a
  plain loop instead.
- **Classify errors on the message, not the numeric code.** `-1743` (`errAEEventNotPermitted`) is
  generic: it fires for *both* "app scripting switch off" and "macOS Automation consent denied", which
  are different settings in different panes. The app authors a descriptive message for its own refusal
  ("...enable scripting in AirBuddy Settings"); the OS, refusing before the app sees the event, does
  not. Branch on the message. `-2700`/`-600` mean the app isn't running (its `Application()` reference
  couldn't launch it); `-1728` means not installed. (`classifyError`, `https://github.com/chrismessina/raycast-airbuddy/blob/main/src/airbuddy.ts#L64`.)

## Why This Matters

Every one of these was discovered by hitting the wall, not by reading a guide — the class of extension
has almost no written playbook. The failure modes are quiet: an injected script that runs, a green
toast that lies, a 5s poll that's really 8.6s and stacks subprocesses, a "fixed" behavior that a new
app build silently un-fixed. Grounding on the sdef + live hardware, and pinning every claim to a build,
is what keeps the extension honest as the app underneath it moves.

## When to Apply

Any time a Raycast extension — or a Node CLI, an Apple Shortcuts action, or an Automator step — controls
a native macOS app it does not own, through that app's AppleScript dictionary. The transport specifics
(static-script + argv, fire-and-forget polling, snapshot accessors, message-based error classification)
generalize to any `osascript`/JXA bridge; the sdef-as-ground-truth and pin-the-build discipline apply
to any third-party scripting target whose author ships new builds.

## Examples

**Fire-and-forget with fail-fast, then poll (the rule-3 shape):**

```ts
const result = await connectDevice(device.id); // returns the operation result (build 912+)
assertApplied(result); // throws OperationRejectedError(result.reason) on rejected/failed — no wasted poll
await pollUntil(
  () => getDevices(),
  (devices) => devices.find((d) => d.id === device.id)?.connected === true,
  { description: `${device.name} never connected` }, // settle-state net beyond "applied"
);
```

**Snapshot vs per-property syntax (the rule-5 trap):**

```ts
// per-property, object proxy — d.id() is a method call, one round-trip PER field
for (const d of app.devices()) out.push({ id: d.id(), name: d.name() /* ...15 more */ });

// snapshot record — d.id is a plain value, the WHOLE list in one round-trip (~59x faster)
for (const d of app.liveDeviceSnapshots()) out.push({ id: d.id, name: d.name /* ... */ });
```
