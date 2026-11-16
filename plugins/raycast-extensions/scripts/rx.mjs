#!/usr/bin/env node
// The plugin's ONLY way to run `rx` (@chrismessina/raycast-harness). Skills and hooks call it by its absolute
// plugin path:  node "<plugin>/scripts/rx.mjs" <command> [subcommand] [--flags]
//
// What it does, in order:
//   1. Reads the exact pinned version from ../rx-version.json ({ "version": "x.y.z" }).
//   2. Resolves the executable:
//        RX_DEV=<rx checkout>      node <checkout>/bin/rx.mjs            (Phases 5–8 validation)
//        RX_TARBALL=<rx-*.tgz>     an isolated `npm install` of that tarball under the cross-repo
//                                  cache, run with node (TEST-ONLY override for a candidate
//                                  package before it is published; never set in shipped config;
//                                  the install step reads the npm registry for dependencies).
//                                  npm installs into a private staging directory beside the final
//                                  one; the runner validates it (`rx commands --json` must load),
//                                  writes a completion marker and renames it into place. Only a
//                                  directory with that marker counts as installed: one without it
//                                  is replaced, and a run that loses a race keeps the winner's
//        otherwise                 npx -y @chrismessina/raycast-harness@<pinned version>
//   3. Appends `--preset <absolute path of ../presets/chrismessina.json>` when the command (or
//      subcommand) accepts `--preset`, learned from `rx commands --json`. A `--preset` the caller
//      supplied wins. The registry is cached per pinned version at
//      $XDG_CACHE_HOME/raycast-harness/runner/<version>.json (default ~/.cache/raycast-harness)
//      only in npx mode, where the version is immutable; RX_DEV and RX_TARBALL always ask live.
//   4. Spawns with an argument array (never a shell string), stdin/stdout/stderr inherited, and
//      exits with the child's exit code unchanged.
//
// Runner-level modes:
//   --runner-version
//       Prints the pinned version; rx is not run.
//
// Recording a publication never reaches the network. For `publication`, steps 2 and 3 above are
// replaced: the runner loads no registry, injects no preset and fetches nothing; it runs only an
// rx whose bytes are already on this machine:
//   RX_DEV                    the checkout, as above
//   RX_TARBALL                the byte-keyed install, only if a completed one is already in the cache
//   otherwise                 `npx --offline -y @chrismessina/raycast-harness@<pin>` with npm_config_offline=true,
//                             after an offline `--version` probe shows the pinned package is in
//                             npm's cache; a cache miss fails instead of fetching. npx may lay
//                             out an install from npm's local content cache to run it; that
//                             touches only local disk, never the network
// When none is present, it exits 2 with one sentence: the record was not written, rx is not
// installed locally, run any rx command through the runner first, then retry.
//
// rx's output (the --json envelope, the `rx commands --json` registry) is read only through
// lib/rx-protocol.mjs; this file adds executable selection and the per-version registry cache.
//
// The runner's own failures (bad pin, missing checkout, unresolvable registry) print one line to
// stderr prefixed `rx runner:` and exit 2, matching rx's ERROR exit. Node >= 22.12, ESM, zero
// dependencies, runnable from any cwd.

import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { firstLine, isRegistry, locate, readRegistry } from "./lib/rx-protocol.mjs";

export const PLUGIN_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const VERSION_FILE = join(PLUGIN_DIR, "rx-version.json");
export const PRESET_FILE = join(PLUGIN_DIR, "presets", "chrismessina.json");
export const PACKAGE = "@chrismessina/raycast-harness";
// rx names its XDG cache and config directories without the npm scope (src/state.mjs).
const STATE_DIR = "raycast-harness";
const NODE_FLOOR = [22, 12];

/** Thrown for every runner-level failure; main() prints the message and exits 2. */
export class RunnerError extends Error {}

/**
 * @typedef {{ file: string, args: string[], mode: "dev" | "tarball" | "npx", label: string, installRoot?: string, tarball?: string }} Executable
 *   `file` + `args` is the program prefix rx's own argv is appended to. Tarball mode also carries
 *   `installRoot` (the `npm install --prefix` directory) and `tarball` (absolute path); the
 *   executable is always `<installRoot>/node_modules/@chrismessina/raycast-harness/bin/rx.mjs`.
 * @typedef {import("./lib/rx-protocol.mjs").FlagSpec} FlagSpec
 * @typedef {import("./lib/rx-protocol.mjs").CommandEntry} CommandEntry
 * @typedef {import("./lib/rx-protocol.mjs").Registry} Registry
 */

/**
 * The exact version the plugin pins.
 * @param {string} [file]
 * @returns {string}
 */
export function readPinnedVersion(file = VERSION_FILE) {
  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch (e) {
    throw new RunnerError(`cannot read the version pin ${file}: ${/** @type {Error} */ (e).message}`);
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    throw new RunnerError(`${file} is not valid JSON: ${/** @type {Error} */ (e).message}`);
  }
  const version = parsed?.version;
  if (typeof version !== "string" || !/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version)) {
    throw new RunnerError(`${file} must hold { "version": "<exact semver>" }; got ${JSON.stringify(version)}`);
  }
  return version;
}

/**
 * Where the cross-repo cache lives (the same rule rx uses in src/state.mjs).
 * @param {NodeJS.ProcessEnv} env
 */
export function cacheBase(env) {
  const xdg = env.XDG_CACHE_HOME;
  return xdg && xdg.trim() ? join(xdg, STATE_DIR) : join(homedir(), ".cache", STATE_DIR);
}

/**
 * Pick the executable for this run. Pure apart from existence checks; the tarball install itself
 * happens in installTarball(), so tests can prepare an installed tree and never touch npm.
 * @param {{ version: string, env: NodeJS.ProcessEnv, cwd?: string }} opts
 * @returns {Executable}
 */
export function resolveExecutable({ version, env, cwd = process.cwd() }) {
  const dev = env.RX_DEV?.trim();
  if (dev) {
    const bin = join(resolve(cwd, dev), "bin", "rx.mjs");
    if (!existsSync(bin)) throw new RunnerError(`RX_DEV=${dev} is not an rx checkout: ${bin} does not exist`);
    return { file: process.execPath, args: [bin], mode: "dev", label: `RX_DEV checkout ${resolve(cwd, dev)}` };
  }
  const tarball = env.RX_TARBALL?.trim();
  if (tarball) {
    const abs = resolve(cwd, tarball);
    if (!existsSync(abs)) throw new RunnerError(`RX_TARBALL=${tarball} does not exist`);
    const installRoot = tarballInstallDir(abs, env);
    return { file: process.execPath, args: [tarballExecutable(installRoot)], mode: "tarball", label: `RX_TARBALL ${abs}`, installRoot, tarball: abs };
  }
  return { file: "npx", args: ["-y", `${PACKAGE}@${version}`], mode: "npx", label: `npx ${PACKAGE}@${version}` };
}

/**
 * The isolated install directory for a tarball: keyed by the tarball's bytes, so a rebuilt
 * candidate never reuses a stale install.
 * @param {string} tarballPath absolute
 * @param {NodeJS.ProcessEnv} env
 */
export function tarballInstallDir(tarballPath, env) {
  const hash = createHash("sha256").update(readFileSync(tarballPath)).digest("hex").slice(0, 16);
  return join(cacheBase(env), "runner", "tarball", hash);
}

/**
 * Where `npm install --prefix <installRoot> <tarball>` puts the package's executable.
 * @param {string} installRoot
 */
export function tarballExecutable(installRoot) {
  return join(installRoot, "node_modules", PACKAGE, "bin", "rx.mjs");
}

/** The file a tarball install directory holds once it is complete; written last, before promotion. */
export const TARBALL_MARKER = ".rx-runner-complete";

/**
 * Is this tarball install directory a completed install? The marker is the evidence; the
 * executable alone is what an interrupted install leaves behind.
 * @param {string} installRoot
 */
export function tarballInstalled(installRoot) {
  return existsSync(join(installRoot, TARBALL_MARKER)) && existsSync(tarballExecutable(installRoot));
}

/**
 * Install RX_TARBALL into its isolated directory unless a completed install is there. npm runs in
 * a private staging directory beside the final one; the install is validated (its
 * `rx commands --json` must load and pass readRegistry), marked complete, then renamed into place.
 * A final directory without the marker is replaced. If another run promotes a completed install
 * first, this run discards its own and uses that one. Every failure removes the staging directory
 * and leaves no final directory. Network: npm reads the registry for the package's dependencies.
 * Test-only path.
 * @param {Executable} exe
 * @param {NodeJS.ProcessEnv} env
 * @param {(s: string) => void} log
 * @param {typeof capture} [run] test seam standing in for running npm; defaults to the real thing
 */
export async function installTarball(exe, env, log, run = capture) {
  if (exe.mode !== "tarball") return;
  const { installRoot, tarball } = exe;
  if (!installRoot || !tarball) throw new RunnerError("tarball executable lacks its install root; this is a runner bug");
  if (tarballInstalled(installRoot)) return;
  mkdirSync(dirname(installRoot), { recursive: true });
  const staging = mkdtempSync(`${installRoot}.staging-`);
  log(`rx runner: installing ${tarball} into ${installRoot}\n`);
  try {
    const r = await run("npm", ["install", "--prefix", staging, "--no-save", "--no-audit", "--no-fund", "--no-package-lock", "--loglevel", "error", tarball], { env });
    const bin = tarballExecutable(staging);
    if (r.code !== 0 || !existsSync(bin)) {
      throw new RunnerError(`npm install of RX_TARBALL failed (exit ${r.code}): ${firstLine(r.stderr) || firstLine(r.stdout) || `${bin} missing after install`}`);
    }
    const check = readRegistry(await capture(exe.file, [bin, "commands", "--json"], { cwd: staging, env }));
    if ("problem" in check) throw new RunnerError(`the RX_TARBALL install did not validate, so it was discarded: ${check.problem}`);
    writeFileSync(join(staging, TARBALL_MARKER), `${JSON.stringify({ tarball, version: check.registry.version })}\n`);
    promote(staging, installRoot);
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}

/**
 * Rename a completed staging directory into place. A final directory that is already complete is
 * another run's install, which wins. One that is not complete is removed, once, and the rename
 * retried.
 * @param {string} staging @param {string} installRoot
 */
function promote(staging, installRoot) {
  for (let attempt = 0; ; attempt++) {
    try {
      renameSync(staging, installRoot);
      return;
    } catch (e) {
      if (tarballInstalled(installRoot)) return;
      if (attempt > 0 || !existsSync(installRoot)) throw new RunnerError(`cannot move the RX_TARBALL install into ${installRoot}: ${/** @type {Error} */ (e).message}`);
      rmSync(installRoot, { recursive: true, force: true });
    }
  }
}

/**
 * Run a program and capture its output. Argument array, no shell.
 * @param {string} file @param {string[]} args
 * @param {{ cwd?: string, env?: NodeJS.ProcessEnv, input?: string }} [opts]
 * @returns {Promise<{ code: number, stdout: string, stderr: string }>}
 */
export function capture(file, args, opts = {}) {
  return new Promise((done) => {
    const child = execFile(file, args, { cwd: opts.cwd, env: opts.env ?? process.env, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }, (err, stdout, stderr) => {
      const e = /** @type {(Error & { code?: unknown }) | null} */ (err);
      let code = 0;
      if (e) code = typeof e.code === "number" ? e.code : e.code === "ENOENT" ? 127 : 1;
      done({ code, stdout: String(stdout ?? ""), stderr: String(stderr ?? "") });
    });
    if (opts.input !== undefined) child.stdin?.end(opts.input);
  });
}

/**
 * Run rx (resolved per the environment) and capture its output: for generators and checks that
 * read `rx commands --json`. Preset injection applies as in main().
 * @param {string[]} argv rx's arguments
 * @param {{ env?: NodeJS.ProcessEnv, cwd?: string, log?: (s: string) => void, inject?: boolean }} [opts]
 */
export async function captureRx(argv, opts = {}) {
  const env = opts.env ?? process.env;
  const log = opts.log ?? ((s) => process.stderr.write(s));
  const version = readPinnedVersion();
  const exe = resolveExecutable({ version, env, cwd: opts.cwd });
  await installTarball(exe, env, log);
  let args = argv;
  if (opts.inject !== false) {
    const registry = await loadRegistry({ exe, version, env, log });
    args = injectPreset(argv, registry, PRESET_FILE);
  }
  return capture(exe.file, [...exe.args, ...args], { cwd: opts.cwd, env });
}

/**
 * `rx commands --json`'s data, from the per-version cache in npx mode or live otherwise.
 * @param {{ exe: Executable, version: string, env: NodeJS.ProcessEnv, log: (s: string) => void, fetch?: () => Promise<{ code: number, stdout: string, stderr: string }> }} opts
 *   `fetch` is a test seam standing in for running `rx commands --json`.
 * @returns {Promise<Registry>}
 */
export async function loadRegistry({ exe, version, env, log, fetch }) {
  const cacheFile = exe.mode === "npx" ? join(cacheBase(env), "runner", `${version}.json`) : null;
  if (cacheFile && existsSync(cacheFile)) {
    try {
      const cached = JSON.parse(readFileSync(cacheFile, "utf8"));
      if (isRegistry(cached) && cached.version === version) return cached;
      log(`rx runner: ignoring unusable registry cache ${cacheFile}\n`);
    } catch {
      log(`rx runner: ignoring unreadable registry cache ${cacheFile}\n`);
    }
  }
  const r = await (fetch ?? (() => capture(exe.file, [...exe.args, "commands", "--json"], { env })))();
  const read = readRegistry(r);
  if ("problem" in read) throw new RunnerError(`\`rx commands --json\` via ${exe.label} is unusable, so the runner cannot learn which commands accept --preset: ${read.problem}`);
  const { registry } = read;
  if (cacheFile) {
    if (registry.version !== version) {
      log(`rx runner: ${exe.label} reports version ${registry.version}, not the pinned ${version}; not caching\n`);
    } else {
      mkdirSync(dirname(cacheFile), { recursive: true });
      const tmp = `${cacheFile}.${process.pid}.tmp`;
      writeFileSync(tmp, JSON.stringify(registry));
      renameSync(tmp, cacheFile);
    }
  }
  return registry;
}

/**
 * The registry from a saved `rx commands --json` document (tests) or from rx itself, run live
 * through this runner (RX_DEV, RX_TARBALL or the pinned npx package; never the cache), held to
 * readRegistry's rule. A saved document is judged as if rx had exited 0. Anything else is a
 * RunnerError.
 * @param {{ registryFile?: string | null, env?: NodeJS.ProcessEnv }} [opts]
 * @returns {Promise<Registry>}
 */
export async function loadRegistryDocument(opts = {}) {
  const r = opts.registryFile ? { code: 0, stdout: readFileSync(opts.registryFile, "utf8"), stderr: "" } : await captureRx(["commands", "--json"], { env: opts.env, inject: false });
  const read = readRegistry(r);
  if ("problem" in read) throw new RunnerError(read.problem);
  return read.registry;
}

/**
 * Append `--preset <file>` when the addressed (sub)command accepts it and the caller did not pass
 * one. Everything else is returned unchanged, including unknown commands (rx reports those).
 * @param {string[]} argv
 * @param {Registry} registry
 * @param {string} presetFile absolute
 * @returns {string[]}
 */
export function injectPreset(argv, registry, presetFile) {
  if (argv.some((t) => t === "--preset" || t.startsWith("--preset="))) return argv;
  const { command, subcommand } = locate(argv, registry);
  if (!command) return argv;
  const flags = command.subcommands && Object.keys(command.subcommands).length ? (subcommand?.flags ?? {}) : (command.flags ?? {});
  if (!("--preset" in flags)) return argv;
  return [...argv, "--preset", presetFile];
}

/**
 * Does this rx argv run `rx publication`? That command is network-free
 * in rx's own contract, so the runner keeps it offline too (see the header).
 * @param {string[]} args
 */
export function isPublicationCall(args) {
  return args[0] === "publication";
}

/** The runner's one sentence when recording finds no local rx. */
export const NOT_INSTALLED =
  "the publication record was not written because rx is not installed locally; run any rx command through the runner first, then retry.";

/**
 * The executable for recording a publication, from what is already on this machine. Never
 * installs, never loads the registry, never reaches the network. Null when no local rx exists.
 * @param {{ version: string, env: NodeJS.ProcessEnv, cwd?: string, run?: typeof capture }} opts
 *   `run` is a test seam standing in for running the offline npx probe.
 * @returns {Promise<{ exe: Executable, env: NodeJS.ProcessEnv } | null>}
 */
export async function resolveLocalExecutable({ version, env, cwd = process.cwd(), run = capture }) {
  const exe = resolveExecutable({ version, env, cwd });
  if (exe.mode === "dev") return { exe, env };
  if (exe.mode === "tarball") return exe.installRoot && tarballInstalled(exe.installRoot) ? { exe, env } : null;
  const offlineEnv = { ...env, npm_config_offline: "true" };
  const offline = { ...exe, args: ["--offline", ...exe.args], label: `${exe.label} (offline)` };
  const probe = await run(offline.file, [...offline.args, "--version"], { cwd, env: offlineEnv });
  if (probe.code !== 0 || probe.stdout.trim() !== version) return null;
  return { exe: offline, env: offlineEnv };
}

/** @param {string} v e.g. "v22.12.0" */
export function nodeMeetsFloor(v) {
  const [maj, min] = v.replace(/^v/, "").split(".").map(Number);
  return maj > NODE_FLOOR[0] || (maj === NODE_FLOOR[0] && min >= NODE_FLOOR[1]);
}

/**
 * The CLI entry point. Returns the exit code; never calls process.exit itself.
 * @param {string[]} argv tokens after the script path
 * @param {{ env?: NodeJS.ProcessEnv, cwd?: string, stdout?: (s: string) => void, stderr?: (s: string) => void }} [io]
 * @returns {Promise<number>}
 */
export async function main(argv, io = {}) {
  const env = io.env ?? process.env;
  const cwd = io.cwd ?? process.cwd();
  const out = io.stdout ?? ((s) => process.stdout.write(s));
  const log = io.stderr ?? ((s) => process.stderr.write(s));
  try {
    if (!nodeMeetsFloor(process.version)) throw new RunnerError(`Node ${NODE_FLOOR.join(".")} or newer is required; this is ${process.version}`);
    if (argv[0] === "--runner-version") {
      out(`${readPinnedVersion()}\n`);
      return 0;
    }
    const version = readPinnedVersion();
    let args = argv;
    if (isPublicationCall(args)) {
      const local = await resolveLocalExecutable({ version, env, cwd });
      if (!local) throw new RunnerError(NOT_INSTALLED);
      return await passthrough(local.exe.file, [...local.exe.args, ...args], { cwd, env: local.env, log });
    }
    const exe = resolveExecutable({ version, env, cwd });
    await installTarball(exe, env, log);
    const wantsRx = args.length > 0 && !args[0].startsWith("--");
    if (wantsRx) {
      if (!existsSync(PRESET_FILE)) throw new RunnerError(`the plugin preset ${PRESET_FILE} is missing`);
      const registry = await loadRegistry({ exe, version, env, log });
      args = injectPreset(args, registry, PRESET_FILE);
    }
    return await passthrough(exe.file, [...exe.args, ...args], { cwd, env, log });
  } catch (e) {
    if (e instanceof RunnerError) {
      log(`rx runner: ${e.message}\n`);
      return 2;
    }
    throw e;
  }
}

/**
 * Spawn with inherited stdio and resolve with the child's exit code.
 * @param {string} file @param {string[]} args
 * @param {{ cwd: string, env: NodeJS.ProcessEnv, log: (s: string) => void }} opts
 * @returns {Promise<number>}
 */
function passthrough(file, args, { cwd, env, log }) {
  return new Promise((done) => {
    const child = spawn(file, args, { cwd, env, stdio: "inherit" });
    child.on("error", (e) => {
      log(`rx runner: cannot start ${file}: ${e.message}\n`);
      done(2);
    });
    child.on("exit", (code, signal) => {
      if (code === null) {
        log(`rx runner: rx was terminated by ${signal}\n`);
        done(2);
      } else done(code);
    });
  });
}

const invokedDirectly = (() => {
  if (!process.argv[1]) return false;
  try {
    return import.meta.url === pathToFileURL(realpathSync(resolve(process.argv[1]))).href;
  } catch {
    return false;
  }
})();
if (invokedDirectly) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (e) => {
      process.stderr.write(`rx runner: ${e?.stack ?? e}\n`);
      process.exitCode = 2;
    },
  );
}
