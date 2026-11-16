#!/usr/bin/env node
// Installation smoke test against the published rx pin (Phase 9.3). Reads test/install-smoke.json,
// runs each case through scripts/rx.mjs with RX_DEV and RX_TARBALL unset and a fresh npm cache and
// XDG cache, and compares exit codes and stdout. `--ci` then runs scripts/ci.mjs in the same
// environment. Exit 0 when every case matches, 1 otherwise.
//
//   node scripts/install-smoke.mjs [--ci]

import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PLUGIN = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const RUNNER = join(PLUGIN, "scripts", "rx.mjs");
const manifest = JSON.parse(readFileSync(join(PLUGIN, "test", "install-smoke.json"), "utf8"));
const pin = JSON.parse(readFileSync(join(PLUGIN, "rx-version.json"), "utf8")).version;
const escapedPin = pin.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const sandbox = mkdtempSync(join(tmpdir(), "rx-smoke-"));
// npm_config_prefix isolates npm's global packages: npx runs a matching global install before it
// fetches, so a globally installed rx of the pinned version would otherwise stand in for the published one.
const npmCache = join(sandbox, "npm-cache");
const env = { ...process.env, npm_config_cache: npmCache, npm_config_prefix: join(sandbox, "npm-prefix"), XDG_CACHE_HOME: join(sandbox, "xdg-cache") };
delete env.RX_DEV;
delete env.RX_TARBALL;
const work = mkdtempSync(join(sandbox, "cwd-"));

/** A fixture copied into a fresh git repository of its own, so no rx state carries over. @param {string} name */
function fixtureRepo(name) {
  const dir = mkdtempSync(join(sandbox, `repo-${name}-`));
  cpSync(join(PLUGIN, "test", "fixtures", name), dir, { recursive: true });
  rmSync(join(dir, "expected.json"), { force: true });
  const git = (/** @type {string[]} */ ...a) => spawnSync("git", ["-c", "commit.gpgsign=false", "-c", "user.name=smoke", "-c", "user.email=smoke@example.com", ...a], { cwd: dir, encoding: "utf8" });
  for (const a of [["init", "-q"], ["add", "-A"], ["commit", "-q", "-m", "fixture"]]) if (git(...a).status !== 0) throw new Error(`git ${a[0]} failed in ${dir}`);
  return dir;
}

/** @param {string} cwd */
const resolveCwd = (cwd) => (cwd === "sandbox" ? work : cwd.startsWith("repo:") ? fixtureRepo(cwd.slice(5)) : join(PLUGIN, "test", "fixtures", cwd.replace(/^fixture:/, "")));

/** The pinned package.json npx laid out under the fresh npm cache, or null. */
function cachedPin() {
  const npx = join(npmCache, "_npx");
  if (!existsSync(npx)) return null;
  for (const d of readdirSync(npx)) {
    const pkg = join(npx, d, "node_modules", "@chrismessina", "raycast-harness", "package.json");
    if (existsSync(pkg) && JSON.parse(readFileSync(pkg, "utf8")).version === pin) return pkg;
  }
  return null;
}

/** @param {string} command @param {string} cwd */
const hookPayload = (command, cwd) =>
  JSON.stringify({ session_id: "smoke", transcript_path: "/dev/null", cwd, hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command, description: "smoke" }, tool_use_id: "toolu_smoke" });

let failures = 0;
/** @type {string[]} */
let listed = [];
try {
  for (const c of manifest.cases) {
    const cwd = resolveCwd(c.cwd);
    const input = c.stdin?.startsWith("bash:") ? hookPayload(c.stdin.slice(5), cwd) : c.stdin;
    const r = spawnSync(process.execPath, [RUNNER, ...c.args], { cwd, env, input, encoding: "utf8", timeout: 300_000 });
    const problems = [];
    if (r.status !== c.exit) problems.push(`exit ${r.status ?? r.signal}, expected ${c.exit}`);
    if (c.stdout !== undefined && !new RegExp(c.stdout.replaceAll("{pin}", escapedPin)).test(r.stdout)) problems.push(`stdout does not match /${c.stdout}/: ${JSON.stringify(r.stdout.slice(0, 300))}`);
    if (c.args[0] === "commands" && c.args.includes("--json") && r.status === 0) listed = JSON.parse(r.stdout).data.commands.map((/** @type {{ name: string }} */ x) => x.name);
    if (problems.length) {
      failures++;
      console.log(`FAIL   ${c.label}: ${problems.join("; ")}`);
      if (r.stderr.trim()) console.log(`       stderr: ${r.stderr.trim().split("\n").slice(0, 3).join(" | ")}`);
    } else console.log(`PASS   ${c.label}`);
  }
  const helped = new Set(manifest.cases.filter((/** @type {{ args: string[] }} */ c) => c.args[1] === "--help").map((/** @type {{ args: string[] }} */ c) => c.args[0]));
  const missing = listed.filter((n) => !helped.has(n));
  if (!listed.length) { failures++; console.log("FAIL   coverage: the command discovery case did not produce a command list"); }
  else if (missing.length) { failures++; console.log(`FAIL   coverage: no --help case for ${missing.join(", ")}`); }
  else console.log(`PASS   coverage: all ${listed.length} commands have a --help case`);

  const fromCache = cachedPin();
  if (fromCache) console.log(`PASS   provenance: @chrismessina/raycast-harness@${pin} came from the fresh npm cache`);
  else { failures++; console.log(`FAIL   provenance: @chrismessina/raycast-harness@${pin} is not in the fresh npm cache, so the cases did not run the published package`); }

  if (process.argv.includes("--ci")) {
    const ci = spawnSync(process.execPath, [join(PLUGIN, "scripts", "ci.mjs")], { cwd: PLUGIN, env, stdio: "inherit", timeout: 900_000 });
    if (ci.status !== 0) { failures++; console.log(`FAIL   ci.mjs exited ${ci.status ?? ci.signal} against the published pin`); }
    else console.log("PASS   ci.mjs against the published pin");
  }
} finally {
  rmSync(sandbox, { recursive: true, force: true });
}
console.log(`smoke: ${failures ? `${failures} failure(s)` : "every case matched"} for @chrismessina/raycast-harness@${pin}`);
process.exit(failures ? 1 : 0);
