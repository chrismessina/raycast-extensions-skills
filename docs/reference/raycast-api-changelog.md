# @raycast/api — derived changelog

Raycast publishes no changelog for `@raycast/api` on npm. This file is derived by diffing the
published tarballs (`npm pack @raycast/api@<v>`), comparing `types/index.d.ts`, `oclif.manifest.json`,
and the natural-language string sets extracted from the minified `dist/` bundles.

Method — a **starting** recipe, not the full derivation. It covers the 2.2.1→2.3.0 type and CLI-command
diff. Claims in this file also rest on steps not shown here: the 1.104.25→2.0.3 pair, comparing
`dist/types/`, extracting natural-language strings from the minified `dist/` bundles, reading the
installed `Raycast.app` JS bundles and its `CFBundleShortVersionString`, and fetching
`@raycast/eslint-plugin`. Re-run the analogous step for whichever pair you are checking.

```bash
npm pack @raycast/api@2.2.1 @raycast/api@2.3.0
mkdir -p v221 v230 && tar xzf raycast-api-2.2.1.tgz -C v221 && tar xzf raycast-api-2.3.0.tgz -C v230
diff -u v221/package/types/index.d.ts v230/package/types/index.d.ts
node -e 'console.log(Object.keys(require("./v230/package/oclif.manifest.json").commands))'
```

---

## 2.4.1 — 2026-09-14 · **nothing new; see 2.4.0**

A pure version bump, **verified at byte level** rather than inferred from file sizes. Only
`dist/commands/version/index.js`, `oclif.manifest.json`, and `package.json` differ from 2.4.0, and
`cmp -l` reports **exactly one differing byte in each** — `0x60` → `0x61`, i.e. ASCII `0` → `1`.
That is the version string and nothing else. `types/index.d.ts` is byte-identical and the oclif
command map compares equal.

> Size equality alone would *not* have established this — a same-length functional edit is possible.
> The one-byte `cmp -l` is what makes "zero functional change" a fact instead of a guess.

**2.3.1 (2026-09-11) was the same shape** against 2.3.0 (same three files, same one-byte deltas). So everything between 2.3.0 and 2.4.1 landed
in **2.4.0**, below.

---

## 2.4.0 — 2026-09-14

Diffed against **2.3.0** (2.3.1 being an empty bump). The installed Raycast app reports `CFBundleShortVersionString` **2.4.1.0**, which matches API
**2.4.1** (the current release), not the 2.4.0 documented here. Across the two pairs observed so far
— 2.3.0/2.3.0.0 and 2.4.1/2.4.1.0 — app and package version numbers have coincided. Two coincidences
are not a stated release policy; do not rely on it beyond picking which app to inspect.

### Every built extension now emits an Agent Plugin manifest

Two new files ship in 2.4.0 — `dist/utils/skills.js` (118 KB) and `dist/utils/agent-plugin.js`.
The second is the more consequential one.

`ray build` now writes a **`plugin.json`** into the build output, produced by
`createAgentPluginManifest()` and declaring:

```
$schema: https://agent-plugins.org/schemas/1.0.0/plugin.schema.json
```

It carries `name` (slug-normalized: lowercase, no `--` or `..`, max 64 chars), `description`,
`author`, `license`, and optional `keywords` / `version` / `homepage` derived from the manifest. The
same code is present in `build`, `bundle`, and `publish`.

**This is automatic and not opt-in.** Any extension built with 2.4.0+ emits an agent-plugin manifest
alongside its compiled output, and `skills/` is copied into the build output next to it. Taken with
the Skills format below, the direction is that a Raycast extension is also consumable as an agent
plugin under a third-party open schema — `agent-plugins.org` is not a Raycast domain.

What the diffs do **not** establish: whether anything currently reads that `plugin.json`, whether
Raycast is adopting the standard beyond emitting it, or who owns the schema. The manifest is
written; the consumer is not visible from the package.

### Extensions can now ship Skills

The headline, and it is a whole new extension capability. `ray lint` / `ray validate` gained a
**"validate extension skills"** step. Both bundles also grew 146 KB and now contain a YAML and a
JSON5 parser. The parsers are what the new `ai.yaml` / `ai.json5` config loading requires, so they
almost certainly arrived together — but co-occurrence in one release is the observation; the causal
link is inference.

**Layout** — hardcoded to a `skills/` directory at the extension root:

```
skills/<skill-name>/SKILL.md
```

**Rules the validator enforces** (all of these abort the build):

| Rule | Failure message |
|---|---|
| `skills/` must be a directory | `skills path "skills" must be a directory` |
| Every child must be a directory | `skills must use the "skills/<skill-name>/SKILL.md" format` |
| Each must contain `SKILL.md` | `skill "<n>" must contain "skills/<n>/SKILL.md"` |
| Must open with YAML frontmatter | `skill file "<p>" must start with YAML frontmatter` |
| `name`: 1–64 chars, lowercase letters/digits/single hyphens | `invalid frontmatter name` |
| Directory name must equal frontmatter `name` | `skill directory "<d>" must match its frontmatter name "<n>"` |
| `description`: 1–1024 chars | `invalid frontmatter description` |
| Every skill on disk must be declared | `skill "<n>" must be declared in package.json ai.skills or an AI configuration file` |
| Every declared skill must exist on disk | `declared skill "<n>" is missing from "skills"` |
| No duplicate declarations | `declares skill "<n>" more than once` |
| Declared skill needs a non-empty `title` | `must have a non-empty string title` |

`.DS_Store` is skipped explicitly. The `description` shown to the model comes from the SKILL.md
frontmatter; `title` and optional `icon` come from the declaration.

This is the same `skills/<name>/SKILL.md` + frontmatter shape Claude Code uses.

### AI configuration can move out of `package.json`

The `ai` block can live in a standalone file instead. Resolution order is **first match wins**:

```
ai.json  →  ai.json5  →  ai.yaml  →  ai.yml
```

The file's contents are the **`ai` object itself**, not a whole manifest — the linter does
`manifest.ai = mergeAiConfig(manifest.ai)`, and the merge is `{...manifest.ai, ...configFile}`.
So it is a **shallow per-key merge into `ai`**, not a wholesale replacement of it: a config
declaring only `skills` leaves every other `ai` key from `package.json` intact.

**`null` means "fall back", not "delete".** Null-valued keys are stripped from the config object
*before* the spread, so the `package.json` value survives. The one exception is `icon: null` on an
individual skill entry, which is deleted from that entry and therefore does leave the skill
icon-less. A parse failure is fatal: `cannot read ai.yaml: <err>`.

### `AI.Model`

**Added:** `OpenAI_GPT-6_Astra` (`openai-gpt-6-astra`), `Anthropic_Claude_Fable_5.1`
(`anthropic-claude-fable-5-1`), `Vercel_DeepSeek_V4.1_Flash` (`gateway-deepseek/deepseek-v4.1-flash`).

**Five OpenAI members moved to deprecated with repointed values** — the same silent-remap pattern as
2.3.0's Groq/Baseten shuffle. Nothing was removed; all five still compile.

| Member | 2.3.0 value | 2.4.0 value |
|---|---|---|
| `OpenAI_GPT-4_Turbo` | `openai-gpt-4-turbo` | `openai-gpt-5.6-terra` |
| `OpenAI_GPT-5.2_Instant` | `openai-gpt-5.2-instant` | `openai-gpt-5.6-sol` |
| `OpenAI_o1` | `openai_o1-o1` | `openai-gpt-5.6-terra` |
| `OpenAI_o1-preview` | `openai_o1-o1` | `openai-gpt-5.6-terra` |
| `OpenAI_GPT4-turbo` | `openai-gpt-4-turbo` | `openai-gpt-5.6-terra` |

### The `ExtensionModel*` type family is gone — but it was never public

`types/index.d.ts` shrank 6.3 KB because the entire `ExtensionModel` / `ExtensionGetModels` /
`ExtensionModelMessage` / `ExtensionModelFullStream` family (21 occurrences) was dropped.

**Not a breaking change, and this was checked rather than assumed.** Every member was `declare type`,
never `export type`. Walking every reference to the family in 2.3.0's `index.d.ts` back to its
enclosing declaration returns `declare` in all 31 cases — **no exported declaration referenced the
family structurally**, so it was unreachable from the public surface, not merely un-importable by
name.

The names suggest an "extension supplies its own AI model" surface, but that is reading intent off
identifiers. Whether it was withdrawn, relocated, or never shipped is **not** established — only
that it left this file in 2.4.0.

### Fleet impact

- **`captureMemorySnapshot`** gained a much fuller doc comment (behavior and signature unchanged) —
  it records heap *statistics*, not a heap dump, and returns nothing.
- **No compile-breaking migration is required.** No component or hook types changed and no enum
  member was removed, so nothing fails to build on upgrade.
- **But the five remapped `AI.Model` members need a decision, not a shrug.** Same as 2.3.0: the code
  still compiles while the model actually invoked changes underneath it. Any extension naming one of
  those five should pick its model deliberately rather than inherit Raycast's substitution.
- **`skills/` is a new option, not an obligation.** What a skill is *for* is not something these
  diffs establish — only the format the validator enforces. If you add one, it needs both an
  `ai.skills` declaration and the directory: either without the other **fails the build**.

---

## 2.3.0 — 2026-09-10

Diffed against **2.2.1** (2026-09-08). No changes to `dist/types/` — the React component and
hook type surface is byte-identical. Everything below is CLI behavior plus the `AI.Model` enum.

### New: `ray bundle`

A new CLI command. `ray bundle` builds the extension in `dist` mode and packages the build output
as a **`.rayext` zip archive**.

```
ray bundle [-o|--output <path>] [-t|--target <app target>]
           [--exit-on-error] [--emoji] [--non-interactive]
```

- Default output: `<cwd>/<extension name>.rayext`.
- Archives the *build output* directory (not the source tree), zip format, contents at the archive
  root (`rootDirectory: false`).
- Writes atomically: builds into a temp dir next to the target, renames the previous file to
  `<name>.rayext.backup`, swaps, and restores the backup if the swap fails. On a failed restore it
  throws an `AggregateError` naming the surviving backup path.
- Errors if the output path is an existing directory.
- Success message: `bundled extension successfully at <path>`.
- It does **not** run `lint`, `validate`, or a `tsc` check first — bundling is not a pre-flight.

#### What a `.rayext` is for

Not documented by Raycast, and not answerable from the npm package alone. The answer is in the
installed app: `/Applications/Raycast.app/Contents/Resources/macos-app_RaycastDesktopApp.bundle/Contents/Resources/backend/index.mjs`
and `.../frontend/main-window-*.js` both handle `.rayext`. The inspected app reports
`CFBundleShortVersionString` **2.3.0.0** against `@raycast/api` 2.3.0. That is one matching pair, not
evidence of a release policy — but it is enough to make the app bundle a checkable artifact for what
a CLI change is *for*, which npm alone cannot answer.

`.rayext` is a **sideload format**: a self-contained, installable extension archive that does not go
through the Store.

- The app's **Import Extension** flow now takes either a directory (today's dev-sources import) or a
  `.rayext` file, via an open dialog with `allowedTypes: ["rayext"]`.
- A bundle import calls `installExtension({ persistLocalSources: false })` — it lands as a **real
  installed extension**, not a local development one. That is the whole difference from importing a
  directory.
- It is treated as untrusted input. The app gates it behind a confirmation reading *"Extension
  bundles can execute code on your computer. Only import this bundle if it comes from a source you
  trust."*, extracts to a temp dir with zip-bomb limits (**50 MB compressed, 250 MB expanded, 2000
  entries**), requires `package.json` at the archive root, and deletes the extraction dir afterwards.

**It does not work in the public app yet.** The internal-build check minified to a constant in the
shipping 2.3.0.0 build:

```js
if (!!1) throw new Error("Extension bundles are only available in internal builds");
```

So `ray bundle` produces a file the public Raycast app will refuse to import. What is established is
differing *availability* — the CLI command is public, the import path is gated — not which was
implemented first. Nothing to act on today; worth watching, because an installable archive is a
distribution path that does not go through a Store PR.

**A `.rayext` is NOT the `ray publish` payload, and carries a much narrower leak surface.**
`ray publish` copies the extension root minus a hardcoded list (that list is **unchanged** in 2.3.0:
`.git`, `.github`, `node_modules`, `raycast-env.d.ts`, `.direnv`, `.raycast-swift-build`, `.swiftpm`,
`compiled_raycast_swift`, `compiled_raycast_rust` — and still no ignore file is read). `ray bundle`
archives the **build output**, which the build assembles explicitly: a generated `package.json`, the
`assets/` directory copied wholesale and recursively, `HELP.md` if present, and the compiled command
bundles. Arbitrary repo files do not reach it. **From 2.4.0 the build output also contains
`plugin.json` (the Agent Plugin manifest) and a copied `skills/` directory**, so a `.rayext` built
with 2.4.0+ carries both.

So the `HANDOFF.md`-class leak does **not** transfer to `.rayext`. What does transfer is `assets/` —
copied verbatim, so anything parked in there ships — plus whatever the bundler inlines into the
compiled output. Narrower than publish, not equal to it.

### `ray develop` — rebuild scheduler and structured build errors

Three related changes, all new files in `dist/utils/`:

- **New `build-start` event.** 2.2.1 emitted only `build-success` / `build-failure`; 2.3.0 emits
  `build-start` first, so the Raycast app can show in-progress state during a rebuild.
- **Coalescing rebuild scheduler** (`development-build-scheduler.js`). File changes arriving while a
  build is in flight now set a dirty flag and re-run once when it finishes, instead of stacking
  concurrent builds. One rebuild always runs after the last change.
- **Structured build diagnostics** (`development-build.js`). A build failure is now an
  `ExtensionBuildError` carrying a diagnostic object serialized as JSON, rather than a bare message
  string:

  ```ts
  { message: string, filePath?: string, lineNumber?: number, columnNumber?: number }
  ```

  Built from the first esbuild error; `filePath` is resolved absolute and `columnNumber` is
  1-based. The error is also no longer rethrown out of the watcher callback, so a failed rebuild
  no longer risks tearing down the dev session.

`ExtensionBuildError` also appears in `build`, `publish`, and `publish-to-store` — same shared
build module, same structured failure.

### `ray lint` / `ray validate` — bundled URI validator bumped

Dependency churn only. No new rules, and the validate schema's **identifier set** is identical — note
that is a weaker statement than "the schema did not change", since constraints or defaults could move
without adding an identifier; I did not compare those. Malformed-URI reporting is more specific: the single `URI malformed` message is
replaced by `URI scheme is malformed.`, `URI host is malformed.`, `URI port is malformed.`, and
`URI contains malformed percent-encoding.`

### `AI.Model` — providers reshuffled

The esbuild target is unchanged (`node22.22.2`).

**Added:**

| Member | Id |
|---|---|
| `Google_Gemini_3.8_Flash` | `google-gemini-3.8-flash` |
| `Google_Gemini_3.7_Flash` | `google-gemini-3.7-flash` |
| `xAI_Grok-4.6` | `xai-grok-4.6` |
| `Vercel_GLM-5.3` | `gateway-zai/glm-5.3` |
| `Vercel_GLM-5.3_Flash` | `gateway-zai/glm-5.3-flash` |
| `Vercel_GLM-5.2` | `gateway-zai/glm-5.2` |
| `Vercel_Kimi_K2.7_Code` | `gateway-moonshotai/kimi-k2.7-code` |
| `Vercel_DeepSeek_V4_Pro` | `gateway-deepseek/deepseek-v4-pro-0813` |
| `Vercel_Inkling_Small` | `gateway-thinkingmachines/inkling-small` |

**Newly deprecated** (still present, so nothing fails to compile):
`Groq_Llama_3.3_70B`, `Groq_Llama_3.1_8B`, `Groq_Qwen3-32B`, `Baseten_Kimi_K2.7_Code`,
`Baseten_GLM-5.2`, `Baseten_DeepSeek_V4_Pro`.

**The part that bites.** Every Baseten member listed below now resolves to a `gateway-*` id, and the
listed Groq Llama/Qwen members now resolve to GPT-OSS ids. (That is what the enum shows. Whether
Baseten is gone as a *provider*, and whether the old ids still route, are separate claims this diff
does not settle.) Raycast kept the enum *members* and repointed their *values* — so code that
still says `AI.Model.Groq_Llama_3.3_70B` now silently runs GPT-OSS-120b on Groq, and
`AI.Model["Baseten_GLM-5.2"]` now silently runs GLM-5.2 through the Vercel gateway. TypeScript
reports only a deprecation, never an error. Silent remappings in 2.3.0:

| Member | 2.2.1 value | 2.3.0 value |
|---|---|---|
| `Groq_Llama_3.3_70B` | `groq-llama-3.3-70b-versatile` | `groq-openai/gpt-oss-120b` |
| `Groq_Llama_3.1_8B` | `groq-llama-3.1-8b-instant` | `groq-openai/gpt-oss-20b` |
| `Groq_Qwen3-32B` | `groq-qwen/qwen3-32b` | `groq-openai/gpt-oss-120b` |
| `Baseten_Kimi_K2.7_Code` | `baseten-moonshotai/Kimi-K2.7-Code` | `gateway-moonshotai/kimi-k2.7-code` |
| `Baseten_GLM-5.2` | `baseten-zai-org/GLM-5.2` | `gateway-zai/glm-5.2` |
| `Baseten_DeepSeek_V4_Pro` | `baseten-deepseek-ai/DeepSeek-V4-Pro` | `gateway-deepseek/deepseek-v4-pro-0813` |
| `Baseten_GLM-5` | `baseten-zai-org/GLM-5` | `gateway-zai/glm-5.2` |
| `xAI_Grok-3_Mini_Beta` | `xai-grok-3-mini` | `xai-grok-4.3` |
| `xAI_Grok_3_Mini` | `xai-grok-3-mini` | `xai-grok-4.3` |
| `Llama2_70B`, `Llama3_70B`, `Llama3.3_70B`, `Llama4_Scout`, `Codellama_70B_instruct`, `Llama3.1_70B`, `Groq_Llama_4_Scout`, `Groq_Qwen3_32B` | `groq-llama-3.3-70b-versatile` / `groq-qwen/qwen3-32b` | `groq-openai/gpt-oss-120b` |
| `Llama3.1_8B` | `groq-llama-3.1-8b-instant` | `groq-openai/gpt-oss-20b` |
| `Baseten_MiniMax_M2.5` | `baseten-deepseek-ai/DeepSeek-V4-Pro` | `gateway-deepseek/deepseek-v4-pro-0813` |

`Groq_GPT-OSS_20b` and `Groq_GPT-OSS_120b` are **not** new — they already existed in 2.2.1.

**Fleet action:** review **every row in the remapping table above**, including the xAI rows — not
just Groq and Baseten. And separate two different consequences, because the table mixes them:

- **Different model.** `Groq_Llama_3.3_70B` → GPT-OSS-120b, `xAI_Grok-3_Mini_Beta` → Grok-4.3. A
  genuinely different model answers the prompt.
- **Same model, different provider/id.** `Baseten_GLM-5.2` → `gateway-zai/glm-5.2`. The underlying
  model looks unchanged; the route does. Latency, availability, and cost may move; output should not.

Anything that hardcodes the model *string* rather than the enum (e.g. `"baseten-zai-org/GLM-5.2"`)
is passing an id that no longer appears in the enum. Whether Raycast still routes it is untested
here — assume not, verify before relying on it.

---

## 2.0.3 — 2026-08-19 (the v2 release)

Diffed against **1.104.25** (2026-08-18), the last 1.x. Raycast published no changelog; this section
verifies a Slack post from Mathieu (Raycast) against the tarballs. **Two of his five items do not
land where the post implies** — noted inline.

### `environment` entry points — and a fleet-wide deprecation

```ts
environment.entryPointType  // "command" | "tool"
environment.entryPointName  // string
environment.entryPointMode  // "no-view" | "view" | "menu-bar"
```

Lets shared code tell whether it is running as a command or as an AI tool.

**The part the post soft-pedals:** `environment.commandName` and `environment.commandMode` are now
`@deprecated` aliases (marked `@deprecated` in `types/index.d.ts`; re-derive with the `npm pack` recipe at the top of this file rather than trusting a line number — the tarball is not checked in). Backward compatible, but every extension
reading `environment.commandName` now carries a deprecation.

### `captureMemorySnapshot(label)`

```ts
export declare function captureMemorySnapshot(label: string): void;
```

New export alongside `captureException`. No-ops unless memory reporting is enabled, so checkpoints
can be left in committed code. Pairs with the app-side *Command Out of Memory* error view and its
*Reload with Memory Reporting* action.

### OAuth Client ID Metadata Documents

`OAuth.RedirectMethod.ClientIdMetadataDocument` plus the hosted document constant:

```ts
const clientIdMetadataDocument = "https://www.raycast.com/.well-known/oauth-client-metadata/raycast.json";
```

A PKCE client created with this redirect method may omit `clientId` in `authorizationRequest` —
typed as `ClientIdMetadataDocumentAuthorizationRequestOptions`. Token scopes now accept `string[]`
as well as a space-separated string. (2.1.0 added a doc-comment clarification only.)

### `help.md` — **not new in v2**

The post presents it as a v2 addition. The build step that picks it up is **already in 1.104.25**,
byte-for-byte the same logic: the build scans the extension root for a file whose lowercase name is
`help.md` and copies it into the build output **renamed to `HELP.md`**. The SDK side is therefore
demonstrably pre-v2. The post's framing is presumably about the *app-side rendering* beside the setup
form — that is the attribution, not something these diffs establish; no before/after app comparison
was made. Two consequences for authoring:

- The match is **case-insensitive on the source name** but the shipped file is always `HELP.md`.
- It must sit at the extension root, next to `package.json`.

### Keyboard — **the item that actually costs us something**

The post says: *"`Keyboard.Shortcut.Common` now provides macOS and Windows bindings. Some common
shortcuts have also changed on macOS to match Raycast 2.0."*

Both halves are understated:

1. **Per-platform shortcut *syntax* is not new.** The `Shortcut` union has carried
   `{ macOS, Windows }` (with a deprecated lowercase `windows`) since at least 1.104.25 — the type
   is byte-identical across 1.104.25 → 2.3.0. That establishes the accepted input shape, not what
   `Common`'s members bound historically: `Common` is typed as plain `Shortcut` values, so its
   bindings live in the app runtime and cannot be recovered from any npm tarball. Whether
   per-platform *values* for `Common` predate v2 is untested.
2. **"Some common shortcuts have also changed" broke the linter.** The app rebound five constants;
   `@raycast/eslint-plugin` 2.2.0 (current) still holds the pre-2.0 values. `prefer-common-shortcut
   --fix` will therefore silently *change behavior* on those five rather than just renaming a
   literal.

Full divergence table, the consequences for `--fix`, and the runtime-extraction command are in
`../../plugins/raycast-extensions/reference/keyboard-conventions.md`,
corrected 2026-09-11.
