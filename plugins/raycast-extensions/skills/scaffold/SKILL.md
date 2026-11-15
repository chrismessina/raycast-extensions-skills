---
name: scaffold
description: Ideate and scaffold a NET-NEW Raycast extension — when no extension exists yet and you need to shape the idea, pick the command type, and lay down the manifest + first command. Fires on "create / start / scaffold a new Raycast extension." Hands off to `develop` once the scaffold builds, typechecks, lints and passes `rx preflight`. Do NOT use to change an existing extension (that's `develop`).
metadata:
  stage: "1 — ideate + scaffold net-new"
  status: complete
---

# scaffold

## When this fires vs. not

- **Fires:** no extension exists yet. You're creating the folder, `package.json` manifest, and the first command/view.
- **Does NOT fire:** the extension already exists and you're changing it → that's `develop`.

The seam is **binary on existence**, so triggers never overlap with `develop`.

Mechanical checks run through the plugin's `rx` runner (`<plugin>` = two levels above this skill's base directory): `node`, then `"<plugin>/scripts/rx.mjs"`, then a command and its flags, as in `node "<plugin>/scripts/rx.mjs" doctor --root .`. Exit 0 = PASS/WARN/N/A only, 1 = a FAIL, 2 = an ERROR; quote the FAIL/ERROR lines. Contracts: [`../../reference/rx.md`](../../reference/rx.md).

## Documented learnings — cheapest to read here, before anything exists

`learnings/` in this plugin holds write-ups of defects and decisions from previous runs of these skills, each with the trigger that makes it relevant. **Read the row that matches what you are about to do — before doing it.** A learning is only useful at the moment it applies; rediscovering one after the review costs a round.

<!-- learnings:start -->
| When you are about to… | Read |
|---|---|
| call `useCachedPromise` / `useCachedState`, or branch on its `error` | [`use-cached-promise-caching-semantics`](../../learnings/design-patterns/use-cached-promise-caching-semantics.md) |
| drive a third-party Mac app through AppleScript or JXA | [`raycast-applescript-jxa-integration`](../../learnings/architecture-patterns/raycast-applescript-jxa-integration.md) |
| share mutable state between commands, or between an AI tool and an open command | [`portable-node-advisory-file-lock`](../../learnings/design-patterns/portable-node-advisory-file-lock.md) |
| show, copy, or log an error that may carry a server response or URL | [`error-display-is-a-credential-disclosure-surface`](../../learnings/security-issues/error-display-is-a-credential-disclosure-surface.md) |
<!-- learnings:end -->

**This skill is where the corpus is worth the most.** Every learning in `design-patterns/` describes a shape that was adopted, shipped, reviewed, and only then found wrong — and picking the right shape while the file is still empty costs nothing, while changing it later costs a review round and a Store release. `CONCEPTS.md` at the repo root defines the terms these learnings use.

> **The recurring shape:** the expensive defects in this fleet are the ones `tsc`, `ray lint`, and `ray build` all pass — a cache key that does not vary, a hook returning stale data alongside an error, an effect that cannot tell a fetch from a cache restore. Scaffolding chooses several of these shapes in one sitting. See [`use-cached-promise-caching-semantics`](../../learnings/design-patterns/use-cached-promise-caching-semantics.md) before reaching for `useCachedPromise` in a generated command.

## Ideation: reuse, don't rebuild

1. Run `superpowers:brainstorming` for idea-shaping. Do **not** re-implement an interview here.
2. Apply the **Raycast-API constraints overlay** on top of the brainstorm output:
   - Command type: `view` vs `no-view` vs `menu-bar` vs `AI tool` (`@raycast/api` tools).
   - API capabilities and limits (what Raycast can/can't do for this idea).
   - Single-command vs multi-command shape.

   **Source the overlay from the live docs, not from memory.** Use `reference/store-guidelines.md`'s step 1 (context7 → `/llmstxt/developers_raycast_llms-full_txt`, `WebFetch` fallback). Scope one question per call, e.g. *"when to use a menu-bar command vs a view command"*.

## Compliance gate — BEFORE generating files

**A net-new extension is the only path into the fleet that no other skill audits.** `develop` assumes the extension exists; `ship`'s pre-flight runs at submission, by which point a wrong *product shape* (config-as-a-command, a Windows claim on a macOS-only extension, a non-MIT license) is expensive to undo. Catch it here.

1. **Fetch the Store rules** — `reference/store-guidelines.md`, steps 1 and 2b. Run 2b's conditional router against the *intended* shape: planning a menu-bar command means fetching the menu-bar page **now**, not after it's written.
2. **Decide and write down**, before any file exists:
   - command mode(s) — `view` / `no-view` / `menu-bar` / AI `tools`
   - `platforms` — claim **only** what you'll actually support (an `osascript` call is macOS-only; don't list `Windows`)
   - `categories` — from the Store's fixed list
   - every piece of user config → a `preferences` entry. **Never a setup command.**

## House Style from the first file

New code conforms to House Style as it is written — the `[build]`, `[both]` and `[lint]` rules in [`../../reference/house-style.md`](../../reference/house-style.md) and the shortcut rules in [`../../reference/keyboard-conventions.md`](../../reference/keyboard-conventions.md). Don't scaffold code that `ship`'s audit would immediately flag. The two config files below are the `prettierrc` rule and Raycast's flat-config requirement (`rx preflight` `eslint-config`), copied from their canonical homes, not invented here.

## Scaffold procedure (executable)

```bash
mkdir -p raycast-<name> && cd raycast-<name>
npm init -y
# Caret range, matching the ecosystem convention (verified 2026-07-29: every extension
# in the fleet and upstream uses `^`). Do NOT use --save-exact.
# A new extension starts on 2.x — the preset's `dependencies.api.new` policy, floor 2.1.0;
# `rx api-floor` FAILs a new extension that resolves to 1.x. Never `^2.0`: 2.0.3 and 2.0.4
# are missing `Icon.Quicklink`. `dep-gates.md` owns the current leading edge.
npm install '@raycast/api@^2.1'
npm install --save-dev @raycast/eslint-config eslint prettier @ianvs/prettier-plugin-sort-imports typescript @types/node @types/react
```

Then write the manifest. **These fields are required and are what a reviewer checks first** — `name` must be the kebab-case Store slug and match the directory:

```jsonc
{
  "$schema": "https://www.raycast.com/schemas/extension.json",   // the preflight `schema` check FAILs without it
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

**Then create the files the manifest promises — the build fails without them.** A manifest referencing `"name": "index"` and `"icon": "icon.png"` needs the command source, the icon, and the tool configs:

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

# Flat ESLint config. Installing @raycast/eslint-config registers nothing by itself; `ray lint`
# needs this file, and `rx preflight` (`eslint-config`) requires defineConfig from "eslint/config".
cat > eslint.config.mjs <<'EOF'
import { defineConfig } from "eslint/config";
import raycastConfig from "@raycast/eslint-config";

export default defineConfig([...raycastConfig]);
EOF

# The `prettierrc` rule: this exact file, paired with the sort-imports devDependency above.
cat > .prettierrc <<'EOF'
{
  "printWidth": 120,
  "singleQuote": false,
  "plugins": ["@ianvs/prettier-plugin-sort-imports"],
  "importOrder": ["<BUILTIN_MODULES>", "<THIRD_PARTY_MODULES>", "^@raycast/(.*)$", "^[.]"]
}
EOF

printf 'node_modules\ndist\nraycast-env.d.ts\n.DS_Store\n' > .gitignore
printf '# <Human Title>\n\n<one paragraph: what it does and what it needs>\n' > README.md
printf '# <Human Title> Changelog\n\n## [Initial Version] - {PR_MERGE_DATE}\n' > CHANGELOG.md   # keep the placeholder; Raycast stamps it
```

**`assets/icon.png` (512×512) is a real PNG you must supply — the build and `rx preflight` (`icon-size`) fail without it.** It cannot be generated here; ask the user for it, or use a placeholder and flag it as a blocker in your report.

## Verify, then hand off

Run these from the extension root, in this order. **Build before `tsc`:** `ray build` generates `raycast-env.d.ts`, which `tsconfig.json` includes, so `tsc` on a fresh tree fails on the missing file rather than on your code (`tsc-gate` in `house-style.md`). `npx tsc --noEmit` is still the type gate reviewers run; `ray lint` never typechecks.

```bash
/bin/ls package-lock.json                  # REQUIRED by the Store; npm only, never yarn/pnpm
npm run build                              # generates raycast-env.d.ts, then bundles
npx tsc --noEmit                           # the type gate
npm run lint                               # ESLint through the flat config above
node "<plugin>/scripts/rx.mjs" preflight   # Store readiness, with the plugin preset
```

`rx preflight` emits every check; on a fresh scaffold many are `N/A` (not published, no `metadata/`, no shortcuts, no preferences) and that is fine. Only two **FAIL** ids are permitted: `screenshots` (a `view` command has no `metadata/*.png` yet; `ship` or `screenshots` supplies them) and `icon-size`, only while the icon is not a 512×512 PNG. Any other FAIL is a scaffold defect: fix it here.

**The completion boundary, stated once:** scaffold ends when build, `tsc`, lint and `rx preflight` have all run and every FAIL is one of those two permitted ids. Until then the extension does not exist for `develop`; from then on, every edit is `develop`'s. A scaffold that hasn't built and linted is not a scaffold — it's a guess.

## Output location

Scaffold into a standalone working dir. If you keep the extension in its own GitHub repo, create it **after** the first merge — it is not a prerequisite for submitting.

## Hands off

→ `develop` for the real command code, once the completion boundary above is met.

→ then `ship`, which submits a net-new extension via **Route A (`ray publish`)** — the default for **every** first submission. Nothing about a first submission needs a standalone repo, a git remote, or a published baseline.

## AI capabilities need a newer `@raycast/api` floor

The general floor is `^2.1` (`reference/dep-gates.md`). An extension that uses one of these targets the version where it first exists instead — the derivation is in the skills repo's `~/Developer/GitHub/chrismessina/raycast-extensions-skills/docs/reference/raycast-api-changelog.md`:

| Capability | Declared as | First in |
|---|---|---|
| Agent Skills (`skills/<name>/SKILL.md`, validated at build) | `ai.skills` / `ai.yaml` | `^2.4.0` |
| Provide AI models (`getModels`, `streamCompletion`, `AI.refreshModels`) | `ai.modelProvider` | `^2.5.0` |
| MCP server (build writes `.mcp.json` unchecked; the app validates it on load — stdio, or http/sse with optional headers and OAuth) | `ai.mcp` / `ai.yaml` | `^2.5.0` |

**Do not scaffold `widgets`.** 2.7.0 added a top-level `widgets` manifest array (`src/widgets/<name>`), but it is dark on both sides as of 2.7.2: the public CLI throws *"Widgets require a Development or Internal build of @raycast/api."* on any non-empty `widgets`, and the 2.7.2.0 app throws *"Widgets are not supported in this build"* when launching one. Re-check the changelog before relying on it.
