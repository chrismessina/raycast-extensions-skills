// Run: node --test plugins/raycast-extensions/scripts/rx.test.mjs (RX_DEV / RX_TARBALL optional)
// Every test always runs; the end-to-end tests use whatever the runner resolves (RX_DEV, RX_TARBALL
// or the pinned npx package). Every end-to-end test points XDG_CACHE_HOME at a temp dir so nothing touches the real
// ~/.cache/raycast-harness.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  PRESET_FILE,
  guardStake,
  RunnerError,
  VERSION_FILE,
  cacheBase,
  injectPreset,
  installTarball,
  loadRegistry,
  inRxCheckout,
  npxPrefix,
  prepareExecutable,
  nodeMeetsFloor,
  readPinnedVersion,
  resolveExecutable,
  resolveLocalExecutable,
  tarballExecutable,
  tarballInstallDir,
} from "./rx.mjs";
import { locate } from "./lib/rx-protocol.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const RUNNER = join(HERE, "rx.mjs");
const RX_DEV = process.env.RX_DEV?.trim() || null;
// Never skipped: without RX_DEV or RX_TARBALL the runner's npx mode runs the pinned version, so CI and
// pre-push exercise exactly what ships. Until that version is published, these fail with E404 by design.
const E2E = null;

/** @param {(dir: string) => Promise<void> | void} fn */
async function withTempDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), "rx-runner-"));
  try {
    await fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Run the runner as a child process.
 * @param {string[]} argv @param {{ cwd?: string, env?: NodeJS.ProcessEnv, input?: string }} [opts]
 * @returns {Promise<{ code: number, stdout: string, stderr: string }>}
 */
function runner(argv, opts = {}) {
  return new Promise((done) => {
    const child = execFile(process.execPath, [RUNNER, ...argv], { cwd: opts.cwd, env: opts.env ?? process.env, encoding: "utf8" }, (err, stdout, stderr) => {
      const e = /** @type {(Error & { code?: unknown }) | null} */ (err);
      done({ code: e ? (typeof e.code === "number" ? e.code : 1) : 0, stdout: String(stdout), stderr: String(stderr) });
    });
    if (opts.input !== undefined) child.stdin?.end(opts.input);
  });
}

/** An env for end-to-end runs: the real env plus an isolated cache. @param {string} cache */
function e2eEnv(cache) {
  return { ...process.env, XDG_CACHE_HOME: cache };
}

/** A minimal registry in the shape of `rx commands --json`'s data.commands. */
const REGISTRY = /** @type {import("./rx.mjs").Registry} */ ({
  version: "0.1.0",
  commands: [
    { name: "commands", flags: { "--json": { type: "boolean", help: "" }, "--help": { type: "boolean", help: "" } }, subcommands: {} },
    { name: "doctor", flags: { "--root": { type: "string", help: "" }, "--json": { type: "boolean", help: "" }, "--help": { type: "boolean", help: "" } }, subcommands: {} },
    { name: "preflight", flags: { "--root": { type: "string", help: "" }, "--published": { type: "string", help: "" }, "--preset": { type: "string", help: "" }, "--json": { type: "boolean", help: "" }, "--help": { type: "boolean", help: "" } }, subcommands: {} },
    {
      name: "holdout",
      flags: { "--json": { type: "boolean", help: "" }, "--help": { type: "boolean", help: "" } },
      subcommands: {
        out: { name: "out", flags: { "--root": { type: "string", help: "" }, "--preset": { type: "string", help: "" } } },
        in: { name: "in", flags: { "--root": { type: "string", help: "" } } },
      },
    },
  ],
});

/** What a fake installed rx prints for `commands --json`: a document the runner's install validation accepts. */
const REGISTRY_DOC = { exit: 0, version: "0.1.0", data: { commands: REGISTRY.commands }, results: [{ id: "commands", verdict: "PASS", message: "4 commands" }] };

/**
 * Source for a fake installed rx: prints `stdout` verbatim for `commands`, then runs `extra`.
 * @param {string} [stdout] @param {string} [extra]
 */
function fakeRxSource(stdout = JSON.stringify(REGISTRY_DOC), extra = "") {
  return `const argv = process.argv.slice(2);\nif (argv[0] === "commands") process.stdout.write(${JSON.stringify(stdout)});\n${extra}\n`;
}

/**
 * A stand-in for npm: records each call and lays down `source` as the executable under --prefix,
 * where npm would put it. `during` runs after that, while the install is still unpromoted.
 * @param {{ file: string, args: string[] }[]} calls @param {string} [source] @param {(prefix: string) => Promise<void>} [during]
 * @returns {typeof import("./rx.mjs").capture}
 */
function fakeNpm(calls, source = fakeRxSource(), during) {
  return async (file, args) => {
    calls.push({ file, args });
    const prefix = args[args.indexOf("--prefix") + 1];
    mkdirSync(dirname(tarballExecutable(prefix)), { recursive: true });
    writeFileSync(tarballExecutable(prefix), source);
    if (during) await during(prefix);
    return { code: 0, stdout: "", stderr: "" };
  };
}

/** Everything in an install root's parent besides the install root itself (staging leftovers). @param {string} installRoot */
const besideInstall = (installRoot) => (existsSync(dirname(installRoot)) ? readdirSync(dirname(installRoot)).filter((n) => n !== basename(installRoot)) : []);

test("readPinnedVersion reads an exact semver from rx-version.json and rejects anything else", async () => {
  assert.match(readPinnedVersion(VERSION_FILE), /^\d+\.\d+\.\d+$/);
  await withTempDir((dir) => {
    const f = join(dir, "rx-version.json");
    writeFileSync(f, JSON.stringify({ version: "^0.1.0" }));
    assert.throws(() => readPinnedVersion(f), RunnerError);
    writeFileSync(f, "{not json");
    assert.throws(() => readPinnedVersion(f), RunnerError);
    writeFileSync(f, JSON.stringify({ version: "1.2.3-rc.1" }));
    assert.equal(readPinnedVersion(f), "1.2.3-rc.1");
    assert.throws(() => readPinnedVersion(join(dir, "missing.json")), /cannot read the version pin/);
  });
});

test("nodeMeetsFloor: 22.12 is the floor", () => {
  assert.equal(nodeMeetsFloor("v22.12.0"), true);
  assert.equal(nodeMeetsFloor("v23.0.0"), true);
  assert.equal(nodeMeetsFloor("v22.11.9"), false);
  assert.equal(nodeMeetsFloor("v20.19.0"), false);
});

test("resolveExecutable: RX_DEV runs the checkout's bin/rx.mjs with node; a non-checkout is an error", async () => {
  await withTempDir((dir) => {
    mkdirSync(join(dir, "bin"));
    writeFileSync(join(dir, "bin", "rx.mjs"), "");
    const exe = resolveExecutable({ version: "0.1.0", env: { RX_DEV: dir } });
    assert.deepEqual({ file: exe.file, args: exe.args, mode: exe.mode }, { file: process.execPath, args: [join(dir, "bin", "rx.mjs")], mode: "dev" });
    assert.throws(() => resolveExecutable({ version: "0.1.0", env: { RX_DEV: join(dir, "nope") } }), /is not an rx checkout/);
  });
});

test("resolveExecutable: without overrides it is `npx -y @chrismessina/raycast-harness@<pinned>`; RX_DEV wins over RX_TARBALL", async () => {
  const exe = resolveExecutable({ version: "0.1.0", env: {} });
  assert.deepEqual({ file: exe.file, args: exe.args, mode: exe.mode }, { file: "npx", args: ["-y", "@chrismessina/raycast-harness@0.1.0"], mode: "npx" });
  const blank = resolveExecutable({ version: "0.1.0", env: { RX_DEV: "  ", RX_TARBALL: "" } });
  assert.equal(blank.mode, "npx");
  await withTempDir((dir) => {
    mkdirSync(join(dir, "bin"));
    writeFileSync(join(dir, "bin", "rx.mjs"), "");
    writeFileSync(join(dir, "x.tgz"), "tarball bytes");
    assert.equal(resolveExecutable({ version: "0.1.0", env: { RX_DEV: dir, RX_TARBALL: join(dir, "x.tgz") } }).mode, "dev");
  });
});

test("installTarball: first-time install runs `npm install --prefix <installRoot> <tarball>` and expects <installRoot>/node_modules/@chrismessina/raycast-harness/bin/rx.mjs", async () => {
  await withTempDir(async (dir) => {
    const tgz = join(dir, "raycast-harness-0.1.0.tgz");
    writeFileSync(tgz, "candidate package bytes");
    const env = { RX_TARBALL: tgz, XDG_CACHE_HOME: join(dir, "cache") };
    const exe = resolveExecutable({ version: "0.1.0", env });
    const installRoot = tarballInstallDir(tgz, env);
    assert.equal(exe.installRoot, installRoot);
    assert.equal(exe.tarball, tgz);
    assert.equal(exe.args[0], tarballExecutable(installRoot));
    assert.equal(exe.args[0], join(installRoot, "node_modules", "@chrismessina", "raycast-harness", "bin", "rx.mjs"));
    /** @type {{ file: string, args: string[] }[]} */
    const invocations = [];
    const npm = fakeNpm(invocations);
    /** @type {string[]} */
    const logs = [];
    await installTarball(exe, env, (s) => logs.push(s), npm);
    assert.equal(invocations.length, 1);
    assert.equal(invocations[0].file, "npm");
    // npm installs into a private staging directory beside the install root, which is then renamed into place.
    const prefix = invocations[0].args[invocations[0].args.indexOf("--prefix") + 1];
    assert.equal(dirname(prefix), dirname(installRoot), "--prefix is a staging directory beside the install root");
    assert.ok(basename(prefix).startsWith(`${basename(installRoot)}.`) && prefix !== installRoot, `--prefix is a staging directory, not the install root: ${prefix}`);
    assert.ok(!prefix.endsWith("node_modules"), "--prefix is the install root, not node_modules");
    assert.equal(invocations[0].args.at(-1), tgz);
    assert.ok(existsSync(exe.args[0]), "the executable exists where the runner will look");
    assert.deepEqual(besideInstall(installRoot), [], "the staging directory was renamed into place, not left behind");
    assert.deepEqual(logs, [`rx runner: installing ${tgz} into ${installRoot}\n`]);
    // Second call: installed → no npm.
    await installTarball(exe, env, () => {}, npm);
    assert.equal(invocations.length, 1);
    // npm exiting 0 without producing the executable is still a failure (never a silent wrong-place install).
    const other = join(dir, "other.tgz");
    writeFileSync(other, "different bytes");
    const exe2 = resolveExecutable({ version: "0.1.0", env: { ...env, RX_TARBALL: other } });
    await assert.rejects(installTarball(exe2, { ...env, RX_TARBALL: other }, () => {}, async () => ({ code: 0, stdout: "", stderr: "" })), /missing after install/);
    await assert.rejects(installTarball(exe2, { ...env, RX_TARBALL: other }, () => {}, async () => ({ code: 1, stdout: "", stderr: "E404 nope" })), /failed \(exit 1\): E404 nope/);
  });
});

test("installTarball: a final directory with the executable but no completion marker is incomplete: it is replaced by a fresh install", async () => {
  await withTempDir(async (dir) => {
    const tgz = join(dir, "raycast-harness-0.1.0.tgz");
    writeFileSync(tgz, "candidate package bytes");
    const env = { RX_TARBALL: tgz, XDG_CACHE_HOME: join(dir, "cache") };
    const exe = resolveExecutable({ version: "0.1.0", env });
    const installRoot = /** @type {string} */ (exe.installRoot);
    // What an interrupted install (or the pre-marker runner) leaves: the executable, nothing else finished.
    mkdirSync(dirname(exe.args[0]), { recursive: true });
    writeFileSync(exe.args[0], "");
    writeFileSync(join(installRoot, "half-written"), "");
    /** @type {{ file: string, args: string[] }[]} */
    const calls = [];
    /** @type {string[]} */
    const logs = [];
    await installTarball(exe, env, (s) => logs.push(s), fakeNpm(calls));
    assert.equal(calls.length, 1, "npm ran: the bare executable was not taken as an install");
    assert.deepEqual(logs, [`rx runner: installing ${tgz} into ${installRoot}\n`]);
    assert.ok(!existsSync(join(installRoot, "half-written")), "the incomplete directory was removed");
    assert.equal(readFileSync(exe.args[0], "utf8"), fakeRxSource(), "the executable is the fresh install's");
    assert.deepEqual(besideInstall(installRoot), []);
    // Now complete: reused without npm.
    await installTarball(exe, env, () => {}, fakeNpm(calls));
    assert.equal(calls.length, 1);
  });
});

test("installTarball: a completed install is reused without reinstalling, and is what recording a publication runs", async () => {
  await withTempDir(async (dir) => {
    const tgz = join(dir, "raycast-harness-0.1.0.tgz");
    writeFileSync(tgz, "candidate package bytes");
    const env = { RX_TARBALL: tgz, XDG_CACHE_HOME: join(dir, "cache") };
    const exe = resolveExecutable({ version: "0.1.0", env });
    /** @type {{ file: string, args: string[] }[]} */
    const calls = [];
    await installTarball(exe, env, () => {}, fakeNpm(calls));
    /** @type {string[]} */
    const logs = [];
    const refuse = /** @type {typeof import("./rx.mjs").capture} */ (async () => assert.fail("npm must not run for a completed install"));
    await installTarball(exe, env, (s) => logs.push(s), refuse);
    await installTarball(resolveExecutable({ version: "0.1.0", env }), env, (s) => logs.push(s), refuse);
    assert.equal(calls.length, 1);
    assert.deepEqual(logs, []);
    assert.equal((await resolveLocalExecutable({ version: "0.1.0", env }))?.exe.args[0], exe.args[0]);
  });
});

test("installTarball: an install that fails validation is discarded and leaves no final directory behind", async () => {
  await withTempDir(async (dir) => {
    const tgz = join(dir, "raycast-harness-0.1.0.tgz");
    writeFileSync(tgz, "candidate package bytes");
    const env = { RX_TARBALL: tgz, XDG_CACHE_HOME: join(dir, "cache") };
    const exe = resolveExecutable({ version: "0.1.0", env });
    const installRoot = /** @type {string} */ (exe.installRoot);
    // npm exits 0 and the executable is there, but rx cannot load (a dependency never landed).
    const broken = fakeRxSource("", "process.stderr.write(\"Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'pngjs'\\n\"); process.exit(1);");
    await assert.rejects(installTarball(exe, env, () => {}, fakeNpm([], broken)), (e) => e instanceof RunnerError && /did not validate/.test(e.message) && /pngjs/.test(e.message));
    assert.ok(!existsSync(installRoot), "no final directory");
    assert.deepEqual(besideInstall(installRoot), [], "no staging directory either");
    // A registry that is JSON but not a successful `commands` run is a failed validation too.
    await assert.rejects(installTarball(exe, env, () => {}, fakeNpm([], fakeRxSource(JSON.stringify({ ...REGISTRY_DOC, results: [] })))), /did not validate/);
    assert.ok(!existsSync(installRoot));
    // npm failing or not producing the executable leaves nothing behind either.
    await assert.rejects(installTarball(exe, env, () => {}, async () => ({ code: 1, stdout: "", stderr: "E404 nope" })), /failed \(exit 1\): E404 nope/);
    await assert.rejects(installTarball(exe, env, () => {}, async () => ({ code: 0, stdout: "", stderr: "" })), /missing after install/);
    assert.ok(!existsSync(installRoot));
    assert.deepEqual(besideInstall(installRoot), []);
  });
});

test("installTarball: when two installs race, the loser discards its staging directory and uses the winner's completed install", async () => {
  await withTempDir(async (dir) => {
    const tgz = join(dir, "raycast-harness-0.1.0.tgz");
    writeFileSync(tgz, "candidate package bytes");
    const env = { RX_TARBALL: tgz, XDG_CACHE_HOME: join(dir, "cache") };
    const exe = resolveExecutable({ version: "0.1.0", env });
    const installRoot = /** @type {string} */ (exe.installRoot);
    const winner = fakeRxSource(undefined, "// the winner's install");
    // While this run's npm is still going, another run installs the same tarball to completion.
    const during = async () => installTarball(resolveExecutable({ version: "0.1.0", env }), env, () => {}, fakeNpm([], winner));
    await installTarball(exe, env, () => {}, fakeNpm([], fakeRxSource(undefined, "// the loser's install"), during));
    assert.equal(readFileSync(exe.args[0], "utf8"), winner, "the winner's install is kept");
    assert.deepEqual(besideInstall(installRoot), [], "the loser's staging directory is gone");
    await installTarball(exe, env, () => {}, async () => assert.fail("reused, not reinstalled"));
  });
});

test("resolveExecutable: RX_TARBALL resolves to an isolated install keyed by the tarball's bytes under the cache; an installed tree is reused without npm", async () => {
  await withTempDir(async (dir) => {
    const tgz = join(dir, "raycast-harness-0.1.0.tgz");
    writeFileSync(tgz, "candidate package bytes");
    const env = { RX_TARBALL: tgz, XDG_CACHE_HOME: join(dir, "cache") };
    const installDir = tarballInstallDir(tgz, env);
    assert.ok(installDir.startsWith(join(dir, "cache", "raycast-harness", "runner", "tarball")), installDir);
    const exe = resolveExecutable({ version: "0.1.0", env });
    assert.equal(exe.mode, "tarball");
    assert.equal(exe.file, process.execPath);
    assert.equal(exe.args[0], join(installDir, "node_modules", "@chrismessina", "raycast-harness", "bin", "rx.mjs"));
    // A different tarball → a different directory.
    writeFileSync(tgz, "rebuilt candidate");
    assert.notEqual(tarballInstallDir(tgz, env), installDir);
    // Pre-installed (a completed install) → installTarball does nothing (no npm, no log line).
    await installTarball(resolveExecutable({ version: "0.1.0", env }), env, () => {}, fakeNpm([]));
    /** @type {string[]} */
    const logs = [];
    await installTarball(resolveExecutable({ version: "0.1.0", env }), env, (s) => logs.push(s));
    assert.deepEqual(logs, []);
    assert.throws(() => resolveExecutable({ version: "0.1.0", env: { RX_TARBALL: join(dir, "missing.tgz") } }), /does not exist/);
  });
});

test("cacheBase follows XDG_CACHE_HOME, else ~/.cache/raycast-harness", () => {
  assert.equal(cacheBase({ XDG_CACHE_HOME: "/x/cache" }), "/x/cache/raycast-harness");
  assert.match(cacheBase({}), /\/\.cache\/raycast-harness$/);
});

test("locate mirrors rx's subcommand rule: the first token that is not a flag or a valued flag's value", () => {
  assert.equal(locate(["holdout", "--root", "out", "in"], REGISTRY).subcommandToken, "in");
  assert.equal(locate(["holdout", "--root=x", "out"], REGISTRY).subcommandToken, "out");
  assert.equal(locate(["holdout", "--json", "out"], REGISTRY).subcommand?.name, "out");
  assert.equal(locate(["holdout", "--json"], REGISTRY).subcommandToken, null);
  assert.equal(locate(["doctor", "whatever"], REGISTRY).subcommand, null);
  assert.equal(locate(["--help"], REGISTRY).command, null);
  assert.equal(locate(["nope"], REGISTRY).command, null);
});

test("injectPreset appends --preset <plugin preset> only to commands that accept it, and never twice", () => {
  const P = "/plugin/presets/chrismessina.json";
  assert.deepEqual(injectPreset(["preflight", "--root", "."], REGISTRY, P), ["preflight", "--root", ".", "--preset", P]);
  assert.deepEqual(injectPreset(["preflight", "--json"], REGISTRY, P), ["preflight", "--json", "--preset", P]);
  assert.deepEqual(injectPreset(["holdout", "out", "--root", "."], REGISTRY, P), ["holdout", "out", "--root", ".", "--preset", P]);
  assert.deepEqual(injectPreset(["holdout", "--root", ".", "out"], REGISTRY, P), ["holdout", "--root", ".", "out", "--preset", P]);
  // No --preset on these.
  assert.deepEqual(injectPreset(["doctor", "--json"], REGISTRY, P), ["doctor", "--json"]);
  assert.deepEqual(injectPreset(["holdout", "in", "--root", "."], REGISTRY, P), ["holdout", "in", "--root", "."]);
  assert.deepEqual(injectPreset(["holdout"], REGISTRY, P), ["holdout"]);
  assert.deepEqual(injectPreset(["commands", "--json"], REGISTRY, P), ["commands", "--json"]);
  assert.deepEqual(injectPreset(["bogus", "--x"], REGISTRY, P), ["bogus", "--x"]);
  assert.deepEqual(injectPreset(["--help"], REGISTRY, P), ["--help"]);
  assert.deepEqual(injectPreset([], REGISTRY, P), []);
  // A caller's --preset wins, in either spelling.
  assert.deepEqual(injectPreset(["preflight", "--preset", "mine.json"], REGISTRY, P), ["preflight", "--preset", "mine.json"]);
  assert.deepEqual(injectPreset(["preflight", "--preset=mine.json"], REGISTRY, P), ["preflight", "--preset=mine.json"]);
});

test("loadRegistry caches per pinned version in npx mode only; dev mode asks live every time; a bad cache is refetched", async () => {
  await withTempDir(async (dir) => {
    const env = { XDG_CACHE_HOME: dir };
    const doc = { exit: 0, version: "0.1.0", data: { commands: REGISTRY.commands }, results: [{ id: "commands", verdict: "PASS", message: "4 commands" }] };
    let fetches = 0;
    const fetch = async () => {
      fetches++;
      return { code: 0, stdout: JSON.stringify(doc), stderr: "" };
    };
    const npx = resolveExecutable({ version: "0.1.0", env: {} });
    const log = () => {};
    const a = await loadRegistry({ exe: npx, version: "0.1.0", env, log, fetch });
    assert.equal(a.commands.length, 4);
    const cacheFile = join(dir, "raycast-harness", "runner", "0.1.0.json");
    assert.ok(existsSync(cacheFile), "cache written in npx mode");
    await loadRegistry({ exe: npx, version: "0.1.0", env, log, fetch });
    assert.equal(fetches, 1, "second npx load served from cache");
    // Corrupt cache → refetch and rewrite.
    writeFileSync(cacheFile, "{garbage");
    await loadRegistry({ exe: npx, version: "0.1.0", env, log, fetch });
    assert.equal(fetches, 2);
    assert.equal(JSON.parse(readFileSync(cacheFile, "utf8")).version, "0.1.0");
    // Dev mode: never cached, always fetched.
    mkdirSync(join(dir, "dev", "bin"), { recursive: true });
    writeFileSync(join(dir, "dev", "bin", "rx.mjs"), "");
    const dev = resolveExecutable({ version: "0.1.0", env: { RX_DEV: join(dir, "dev") } });
    rmSync(cacheFile);
    await loadRegistry({ exe: dev, version: "0.1.0", env, log, fetch });
    await loadRegistry({ exe: dev, version: "0.1.0", env, log, fetch });
    assert.equal(fetches, 4);
    assert.ok(!existsSync(cacheFile), "dev mode writes no cache");
    // A version mismatch is not cached (the pin and the executable disagree).
    const other = { ...doc, version: "0.2.0" };
    await loadRegistry({ exe: npx, version: "0.1.0", env, log, fetch: async () => ({ code: 0, stdout: JSON.stringify(other), stderr: "" }) });
    assert.ok(!existsSync(cacheFile), "mismatched version not cached");
    // Not JSON / not exit 0 → RunnerError.
    await assert.rejects(loadRegistry({ exe: dev, version: "0.1.0", env, log, fetch: async () => ({ code: 2, stdout: "ERROR args", stderr: "" }) }), /is unusable.*not JSON/);
    await assert.rejects(loadRegistry({ exe: dev, version: "0.1.0", env, log, fetch: async () => ({ code: 2, stdout: JSON.stringify({ ...doc, exit: 2 }), stderr: "" }) }), /is unusable.*verdicts imply 0/);
  });
});

test("loadRegistry holds the runner to the same registry rule as the reference generator: no `commands` PASS, no registry", async () => {
  await withTempDir(async (dir) => {
    const env = { XDG_CACHE_HOME: dir };
    const npx = resolveExecutable({ version: "0.1.0", env: {} });
    // Exit 0 and a commands array, but no positive evidence: before the shared client the runner
    // accepted this (and cached it) while rx-reference rejected it.
    const silent = { exit: 0, version: "0.1.0", data: { commands: REGISTRY.commands }, results: [] };
    await assert.rejects(
      loadRegistry({ exe: npx, version: "0.1.0", env, log: () => {}, fetch: async () => ({ code: 0, stdout: JSON.stringify(silent), stderr: "" }) }),
      /exactly one `commands` result with verdict PASS/,
    );
    assert.ok(!existsSync(join(dir, "raycast-harness", "runner", "0.1.0.json")), "a rejected registry is never cached");
    // The process exit must agree with the envelope too.
    const ok = { ...silent, results: [{ id: "commands", verdict: "PASS", message: "" }] };
    await assert.rejects(loadRegistry({ exe: npx, version: "0.1.0", env, log: () => {}, fetch: async () => ({ code: 1, stdout: JSON.stringify(ok), stderr: "" }) }), /exited 1 but its envelope says exit 0/);
  });
});

// ---- recording a publication stays offline (fake executables; nothing real is installed) ------

const NOT_INSTALLED_LINE =
  "rx runner: the publication record was not written because rx is not installed locally; run any rx command through the runner first, then retry.\n";

/**
 * Write an executable Node script that appends one JSON line per run to $FAKE_LOG.
 * @param {string} file @param {string} body extra statements; `argv` and `log` are in scope
 */
function fakeProgram(file, body = "") {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(
    file,
    `#!${process.execPath}\nconst { appendFileSync } = process.getBuiltinModule("node:fs");\nconst argv = process.argv.slice(2);\nconst log = (o) => appendFileSync(process.env.FAKE_LOG, JSON.stringify(o) + "\\n");\nlog({ prog: ${JSON.stringify(file.split("/").pop())}, argv, cwd: process.cwd(), offline: process.env.npm_config_offline ?? null });\n${body}\n`,
  );
  chmodSync(file, 0o755);
}

/** @param {string} file @returns {{ prog: string, argv: string[], offline: string | null }[]} */
const readLog = (file) => (existsSync(file) ? readFileSync(file, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);

/**
 * A scratch world: a git repository to record from, a fake `npm` and `npx` first on PATH, an
 * isolated cache, and an env with no RX_DEV or RX_TARBALL unless a test adds one.
 * @param {string} dir
 */
async function offlineWorld(dir) {
  const bin = join(dir, "bin");
  const log = join(dir, "calls.log");
  fakeProgram(join(bin, "npm"), "process.stderr.write('fake npm must never run\\n'); process.exit(1);");
  fakeProgram(
    join(bin, "npx"),
    `const cached = process.env.FAKE_NPX_CACHED === "1";
if (!cached) { process.stderr.write("npm error code ENOTCACHED\\n"); process.exit(1); }
if (argv.includes("--version")) process.stdout.write(${JSON.stringify(readPinnedVersion())} + "\\n");`,
  );
  const repo = join(dir, "repo");
  mkdirSync(repo);
  assert.equal((await runGit(["init", "-q"], repo)).code, 0);
  const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, XDG_CACHE_HOME: join(dir, "cache"), FAKE_LOG: log };
  delete env.RX_DEV;
  delete env.RX_TARBALL;
  return { log, repo, env, record: join(repo, ".git", "rx", "publication.json") };
}

const SHA40 = "c".repeat(40);

test("recording a publication through RX_DEV runs rx once with exactly the record argv: no registry call, no preset", async () => {
  await withTempDir(async (dir) => {
    const w = await offlineWorld(dir);
    const checkout = join(dir, "rx-checkout");
    fakeProgram(join(checkout, "bin", "rx.mjs"));
    const env = { ...w.env, RX_DEV: checkout };
    const argv = ["publication", "record", "raycast/extensions", "31000", SHA40];
    const r = await runner(argv, { cwd: w.repo, env });
    assert.equal(r.code, 0, r.stderr);
    assert.deepEqual(readLog(w.log).map((c) => c.argv), [argv]);
    // Control: the same fake sees the registry call any other command makes first.
    rmSync(w.log, { force: true });
    await runner(["doctor"], { cwd: w.repo, env });
    assert.deepEqual(readLog(w.log)[0]?.argv, ["commands", "--json"]);
  });
});

test("recording a publication through RX_TARBALL uses only an install already in the cache; a cold cache exits 2 with one sentence, installs nothing and runs nothing", async () => {
  await withTempDir(async (dir) => {
    const w = await offlineWorld(dir);
    const warm = join(dir, "warm.tgz");
    writeFileSync(warm, "warm tarball bytes");
    const warmEnv = { ...w.env, RX_TARBALL: warm };
    // A completed install, laid down the way the runner does it (its validation runs `commands --json`).
    const layDown = /** @type {typeof import("./rx.mjs").capture} */ (async (_file, args) => {
      fakeProgram(tarballExecutable(args[args.indexOf("--prefix") + 1]), `if (argv[0] === "commands") process.stdout.write(${JSON.stringify(JSON.stringify(REGISTRY_DOC))});`);
      return { code: 0, stdout: "", stderr: "" };
    });
    await installTarball(resolveExecutable({ version: readPinnedVersion(), env: warmEnv }), warmEnv, () => {}, layDown);
    rmSync(w.log, { force: true });
    // The executable without the completion marker (an interrupted install) is not installed.
    const half = join(dir, "half.tgz");
    writeFileSync(half, "half-installed tarball bytes");
    fakeProgram(tarballExecutable(tarballInstallDir(half, w.env)));
    const incomplete = await runner(["publication", "record", "raycast/extensions", "31000", SHA40], { cwd: w.repo, env: { ...w.env, RX_TARBALL: half } });
    assert.equal(incomplete.code, 2);
    assert.equal(incomplete.stderr, NOT_INSTALLED_LINE);
    assert.deepEqual(readLog(w.log), [], "an incomplete install is never run");
    const ok = await runner(["publication", "record", "raycast/extensions", "31000", SHA40], { cwd: w.repo, env: { ...w.env, RX_TARBALL: warm } });
    assert.equal(ok.code, 0, ok.stderr);
    assert.deepEqual(readLog(w.log).map((c) => [c.prog, c.argv]), [["rx.mjs", ["publication", "record", "raycast/extensions", "31000", SHA40]]], "no npm, no registry call");
    rmSync(w.log, { force: true });
    const cold = join(dir, "cold.tgz");
    writeFileSync(cold, "cold tarball bytes");
    const miss = await runner(["publication", "record", "raycast/extensions", "31000", SHA40], { cwd: w.repo, env: { ...w.env, RX_TARBALL: cold } });
    assert.equal(miss.code, 2);
    assert.equal(miss.stdout, "");
    assert.equal(miss.stderr, NOT_INSTALLED_LINE);
    assert.deepEqual(readLog(w.log), [], "npm was never run, nor any rx");
    assert.ok(!existsSync(tarballInstallDir(cold, w.env)), "no install directory was created");
    assert.ok(!existsSync(w.record), "no record was written");
  });
});

test("recording a publication in pinned npx mode runs npx offline only; a cache miss exits 2 with one sentence and never fetches", async () => {
  await withTempDir(async (dir) => {
    const w = await offlineWorld(dir);
    const pkg = `@chrismessina/raycast-harness@${readPinnedVersion()}`;
    const hit = await runner(["publication", "record", "raycast/extensions", "31000", SHA40], { cwd: w.repo, env: { ...w.env, FAKE_NPX_CACHED: "1" } });
    assert.equal(hit.code, 0, hit.stderr);
    const calls = readLog(w.log);
    assert.deepEqual(calls.map((c) => [c.prog, c.argv]), [
      ["npx", ["--offline", "-y", pkg, "--version"]],
      ["npx", ["--offline", "-y", pkg, "publication", "record", "raycast/extensions", "31000", SHA40]],
    ]);
    assert.ok(calls.every((c) => realpathSync(c.cwd) === realpathSync(w.repo)), "npx still runs rx in the caller's directory");
    assert.ok(calls.every((c) => c.offline === "true"), "npm_config_offline=true on every npx run");
    rmSync(w.log, { force: true });
    const miss = await runner(["publication", "record", "raycast/extensions", "31000", SHA40], { cwd: w.repo, env: w.env });
    assert.equal(miss.code, 2);
    assert.equal(miss.stdout, "");
    assert.equal(miss.stderr, NOT_INSTALLED_LINE);
    assert.deepEqual(readLog(w.log).map((c) => [c.prog, c.argv, c.offline]), [["npx", ["--offline", "-y", pkg, "--version"], "true"]], "only the offline probe ran");
    assert.ok(!existsSync(w.record), "no record was written");
  });
});

/** @param {string[]} args @param {string} cwd */
function runGit(args, cwd) {
  return new Promise((done) => {
    execFile("git", args, { cwd, encoding: "utf8" }, (err, stdout, stderr) => done({ code: err ? 1 : 0, stdout: String(stdout), stderr: String(stderr) }));
  });
}

// ---- end-to-end, through the real runner process -------------------------------------------

test("e2e: `commands --json` passes through RX_DEV untouched (no --preset for a command without it) and prints exactly one envelope", { skip: E2E ?? false }, async () => {
  await withTempDir(async (cache) => {
    const r = await runner(["commands", "--json"], { cwd: cache, env: e2eEnv(cache) });
    assert.equal(r.code, 0, r.stderr + r.stdout);
    const doc = JSON.parse(r.stdout); // one document, or this throws
    assert.equal(doc.command, "commands");
    assert.equal(doc.exit, 0);
    assert.ok(doc.data.commands.some((/** @type {{ name: string }} */ c) => c.name === "preflight"));
    if (RX_DEV) assert.ok(!existsSync(join(cache, "raycast-harness", "runner")), "no registry cache in RX_DEV mode");
  });
});

test("e2e: the runner appends the plugin preset to `preflight`", { skip: E2E ?? false }, async () => {
  await withTempDir(async (cache) => {
    const root = join(cache, "ext");
    fakeExtension(root);
    const r = await runner(["preflight", "--root", root, "--json"], { cwd: cache, env: e2eEnv(cache) });
    const doc = JSON.parse(r.stdout);
    assert.equal(doc.command, "preflight");
    assert.equal(doc.data.preset, PRESET_FILE, "data.preset is the plugin's absolute preset path");
    assert.equal(r.code, doc.exit, "exit code passes through unchanged");
  });
});

test("e2e: a caller's --preset wins over the plugin preset", { skip: E2E ?? false }, async () => {
  await withTempDir(async (cache) => {
    const root = join(cache, "ext");
    fakeExtension(root);
    const mine = join(cache, "mine.json");
    writeFileSync(mine, readFileSync(PRESET_FILE));
    const r = await runner(["preflight", "--root", root, "--json", "--preset", mine], { cwd: cache, env: e2eEnv(cache) });
    const doc = JSON.parse(r.stdout);
    assert.equal(doc.data.preset, mine);
  });
});

test("e2e: exit codes pass through: 1 for a FAIL, 2 for an ERROR", { skip: E2E ?? false }, async () => {
  await withTempDir(async (cache) => {
    const root = join(cache, "ext");
    fakeExtension(root);
    rmSync(join(root, "CHANGELOG.md")); // changelog-exists FAILs
    const fail = await runner(["preflight", "--root", root, "--json"], { cwd: cache, env: e2eEnv(cache) });
    assert.equal(fail.code, 1, fail.stdout);
    assert.equal(JSON.parse(fail.stdout).exit, 1);
    const error = await runner(["preflight", "--root", join(cache, "nowhere")], { cwd: cache, env: e2eEnv(cache) });
    assert.equal(error.code, 2);
    assert.match(error.stdout, /^ERROR\s+root\b/m);
  });
});

test("e2e: an unknown command is rx's ERROR args, exit 2, not the runner's", { skip: E2E ?? false }, async () => {
  await withTempDir(async (cache) => {
    const r = await runner(["bogus", "--x"], { cwd: cache, env: e2eEnv(cache) });
    assert.equal(r.code, 2);
    assert.match(r.stdout, /^ERROR\s+args\s+unknown command "bogus"/m);
    // RX_TARBALL mode first installs into this test's fresh cache and says so on stderr; nothing else is the runner's.
    assert.equal(r.stderr.replace(/^rx runner: installing .*\n/, ""), "", "the runner adds nothing of its own");
  });
});

test("e2e: verdict lines (no --json) pass through on stdout", { skip: E2E ?? false }, async () => {
  await withTempDir(async (cache) => {
    const r = await runner(["commands"], { cwd: cache, env: e2eEnv(cache) });
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stdout, /^PASS\s+commands\s+\d+ commands:/m);
  });
});

test("e2e: runner-level failures exit 2 with an `rx runner:` line on stderr and nothing on stdout", async () => {
  await withTempDir(async (cache) => {
    const r = await runner(["doctor"], { cwd: cache, env: { ...process.env, XDG_CACHE_HOME: cache, RX_DEV: join(cache, "not-a-checkout") } });
    assert.equal(r.code, 2);
    assert.equal(r.stdout, "");
    assert.match(r.stderr, /^rx runner: RX_DEV=.* is not an rx checkout/);
  });
});

test("e2e: `rx publication record` writes the record; bad operands are rx's ERROR args", { skip: E2E ?? false }, async () => {
  await withTempDir(async (dir) => {
    const repo = join(dir, "ext");
    fakeExtension(repo);
    assert.equal((await runGit(["init", "-q"], repo)).code, 0);
    const env = { ...process.env, XDG_CACHE_HOME: dir };
    const sha = "b".repeat(40);
    // Recording runs only an rx already on this machine (it never installs or fetches), so the
    // ship flow's earlier rx calls are what put it there; one ordinary call stands in for them.
    const prime = await runner(["commands", "--json"], { cwd: repo, env });
    assert.equal(prime.code, 0, prime.stderr + prime.stdout);
    const ok = await runner(["publication", "record", "raycast/extensions", "31001", sha, "--json"], { cwd: join(repo, "src"), env });
    assert.equal(ok.code, 0, ok.stderr + ok.stdout);
    const doc = JSON.parse(ok.stdout);
    assert.equal(doc.command, "publication", "rx ran the command; the runner wrote nothing itself");
    assert.deepEqual(doc.results.map((/** @type {{ verdict: string, id: string }} */ r) => `${r.verdict} ${r.id}`), ["PASS publication-record"]);
    const file = join(repo, ".git", "rx", "publication.json");
    const rec = JSON.parse(readFileSync(file, "utf8"));
    assert.deepEqual(Object.keys(rec), ["repo", "pr", "remoteSha", "at"]);
    assert.equal(rec.pr, 31001);
    assert.equal(rec.remoteSha, sha);
    assert.match(rec.at, /^\d{4}-\d{2}-\d{2}T/);
    // A second record replaces the first.
    const direct = await runner(["publication", "record", "raycast/extensions", "31002", sha], { cwd: repo, env });
    assert.equal(direct.code, 0, direct.stderr + direct.stdout);
    assert.equal(JSON.parse(readFileSync(file, "utf8")).pr, 31002);
    const kept = readFileSync(file, "utf8");
    const bad = await runner(["publication", "record", "raycast/extensions", "31001", "deadbeef"], { cwd: repo, env });
    assert.equal(bad.code, 2);
    assert.match(bad.stdout, /^ERROR\s+args\s+.*40-hex/m);
    assert.equal(bad.stderr.replace(/^rx runner: installing .*\n/, ""), "", "the error is rx's, not the runner's");
    assert.equal(readFileSync(file, "utf8"), kept, "a rejected record leaves the previous one in place");
  });
});

test("e2e: the plugin preset holds out AGENTS.md, CONCEPTS.md, CLAUDE.md and HANDOFF.md before a publish and restores them after (the 2026-11-03 ruling)", { skip: E2E ?? false }, async () => {
  await withTempDir(async (cache) => {
    const root = join(cache, "ext");
    fakeExtension(root);
    const git = (/** @type {string[]} */ args) => execFileSync("git", args, { cwd: root, encoding: "utf8" });
    git(["init", "-q", "-b", "main"]);
    git(["config", "user.email", "test@example.com"]);
    git(["config", "user.name", "Test"]);
    git(["config", "commit.gpgsign", "false"]);
    git(["add", "-A"]);
    git(["commit", "-q", "-m", "init"]);
    const RULED = ["AGENTS.md", "CONCEPTS.md", "CLAUDE.md", "HANDOFF.md"];
    for (const f of RULED) writeFileSync(join(root, f), `# ${f}\n\nMirror-only notes.\n`);

    const out = await runner(["holdout", "out", "--root", root, "--json"], { cwd: cache, env: e2eEnv(cache) });
    assert.equal(out.code, 0, out.stderr + out.stdout);
    const moved = JSON.parse(out.stdout).data.moved.map((/** @type {{ source: string }} */ e) => e.source).sort();
    assert.deepEqual(moved, [...RULED].sort(), "each of the four files is held out");
    for (const f of RULED) assert.ok(!existsSync(join(root, f)), `${f} is out of the payload`);

    const back = await runner(["holdout", "in", "--root", root, "--json"], { cwd: cache, env: e2eEnv(cache) });
    assert.equal(back.code, 0, back.stderr + back.stdout);
    for (const f of RULED) assert.equal(readFileSync(join(root, f), "utf8"), `# ${f}\n\nMirror-only notes.\n`, `${f} is back in the mirror, byte for byte`);
  });
});

test("e2e: --runner-version prints the pin", async () => {
  const r = await runner(["--runner-version"]);
  assert.equal(r.code, 0);
  assert.equal(r.stdout.trim(), readPinnedVersion());
});

/**
 * A small extension that `rx preflight` accepts as a root (package.json with a commands array,
 * CHANGELOG with a placeholder, README, icon reference left unresolved on purpose is avoided).
 * @param {string} root
 */
function fakeExtension(root) {
  mkdirSync(join(root, "src"), { recursive: true });
  mkdirSync(join(root, "assets"), { recursive: true });
  writeFileSync(
    join(root, "package.json"),
    JSON.stringify(
      {
        $schema: "https://www.raycast.com/schemas/extension.json",
        name: "fake-ext",
        title: "Fake Ext",
        description: "A fake extension for runner tests.",
        icon: "icon.png",
        author: "someone",
        categories: ["Developer Tools"],
        license: "MIT",
        commands: [{ name: "index", title: "Index", description: "Shows a list.", mode: "view" }],
        dependencies: { "@raycast/api": "^1.104.25" },
      },
      null,
      2,
    ),
  );
  writeFileSync(join(root, "CHANGELOG.md"), "# Fake Ext Changelog\n\n## [Initial Version] - {PR_MERGE_DATE}\n\n- First release\n");
  writeFileSync(join(root, "README.md"), "# Fake Ext\n\nA fake extension.\n");
  writeFileSync(join(root, "src", "index.tsx"), "export default function Command() { return null; }\n");
  writeFileSync(join(root, "package-lock.json"), JSON.stringify({ name: "fake-ext", lockfileVersion: 3, packages: { "": { name: "fake-ext" }, "node_modules/@raycast/api": { version: "1.104.25" } } }));
}

test("npx mode runs from a neutral --prefix, so a checkout of rx itself cannot hijack the pinned package (2026-11-15)", async () => {
  await withTempDir(async (dir) => {
    // Inside the rx checkout, `npx -y @chrismessina/raycast-harness@<pin>` resolved to the
    // workspace package and printed `sh: rx: command not found`, and the fail-closed guard hook
    // then blocked every tool call. A package.json with the same name and the pinned version (npx
    // prefers a local package only when its version satisfies the spec) reproduces it.
    const ws = join(dir, "rx-checkout");
    mkdirSync(ws);
    writeFileSync(join(ws, "package.json"), JSON.stringify({ name: "@chrismessina/raycast-harness", version: readPinnedVersion(), bin: { rx: "bin/rx.mjs" } }));
    const env = { ...e2eEnv(join(dir, "cache")) };
    delete env.RX_DEV;
    delete env.RX_TARBALL;
    const r = await runner(["--version"], { cwd: ws, env });
    assert.equal(r.code, 0, r.stderr);
    assert.equal(r.stdout.trim(), readPinnedVersion());
    assert.ok(existsSync(npxPrefix(env)), "the runner created its prefix directory");
  });
});

test("inRxCheckout: only a project npm resolves to a package named @chrismessina/raycast-harness gets --prefix", async () => {
  await withTempDir(async (dir) => {
    const env = { XDG_CACHE_HOME: join(dir, "cache") };
    const rx = join(dir, "rx");
    mkdirSync(join(rx, "src", "deep"), { recursive: true });
    writeFileSync(join(rx, "package.json"), JSON.stringify({ name: "@chrismessina/raycast-harness" }));
    assert.equal(inRxCheckout(join(rx, "src", "deep")), true, "a subdirectory of the checkout");
    assert.deepEqual(resolveExecutable({ version: "0.1.0", env, cwd: rx }).args, ["--prefix", npxPrefix(env), "-y", "@chrismessina/raycast-harness@0.1.0"]);
    const ext = join(rx, "fixtures", "ext");
    mkdirSync(ext, { recursive: true });
    writeFileSync(join(ext, "package.json"), JSON.stringify({ name: "some-extension" }));
    assert.equal(inRxCheckout(ext), false, "a nested project is its own project");
    const nm = join(rx, "other");
    mkdirSync(join(nm, "node_modules"), { recursive: true });
    assert.equal(inRxCheckout(nm), false, "a node_modules directory makes its parent the project");
    writeFileSync(join(dir, "broken.json"), "");
    const broken = join(dir, "broken");
    mkdirSync(broken);
    writeFileSync(join(broken, "package.json"), "{");
    assert.equal(inRxCheckout(broken), false);
  });
});

test("prepareExecutable: creates the npx prefix; when it cannot, it drops --prefix and runs npx as before", async () => {
  await withTempDir(async (dir) => {
    const env = { XDG_CACHE_HOME: join(dir, "cache") };
    const rx = join(dir, "rx");
    mkdirSync(rx);
    writeFileSync(join(rx, "package.json"), JSON.stringify({ name: "@chrismessina/raycast-harness" }));
    const exe = resolveExecutable({ version: "0.1.0", env, cwd: rx });
    assert.ok(!existsSync(npxPrefix(env)), "resolveExecutable touches no disk");
    assert.deepEqual(prepareExecutable(exe).args, exe.args);
    assert.ok(existsSync(npxPrefix(env)));
    writeFileSync(join(dir, "file"), "");
    const blocked = resolveExecutable({ version: "0.1.0", env: { XDG_CACHE_HOME: join(dir, "file") }, cwd: rx });
    assert.deepEqual(prepareExecutable(blocked).args, ["-y", "@chrismessina/raycast-harness@0.1.0"]);
    const dev = resolveExecutable({ version: "0.1.0", env: { RX_DEV: (mkdirSync(join(dir, "d", "bin"), { recursive: true }), writeFileSync(join(dir, "d", "bin", "rx.mjs"), ""), join(dir, "d")) } });
    assert.equal(prepareExecutable(dev), dev, "other modes are untouched");
  });
});

// ---- the guard hook when rx cannot run ---------------------------------------------------------
// The hook is `onFailure: block` on every Bash/Write/Edit call. When the pinned rx cannot be
// fetched (a pin bumped before `npm publish`, no network), the runner used to exit 2 and every
// call was refused, including the edit that would undo the pin (2026-11-18: pin 0.1.4 before
// publish; earlier, npx inside an rx checkout). Now the runner falls back to a conservative
// textual check: a call rx guard could have a stake in is still denied; any other passes with a
// warning.

/** A fake rx checkout whose `commands --json` and `guard` behave as given. @param {string} dir @param {{ registry: boolean, guard: string }} how */
function fakeRx(dir, how) {
  mkdirSync(join(dir, "bin"), { recursive: true });
  writeFileSync(
    join(dir, "bin", "rx.mjs"),
    `const a = process.argv.slice(2);
if (a[0] === "commands") { if (${how.registry}) { process.stdout.write(${JSON.stringify(JSON.stringify(REGISTRY_DOC))}); process.exit(0); } process.stderr.write("npm error code ETARGET\\n"); process.exit(1); }
if (a[0] === "guard") { let s = ""; process.stdin.on("data", (d) => (s += d)); process.stdin.on("end", () => { ${how.guard} }); }
`,
  );
  return dir;
}

/** @param {string} cwd @param {string} tool_name @param {Record<string, unknown>} tool_input */
const payload = (cwd, tool_name, tool_input) => JSON.stringify({ hook_event_name: "PreToolUse", cwd, tool_name, tool_input });
/** @param {string} stdout */
const decision = (stdout) => {
  if (!stdout.trim()) return "allow";
  const o = JSON.parse(stdout);
  return o.hookSpecificOutput?.permissionDecision ?? (o.systemMessage ? "allow+warn" : "allow");
};

test("guard: when rx cannot be loaded, a call rx guard has no stake in passes with a warning; a guarded one is still denied", async () => {
  await withTempDir(async (dir) => {
    const cfg = join(dir, "config");
    const repo = join(dir, "repo");
    mkdirSync(join(repo, ".git", "rx"), { recursive: true });
    /** @type {[string, Record<string, string>][]} */
    const failures = [
      ["missing checkout", { RX_DEV: join(dir, "nope") }],
      ["the pin cannot be fetched", { RX_DEV: fakeRx(join(dir, "fake1"), { registry: false, guard: 'process.stderr.write("npm error code ETARGET\\n"); process.exit(1)' }) }],
      ["guard crashes", { RX_DEV: fakeRx(join(dir, "fake2"), { registry: true, guard: "process.exit(1)" }) }],
    ];
    for (const [label, env] of failures) {
      /** @param {string} tool @param {Record<string, unknown>} input */
      const run = async (tool, input) => {
        const r = await runner(["guard"], { env: { ...process.env, ...env, XDG_CONFIG_HOME: cfg, XDG_CACHE_HOME: join(dir, "cache") }, input: payload(repo, tool, input) });
        assert.equal(r.code, 0, `${label}: the hook itself never fails (${r.stderr})`);
        return decision(r.stdout);
      };
      /** @type {[string, Record<string, unknown>][]} */
      const free = [
        ["Edit", { file_path: join(dir, "elsewhere", "rx-version.json"), old_string: "a", new_string: "b" }],
        ["Write", { file_path: "src/index.tsx", content: "x" }],
        ["Bash", { command: "ls -la && git status" }],
        ["Bash", { command: "gh run view 1 --json status # already queued" }],
        ["Bash", { command: "node rx.mjs preflight --published" }],
      ];
      for (const [tool, input] of free) assert.equal(await run(tool, input), "allow+warn", `${label}: ${tool} ${JSON.stringify(input)}`);
      /** @type {[string, Record<string, unknown>][]} */
      const guarded = [
        ["Bash", { command: "npm run publish" }],
        ["Bash", { command: "cd ext && ray publish" }],
        ["Bash", { command: "gh pr ready 12" }],
        ["Bash", { command: "gh api -X PATCH repos/a/b/pulls/1 -f draft=false" }],
        ["Bash", { command: "cat .g''it/rx/receipt.json" }],
        ["Bash", { command: `rm ${join(cfg, "raycast-harness", "attest.key")}` }],
        ["Edit", { file_path: join(repo, ".git", "rx", "audit.json"), old_string: "a", new_string: "b" }],
        ["Write", { file_path: ".git/rx/receipt.json", content: "{}" }],
        ["Write", { file_path: join(cfg, "raycast-harness", "attest.key"), content: "k" }],
        ["NotebookEdit", { notebook_path: join(repo, ".git", "rx", "n.ipynb"), new_source: "" }],
      ];
      for (const [tool, input] of guarded) assert.equal(await run(tool, input), "deny", `${label}: ${tool} ${JSON.stringify(input)}`);
    }
  });
});

test("guard: unreadable hook input is denied when rx cannot be loaded", async () => {
  await withTempDir(async (dir) => {
    const r = await runner(["guard"], { env: { ...process.env, RX_DEV: join(dir, "nope"), XDG_CACHE_HOME: join(dir, "cache") }, input: "not json" });
    assert.equal(r.code, 0);
    assert.equal(decision(r.stdout), "deny");
  });
});

test("guard: when rx runs, its decision and stdout pass through untouched, with the hook input on its stdin", async () => {
  await withTempDir(async (dir) => {
    const deny = `process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: "saw " + JSON.parse(s).tool_input.command } }))`;
    const env = { ...process.env, RX_DEV: fakeRx(join(dir, "fake"), { registry: true, guard: deny }), XDG_CACHE_HOME: join(dir, "cache") };
    const r = await runner(["guard"], { env, input: payload(dir, "Bash", { command: "ls" }) });
    assert.equal(r.code, 0);
    assert.equal(JSON.parse(r.stdout).hookSpecificOutput.permissionDecisionReason, "saw ls");
    const allow = await runner(["guard"], { env: { ...env, RX_DEV: fakeRx(join(dir, "fake3"), { registry: true, guard: "process.exit(0)" }) }, input: payload(dir, "Bash", { command: "ls" }) });
    assert.deepEqual([allow.code, allow.stdout], [0, ""]);
  });
});

test("guard fallback applies rx guard's text rules, and only those (Codex r4 G5, r5, r6, r7)", async () => {
  await withTempDir(async (dir) => {
    const cfg = join(dir, "config");
    const repo = join(dir, "repo");
    const env = { HOME: process.env.HOME, XDG_CONFIG_HOME: cfg };
    /** @param {string} tool @param {Record<string, unknown>} input */
    const stake = (tool, input) => guardStake(payload(repo, tool, input), env);
    const denied = [
      "gh pr ready 12",
      "gh pr -R o/r ready 12",
      'gh "pr" re""ady 12',
      "gh api -X PATCH repos/a/b/pulls/1 -f draft=false",
      "gh api repos/a/b/pulls/1 -f ready_for_review=true",
      "gh api graphql -f query='mutation { markPullRequestReadyForReview(input: {}) { clientMutationId } }'",
      "npm run publish",
      "cat .git//rx/receipt.json",
      "cat .git/worktrees/w/rx/receipt.json",
      "cat ~/.config/raycast-harness/attest.key",
      "rm ~/.config/raycast-harness/generations/current.json",
      "rm $HOME/.config/raycast-harness/generations/current.json",
      `ls ${join(cfg, "raycast-harness")}`,
      `cat ".git/worktrees/my branch/rx/receipt.json"`, // Codex r6 R6-4
    ];
    for (const command of denied) assert.ok(stake("Bash", { command }), `deny: ${command}`);
    const allowed = ["gh pr create --draft", "gh pr list --label ready", "rg ready src", "cat .git/config", "cd ~/.config && ls", "ls", `ls ${join(cfg, "raycast-harness-backup")}` /* Codex r6 R6-3 */];
    for (const command of allowed) assert.equal(stake("Bash", { command }), null, `allow: ${command}`);
    const deniedWrites = [".git/rx/x.json", join(repo, ".git", "worktrees", "w", "rx", "x.json"), "src/../.git/rx/x.json", join(cfg, "raycast-harness", "attest.key"), join(repo, ".GIT", "RX", "a")];
    for (const file_path of deniedWrites) assert.ok(stake("Write", { file_path, content: "" }), `deny Write: ${file_path}`);
    const quoted = { HOME: process.env.HOME, XDG_CONFIG_HOME: join(dir, "Chris's config") }; // Codex r7 R7-1
    assert.ok(guardStake(payload(repo, "Bash", { command: `rm "${join(dir, "Chris's config", "raycast-harness", "generations", "current.json")}"` }), quoted), "a config directory with an apostrophe");
    const allowedWrites = ["rx-version.json", "src/a.ts", ".git/hooks/pre-push", ".git/rxx", join(dir, "config-other", "raycast-harness", "x")];
    for (const file_path of allowedWrites) assert.equal(stake("Write", { file_path, content: "" }), null, `allow Write: ${file_path}`);
  });
});

test("guard fallback denies input it cannot read, and never crashes on odd values (Codex G3)", async () => {
  await withTempDir(async (dir) => {
    const env = { ...process.env, RX_DEV: join(dir, "nope"), XDG_CACHE_HOME: join(dir, "cache") };
    for (const input of ['"text"', "42", "null", "[]", JSON.stringify({ cwd: dir, tool_name: "Bash", tool_input: { command: { toString: null } } })]) {
      const r = await runner(["guard"], { env, input });
      assert.deepEqual([r.code, decision(r.stdout)], [0, "deny"], input);
    }
  });
});

test("guard: a rx that exits before reading a large payload falls back instead of crashing on EPIPE (Codex G3)", async () => {
  await withTempDir(async (dir) => {
    mkdirSync(join(dir, "fake", "bin"), { recursive: true });
    writeFileSync(join(dir, "fake", "bin", "rx.mjs"), "process.exit(1)\n");
    const env = { ...process.env, RX_DEV: join(dir, "fake"), XDG_CACHE_HOME: join(dir, "cache") };
    const r = await runner(["guard"], { env, input: payload(dir, "Write", { file_path: "src/a.ts", content: "x".repeat(4 * 1024 * 1024) }) });
    assert.deepEqual([r.code, decision(r.stdout)], [0, "allow+warn"], r.stderr);
  });
});

test("guard: a rx that never answers ends in the fallback before the hook's deadline (Codex G4)", async () => {
  await withTempDir(async (dir) => {
    mkdirSync(join(dir, "fake", "bin"), { recursive: true });
    writeFileSync(join(dir, "fake", "bin", "rx.mjs"), "setInterval(() => {}, 1000)\n");
    const env = { ...process.env, RX_DEV: join(dir, "fake"), XDG_CACHE_HOME: join(dir, "cache"), RX_GUARD_DEADLINE_MS: "1500" };
    const t = Date.now();
    const r = await runner(["guard"], { env, input: payload(dir, "Bash", { command: "ls" }) });
    assert.ok(Date.now() - t < 10_000, `took ${Date.now() - t} ms`);
    assert.deepEqual([r.code, decision(r.stdout)], [0, "allow+warn"]);
    assert.match(JSON.parse(r.stdout).systemMessage, /did not answer within 2 s|exited|could not run/);
  });
});
