#!/usr/bin/env node
// Generates reference/rx.md from rx-version.json plus `rx commands --json` (through the runner,
// scripts/rx.mjs, so RX_DEV / RX_TARBALL apply). One section per command, subcommands nested,
// in a stable order: commands by name, everything inside a command in the order the command
// declares it.
//
//   node scripts/rx-reference.mjs                 write reference/rx.md (prints wrote/unchanged)
//   node scripts/rx-reference.mjs --check         exit 1 when reference/rx.md differs or is missing
//   --out <file>        write/compare another file (tests)
//   --registry <file>   use a saved `rx commands --json` document instead of running rx (tests)
//
// The generated file's first line says it is generated and names the pinned version; nothing in
// it depends on the machine that generated it (no absolute paths, no runtime version).
//
// The registry is loaded by the runner (loadRegistryDocument) and interpreted by
// lib/rx-protocol.mjs; the global flags come from the registry (globalFlags), never from a list here.

import { existsSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { globalFlags } from "./lib/rx-protocol.mjs";
import { PLUGIN_DIR, RunnerError, loadRegistryDocument, readPinnedVersion } from "./rx.mjs";

export const REFERENCE_FILE = join(PLUGIN_DIR, "reference", "rx.md");

/**
 * @typedef {import("./lib/rx-protocol.mjs").CommandEntry} CommandEntry
 * @typedef {import("./lib/rx-protocol.mjs").Registry} Registry
 * @typedef {Record<string, unknown>} Globals the registry's global flags (globalFlags)
 */

/** @param {string} s */
function cell(s) {
  return String(s ?? "").replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

/**
 * The synopsis in rx's own form (the runner form is `node "<plugin>/scripts/rx.mjs"` + this minus `rx`).
 * @param {string[]} path e.g. ["preflight"] or ["greptile", "fetch"]
 * @param {CommandEntry} entry
 * @param {Globals} globals flags every command accepts; not repeated in a synopsis
 */
export function synopsis(path, entry, globals) {
  const parts = ["rx", ...path];
  for (const p of entry.positionals ?? []) parts.push(p.required ? `<${p.name}>` : `[<${p.name}>]`);
  for (const [name, f] of Object.entries(entry.flags ?? {})) {
    if (Object.hasOwn(globals, name)) continue;
    const v = f.type === "boolean" ? name : `${name} ${f.value ?? "<value>"}`;
    const rep = f.repeat ? "..." : "";
    parts.push(f.required ? `${v}${rep}` : `[${v}]${rep}`);
  }
  parts.push("[--json]");
  return parts.join(" ");
}

/**
 * Markdown for one command or subcommand.
 * @param {string[]} path
 * @param {CommandEntry} entry
 * @param {CommandEntry | null} parent for inherited root/network/state
 * @param {number} level heading level
 * @param {Globals} globals
 */
function section(path, entry, parent, level, globals) {
  const h = "#".repeat(level);
  const lines = [`${h} \`${["rx", ...path].join(" ")}\``, ""];
  if (entry.summary) lines.push(entry.summary, "");
  const hasSubs = entry.subcommands && Object.keys(entry.subcommands).length > 0;
  if (!hasSubs) lines.push(`Synopsis: \`${synopsis(path, entry, globals)}\``, "");
  const root = entry.root ?? parent?.root ?? "none";
  const network = entry.network ?? parent?.network ?? "none";
  const state = entry.state ?? parent?.state ?? "none";
  const presetAware = "--preset" in (entry.flags ?? {});
  lines.push(`- Root: ${root}`, `- Network: ${network}`, `- State: ${state}`);
  if (!hasSubs) lines.push(`- Preset: ${presetAware ? "preset-aware; the runner appends `--preset`" : "not accepted"}`);
  lines.push("");
  if (hasSubs) {
    lines.push(`Subcommands: ${Object.keys(/** @type {Record<string, CommandEntry>} */ (entry.subcommands)).map((s) => `\`${s}\``).join(", ")}.`, "");
  }
  const positionals = entry.positionals ?? [];
  if (positionals.length) {
    lines.push("Arguments:", "", "| Argument | Required | Description |", "|---|---|---|");
    for (const p of positionals) lines.push(`| \`<${p.name}>\` | ${p.required ? "yes" : "no"} | ${cell(p.help)} |`);
    lines.push("");
  }
  const flags = Object.entries(entry.flags ?? {}).filter(([n]) => !Object.hasOwn(globals, n));
  if (flags.length) {
    lines.push("Flags:", "", "| Flag | Value | Required | Description |", "|---|---|---|---|");
    for (const [n, f] of flags) lines.push(`| \`${n}\` | ${f.type === "boolean" ? "—" : `\`${cell(f.value ?? "<value>")}\``} | ${f.required ? "yes" : "no"}${f.repeat ? ", repeatable" : ""} | ${cell(f.help)} |`);
    lines.push("");
  }
  const checks = Object.entries(entry.checks ?? {});
  if (checks.length) {
    lines.push("Check ids:", "", "| Id | Description | Levels |", "|---|---|---|");
    for (const [id, c] of checks) {
      const desc = typeof c === "string" ? c : /** @type {{ description?: string }} */ (c)?.description ?? "";
      const levels = typeof c === "object" && c && Array.isArray(/** @type {{ levels?: string[] }} */ (c).levels) ? /** @type {{ levels: string[] }} */ (c).levels.join(", ") : "PASS, FAIL, WARN, N/A, ERROR (default)";
      lines.push(`| \`${id}\` | ${cell(desc)} | ${cell(levels)} |`);
    }
    lines.push("");
  } else if (!hasSubs) {
    lines.push("Check ids: none declared at this level.", "");
  }
  const data = Object.entries(entry.data ?? {});
  if (data.length) {
    lines.push("Data (`--json` → `data`):", "");
    for (const [k, v] of data) lines.push(`- \`${k}\` — ${String(v).replace(/\r?\n/g, " ")}`);
    lines.push("");
  } else if (!hasSubs) {
    lines.push("Data: `{}`.", "");
  }
  if (hasSubs) {
    for (const [name, sub] of Object.entries(/** @type {Record<string, CommandEntry>} */ (entry.subcommands))) {
      lines.push(...section([...path, name], sub, entry, level + 1, globals));
    }
  }
  return lines;
}

/**
 * The whole document.
 * @param {Registry} registry
 * @param {string} pinnedVersion
 */
export function render(registry, pinnedVersion) {
  const commands = [...registry.commands].sort((a, b) => a.name.localeCompare(b.name));
  const globals = globalFlags(registry);
  const lines = [
    `<!-- GENERATED by scripts/rx-reference.mjs from rx-version.json (raycast-harness ${pinnedVersion}) and \`rx commands --json\`. Do not edit by hand: run \`node scripts/rx-reference.mjs\`; \`--check\` reports whether it is current (Phase 6 wires it into CI). -->`,
    "",
    `# \`rx\` command reference — raycast-harness ${pinnedVersion}`,
    "",
    `Pinned version: **${pinnedVersion}** (\`rx-version.json\`). Skills and hooks never call \`rx\` or \`npx raycast-harness\` directly; every call goes through the runner, which runs this exact version and appends the plugin preset to every preset-aware command:`,
    "",
    "```",
    'node "<plugin>/scripts/rx.mjs" <command> [subcommand] [arguments] [--flags] [--json]',
    "```",
    "",
    `Global flags, which every command accepts and which are not repeated per command: ${Object.keys(globals).map((g) => `\`${g}\``).join(", ") || "none"}.`,
    "",
    "`--json` prints one JSON envelope: `command`, `version`, `fingerprint`, `data`, `results[]`, `exit`. Verdicts are `PASS`, `FAIL`, `WARN`, `N/A`, `ERROR`; exit 0 = no FAIL/ERROR, 1 = any FAIL, 2 = any ERROR. Any unknown argument is `ERROR args` (exit 2). The dispatcher's own ids (`args`, `root`, `input`, `tooling`, `github`, `npm`, `git`, `protocol`, `internal`) may appear on any command and are not listed per command. A check id ending in `*` declares a prefix.",
    "",
    `Commands (${commands.length}): ${commands.map((c) => `[\`${c.name}\`](#rx-${c.name})`).join(", ")}.`,
    "",
  ];
  for (const c of commands) lines.push(...section([c.name], c, null, 2, globals));
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}

/**
 * @param {string[]} argv
 * @param {{ env?: NodeJS.ProcessEnv, stdout?: (s: string) => void, stderr?: (s: string) => void }} [io]
 * @returns {Promise<number>}
 */
export async function main(argv, io = {}) {
  const out = io.stdout ?? ((s) => process.stdout.write(s));
  const log = io.stderr ?? ((s) => process.stderr.write(s));
  let check = false;
  let outFile = REFERENCE_FILE;
  /** @type {string | null} */
  let registryFile = null;
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t === "--check") check = true;
    else if (t === "--out" && argv[i + 1]) outFile = resolve(argv[++i]);
    else if (t === "--registry" && argv[i + 1]) registryFile = resolve(argv[++i]);
    else {
      log(`rx-reference: unknown argument ${JSON.stringify(t)}\n`);
      return 2;
    }
  }
  try {
    const pinned = readPinnedVersion();
    const registry = await loadRegistryDocument({ registryFile, env: io.env });
    if (registry.version !== pinned) log(`rx-reference: rx reports version ${registry.version}, the pin is ${pinned}; the file states the pin\n`);
    const text = render(registry, pinned);
    const current = existsSync(outFile) ? readFileSync(outFile, "utf8") : null;
    if (check) {
      if (current === text) {
        out(`rx-reference: ${outFile} is current\n`);
        return 0;
      }
      out(`rx-reference: ${outFile} ${current === null ? "is missing" : "differs from the generated text"}; run node scripts/rx-reference.mjs\n`);
      return 1;
    }
    if (current === text) {
      out(`rx-reference: unchanged ${outFile}\n`);
      return 0;
    }
    writeFileSync(outFile, text);
    out(`rx-reference: wrote ${outFile}\n`);
    return 0;
  } catch (e) {
    if (e instanceof RunnerError) {
      log(`rx-reference: ${e.message}\n`);
      return 2;
    }
    throw e;
  }
}

const invokedDirectly = (() => {
  try {
    return !!process.argv[1] && import.meta.url === pathToFileURL(realpathSync(resolve(process.argv[1]))).href;
  } catch {
    return false;
  }
})();
if (invokedDirectly) {
  main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
