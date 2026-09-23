# Keyboard conventions

Map ad-hoc `Action` shortcuts to `Keyboard.Shortcut.Common` **by semantics**, and guarantee no two actions collide within an ActionPanel. Cited by `develop` (build-time + house-style audit-fix ruleset) and `ship` (the conflict invariant is a mechanical audit gate).

- **🚨 `@raycast/eslint-plugin` is the ODD ONE OUT — the runtime and the docs agree with each other.** Verified 2026-09-15: the runtime shim and `developers.raycast.com` match on **all 17** constants; `@raycast/eslint-plugin` **2.2.0** disagrees with both on **five**. Rows marked ⚠️ are those five. This is a bug in the linter, not a docs problem:

  | Source | Agrees with the table below? | Standing |
  |---|---|---|
  | Raycast runtime shim (app 2.4.1.0) | ✅ 17/17 | **Authoritative** |
  | `developers.raycast.com/api-reference/keyboard` | ✅ 17/17 | **Authoritative — co-equal** |
  | `@raycast/eslint-plugin` 2.2.0 `COMMON_SHORTCUTS` | ❌ 5 wrong (the ⚠️ rows) | Not a binding source |

  **The docs and the runtime are co-equal authorities.** Either settles a binding on its own, and
  citing the docs page in a review is legitimate — it is Raycast-maintained and currently correct on
  every row. **If they ever disagree, the runtime wins** (it is what the user's fingers hit), and
  that disagreement is itself worth reporting upstream rather than quietly working around.

  Consult `COMMON_SHORTCUTS` only to explain why `prefer-common-shortcut` flagged or rewrote
  something. It is not evidence about what a shortcut does.

  The divergence, verified 2026-09-15 (linter → runtime **and docs**, which agree):

  | Constant | `@raycast/eslint-plugin` 2.2.0 | Runtime **and docs** |
  |---|---|---|
  | `Common.Duplicate` (macOS) | ⌘ ⇧ S | **⌘ D** |
  | `Common.MoveDown` | ⌘ ⇧ ↓ / ctrl ⇧ ↓ | **⌘ ⌥ ↓ / ctrl alt ↓** |
  | `Common.MoveUp` | ⌘ ⇧ ↑ / ctrl ⇧ ↑ | **⌘ ⌥ ↑ / ctrl alt ↑** |
  | `Common.Remove` (macOS) | ⌃ D | **⌃ X** |
  | `Common.RemoveAll` | ⌃ ⇧ D / ctrl ⇧ D | **⌃ ⇧ X / ctrl alt D** |

  **What is established and what is not.** Established: at these versions, the linter disagrees with both the runtime and the published docs, which agree with each other. That two independent Raycast-controlled sources agree makes the linter the outlier rather than a matter of interpretation. *Not* established: when the split opened, or which side moved. Raycast's v2 release note says *"Some common shortcuts have also changed on macOS to match Raycast 2.0"*, making "the app and docs moved, the linter did not" the likely story — but that is inference. Do not cite a version as the origin.

- **Linter source (for explaining lint behavior, NOT for collisions):** `COMMON_SHORTCUTS` in `node_modules/@raycast/eslint-plugin/dist/rules/prefer-common-shortcut.js`. Regenerate it with:
  ```bash
  node --input-type=commonjs -e '
    const src = require("fs").readFileSync("node_modules/@raycast/eslint-plugin/dist/rules/prefer-common-shortcut.js","utf8");
    const list = eval(src.match(/const COMMON_SHORTCUTS = (\[[\s\S]*?\n\]);/)[1]);
    for (const c of list) console.log(c.name, "|", c.macOS.modifiers.join("+")+"+"+c.macOS.key, "|", c.Windows.modifiers.join("+")+"+"+c.Windows.key);
  '
  ```
- **Docs source (now a valid cross-check):** `curl -sL https://developers.raycast.com/api-reference/keyboard.md | awk '/### Keyboard.Shortcut.Common/,0' | grep -E '^\|'` — the `.md` suffix returns raw markdown, so the table is directly diffable. Re-fetch rather than trusting any note in this file about what that page says.
- **Runtime source (authoritative for the table below):** the shim the app actually loads —
  ```bash
  python3 - <<'EOF'
  import re, json
  p = "/Applications/Raycast.app/Contents/Resources/macos-app_RaycastDesktopApp.bundle/Contents/Resources/api/node_modules/@raycast/api/index.js"
  s = open(p, encoding="utf8", errors="replace").read()
  i = re.search(r'i\.Common=\{', s).end() - 1
  d = 0
  for j in range(i, len(s)):
      d += (s[j] == '{') - (s[j] == '}')
      if d == 0: break
  for k, v in json.loads(re.sub(r'(\w+):', r'"\1":', s[i:j+1])).items():
      f = lambda x: "+".join(x["modifiers"]) + "+" + x["key"]
      print(f'{k:<16} {f(v["macOS"]):<28} {f(v["Windows"])}')
  EOF
  ```
  **Extract all 17, not just the five known-diverging ones** — a grep pinned to today's divergence list cannot show you the sixth constant that moves next.
  That directory has no `package.json`, so it carries no version of its own — it is whatever the installed Raycast is. Check the app instead: `plutil -p /Applications/Raycast.app/Contents/Info.plist | grep CFBundleShortVersionString`.
- **Last verified:** 2026-09-11 against the Raycast **2.3.0.0** runtime shim and `@raycast/eslint-plugin` **2.2.0**. The 2026-07-13 snapshot was taken from the linter alone; by 2026-09-11 it no longer matched the app for five constants. (When the two diverged is not established — see above.) The 2026-06-19 snapshot before it had **five wrong macOS bindings** (`CopyName`, `CopyPath`, `Duplicate`, `Pin`, `Remove`). A wrong table causes the exact mis-mapping this file exists to prevent — regenerate from an artifact, never from prose docs.
- **Drift guard:** re-run **both** commands above whenever `@raycast/eslint-config` is bumped **or the Raycast app updates**, and diff the two full 17-member lists against each other — watching only the linter cannot surface a runtime-only change, which is exactly how the 2026-09-11 split went unnoticed. If either set changed, update the table, refresh the divergence list, and bump "last verified".
- ✅ **The vendor docs are CORRECT as of 2026-09-15 — all 17 rows.** Fetched
  `https://developers.raycast.com/api-reference/keyboard.md` and compared every row against the
  runtime shim: **17/17 identical**, `Pin` included. The docs page is now a valid corroborating
  source for a binding, and this file no longer tells you to distrust it.

  > **History, because the correction matters.** An earlier version of this bullet said that page
  > documented `Common.Pin` as ⌘⇧P and called it unreliable. That was true when written
  > (2026-09-07) and **Raycast has since fixed it** — via `raycast/extensions` #30879 and #30538.
  > A stale warning about a vendor doc is itself a hazard: it kept asserting the docs were wrong
  > for a week after they were right, and it got repeated into `api-changelog` as present-tense
  > fact. **Date every claim about a third-party document, and re-fetch before repeating it.**

  Where a reviewer's ⌘⇧P claim comes from is still worth knowing: it was the *old* docs, and it
  cost a user-visible shortcut change to correct code, then a revert. If someone cites ⌘⇧P today,
  ask for the source — it is no longer on that page.
  Confirm a value against an artifact, never the docs — and since 2026-09-11 that artifact must be **the runtime**, not `COMMON_SHORTCUTS` (the linter disagrees with the app on five constants; see the top of this file). The runtime the app actually loads:
  ```bash
  grep -oE 'Pin:\{macOS:\{[^}]*\}[^}]*\}' \
    "/Applications/Raycast.app/Contents/Resources/macos-app_RaycastDesktopApp.bundle/Contents/Resources/api/node_modules/@raycast/api/index.js"
  ```
  The npm `@raycast/api` ships types only and has no `index.js`, so looking there finds nothing and feels like confirmation. The historical case where the docs *were* wrong (since fixed): [`wrong-vendor-docs-manufacture-review-findings`](../learnings/workflow-issues/wrong-vendor-docs-manufacture-review-findings.md) — read it as a dated incident, not as a standing claim about that page.

---

## Two independent axes `[both]` (read this first)

Shortcut form is decided by TWO independent questions — do NOT conflate them:

1. **Does a `Common` member match the action's semantics?** Yes → use the `Common` constant. It is
   already platform-aware, so never hand-roll a shortcut it covers and never wrap it in a platform
   object. No → a custom shortcut is correct and expected. The set is small and version-dependent
   (16 members in `@raycast/api` 1.104.1, 17 in 2.0.5 — read the installed typing, not a number
   written here) and has no "switch mode", "toggle setting", or "connect". **A wrong `Common` is
   worse than an honest custom shortcut.**
2. **For custom shortcuts only — which platforms does `package.json` `platforms` name?**
   - **Absent** → treat as **macOS-only**. The field postdates Windows support, so an extension
     without it has no Windows leg. Write the plain object and do not flag a bare `cmd`.
   - **One platform** → plain `{ modifiers, key }` object for that platform. A `{ macOS, Windows }`
     object on a Mac-only extension is dead weight implying portability it doesn't have.
   - **macOS and Windows** → **name both platforms whenever the shortcut uses `cmd`, `ctrl`, or
     `windows`.** Raycast's docs call those the *ambiguous* modifiers: "If the shortcut contains
     some 'ambiguous' modifiers (eg. `ctrl`, or `cmd`, or `windows`), you will need to specify the
     shortcut for both platforms"
     ([keyboard reference](https://developers.raycast.com/api-reference/keyboard)). A bare `cmd`
     does not exist on Windows, and a bare `ctrl` means a different key on each platform. A
     shortcut built only from `opt`/`alt` and `shift` is unambiguous and may stay a plain object
     (`opt` and `alt` are the same physical key under two names).

```ts
shortcut={{
  macOS: { modifiers: ["cmd"], key: "l" },
  Windows: { modifiers: ["ctrl"], key: "l" },
}}
```

**Platform keys are `macOS` and `Windows`.** Lowercase `windows` still typechecks but is marked
`@deprecated Use Windows instead` in `@raycast/api` 2.x types (verified 2.4.1) — always write
`Windows`.

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

> **Windows-only (`platforms: ["Windows"]`)** is rare but legal. Audit its collisions against the
> **Windows** column of the table below — `Common.Remove` / `RemoveAll` / `Duplicate` differ per
> platform, so a panel collision-free on macOS is not automatically collision-free there.

**Audit (platform form):** read `package.json` `platforms` **before** flagging anything. A custom
shortcut is a defect only when the extension targets both platforms and the shortcut uses an
ambiguous modifier without naming both. An auditor that treats an absent field as cross-platform
mis-fires on every Mac-only extension. *(Real: 7 of the fleet's 34 extensions have no `platforms`
field. The miss this rule prevents shipped ⌘-only shortcuts into an open Store PR on 2026-07-13.)*

## The semantic map `[build]`

`Keyboard.Shortcut.Common` is platform-aware — use the constant, not an inline `{ modifiers, key }` object.

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

> **`Copy` and `CopyDeeplink` are the same keys** (⌘⇧C / ctrl⇧C). Choosing `CopyDeeplink` for a URL is a naming nicety, **not** a way to avoid colliding with a `Copy` in the same panel — it *is* a collision. Two copy actions in one panel means one of them needs a genuinely different binding.

### Disambiguation (pick the most precise)

- **Copy family:** generic value → `Copy`; deeplink / URL / Raycast command link → `CopyDeeplink` (same keys as `Copy` — see above); display label/title/name → `CopyName`; filesystem path → `CopyPath`.
- **Destructive:** single item → `Remove`; clear/remove all → `RemoveAll`.
- **List nav:** move selection down → `MoveDown`; up → `MoveUp`.
- **Create/open:** new entity → `New`; open in default view → `Open`; open with specific app/handler → `OpenWith`; toggle pin/favorite → `Pin`.
- **State:** persist changes → `Save`; clone → `Duplicate`; enter edit mode/form → `Edit`; refetch/reload → `Refresh`; toggle preview/detail popover → `ToggleQuickLook`.

**Prefer semantics over the current key combo.** If an action is logically a "Save" but has a non-standard shortcut, change it to `Common.Save`.

---

## The conflict invariant `[verify]` (ship's mechanical gate)

> Within a single **resolved** ActionPanel, no two actions resolve to the same shortcut.

"Resolved" means: include actions in nested `ActionPanel.Submenu`s and actions composed in from other components that render into the same panel. The naive failure: mapping two generic copies both to `Common.Copy` in one panel — semantically tidy, silently colliding.

Also note: the **first and second** actions in a panel auto-get the default primary/secondary shortcuts (List/Grid/Detail: `↵` and `⌘↵`; Form: `⌘↵` and `⌘⇧↵`). Don't assign a `Common` shortcut that duplicates those defaults on the same panel.

---

## `ray lint --fix` does not check the conflict invariant `[both]`

**A clean `ray lint` is NOT evidence that a panel is collision-free.** Nothing in `@raycast/eslint-plugin` checks whether two actions in one ActionPanel resolve to the same shortcut. You must assert it by reading the resolved panel.

What `prefer-common-shortcut --fix` actually does: it rewrites a shortcut whose **keys already equal** a `Common` member's — *as the linter's own table defines that member*, on **either** platform — into the named constant. **The rule never reads `package.json` `platforms`** (the string does not appear in the rule source at all), so it matches `macMatch || winMatch` regardless of what the extension actually targets.

So if `--fix` leaves you with two `Common.Copy` actions in one panel, the collision was already there **only when your literal matched the constant on the platform you are auditing** — you had written `{cmd+shift+c}` by hand next to a `Common.Copy` on macOS, which is the same keys, and the fixer merely made it visible. **It is not always pre-existing.** A macOS-only extension with a literal `{ctrl+shift+c}` — ⌃⇧C on macOS, distinct from `Common.Copy`'s ⌘⇧C — gets rewritten anyway because it matches `Copy`'s *Windows* binding, and the action silently moves to ⌘⇧C and collides. The fixer created that one.

> ⚠️ **`--fix` is a spelling change ONLY for the constants where the linter and the runtime agree.** For the five diverging constants at the top of this file it is a **behavior change**: `--fix` sees a literal `{ modifiers: ["cmd","shift"], key: "s" }`, matches it to `Common.Duplicate` from the linter's table, and rewrites it — but on Raycast 2.3.0 `Common.Duplicate` binds **⌘D**. The action's actual shortcut silently moves. Same trap for `MoveUp`, `MoveDown`, `Remove`, `RemoveAll`.
>
> **So: never accept a `--fix` on one of those five without checking the runtime value.** And the inverse bites too — an action you bound to ⌘D sitting next to a `Common.Duplicate` is a genuine collision on 2.3.0 that *neither* the linter nor a pre-2.0 table will flag.

> **This is the trap, and it is a trap about you, not about the tool.** Writing an explicit `{ modifiers: ["cmd","shift"], key: "c" }` *feels* like you invented a distinct shortcut. It isn't: it's `Common.Copy` spelled out. The `Common` table below is the only way to know whether the combo you just typed is already taken. **Check every custom shortcut against the table before assigning it** — that's what prevents the collision, not avoiding `--fix`.
>
> Learned the hard way, 2026-07-13, on `reader-mode`: assigned Summarize `⌘S` (= `Common.Save`, already on "Save as Markdown") and Copy URL `⌘⇧C` (= `Common.Copy`, already on "Copy as Markdown"). Two collisions, both mine. `--fix` canonicalised them and I briefly blamed the linter.

**Three distinct `--fix` hazards** — the two above (a diverging constant's binding moving; a cross-platform match rewriting a macOS-only literal) plus this one. All three are behavior changes, not spelling changes, and none is announced as such.

**Hazard 3 — the ambiguity warning gets silently answered for you.** `no-ambiguous-platform-shortcut` fires when `package.json` `platforms` has >1 entry AND a **single-form** shortcut carries **exactly one of `cmd` or `ctrl`** (`(hasCmd || hasCtrl) && !(hasCmd && hasCtrl)`) — so a bare `{cmd+s}` trips it just as `{ctrl+shift+c}` does. It's telling you *you* must declare both platforms.

But `prefer-common-shortcut` matches a single-form shortcut against *either* platform's binding (`macMatch || winMatch`), so `--fix` rewrites it to the `Common` constant — adopting that member's **other**-platform binding too, a choice you never made — and **the ambiguity warning silently disappears with it.** If you see that warning, **answer it yourself; don't let `--fix` answer it for you.**

**Practical rule for the audit-fix flow:** do the `Common` remap by semantics, by hand (per the contract below), checking each combo against the table. Run `ray lint` (no `--fix`) to check. If `--fix` did run, `git diff` the action files — not because it corrupts them, but because a green result tells you nothing about collisions.

---

## Audit-fix transformation contract `[both]`

When `develop` rewrites shortcuts to `Common`:

0. **Read `package.json` `platforms` FIRST.** Everything below depends on whether the extension is macOS-only or cross-platform. **An absent `platforms` field means macOS-only** — do not read it as cross-platform. An auditor that skips this step, or that defaults absent → cross-platform, mis-fires on Mac-only extensions and on the 7 extensions with no `platforms` field.
1. **Infer semantics** from each `<Action>`'s `title`, `icon`, `onAction`, and surrounding JSX/comments.
2. **If a `Common` member matches → replace with the `Common` constant — unless that would collide.** The conflict invariant outranks the semantic map: when two actions in one resolved panel share a semantic (two generic copies, two removes), only **one** may take the `Common` constant. Give the other a genuinely distinct custom binding checked against the table; do not map both and do not leave the collision standing. **Where the two rules pull against each other, collision-freedom wins.** (and if it was a platform-explicit object wrapping that semantic, collapse it to the constant — `Common` is already platform-aware). **If NO `Common` matches → keep it custom, in the form `platforms` dictates:** plain `{ modifiers, key }` for macOS-only; `{ macOS: {...}, Windows: {...} }` (capital `Windows`) for cross-platform. Do NOT strip a platform-explicit object on a cross-platform extension — it's required there; a bare `cmd`-only shortcut breaks on Windows.
3. **Leave truly-custom shortcuts as-is** (only normalizing the object *shape* per axis 2 above) — do not force a `Common` where no semantic match exists. Do not invent `Common` names beyond the 17 above.
4. **Imports:** ensure `Keyboard` is imported from `@raycast/api`; extend the existing import line; introduce no unused imports.
5. **Verify the conflict invariant** after rewriting — a semantic remap can create a new collision.
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

Greptile enforces a rule on every Store PR: *"New action panel actions should be appended."* It
has now fired twice on Chris's extensions **with opposite correct answers**, and the comment text
reads identically both times. Compliance-by-default is wrong half the time, so apply the test.

**The test: did the insertion change the Enter default?** That is the harm the rule protects
against — a silent change to the action a user gets by pressing Enter on a row they have pressed
Enter on a hundred times.

| Enter default changed? | Verdict |
| --- | --- |
| **Yes** — a new action became the first child of a section that ALREADY SHIPPED | **FIX IT.** Append, and say so in the reply. |
| **Yes**, but the section is new in this same release | **Keep it.** There is no prior default to unlearn — see below. |
| **No**, and the shifted actions carry explicit shortcuts | **Keep it**, and reply with the reasoning so the bot learns the exception. |

**A section shipping for the first time has no Enter default to change.** The rule exists to
protect muscle memory, and nobody has any for a surface that did not exist before this PR. The
comment text is identical either way, so the reviewer cannot tell — you have to, and the check is
one call:

```bash
gh api "repos/raycast/extensions/pulls/$PR/files" --paginate \
  --jq '.[] | select(.filename|test("<Component>")) | "\(.status)\t\(.filename)"'
# status "added" on the component that sets the flag ⇒ new surface ⇒ decline the finding
```

*(2026-09-11, `digger` #30957: the finding fired on `sectionActionsFirst`, which was set by
`Theme.tsx` and `WellKnown.tsx` — both `added` in that very PR, while all eight pre-existing
sections kept their default untouched. It was complied with anyway, reverting a default the
extension owner had asked for twice, and had to be restored in the next release. The
`status: added` check above is what would have settled it in one call.)*

**Two receipts, same rule, same repo:**

- **Valid, fixed** (2026-08-27, PR #30529): setup actions were inserted at the top of
  `NotInstalledEmptyView`, making **View Setup Instructions** the Enter default. Genuine defect —
  order restored, and the reason is now a comment at
  `https://github.com/chrismessina/raycast-claude-artifacts/blob/main/src/components/empty-views.tsx#L24`.
- **Declined** (2026-08-28, PR #30626, P2 / non-blocking): `PinAction` was appended to the
  *primary* section at
  `https://github.com/chrismessina/raycast-claude-artifacts/blob/main/src/search-artifacts.tsx#L82`.
  `Action.OpenInBrowser` stayed the first child (`:68`), so Enter was unchanged; the two sections
  that shifted down a row are all shortcut-addressable (⌘⇧O, ⌘⇧G, ⌘⇧I).

**Why refusing matters — the remedy is not free.** "Appended" taken literally means *last in the
whole panel*. Any placement other than dead-last shifts something, so full compliance puts a
per-item action **below** whatever global or diagnostic actions the panel ends with. Trading a
permanent information-architecture regression for row-position stability on actions that have
keyboard shortcuts is the wrong trade.

**Appending to the primary SECTION is still appending.** The rule reads as though a panel were one
flat list. Where the panel is sectioned, an action that operates on the selected item belongs in
the section with the other per-item actions — nothing inside that section moved, and that is the
scope the rule should be measured against.

**Reply, don't just ignore.** Greptile's comment ends with *"reply to this and let me know. I'll
remember it for next time!"* — a reply tunes the rule across the whole fleet, so it stops firing on
appends-to-the-primary-section. **Posting it is Chris's call, not yours** (same standing rule as
never running `gh pr ready`): draft the reply, hand it to him.

**It works — this is not a theoretical courtesy.** On #30626 the reviewer replied to the posted
reasoning with *"I reconsidered it against the actual panel structure, and I'm withdrawing the
concern … No change is needed."* A declined finding left unanswered just re-fires on the next PR.
