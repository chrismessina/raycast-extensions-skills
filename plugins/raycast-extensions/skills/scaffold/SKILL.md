---
name: scaffold
description: Ideate and scaffold a NET-NEW Raycast extension — when no extension exists yet and you need to shape the idea, pick the command type, and lay down the manifest + first command. Fires on "create / start / scaffold a new Raycast extension." Hands off to `develop` once files exist. Do NOT use to change an existing extension (that's `develop`).
metadata:
  stage: "1 — ideate + scaffold net-new"
  status: complete
---

# scaffold

## When this fires vs. not

- **Fires:** no extension exists yet. You're creating the folder, `package.json` manifest, and the first command/view.
- **Does NOT fire:** the extension already exists and you're changing it → that's `develop`.

The seam is **binary on existence**, so triggers never overlap with `develop`.

## Documented learnings — cheapest to read here, before anything exists

`learnings/` in this plugin holds write-ups of defects and decisions from previous runs of these skills, each with the trigger that makes it relevant. **Read the row that matches what you are about to do — before doing it.** A learning is only useful at the moment it applies; rediscovering one after the review costs a round.

| When you are about to… | Read |
|---|---|
| calling `useCachedPromise` / `useCachedState`, or branching on its `error` | [`use-cached-promise-caching-semantics`](../../learnings/design-patterns/use-cached-promise-caching-semantics.md) |
| sharing mutable state between commands, or between an AI tool and an open command | [`portable-node-advisory-file-lock`](../../learnings/design-patterns/portable-node-advisory-file-lock.md) |
| showing, copying, or logging an error that may carry a server response or URL | [`error-display-is-a-credential-disclosure-surface`](../../learnings/security-issues/error-display-is-a-credential-disclosure-surface.md) |
| driving a third-party Mac app through AppleScript or JXA | [`raycast-applescript-jxa-integration`](../../learnings/architecture-patterns/raycast-applescript-jxa-integration.md) |

**This skill is where the corpus is worth the most.** Every learning in `design-patterns/` describes a shape that was adopted, shipped, reviewed, and only then found wrong — and picking the right shape while the file is still empty costs nothing, while changing it later costs a review round and a Store release. `CONCEPTS.md` at the repo root defines the terms these learnings use.

> **The recurring shape:** the expensive defects in this fleet are the ones `tsc`, `ray lint`, and `ray build` all pass — a cache key that does not vary, a hook returning stale data alongside an error, an effect that cannot tell a fetch from a cache restore. Scaffolding chooses several of these shapes in one sitting. See [`use-cached-promise-caching-semantics`](../../learnings/design-patterns/use-cached-promise-caching-semantics.md) before reaching for `useCachedPromise` in a generated command.

## Ideation: reuse, don't rebuild

1. Run `superpowers:brainstorming` for idea-shaping. Do **not** re-implement an interview here.
2. Apply the **Raycast-API constraints overlay** on top of the brainstorm output:
   - Command type: `view` vs `no-view` vs `menu-bar` vs `AI tool` (`@raycast/api` tools).
   - API capabilities and limits (what Raycast can/can't do for this idea).
   - Single-command vs multi-command shape.

   **Source the overlay from the live docs, not from memory** — same rule as every other
   skill here. Use `reference/store-guidelines.md`'s step 1 (context7 →
   `/llmstxt/developers_raycast_llms-full_txt`, `WebFetch` fallback). Scope one question
   per call, e.g. *"when to use a menu-bar command vs a view command"*.

   *(This previously pointed at `docs/shelf.md` and a Craft MCP endpoint. Neither is
   reachable: `docs/shelf.md` does not exist in this repo — verified 2026-07-28 — and the
   MCP is not wired into this workspace. A step that depends on unavailable material is a
   step that silently doesn't run.)*

## Compliance gate — BEFORE generating files

**A net-new extension is the only path into the fleet that no other skill audits.**
`develop` assumes the extension exists; `ship`'s pre-flight runs at submission, by which
point a wrong *product shape* (config-as-a-command, a Windows claim on a macOS-only
extension, a non-MIT license) is expensive to undo. Catch it here.

1. **Fetch the Store rules** — `reference/store-guidelines.md`, steps 1 and 2b. Run 2b's
   conditional router against the *intended* shape: planning a menu-bar command means
   fetching the menu-bar page **now**, not after it's written.
2. **Decide and write down**, before any file exists:
   - command mode(s) — `view` / `no-view` / `menu-bar` / AI `tools`
   - `platforms` — claim **only** what you'll actually support (an `osascript` call is
     macOS-only; don't list `Windows`)
   - `categories` — from the Store's fixed list
   - every piece of user config → a `preferences` entry. **Never a setup command.**

## Scaffold procedure (executable)

```bash
mkdir -p raycast-<name> && cd raycast-<name>
npm init -y
# Caret range, matching the ecosystem convention (verified 2026-07-29: every extension
# in the fleet and upstream uses `^`). Do NOT use --save-exact.
#
# Pin the MINOR, not bare `@latest`. A new extension starts on the LEADING EDGE from
# `dep-gates.md` — currently `^2.1` (2026-08-27). Never `^2.0`: 2.0.3 and 2.0.4 are
# missing `Icon.Quicklink`, and 2.1.0 restored `Icon` to an enum and un-renamed the
# `KeyboardShortcut` alias. `dep-gates.md` owns this number — check it before editing here.
npm install '@raycast/api@^2.1'
npm install --save-dev @raycast/eslint-config eslint prettier typescript @types/node @types/react
```

Then write the manifest. **These fields are required and are what a reviewer checks
first** — `name` must be the kebab-case Store slug and match the directory:

```jsonc
{
  "name": "<kebab-case-slug>",
  "title": "<Human Title>",
  "description": "<one sentence, specific — not 'a Notion extension'>",
  "icon": "icon.png",                    // 512×512 PNG in assets/
  "author": "chrismessina",
  "license": "MIT",                      // MIT is REQUIRED
  "platforms": ["macOS"],                // only what you support
  "categories": ["Productivity"],
  "commands": [{ "name": "index", "title": "…", "description": "…", "mode": "view" }],
  "scripts": {
    "build": "ray build -e dist",
    "dev": "ray develop",
    "lint": "ray lint",
    "fix-lint": "ray lint --fix",
    "publish": "npx @raycast/api@latest publish"
  }
}
```

**Then create the files the manifest promises — the build fails without them.** A
manifest referencing `"name": "index"` and `"icon": "icon.png"` needs all three:

```bash
mkdir -p src assets

# src/<command-name>.tsx — MUST match the command's `name` in the manifest.
cat > src/index.tsx <<'EOF'
import { List } from "@raycast/api";

export default function Command() {
  return (
    <List>
      <List.EmptyView title="Nothing here yet" description="Replace me." />
    </List>
  );
}
EOF

cat > tsconfig.json <<'EOF'
{
  "$schema": "https://json.schemastore.org/tsconfig",
  "include": ["src/**/*", "raycast-env.d.ts"],
  "compilerOptions": {
    "lib": ["ES2023"],
    "module": "commonjs",
    "target": "ES2022",
    "strict": true,
    "isolatedModules": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "jsx": "react-jsx",
    "resolveJsonModule": true
  }
}
EOF

printf 'node_modules\ndist\nraycast-env.d.ts\n.DS_Store\n' > .gitignore
```

**`assets/icon.png` (512×512) is a real PNG you must supply — the build fails without
it.** It cannot be generated here; ask the user for it, or use a placeholder and flag it
as a blocker in your report. Do not claim the scaffold is complete while the icon is
missing.

**Verify before handing off — all four must pass:**

```bash
ls package-lock.json                  # REQUIRED by the Store; npm only, never yarn/pnpm
npx tsc --noEmit                      # build/lint do NOT typecheck
npm run build
npm run lint
```

A scaffold that hasn't built and linted is not a scaffold — it's a guess. Do not hand to
`develop` until all four are green.

## Output location

Scaffold into a standalone working dir. If you keep the extension in its own GitHub repo, create it **after** the first merge — it is not a prerequisite for submitting.

## Hands off

→ `develop` once files exist and you're writing real command code.

→ then `ship`, which submits a net-new extension via **Route A (`ray publish`)** — the
default for **every** first submission. Nothing about a first submission needs a
standalone repo, a git remote, or a published baseline.

## House Style from the start

New code must conform to House Style as it's written — see `reference/house-style.md` (`[build]` entries) and `reference/keyboard-conventions.md`. Don't scaffold code that the `ship` house-style audit would immediately flag.
