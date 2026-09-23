---
title: "Raycast's installed-extension list lives in ~/.config, not Application Support"
date: 2026-09-23
category: design-patterns
module: extension-storage
component: installed-extension-detection
problem_type: design_pattern
severity: high
applies_when:
  - "An extension needs the set of extensions the user has installed"
  - "A list is filtered or scoped to extensions the user has"
  - "A Raycast directory is derived by walking up from environment.assetsPath or environment.supportPath"
  - "A folder under ~/Library/Application Support/com.raycast.macos/extensions looks like it enumerates installs"
root_cause: wrong_api
tags: [raycast, installed-extensions, supportpath, application-support, fail-open, store-updates]
---

# Raycast's installed-extension list lives in ~/.config, not Application Support

## Context

Raycast offers no API for "which extensions are installed". `raycast-store-updates` needs that
set for its **My Updates** filter and its menu bar's My Updates scope. The first three sources
tried each looked right and were wrong, and each was wrong in a different way:

1. **Reading `<folder>/package.json` under `~/Library/Application Support/com.raycast.macos/extensions/`.**
   This returned an empty set for every user. Store installs there live in UUID-named folders
   with no `package.json` at any depth. Measured 2026-09-23: 167 folders, and zero `package.json`
   files in any UUID folder. The filter matched nothing, which looks exactly like "you have no
   updates".
2. **Listing that folder's names instead, found by walking two parents up from
   `environment.assetsPath`.** UUIDs were turned into slugs through the Store search API. Under
   `ray develop`, `assetsPath` can be the project's own `assets/` folder, so two parents up
   landed on the folder containing the checkout. Per the earlier session that shipped the guard,
   it read 68 sibling repos as installed extensions. The guard added for that was
   `if (environment.isDevelopment) return null`, and it switched the filter off entirely while
   developing. The list then showed every update, which read as false positives.
3. **Taking that same folder from `dirname(environment.supportPath)`.** This is the right folder
   in both modes, but **it is not a registry.** Raycast creates an extension's folder there the
   first time the extension *runs*, because the folder holds its `supportPath` and `Cache` store.
   An extension that is installed but has never been opened has no folder, so its updates were
   filtered out without a sign. This was confirmed 2026-09-22: Ollama's UUID folder appeared only
   after the user launched it, and Hide My Email, installed and never opened, still had no
   folder there on 2026-09-23.

Two other sources were ruled out as unreadable. Stock `sqlite3` rejects Raycast's own
`node_extensions.db` with `file is not a database`; it appears to be encrypted, and a `last_key`
file sits beside it, but the scheme is not documented. A Settings export (`.rayconfig`) has a
small plaintext JSON header that declares `encryption` with an IV and salt, and its payload
cannot be read without the export password.

## Guidance

**Read `~/.config/<config-dir>/extensions/<entry>/package.json` and take its `name`.** That
folder holds every installed extension's built manifest, and `name` *is* the slug. That holds
for Store installs, whose folders are UUID-named, and for `ray develop` builds, whose folders
are slug-named, so nothing has to be resolved over the network. The approach comes from the
published `installed-extensions` extension, which builds the same path in
[`raycast-config.ts`](https://github.com/raycast/extensions/blob/main/extensions/installed-extensions/src/helpers/raycast-config.ts) (line 74:
`return path.join(os.homedir(), ".config", configDirName, "extensions");`).

**Derive `<config-dir>` from the bundle id in `environment.supportPath`.** The code takes the
first path segment that begins with `com.raycast`; in the expected layout that segment sits just
after `Application Support` (macOS) or `Roaming` (Windows). It maps by one rule:
`com.<product>.<platform>[.<variant>]` becomes `<product>[-<variant>]`. So `com.raycast.macos`
becomes `raycast`, and `com.raycast-x.macos.internal` becomes `raycast-x-internal`. Run against
each of the twelve entries in `installed-extensions`' `BUNDLE_ID_TO_CONFIG_DIR` table (same file,
linked above) on 2026-09-22, the rule reproduced all twelve.

**Return "could not tell" (`null`), never a partial set, whenever the read cannot be trusted.**
A filter that fails closed is indistinguishable from "no updates".
- The bundle id is unrecognized, or the folder is missing or unreadable.
- A `package.json` **exists** but cannot be read or parsed, or has no `name`.
- The result does not contain the running extension (`environment.extensionName`). An extension
  is necessarily installed while it runs, so its absence means the wrong folder was read. This
  one check catches a moved folder or an unanticipated platform path without having to predict
  either, and it makes an empty set impossible.

**But skip an entry with no `package.json` at all (`ENOENT`, or `ENOTDIR` for a stray file).**
The folder always contains Raycast's shared `node_modules`, and it can hold manifest-less
leftovers; on the development machine that was `raycast-fly`, holding only `assets/`. A reviewer
proposed "any unreadable entry → `null`", and checking the disk showed that rule would switch
the feature off permanently for that user. Missing means "not an extension". Present-but-broken
means "can't tell".

The shipped form, from
[`raycast-store-updates/src/utils/index.ts`](https://github.com/chrismessina/raycast-store-updates/blob/main/src/utils/index.ts#L941)
(`installedExtensionsDir` at line 941, `fetchInstalledExtensionSlugs` at 972), abridged:

```ts
function installedExtensionsDir(): string | null {
  const bundleId = environment.supportPath.split(/[\\/]/).find((segment) => segment.startsWith("com.raycast"));
  const match = bundleId?.match(/^com\.([^.]+)\.(?:macos|windows)(?:\.(.+))?$/);
  if (!match) return null;
  const configDir = match[2] ? `${match[1]}-${match[2]}` : match[1];
  return join(homedir(), ".config", configDir, "extensions");
}

export async function fetchInstalledExtensionSlugs(): Promise<Set<string> | null> {
  const dir = installedExtensionsDir();
  if (!dir) return null;
  let entries: string[];
  try { entries = await readdir(dir); } catch { return null; }

  let names: (string | undefined)[];
  try {
    names = await Promise.all(entries.map(async (entry) => {
      let manifest: string;
      try {
        manifest = await readFile(join(dir, entry, "package.json"), "utf8");
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code === "ENOENT" || code === "ENOTDIR") return undefined; // not an extension
        throw error;                                                   // can't tell
      }
      const { name } = JSON.parse(manifest) as { name?: unknown };
      if (typeof name !== "string" || !name) throw new Error(`${entry}/package.json has no name`);
      return name;
    }));
  } catch {
    return null;
  }

  const slugs = new Set(names.filter((name): name is string => name !== undefined));
  return slugs.has(environment.extensionName) ? slugs : null; // :1012
}
```

`environment.supportPath` is still the right answer for its own job: a per-extension place to
store files, as [`portable-node-advisory-file-lock`](portable-node-advisory-file-lock.md) uses it. The
mistake is reading its *parent's listing* as a list of installs.

## Why This Matters

Every wrong source fails silently, and each failure looks like correct behavior: an empty set
reads as "no updates", a folder of sibling repos reads as false positives, and a
never-opened extension simply goes missing. `tsc`, `ray lint` and `ray build` cannot see any of
it. The third source passed several review rounds, and one reviewer named its exact failure
(Codex, 2026-09-11: *"Missing support directories produce false negatives if an installed
extension has not received one"*). It was declined as unverifiable, and eleven days later a user
found it in the running app (session history). The check that would have settled it takes a
minute: find one extension that is installed but has never been opened, and see whether the
source lists it.

## When to Apply

- Any feature that filters, badges, or scopes by "extensions I have installed".
- Any code that walks up from `environment.assetsPath` or `environment.supportPath` to reach
  another Raycast directory. `assetsPath` can point into the project checkout under
  `ray develop`.
- Reviewing a claim that some directory "lists installed extensions". Test it against a
  never-opened install before accepting it.

## Examples

Checking whether a candidate source is a real registry, using an extension that is installed
but has never been opened (here Hide My Email, Store id `3a5c2af8-d440-418e-8df0-cc7fa9f2c732`,
slug `hidemyemail`):

```bash
A=~/Library/Application\ Support/com.raycast.macos/extensions
C=~/.config/raycast/extensions
[ -d "$A/3a5c2af8-d440-418e-8df0-cc7fa9f2c732" ] && echo "app-support: present" || echo "app-support: ABSENT"
grep -l '"name": *"hidemyemail"' "$C"/*/package.json >/dev/null && echo "config: present" || echo "config: absent"
```

On 2026-09-23 this printed `app-support: ABSENT` and `config: present`. The same machine had
336 manifests naming 313 distinct extensions under `~/.config/raycast/extensions`, and none at
all under Application Support.

Before and after, as the My Updates filter saw it: the `supportPath`-based listing omitted
Hide My Email and Ollama from a list the user expected them in. The `~/.config` read returned
`Set(313)`, including both. That was verified by running the compiled function against the real
disk with `@raycast/api` stubbed, together with the four `null` cases (wrong folder, beta bundle
with no folder, unrecognized bundle id, a path that isn't Raycast's).

**Not verified:** the Windows path, and whether uninstalling an extension removes its folder
from `~/.config`. Both rest on `installed-extensions` shipping the same assumption.

## Related

- Store PR `raycast/extensions#31447` shipped this change for `raycast-store-updates`, merged
  2026-09-23, along with the extension's `AGENTS.md`, which documents the same rules.
- [`portable-node-advisory-file-lock`](portable-node-advisory-file-lock.md): the other learning about
  Raycast's per-extension on-disk state.
- [`CONCEPTS.md`](../../../../CONCEPTS.md) → *Development renderer replay*: the same kind of trap, where the host runtime's
  behavior can't be seen from the extension's own tree.
