---
name: develop
description: Change the CODE of an EXISTING Raycast extension — feature work, refactors, deliberate major dependency migrations (Node bump, ESLint major, flat-config, @raycast/api breaking changes), and bringing a forked or legacy extension up to Chris's House Style (the "house-style audit fix"). Fires on "build/add/change/refactor [feature]", "migrate to ESLint 10 / Node 22 / flat config", or "bring this fork up to my house style / fix the toasts & shortcuts to match my conventions." Does NOT scaffold net-new (that's `scaffold`) and does NOT submit to the Store (that's `ship`). Absorbs the former `raycast-extension-modernizer`.
metadata:
  stage: "2b + 4 — modernization + feature/refactor + house-style audit fix"
---

# develop

Owns every **code-changing** operation on an extension that already exists. Three intents live here, and the trigger phrase tells them apart:

| Intent | Trigger shape | What it does |
|---|---|---|
| **Feature / refactor** | "add / change / refactor X" | Normal command/view/logic work. |
| **Modernization** | "migrate to ESLint 10 / the new Node / flat config" | Deliberate **major-version** migration, gated. |
| **House-style audit fix** | "bring this up to my house style", "fix the toasts/shortcuts" | Sweep existing code and retrofit it to House Style. |

All three change code, so they all live here and all hand forward to `ship` when done. That's the seam.

## Seam rules (do not cross)

- **vs `scaffold`** — binary on existence. The extension already exists; you're changing it. If it doesn't exist yet, stop — that's `scaffold`.
- **vs `ship`** — `ship` never changes code behavior. If the work is non-breaking dep hygiene, metadata weeding, compliance, or submission, it belongs to `ship`, not here.
- **Two-way handoff from `ship`** — when `ship`'s house-style audit fails, or Store review feedback needs **code** (not just metadata/screenshots), `ship` hands *back* here with the feedback context. Make the change, then hand forward to `ship` again. Don't try to submit from `develop`.

## Throughline A — hard rail

**Never sync or clone the full monorepo.** Sparse-checkout discipline applies to every operation here. Before any monorepo read/write, consult [`../../reference/sparse-checkout-discipline.md`](../../reference/sparse-checkout-discipline.md).

## Documented learnings — read before writing the code, not after the review

`docs/solutions/` in this plugin's source repo holds learnings written from previous runs of these skills, filed by category with YAML frontmatter (`module`, `component`, `problem_type`, `tags`). Three categories carry `develop`-relevant material: **`design-patterns/`** (implementation shapes that passed every gate and still broke), **`architecture-patterns/`** (integration shapes, e.g. AppleScript/JXA), and **`security-issues/`**. Browse: https://github.com/chrismessina/raycast-extensions-skills/tree/main/docs/solutions/

Reach for it when you are about to use a `@raycast/api` or `@raycast/utils` primitive in a way you have not used before, when a hook or platform API behaves differently from how it reads, or when a review finding points at a dependency's runtime behavior rather than at your own code. `CONCEPTS.md` at the repo root defines the terms these learnings use (Fleet, House Style, Command process isolation, Development renderer replay, Restored value).

> **The recurring shape worth knowing before you start:** the expensive defects in this fleet are the ones `tsc`, `ray lint`, and `ray build` all pass — a cache key that does not vary, a hook returning stale data alongside an error, an effect that cannot tell a fetch from a cache restore. A green gate is evidence about types and syntax, never about a library's runtime semantics. When behavior depends on a dependency, **read the dependency** — `node_modules/@raycast/utils/dist/module.js` is bundled but readable. See `docs/solutions/design-patterns/use-cached-promise-caching-semantics.md`.

---

## Before the first edit — verify the baseline, locate, then branch

Three steps, in this order, for all three intents. Neither is an interview: the brief already
says what to build. These only establish *what baseline*, *where*, and *on what ref*.

0. **STALENESS GATE — diff the local tree against the PUBLISHED extension. Do this FIRST,
   before reading code, planning, or editing.**

   A local working copy is **not** authoritative. Other people contribute to published
   extensions directly in `raycast/extensions`, and your copy only learns about it if
   you pull it in. When you haven't, the local tree is a stale snapshot that
   *looks* complete — nothing about it announces that a whole command is missing.

   **Compare file *content*, not just names.** An upstream bugfix inside a file you also
   have is invisible to a name-only check, and is the case that silently loses someone
   else's work. **Fail closed:** a fetch that fails must abort, never fall through to
   "no differences found."

   ```bash
   set -euo pipefail
   EXT="$(jq -r .name package.json)"

   # Per-run temp dir — shared /tmp paths collide between concurrent runs.
   WORK="$(mktemp -d "${TMPDIR:-/tmp}/staleness-$EXT.XXXXXX")"
   trap 'rm -rf "$WORK"' EXIT

   # Distinguish a REAL 404 from a failed request — rate limit / network must ABORT.
   HTTP="$(gh api "repos/raycast/extensions/contents/extensions/$EXT" \
            --silent --include 2>/dev/null | head -1 | grep -oE '[0-9]{3}' | head -1)"
   case "$HTTP" in
     200) PUBLISHED=yes ;;
     404) PUBLISHED=no  ;;
     *)   echo "ABORT: baseline lookup returned '${HTTP:-no response}' — cannot prove freshness."
          exit 1 ;;
   esac

   if [ "$PUBLISHED" = no ]; then
     echo "NOT PUBLISHED — no baseline; skip this gate"
   else
     git -C "$WORK" init -q
     git -C "$WORK" remote add origin https://github.com/raycast/extensions.git
     git -C "$WORK" config core.sparseCheckout true
     git -C "$WORK" sparse-checkout init --cone
     git -C "$WORK" sparse-checkout set "extensions/$EXT"
     git -C "$WORK" fetch -q --depth 1 --filter=tree:0 origin main
     git -C "$WORK" checkout -q FETCH_HEAD

     PUB_DIR="$WORK/extensions/$EXT"

     # FAIL-CLOSED ASSERTION — `set -e` alone is NOT enough (a pipeline swallows the
     # fetch's exit status). Without this, a failed fetch reaches `diff` and can report
     # a clean tree. See ship/SKILL.md for the verified failure mode.
     [ -d "$PUB_DIR" ] && [ -n "$(ls -A "$PUB_DIR")" ] || {
       echo "ABORT: baseline fetch failed or is empty — cannot prove freshness."
       exit 1
     }

     diff -r -q \
       -x node_modules -x .git -x dist -x .DS_Store \
       -x raycast-env.d.ts -x '.prettierrc*' -x '.eslintrc*' \
       "$PUB_DIR" .
     case $? in
       0) echo "IN SYNC — no content differences" ;;
       1) echo "DIFFERENCES — classify each line below" ;;
       *) echo "ABORT: diff failed (exit 2 = operational error, not a difference)."; exit 1 ;;
     esac
   fi
   ```

   > ⚠️ **Branch on `diff`'s exit status; never `&& … || …`.** Exit 2 (comparison failed)
   > and exit 1 (differences found) otherwise collapse into the same message.

   | Output line | Meaning | Action |
   | --- | --- | --- |
   | `Only in <PUB_DIR>…` | upstream has a file you do not | **STOP** — stale |
   | `Files … differ` | **ambiguous** — upstream edited it, *or* you did | **classify it** (below) |
   | `Only in .` | your own local work | expected |

   **Classify every `differ` line before deciding.** In `develop` you are usually at a
   clean-ish HEAD, so the cheap test is whether the published blob equals your `HEAD`:

   ```bash
   [ "$(git hash-object "$PUB_DIR/$f")" = "$(git rev-parse "HEAD:$f")" ] \
     && echo "MINE (published == your HEAD; delta is your working-tree edit)" \
     || echo "UPSTREAM → STOP, the tree is stale"
   ```

   **Either STOP condition means the tree is stale.** Do not edit, do not plan against the
   local code. Reconcile first: adopt the published version as the baseline, then re-apply
   local work on top, checking each change against what the published version already
   fixed. (`metadata/*.png` differing is usually Raycast CI's screenshot recompression —
   adopt the smaller upstream copies; see `ship`'s note.)

   **Why this is step 0 and not a pre-flight item.** `ship`'s pre-flight catches it too —
   but only *after* the work is done, which is exactly how it surfaced on 2026-07-28 on
   `raycast-store-updates`: a full session of fixes was built on a tree missing a shipped
   menu-bar command and a `githubToken` preference. Publishing that diff would have
   **deleted both from the Store**, and five of the session's fixes duplicated work a
   contributor had already merged. Catching it at the gate costs one `curl`; catching it at
   `ship` costs the whole session.

   **Corollary — a contributor's fix may be better than yours.** When reconciling, compare
   rather than assume: that same day the contributor's rate-limit handling (throw to preserve
   `keepPreviousData`, read `X-RateLimit-Remaining`) was strictly better than the local one,
   and the right move was to drop the local version. **But re-verify what you adopt** —
   taking their `parseResponse` wholesale silently re-introduced a bare-403 misclassification
   the local version had already fixed, and re-introduced a `⌘⇧C` ActionPanel collision.
   Adopting a superset is not the same as adopting every line in it: re-run the house-style
   assertions **after** reconciling, not just before.

1. **Resolve the extension root and `cd` there.** The directory whose `package.json` carries
   Raycast keys (`commands`, `title`, `icon`) — which is the repo root for a standalone
   repo but `extensions/<name>/` for anything monorepo-derived. Run a `ray`/`npm` command
   from *above* the extension and it fails with `npm error code ENOENT … package.json` (or
   `could not determine executable to run` via `npx`) — errors that name npm, never Raycast,
   so they read like a broken install rather than a wrong `cd`. Being one level *too deep*
   (e.g. in `src/`) is harmless: npm walks upward. Resolver one-liner and
   the measured behavior table: the `[both]` extension-root entry in
   [`../../reference/house-style.md`](../../reference/house-style.md) (*Environment / tooling*).
   Several matches → ask which extension. Don't guess.

2. **Read the tree state, then branch — but only with permission to touch refs.**

   **Look first, always:**

   ```bash
   git status --short && git branch --show-current
   ```

   Chris works in a **permanently dirty tree and his uncommitted edits are sacred.** So:

   - **Dirty tree → do NOT run any ref-mutating command. Report and ask.** Show him the
     `git status --short` output and ask whether to branch (carrying the edits along) or stay
     put. Uncommitted work plus an unrequested `git switch`/`pull` is how a hunk dies.
   - **Clean tree, and he asked for a branch → `git switch -c <prefix>/<slug>`.** That is the
     *only* ref command this step authorizes.
   - **Never `git add`, `commit`, `stash`, `checkout <path>`, `reset`, or `pull` to "clean up"
     first** — not even to make branching succeed. Not one of these is ever implied by "add a
     feature."
   - **`git fetch` is safe** (it writes only remote-tracking refs); `git pull`/`merge`/`rebase`
     are not — they touch the working tree. Fetch freely, integrate only when asked.
   - **No instruction either way?** Work on the current branch and say so in your report.
     Branching is cheap to add later; a lost edit is not recoverable.

   | Prefix | Use |
   |---|---|
   | `feature/` | new capability |
   | `fix/` | bug fix |
   | `chore/` | deps, tooling, refactor-only |

**What this step is NOT:** it is not a requirements interview. If the ask genuinely needs
shaping before code, that's `superpowers:brainstorming` — invoke it and come back. If the
brief is already concrete (the normal case), resolve the root, branch, and build the bullet
list as written.

---

## Intent 1 — Feature / refactor

Ordinary code work. The only non-default obligation: **write to House Style as you go.** Don't add a failure toast without a Copy-Error action; don't add an `Action` with an ad-hoc shortcut where a `Keyboard.Shortcut.Common` fits. See House Style below — applying it inline is cheaper than letting `ship`'s audit bounce it back.

## Intent 2 — Modernization (gated)

Deliberate **major-version** migrations only: Node bump, ESLint 9→10, flat-config migration, `@raycast/api` breaking changes. (Routine non-breaking bumps are NOT this — they're `ship`'s dep hygiene. If the user means "keep my packages current/secure," that's `ship`, not a migration.)

1. **Consult the gates** — [`../../reference/dep-gates.md`](../../reference/dep-gates.md) for current known-good targets before bumping across a major.
2. **Migrate** deliberately, one major at a time; run the build/lint after each.
3. **If you discover a moved gate** (e.g. ESLint 10 is now stable as the known-good target), **propose** updating `dep-gates.md` and ask for confirmation. Gates never move silently.

This is the absorbed `raycast-extension-modernizer` content — but reframed as the *rare, gated* case, not routine freshness.

## Intent 3 — House-style audit fix (the `npm audit fix` for code)

The retrofit pass: take an extension that works (a fork you're contributing to, or your own legacy one) and bring it up to House Style. This is the muscle the old modernizer had — iterative, mechanical, "sweep the whole extension and bring it up to standard" — except the target is **code patterns**, not dependency versions.

**Sources of truth:** [`../../reference/house-style.md`](../../reference/house-style.md) + [`../../reference/keyboard-conventions.md`](../../reference/keyboard-conventions.md).

**The loop:**

1. **Load** `house-style.md`. Take its `[build]` / `[both]` / `[lint]` entries (the mutating ones). Skip `[verify]`-only entries — those are `ship`'s read-only assertions.
2. **Scan** the codebase for each rule's governed pattern:
   - Failure toasts → grep `Toast.Style.Failure`; flag any without a Copy-Error action.
   - Progress toasts → grep `Toast.Style.Animated` and every `.hide()`. A toast handle has no
     identity, so flag any `hide()` in a `useEffect` cleanup, on a failure path, `await`ed inside
     a fetcher, or with no per-run ownership guard. See the no-id rule in `house-style.md` — this
     one is invisible to review and cost three passes on `brew` #31164.
   - Shortcuts → find every `<Action>` with an inline `shortcut={{...}}`; map by semantics (see `keyboard-conventions.md`).
   - Web requests → grep `fetch`/`axios`/`node-fetch`/`useFetch`; if present, check for `@chrismessina/raycast-logger`.
   - Custom icons → grep `icon=`/`source:` for a bare `.svg`/`.png` filename with no adjacent `tintColor`; a monochrome glyph without one is invisible in one of the two themes, and `fill="currentColor"` in the asset does **not** fix it.
   - **Self-authored only** → failure toasts, `instanceof Error` ternaries, and `${n} items` /
     `item(s)` copy are candidates for `@chrismessina/raycast-kit` (`showError`,
     `getErrorMessage`, `countOf`). Offer it as part of the worklist; it is a *preference*, not
     a violation — the violation is a missing copy action or `"1 items"`, which the kit happens
     to make unrepresentable. **Skip entirely on forks.**
   - `[lint]` rules (hand-defined `Preferences`/`Arguments`, `any` casts) — fix if found, but the durable home is ESLint; you're the backstop.
3. **Present a worklist** of violations before mutating en masse. Fix iteratively; show diffs.
4. **Apply the keyboard transformation contract** exactly (semantics over combo; drop platform-specific inline objects; fix imports; re-check the conflict invariant after rewriting — a remap can create a new collision).
5. **Build + lint** to confirm nothing broke — `npx tsc --noEmit`, `ray build`, `ray lint`.

> 🚨 **A green `ray lint` does NOT mean the panel is collision-free.** Nothing in `@raycast/eslint-plugin` checks whether two actions in one ActionPanel resolve to the same shortcut — you must assert it by reading the resolved panel.
>
> **And a hand-written combo is not automatically a distinct one.** `{ modifiers: ["cmd","shift"], key: "c" }` *is* `Common.Copy`; `{ modifiers: ["cmd"], key: "s" }` *is* `Common.Save`. Writing one out longhand next to an action already using that `Common` constant is a collision you created. **Check every custom combo against the `Common` table in [`../../reference/keyboard-conventions.md`](../../reference/keyboard-conventions.md) before assigning it.** (If `ray lint --fix` then rewrites your longhand into the constant, it is canonicalising a collision that was already there — not causing one.)
>
> The one genuine `--fix` hazard (cross-platform extensions only): a **single-form** shortcut with **exactly one of `cmd` or `ctrl`** — a bare `{cmd+s}` counts — trips `no-ambiguous-platform-shortcut`, which is telling you to declare both platforms yourself. `prefer-common-shortcut` will `--fix` it into a `Common` constant anyway (it matches either platform's binding), adopting the other-platform binding on your behalf and **silently clearing the ambiguity warning**. If you see that warning, answer it by hand.
6. **Hand forward to `ship`** when clean — `ship` re-runs the read-only audit as the gate.

> **Forked-extension caveat:** when retrofitting a fork you're contributing *upstream*, House Style is *your* convention — be judicious about imposing personal patterns (e.g. `@chrismessina/raycast-logger`) on someone else's extension you don't own. Apply universally-good fixes (Copy-Error, `Common` shortcuts, no `any`) freely; flag personal-dependency additions for the user's call before adding them to a non-`chrismessina`-authored extension.

---

## After the change — run it in Raycast, don't just build it

**The static gates are necessary and not sufficient.** `tsc --noEmit`, `ray build`, and
`ray lint` prove the code compiles and lints. They prove **nothing** about whether the feature
works, and they cannot see the states where Chris's nits actually live — a blurry empty-state
label, a spinner that never resolves, a cut-off toolbar, an action that fires on an item whose
file was never written. Reporting "builds clean" as if it were "works" is how QA gets
outsourced back to him, and it comes back as a numbered list.

**So load it and exercise it before reporting.** From the extension root:

```bash
npm run dev        # or `ray develop` — whichever the repo defines
```

> **A `package.json` PREFERENCE change needs a Raycast RESTART, not a hot-reload.**
> `ray develop` rewrites the manifest and recompiles the JS, but Raycast caches the
> **preferences schema** and keeps serving the previous version: renamed titles/labels
> still show their old text, and a newly added preference is **absent from the pane
> entirely**. Nothing looks broken — the deploy succeeded, `ray lint` passes, and
> `diff <(jq -S .preferences package.json) <(jq -S .preferences <deployed>/package.json)`
> comes back identical. It reads exactly like "my manifest edit didn't work."
>
> **Don't debug the manifest — quit and reopen Raycast.** Verify first that source and
> deployed agree; if they do, the discrepancy is the cache, and only a restart clears it.
> Code-only changes (a `.tsx` edit) hot-reload normally and need no restart.
>
> ⚠️ **A restart clears preference VALUES that were entered but never committed** — a
> pasted token and a flipped toggle can both come back blank. Warn before suggesting a
> restart, and expect to ask him to re-enter secrets afterwards.
>
> *(2026-07-28: a renamed `trackReadStatus` label and a newly-promoted `menuBarScope`
> both stayed invisible across several hot-reloads. Chris restarted Raycast and both
> appeared immediately — and his GitHub token and GraphQL toggle were reset.)*
>
> **⚠️ SUPERSEDED 2026-08-24 — do NOT ask which app he is in, and do NOT pre-emptively pass
> `--target=x`.** Chris: *"`--target=x` is no longer necessary as Raycast v2 is rolling out."*
> Under v2 the two-app split collapses and a plain `npm run dev` reaches the app he is running.
> Asking him to pick a target is now noise in the handoff.
>
> The table below survives only as a fallback for a machine still on the pre-v2 split, and only
> once the `Missing executable` symptom has actually appeared. Reach for it to *diagnose*, never
> to pre-empt.
>
> **Chris runs BOTH Raycast apps, and they read different extension directories.** A dev
> deploy lands in exactly one of them, so the default target is a coin flip against which
> app he actually has open:
>
> | App | Extension dir | Dev command |
> |---|---|---|
> | `Raycast.app` (stable) | `~/.config/raycast/extensions/` | `npm run dev` |
> | `Raycast Beta.app` | `~/.config/raycast-x/extensions/` | `npm run dev -- --target=x` |
>
> **Ask which app he's testing in, or pass `--target=x` when it's Beta.** The failure is
> loud but misdirecting: the app whose directory *wasn't* targeted still sees a leftover
> manifest, advertises the command, and then throws **`Error: Missing executable. You might
> need to build the extension.`** from `RaycastDesktopApp.bundle` — while the *other* app
> runs the same extension perfectly. Two contradictory symptoms, one cause. Read the
> **app name in the stack trace** (`Raycast Beta.app` vs `Raycast.app`) to tell which
> directory Raycast was reading; that names the target you needed.
>
> Confirm the deploy actually completed before believing "built extension successfully" —
> the compiled JS must exist in the *targeted* dir:
> ```bash
> find ~/.config/raycast-x/extensions/<ext> ~/.config/raycast/extensions/<ext> -name '*.js' 2>/dev/null
> ```
>
> *(2026-07-28: `ray develop` reported success while deploying to stable; Beta was the app
> under test and showed a red menu-bar triangle. Chris diagnosed it himself and fixed it
> with `-- --target=x`.)*

> 🚨 **NEVER background `ray develop` and then `pkill` it.** It is a long-lived watcher that
> deploys **incrementally**: it writes `package.json` and `assets/` first, then compiles the
> command JS. Killing it after a fixed `sleep` leaves the install **half-written** — manifest
> present, `*.js` absent — which fails in the most misleading way possible:
> - Raycast reads the manifest, so the command still *appears* in the root search.
> - Preferences render from the **stale/partial** manifest, so newly added preferences are
>   missing from the pane and it looks like your `package.json` edit didn't work.
> - The command cannot execute, and any error surfaces from the **previous** build still in
>   memory — so the stack trace points at a `.js` file that no longer exists on disk.
>
> Verify with `find ~/.config/raycast-x/extensions/<ext> -name '*.js'` (or the
> `com.raycast.macos` equivalent): **no `.js` means the deploy never finished.**
>
> `ray develop` also *removes* the dev install when it exits cleanly, so "start it, sleep,
> kill it" is not a way to leave a testable build behind — it is a way to leave a broken one.
>
> **What to do instead.** An agent cannot hold a foreground watcher across tool calls, so:
> - Use `npm run build` (+ `tsc --noEmit`, `ray lint`) for *your* verification loop — that is
>   what you can actually assert on.
> - When the change needs to be exercised in Raycast, **hand Chris the command and let him
>   run it in his own terminal**, where it stays alive. Say so explicitly rather than
>   claiming you "ran it in Raycast."
> - If you must launch it yourself, run it in the background and **leave it running** for the
>   rest of the session; do not `pkill` it as cleanup.
>
> *(Observed 2026-07-28 on `raycast-store-updates`: three consecutive `ray develop` →
> `sleep 30` → `pkill` cycles left an install with `package.json` + `assets/` and zero `.js`.
> Chris reported "I'm not seeing the PAT preference" and "I can't activate the menu bar
> item" — both were this, not the code. Every gate was green the whole time.)*

Confirm it appears in Raycast, then walk the states, not just the happy path:

- **Empty** — zero results / no data yet. Is the copy specific, and does it say what to *do*?
  (See the `[both]` empty/error-state rule in [`../../reference/house-style.md`](../../reference/house-style.md).)
- **Loading** — does `isLoading` actually resolve on the failure branch too? A `.catch` that
  toasts without dismissing wedges the view on a permanent spinner.
- **Error** — force the failure (kill the network, bad token, empty input). Does the toast
  carry its Copy-Error action?
- **Filtered / narrow window** — type a query that matches nothing; shrink the window.
  Truncation and alignment defects only appear here.
- **The ActionPanel as resolved** — open it and read the shortcuts on screen. This is the only
  way to assert the no-collision invariant; `ray lint` does not check it (see the callout above).
- **The effect that lands OUTSIDE the extension** — clipboard, pasteboard, a written file, a
  Finder reveal, a `open` handoff. **A green toast is not evidence the effect worked.** Every
  other state above is verified by *looking at Raycast*; these are the ones where the UI can be
  entirely correct and the result still wrong, because the payload left the app. Verify at the
  destination — paste into a real app, `file` the written path, confirm Finder selected the item.

  > **This is the class of bug that got through everything on 2026-07-26.** `get-app-icon`'s
  > "Copy Icon" ran `Clipboard.copy({ file: tmp })` and then deleted `tmp` in a `finally`.
  > `Clipboard.copy({ file })` writes a `public.file-url` — a *pointer*, like copying in Finder,
  > not the pixels — so removing the file emptied the clipboard and pasting produced the path as
  > text. It passed `tsc`, `ray lint`, `ray build`, the House Style audit, an adversarial Codex
  > review, and three review-bot passes. Chris found it in one paste. Nothing static could see
  > it: both lines are individually correct, and the defect lives in their interaction with
  > macOS pasteboard semantics.
  >
  > **Rule of thumb: if a temp file backs a clipboard/paste action, do not delete it — or put
  > the DATA on the pasteboard instead** (`public.png` + `public.tiff`), which is what the fix
  > did. Fleet check on 2026-07-26 found `central-icon-system` and `google-books` using the same
  > `Clipboard.copy({ file })` shape; both are correct *because* they never delete the temp file
  > (they leak it instead). Only `get-app-icon` added the "tidy" `unlink` and broke.

  **How to verify without Chris's hands.** A one-off Swift script reads back what a consumer
  actually gets, and needs no GUI:
  ```bash
  xcrun swift -e 'import AppKit
  let pb = NSPasteboard.general
  print("types:", pb.types?.map { $0.rawValue } ?? [])
  print("image:", NSImage(pasteboard: pb).map { "\(Int($0.size.width))x\(Int($0.size.height))" } ?? "NONE")'
  ```
  For a written file, `file <path>` and `sips -g pixelWidth -g pixelHeight <path>` assert type and
  dimensions. Run the action, then run the probe — don't infer the result from the toast.

Then stop the dev process before handing off (a running `ray develop` holds the extension in a
dev state in Raycast).

**Report what you actually observed** — the command run and what happened. `tsc` exit 0 plus
"I walked the empty and error states, empty state reads X" is a report. "Should work" is not,
and neither is a green build alone. Where a step genuinely needs Chris's hands (a real account,
a device, a paid API), say exactly that and hand him the steps with real paths rather than
asserting it passed.

**For an external effect, the report must name the destination evidence, not the action.**
"Copy Icon works" is an assertion; *"pasted into Notes → 512×512 image"* or the pasteboard probe's
output is a report. If you could not reach the destination yourself, say so plainly and give Chris
the exact paste/open target — do not let a green toast stand in as proof.

> **Be rigorous when writing, not only when challenged.** The 2026-07-26 clipboard bug was
> disproved-and-fixed using the *same* one-off Swift probe technique already used earlier that
> day to adjudicate a disputed review finding. The technique was reached for to win an argument
> and not to check new code. If a change touches a system API whose result the type checker
> cannot see, probe it at the time of writing — that is precisely where `tsc` has nothing to say.

## House Style (applies to all three intents)

Every code change here must conform to House Style. The canonical, tagged checklist is
[`../../reference/house-style.md`](../../reference/house-style.md) — read it rather than working
from memory; it is not restated here, so the two cannot drift. Shortcuts follow
[`../../reference/keyboard-conventions.md`](../../reference/keyboard-conventions.md).

## Hands off

→ `ship` when the change is done, builds clean, **and has been exercised in Raycast** (see the dev-loop section — a green build is not a working feature). `ship` runs the read-only house-style audit, dep hygiene, weeding, compliance, PR, and cleanup. If it bounces back with code-level feedback, you're up again.

← `review-pr` when a *contributor's* PR needs code changes, or when reviewing one surfaces a defect in your own extension. Reviewing someone else's submission is [`review-pr`](../review-pr/SKILL.md); changing code is here.

## Gotchas

- **A green build is not a working feature.** `tsc`/`ray build`/`ray lint` cannot see empty
  states, spinners, toasts, or resolved ActionPanels. Run the dev loop and walk those states
  before handing to `ship` — otherwise the nits come back as a numbered list.
- **The extension root is not always the repo root.** Standalone repo: repo root. Anything
  monorepo-derived: `extensions/<name>/`. Running from a *parent* yields `npm error code ENOENT`
  or `could not determine executable to run` — npm-flavored errors that misdirect you into
  debugging a dependency. (A *sub*directory like `src/` is fine; npm walks up.)
- **Don't conflate hygiene with migration.** "Update my deps" is ambiguous — non-breaking refresh is `ship`; a major migration is here. If unsure which the user means, ask before bumping.
- **A semantic shortcut remap can introduce a conflict.** Always re-verify the ActionPanel conflict invariant *after* rewriting, not just before.
- **The fix for one review finding can create the next.** A readiness gate added to fix a race (e.g. "Quick Look points at a file that isn't rendered yet") is exactly how a permanent-spinner bug gets in: the gate's `.catch` forgets to dismiss. When you add a gate, an early return, or a guard to satisfy a reviewer, walk *its own* failure/empty path before moving on — the second-order bug won't be in the diff the reviewer looked at. (Observed on cursors #29493: the Quick Look race fix wedged the grid on WASM-load failure.)
- **A longhand combo is not a distinct combo.** `{cmd+shift+c}` *is* `Common.Copy`; `{cmd+s}` *is* `Common.Save`. Spelling one out next to an action already on that constant is a collision — and `ray lint` will not tell you, because no rule checks the invariant. Check the `Common` table before assigning any custom shortcut.
- **`[lint]` rules are not your job to fully own.** Fix what you find, but push the durable enforcement to ESLint — don't turn `develop` into a hand-rolled linter.
- **Forks aren't yours.** Be careful adding personal dependencies to extensions authored by someone else (see the forked-extension caveat).
- **A doubled effect in a dev log is usually the renderer replay — rule that out before you
  touch your dependency array.** Outside
  production Raycast mounts the tree in strict mode and replays effect *setup* on initial mount
  (setup→cleanup→setup), so an effect body — a network fetch included — runs twice per launch.
  Two identical `fetch:start` lines in the same millisecond, or a "canceling-previous" right
  after mount, is the usual shape — match it against the mount sequence rather than assuming it,
  since a bad dependency array produces an extra setup that looks identical in a log. See **Development renderer replay** in `CONCEPTS.md` for why reading the
  extension's own source cannot find the cause. Confirmed by Chris 2026-09-02 (Digger, React 19).
  Two things this does NOT license: it is *initial-mount* replay, not "every effect always fires
  twice", so repeats **beyond** that sequence are a real bug — establish the expected replay
  first, then investigate what is left over. And the replay is a cleanup-bug *detector*: if the
  second setup corrupts state, overwrites newer data, or strands a spinner, dev mode just handed
  you a production bug for free. Fix that by making cleanup correct — or, per `CONCEPTS.md`, by
  coalescing for the replay window only, never by widening a guard into an in-flight lock that
  would also swallow a genuine refresh.
- **New files won't show in `git diff`.** Cross-reference `git status` when reviewing what you changed.
