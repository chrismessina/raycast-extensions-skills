// Run: node --test plugins/raycast-extensions/scripts/ci.test.mjs
// Unit tests for ci.mjs. Every check here runs against a temp repository laid out like this one,
// so nothing in the real plugin is touched, and no test calls rx or the network. The checks that
// shell out to rx (preset-*, fixtures) are tested through an injected `run`; their end-to-end
// behavior is exercised by running ci.mjs itself. plugin-tests is never run from here: it runs
// this file, so calling it would recurse.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  HOME_PATH_ALLOWLIST,
  CHECKS,
  HOME_PREFIX,
  checkBudgets,
  checkFixtures,
  checkHomePaths,
  checkMarkers,
  checkPluginTests,
  checkPresetCheck,
  compareRun,
  exitCode,
  expectedProblem,
  formatResult,
  main,
  matrixFiles,
  wcLines,
} from "./ci.mjs";
import { capture } from "./rx.mjs";

/** @param {(repo: string, plugin: string) => Promise<void> | void} fn */
async function withRepo(fn) {
  const repo = mkdtempSync(join(tmpdir(), "rx-ci-"));
  const plugin = join(repo, "plugins", "raycast-extensions");
  mkdirSync(plugin, { recursive: true });
  try {
    await fn(repo, plugin);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
}

/** @param {string} file @param {string} text */
function put(file, text) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, text);
}

/** @param {number} n */
const nLines = (n) => "x\n".repeat(n);

/** @param {string} repo @param {string} plugin @param {typeof capture} [run] */
const ctx = (repo, plugin, run = capture) => ({ repoRoot: repo, pluginDir: plugin, env: process.env, run });

test("wcLines counts newline characters, as wc -l does", () => {
  assert.equal(wcLines(""), 0);
  assert.equal(wcLines("a"), 0);
  assert.equal(wcLines("a\nb\n"), 2);
  assert.equal(wcLines("a\r\nb"), 1);
});

test("budgets: within budget PASSes; an overrun, a SKILL.md with no entry and an entry with no SKILL.md each FAIL", async () => {
  await withRepo((repo, plugin) => {
    put(join(plugin, "skills", "ship", "SKILL.md"), nLines(450));
    put(join(plugin, "skills", "develop", "SKILL.md"), nLines(10));
    put(join(plugin, "budgets.json"), JSON.stringify({ skills: { "skills/ship/SKILL.md": 450, "skills/develop/SKILL.md": 300 } }));
    assert.equal(checkBudgets(ctx(repo, plugin)).verdict, "PASS", "exactly at the limit passes");

    put(join(plugin, "skills", "ship", "SKILL.md"), nLines(451));
    let r = checkBudgets(ctx(repo, plugin));
    assert.equal(r.verdict, "FAIL");
    assert.deepEqual(r.details, ["skills/ship/SKILL.md: 451 lines, over its budget of 450 by 1"]);

    put(join(plugin, "skills", "ship", "SKILL.md"), nLines(1));
    put(join(plugin, "skills", "scaffold", "SKILL.md"), nLines(1));
    put(join(plugin, "budgets.json"), JSON.stringify({ skills: { "skills/ship/SKILL.md": 450, "skills/develop/SKILL.md": 300, "skills/gone/SKILL.md": 100 } }));
    r = checkBudgets(ctx(repo, plugin));
    assert.equal(r.verdict, "FAIL");
    assert.deepEqual(r.details, ["skills/scaffold/SKILL.md: 1 lines, no budget entry", "skills/gone/SKILL.md: budget entry with no SKILL.md"]);
  });
});

test("budgets: a missing or malformed budgets.json is ERROR, never a pass", async () => {
  await withRepo((repo, plugin) => {
    assert.equal(checkBudgets(ctx(repo, plugin)).verdict, "ERROR");
    put(join(plugin, "budgets.json"), JSON.stringify({ skills: { "skills/ship/SKILL.md": "450" } }));
    assert.equal(checkBudgets(ctx(repo, plugin)).verdict, "ERROR");
    put(join(plugin, "budgets.json"), "[]");
    assert.equal(checkBudgets(ctx(repo, plugin)).verdict, "ERROR");
  });
});

test("markers: SUPERSEDED or a Corrected marker in skills/ or reference/ FAILs; learnings are exempt; the bare word is fine", async () => {
  await withRepo((repo, plugin) => {
    put(join(plugin, "skills", "ship", "SKILL.md"), "Errors are corrected by the runner.\nCorrectedness is not a word.\n");
    put(join(plugin, "reference", "ok.md"), "fine\n");
    put(join(plugin, "learnings", "x", "history.md"), "SUPERSEDED by the runner. Corrected 2026-09-09.\n");
    assert.equal(checkMarkers(ctx(repo, plugin)).verdict, "PASS");
    put(join(plugin, "reference", "dep-gates.md"), "ok\n**SUPERSEDED** see below\n");
    put(join(plugin, "skills", "ship", "nested", "notes.md"), "Corrected 2026-09-09: the floor\n");
    const r = checkMarkers(ctx(repo, plugin));
    assert.equal(r.verdict, "FAIL");
    assert.deepEqual(r.details, ["skills/ship/nested/notes.md:1  Corrected 2026-09-09: the floor", "reference/dep-gates.md:2  **SUPERSEDED** see below"]);
  });
});

const ALLOWED = HOME_PATH_ALLOWLIST[0];

test("home-paths: a literal outside the allowlist FAILs, in the plugin and in the root README/CLAUDE/CONCEPTS; other root files are out of scope", async () => {
  await withRepo(async (repo, plugin) => {
    // Satisfy the real allowlist entry so it is not stale.
    put(join(repo, ALLOWED.file), `${nLines(ALLOWED.line - 1)}grep -n '${HOME_PREFIX}' AGENTS.md\n`);
    put(join(repo, "docs", "plan.md"), `${HOME_PREFIX}someone/out-of-scope\n`);
    let r = await checkHomePaths(ctx(repo, plugin));
    assert.equal(r.verdict, "PASS", r.details.join("\n"));

    put(join(plugin, "reference", "x.md"), `ok\nsee ${HOME_PREFIX}someone/file.md\n`);
    put(join(repo, "CLAUDE.md"), `${HOME_PREFIX}someone\n`);
    r = await checkHomePaths(ctx(repo, plugin));
    assert.equal(r.verdict, "FAIL");
    assert.deepEqual(r.details.map((d) => d.split("  ")[0]), ["CLAUDE.md:1", "plugins/raycast-extensions/reference/x.md:2"]);
  });
});

test("home-paths: an allowlist entry whose line no longer holds the literal FAILs as stale", async () => {
  await withRepo(async (repo, plugin) => {
    put(join(repo, ALLOWED.file), `${nLines(ALLOWED.line + 3)}`);
    const r = await checkHomePaths(ctx(repo, plugin));
    assert.equal(r.verdict, "FAIL");
    assert.match(r.details.join("\n"), new RegExp(`${ALLOWED.file}:${ALLOWED.line}  stale allowlist entry`));
  });
});

test("home-paths: in a git work tree, untracked files count and ignored files do not", async () => {
  await withRepo(async (repo, plugin) => {
    const init = await capture("git", ["init", "-q", repo]);
    assert.equal(init.code, 0, init.stderr);
    put(join(repo, ALLOWED.file), `${nLines(ALLOWED.line - 1)}grep -n '${HOME_PREFIX}' AGENTS.md\n`);
    put(join(repo, ".gitignore"), "plugins/raycast-extensions/scratch/\n");
    put(join(plugin, "scratch", "notes.md"), `${HOME_PREFIX}someone\n`);
    assert.equal((await checkHomePaths(ctx(repo, plugin))).verdict, "PASS", "an ignored file is not scanned");
    put(join(plugin, "new.md"), `${HOME_PREFIX}someone\n`);
    const r = await checkHomePaths(ctx(repo, plugin));
    assert.equal(r.verdict, "FAIL");
    assert.deepEqual(r.details.map((d) => d.split("  ")[0]), ["plugins/raycast-extensions/new.md:1"]);
  });
});

test("matrixFiles: only a start marker alone on its line counts, not a mention in prose", async () => {
  await withRepo((repo, plugin) => {
    put(join(plugin, "reference", "house-style.md"), "# H\n\n<!-- rx:matrix:start -->\n| a |\n<!-- rx:matrix:end -->\n");
    put(join(plugin, "reference", "rx.md"), "regenerates `<!-- rx:matrix:start -->` regions\n");
    assert.deepEqual(matrixFiles(plugin), ["reference/house-style.md"]);
  });
});

test("expectedProblem: the expected.json contract", () => {
  const ok = { why: "w", runs: [{ args: ["preflight", "--json"], match: "partial", exit: 1, checks: { logger: "FAIL" } }] };
  assert.equal(expectedProblem(ok), null);
  assert.match(String(expectedProblem({ ...ok, why: "" })), /why/);
  assert.match(String(expectedProblem({ ...ok, runs: [] })), /runs/);
  assert.match(String(expectedProblem({ ...ok, runs: [{ ...ok.runs[0], args: ["preflight"] }] })), /--json/);
  assert.match(String(expectedProblem({ ...ok, runs: [{ ...ok.runs[0], exit: "1" }] })), /exit/);
  assert.match(String(expectedProblem({ ...ok, runs: [{ ...ok.runs[0], checks: {} }] })), /checks/);
  assert.match(String(expectedProblem({ ...ok, runs: [{ ...ok.runs[0], checks: { logger: "OK" } }] })), /one of/);
});

test("compareRun: exit and every listed verdict must equal; an absent check is a mismatch; unlisted checks are ignored", () => {
  const want = { args: ["preflight", "--json"], match: /** @type {const} */ ("partial"), exit: 1, checks: { logger: "FAIL", prettierrc: "PASS" } };
  assert.deepEqual(compareRun(want, { exit: 1, results: [{ id: "logger", verdict: "FAIL" }, { id: "prettierrc", verdict: "PASS" }, { id: "schema", verdict: "WARN" }] }), []);
  assert.deepEqual(compareRun(want, { exit: 0, results: [{ id: "logger", verdict: "PASS" }] }), ["exit 0, expected 1", "logger: PASS, expected FAIL", "prettierrc: absent, expected PASS"]);
});

/**
 * A stand-in for the runner: answers `node …/scripts/rx.mjs <argv>` from a table keyed by cwd.
 * @param {(argv: string[], cwd: string | undefined) => { code: number, stdout: string, stderr?: string }} answer
 * @returns {typeof capture}
 */
const fakeRun = (answer) => async (_file, args, opts = {}) => {
  const r = answer(args.slice(1), opts.cwd);
  return { code: r.code, stdout: r.stdout, stderr: r.stderr ?? "" };
};

/** @param {number} exit @param {Record<string, string>} verdicts */
const envelope = (exit, verdicts) => JSON.stringify({ command: "preflight", exit, results: Object.entries(verdicts).map(([id, verdict]) => ({ id, verdict, message: "m", details: [] })) });

test("fixtures: actual equal to expected PASSes even when the fixture FAILs a check; a flipped expectation FAILs; bad JSON from rx is ERROR", async () => {
  await withRepo(async (repo, plugin) => {
    const dir = join(plugin, "test", "fixtures", "logger-missing");
    put(join(dir, "expected.json"), JSON.stringify({ why: "w", runs: [{ args: ["preflight", "--root", ".", "--json"], match: "partial", exit: 1, checks: { logger: "FAIL" } }] }));
    /** @type {string[][]} */
    const seen = [];
    const run = fakeRun((argv, cwd) => {
      seen.push([...argv, `cwd=${cwd}`]);
      return { code: 1, stdout: envelope(1, { logger: "FAIL", schema: "PASS" }) };
    });
    assert.equal((await checkFixtures(ctx(repo, plugin, run))).verdict, "PASS");
    assert.deepEqual(seen, [["preflight", "--root", ".", "--json", `cwd=${dir}`]], "runs the expected argv from the fixture directory");

    put(join(dir, "expected.json"), JSON.stringify({ why: "w", runs: [{ args: ["preflight", "--json"], match: "partial", exit: 1, checks: { logger: "PASS" } }] }));
    const r = await checkFixtures(ctx(repo, plugin, run));
    assert.equal(r.verdict, "FAIL");
    assert.deepEqual(r.details, ["logger-missing (preflight --json): logger: FAIL, expected PASS"]);

    const broken = fakeRun(() => ({ code: 2, stdout: "", stderr: "rx runner: RX_DEV=/x is not an rx checkout" }));
    const e = await checkFixtures(ctx(repo, plugin, broken));
    assert.equal(e.verdict, "ERROR");
    assert.match(e.details[0], /rx runner: RX_DEV/);
  });
});

test("fixtures: no fixtures is a FAIL; an invalid expected.json is ERROR", async () => {
  await withRepo(async (repo, plugin) => {
    const run = fakeRun(() => ({ code: 0, stdout: envelope(0, {}) }));
    assert.equal((await checkFixtures(ctx(repo, plugin, run))).verdict, "FAIL");
    put(join(plugin, "test", "fixtures", "x", "expected.json"), JSON.stringify({ why: "w", runs: [{ args: ["preflight"], exit: 0, checks: { a: "PASS" } }] }));
    assert.equal((await checkFixtures(ctx(repo, plugin, run))).verdict, "ERROR");
  });
});

test("preset-check: every result PASS is PASS; any FAIL is FAIL; an rx ERROR result is ERROR", async () => {
  await withRepo(async (repo, plugin) => {
    const all = { "preset-schema": "PASS", "preset-ids": "PASS", "preset-anchors": "PASS", "preset-bindings": "PASS", "preset-severity": "PASS" };
    const with_ = (/** @type {Record<string, string>} */ v, /** @type {number} */ exit) => fakeRun(() => ({ code: exit, stdout: envelope(exit, v) }));
    assert.equal((await checkPresetCheck(ctx(repo, plugin, with_(all, 0)))).verdict, "PASS");
    const f = await checkPresetCheck(ctx(repo, plugin, with_({ ...all, "preset-anchors": "FAIL" }, 1)));
    assert.equal(f.verdict, "FAIL");
    assert.deepEqual(f.details, ["FAIL  preset-anchors  m"]);
    assert.equal((await checkPresetCheck(ctx(repo, plugin, with_({ ...all, "preset-bindings": "ERROR" }, 2)))).verdict, "ERROR");
  });
});

test("formatResult and exitCode: one verdict line plus indented details; ERROR outranks FAIL", () => {
  assert.equal(formatResult({ id: "budgets", verdict: "FAIL", message: "1 budget problem(s)", details: ["skills/x/SKILL.md: over"] }), "FAIL   budgets           1 budget problem(s)\n       skills/x/SKILL.md: over\n");
  assert.equal(exitCode([{ id: "a", verdict: "PASS", message: "", details: [] }]), 0);
  assert.equal(exitCode([{ id: "a", verdict: "FAIL", message: "", details: [] }]), 1);
  assert.equal(exitCode([{ id: "a", verdict: "FAIL", message: "", details: [] }, { id: "b", verdict: "ERROR", message: "", details: [] }]), 2);
});

test("main: --only runs the named checks, --json prints the results array, unknown arguments and ids exit 2", async () => {
  await withRepo(async (repo, plugin) => {
    put(join(plugin, "skills", "ship", "SKILL.md"), nLines(5));
    put(join(plugin, "budgets.json"), JSON.stringify({ skills: { "skills/ship/SKILL.md": 4 } }));
    put(join(plugin, "reference", "ok.md"), "fine\n");
    let out = "";
    const io = { pluginDir: plugin, stdout: (/** @type {string} */ s) => (out += s), stderr: () => {} };
    assert.equal(await main(["--only", "budgets,markers"], io), 1);
    assert.deepEqual(out.split("\n").filter((l) => /^\S/.test(l)).map((l) => l.split(/\s+/).slice(0, 2).join(" ")), ["FAIL budgets", "PASS markers"]);
    out = "";
    assert.equal(await main(["--json", "--only", "markers"], io), 0);
    const doc = JSON.parse(out);
    assert.deepEqual(doc.map((/** @type {{ id: string, verdict: string }} */ r) => [r.id, r.verdict]), [["markers", "PASS"]]);
    assert.equal(await main(["--bogus"], io), 2);
    assert.equal(await main(["--only", "nope"], io), 2);
  });
});

// ---- Codex W5-C round 1 ---------------------------------------------------------------------

/** A TAP summary as node --test prints it (its own key spelling). @param {Record<string, number>} c */
// us-english-ok: the next line reproduces node --test output verbatim
const tap = (c) => `TAP version 13\n# tests ${c.tests}\n# suites 0\n# pass ${c.pass}\n# fail ${c.fail}\n# cancelled 0\n# skipped ${c.skipped}\n# todo ${c.todo ?? 0}\n`;

test("R1-F1 plugin-tests: a run with a skipped test or zero passes is not PASS, even at exit 0", async () => {
  await withRepo(async (repo, plugin) => {
    put(join(plugin, "scripts", "a.test.mjs"), "");
    const as = (/** @type {string} */ stdout) => fakeRun(() => ({ code: 0, stdout }));
    assert.equal((await checkPluginTests(ctx(repo, plugin, as(tap({ tests: 3, pass: 3, fail: 0, skipped: 0 }))))).verdict, "PASS");
    const skipped = await checkPluginTests(ctx(repo, plugin, as(tap({ tests: 3, pass: 2, fail: 0, skipped: 1 }))));
    assert.equal(skipped.verdict, "FAIL");
    assert.match(skipped.message, /skipped 1/);
    assert.equal((await checkPluginTests(ctx(repo, plugin, as(tap({ tests: 0, pass: 0, fail: 0, skipped: 0 }))))).verdict, "FAIL", "zero passes");
    assert.equal((await checkPluginTests(ctx(repo, plugin, as(tap({ tests: 2, pass: 1, fail: 0, skipped: 0, todo: 1 }))))).verdict, "FAIL", "a todo is not a pass");
    assert.equal((await checkPluginTests(ctx(repo, plugin, as("no summary")))).verdict, "ERROR", "no TAP summary is no evidence");
  });
});

test("plugin-tests runs scripts/lib/*.test.mjs as well as scripts/*.test.mjs (the registry client's tests are not skipped)", async () => {
  await withRepo(async (repo, plugin) => {
    put(join(plugin, "scripts", "a.test.mjs"), "");
    put(join(plugin, "scripts", "lib", "b.test.mjs"), "");
    put(join(plugin, "scripts", "lib", "helper.mjs"), "");
    /** @type {string[]} */
    let ran = [];
    const run = fakeRun((args) => {
      ran = args;
      return { code: 0, stdout: tap({ tests: 2, pass: 2, fail: 0, skipped: 0 }) };
    });
    const r = await checkPluginTests(ctx(repo, plugin, run));
    assert.equal(r.verdict, "PASS", r.message);
    assert.deepEqual(ran, [join(plugin, "scripts", "a.test.mjs"), join(plugin, "scripts", "lib", "b.test.mjs")]);
    assert.match(r.message, /^2 files:/);
  });
});

test("R1-F3 fixtures: an exact expectation rejects unexpected ids and duplicates; partial must be declared", () => {
  /** @type {import("./ci.mjs").FixtureRun} */
  const exact = { args: ["preflight", "--json"], match: "exact", exit: 0, checks: { a: "PASS", b: "N/A" } };
  assert.deepEqual(compareRun(exact, { exit: 0, results: [{ id: "a", verdict: "PASS" }, { id: "b", verdict: "N/A" }] }), []);
  assert.deepEqual(compareRun(exact, { exit: 0, results: [{ id: "a", verdict: "PASS" }, { id: "b", verdict: "N/A" }, { id: "c", verdict: "PASS" }] }), ["c: PASS, not in the exact expectation"]);
  assert.deepEqual(compareRun({ ...exact, match: /** @type {const} */ ("partial") }, { exit: 0, results: [{ id: "a", verdict: "PASS" }, { id: "b", verdict: "N/A" }, { id: "c", verdict: "PASS" }] }), []);
  assert.deepEqual(compareRun({ ...exact, match: /** @type {const} */ ("partial") }, { exit: 0, results: [{ id: "a", verdict: "PASS" }, { id: "a", verdict: "PASS" }, { id: "b", verdict: "N/A" }] }), ["a: emitted 2 times"]);
  const ok = { why: "w", runs: [exact] };
  assert.equal(expectedProblem(ok), null);
  assert.match(String(expectedProblem({ why: "w", runs: [{ ...exact, match: undefined }] })), /match/);
  assert.match(String(expectedProblem({ why: "w", runs: [{ ...exact, match: "some" }] })), /match/);
});

test("R1-F4 wrapped scripts: exit 0 without their completion line is ERROR", async () => {
  await withRepo(async (repo, plugin) => {
    for (const s of ["learnings-routes.mjs", "rx-reference.mjs", "rx-calls-check.mjs"]) put(join(plugin, "scripts", s), "");
    const out = (/** @type {string} */ stdout, code = 0) => fakeRun(() => ({ code, stdout }));
    assert.equal((await CHECKS["rx-calls"](ctx(repo, plugin, out("")))).verdict, "ERROR");
    assert.equal((await CHECKS["rx-calls"](ctx(repo, plugin, out("something else\n")))).verdict, "ERROR");
    assert.equal((await CHECKS["rx-calls"](ctx(repo, plugin, out("rx-calls-check: 16 file(s), 44 runner call(s) validated against rx 0.1.0, 0 finding(s)\n")))).verdict, "PASS");
    assert.equal((await CHECKS["rx-calls"](ctx(repo, plugin, out("rx-calls-check: 16 file(s), 44 runner call(s) validated against rx 0.1.0, 2 finding(s)\n")))).verdict, "ERROR", "exit 0 with findings is inconsistent");
    assert.equal((await CHECKS["rx-calls"](ctx(repo, plugin, out("", 1)))).verdict, "ERROR", "exit 1 with no findings printed is no evidence");
    assert.equal((await CHECKS["learnings-routes"](ctx(repo, plugin, out("learnings-routes: 7 skill tables current (32 learnings)\n")))).verdict, "PASS");
    assert.equal((await CHECKS["learnings-routes"](ctx(repo, plugin, out("learnings-routes: 0 skill tables current (0 learnings)\n")))).verdict, "ERROR");
    assert.equal((await CHECKS["rx-reference"](ctx(repo, plugin, out("rx-reference: /x/reference/rx.md is current\n")))).verdict, "PASS");
    assert.equal((await CHECKS["rx-reference"](ctx(repo, plugin, out("rx-reference: wrote /x/reference/rx.md\n")))).verdict, "ERROR", "a --check run must not write");
  });
});

test("R1-F4 preset wrappers: missing result ids, an empty results array, or process/envelope/verdict disagreement is ERROR", async () => {
  await withRepo(async (repo, plugin) => {
    put(join(plugin, "reference", "house-style.md"), "<!-- rx:matrix:start -->\n<!-- rx:matrix:end -->\n");
    const ids = ["preset-schema", "preset-ids", "preset-anchors", "preset-bindings", "preset-severity"];
    const all = Object.fromEntries(ids.map((i) => [i, "PASS"]));
    const raw = (/** @type {number} */ code, /** @type {number} */ exit, /** @type {Record<string, string>} */ v) => fakeRun(() => ({ code, stdout: envelope(exit, v) }));
    assert.equal((await checkPresetCheck(ctx(repo, plugin, raw(0, 0, all)))).verdict, "PASS");
    assert.equal((await checkPresetCheck(ctx(repo, plugin, raw(0, 0, { "preset-ids": "PASS" })))).verdict, "ERROR", "missing ids");
    assert.equal((await checkPresetCheck(ctx(repo, plugin, raw(2, 0, all)))).verdict, "ERROR", "process exit 2, envelope 0");
    assert.equal((await checkPresetCheck(ctx(repo, plugin, raw(0, 0, { ...all, "preset-ids": "FAIL" })))).verdict, "ERROR", "a FAIL verdict with exit 0");
    assert.equal((await checkPresetCheck(ctx(repo, plugin, raw(1, 1, { ...all, "preset-ids": "FAIL" })))).verdict, "FAIL");
    assert.equal((await CHECKS["preset-table"](ctx(repo, plugin, raw(0, 0, { "preset-table": "PASS" })))).verdict, "PASS");
    assert.equal((await CHECKS["preset-table"](ctx(repo, plugin, raw(0, 0, {})))).verdict, "ERROR", "empty results");
    assert.equal((await CHECKS["preset-table"](ctx(repo, plugin, raw(2, 0, { "preset-table": "PASS" })))).verdict, "ERROR", "exit 2");
  });
});

test("R1-F4 fixtures: a process exit that disagrees with the envelope is ERROR", async () => {
  await withRepo(async (repo, plugin) => {
    put(join(plugin, "test", "fixtures", "x", "expected.json"), JSON.stringify({ why: "w", runs: [{ args: ["preflight", "--json"], match: "partial", exit: 1, checks: { logger: "FAIL" } }] }));
    const run = fakeRun(() => ({ code: 1, stdout: envelope(0, { logger: "FAIL" }) }));
    assert.equal((await checkFixtures(ctx(repo, plugin, run))).verdict, "ERROR");
  });
});

test("R1-F5 home-paths: the work tree and an export select the same files, including node_modules, and scan a symlink's link text", async () => {
  await withRepo(async (repo, plugin) => {
    put(join(repo, ALLOWED.file), `${nLines(ALLOWED.line - 1)}grep -n '${HOME_PREFIX}' AGENTS.md\n`);
    put(join(plugin, "node_modules", "dep", "notes.md"), `${HOME_PREFIX}someone\n`);
    const outside = join(repo, "outside.md");
    put(outside, `${HOME_PREFIX}someone\n`);
    symlinkSync("../outside.md", join(plugin, "relative-link.md")); // link text is clean; its target is out of scope
    symlinkSync(`${HOME_PREFIX}someone/file.md`, join(plugin, "absolute-link.md")); // link text itself is the leak
    const exported = await checkHomePaths(ctx(repo, plugin));
    const init = await capture("git", ["init", "-q", repo]);
    assert.equal(init.code, 0, init.stderr);
    const worktree = await checkHomePaths(ctx(repo, plugin));
    const keys = (/** @type {{ details: string[] }} */ r) => r.details.map((d) => d.split("  ")[0]);
    assert.deepEqual(keys(exported), ["plugins/raycast-extensions/absolute-link.md:1", "plugins/raycast-extensions/node_modules/dep/notes.md:1"]);
    assert.deepEqual(keys(worktree), keys(exported));
    assert.equal(worktree.message.split(";")[0], exported.message.split(";")[0], "same file count");
  });
});

test("R1-F7 empty subjects: no SKILL.md, an empty manifest, a missing reference/ or zero scanned files is not PASS", async () => {
  await withRepo(async (repo, plugin) => {
    put(join(plugin, "budgets.json"), JSON.stringify({ skills: {} }));
    assert.notEqual(checkBudgets(ctx(repo, plugin)).verdict, "PASS", "empty manifest, no skills");
    put(join(plugin, "skills", "ship", "SKILL.md"), "x\n");
    assert.notEqual(checkMarkers(ctx(repo, plugin)).verdict, "PASS", "reference/ missing");
    put(join(plugin, "reference", "r.md"), "x\n");
    assert.equal(checkMarkers(ctx(repo, plugin)).verdict, "PASS");
  });
  await withRepo(async (repo, plugin) => {
    rmSync(plugin, { recursive: true });
    assert.notEqual((await checkHomePaths(ctx(repo, plugin))).verdict, "PASS", "no plugin directory, nothing scanned");
  });
});

test("R2-3 main: an --only selection that normalizes to nothing exits 2 with a message, never a vacuous 0", async () => {
  for (const sel of [",", " ", " , ,", ""]) {
    let err = "";
    let out = "";
    const code = await main(["--only", sel], { stdout: (s) => (out += s), stderr: (s) => (err += s) });
    assert.equal(code, 2, `--only ${JSON.stringify(sel)}`);
    assert.match(err, /--only names no check/);
    assert.equal(out, "", "no check ran");
  }
  let err = "";
  assert.equal(await main(["--only"], { stdout: () => {}, stderr: (s) => (err += s) }), 2, "--only with no value");
  assert.match(err, /--only/);
});

test("R3-3 main: --only accepts only the check ids, never an inherited property name", async () => {
  for (const sel of ["toString", "constructor", "hasOwnProperty", "budgets,__proto__"]) {
    let err = "";
    let out = "";
    const code = await main(["--only", sel], { stdout: (s) => (out += s), stderr: (s) => (err += s) });
    assert.equal(code, 2, `--only ${sel}`);
    assert.match(err, /unknown check id/);
    assert.equal(out, "", "no check ran");
  }
});
