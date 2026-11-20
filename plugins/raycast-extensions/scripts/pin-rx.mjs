#!/usr/bin/env node
// Bump the rx pin: `node scripts/pin-rx.mjs <version>`.
//
// The guard hook runs the pinned rx before every tool call, so a pin npm cannot serve yet drops
// every session into the guard's fallback. This writes rx-version.json and reference/rx.md only
// after the npm registry lists that exact version (`npm view`) and npx, run from an empty
// directory so no locally installed copy can answer instead, prints a registry for it
// (`commands --json`) that reports that version. It renders the reference from that registry,
// then replaces both files; if the second replacement fails, the first is put back. On any
// failure it exits 1 and leaves both files as they were; a version npm has not propagated yet
// fails the same way, so retry later. RX_DEV and RX_TARBALL are not consulted.

import { mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { firstLine, readRegistry } from "./lib/rx-protocol.mjs";
import { REFERENCE_FILE, render } from "./rx-reference.mjs";
import { PACKAGE, VERSION_FILE, capture } from "./rx.mjs";

/**
 * Replace each file with its new text, all or nothing: every new text is written beside its
 * target first, then renamed over it; a failed rename restores the files already replaced.
 * @param {[string, string][]} files [path, text]
 */
function replaceAll(files) {
  const staged = files.map(([path, text]) => ({ path, text, tmp: `${path}.pin-rx-${process.pid}` }));
  /** @type {{ path: string, old: string }[]} */
  const done = [];
  try {
    for (const f of staged) writeFileSync(f.tmp, f.text);
    for (const f of staged) {
      const old = readFileSync(f.path, "utf8");
      renameSync(f.tmp, f.path);
      done.push({ path: f.path, old });
    }
  } catch (e) {
    for (const f of done) writeFileSync(f.path, f.old);
    throw e;
  } finally {
    for (const f of staged) rmSync(f.tmp, { force: true });
  }
}

/**
 * @param {string[]} argv
 * @param {{ env?: NodeJS.ProcessEnv, versionFile?: string, referenceFile?: string, stdout?: (s: string) => void, stderr?: (s: string) => void }} [io]
 * @returns {Promise<number>}
 */
export async function main(argv, io = {}) {
  const out = io.stdout ?? ((s) => process.stdout.write(s));
  const log = io.stderr ?? ((s) => process.stderr.write(s));
  const [version, ...rest] = argv;
  if (!version || rest.length || !/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version)) {
    log("pin-rx: usage: node scripts/pin-rx.mjs <exact semver>\n");
    return 2;
  }
  const spec = `${PACKAGE}@${version}`;
  /** @param {string} why */
  const refuse = (why) => {
    log(`pin-rx: ${why}; the pin is unchanged\n`);
    return 1;
  };
  const empty = mkdtempSync(join(tmpdir(), "pin-rx-"));
  try {
    const view = await capture("npm", ["view", spec, "version", "--json"], { cwd: empty, env: io.env, timeout: 60_000 });
    let listed;
    try {
      listed = JSON.parse(view.stdout);
    } catch {
      listed = null;
    }
    if (view.code !== 0 || listed !== version) return refuse(`the npm registry does not list ${spec} (${firstLine(view.stderr) || view.stdout.trim() || `exit ${view.code}`})`);
    const read = readRegistry(await capture("npx", ["-y", spec, "commands", "--json"], { cwd: empty, env: io.env, timeout: 180_000 }));
    if ("problem" in read) return refuse(`npx cannot run ${spec} (${read.problem})`);
    if (read.registry.version !== version) return refuse(`${spec} reports version ${read.registry.version}`);
    try {
      replaceAll([
        [io.referenceFile ?? REFERENCE_FILE, render(read.registry, version)],
        [io.versionFile ?? VERSION_FILE, JSON.stringify({ version }, null, 2) + "\n"],
      ]);
    } catch (e) {
      return refuse(`writing the files failed (${/** @type {Error} */ (e).message})`);
    }
  } finally {
    rmSync(empty, { recursive: true, force: true });
  }
  out(`pin-rx: pinned ${spec} and regenerated reference/rx.md\n`);
  return 0;
}

const invokedDirectly = (() => {
  try {
    return !!process.argv[1] && import.meta.url === pathToFileURL(realpathSync(resolve(process.argv[1]))).href;
  } catch {
    return false;
  }
})();
if (invokedDirectly) main(process.argv.slice(2)).then((code) => process.exit(code));
