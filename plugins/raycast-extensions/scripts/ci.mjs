#!/usr/bin/env node
// The plugin's one CI entry point. GitHub Actions, githooks/pre-push and a developer all run it:
//
//   node plugins/raycast-extensions/scripts/ci.mjs [--json] [--only <id>[,<id>…]]
//
// Every check prints one verdict line, `PASS|FAIL|ERROR <check-id> <message>`, followed by
// indented detail lines when it has any. FAIL means the check ran and found a violation; ERROR
// means it could not run or left no evidence (rx unresolvable, a script missing, unreadable
// input). Exit 0 only when every check passes; 1 when any check FAILs; 2 when any check is ERROR
// (outranks FAIL).
//
// Evidence rules: a PASS needs positive evidence, never just a zero exit. A wrapped script must end
// stdout with its completion line (COMPLETION below; it names nonzero counts). An rx --json run
// must print an envelope whose `exit` equals the process exit and is the exit its verdicts imply
// (ERROR 2, FAIL 1, else 0), and must report exactly the result ids the wrapper expects. A check
// whose subject is empty (no SKILL.md, an empty budgets.json, a missing skills/ or reference/,
// no plugin file selected, no fixtures, no tests, no matrix region) is not a PASS.
// `--json` prints the results array instead: [{ "id", "verdict", "message", "details": [string] }].
// `--only` runs the named checks alone (a developer's shortcut; CI and pre-push run them all).
//
// Roots come from this file's location: the plugin is `..`, the repository is `../../..`. So a
// copy of the repository (the pre-push export, a temp copy with a planted violation) checks
// itself, never a sibling checkout.
//
// rx is resolved ONLY by scripts/rx.mjs (the runner): RX_DEV, RX_TARBALL or the pinned npx
// package, exactly as its header says. Every rx call here is `node scripts/rx.mjs …`, so the
// runner also adds the plugin preset. rx's --json envelope is read by lib/rx-protocol.mjs
// (readEnvelope); the pass rules (exact ids, every one PASS) are CI's own, below. Zero
// dependencies; Node >= 22.12.
//
// Checks, in order (plan §5 Phase 6):
//   budgets           budgets.json maps every skills/*/SKILL.md to a line limit (`wc -l`); an
//                     overrun, a SKILL.md with no entry and an entry with no SKILL.md each FAIL.
//   markers           no `SUPERSEDED` and no `Corrected ` marker word in skills/ or reference/.
//                     Learnings are exempt: they quote history.
//   home-paths        no home-directory literal (slash, `Users`, slash) in a tracked file under
//                     the plugin, or in the repository's README.md, CLAUDE.md or CONCEPTS.md,
//                     except HOME_PATH_ALLOWLIST below (exact file:line, each with a reason; an
//                     entry whose line no longer holds the literal FAILs as stale).
//                     Selection, the same rule in both modes: every path in scope that is a
//                     regular file or a symbolic link, with no directory excluded (node_modules
//                     included) except `.git`. In a git work tree the paths come from `git
//                     ls-files --cached --others --exclude-standard` (tracked, plus untracked
//                     files not ignored, so a new file is caught before it is committed); in the
//                     pre-push export, which holds exactly one commit's files, from walking the
//                     tree. The one intended difference is that untracked files exist only in the
//                     work tree.
//                     Symlink policy: a symbolic link is scanned as its own link text (the path
//                     it stores, which is what git commits), never followed. A link whose text
//                     names a home directory is a finding; the file it points at is a subject only
//                     if it is itself in scope.
//   preset-check      `rx preset check presets/chrismessina.json`: exactly PRESET_CHECK_IDS,
//                     every one PASS.
//   preset-table      `rx preset table presets/chrismessina.json --into <f> --check` for every
//                     Markdown file under the plugin with a `<!-- rx:matrix:start -->` line:
//                     exactly one `preset-table` result each, PASS. No such file is a FAIL: the
//                     house-style matrix must exist.
//   learnings-routes  `node scripts/learnings-routes.mjs --check`.
//   rx-reference      `node scripts/rx-reference.mjs --check`: reference/rx.md matches the pin.
//   rx-calls          `node scripts/rx-calls-check.mjs --check`.
//   fixtures          every test/fixtures/<name>/expected.json, run and compared (below).
//   plugin-tests      `node --test scripts/*.test.mjs scripts/lib/*.test.mjs`. PASS needs a TAP summary in which every
//                     test ran and passed: a skip, a todo, a cancel or zero passes is a FAIL. The
//                     end-to-end tests never skip; without RX_DEV or RX_TARBALL they run the
//                     pinned npx package (E404 until it is published).
//   check-references  `bash check-references.sh` at the repository root.
//
// Fixture contract: test/fixtures/<name>/ is a small extension directory with an expected.json:
//
//   {
//     "why":  "<what preset-bound behavior this fixture pins>",
//     "runs": [
//       { "args":   ["preflight", "--root", ".", "--json"],   rx argv; must include --json
//         "match":  "partial",                                 "exact" or "partial" (below)
//         "exit":   1,                                          rx's expected exit code
//         "checks": { "logger": "FAIL", "prettierrc": "PASS" }  check id -> expected verdict
//       }
//     ]
//   }
//
// Each run executes `node scripts/rx.mjs <args>` with the fixture directory as cwd (the runner
// appends `--preset`, so fixtures exercise core plus the plugin preset). The fixture matches when
// the exit code and every listed check's verdict equal the expectation. A listed check missing
// from the output, and an id the output emits more than once, are mismatches. With "exact",
// `checks` is the complete set: any id the output emits that is not listed is a mismatch too.
// With "partial", `checks` pins a subset on purpose and other ids are not compared. Fixtures are
// expected to include FAILs: the assertion is that actual equals expected, never that everything
// passes.

import { existsSync, lstatSync, readFileSync, readdirSync, readlinkSync, realpathSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { VERDICTS, protocolExit, readEnvelope } from "./lib/rx-protocol.mjs";
import { PLUGIN_DIR, capture, nodeMeetsFloor } from "./rx.mjs";

/** The literal the home-paths check hunts, assembled so this file does not contain it. */
export const HOME_PREFIX = ["", "Users", ""].join("/");

/**
 * Exact `file:line` entries (repository-relative) allowed to hold the home-path literal.
 * @type {{ file: string, line: number, reason: string }[]}
 */
export const HOME_PATH_ALLOWLIST = [
  {
    file: "plugins/raycast-extensions/learnings/workflow-issues/ship-submission-incident-history.md",
    line: 339,
    reason: "quoted evidence: the historical AGENTS.md pass-1 grep, whose search pattern is the literal; no machine path",
  },
];

export const CHECK_IDS = ["budgets", "markers", "home-paths", "preset-check", "preset-table", "learnings-routes", "rx-reference", "rx-calls", "fixtures", "plugin-tests", "check-references"];

/**
 * @typedef {{ id: string, verdict: "PASS" | "FAIL" | "ERROR", message: string, details: string[] }} Result
 * @typedef {{ pluginDir: string, repoRoot: string, env: NodeJS.ProcessEnv, run: typeof capture }} Ctx
 */

/** @param {string} id @param {string} message @param {string[]} [details] @returns {Result} */
const pass = (id, message, details = []) => ({ id, verdict: "PASS", message, details });
/** @param {string} id @param {string} message @param {string[]} [details] @returns {Result} */
const fail = (id, message, details = []) => ({ id, verdict: "FAIL", message, details });
/** @param {string} id @param {string} message @param {string[]} [details] @returns {Result} */
const error = (id, message, details = []) => ({ id, verdict: "ERROR", message, details });

/** @param {string} s */
const lines = (s) => String(s ?? "").split(/\r?\n/).filter((l) => l.trim());

/** Line count as `wc -l` reports it: the number of newline characters. @param {string} text */
export function wcLines(text) {
  let n = 0;
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) n++;
  return n;
}

/**
 * Every regular file under dir, recursively, as paths relative to dir; with `links`, symbolic links
 * too (never followed). Skips only `.git`.
 * @param {string} dir
 * @param {{ links?: boolean }} [opts]
 * @returns {string[]}
 */
export function walk(dir, opts = {}) {
  /** @type {string[]} */
  const out = [];
  const visit = (/** @type {string} */ rel) => {
    for (const e of readdirSync(join(dir, rel), { withFileTypes: true })) {
      if (e.name === ".git") continue;
      const p = rel ? join(rel, e.name) : e.name;
      if (e.isDirectory()) visit(p);
      else if (e.isFile() || (opts.links && e.isSymbolicLink())) out.push(p);
    }
  };
  if (existsSync(dir)) visit("");
  return out.sort();
}

/** @param {Ctx} ctx @returns {Result} */
export function checkBudgets({ pluginDir }) {
  const id = "budgets";
  const file = join(pluginDir, "budgets.json");
  /** @type {unknown} */
  let doc;
  try {
    doc = JSON.parse(readFileSync(file, "utf8"));
  } catch (e) {
    return error(id, `cannot load budgets.json: ${/** @type {Error} */ (e).message}`);
  }
  const budgets = /** @type {{ skills?: unknown }} */ (doc)?.skills;
  if (!budgets || typeof budgets !== "object" || Array.isArray(budgets)) return error(id, 'budgets.json must hold { "skills": { "skills/<name>/SKILL.md": <max lines> } }');
  const entries = Object.entries(budgets);
  const bad = entries.filter(([, v]) => !Number.isInteger(v) || /** @type {number} */ (v) <= 0);
  if (bad.length) return error(id, `budgets.json limits must be positive integers: ${bad.map(([k]) => k).join(", ")}`);
  if (entries.length === 0) return error(id, "budgets.json lists no skills");
  const skillsDir = join(pluginDir, "skills");
  const onDisk = existsSync(skillsDir)
    ? readdirSync(skillsDir, { withFileTypes: true })
        .filter((e) => e.isDirectory() && existsSync(join(skillsDir, e.name, "SKILL.md")))
        .map((e) => `skills/${e.name}/SKILL.md`)
        .sort()
    : [];
  if (onDisk.length === 0) return fail(id, "no skills/*/SKILL.md under the plugin; nothing to budget");
  /** @type {string[]} */
  const problems = [];
  for (const skill of onDisk) {
    const limit = /** @type {Record<string, number>} */ (budgets)[skill];
    const count = wcLines(readFileSync(join(pluginDir, skill), "utf8"));
    if (limit === undefined) problems.push(`${skill}: ${count} lines, no budget entry`);
    else if (count > limit) problems.push(`${skill}: ${count} lines, over its budget of ${limit} by ${count - limit}`);
  }
  for (const [skill] of entries) if (!onDisk.includes(skill)) problems.push(`${skill}: budget entry with no SKILL.md`);
  if (problems.length) return fail(id, `${problems.length} budget problem(s)`, problems);
  return pass(id, `${onDisk.length} SKILL.md files within budget`);
}

const MARKER_RE = /SUPERSEDED|\bCorrected /;

/** @param {Ctx} ctx @returns {Result} */
export function checkMarkers({ pluginDir }) {
  const id = "markers";
  /** @type {string[]} */
  const hits = [];
  let files = 0;
  const empty = ["skills", "reference"].filter((top) => walk(join(pluginDir, top)).length === 0);
  if (empty.length) return fail(id, `${empty.join(" and ")} missing or empty under the plugin; nothing to scan`);
  for (const top of ["skills", "reference"]) {
    for (const rel of walk(join(pluginDir, top))) {
      files++;
      readFileSync(join(pluginDir, top, rel), "utf8")
        .split(/\r?\n/)
        .forEach((text, i) => {
          if (MARKER_RE.test(text)) hits.push(`${top}/${rel}:${i + 1}  ${text.trim()}`);
        });
    }
  }
  if (hits.length) return fail(id, `${hits.length} SUPERSEDED / Corrected marker(s) in skills/ or reference/; move the history to a learning`, hits);
  return pass(id, `no SUPERSEDED / Corrected markers in ${files} file(s) under skills/ and reference/`);
}

/**
 * The repository-relative paths the home-paths check scans: regular files and symbolic links in
 * scope (see the header for the selection and symlink policy). Directories and anything else
 * (a submodule's gitlink, a socket) are not subjects.
 * @param {Ctx} ctx
 * @returns {Promise<string[]>}
 */
export async function homePathTargets({ pluginDir, repoRoot, env, run }) {
  const pluginRel = relative(repoRoot, pluginDir);
  const scope = [pluginRel, "README.md", "CLAUDE.md", "CONCEPTS.md"];
  const top = await run("git", ["-C", repoRoot, "rev-parse", "--show-toplevel"], { env });
  const isWorkTree = top.code === 0 && realpathSync(top.stdout.trim()) === realpathSync(repoRoot);
  /** @type {string[]} */
  let files;
  if (isWorkTree) {
    const ls = await run("git", ["-C", repoRoot, "ls-files", "-z", "--cached", "--others", "--exclude-standard", "--", ...scope], { env });
    if (ls.code !== 0) throw new Error(`git ls-files failed: ${lines(ls.stderr)[0] ?? `exit ${ls.code}`}`);
    files = ls.stdout.split("\0").filter(Boolean);
  } else {
    files = [...walk(pluginDir, { links: true }).map((f) => join(pluginRel, f)), ...scope.slice(1)];
  }
  return [...new Set(files)]
    .filter((f) => {
      try {
        const st = lstatSync(join(repoRoot, f));
        return st.isFile() || st.isSymbolicLink();
      } catch {
        return false; // deleted in the work tree but still in the index: nothing on disk to scan
      }
    })
    .sort();
}

/**
 * What the home-paths check reads for a path: a regular file's bytes, or a symbolic link's own
 * link text (what git stores for it), never the file it points to.
 * @param {string} abs
 * @returns {Buffer}
 */
function homePathSubject(abs) {
  return lstatSync(abs).isSymbolicLink() ? Buffer.from(readlinkSync(abs)) : readFileSync(abs);
}

/** @param {Ctx} ctx @returns {Promise<Result>} */
export async function checkHomePaths(ctx) {
  const id = "home-paths";
  let files;
  try {
    files = await homePathTargets(ctx);
  } catch (e) {
    return error(id, /** @type {Error} */ (e).message);
  }
  const pluginRel = relative(ctx.repoRoot, ctx.pluginDir);
  if (!existsSync(ctx.pluginDir) || !files.some((f) => f.startsWith(`${pluginRel}/`))) {
    return fail(id, "no file under the plugin was selected; nothing to scan");
  }
  const allowed = new Set(HOME_PATH_ALLOWLIST.map((a) => `${a.file}:${a.line}`));
  /** @type {Set<string>} */
  const seen = new Set();
  /** @type {string[]} */
  const problems = [];
  for (const f of files) {
    const buf = homePathSubject(join(ctx.repoRoot, f));
    if (!buf.includes(HOME_PREFIX)) continue;
    buf
      .toString("utf8")
      .split(/\r?\n/)
      .forEach((text, i) => {
        if (!text.includes(HOME_PREFIX)) return;
        const key = `${f}:${i + 1}`;
        if (allowed.has(key)) seen.add(key);
        else problems.push(`${key}  ${text.trim().slice(0, 160)}`);
      });
  }
  for (const a of HOME_PATH_ALLOWLIST) {
    const key = `${a.file}:${a.line}`;
    if (!seen.has(key)) problems.push(`${key}  stale allowlist entry: the line no longer holds the literal (${a.reason})`);
  }
  if (problems.length) return fail(id, `${problems.length} home-path problem(s); use ~ or a repo-relative path`, problems);
  return pass(id, `${files.length} file(s) scanned; ${HOME_PATH_ALLOWLIST.length} allowlisted quotation(s)`);
}

/**
 * Run the runner with rx's argv.
 * @param {Ctx} ctx @param {string[]} argv @param {string} [cwd]
 */
function runRx(ctx, argv, cwd) {
  return ctx.run(process.execPath, [join(ctx.pluginDir, "scripts", "rx.mjs"), ...argv], { cwd: cwd ?? ctx.pluginDir, env: ctx.env });
}

/**
 * The ids a wrapped rx command must report, each exactly once; null when they all are.
 * @param {{ id: string }[]} results @param {string[]} want
 * @returns {string | null}
 */
function idProblem(results, want) {
  const got = results.map((x) => x.id).sort();
  const expected = [...want].sort();
  return JSON.stringify(got) === JSON.stringify(expected) ? null : `expected result ids ${expected.join(", ")}; got ${got.join(", ") || "none"}`;
}

export const PRESET_CHECK_IDS = ["preset-schema", "preset-ids", "preset-anchors", "preset-bindings", "preset-severity"];

/** @param {Ctx} ctx @returns {Promise<Result>} */
export async function checkPresetCheck(ctx) {
  const id = "preset-check";
  const r = await runRx(ctx, ["preset", "check", join(ctx.pluginDir, "presets", "chrismessina.json"), "--json"]);
  const e = readEnvelope(r);
  if ("problem" in e) return error(id, e.problem);
  const missing = idProblem(e.doc.results, PRESET_CHECK_IDS);
  if (missing) return error(id, `rx preset check: ${missing}`);
  const notPass = e.doc.results.filter((x) => x.verdict !== "PASS");
  const errored = notPass.some((x) => x.verdict === "ERROR");
  const details = notPass.map((x) => `${x.verdict}  ${x.id}  ${x.message}`);
  if (errored) return error(id, "rx preset check could not run every check", details);
  if (notPass.length) return fail(id, `${notPass.length} of ${e.doc.results.length} preset check(s) did not PASS`, details);
  return pass(id, `${e.doc.results.length} preset checks PASS`);
}

/**
 * Markdown files under the plugin holding an rx:matrix region (a start marker alone on its line).
 * @param {string} pluginDir
 * @returns {string[]} plugin-relative
 */
export function matrixFiles(pluginDir) {
  return walk(pluginDir).filter((f) => f.endsWith(".md") && readFileSync(join(pluginDir, f), "utf8").split(/\r?\n/).some((l) => l.trim() === "<!-- rx:matrix:start -->"));
}

/** @param {Ctx} ctx @returns {Promise<Result>} */
export async function checkPresetTable(ctx) {
  const id = "preset-table";
  const files = matrixFiles(ctx.pluginDir);
  if (files.length === 0) return fail(id, "no Markdown file under the plugin holds an <!-- rx:matrix:start --> region");
  /** @type {string[]} */
  const problems = [];
  let errored = false;
  for (const f of files) {
    const r = await runRx(ctx, ["preset", "table", join(ctx.pluginDir, "presets", "chrismessina.json"), "--into", join(ctx.pluginDir, f), "--check", "--json"]);
    const e = readEnvelope(r);
    if ("problem" in e) {
      errored = true;
      problems.push(`${f}: ${e.problem}`);
      continue;
    }
    const missing = idProblem(e.doc.results, ["preset-table"]);
    if (missing) {
      errored = true;
      problems.push(`${f}: rx preset table: ${missing}`);
      continue;
    }
    for (const x of e.doc.results) {
      if (x.verdict === "PASS") continue;
      if (x.verdict === "ERROR") errored = true;
      problems.push(`${f}: ${x.verdict}  ${x.id}  ${x.message}`);
    }
  }
  if (errored) return error(id, "rx preset table could not check every region", problems);
  if (problems.length) return fail(id, "a generated matrix region is out of date; run rx preset table without --check", problems);
  return pass(id, `matrix region current in ${files.join(", ")}`);
}

/**
 * The completion line each wrapped script prints last on stdout when its --check is clean. Exit 0
 * without it (no output, other text, a nonzero finding count, zero files) is no evidence: ERROR.
 * @type {Record<string, RegExp>}
 */
export const COMPLETION = {
  "learnings-routes.mjs": /^learnings-routes: [1-9]\d* skill tables current \([1-9]\d* learnings\)$/,
  "rx-reference.mjs": /^rx-reference: \S*reference\/rx\.md is current$/,
  "rx-calls-check.mjs": /^rx-calls-check: [1-9]\d* file\(s\), [1-9]\d* runner call\(s\) validated against rx \S+, 0 finding\(s\)$/,
};

/**
 * A plugin script's --check mode: exit 0 with its completion line PASS; exit 1 with output FAIL;
 * anything else ERROR.
 * @param {Ctx} ctx @param {string} id @param {string} script @param {string[]} args
 * @returns {Promise<Result>}
 */
async function scriptCheck(ctx, id, script, args) {
  const file = join(ctx.pluginDir, "scripts", script);
  if (!existsSync(file)) return error(id, `scripts/${script} is missing`);
  const r = await ctx.run(process.execPath, [file, ...args], { cwd: ctx.pluginDir, env: ctx.env });
  const out = [...lines(r.stdout), ...lines(r.stderr)];
  const last = lines(r.stdout).at(-1)?.trim() ?? "";
  if (r.code === 0) {
    if (COMPLETION[script]?.test(last)) return pass(id, last);
    return error(id, `scripts/${script} ${args.join(" ")} exited 0 without its completion line`, out.length ? out : ["no output"]);
  }
  if (r.code === 1 && out.length) return fail(id, `scripts/${script} ${args.join(" ")} found problems`, out);
  return error(id, `scripts/${script} ${args.join(" ")} exited ${r.code}${out.length ? "" : " with no output"}`, out);
}

/**
 * @typedef {{ args: string[], match: "exact" | "partial", exit: number, checks: Record<string, string> }} FixtureRun
 * @typedef {{ why: string, runs: FixtureRun[] }} Expected
 */

/**
 * Validate an expected.json document.
 * @param {unknown} doc
 * @returns {string | null} the problem, or null
 */
export function expectedProblem(doc) {
  const d = /** @type {Expected} */ (doc);
  if (!d || typeof d !== "object") return "not a JSON object";
  if (typeof d.why !== "string" || !d.why.trim()) return '"why" must be a non-empty string';
  if (!Array.isArray(d.runs) || d.runs.length === 0) return '"runs" must be a non-empty array';
  for (const [i, run] of d.runs.entries()) {
    if (!Array.isArray(run?.args) || !run.args.every((a) => typeof a === "string") || !run.args.includes("--json")) return `runs[${i}].args must be an array of strings including --json`;
    if (run.match !== "exact" && run.match !== "partial") return `runs[${i}].match must be "exact" (checks is every id the command emits) or "partial" (checks pins a subset)`;
    if (!Number.isInteger(run.exit)) return `runs[${i}].exit must be an integer`;
    if (!run.checks || typeof run.checks !== "object" || Object.keys(run.checks).length === 0) return `runs[${i}].checks must name at least one check`;
    for (const [k, v] of Object.entries(run.checks)) if (!VERDICTS.has(v)) return `runs[${i}].checks.${k} must be one of ${[...VERDICTS].join(", ")}`;
  }
  return null;
}

/**
 * Compare one run's actual output to its expectation.
 * @param {FixtureRun} want
 * @param {{ exit: number, results: { id: string, verdict: string }[] }} got
 * @returns {string[]} mismatches
 */
export function compareRun(want, got) {
  /** @type {string[]} */
  const out = [];
  if (got.exit !== want.exit) out.push(`exit ${got.exit}, expected ${want.exit}`);
  /** @type {Map<string, string>} */
  const actual = new Map();
  /** @type {Map<string, number>} */
  const seen = new Map();
  for (const r of got.results) {
    if (!actual.has(r.id)) actual.set(r.id, r.verdict);
    seen.set(r.id, (seen.get(r.id) ?? 0) + 1);
  }
  for (const [check, verdict] of Object.entries(want.checks)) {
    const v = actual.get(check);
    if (v === undefined) out.push(`${check}: absent, expected ${verdict}`);
    else if (v !== verdict) out.push(`${check}: ${v}, expected ${verdict}`);
  }
  for (const [check, n] of seen) if (n > 1) out.push(`${check}: emitted ${n} times`);
  if (want.match === "exact") for (const [check, v] of actual) if (!(check in want.checks)) out.push(`${check}: ${v}, not in the exact expectation`);
  return out;
}

/** @param {Ctx} ctx @returns {Promise<Result>} */
export async function checkFixtures(ctx) {
  const id = "fixtures";
  const root = join(ctx.pluginDir, "test", "fixtures");
  const names = existsSync(root) ? readdirSync(root, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort() : [];
  if (names.length === 0) return fail(id, "no fixtures under test/fixtures/");
  /** @type {string[]} */
  const mismatches = [];
  /** @type {string[]} */
  const errors = [];
  let runs = 0;
  for (const name of names) {
    const dir = join(root, name);
    /** @type {unknown} */
    let doc;
    try {
      doc = JSON.parse(readFileSync(join(dir, "expected.json"), "utf8"));
    } catch (e) {
      errors.push(`${name}: cannot load expected.json: ${/** @type {Error} */ (e).message}`);
      continue;
    }
    const problem = expectedProblem(doc);
    if (problem) {
      errors.push(`${name}: expected.json ${problem}`);
      continue;
    }
    for (const want of /** @type {Expected} */ (doc).runs) {
      runs++;
      const r = await runRx(ctx, want.args, dir);
      const e = readEnvelope(r);
      if ("problem" in e) {
        errors.push(`${name} (${want.args.join(" ")}): ${e.problem}`);
        continue;
      }
      for (const m of compareRun(want, { exit: r.code, results: e.doc.results })) mismatches.push(`${name} (${want.args.join(" ")}): ${m}`);
    }
  }
  if (errors.length) return error(id, `${errors.length} fixture run(s) could not be evaluated`, [...errors, ...mismatches]);
  if (mismatches.length) return fail(id, `${mismatches.length} mismatch(es) between actual and expected verdicts`, mismatches);
  return pass(id, `${names.length} fixtures, ${runs} run(s), actual verdicts equal expected`);
}

/** node --test's own TAP summary key, spelled as node prints it. */
const TAP_CANCELED_KEY = "cancel" + "led"; // us-english-ok: external output format, not prose

/** @param {Ctx} ctx @returns {Promise<Result>} */
export async function checkPluginTests(ctx) {
  const id = "plugin-tests";
  const scripts = join(ctx.pluginDir, "scripts");
  const testsIn = (/** @type {string} */ rel) => {
    const dir = join(scripts, rel);
    return existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".test.mjs")).sort().map((f) => join(dir, f)) : [];
  };
  const files = [...testsIn("."), ...testsIn("lib")];
  if (files.length === 0) return fail(id, "no scripts/*.test.mjs or scripts/lib/*.test.mjs");
  const r = await ctx.run(process.execPath, ["--test", ...files], { cwd: ctx.pluginDir, env: ctx.env });
  const out = lines(r.stdout);
  /** @param {string} key a TAP summary key as node --test prints it */
  const count = (key) => {
    const m = out.find((l) => l.startsWith(`# ${key} `))?.match(/^# \S+ (\d+)$/);
    return m ? Number(m[1]) : undefined;
  };
  const tests = count("tests");
  const passed = count("pass");
  const failed = count("fail");
  const skipped = count("skipped") ?? 0;
  const todo = count("todo") ?? 0;
  const canceled = count(TAP_CANCELED_KEY) ?? 0;
  if (tests === undefined || passed === undefined || failed === undefined) return error(id, "node --test printed no TAP summary", [...out.slice(-5), ...lines(r.stderr).slice(-5)]);
  const summary = `${files.length} files: tests ${tests}, pass ${passed}, fail ${failed}, skipped ${skipped}, todo ${todo}, canceled ${canceled}`;
  const failing = out.filter((l) => /^\s*not ok\b/.test(l));
  if (r.code !== 0 || failed > 0) return fail(id, summary, failing.length ? failing : [...out.slice(-5), ...lines(r.stderr).slice(-5)]);
  // Every expected suite must actually run: a skip, a todo, a cancel or zero passes is not evidence.
  const unrun = out.filter((l) => /^\s*ok\b.*# (SKIP|TODO)\b/.test(l));
  if (passed === 0 || passed !== tests || skipped > 0 || todo > 0 || canceled > 0) return fail(id, `${summary}; every test must run and pass`, unrun);
  return pass(id, summary);
}

/** @param {Ctx} ctx @returns {Promise<Result>} */
export async function checkReferences(ctx) {
  const id = "check-references";
  const script = join(ctx.repoRoot, "check-references.sh");
  if (!existsSync(script)) return error(id, "check-references.sh is missing at the repository root");
  const r = await ctx.run("bash", [script], { cwd: ctx.repoRoot, env: ctx.env });
  const out = lines(r.stdout);
  if (r.code === 0) {
    const last = out.at(-1) ?? "";
    return last.startsWith("PASS: ") ? pass(id, last) : error(id, "check-references.sh exited 0 without its PASS line", out.slice(-3));
  }
  const flagged = out.filter((l) => /\b(MISSING|UNLISTED|MISMATCH|ORPHAN|BROKEN)\b/.test(l));
  if (r.code === 1) return fail(id, "check-references.sh failed", flagged.length ? flagged : out.slice(-5));
  return error(id, `check-references.sh exited ${r.code}`, [...out.slice(-3), ...lines(r.stderr).slice(-3)]);
}

/** @type {Record<string, (ctx: Ctx) => Result | Promise<Result>>} */
export const CHECKS = {
  budgets: checkBudgets,
  markers: checkMarkers,
  "home-paths": checkHomePaths,
  "preset-check": checkPresetCheck,
  "preset-table": checkPresetTable,
  "learnings-routes": (ctx) => scriptCheck(ctx, "learnings-routes", "learnings-routes.mjs", ["--check"]),
  "rx-reference": (ctx) => scriptCheck(ctx, "rx-reference", "rx-reference.mjs", ["--check"]),
  "rx-calls": (ctx) => scriptCheck(ctx, "rx-calls", "rx-calls-check.mjs", ["--check"]),
  fixtures: checkFixtures,
  "plugin-tests": checkPluginTests,
  "check-references": checkReferences,
};

/** @param {Result} r */
export function formatResult(r) {
  return [`${r.verdict.padEnd(6)} ${r.id.padEnd(17)} ${r.message}`, ...r.details.map((d) => `       ${d}`)].join("\n") + "\n";
}

/** CI's exit code: rx's verdict protocol, applied to CI's own results. */
export const exitCode = protocolExit;

/**
 * @param {string[]} argv
 * @param {{ env?: NodeJS.ProcessEnv, stdout?: (s: string) => void, stderr?: (s: string) => void, pluginDir?: string, run?: typeof capture }} [io]
 * @returns {Promise<number>}
 */
export async function main(argv, io = {}) {
  const out = io.stdout ?? ((s) => process.stdout.write(s));
  const log = io.stderr ?? ((s) => process.stderr.write(s));
  let json = false;
  let only = CHECK_IDS;
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t === "--json") json = true;
    else if (t === "--only") {
      only = i + 1 < argv.length ? argv[++i].split(",").map((s) => s.trim()).filter(Boolean) : [];
      if (only.length === 0) {
        log(`ci: --only names no check; give a comma-separated list of: ${CHECK_IDS.join(", ")}\n`);
        return 2;
      }
      // Own ids only: `in` would accept inherited names such as `toString` and `constructor`.
      const unknown = only.filter((c) => !CHECK_IDS.includes(c) || !Object.hasOwn(CHECKS, c));
      if (unknown.length) {
        log(`ci: unknown check id(s) ${unknown.join(", ")}; known: ${CHECK_IDS.join(", ")}\n`);
        return 2;
      }
    } else {
      log(`ci: unknown argument ${JSON.stringify(t)}\n`);
      return 2;
    }
  }
  if (!nodeMeetsFloor(process.version)) {
    log(`ci: Node 22.12 or newer is required; this is ${process.version}\n`);
    return 2;
  }
  const pluginDir = io.pluginDir ?? PLUGIN_DIR;
  /** @type {Ctx} */
  const ctx = { pluginDir, repoRoot: resolve(pluginDir, "..", ".."), env: io.env ?? process.env, run: io.run ?? capture };
  const selected = CHECK_IDS.filter((c) => only.includes(c));
  if (selected.length === 0) {
    log(`ci: the selection runs no check; known: ${CHECK_IDS.join(", ")}\n`);
    return 2;
  }
  /** @type {Result[]} */
  const results = [];
  for (const id of selected) {
    let r;
    try {
      r = await CHECKS[id](ctx);
    } catch (e) {
      r = error(id, `check crashed: ${/** @type {Error} */ (e).message}`);
    }
    results.push(r);
    if (!json) out(formatResult(r));
  }
  if (json) out(JSON.stringify(results, null, 2) + "\n");
  return exitCode(results);
}

const invokedDirectly = (() => {
  try {
    return !!process.argv[1] && import.meta.url === pathToFileURL(realpathSync(resolve(process.argv[1]))).href;
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
      process.stderr.write(`ci: ${e?.stack ?? e}\n`);
      process.exitCode = 2;
    },
  );
}
