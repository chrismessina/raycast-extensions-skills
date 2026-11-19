# Keyboard conventions

Map ad-hoc `Action` shortcuts to `Keyboard.Shortcut.Common` **by semantics**, and guarantee no two
actions collide within a resolved ActionPanel. Cited by `develop` (build-time + house-style
audit-fix ruleset) and `ship` (the conflict invariant is `rx shortcuts check`). The house-style rule
is `keyboard`.

## Which source settles a binding

**Current vendor docs are acceptable; the installed runtime wins any disagreement; the linter is
never a binding source.**

- The runtime shim inside Raycast.app (`@raycast/api/index.js`) is what the user's fingers hit.
  `rx shortcuts runtime` reads it and caches the full `Common` table with the app version and a shim
  fingerprint; `rx shortcuts check` compares an extension against that table and fails with
  `ERROR runtime evidence unavailable` when no table matches the installed app. Run `runtime` once
  per Raycast version.
- `developers.raycast.com/api-reference/keyboard` is Raycast-maintained and matched the runtime on
  all 17 rows when last compared (2026-09-15); citing it in a review is legitimate. If it and the
  runtime ever disagree, the runtime wins and the disagreement is worth reporting upstream rather
  than quietly working around.
- `@raycast/eslint-plugin`'s `COMMON_SHORTCUTS` (2.2.0) disagrees with both on five constants — the
  ⚠️ rows below. Consult it only to explain why `prefer-common-shortcut` flagged or rewrote
  something. It is not evidence about what a shortcut does.

**Last verified:** 2026-09-30 against the Raycast **2.6.0.0** runtime shim — all 17 bindings as in
the table below. Re-verify whenever the Raycast app updates or `@raycast/eslint-config` is bumped.
The dated history of which source was wrong when, and the extraction recipes for the docs and the
linter, are in
[`keyboard-shortcut-sources-divergence-history`](../learnings/tooling-decisions/keyboard-shortcut-sources-divergence-history.md).

## The decision table `[both]`

Shortcut form is decided by TWO independent questions — do NOT conflate them:

1. **Does a `Common` member match the action's semantics?** Yes → use the `Common` constant. It is
   already platform-aware, so never hand-roll a shortcut it covers and never wrap it in a platform
   object. No → a custom shortcut is correct and expected. The set is small and version-dependent
   (16 members in `@raycast/api` 1.104.1, 17 in 2.0.5 — read the installed typing, not a number
   written here) and has no "switch mode", "toggle setting", or "connect". **A wrong `Common` is
   worse than an honest custom shortcut.**
2. **For custom shortcuts only — which platforms does `package.json` `platforms` name?**
   - **Absent** → **macOS-only**. The field postdates Windows support, so an extension without it
     has no Windows leg. Write the plain object and do not flag a bare `cmd`.
   - **One platform** → plain `{ modifiers, key }` object for that platform.
   - **macOS and Windows** → **name both platforms whenever the shortcut uses `cmd`, `ctrl`, or
     `windows`** — Raycast's docs call those the *ambiguous* modifiers
     ([keyboard reference](https://developers.raycast.com/api-reference/keyboard)). A bare `cmd`
     does not exist on Windows, and a bare `ctrl` means a different key on each platform. A
     shortcut built only from `opt`/`alt` and `shift` is unambiguous and may stay a plain object.

| `platforms` | `Common` match | Write |
|---|---|---|
| absent (⇒ macOS) | Yes | `Keyboard.Shortcut.Common.X` |
| absent (⇒ macOS) | No | `{ modifiers: [...], key: "..." }` |
| macOS only | Yes | `Keyboard.Shortcut.Common.X` |
| macOS only | No | `{ modifiers: [...], key: "..." }` |
| macOS + Windows | Yes | `Keyboard.Shortcut.Common.X` |
| macOS + Windows | No, uses `cmd`/`ctrl`/`windows` | `{ macOS: {...}, Windows: {...} }` |
| macOS + Windows | No, only `opt`/`alt`/`shift` | `{ modifiers: [...], key: "..." }` |
| Windows only | Yes | `Keyboard.Shortcut.Common.X` |
| Windows only | No | `{ modifiers: [...], key: "..." }` |

```ts
shortcut={{
  macOS: { modifiers: ["cmd"], key: "l" },
  Windows: { modifiers: ["ctrl"], key: "l" },
}}
```

**Platform keys are `macOS` and `Windows`.** Lowercase `windows` still typechecks but is marked
`@deprecated Use Windows instead` in `@raycast/api` 2.x types (verified 2.4.1) — always write
`Windows`.

> **Windows-only (`platforms: ["Windows"]`)** is rare but legal. Audit its collisions against the
> **Windows** column — `Common.Remove` / `RemoveAll` / `Duplicate` differ per platform, so a panel
> collision-free on macOS is not automatically collision-free there.

**Audit (platform form):** ESLint `no-ambiguous-shortcut` (`eslint-plugin-raycast-harness`) reads
`package.json` `platforms` **before** flagging anything. A custom shortcut is a defect only when the
extension targets both platforms and the shortcut uses an ambiguous modifier without naming both. An
auditor that treats an absent field as cross-platform mis-fires on every Mac-only extension. *(7 of
the fleet's 34 extensions have no `platforms` field. The miss this rule prevents shipped ⌘-only
shortcuts into an open Store PR on 2026-07-13.)*

## The semantic map `[build]`

`Keyboard.Shortcut.Common` is platform-aware — use the constant, not an inline `{ modifiers, key }`
object. ⚠️ marks the five constants where `@raycast/eslint-plugin` 2.2.0 disagrees with the runtime
and the docs.

| Common constant | macOS | Windows |
|---|---|---|
| `Common.Copy` | ⌘ ⇧ C | ctrl shift C |
| `Common.CopyDeeplink` | ⌘ ⇧ C | ctrl shift C |
| `Common.CopyName` | ⌘ ⌥ C | ctrl alt C |
| `Common.CopyPath` | ⌘ ⌃ C | alt shift C |
| `Common.Save` | ⌘ S | ctrl S |
| `Common.Duplicate` | ⌘ D ⚠️ | ctrl shift S |
| `Common.Edit` | ⌘ E | ctrl E |
| `Common.MoveDown` | ⌘ ⌥ ↓ ⚠️ | ctrl alt ↓ ⚠️ |
| `Common.MoveUp` | ⌘ ⌥ ↑ ⚠️ | ctrl alt ↑ ⚠️ |
| `Common.New` | ⌘ N | ctrl N |
| `Common.Open` | ⌘ O | ctrl O |
| `Common.OpenWith` | ⌘ ⇧ O | ctrl shift O |
| `Common.Pin` | ⌘ . | ctrl . |
| `Common.Refresh` | ⌘ R | ctrl R |
| `Common.Remove` | ⌃ X ⚠️ | ctrl D |
| `Common.RemoveAll` | ⌃ ⇧ X ⚠️ | ctrl alt D ⚠️ |
| `Common.ToggleQuickLook` | ⌘ Y | ctrl Y |

The linter's values for the ⚠️ rows: `Duplicate` ⌘⇧S, `MoveDown` ⌘⇧↓ / ctrl⇧↓, `MoveUp` ⌘⇧↑ /
ctrl⇧↑, `Remove` ⌃D, `RemoveAll` ⌃⇧D / ctrl⇧D.

> **`Copy` and `CopyDeeplink` are the same keys** (⌘⇧C / ctrl⇧C). Choosing `CopyDeeplink` for a URL
> is a naming nicety, **not** a way to avoid colliding with a `Copy` in the same panel — it *is* a
> collision. Two copy actions in one panel means one of them needs a genuinely different binding.

### Disambiguation (pick the most precise)

- **Copy family:** generic value → `Copy`; deeplink / URL / Raycast command link → `CopyDeeplink`;
  display label/title/name → `CopyName`; filesystem path → `CopyPath`.
- **Destructive:** single item → `Remove`; clear/remove all → `RemoveAll`.
- **List nav:** move selection down → `MoveDown`; up → `MoveUp`.
- **Create/open:** new entity → `New`; open in default view → `Open`; open with specific
  app/handler → `OpenWith`; toggle pin/favorite → `Pin`.
- **State:** persist changes → `Save`; clone → `Duplicate`; enter edit mode/form → `Edit`;
  refetch/reload → `Refresh`; toggle preview/detail popover → `ToggleQuickLook`.

**Prefer semantics over the current key combo.** If an action is logically a "Save" but has a
non-standard shortcut, change it to `Common.Save`.

---

## The conflict invariant `[verify]`

> Within a single **resolved** ActionPanel, no two actions resolve to the same shortcut on a
> declared platform.

"Resolved" means: include actions in nested `ActionPanel.Submenu`s, actions composed in from other
components that render into the same panel, and object-literal shortcuts such as a toast's
`primaryAction`. The naive failure: mapping two generic copies both to `Common.Copy` in one panel —
semantically tidy, silently colliding. Two actions in *different rows'* panels may share a shortcut;
count per resolved panel, not per file.

The **first and second** actions in a panel auto-get the default primary/secondary shortcuts
(List/Grid/Detail: `↵` and `⌘↵`; Form: `⌘↵` and `⌘⇧↵`). Do not assign a shortcut that duplicates
those defaults on the same panel.

What the runtime actually does, measured in a List on `@raycast/api` 2.12.1 (a probe extension
whose actions only toast their own name, 2026-11-18, while settling brew's Preview Upgrades panel):

- **Raycast strips an explicit `⌘↵` from any action.** `ray develop` logs *"The `shortcut` prop
  provided to the Action `…` is reserved by Raycast and has been removed"*; a Store build drops it
  silently. The prop is dead, not a collision: the action ends up with no shortcut at all.
- **A second action that declares its own key keeps `⌘↵` as well.** With the second action
  declaring `⌥⌘U`, `⌘↵` still ran it.
- **The panel displays the declared key, not the default.** Brew's Upgrade All, second in Preview
  Upgrades and declaring `⌥⌘U`, shows `⌥⌘U` in its ⌘K panel. The
  `@raycast/api` type doc says an alternative shortcut on the primary or secondary action "won't be
  displayed"; on 2.12.1 that is backwards, and only the "the default still applies" half holds.

- **Audit:** `rx shortcuts check`: `shortcut-ambiguous` (one FAIL per colliding pair on a declared
  platform, both sites as file:line; the two sides of a `cond ? (…) : (…)` evaluated once per panel
  are not a pair, but inside a repeated render such as `items.map(…)` they are) and
  `shortcut-reserved` (`↵`, `⌘↵`, `⌘⇧↵` assigned explicitly to any resolved action, the first and
  second included — those keys are the panel defaults and are never declared). Props spreads
  (`<Action {...props} />`) and composed components the text scan cannot resolve are listed in
  `data.unresolved` and counted as declared — read those panels by hand. `N/A` only when the
  extension declares no shortcuts.

---

## The three `--fix` hazards

**A clean `ray lint` is NOT evidence that a panel is collision-free.** Nothing in
`@raycast/eslint-plugin` checks whether two actions in one ActionPanel resolve to the same shortcut.

What `prefer-common-shortcut --fix` does: it rewrites a shortcut whose **keys already equal** a
`Common` member's — *as the linter's own table defines that member*, on **either** platform — into
the named constant. **The rule never reads `package.json` `platforms`** (the string does not appear
in the rule source), so it matches `macMatch || winMatch` regardless of what the extension targets.
All three hazards below are behavior changes, not spelling changes, and none is announced as such.

**Hazard 1 — a diverging constant's binding moves.** For the five ⚠️ constants, `--fix` sees a
literal `{ modifiers: ["cmd","shift"], key: "s" }`, matches it to `Common.Duplicate` from the
linter's table, and rewrites it — but the runtime binds `Common.Duplicate` to **⌘D**. The action's
actual shortcut silently moves. Same for `MoveUp`, `MoveDown`, `Remove`, `RemoveAll`. Never accept
a `--fix` on one of those five without checking the runtime value. The inverse bites too: an action
you bound to ⌘D beside a `Common.Duplicate` is a genuine collision that *neither* the linter nor a
pre-2.0 table will flag.

**Hazard 2 — a cross-platform match rewrites a macOS-only literal.** A macOS-only extension with a
literal `{ctrl+shift+c}` — ⌃⇧C on macOS, distinct from `Common.Copy`'s ⌘⇧C — gets rewritten anyway
because it matches `Copy`'s *Windows* binding, and the action silently moves to ⌘⇧C and collides.
The fixer created that collision. (When your literal matched the constant on the platform you are
auditing, the collision was pre-existing and the fixer merely made it visible — writing an explicit
`{ modifiers: ["cmd","shift"], key: "c" }` *feels* like inventing a distinct shortcut; it is
`Common.Copy` spelled out. Check every custom shortcut against the table before assigning it.)

**Hazard 3 — the ambiguity warning gets silently answered for you.**
`no-ambiguous-platform-shortcut` fires when `platforms` has more than one entry AND a single-form
shortcut carries exactly one of `cmd` or `ctrl` — a bare `{cmd+s}` trips it just as `{ctrl+shift+c}`
does. It is telling you *you* must declare both platforms. But `prefer-common-shortcut` matches a
single-form shortcut against *either* platform's binding, so `--fix` rewrites it to the `Common`
constant — adopting that member's **other**-platform binding too, a choice you never made — and the
ambiguity warning disappears with it. Answer it yourself; do not let `--fix` answer it for you.

**Practical rule for the audit-fix flow:** do the `Common` remap by semantics, by hand (per the
contract below), checking each combo against the table. Run `ray lint` (no `--fix`) to check. If
`--fix` did run, `git diff` the action files — a green result tells you nothing about collisions —
and run `rx shortcuts check`. The two incidents where the table was not checked before typing a
combo (`reader-mode` 2026-07-13, `osaurus` 2026-09-26) are in the divergence-history learning above.

---

## Audit-fix transformation contract `[both]`

When `develop` rewrites shortcuts to `Common`:

0. **Read `package.json` `platforms` FIRST.** Everything below depends on whether the extension is
   macOS-only or cross-platform. **An absent `platforms` field means macOS-only.**
1. **Infer semantics** from each `<Action>`'s `title`, `icon`, `onAction`, and surrounding
   JSX/comments.
2. **If a `Common` member matches → replace with the `Common` constant — unless that would
   collide.** The conflict invariant outranks the semantic map: when two actions in one resolved
   panel share a semantic (two generic copies, two removes), only **one** may take the `Common`
   constant. Give the other a genuinely distinct custom binding checked against the table; do not
   map both and do not leave the collision standing. (If it was a platform-explicit object wrapping
   that semantic, collapse it to the constant — `Common` is already platform-aware.) **If NO
   `Common` matches → keep it custom, in the form `platforms` dictates:** plain `{ modifiers, key }`
   for macOS-only; `{ macOS: {...}, Windows: {...} }` for cross-platform. Do NOT strip a
   platform-explicit object on a cross-platform extension — a bare `cmd`-only shortcut breaks on
   Windows.
3. **Leave truly custom shortcuts as-is** (only normalizing the object *shape* per the decision
   table). Do not invent `Common` names beyond the 17 above.
4. **Imports:** ensure `Keyboard` is imported from `@raycast/api`; extend the existing import line;
   introduce no unused imports.
5. **Verify the conflict invariant** after rewriting (`rx shortcuts check`) — a semantic remap can
   create a new collision.
6. Change only shortcuts — never action titles, behavior, or logic.

### Example

```tsx
// before
<Action title="Open" shortcut={{ modifiers: ["cmd"], key: "o" }} onAction={handleOpen} />
// after
<Action title="Open" shortcut={Keyboard.Shortcut.Common.Open} onAction={handleOpen} />
```

---

## Action ORDER on an update `[verify]` — the append rule and when to refuse it

Greptile enforces a rule on every Store PR: *"New action panel actions should be appended."* It has
fired twice on Chris's extensions **with opposite correct answers**, and the comment text reads
identically both times. Compliance-by-default is wrong half the time, so apply the test.

**The test: did the insertion change the Enter default?** That is the harm the rule protects
against — a silent change to the action a user gets by pressing Enter on a row they have pressed
Enter on a hundred times.

| Enter default changed? | Verdict |
| --- | --- |
| **Yes** — a new action became the first child of a section that ALREADY SHIPPED | **FIX IT.** Append, and say so in the reply. |
| **Yes**, but the section is new in this same release | **Keep it.** There is no prior default to unlearn. |
| **No**, and the shifted actions carry explicit shortcuts | **Keep it**, and reply with the reasoning so the bot learns the exception. |

**A section shipping for the first time has no Enter default to change.** The comment text is
identical either way, so the reviewer cannot tell — you have to, and the check is one call:

```bash
gh api "repos/raycast/extensions/pulls/$PR/files" --paginate \
  --jq '.[] | select(.filename|test("<Component>")) | "\(.status)\t\(.filename)"'
# status "added" on the component that sets the flag ⇒ new surface ⇒ decline the finding
```

*(2026-09-11, `digger` #30957: the finding fired on `sectionActionsFirst`, set by `Theme.tsx` and
`WellKnown.tsx` — both `added` in that very PR, while all eight pre-existing sections kept their
default. It was complied with anyway, reverting a default the extension owner had asked for twice,
and had to be restored in the next release.)*

**Two receipts, same rule, same repo:**

- **Valid, fixed** (2026-08-27, PR #30529): setup actions were inserted at the top of
  `NotInstalledEmptyView`, making **View Setup Instructions** the Enter default. Genuine defect —
  order restored; the reason is now a comment at
  `https://github.com/chrismessina/raycast-claude-artifacts/blob/main/src/components/empty-views.tsx#L24`.
- **Declined** (2026-08-28, PR #30626, P2 / non-blocking): `PinAction` was appended to the *primary*
  section at `https://github.com/chrismessina/raycast-claude-artifacts/blob/main/src/search-artifacts.tsx#L82`.
  `Action.OpenInBrowser` stayed the first child (`:68`), so Enter was unchanged; the two sections
  that shifted down a row are all shortcut-addressable (⌘⇧O, ⌘⇧G, ⌘⇧I).

**Why refusing matters — the remedy is not free.** "Appended" taken literally means *last in the
whole panel*. Full compliance puts a per-item action **below** whatever global or diagnostic actions
the panel ends with. Trading a permanent information-architecture regression for row-position
stability on actions that have keyboard shortcuts is the wrong trade.

**Appending to the primary SECTION is still appending.** Where the panel is sectioned, an action
that operates on the selected item belongs in the section with the other per-item actions — nothing
inside that section moved, and that is the scope the rule should be measured against.

**Reply, do not just ignore.** Greptile's comment ends with *"reply to this and let me know. I'll
remember it for next time!"* — a reply tunes the rule across the whole fleet. **Posting it is
Chris's call, not yours** (same standing rule as never marking a PR ready): draft the reply, hand it
to him. On #30626 the reviewer replied *"I reconsidered it against the actual panel structure, and
I'm withdrawing the concern … No change is needed."* A declined finding left unanswered just
re-fires on the next PR.
