---
title: "The develop dev loop: what the static gates missed, and why the watcher, the deploy target and the destination each need their own check"
date: 2026-10-31
last_updated: 2026-10-31
category: workflow-issues
module: develop
component: development_workflow
problem_type: developer_experience
severity: high
applies_to: ["develop"]
trigger: "when you are about to launch `npm run dev`, stop a watcher, or report a change as exercised in Raycast"
applies_when:
  - "Starting or stopping `ray develop` / `npm run dev` from an agent session"
  - "A command appears in Raycast but cannot run, or a new preference is missing from the settings pane"
  - "An action's result leaves the extension (clipboard, a written file, a Finder reveal, an `open` handoff)"
  - "Reconciling a local tree against the published extension before editing"
  - "A dev log shows an effect running twice on mount"
tags:
  - ray-develop
  - watcher-lifecycle
  - deploy-target
  - clipboard
  - destination-verification
  - staleness
  - renderer-replay
---

# The develop dev loop: what the static gates missed

This is the incident history behind the dev-loop section of `skills/develop/SKILL.md`. The
procedure there is short on purpose; every rule in it was paid for by one of the cases below.
Two of the cases are **retracted**: the advice they produced was correct when written and is
wrong now, and the retraction is recorded here so it is not rediscovered as fact.

## 1. The staleness gate belongs at the start, not at `ship` (2026-07-28, `raycast-store-updates`)

A full session of fixes was built on a local tree that was missing a shipped menu-bar command
and a `githubToken` preference. Other people contribute to published extensions directly in
`raycast/extensions`; a local copy learns about it only when someone pulls it in, and nothing
about a stale tree announces that a whole command is absent. Publishing that diff would have
**deleted both from the Store**, and five of the session's fixes duplicated work a contributor
had already merged. `ship`'s pre-flight catches it too, but only after the work is done. Caught
at the gate it costs one lookup; caught at `ship` it costs the session. This is why `rx stale`
is the first command `develop` runs after resolving the root, and why `rx gates` runs the same
command again at `ship`.

**Corollary: a contributor's fix may be better than yours, and still needs re-verifying.** The
same day the contributor's rate-limit handling (throw to preserve `keepPreviousData`, read
`X-RateLimit-Remaining`) was strictly better than the local version, and the right move was to
drop the local one. But taking their `parseResponse` wholesale re-introduced a bare-403
misclassification the local version had already fixed, and a `⌘⇧C` ActionPanel collision.
Adopting a superset is not adopting every line in it: re-run the house-style checks **after**
reconciling, not only before.

## 2. A watcher killed on a timer leaves a half-written install (2026-07-28, `raycast-store-updates`)

`ray develop` is a long-lived watcher that deploys **incrementally**: it writes `package.json`
and `assets/` first, then compiles the command JS. Three consecutive `ray develop` → `sleep 30`
→ `pkill` cycles left an install with `package.json` + `assets/` and zero `.js`. It fails in the
most misleading way possible:

- Raycast reads the manifest, so the command still appears in root search.
- Preferences render from the stale or partial manifest, so a newly added preference is missing
  from the pane and the `package.json` edit looks like it did not take.
- The command cannot execute, and any error comes from the **previous** build still in memory,
  so the stack trace points at a `.js` file that no longer exists on disk.

Chris reported "I'm not seeing the PAT preference" and "I can't activate the menu bar item".
Both were this, not the code, and every static gate was green the whole time. `ray develop`
also *removes* the dev install when it exits cleanly, so start-sleep-kill cannot leave a
testable build behind; it can only leave a broken one.

**Check:** `find ~/.config/raycast/extensions/<ext> -name '*.js'` (or the `raycast-x` directory
on a machine still running two apps, section 3). No `.js` means the deploy never finished.

**What the skill now says:** one watcher lifecycle. Start it once, keep it alive through every
state you walk, and stop it before handoff unless you are handing Chris the still-running
watcher, in which case say so. An agent cannot hold a foreground process across tool calls, so
when the change needs his hands, hand him `npm run dev` to run in his own terminal and say you
did not run it.

## 3. RETRACTED 2026-08-24: "ask which Raycast app he is in, or pass `--target=x`"

**History.** On 2026-07-28 Chris ran both `Raycast.app` (stable, extensions in
`~/.config/raycast/extensions/`) and `Raycast Beta.app` (`~/.config/raycast-x/extensions/`,
dev command `npm run dev -- --target=x`). A dev deploy lands in exactly one of them. `ray develop`
reported success while deploying to stable; Beta was the app under test and showed a red menu-bar
triangle. The app whose directory was *not* targeted still saw a leftover manifest, advertised
the command, then threw `Error: Missing executable. You might need to build the extension.` from
`RaycastDesktopApp.bundle`, while the other app ran the same extension perfectly. The app name in
the stack trace (`Raycast Beta.app` vs `Raycast.app`) named the directory Raycast was reading,
and so the target that was needed. Chris diagnosed it himself and fixed it with `-- --target=x`.

**Retraction.** Chris, 2026-08-24: *"`--target=x` is no longer necessary as Raycast v2 is rolling
out."* Under v2 the two-app split collapses and a plain `npm run dev` reaches the app he is
running. Asking him to pick a target, or passing `--target=x` pre-emptively, is noise. The table
above survives only as a diagnosis aid for a machine still on the pre-v2 split, and only after the
`Missing executable` symptom has actually appeared.

## 4. RETRACTED 2026-10-10: "quit and restart Raycast after a preference change"

**History.** On 2026-07-28 (`store-updates`) Raycast cached the preferences schema: renamed
labels kept their old text and new preferences were absent from the pane until the app was
restarted. The skill told agents to prescribe a restart after any `package.json` preference edit.

**Retraction.** Chris, 2026-10-10: *"they do now! no more need to quit and restart raycast to see
new preferences!"* Observed on `google-search` with Raycast 2.7.3: moving an extension-level
checkbox into a command's `preferences` appeared under that command in Settings on a plain
`npm run dev`, no restart, and the toggle kept its value. Prescribing a restart is now pure cost;
it can blank uncommitted preference values (tokens, toggles) for nothing. If a preference edit
genuinely fails to appear after a *completed* deploy, check section 2's `.js` test first: a
half-written install is the likelier cause today.

## 5. The effect that lands outside the extension is the one nothing static can see (2026-07-26, `get-app-icon`)

"Copy Icon" ran `Clipboard.copy({ file: tmp })` and then deleted `tmp` in a `finally`.
`Clipboard.copy({ file })` writes a `public.file-url`, a *pointer* like copying in Finder, not the
pixels, so removing the file emptied the clipboard and pasting produced the path as text. It
passed `tsc`, `ray lint`, `ray build`, the house-style audit, an adversarial Codex review and
three review-bot passes. Chris found it in one paste. Both lines are individually correct; the
defect lives in their interaction with macOS pasteboard semantics.

**Rule of thumb:** if a temp file backs a clipboard or paste action, do not delete it, or put the
DATA on the pasteboard instead (`public.png` + `public.tiff`), which is what the fix did. A fleet
check the same day found `central-icon-system` and `google-books` using the same
`Clipboard.copy({ file })` shape; both are correct *because* they never delete the temp file
(they leak it instead). Only `get-app-icon` added the tidy `unlink` and broke.

**How to verify without Chris's hands.** A one-off Swift script reads back what a consumer gets
and needs no GUI:

```bash
xcrun swift -e 'import AppKit
let pb = NSPasteboard.general
print("types:", pb.types?.map { $0.rawValue } ?? [])
print("image:", NSImage(pasteboard: pb).map { "\(Int($0.size.width))x\(Int($0.size.height))" } ?? "NONE")'
```

For a written file, `file <path>` and `sips -g pixelWidth -g pixelHeight <path>` assert type and
dimensions. Run the action, then run the probe; never infer the result from the toast.

**Be rigorous when writing, not only when challenged.** The same Swift probe had been used
earlier that day to adjudicate a disputed review finding. It was reached for to win an argument
and not to check new code. If a change touches a system API whose result the type checker cannot
see, probe it at the time of writing; that is exactly where `tsc` has nothing to say.

## 6. The fix for one review finding created the next (cursors #29493)

A readiness gate added to fix a race ("Quick Look points at a file that isn't rendered yet")
wedged the grid on WASM-load failure: the gate's `.catch` forgot to dismiss `isLoading`. When you
add a gate, an early return or a guard to satisfy a reviewer, walk *its own* failure and empty
path before moving on. The second-order bug is never in the diff the reviewer looked at.

## 7. A doubled effect in a dev log is usually the renderer replay (Digger, React 19, confirmed by Chris 2026-09-02)

Outside production, Raycast mounts the tree in strict mode and replays effect *setup* on initial
mount (setup → cleanup → setup), so an effect body, a network fetch included, runs twice per
launch. Two identical `fetch:start` lines in the same millisecond, or a "canceling previous"
right after mount, is the usual shape. Match it against the mount sequence rather than assuming
it: a bad dependency array produces an extra setup that looks identical in a log. **Development
renderer replay** in `CONCEPTS.md` explains why reading the extension's own source cannot find
the cause.

Two things this does not license. It is *initial-mount* replay, not "every effect fires twice",
so repeats beyond that sequence are a real bug: establish the expected replay first, then
investigate what is left. And the replay is a cleanup-bug *detector*: if the second setup
corrupts state, overwrites newer data or strands a spinner, dev mode just handed you a production
bug for free. Fix that by making cleanup correct, or by coalescing for the replay window only,
never by widening a guard into an in-flight lock that would also swallow a genuine refresh.
