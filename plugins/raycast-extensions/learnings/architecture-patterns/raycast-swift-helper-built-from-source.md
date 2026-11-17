---
title: "Swift in a Raycast extension: `ray build` compiles it only through a `swift:` import, and a long-running helper is spawned, not wrapped"
date: 2026-11-15
last_updated: 2026-11-17
applies_to: ["scaffold", "develop"]
trigger: "when you are about to add Swift (or any native helper) to a Raycast extension"
category: architecture-patterns
problem_type: architecture_pattern
component: development_workflow
module: native-helper
severity: high
tags:
  - swift
  - extensions-swift-tools
  - ray-build
  - native-binary
  - long-running-process
  - detached-spawn
  - pid-file
  - process-lifetime
applies_when:
  - "An extension needs native macOS APIs (AppKit, CoreGraphics, Metal) that Node cannot reach"
  - "A helper must keep running after the command that started it exits"
  - "A helper holds a resource only the extension can release, so it must not outlive Raycast"
  - "A brief or a Store precedent claims an extension 'builds its helper from source'"
---

# Swift in a Raycast extension: built from source only through a `swift:` import

Measured 2026-11-15 on `@raycast/api` 2.12.1, macOS 27.2, building XDR Boost, an extension whose
Swift helper must stay alive to hold a display's gamma table.

## 1. `ray build` compiles Swift only when TypeScript imports `swift:<dir>`

The Swift step is an esbuild plugin (`dist/utils/esbuild-plugins/swift-files.js` inside the
installed `@raycast/api`). It runs for an import whose path starts with `swift:` and resolves to a
folder containing `Package.swift`:

```ts
import * as swift from "swift:../../swift"; // path relative to this .ts file
```

**A `Package.swift` that nothing imports is silently ignored.** The build succeeds and prints no
`compiling swift package` line. It can still ship a binary, because `ray build` copies whatever is
already in `assets/`: a committed prebuilt file, or one left behind by an earlier Swift build. The
evidence that this build compiled the package is the `ready - compiling swift package` line in the
build output (not just the `wait` line that starts it), plus an overall successful build. The
presence of the asset proves nothing. Neither does its timestamp: the plugin skips the copy when the
new product's bytes match the existing asset.

The imported package must contain **exactly one** `executableTarget`. The CLI runs
`swift package dump-package` and rejects a package with zero or several.

What the import produces:

- **The binary:** the plugin runs `xcodebuild` with `-derivedDataPath <pkg>/.raycast-swift-build`
  and copies the product to `assets/compiled_raycast_swift/<package folder name>`. For a package in
  `swift/`, that is the single file `assets/compiled_raycast_swift/swift`, a universal (x86_64 +
  arm64) Mach-O.
- **The wrappers:** one async TypeScript function per `@raycast func`, typed by the generated
  declarations in `raycast-env.d.ts`.
- **`.gitignore`:** add `compiled_raycast_swift` and `.raycast-swift-build`. Neither is source.

The package uses [raycast/extensions-swift-tools](https://github.com/raycast/extensions-swift-tools)
(1.1.0 here): the products `RaycastSwiftMacros`, `RaycastSwiftPlugin` and `RaycastTypeScriptPlugin`
on an `executableTarget`. **No `main.swift` and no `@main`:** the plugin generates the entry point
([SwiftCodeGenerator.swift](https://github.com/raycast/extensions-swift-tools/blob/1.1.0/SwiftPlugin/Implementation/SwiftCodeGenerator.swift)),
so `swift-argument-parser` and your own subcommands do not fit this route.

## 2. Precedents: check the tree, not the description

**display-modes is not a build-from-source precedent.** It has a root
[`Package.swift`](https://github.com/raycast/extensions/blob/ce76978a153dcf04cbb87dce41278958eac227a3/extensions/display-modes/Package.swift)
and Swift sources, but its `src/utils.ts` runs a **committed prebuilt binary**,
[`assets/display-modes`](https://github.com/raycast/extensions/blob/ce76978a153dcf04cbb87dce41278958eac227a3/extensions/display-modes/assets/display-modes)
(3,163,792 bytes), through `join(environment.assetsPath, "display-modes")`. A hand-off that called it
the build-from-source model was written from a summary; `ray build` never compiles that root
package.

The from-source precedents use the `swift/` layout above:

- [sidecar-display/swift/Package.swift](https://github.com/raycast/extensions/blob/ce76978a153dcf04cbb87dce41278958eac227a3/extensions/sidecar-display/swift/Package.swift)
- [screenocr/swift/Package.swift](https://github.com/raycast/extensions/blob/5a4a86b9d6eaaf7d50803696506c99e3e5a54244/extensions/screenocr/swift/Package.swift),
  imported as `import * as swiftBridge from "swift:../../swift"` in `src/ocr/macos.ts`

Both call short-lived functions through the generated wrappers. Neither runs a long-lived process.

## 3. A long-running helper: spawn the compiled binary yourself, detached

The generated `main` reads the function name from `argv[1]` and each argument, JSON-encoded, from
`argv[2…]`. That is the shape the CLI's own `runSwiftFunction` (in the same esbuild plugin) uses
when it spawns the binary. The wrapper resolves only when the child **exits**, so it cannot start
something meant to keep running.

Spawn it directly, with the same argv:

```ts
const bin = join(environment.assetsPath, "compiled_raycast_swift", "swift");
await chmod(bin, 0o755); // the wrapper does this too
const child = spawn(bin, ["run", JSON.stringify(level), JSON.stringify(statePath)], {
  detached: true,
  stdio: "ignore",
});
child.on("error", () => undefined); // a failed spawn reports here; unhandled, it crashes the command
if (!child.pid) throw new Error("helper did not start");
child.unref();
```

On the Swift side, `@raycast func run(level: Double, state: String)` sets
`NSApplication.shared.setActivationPolicy(.accessory)` and calls `NSApplication.shared.run()`. It
never returns. Keep it a **synchronous** function. Measured on a synchronous export, the body ran
on the main thread (`Thread.isMainThread == true`), so AppKit windows, `Timer`s,
`DistributedNotificationCenter` observers and dispatch signal sources all worked. For an `async`
export the macro wraps the call in a `Task`, which was not measured. The one-shot functions
(`status`, `quit`, …) go through the wrappers as usual.

**What keeps it alive, measured.** The helper's parent is `Raycast Backend`, Raycast's long-lived
host process, and `detached: true` gives it its own process group. It kept running after the
command that spawned it exited, and after `ray develop` stopped. Raycast quitting, a logout and a
reboot were not tested; section 3a makes the helper quit with Raycast instead. Plan on restoring the helper after a restart as a separate, opt-in design.
An earlier research summary, not re-verified, found no Store extension that registers a login item,
and several that install their own LaunchAgent behind an explicit install step with a matching
remove step. Recheck those precedents before relying on them.

### 3a. Make the helper quit when Raycast quits

Whether a detached helper survives Raycast quitting was never measured, and it does not matter: if
the extension is the only way to turn off whatever the helper holds, the helper must not outlive
Raycast. This is also the first question a Raycast maintainer asked about a detached helper ("how do
you clean up after them?", on
[extensions-swift-tools#14](https://github.com/raycast/extensions-swift-tools/issues/14)). Have the
helper watch Raycast's process and run its normal quit path when that process exits.
[raycast/extensions#33570](https://github.com/raycast/extensions/pull/33570) (XDR Boost) does this.

**Don't use `NSWorkspace.didTerminateApplicationNotification`.** Raycast is an agent app:
`/Applications/Raycast.app/Contents/Info.plist` sets `LSUIElement` to `true` (read 2026-11-17,
Raycast 2.12.1). According to Apple's `NSWorkspace` documentation, the launch and terminate
notifications are not posted for `LSUIElement` or `LSBackgroundOnly` apps, so this observer never
fires. That is the first fix most people would write. Watch the process with a kqueue exit source:

```swift
private var raycastExit: DispatchSourceProcess?

/// A helper that cannot find Raycast quits rather than boost with nothing to end it.
private func watchRaycast() {
    guard let raycast = NSRunningApplication.runningApplications(withBundleIdentifier: "com.raycast.macos").first else {
        helperLog.error("Raycast is not running; quitting")
        quit()  // -> Never
    }
    let source = DispatchSource.makeProcessSource(identifier: raycast.processIdentifier, eventMask: .exit, queue: .main)
    source.setEventHandler { [weak self] in self?.quit() }
    source.resume()
    raycastExit = source  // the source stops when released
    if raycast.isTerminated || kill(raycast.processIdentifier, 0) != 0 { quit() }
}
```

- **Fail closed when Raycast is not found.** The first version logged and kept going, so a helper
  started just as Raycast quit would hold its resource with nothing to end it (Codex, P1). Quitting
  is visible: the extension's acknowledgment wait times out and shows its error.
- **Close the registration race.** `isTerminated` is a cached property and can be stale before the
  run loop turns, so pair it with `kill(pid, 0)`. Codex also found that libdispatch delivers an exit
  event for a pid that is already gone when the source is registered
  ([`event_kevent.c`](https://github.com/apple-oss-distributions/libdispatch/blob/main/src/event/event_kevent.c#L549-L557)).
  Keep the check anyway; it costs one syscall.
- **Watch the bundle id, not the spawning process.** The helper is detached, and its parent is
  `Raycast Backend`, not the app. Raycast runs one instance per bundle id, so `.first` is the right
  process. A Raycast build under a different bundle id fails closed by the rule above.
- **It costs nothing while waiting.** A kqueue source is event-driven: no timer and no polling.
- **Pair it with a restore.** A Raycast update quits and relaunches Raycast, so the helper stops
  too. If the user should get the state back, restore it from the extension's saved intent when
  Raycast is back. XDR Boost does this from its menu bar command's background refresh, behind an
  opt-in **After Restart** preference.
- **It changes the helper, so bump its protocol** (see
  [long-running-helper-outlives-extension-updates.md](long-running-helper-outlives-extension-updates.md)):
  a helper still running from the previous build has no watch.

This does not cover uninstalling the extension while Raycast keeps running. That is rare, and
logging out ends the helper. Verified 2026-11-17: Codex reviewed the change (PATCH, then PASS on the
recheck), build, typecheck, lint and tests are green, and quitting Raycast with the boost on turned
the boost off (tested by hand on Raycast 2.12.1).

## 4. Identify the running helper by its argv, not by pid or by path

A pid file goes stale whenever the helper dies without cleaning up (a crash, a power loss), and
after a reboot its pid can belong to any process. Two checks failed in review:

- **`kill(pid, 0) == 0` alone** accepts a reused pid. `status` reported "running" for an unrelated
  `sleep`, and `run` refused to start a real helper.
- **Comparing executable paths (`proc_pidpath`)** rejects the reused pid, but also rejects a real
  helper started from **another install**. A dev install (`~/.config/raycast/extensions/<name>`) and
  a Store install (a UUID folder) have different `assetsPath` but the **same `supportPath`**, so they
  share the pid file. A helper started by one was invisible to the other: the extension reported Off
  while the old helper kept running, and the next On started a second one.

The identity that holds across installs is the argv the extension itself chose: `argv[1] == "run"`
and the JSON-decoded state-path argument equals this install's state path. Read another process's
argv with `sysctl([CTL_KERN, KERN_PROCARGS2, pid])`. The buffer is an `Int32` argc, the exec path,
NUL padding, then argc NUL-terminated arguments. Treat any read failure as "not the helper".

## 5. Writing `package.json` from Bash trips the `rx guard` hook

The plugin's `rx guard` hook blocks a Bash command whose text contains the whole word `publish`,
unless the command is one of the admitted publish forms (`npm run publish` or `ray publish`) and
passes the guard's receipt and audit checks. A `node -e` that rewrites `package.json` with a
`"publish"` script in it is none of those forms, so it is refused. Write the manifest with the
editor's Write or Edit tool instead.
