// Run: node --test plugins/raycast-extensions/scripts/rx-calls-check.test.mjs (RX_DEV / RX_TARBALL optional)
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main, scanHooks, scanMarkdown, scanPlugin, scanShellLine, scanTargets, shellJudge, splitSegments, validateCall, lexRunnerLine, needsNextLine, bashArgv } from "./rx-calls-check.mjs";
import { PLUGIN_DIR } from "./rx.mjs";

// Never skipped: without RX_DEV or RX_TARBALL the runner's npx mode runs the pinned version, so CI and
// pre-push exercise exactly what ships. Until that version is published, these fail with E404 by design.
const E2E = false;

/** @param {(dir: string) => Promise<void> | void} fn */
async function withTempDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), "rx-calls-"));
  try {
    await fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const G = { "--json": { type: "boolean", help: "" }, "--help": { type: "boolean", help: "" } };
const REGISTRY = /** @type {import("./rx.mjs").Registry} */ ({
  version: "0.1.0",
  commands: [
    { name: "doctor", flags: { "--root": { type: "string", help: "" }, ...G }, subcommands: {} },
    { name: "preflight", flags: { "--root": { type: "string", help: "" }, "--published": { type: "string", help: "" }, "--preset": { type: "string", help: "" }, ...G }, subcommands: {} },
    { name: "stale", flags: { "--root": { type: "string", help: "" }, ...G }, subcommands: {} },
    {
      name: "greptile",
      flags: { ...G },
      subcommands: {
        fetch: { name: "fetch", positionals: [{ name: "N", required: true, help: "" }], flags: { "--root": { type: "string", help: "" }, ...G } },
        drift: { name: "drift", flags: { "--update": { type: "boolean", help: "" }, "--dest": { type: "string", help: "" }, ...G } },
      },
    },
    {
      name: "publication",
      flags: { ...G },
      subcommands: { record: { name: "record", flags: { "--root": { type: "string", help: "" }, ...G } } },
    },
  ],
});

/** @param {string} text */
const rules = (text) => scanMarkdown(text, REGISTRY).findings.map((f) => `${f.line}:${f.rule}`);

test("validateCall: commands, subcommands, flags and runner modes against the registry", () => {
  assert.equal(validateCall(["preflight", "--root", ".", "--json"], REGISTRY), null);
  assert.equal(validateCall(["greptile", "fetch", "123", "--root", "."], REGISTRY), null);
  assert.equal(validateCall(["greptile", "--root", ".", "fetch", "123"], REGISTRY), null);
  assert.equal(validateCall(["greptile", "drift", "--update", "--dest", "<dir>"], REGISTRY), null);
  assert.equal(validateCall(["--runner-version"], REGISTRY), null);
  assert.equal(validateCall(["publication", "record", "raycast/extensions", "1", "sha"], REGISTRY), null);
  assert.equal(validateCall(["<command>", "…"], REGISTRY)?.rule, "unknown-command", "a placeholder is not a known command");
  assert.equal(validateCall(["greptile", "<subcommand>", "--root", "."], REGISTRY)?.rule, "unknown-subcommand", "a placeholder is not a known subcommand");
  assert.equal(validateCall(["bogus"], REGISTRY)?.rule, "unknown-command");
  assert.equal(validateCall([], REGISTRY)?.rule, "unknown-command");
  assert.equal(validateCall(["preflight", "--nope"], REGISTRY)?.rule, "unknown-flag");
  assert.equal(validateCall(["preflight", "--nope=1"], REGISTRY)?.rule, "unknown-flag");
  assert.equal(validateCall(["greptile"], REGISTRY)?.rule, "missing-subcommand");
  assert.equal(validateCall(["greptile", "--json"], REGISTRY)?.rule, "missing-subcommand");
  assert.equal(validateCall(["greptile", "pull"], REGISTRY)?.rule, "unknown-subcommand");
  assert.equal(validateCall(["greptile", "fetch", "1", "--dest", "x"], REGISTRY)?.rule, "unknown-flag", "a sibling subcommand's flag is not this one's");
  assert.equal(validateCall(["$CMD"], REGISTRY)?.rule, "unknown-command", "a variable is not a known command");
  assert.equal(validateCall(["--bogus-mode"], REGISTRY)?.rule, "runner-mode");
});

test("scanMarkdown: runner calls in fenced blocks are validated; valid ones produce no finding", () => {
  const md = [
    "# Skill",
    "",
    "```bash",
    'node "$PLUGIN/scripts/rx.mjs" preflight --root "$ROOT" --json',
    'node "$PLUGIN/scripts/rx.mjs" greptile fetch "$PR" --root "$ROOT"',
    'node "$PLUGIN/scripts/rx.mjs" publication record raycast/extensions "$PR" "$SHA"',
    "```",
    "",
    "~~~",
    'node "$PLUGIN/scripts/rx.mjs" stale --root "$ROOT"   # | tee log is a comment here',
    "~~~",
  ].join("\n");
  const r = scanMarkdown(md, REGISTRY);
  assert.deepEqual(r.findings, []);
  assert.equal(r.calls, 4);
});

test("scanMarkdown: wrong command, subcommand or flag in a runner call is a finding with the line", () => {
  const md = ["```", 'node "$P/scripts/rx.mjs" preflight --nope', 'node "$P/scripts/rx.mjs" greptile', 'node "$P/scripts/rx.mjs" greptile pull 1', 'node "$P/scripts/rx.mjs" bogus', 'node "$P/scripts/rx.mjs" --bogus-mode', "```"].join("\n");
  assert.deepEqual(rules(md), ["2:unknown-flag", "3:missing-subcommand", "4:unknown-subcommand", "5:unknown-command", "6:runner-mode"]);
});

test("scanMarkdown: bare rx in a fenced block is a finding in every shell position; comments and verdict lines are not", () => {
  const md = ["```bash", "rx preflight --root .", "$ rx stale", "npm run build && rx scan --forbidden f", "cd ext; rx doctor", "# rx preflight is described above", "PASS   commands  14 commands", "ERROR  args  unknown command", "echo rx", "```"].join("\n");
  assert.deepEqual(rules(md), ["2:bare-rx", "3:bare-rx", "4:bare-rx", "5:bare-rx"]);
});

test("splitSegments: a shell line splits at ; && || | and newlines, never inside quotes", () => {
  assert.deepEqual(splitSegments("a; b && c || d | e\nf"), ["a", "b", "c", "d", "e", "f"]);
  assert.deepEqual(splitSegments(`node "x; y" --root 'a && b' | tee`), [`node "x; y" --root 'a && b'`, "tee"]);
  assert.deepEqual(splitSegments("only one"), ["only one"]);
  assert.deepEqual(splitSegments("a ;; b"), ["a", "b"]);
  // Codex W3 r2 F6: a single `&` (background) separates too; `2>&1` and `&>` are redirections, not separators.
  assert.deepEqual(splitSegments("a & b"), ["a", "b"]);
  assert.deepEqual(splitSegments("node scripts/rx.mjs doctor 2>&1 & rx scan"), ["node scripts/rx.mjs doctor 2>&1", "rx scan"]);
  assert.deepEqual(splitSegments("node scripts/rx.mjs doctor &> log"), ["node scripts/rx.mjs doctor &> log"]);
});

test("scanShellLine: a line naming the runner that is not one runner call is runner-shape, and its bare rx or npx is still reported", () => {
  const rulesOf = (/** @type {string} */ line) => scanShellLine(line, REGISTRY).findings.map((f) => f.rule);
  assert.deepEqual(scanShellLine("node /plugin/scripts/rx.mjs doctor; rx preflight --root .", REGISTRY).calls, 0);
  const cases = {
    "node /plugin/scripts/rx.mjs doctor; rx preflight --root .": ["runner-shape", "bare-rx"],
    "node scripts/rx.mjs doctor && npx raycast-harness stale": ["runner-shape", "bare-npx"],
    "node scripts/rx.mjs doctor && npx @chrismessina/raycast-harness stale": ["runner-shape", "bare-npx"],
    "node scripts/rx.mjs doctor && node scripts/rx.mjs preflight": ["runner-shape"],
    // Codex W3 r2 F6: a runner path inside an argument exempts nothing.
    'rx scan "node /p/scripts/rx.mjs preflight"': ["runner-shape", "bare-rx"],
    "rx scan --note node/scripts/rx.mjs": ["runner-shape", "bare-rx"],
    "node scripts/rx.mjs doctor & rx scan": ["runner-shape", "bare-rx"],
    "node scripts/rx.mjs doctor 2>&1": ["runner-shape"],
    'RX_DEV=1 node "${CLAUDE_PLUGIN_ROOT}/scripts/rx.mjs" doctor': ["runner-shape"],
    // Codex W3 r3 #6: a bare rx inside a substitution is still run by bash, so it is still reported.
    "node /p/scripts/rx.mjs stale --root $(rx preflight)": ["runner-shape", "bare-rx"],
    "node /p/scripts/rx.mjs stale --root `rx preflight`": ["runner-shape", "bare-rx"],
    "node /p/scripts/rx.mjs stale --root <(rx preflight)": ["runner-shape", "bare-rx"],
    'node /p/scripts/rx.mjs stale --root "$(npx raycast-harness stale)"': ["runner-shape", "bare-npx"],
    "node /p/scripts/rx.mjs stale --root $(pwd)": ["runner-shape"],
    'node "$P/scripts/rx.mjs" stale --root "$ROOT" | tee log': ["runner-shape"],
    "echo rx | node scripts/rx.mjs doctor": ["runner-shape"],
  };
  for (const [line, expected] of Object.entries(cases)) assert.deepEqual(rulesOf(line), expected, line);
  // In the shape: a `$ ` prompt, and single quotes, whose contents are data.
  assert.deepEqual(scanShellLine("$ node scripts/rx.mjs doctor", REGISTRY), { findings: [], calls: 1 });
  assert.deepEqual(scanShellLine("node /p/scripts/rx.mjs stale --root '`rx preflight`'", REGISTRY), { findings: [], calls: 1 });
  assert.deepEqual(scanShellLine(`node /p/scripts/rx.mjs stale --root '$(rx preflight)'`, REGISTRY), { findings: [], calls: 1 });
  // A line without the runner: bare calls only, in every segment and substitution.
  assert.deepEqual(rulesOf("echo $(rx scan --root .)"), ["bare-rx"]);
  assert.deepEqual(rulesOf(`echo "$(printf ')'; rx preflight)"`), ["bare-rx"]);
});

test("scanMarkdown: fenced lines and inline spans naming the runner follow the same shape rule", () => {
  assert.deepEqual(rules("```\nnode /plugin/scripts/rx.mjs doctor; rx preflight --root .\n```\n"), ["2:runner-shape", "2:bare-rx"]);
  assert.equal(scanMarkdown("```\nnode /plugin/scripts/rx.mjs doctor; rx preflight --root .\n```\n", REGISTRY).calls, 0);
  assert.deepEqual(rules("Run `node scripts/rx.mjs doctor; rx preflight --root .` first.\n"), ["1:runner-shape", "1:bare-rx"]);
  assert.deepEqual(rules("```\nnode scripts/rx.mjs doctor && npx raycast-harness stale\n```\n"), ["2:runner-shape", "2:bare-npx"]);
  // A single-word span names the runner file and is not a call.
  assert.deepEqual(scanMarkdown('The runner is `"<plugin>/scripts/rx.mjs"` and `scripts/rx.mjs`.\n', REGISTRY), { findings: [], calls: 0 });
  // A span crossing a line break inside one paragraph is a call that does not fit on one line.
  assert.deepEqual(rules('Run `node "<plugin>/scripts/rx.mjs"\n<command> [--flags]` for each step.\n'), ["1:runner-shape"]);
  // A double-backtick span is read like a single one; a blank line ends a paragraph and any span.
  assert.deepEqual(rules('Run ``node "$P/scripts/rx.mjs" preflight --nope`` now.\n'), ["1:unknown-flag"]);
  assert.deepEqual(rules('A stray ` here.\n\nThen `node "$P/scripts/rx.mjs" preflight --nope`.\n'), ["3:unknown-flag"]);
});

test("scanHooks: a shell-form hook entry follows the runner shape too", () => {
  const mixed = hooksDoc([{ type: "command", command: "node /plugin/scripts/rx.mjs guard; rx preflight --root ." }]);
  const r = scanHooks(mixed, HOOK_REGISTRY);
  assert.deepEqual(r.findings.map((f) => f.rule), ["runner-shape", "bare-rx"]);
  assert.equal(r.calls, 0);
  assert.deepEqual(scanHooks(hooksDoc([{ type: "command", command: "node scripts/rx.mjs guard && node scripts/rx.mjs doctor" }]), HOOK_REGISTRY).findings.map((f) => f.rule), ["runner-shape"]);
});

test("scanMarkdown: `npx raycast-harness` anywhere is a finding", () => {
  assert.deepEqual(rules("Run `npx raycast-harness preflight`.\n\n```\nnpx -y raycast-harness@0.1.0 doctor\n```\n"), ["1:bare-npx", "4:bare-npx"]);
  assert.deepEqual(rules("Run `npx @chrismessina/raycast-harness preflight`.\n\n```\nnpx -y @chrismessina/raycast-harness@0.1.2 doctor\n```\n"), ["1:bare-npx", "4:bare-npx"]);
  assert.deepEqual(rules("The npm package is named raycast-harness.\n"), []);
  assert.deepEqual(rules("The npm package is named @chrismessina/raycast-harness.\n"), []);
});

test("scanMarkdown: inline spans — a command NAME is allowed, an INVOCATION is not", () => {
  assert.deepEqual(rules("`rx preflight`: `readme-assets` must pass.\n"), []);
  assert.deepEqual(rules("Run `rx greptile fetch` next.\n"), []);
  assert.deepEqual(rules("Then `rx preflight --root .` and read it.\n"), ["1:bare-rx"]);
  assert.deepEqual(rules("Then `rx preflight --json`.\n"), ["1:bare-rx"]);
  assert.deepEqual(rules("Then `rx greptile fetch 123`.\n"), ["1:bare-rx"]);
  assert.deepEqual(rules("Prose that says rx preflight without a code span is prose.\n"), []);
  assert.deepEqual(rules("`node \"<plugin>/scripts/rx.mjs\" preflight --root \"$DIR\"` is the call.\n"), []);
  assert.deepEqual(rules("`node \"<plugin>/scripts/rx.mjs\" preflight --nope` is wrong.\n"), ["1:unknown-flag"]);
});

/** @param {object[]} entries hook entries under hooks.PreToolUse[0].hooks @param {string} [description] */
const hooksDoc = (entries, description) => JSON.stringify({ ...(description ? { description } : {}), hooks: { PreToolUse: [{ matcher: "Bash", hooks: entries }] } }, null, 2);
const HOOK_REGISTRY = /** @type {import("./rx.mjs").Registry} */ ({ ...REGISTRY, commands: [...REGISTRY.commands, { name: "guard", flags: G, subcommands: {} }] });

test("scanHooks: shell-form and exec-form hook entries are validated against the registry", () => {
  const shell = hooksDoc([{ type: "command", command: 'node "${CLAUDE_PLUGIN_ROOT}/scripts/rx.mjs" guard' }]);
  assert.deepEqual(scanHooks(shell, HOOK_REGISTRY), { findings: [], calls: 1 });
  const exec = hooksDoc([{ type: "command", command: "node", args: ["${CLAUDE_PLUGIN_ROOT}/scripts/rx.mjs", "guard"], timeout: 120 }]);
  assert.deepEqual(scanHooks(exec, HOOK_REGISTRY), { findings: [], calls: 1 });
  const execSub = hooksDoc([{ type: "command", command: "node", args: ["${CLAUDE_PLUGIN_ROOT}/scripts/rx.mjs", "greptile", "drift", "--json"] }]);
  assert.deepEqual(scanHooks(execSub, HOOK_REGISTRY), { findings: [], calls: 1 });
});

test("scanHooks: exec-form args naming an unknown command, subcommand or flag are findings; the vector is not shell-parsed", () => {
  const unknownCommand = hooksDoc([{ type: "command", command: "node", args: ["${CLAUDE_PLUGIN_ROOT}/scripts/rx.mjs", "gates"] }]);
  assert.deepEqual(scanHooks(unknownCommand, HOOK_REGISTRY).findings.map((f) => `${f.line}:${f.rule}`), ["11:unknown-command"], "the line of the runner path inside args[]");
  const unknownFlag = hooksDoc([{ type: "command", command: "node", args: ["${CLAUDE_PLUGIN_ROOT}/scripts/rx.mjs", "guard", "--strict"] }]);
  assert.deepEqual(scanHooks(unknownFlag, HOOK_REGISTRY).findings.map((f) => f.rule), ["unknown-flag"]);
  const missingSub = hooksDoc([{ type: "command", command: "node", args: ["${CLAUDE_PLUGIN_ROOT}/scripts/rx.mjs", "greptile"] }]);
  assert.deepEqual(scanHooks(missingSub, HOOK_REGISTRY).findings.map((f) => f.rule), ["missing-subcommand"]);
  // One argument holding a space is one token in exec form (no shell splitting): "guard --json" is not a flag.
  const spaced = hooksDoc([{ type: "command", command: "node", args: ["${CLAUDE_PLUGIN_ROOT}/scripts/rx.mjs", "guard --json"] }]);
  assert.deepEqual(scanHooks(spaced, HOOK_REGISTRY).findings.map((f) => f.rule), ["unknown-command"]);
  // Exec form that bypasses the runner.
  assert.deepEqual(scanHooks(hooksDoc([{ type: "command", command: "rx", args: ["guard"] }]), HOOK_REGISTRY).findings.map((f) => f.rule), ["bare-rx"]);
  assert.deepEqual(scanHooks(hooksDoc([{ type: "command", command: "npx", args: ["-y", "raycast-harness@0.1.0", "guard"] }]), HOOK_REGISTRY).findings.map((f) => f.rule), ["bare-npx"]);
});

test("scanHooks: a description mentioning `rx gates` is not a finding; a shell-form entry running bare `rx guard` still is", () => {
  const prose = hooksDoc([{ type: "command", command: "node", args: ["${CLAUDE_PLUGIN_ROOT}/scripts/rx.mjs", "guard"] }], "rx guard: allowed only behind a current `rx gates` receipt; never `npx raycast-harness` directly");
  assert.deepEqual(scanHooks(prose, HOOK_REGISTRY), { findings: [], calls: 1 });
  const bare = hooksDoc([{ type: "command", command: "rx guard" }, { type: "command", command: "npx raycast-harness guard" }, { type: "command", command: 'node "$P/scripts/rx.mjs" preflight --nope' }, { type: "prompt", command: "rx guard" }]);
  assert.deepEqual(scanHooks(bare, HOOK_REGISTRY).findings.map((f) => f.rule), ["bare-rx", "bare-npx", "unknown-flag"]);
  // Strings outside hook entries (matcher, event names, other top-level keys) are never scanned.
  assert.deepEqual(scanHooks(JSON.stringify({ hooks: { PreToolUse: [{ matcher: "rx guard", hooks: [] }] }, notes: ["rx stale"] }), HOOK_REGISTRY), { findings: [], calls: 0 });
  assert.equal(scanHooks("{nope", HOOK_REGISTRY).findings[0]?.rule, "invalid-json");
});

test("scanHooks: the plugin's checked-in hooks/hooks.json validates against a registry that has guard", () => {
  const file = join(PLUGIN_DIR, "hooks", "hooks.json");
  if (!existsSync(file)) return; // agent G's file; absent until wired
  const r = scanHooks(readFileSync(file, "utf8"), HOOK_REGISTRY);
  assert.deepEqual(r.findings, []);
  assert.equal(r.calls, 1);
});

test("scanTargets and scanPlugin: skills/**/SKILL.md, reference/*.md minus rx.md, hooks/hooks.json when present", async () => {
  await withTempDir((dir) => {
    mkdirSync(join(dir, "skills", "ship"), { recursive: true });
    mkdirSync(join(dir, "skills", "develop"), { recursive: true });
    mkdirSync(join(dir, "reference"), { recursive: true });
    writeFileSync(join(dir, "skills", "ship", "SKILL.md"), "```\nrx stale\n```\n");
    writeFileSync(join(dir, "skills", "develop", "SKILL.md"), "`rx preflight` is fine.\n");
    writeFileSync(join(dir, "skills", "notes.md"), "```\nrx stale\n```\n"); // not a SKILL.md: not scanned
    writeFileSync(join(dir, "reference", "house-style.md"), "`npx raycast-harness` no.\n");
    writeFileSync(join(dir, "reference", "rx.md"), "Synopsis: `rx preflight --root <dir>`\n"); // generated: excluded
    assert.deepEqual(
      scanTargets(dir).map((f) => f.slice(dir.length + 1)),
      ["reference/house-style.md", "skills/develop/SKILL.md", "skills/ship/SKILL.md"],
    );
    mkdirSync(join(dir, "hooks"));
    writeFileSync(join(dir, "hooks", "hooks.json"), JSON.stringify({ hooks: { PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "rx guard" }] }] } }));
    const r = scanPlugin(dir, REGISTRY);
    assert.deepEqual(
      r.findings.map((f) => `${f.file}:${f.line}:${f.rule}`),
      ["hooks/hooks.json:1:bare-rx", "reference/house-style.md:1:bare-npx", "skills/ship/SKILL.md:2:bare-rx"],
    );
    assert.equal(r.files.length, 4);
  });
});

test("main: prints findings; --check exits 1 on any finding, 0 when clean; unknown argument exits 2", async () => {
  await withTempDir(async (dir) => {
    const registry = join(dir, "registry.json");
    writeFileSync(registry, JSON.stringify({ exit: 0, version: "0.1.0", data: { commands: REGISTRY.commands }, results: [{ id: "commands", verdict: "PASS", message: "" }] }));
    const plugin = join(dir, "plugin");
    mkdirSync(join(plugin, "skills", "ship"), { recursive: true });
    writeFileSync(join(plugin, "skills", "ship", "SKILL.md"), "```\nrx stale\nnode \"$P/scripts/rx.mjs\" stale --root .\n```\n");
    /** @type {string[]} */
    const stdout = [];
    const io = { stdout: (/** @type {string} */ s) => stdout.push(s), stderr: () => {} };
    assert.equal(await main(["--plugin", plugin, "--registry", registry], io), 0, "without --check: report only");
    assert.match(stdout.join(""), /skills\/ship\/SKILL\.md:2 {2}bare-rx/);
    assert.match(stdout.join(""), /1 file\(s\), 1 runner call\(s\) validated against rx 0\.1\.0, 1 finding\(s\)/);
    assert.equal(await main(["--check", "--plugin", plugin, "--registry", registry], io), 1);
    writeFileSync(join(plugin, "skills", "ship", "SKILL.md"), "```\nnode \"$P/scripts/rx.mjs\" stale --root .\n```\n");
    assert.equal(await main(["--check", "--plugin", plugin, "--registry", registry], io), 0);
    assert.equal(await main(["--wat"], io), 2);
  });
});

test("e2e: the plugin as checked in has no violation against the rx the runner resolves", { skip: E2E }, async () => {
  await withTempDir(async (cache) => {
    /** @type {string[]} */
    const stdout = [];
    const code = await main(["--check", "--plugin", PLUGIN_DIR], { env: { ...process.env, XDG_CACHE_HOME: cache }, stdout: (s) => stdout.push(s), stderr: (s) => stdout.push(s) });
    assert.equal(code, 0, stdout.join(""));
  });
});

test("a runner call continued onto the next line with a trailing backslash is a finding: it must fit on one line", () => {
  // Fenced block: the flag on the continuation line would otherwise escape validation.
  const md = ["```bash", 'node "$P/scripts/rx.mjs" preflight --root "$ROOT" \\', "  --nope", 'node "$P/scripts/rx.mjs" preflight --root "$ROOT" --json | \\', "  tee log", "```"].join("\n");
  // Round 2 (structural rule): a line holding a runner call that ends on a trailing `|` or `\\` is incomplete too.
  assert.deepEqual(rules(md), ["2:runner-shape", "4:runner-shape"]);
  // A shell line holding the escaped newline itself (a hooks.json shell-form command).
  assert.deepEqual(scanShellLine('node "$P/scripts/rx.mjs" stale \\\n  --root .', REGISTRY).findings.map((f) => f.rule), ["runner-shape"]);
  assert.deepEqual(scanShellLine("node /p/scripts/rx.mjs stale --root . && echo \\", REGISTRY).findings.map((f) => f.rule), ["runner-shape"]);
  // A1: no backslash is in the runner shape, not even an escaped one.
  assert.deepEqual(scanShellLine("node /p/scripts/rx.mjs stale --root a\\\\", REGISTRY).findings.map((f) => f.rule), ["runner-shape"]);
});

test("R1-F2 a runner call spanning physical lines is a finding wherever it splits: before the runner path, or inside a quoted argument", () => {
  // Codex probe 1: the split falls between `node` and the runner path. Round 3: lines are judged one
  // at a time, so the finding is on the line that starts with the runner path (3), not on the
  // joined command's first line (2).
  assert.deepEqual(rules(["```sh", "node \\", "  /p/scripts/rx.mjs preflight --nope", "```"].join("\n")), ["3:runner-shape"]);
  // Codex probe 2: a quoted argument continues onto the next line.
  assert.deepEqual(rules(["```sh", 'node /p/scripts/rx.mjs preflight --root "first', 'second" --nope', "```"].join("\n")), ["2:runner-shape"]);
  // Round 3: line 3 holds the runner call and, read alone, closes a quote it never opened, so bash
  // rejects it and the call is a runner-shape (it was 2:unknown-flag when lines were joined).
  // The next command is its own and stays clean.
  assert.deepEqual(rules(["```sh", "echo 'a", "b' && node /p/scripts/rx.mjs stale --nope", "node /p/scripts/rx.mjs stale --json", "```"].join("\n")), ["3:runner-shape"]);
  // Shell form (hooks.json): a quoted newline inside a runner call.
  assert.deepEqual(scanShellLine('node /p/scripts/rx.mjs stale --root "a\nb"', REGISTRY).findings.map((f) => f.rule), ["runner-shape"]);
  // Round 3: an env prefix on the line above is not part of the runner's argv. The runner line is
  // judged on its own, bash parses it as complete, and its command and flags are all on it, so
  // nothing escapes validation: no finding (round 1 flagged it while lines were joined).
  assert.deepEqual(rules(["```sh", "RX_DEV=x \\", "  node /p/scripts/rx.mjs stale", "```"].join("\n")), []);
});

test("R1-F8 a backslash at the end of a shell comment is not a continuation", () => {
  assert.deepEqual(scanShellLine("node /p/scripts/rx.mjs stale --root . # see C:\\", REGISTRY), { findings: [], calls: 1 });
  assert.deepEqual(rules(["```sh", "node /p/scripts/rx.mjs stale --root . # trailing \\", "node /p/scripts/rx.mjs preflight --json", "```"].join("\n")), []);
  // A `#` inside quotes or a word is not a comment.
  assert.deepEqual(scanShellLine('node /p/scripts/rx.mjs stale --root "a # b" \\', REGISTRY).findings.map((f) => f.rule), ["runner-shape"]);
  // A comment's flag-like words are not validated as flags.
  assert.deepEqual(scanShellLine("node /p/scripts/rx.mjs stale --root . # --not-a-flag", REGISTRY), { findings: [], calls: 1 });
});

test("R1-F7 calls-check: a plugin with nothing to scan is exit 2, not a clean pass", async () => {
  await withTempDir(async (dir) => {
    const reg = join(dir, "registry.json");
    writeFileSync(reg, JSON.stringify({ command: "commands", version: "0.1.0", exit: 0, data: { commands: REGISTRY.commands }, results: [] }));
    /** @type {string[]} */
    const out = [];
    const code = await main(["--check", "--plugin", join(dir, "empty"), "--registry", reg], { stdout: (s) => out.push(s), stderr: (s) => out.push(s) });
    assert.equal(code, 2, out.join(""));
  });
});

test("R2-1 a physical line holding a runner call that ends inside an open construct or on a trailing operator is a multiline-call", () => {
  const fence = (/** @type {string[]} */ body) => rules(["```sh", ...body, "```"].join("\n"));
  // Codex round-2 probe: an unquoted multiline command substitution.
  assert.deepEqual(fence(["node /p/scripts/rx.mjs preflight --root $(", "  pwd", ") --nope"]), ["2:runner-shape"]);
  const cases = {
    "single quote": ["node /p/scripts/rx.mjs stale --root 'a", "b' --nope"],
    "double quote": ['node /p/scripts/rx.mjs stale --root "a', 'b" --nope'],
    "$(": ["node /p/scripts/rx.mjs stale --root $(", "pwd) --nope"],
    backtick: ["node /p/scripts/rx.mjs stale --root `", "pwd` --nope"],
    "(": ["( node /p/scripts/rx.mjs stale --root .", ") --nope"],
    "{": ["{ node /p/scripts/rx.mjs stale --root .", "} --nope"],
    "${": ["node /p/scripts/rx.mjs stale --root ${", "HOME} --nope"],
    "[[": ["[[ -n x ]] && node /p/scripts/rx.mjs stale --root . && [[", "-n y ]]"],
    heredoc: ["node /p/scripts/rx.mjs stale --root . <<EOF", "--nope", "EOF"],
    "trailing backslash": ["node /p/scripts/rx.mjs stale --root . \\", "  --nope"],
    "trailing &&": ["node /p/scripts/rx.mjs stale --root . &&", "  echo done"],
    "trailing ||": ["node /p/scripts/rx.mjs stale --root . ||", "  echo failed"],
    "trailing |": ["node /p/scripts/rx.mjs stale --root . --json |", "  tee log"],
  };
  for (const [name, body] of Object.entries(cases)) assert.deepEqual(fence(body), ["2:runner-shape"], name);
  // Complete lines stay complete: balanced constructs on one line, a closed heredoc elsewhere, a comment.
  assert.deepEqual(fence(["node /p/scripts/rx.mjs stale --root \"$PWD\" --json # (unbalanced in a comment", "node /p/scripts/rx.mjs stale --root \"${HOME}\" --json"]), []);
  // Round 3: no hand-written heredoc tracking, so a body line is read as a line of its own; a bare
  // `rx` there is reported like any other. The runner call after the heredoc is still clean.
  assert.deepEqual(fence(["cat <<EOF", "rx preflight is data here", "EOF", "node /p/scripts/rx.mjs stale --json"]), ["3:bare-rx"]);
  // A hooks.json shell-form string with the same probe.
  assert.deepEqual(scanShellLine("node /p/scripts/rx.mjs preflight --root $(\n pwd\n) --nope", REGISTRY).findings.map((f) => f.rule), ["runner-shape"]);
});

test("R3-1 bash decides completeness: the round-3 probes", () => {
  const fence = (/** @type {string[]} */ body) => rules(["```sh", ...body, "```"].join("\n"));
  // Must be flagged: a quoted substitution holding its own multiline quoted argument, and heredocs
  // whose delimiter is numeric or escaped.
  assert.deepEqual(fence(['node /p/scripts/rx.mjs preflight --root "$(printf "x', ' y")" --nope']), ["2:runner-shape"]);
  assert.deepEqual(fence(["node /p/scripts/rx.mjs preflight --root . <<123", "--nope", "123"]), ["2:runner-shape"]);
  assert.deepEqual(fence(["node /p/scripts/rx.mjs preflight --root . <<\\EOF", "--nope", "EOF"]), ["2:runner-shape"]);
  // A1: valid one-line shell outside the runner shape (a here-string, an arithmetic shift, an
  // escaped pipe) is refused whole; round 3 accepted it.
  assert.deepEqual(fence(["node /p/scripts/rx.mjs preflight --root . <<< value"]), ["2:runner-shape"]);
  assert.deepEqual(fence(["node /p/scripts/rx.mjs preflight --root $((1 << X))"]), ["2:runner-shape"]);
  assert.deepEqual(fence(["node /p/scripts/rx.mjs preflight --root a\\|"]), ["2:runner-shape"]);
});

test("R3-1 bash that cannot be spawned is an error (exit 2), never a silent pass", async () => {
  const saved = shellJudge.bin;
  shellJudge.bin = "/nonexistent/bash-for-rx-calls-check";
  try {
    assert.throws(() => scanMarkdown(["```sh", "node /p/scripts/rx.mjs stale --json", "```"].join("\n"), REGISTRY), /cannot run bash/);
    await withTempDir(async (dir) => {
      const reg = join(dir, "registry.json");
      writeFileSync(reg, JSON.stringify({ command: "commands", version: "0.1.0", exit: 0, data: { commands: REGISTRY.commands }, results: [{ id: "commands", verdict: "PASS", message: "" }] }));
      mkdirSync(join(dir, "plugin", "skills", "x"), { recursive: true });
      writeFileSync(join(dir, "plugin", "skills", "x", "SKILL.md"), ["```sh", "node /p/scripts/rx.mjs stale --json", "```"].join("\n"));
      /** @type {string[]} */
      const out = [];
      assert.equal(await main(["--check", "--plugin", join(dir, "plugin"), "--registry", reg], { stdout: (s) => out.push(s), stderr: (s) => out.push(s) }), 2, out.join(""));
      assert.match(out.join(""), /cannot run bash/);
    });
  } finally {
    shellJudge.bin = saved;
  }
});

test("R4-1 the line goes to bash as written: no placeholder rewrite can hide an open quote or a redirection", () => {
  const fence = (/** @type {string[]} */ body) => rules(["```sh", ...body, "```"].join("\n"));
  // Codex round-4 probe: rewriting `<input"value >` to a word erased the open quote.
  assert.deepEqual(fence(['node /p/scripts/rx.mjs preflight --root . <input"value >', 'more" --nope']), ["2:runner-shape"]);
  // A `<placeholder>` on a runner line is a redirection to bash, so the line is rejected; a shell value passes.
  assert.deepEqual(fence(["node /p/scripts/rx.mjs preflight --root <dir>"]), ["2:runner-shape"]);
  assert.deepEqual(fence(['node /p/scripts/rx.mjs preflight --root "$DIR"']), []);
});

test("R4-2 a continued line whose first word is a quoted runner path with a space in it is the tail of a call", () => {
  const fence = (/** @type {string[]} */ body) => rules(["```sh", ...body, "```"].join("\n"));
  assert.deepEqual(fence(["node \\", '  "/p with space/scripts/rx.mjs" preflight --nope']), ["3:runner-shape"]);
  assert.deepEqual(fence(["node \\", "  '/p with space/scripts/rx.mjs' preflight --nope"]), ["3:runner-shape"]);
});

test("R5-1 runner-word recognition: an escaped quote inside a quoted path, and a `$ ` prompt on a tail line", () => {
  const fence = (/** @type {string[]} */ body) => rules(["```sh", ...body, "```"].join("\n"));
  assert.deepEqual(fence(["node \\", '  "/p \\"with space/scripts/rx.mjs" preflight --nope']), ["3:runner-shape"]);
  assert.deepEqual(fence(["$ node \\", '$ "/p with space/scripts/rx.mjs" preflight --nope']), ["3:runner-shape"]);
  assert.deepEqual(fence(['node "/p \\"with space/scripts/rx.mjs" preflight --nope']), ["2:runner-shape"], "A1: no backslash inside quotes");
});

test("R5-2 a redirection on a runner line is outside the shape, so no later flag escapes", () => {
  const fence = (/** @type {string[]} */ body) => rules(["```sh", ...body, "```"].join("\n"));
  assert.deepEqual(fence(["node /p/scripts/rx.mjs stale --root <your dir> --json --nope"]), ["2:runner-shape"]);
});

test("R5-3 a tail line, and an assignment wrapping a call, are runner-shape", () => {
  assert.deepEqual(scanShellLine('node \\\n  "/p with space/scripts/rx.mjs" preflight --nope', REGISTRY).findings.map((x) => x.rule), ["runner-shape"]);
  assert.deepEqual(scanShellLine('PUB_DIR="$(node "<plugin>/scripts/rx.mjs" stale --json | jq -r .x)"', REGISTRY).findings.map((x) => x.rule), ["runner-shape"]);
});

test("R6 every round-6 probe is runner-shape: no splitter, prefix or redirection reader sees a runner line", () => {
  const rulesOf = (/** @type {string} */ line) => scanShellLine(line, REGISTRY).findings.map((f) => f.rule);
  for (const line of [
    "node /p/scripts/rx.mjs stale >| out --nope",
    "node /p/scripts/rx.mjs stale <&- --nope",
    "node /p/scripts/rx.mjs stale 2<&1 --nope",
    'A="x y" node /p/scripts/rx.mjs stale --nope',
    'A="x node /p/scripts/rx.mjs stale --nope"',
    'node "/p \\"with; space/scripts/rx.mjs" stale --nope',
    "node /p/scripts/rx.mjs stale >out> --nope",
    "node /p/scripts/rx.mjs &>out stale --json",
  ]) assert.deepEqual(rulesOf(line), ["runner-shape"], line);
});

test("A1 lexRunnerLine: the whole line is consumed, quotes are removed, names stay literal", () => {
  assert.deepEqual(lexRunnerLine('$ node "${ROOT}/scripts/rx.mjs" preflight --root "$DIR" \'x; y\'   # c'), { ok: true, argv: ["preflight", "--root", "$DIR", "x; y"], runner: "$ROOT/scripts/rx.mjs", shell: 'node "${ROOT}/scripts/rx.mjs" preflight --root "$DIR" \'x; y\'   # c' });
  for (const [line, why] of [
    ["node /p/scripts/rx.mjs stale --root=\"$X\"", /touches the word before it/],
    ["node /p/scripts/rx.mjs stale#c", /touches/],
    ['node /p/scripts/rx.mjs stale "$(pwd)"', /\$NAME/],
    ["node /p/scripts/rx.mjs stale ~/x", /outside the runner shape/],
    ["nodejs /p/scripts/rx.mjs stale", /must be followed by a space/],
    ["node /p/scripts/rx.mjsx stale", /runner path/],
    ["node /p/scripts/xrx.mjs stale", /runner path/],
    ["node 'unclosed", /unclosed/],
    ["node /p/scripts/rx.mjs stale \"open", /unclosed/],
    ["$node /p/scripts/rx.mjs stale", /prompt/],
  ]) {
    const r = lexRunnerLine(/** @type {string} */ (line));
    assert.equal(r.ok, false, String(line));
    if (!r.ok) assert.match(r.reason, /** @type {RegExp} */ (why), String(line));
  }
  // A quoted flag or command is still a flag or command; a variable command is not a known command.
  assert.deepEqual(scanShellLine('node /p/scripts/rx.mjs stale "--nope"', REGISTRY).findings.map((f) => f.rule), ["unknown-flag"]);
  assert.deepEqual(scanShellLine('node /p/scripts/rx.mjs "$CMD" --json', REGISTRY).findings.map((f) => f.rule), ["unknown-command"]);
  assert.deepEqual(scanShellLine("node /p/scripts/rx.mjs <command> [--flags]", REGISTRY).findings.map((f) => f.rule), ["runner-shape"]);
  // Operators inside quotes are data; a comment cannot hide an earlier argument.
  assert.deepEqual(scanShellLine('node /p/scripts/rx.mjs stale --root "a; b | c > d" # --nope', REGISTRY), { findings: [], calls: 1 });
  assert.deepEqual(scanShellLine("node /p/scripts/rx.mjs stale --nope # fine", REGISTRY).findings.map((f) => f.rule), ["unknown-flag"]);
  // bash still judges what the lexer accepts.
  assert.equal(needsNextLine("node /p/scripts/rx.mjs stale --json"), false);
  assert.equal(needsNextLine("node /p/scripts/rx.mjs stale \\"), true);
});

test("R7 prose extraction is fail-closed; fences need real delimiters; a path-only span holds no substitution; subcommands are own properties", () => {
  // P2-1: a quoted substitution is not a path-only span.
  assert.deepEqual(rules('Run `"$(node /p/scripts/rx.mjs stale --nope)"`.\n'), ["1:runner-shape"]);
  // P2-2: list items, an escaped backtick, headings and table rows each keep their own inline context.
  assert.deepEqual(rules("- A stray ` here.\n- Run `node /p/scripts/rx.mjs stale --nope`.\n"), ["2:unknown-flag"]);
  assert.deepEqual(rules("A literal \\` here, then `node /p/scripts/rx.mjs stale --nope`.\n"), ["1:unknown-flag"]);
  assert.deepEqual(rules("# A ` heading\n| `node /p/scripts/rx.mjs stale --nope` |\n"), ["2:unknown-flag"]);
  // A stray backtick earlier on the same line (here a table cell) pairs with the call's opener; the
  // marker is then outside every span read, so the line fails closed rather than passing.
  assert.deepEqual(rules("| a ` | `node /p/scripts/rx.mjs stale --nope` |\n"), ["1:runner-shape"]);
  // A marker the span reader cannot account for is a finding, never a silent skip.
  assert.deepEqual(rules("Stray ` then `node /p/scripts/rx.mjs stale --nope` here.\n"), ["1:runner-shape"]);
  assert.deepEqual(rules("The runner is scripts/rx.mjs in prose.\n"), ["1:runner-shape"]);
  // P2-3: a three-backtick inline span is not a fence opener; a mismatched delimiter inside a fence is content.
  assert.deepEqual(rules("```node /p/scripts/rx.mjs stale --nope```\n"), ["1:unknown-flag"]);
  assert.deepEqual(rules("~~~bash\n``` node /p/scripts/rx.mjs stale --nope\n~~~\n"), ["2:runner-shape"]);
  assert.deepEqual(rules("````\nnode /p/scripts/rx.mjs stale --nope\n```\n````\n"), ["2:unknown-flag"]);
  // P2-4: inherited object properties are not subcommands.
  for (const sub of ["toString", "constructor", "__proto__"]) assert.equal(validateCall(["greptile", sub], REGISTRY)?.rule, "unknown-subcommand", sub);
});

test("R8 fail-closed edges: fence info strings, exemptions bash would run, span trimming, exec vectors, duplicate keys", () => {
  assert.deepEqual(rules("```bash node /p/scripts/rx.mjs stale --nope\n```\n"), ["1:runner-shape"]);
  assert.deepEqual(rules("~~~ node /p/scripts/rx.mjs stale --nope\n~~~\n"), ["1:runner-shape"]);
  assert.deepEqual(rules("```bash\nPASS=1 node /p/scripts/rx.mjs stale --nope\nERROR; node /p/scripts/rx.mjs stale --nope\n```\n"), ["2:runner-shape", "3:runner-shape"]);
  assert.deepEqual(rules("```bash\nPASS   stale  fine\n# node /p/scripts/rx.mjs stale --nope is a comment\n```\n"), []);
  assert.deepEqual(rules("```bash\n\u00a0#; node /p/scripts/rx.mjs stale --nope\n```\n"), ["2:runner-shape"]);
  assert.deepEqual(rules("`node /p/scripts/rx.mjs stale --json\u00a0`\n"), ["1:runner-shape"]);
  assert.deepEqual(rules("`node /p/scripts/rx.mjs stale --json\r`\n"), ["1:runner-shape"]);
  assert.deepEqual(rules("` node /p/scripts/rx.mjs stale --json `\n"), []);
  const bashC = hooksDoc([{ type: "command", command: "/bin/bash", args: ["-c", "node /p/scripts/rx.mjs stale --nope", "/p/scripts/rx.mjs", "stale"] }]);
  assert.deepEqual(scanHooks(bashC, HOOK_REGISTRY).findings.map((f) => f.rule), ["runner-shape"]);
  assert.deepEqual(scanHooks(hooksDoc([{ type: "command", command: "/bin/bash", args: ["-c", "node /p/scripts/rx.mjs stale --nope"] }]), HOOK_REGISTRY).findings.map((f) => f.rule), ["runner-shape"]);
  assert.deepEqual(scanHooks(hooksDoc([{ type: "command", command: "/usr/local/bin/node", args: ["/p/scripts/rx.mjs", "guard"] }]), HOOK_REGISTRY), { findings: [], calls: 1 });
  const dup = '{"hooks":{"X":[{"hooks":[{"type":"command","command":"node /p/scripts/rx.mjs stale --nope","command":"true"}]}]}}';
  assert.deepEqual(scanHooks(dup, HOOK_REGISTRY).findings.map((f) => f.rule), ["runner-shape"]);
});

test("bash is launched with no startup files and stdin that is not a socket (macOS bash sources ~/.bashrc otherwise)", async () => {
  await withTempDir((dir) => {
    const log = join(dir, "launch.log");
    const fake = join(dir, "bash");
    writeFileSync(fake, `#!/bin/sh\nprintf '%s\\n' "$@" >> '${log}'\nif [ -S /dev/stdin ]; then echo STDIN-SOCKET >> '${log}'; fi\nexec /bin/bash "$@"\n`, { mode: 0o755 });
    const saved = shellJudge.bin;
    shellJudge.bin = fake;
    try {
      assert.equal(needsNextLine("node /p/scripts/rx.mjs stale --json --fresh-probe-1"), false);
      assert.deepEqual(bashArgv("node /p/scripts/rx.mjs stale --json"), ["node", "/p/scripts/rx.mjs", "stale", "--json"]);
    } finally {
      shellJudge.bin = saved;
    }
    const launched = readFileSync(log, "utf8");
    assert.equal((launched.match(/^--norc$/gm) ?? []).length, 3, launched); // two needsNextLine parses, one bashArgv
    assert.equal((launched.match(/^--noprofile$/gm) ?? []).length, 3, launched);
    assert.doesNotMatch(launched, /STDIN-SOCKET/);
  });
});

test("CommonMark extraction: containers, indented code, link and HTML prose, and the bash argv oracle", () => {
  assert.deepEqual(rules("> ```sh\n> node /p/scripts/rx.mjs stale --nope\n> ```\n"), ["2:unknown-flag"]);
  assert.deepEqual(rules("- item\n\n  ```sh\n  node /p/scripts/rx.mjs stale --nope\n  ```\n"), ["4:unknown-flag"]);
  assert.deepEqual(rules("Text.\n\n    node /p/scripts/rx.mjs stale --nope\n"), ["3:unknown-flag"]);
  assert.deepEqual(rules("See [the runner](scripts/rx.mjs).\n<!-- node /p/scripts/rx.mjs stale --nope -->\n"), ["1:runner-shape", "2:runner-shape"]);
  // The oracle agrees with the lexer on every accepted shape, including bash-special names.
  for (const line of ['node "${ROOT}/scripts/rx.mjs" stale --root "$PWD" --json', "node /p/scripts/rx.mjs stale --root 'a; b' @x %y a,b", 'node /p/scripts/rx.mjs stale --root "$PATH"']) {
    const lexed = lexRunnerLine(line);
    assert.ok(lexed.ok, line);
    if (lexed.ok) assert.deepEqual(bashArgv(lexed.shell), ["node", lexed.runner, ...lexed.argv], line);
  }
  // A name bash will not assign fails closed instead of passing.
  assert.deepEqual(scanShellLine('node /p/scripts/rx.mjs stale --root "$UID"', REGISTRY).findings.map((f) => f.rule), ["runner-shape"]);
});

test("R9 NUL and control bytes fail closed; indented blocks at offset 0 and fence-like indented content map correctly", () => {
  assert.deepEqual(rules('`node /p/scripts/rx.mjs stale "\u0000--nope"`\n').filter((r) => r.endsWith("runner-shape")).length > 0, true);
  assert.deepEqual(scanShellLine('node /p/scripts/rx.mjs stale "\u0000--nope"', REGISTRY).findings.map((f) => f.rule), ["runner-shape"]);
  assert.deepEqual(scanShellLine("node /p/scripts/rx.mjs stale '\u001b--nope'", REGISTRY).findings.map((f) => f.rule), ["runner-shape"]);
  assert.deepEqual(scanMarkdown("    node /p/scripts/rx.mjs stale --json\n", REGISTRY), { findings: [], calls: 1 });
  assert.deepEqual(rules("    ```\n    node /p/scripts/rx.mjs bogus\n"), ["2:unknown-command"]);
  assert.deepEqual(rules("```sh node /p/scripts/rx.mjs stale"), ["1:runner-shape"], "an unclosed, empty fence's info string is still not covered");
});

const npxCases = [
  ["--offline", "-y", "@chrismessina/raycast-harness@0.1.2", "doctor"],
  ["--yes", "raycast-harness", "doctor"],
  ["--package=@chrismessina/raycast-harness@latest", "rx", "doctor"],
  ["--package", "raycast-harness@^0.1.2", "rx", "doctor"],
  ["-p", "@chrismessina/raycast-harness@~0.1.2", "rx", "doctor"],
  ["-p=raycast-harness", "rx", "doctor"],
  ["--registry", "https://registry.npmjs.org", "@chrismessina/raycast-harness", "doctor"],
  ["--call", "rx doctor && rx stale", "--package=@chrismessina/raycast-harness"],
  ["cowsay", "@chrismessina/raycast-harness"],
];
const shellQuote = (word) => "'" + word.replaceAll("'", "'\\''") + "'";

for (const args of npxCases) {
  test(`npx tokens: ${JSON.stringify(args)} across command surfaces`, () => {
    for (const line of ["npx " + args.join(" "), "npx " + args.map(shellQuote).join(" "),
      "npx " + args.map((w) => JSON.stringify(w)).join(" ")]) {
      // The --call script is one shell word, so use the quoted variants for that case.
      if (args.includes("--call") && line === "npx " + args.join(" ")) continue;
      assert.ok(scanShellLine(line, REGISTRY).findings.some((f) => f.rule === "bare-npx"), line);
      assert.deepEqual(rules("```sh\n" + line + "\n```"), ["2:bare-npx"], line);
      assert.deepEqual(rules("Run `" + line + "`."), ["1:bare-npx"], line);
      assert.deepEqual(scanHooks(hooksDoc([{ type: "command", command: line }]), REGISTRY).findings.map((f) => f.rule), ["bare-npx"], line);
    }
    for (const command of ["npx", "/usr/local/bin/npx"]) {
      assert.deepEqual(scanHooks(hooksDoc([{ type: "command", command, args }]), REGISTRY).findings.map((f) => f.rule), ["bare-npx"]);
    }
  });
}

test("npx tokens: substitutions and continued Markdown commands", () => {
  for (const line of ["echo $(npx raycast-harness)", "cat <(npx raycast-harness)", "echo `npx raycast-harness`", "npx \\\n@chrismessina/raycast-harness"]) {
    assert.ok(scanShellLine(line, REGISTRY).findings.some((f) => f.rule === "bare-npx"), line);
    assert.deepEqual(scanHooks(hooksDoc([{ type: "command", command: line }]), REGISTRY).findings.map((f) => f.rule), ["bare-npx"]);
  }
  const continued = "npx \\\n@chrismessina/raycast-harness";
  assert.deepEqual(rules("```sh\n" + continued + "\n```"), ["2:bare-npx"]);
  assert.deepEqual(rules("Run `" + continued + "`."), ["1:bare-npx"]);
});

test("npx tokens: prose, other packages, paths, and quoted literals are not invocations", () => {
  for (const arg of ["raycast-harness-extra", "@chrismessina/raycast-harness-extra", "~/.cache/raycast-harness"]) {
    assert.deepEqual(rules("`npx " + arg + "`"), []);
    assert.deepEqual(scanShellLine("npx " + arg, REGISTRY).findings, []);
    assert.deepEqual(scanHooks(hooksDoc([{ type: "command", command: "/usr/local/bin/npx", args: [arg] }]), REGISTRY).findings, []);
  }
  assert.deepEqual(rules("A learning: npx resolves the package raycast-harness before executing rx."), []);
  assert.deepEqual(rules("The npm package is named @chrismessina/raycast-harness."), []);
  assert.deepEqual(rules('`node /p/scripts/rx.mjs doctor`; npx resolves raycast-harness.'), []);
  assert.deepEqual(scanShellLine('echo "npx raycast-harness"', REGISTRY).findings, []);
});

test("npx tokens: malformed shell fails closed", () => {
  const line = "npx 'raycast-harness";
  assert.deepEqual(scanShellLine(line, REGISTRY).findings.map((f) => f.rule), ["shell-syntax"]);
  assert.deepEqual(rules("```sh\n" + line + "\n```"), ["2:shell-syntax"]);
  assert.deepEqual(rules("`" + line + "`"), ["1:shell-syntax"]);
  assert.deepEqual(scanHooks(hooksDoc([{ type: "command", command: line }]), REGISTRY).findings.map((f) => f.rule), ["shell-syntax"]);
});

test("npx tokens: bash removes quoting and escapes from the executable too", () => {
  for (const command of ["n'p'x", "np\\x", "'/usr/local/bin/npx'"]) {
    assert.deepEqual(scanShellLine(command + " raycast-harness", REGISTRY).findings.map((f) => f.rule), ["bare-npx"]);
  }
});

test("npx shell text that names another package is not fail-closed: redirections in ordinary npx snippets are fine; naming the rx package still fails closed", () => {
  const md = (/** @type {string} */ line) => rules("```sh\n" + line + "\n```\n").map((r) => r.replace(/^\d+:/, ""));
  assert.deepEqual(md("npx ray build 2>&1"), []);
  assert.deepEqual(md("npx ray lint > lint.log"), []);
  assert.deepEqual(md("npx @chrismessina/raycast-harness preflight > out.txt"), ["shell-syntax"]);
});

test("Codex R5-F1: leading environment assignments do not hide a direct npx call", () => {
  const md = (/** @type {string} */ line) => rules("```sh\n" + line + "\n```\n").map((r) => r.replace(/^\d+:/, ""));
  assert.deepEqual(md("FOO=x npx @chrismessina/raycast-harness doctor"), ["bare-npx"]);
  assert.deepEqual(md("NODE_OPTIONS=--no-warnings A=1 npx -y raycast-harness@0.1.2 doctor"), ["bare-npx"]);
  assert.deepEqual(md("FOO=x npx ray build"), []);
  assert.deepEqual(scanHooks(hooksDoc([{ type: "command", command: "FOO=x npx @chrismessina/raycast-harness guard" }]), HOOK_REGISTRY).findings.map((f) => f.rule), ["bare-npx"]);
});
