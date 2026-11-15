---
name: api-changelog
description: Derive what changed between two published versions of @raycast/api, which Raycast ships with no release notes. Fires on "what's new in @raycast/api X", "is it safe to upgrade", "derive a changelog", "they don't publish a changelog", or a pasted npmjs.com/package/@raycast/api URL. Produces a verified entry in the skills repo's docs/reference/raycast-api-changelog.md (a checkout is required; see "Write it up"). Does NOT change extension code (that's `develop`) and does NOT submit anything (that's `ship`).
metadata:
  stage: "0 — vendor intelligence, feeds every other stage"
---
# api-changelog

Raycast ships `@raycast/api` to npm with **no changelog, no release notes, and no readable tags**. Its docs site keeps one — [developers.raycast.com/misc/changelog](https://developers.raycast.com/misc/changelog) — but it **skips releases** (fetched 2026-09-24: 2.5.0 present, 2.4.0 and 2.4.1 absent, so the Skills capability that shipped in the 2.4.0 CLI first appears there under 2.5.0). Treat it as Tier 3: leads to verify, never a source.
This skill is the derivation. The answers change what the other skills do: 2.3.0 silently repointed AI model ids, and 2.4.0 added a whole extension capability (Skills). **Scope: `@raycast/api` only.** Every path, heuristic and output location below is specific to it. `@raycast/utils` and `@raycast/eslint-plugin` ship different layouts — the *method* transfers, the commands do not.

<!-- learnings:start -->
| When you are about to… | Read |
|---|---|
| bump, floor, or migrate @raycast/api and want to know why the policy says what it says | [`raycast-api-policy-history`](../../learnings/tooling-decisions/raycast-api-policy-history.md) |
| cite a Keyboard.Shortcut.Common binding from the docs, the linter or the runtime | [`keyboard-shortcut-sources-divergence-history`](../../learnings/tooling-decisions/keyboard-shortcut-sources-divergence-history.md) |
<!-- learnings:end -->

## The core discipline

**Every claim in the output must come from an artifact you read.**

| Tier | Artifact | Authoritative for |
|---|---|---|
| 1 | The installed **Raycast.app** JS bundles | What the runtime does — real values, gates, limits |
| 2 | The published **npm tarball** | The API surface, the CLI, what the build emits |
| 3 | Vendor prose (docs site, Slack, blog) | **Nothing.** A lead to verify, never a source |

- **Date every Tier-3 claim, and re-fetch before repeating one.** A stale note saying a vendor doc is wrong is as damaging as the wrong doc: it survives the fix and sounds like earned knowledge. *Evidence:* on 2026-09-07 the docs listed `Common.Pin` as ⌘⇧P while the runtime bound ⌘.; Raycast fixed the docs (`raycast/extensions` #30879, #30538) and by 2026-09-15 all 17 rows matched, but our September warning was still being repeated as present-tense fact until a Raycast engineer pushed back.
- **Tier 3 never becomes a changelog claim.** If vendor prose is the only support, write it as an attributed, unverified assertion ("Raycast's release note says X; these diffs neither confirm nor contradict it").

## 1. Diff the two packages with the runner

Take an OLD and a NEW version as inputs; never guess them. Each must be an exact published version (`2.4.1`, not a range, a tag or `latest`). `<plugin>` is two levels above this skill's base directory. The work directory must be fresh and outside any repo, because the runner leaves both extracted packages there for steps 2 and 3, and refuses a directory that already holds either version.

```bash
OLD=2.3.0        # baseline
NEW=2.4.1        # the version being asked about
WORK="$(mktemp -d "${TMPDIR:-/tmp}/rx-api-diff.XXXXXX")"
node "<plugin>/scripts/rx.mjs" api-diff "$OLD" "$NEW" --out "$WORK" --json
```

Exit 2 is an `ERROR` (a version not on npm, or a pack, extraction or read failure). Quote the `ERROR` line and stop: it never means an empty diff. Exit 0 means every check is PASS, WARN or N/A, and `data` is the evidence below. The command describes a release; it never judges one, so it cannot FAIL.

Record the installed app, which step 4 cites by build. App and package version numbers have coincided on every pair checked (2.3.0/2.3.0.0, 2.4.1/2.4.1.0); that is **not** a stated policy: it picks which app to open, and a runtime observation is evidence about *that installed build*, never about a historical tarball you had no app for.

```bash
plutil -p /Applications/Raycast.app/Contents/Info.plist | command grep CFBundleShortVersionString
```

### Read the two checks first

- **`api-diff-window` WARN** (`N intermediate version(s): …`, listed in `data.window` in publish order): a change between OLD and NEW may belong to any of them. Before attributing a change to NEW, run the same call on each adjacent pair (OLD to the first intermediate, and so on up to NEW), each with its own fresh `WORK`. "Your version added nothing" is an answer you can only give by checking the gaps. PASS means the two are adjacent.
- **`api-diff` N/A** `only version fields changed`: no file was added or removed, and every changed file differs only in its version field: the top-level `version` of a JSON file, or one whole quoted version literal (`"2.11.0"`) in a text file, with no mode change. This is a pure version bump. Report zero functional change and stop. Equal sizes or a few differing digits never prove this; only this verdict does.
- **`api-diff` PASS**: the one-line summary counts files added, removed and changed, and the `types/index.d.ts` delta. Read `data` below.

### Read `data`

Paths are relative to `package/`. The packages sit at `data.dirs.from` and `data.dirs.to`; use those two paths everywhere below. The runner makes the earlier-published version the baseline whichever order you gave, so if `data.from` is not `$OLD`, swap OLD and NEW before setting these:

```bash
OLDD="$WORK/$OLD/package"   # data.dirs.from
NEWD="$WORK/$NEW/package"   # data.dirs.to
```

| Field | What it tells you | Confirm before writing it up |
|---|---|---|
| `data.files.added` / `.removed` | Whole files that appeared or went away | A new file under `dist/commands/` is a bundle, not an exposed command: it must also appear in `data.cli.commandsAdded` |
| `data.files.changed` | `{ path, fromBytes, toBytes, versionOnly }` per file | Size deltas are **investigation cues, never conclusions**. `versionOnly: false` is a cue too: a bundle that embeds the version string more than once is reported as changed, so read it before calling it a change. A bundle that grew more than 100 KB goes to step 3: growth can be a dependency bump or dead code. *Evidence:* on the 2.4.1 pass, `dist/utils/skills.js` (118 KB) and `dist/utils/agent-plugin.js` WERE the release |
| `data.declarations` | `types/index.d.ts`: `added` / `removed` line counts and the unified `diff` | Step 2. A file that **shrank** is not a removal until you read the `-` hunks: comments and internal `declare`s also shrink it |
| `data.distTypes` | Files under `dist/types/` added, removed or changed | All three lists empty: write exactly **"the `dist/types/` declarations are byte-identical."** It says nothing about component or hook *runtime behavior*, which lives in the bundles and the app |
| `data.cli` | `oclif.manifest.json` commands and flags added and removed, and `changed`: every other leaf that moved (a flag's `default`, `options`, `required`, args, descriptions) as `{ path, kind, from?, to? }` | A removed command or flag is a breaking change only if an extension's `package.json` scripts use it. A `changed` default is a behavior change for everyone who omits the flag. `kind` `added`/`removed` means the leaf exists on one side only |

## 2. Read the public API surface

The diff of `types/index.d.ts` is `data.declarations.diff` (empty string when unchanged).

- **Read the `+` lines before concluding anything was removed.** An enum member that moves from the active block to the deprecated block shows as a `-` *and* a `+`; reading only `-` reports a breaking removal that did not happen (made and caught on the 2.4.1 pass).
- **`declare type` ≠ `export type`, but non-export is not the whole test.** A type can vanish without breaking anyone only if nothing exported *referenced* it: `command grep -n "<TypeName>" "$OLDD/types/index.d.ts"`, then confirm every hit's enclosing declaration is `declare`, not `export`. (2.4.0 dropped the whole `ExtensionModel*` family this way — 31 references, all `declare`, nothing reachable from the public surface.)

## 3. Mine the changed bundles for behavior

Identifier churn makes a raw diff useless. Diff **natural-language strings**, which survive minification, against **every bundle in `data.files.changed` and `data.files.added`**, not just `lint`:

```bash
F=dist/commands/lint/index.js        # set per bundle; a file in data.files.added or .removed exists on one side only, so say so
NL='"[A-Za-z][A-Za-z0-9 ,.:;!?()\x27/-]{14,200}"'
diff <(command grep -oE "$NL" "$OLDD/$F" | sort -u) <(command grep -oE "$NL" "$NEWD/$F" | sort -u) \
  | command grep -E '^>' || echo "(no new natural-language strings in $F)"

ID='"[A-Za-z0-9_.@/-]{3,60}"'       # filenames and config keys the new code looks for — this is what exposes a capability
comm -13 <(command grep -oE "$ID" "$OLDD/$F" | sort -u) <(command grep -oE "$ID" "$NEWD/$F" | sort -u) \
  | command grep -iE '\.(ya?ml|json5?|md|toml)|config|^"\.' || echo "(no new file-ish identifiers)"
```

The identifier probe is what surfaced `ai.yaml`, `ai.json5` and `SKILL.md` in 2.4.0. **Both probes generate leads; neither proves completeness.** They skip template literals, concatenated strings and short tokens, so an empty result means *this probe found nothing*. When a bundle grew materially and the probes come back empty, write "growth unexplained", not "no change".

## 4. Answer "what is it FOR" from the app

The package tells you a feature exists; the installed app tells you what consumes it:

```bash
command grep -rl "<the new token>" /Applications/Raycast.app/Contents/Resources/macos-app_RaycastDesktopApp.bundle/Contents/Resources/
```

Layout as of Raycast **2.4.1.0** (re-check after an app update; not contractual): backend `…/Resources/backend/index.mjs`; frontend `…/Resources/frontend/main-window-*.js`; **the live `@raycast/api` runtime shim** `…/Resources/api/node_modules/@raycast/api/index.js`. The shim holds real values the npm package only types — `Keyboard.Shortcut.Common`'s bindings were found there and in no tarball (the npm package ships types with no `index.js`, so looking there returns nothing and feels like confirmation).

- **Look for a gate.** A shipped CLI feature is often dark in the public app: a constant-folded `if(!!1)throw new Error("… only available in internal builds")` is an internal flag. Before writing "users cannot do this", trace the public entry point to that branch and confirm no other route reaches the feature; a guarded branch proves only that *that* path throws.
- **Search for an entitlement on the object the feature produces, not only near its name.** On the 2.5.0 pass nothing within a few hundred bytes of any `modelProvider` reference mentioned Pro, and the entry nearly said so; the gate was `allowed_subscription_types: ["pro", "advanced_ai"]` on the registered model object, read by a separate module. Search the subscription vocabulary itself (`subscription`, `allowed_`, `requires_`, `pro`) across the bundles, then trace hits back.

## 5. Write it up

The changelog lives in the **skills repository**, not in this plugin. A plugin installed from GitHub carries no `docs/`, so the destination must be resolved explicitly against a checkout of `chrismessina/raycast-extensions-skills` and the run stops if there is none:

```bash
SKILLS="${SKILLS:-$HOME/Developer/GitHub/chrismessina/raycast-extensions-skills}"
OUT="$SKILLS/docs/reference/raycast-api-changelog.md"
[ -f "$OUT" ] || { echo "no checkout at $SKILLS — clone chrismessina/raycast-extensions-skills there or set SKILLS"; exit 1; }
```

Append to `$OUT` (`~/Developer/GitHub/chrismessina/raycast-extensions-skills/docs/reference/raycast-api-changelog.md` on this machine), newest first. Every entry states: the **baseline version** diffed against and its date; what did **not** change, when that is the reassuring part; **fleet impact** — what an extension author must now do, or explicitly nothing; and the **derivation** for anything non-obvious, so it can be rechecked when tooling drifts.

## 6. Separate what you established from what you inferred

The step most likely to be skipped, and the one an adversarial reviewer always catches. Sort every claim before writing:

| You have | You may write | You may NOT write |
|---|---|---|
| Two artifacts disagreeing today | "These versions disagree" | "Version X broke it" — you did not diff X |
| Feature in CLI, gated in app | "Differing availability" | "The CLI half landed first" — chronology you did not observe |
| Enum values repointed | "These members now resolve to different ids" | "Provider Y is gone" |
| Matching app/API version numbers | "These two coincide" | "They version in lockstep" |
| Identical schema identifiers | "The identifier set is unchanged" | "The schema did not change" — constraints can move |
| Suggestive type or symbol names | The names, quoted | Their purpose or release status |
| Two things landing in one release | "They arrived together" | "A was added for B" |

## Hand-offs

A finding nothing points at does not compound. Wire it in the same session you find it.

| Finding | Goes to |
|---|---|
| Keyboard / `Common` binding change | [`reference/keyboard-conventions.md`](../../reference/keyboard-conventions.md); `rx shortcuts runtime` re-records the table |
| New extension capability (Skills, `ai.yaml`, `help.md`) | [`skills/scaffold`](../scaffold/SKILL.md) + `ship`'s weeding step |
| New or changed lint/validate rule | [`skills/develop`](../develop/SKILL.md)'s house-style audit |
| Dependency floor or breaking bump | [`reference/dep-gates.md`](../../reference/dep-gates.md) and the preset's `dependencies.api` floors |
