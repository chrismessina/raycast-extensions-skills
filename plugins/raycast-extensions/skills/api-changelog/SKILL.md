---
name: api-changelog
description: Derive what changed between two published versions of @raycast/api, which Raycast ships with no release notes. Fires on "what's new in @raycast/api X", "is it safe to upgrade", "derive a changelog", "they don't publish a changelog", or a pasted npmjs.com/package/@raycast/api URL. Produces a verified entry in docs/reference/raycast-api-changelog.md. Does NOT change extension code (that's `develop`) and does NOT submit anything (that's `ship`).
metadata:
  stage: "0 — vendor intelligence, feeds every other stage"
---

# api-changelog

Raycast ships `@raycast/api` to npm with **no changelog, no release notes, and no readable tags**
(observed through 2.4.1, 2026-09-14). The npm page gives you a version number and a date; everything
else has to be derived from artifacts.

This skill is that derivation. It exists because the answers change what the other skills do: 2.3.0
silently repointed AI model ids, and 2.4.0 added a whole extension capability (Skills).

**Scope: `@raycast/api` only.** Every path, heuristic, and output location below is specific to it.
`@raycast/utils` and `@raycast/eslint-plugin` ship different layouts — the *method* transfers, the
commands do not. Adapt deliberately; do not run these verbatim against another package.

## The core discipline

**Every claim in the output must come from an artifact you read.**

| Tier | Artifact | Authoritative for |
|---|---|---|
| 1 | The installed **Raycast.app** JS bundles | What the runtime does — real values, gates, limits |
| 2 | The published **npm tarball** | The API surface, the CLI, what the build emits |
| 3 | Vendor prose (docs site, Slack, blog) | **Nothing.** A lead to verify, never a source |

Tier 3 is where the failures come from — **in both directions**. On 2026-09-07
`developers.raycast.com` documented `Common.Pin` as ⌘⇧P while the runtime bound ⌘., and two
automated reviewers filed the same wrong finding from that page. Raycast then **fixed the docs**
(`raycast/extensions` #30879, #30538), and by 2026-09-15 all 17 documented rows matched the runtime
exactly — but the warning written in September was still sitting in our reference file asserting the
docs were wrong, and got repeated into this skill as present-tense fact. It took a Raycast engineer
pushing back to catch it.

**So: date every Tier-3 claim, and re-fetch before repeating one.** A stale note saying a vendor
doc is wrong is as damaging as the wrong doc was — it survives the fix, and it sounds like earned
institutional knowledge.

**Tier 3 never becomes a changelog claim.** If vendor prose is the only support for something, it
belongs in the entry as an explicitly attributed, unverified assertion ("Raycast's release note
says X; these diffs neither confirm nor contradict it") — never as a derived finding.

## Setup — do this first, everything below depends on it

Take an OLD and a NEW version as inputs. Never guess them.

```bash
SCRATCH="${SCRATCH:-$(mktemp -d)}"; cd "$SCRATCH" || exit 1
OLD=2.3.0        # baseline
NEW=2.4.1        # the version being asked about
```

**Compute the version window** — every release between the two, inclusive, in publish order. The
intermediates matter: a change attributed to `$NEW` is often several releases old, and "your version
added nothing" is a real answer you can only give by checking the gaps.

```bash
npm view @raycast/api time --json > time.json
VERSIONS=$(python3 - "$OLD" "$NEW" <<'EOF'
import json, sys
old, new = sys.argv[1], sys.argv[2]
t = {k: v for k, v in json.load(open("time.json")).items() if k not in ("created", "modified")}
order = sorted(t, key=lambda k: t[k])          # publish order, not semver order
i, j = order.index(old), order.index(new)
print("\n".join(order[min(i, j):max(i, j) + 1]))   # ONE PER LINE — see the zsh note below
EOF
) || { echo "could not resolve version window"; exit 1; }
echo "window:"; echo "$VERSIONS"
```

> 🚨 **Loop with `while read`, never `for v in $VERSIONS`.** Chris's shell is **zsh**, which does
> *not* word-split unquoted parameter expansions the way bash does. `for v in $VERSIONS` passes the
> whole string as ONE argument, and you get
> `npm error notarget No matching version found for @raycast/api@2.3.0 2.3.1 2.4.0 2.4.1`.
> Verified by running this skill's own recipe, 2026-09-15. Newline-separated + `while read` behaves
> identically in bash and zsh.
```

**Fetch and extract, failing loudly.** A silently missing tarball is how an empty diff gets misread
as "no changes".

```bash
while IFS= read -r v; do
  [ -n "$v" ] || continue
  npm pack "@raycast/api@$v" >/dev/null 2>&1 || { echo "FAILED to pack $v"; break; }   # notices are on STDERR
  d="v$(echo "$v" | tr -d '.')"; mkdir -p "$d"
  tar xzf "raycast-api-$v.tgz" -C "$d" || { echo "FAILED to extract $v"; break; }
  [ -f "$d/package/types/index.d.ts" ] || { echo "$v: missing types/index.d.ts"; break; }
  echo "ok $v -> $d"
done <<< "$VERSIONS"

OLDD="v$(echo "$OLD" | tr -d '.')/package"      # use these two everywhere below
NEWD="v$(echo "$NEW" | tr -d '.')/package"
```

Record the installed app, which you will need in step 5 and must cite by build:

```bash
plutil -p /Applications/Raycast.app/Contents/Info.plist | grep CFBundleShortVersionString
```

> App and package version numbers have coincided on every pair checked (2.3.0/2.3.0.0,
> 2.4.1/2.4.1.0). That is **not** a stated policy. It is only good enough to pick which app to open,
> and a runtime observation is evidence about *that installed build* — never about a historical
> tarball you did not have an app for.

## 1. Inventory what moved

Never start by diffing 4 MB minified bundles. Start with what changed at all.

```bash
(cd "$OLDD" && find . -type f | sort) > /tmp/a
(cd "$NEWD" && find . -type f | sort) > /tmp/b
diff -u /tmp/a /tmp/b | grep -E '^[+-][^+-]' || echo "(no files added or removed)"

while IFS= read -r f; do
  [ -f "$NEWD/$f" ] || continue
  cmp -s "$OLDD/$f" "$NEWD/$f" || \
    echo "CHANGED $f $(wc -c < "$OLDD/$f") -> $(wc -c < "$NEWD/$f")"
done < /tmp/a
```

Read size deltas as **investigation cues, never conclusions**. Each one tells you where to look; the
right-hand column is what actually settles it:

| Cue | Confirm it by |
|---|---|
| New file under `dist/commands/` | It appearing in `oclif.manifest.json` — a bundle is not an exposed command |
| `types/index.d.ts` **shrank** | Reading the `-` hunks: comments and internal `declare`s also shrink it |
| A bundle grew >100 KB | Finding the actual new strings/filenames (step 3) — growth can be a dep bump or dead code |
| Only `version/index.js`, `oclif.manifest.json`, `package.json` changed | The byte check below — **size equality proves nothing** |

> 🚨 **`diff -u`, not `diff`.** Plain `diff` emits `<` and `>`; only unified format emits `+`/`-`.
> Grepping `^[+-]` against plain `diff` output matches nothing and prints
> "(no files added or removed)" — a **silent false negative that looks like a clean result**.
> This bit on the 2.4.1 pass: it hid `dist/utils/skills.js` (118 KB) and
> `dist/utils/agent-plugin.js`, i.e. the two files that WERE the release. Added files are the
> highest-signal thing in the inventory; never let this line fail quietly.

### The empty-release check

When those three files are the only changes, you likely have a pure version bump — but equal file
*sizes* do not establish equal *content*. A same-length functional edit is possible. Prove it:

```bash
for f in dist/commands/version/index.js oclif.manifest.json package.json; do
  echo "--- $f: $(cmp -l "$OLDD/$f" "$NEWD/$f" | wc -l) differing byte(s)"
  cmp -l "$OLDD/$f" "$NEWD/$f" | head -5
done
```

A handful of differing bytes that are all digit-to-digit (`0x60`→`0x61` is `0`→`1`) **is** the
version string and nothing else — then, and only then, report "zero functional change" and stop.
2.3.1 and 2.4.1 were each exactly this: one differing byte per file.

## 2. Diff the public API surface

```bash
diff -u "$OLDD/types/index.d.ts" "$NEWD/types/index.d.ts" > types.diff; wc -l types.diff
diff -rq "$OLDD/dist/types" "$NEWD/dist/types" || echo "(dist/types differs — read it)"
```

> 🚨 **Read the `+` lines before concluding anything was removed.** An enum member that leaves the
> active block and reappears in the deprecated block shows as a `-` *and* a `+`. Reading only the
> `-` side reports a breaking removal that did not happen — this exact mistake was made on the
> 2.4.1 pass and caught only by checking additions.

> 🚨 **`declare type` ≠ `export type`, but non-export is not the whole test.** A type can vanish
> without breaking anyone only if nothing exported *referenced* it either. Check both:
> ```bash
> grep -n "export .*<TypeName>\|<TypeName>" "$OLDD/types/index.d.ts"
> ```
> then walk each hit back to its enclosing declaration and confirm every one is `declare`, not
> `export`. (2.4.0 dropped the whole `ExtensionModel*` family this way — 31 references, all
> `declare`, none exported, nothing reachable from the public surface.)

If `dist/types/` is byte-identical, write exactly that: **"the `dist/types/` declarations are
byte-identical."** It does not establish that component or hook *runtime behavior* is unchanged —
that lives in the bundles and the app, and you have not looked there yet.

## 3. Mine the changed bundles for behavior

Identifier churn makes a raw diff useless — the minifier renames everything. Diff **natural-language
strings**, which survive minification. Run this against **every bundle the inventory flagged**, not
just `lint`:

```bash
F=dist/commands/lint/index.js        # set per bundle flagged by the inventory
[ -f "$OLDD/$F" ] && [ -f "$NEWD/$F" ] || echo "NOTE: $F missing on one side (new or removed file)"

NL='"[A-Za-z][A-Za-z0-9 ,.:;!?()\x27/-]{14,200}"'
diff <(grep -oE "$NL" "$OLDD/$F" | sort -u) \
     <(grep -oE "$NL" "$NEWD/$F" | sort -u) \
  | grep -E '^>' || echo "(no new natural-language strings in $F)"
```

Then diff short identifiers to surface **filenames and config keys** the new code looks for. This is
what exposes a new capability:

```bash
ID='"[A-Za-z0-9_.@/-]{3,60}"'
comm -13 <(grep -oE "$ID" "$OLDD/$F" | sort -u) \
         <(grep -oE "$ID" "$NEWD/$F" | sort -u) \
  | grep -iE '\.(ya?ml|json5?|md|toml)|config|^"\.' || echo "(no new file-ish identifiers)"
```

That single command is what surfaced `ai.yaml`, `ai.json5`, and `SKILL.md` in 2.4.0.

**String mining generates leads; it does not prove completeness.** The regexes deliberately skip
template literals, concatenated strings, and short tokens. An empty result means *this probe found
nothing*, not *nothing changed*. When a bundle grew materially and the probes come back empty, say
the growth is unexplained rather than reporting no change.

### The CLI surface, both sides

```bash
manifest() { node -e '
  const m = require(require("path").resolve(process.argv[1]));   # bare relative path != a module
  for (const [k, c] of Object.entries(m.commands).sort()) {
    console.log(k + " :: " + (c.description || "").split("\n")[0]);
    for (const [fk, f] of Object.entries(c.flags || {}).sort())
      console.log("   --" + fk + " [" + f.type + "] " + (f.description || ""));
  }' "$1/oclif.manifest.json"; }
diff <(manifest "$OLDD") <(manifest "$NEWD") || true
```

Diffing both sides is the point — printing only the new one cannot show a **removed** command or a
changed flag default.

## 4. Answer "what is it FOR" from the app

The package tells you a feature exists. It cannot tell you what consumes it. The installed app can:

```bash
grep -rl "<the new token>" \
  /Applications/Raycast.app/Contents/Resources/macos-app_RaycastDesktopApp.bundle/Contents/Resources/
```

Layout as of Raycast **2.4.1.0** (re-check after an app update; these paths are not contractual):

- backend — `.../Resources/backend/index.mjs`
- frontend — `.../Resources/frontend/main-window-*.js`
- **the live `@raycast/api` runtime shim** — `.../Resources/api/node_modules/@raycast/api/index.js`

That last one holds real values the npm package only types. `Keyboard.Shortcut.Common`'s actual
bindings were found there and in no tarball — the npm package ships types with no `index.js`, so
looking there returns nothing and feels like confirmation.

**Look for a gate.** A shipped CLI feature is often dark in the public app. A constant-folded
`if(!!1)throw new Error("… only available in internal builds")` is an internal flag. Before writing
"users cannot do this", trace the public entry point to that branch and confirm no other route
reaches the feature — a guarded branch proves only that *that* path throws.

## 5. Write it up

Append to
[`docs/reference/raycast-api-changelog.md`](../../../../docs/reference/raycast-api-changelog.md),
newest first. Every entry states:

- The **baseline version** diffed against, and its date.
- What did **not** change, when that is the reassuring part.
- **Fleet impact** — what an extension author must now do, or explicitly nothing.
- The **derivation** for anything non-obvious, so it can be rechecked when tooling drifts.

## 6. Separate what you established from what you inferred

The step most likely to be skipped, and the one an adversarial reviewer always catches. Sort every
claim before writing:

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
| Keyboard / `Common` binding change | [`reference/keyboard-conventions.md`](../../reference/keyboard-conventions.md) + `ship`'s keyboard gate |
| New extension capability (Skills, `ai.yaml`, `help.md`) | [`skills/scaffold`](../scaffold/SKILL.md) + `ship`'s weeding step |
| New or changed lint/validate rule | [`skills/develop`](../develop/SKILL.md)'s house-style audit |
| Dependency floor or breaking bump | [`reference/dep-gates.md`](../../reference/dep-gates.md) |
