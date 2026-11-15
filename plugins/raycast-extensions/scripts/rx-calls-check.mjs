#!/usr/bin/env node
// D5's CI check for the plugin: every `rx` call in skills, references and hooks goes through the
// runner, and names a command, subcommand and flags that exist in the pinned `rx commands --json`.
//
//   node scripts/rx-calls-check.mjs [--check] [--plugin <dir>] [--registry <file>]
//
// Scans skills/**/SKILL.md, reference/*.md (except the generated reference/rx.md, which is the
// registry rendered) and hooks/hooks.json (when present). Findings, one per line:
//
//   bare-rx          a shell line in a fenced code block, or a hook entry's command, that runs `rx`
//                    directly (`rx preflight`, `$ rx stale`, `… && rx scan`), or an inline code
//                    span that is an rx INVOCATION (`rx preflight --root .`). An inline span naming
//                    a command with no further tokens (`rx preflight`, `rx greptile fetch`) is the
//                    prose form §3 of the plan prescribes and is allowed.
//
// hooks.json: only `hooks.<Event>[].hooks[]` entries with `"type": "command"` are examined, in
// either the shell form (`command` is a shell line) or the exec form (`command` + `args[]` is the
// argument vector, not shell-parsed; the tokens after the `scripts/rx.mjs` path are rx's argv).
// `description` and other prose strings are never scanned.
//   bare-npx         `npx raycast-harness` anywhere in a scanned file.
//   unknown-command  a runner call names a command the registry does not have.
//   missing-subcommand / unknown-subcommand   for commands that take subcommands.
//   unknown-flag     a flag the (sub)command does not declare (the registry's global flags, which
//                    rx declares on every entry, are accepted everywhere).
//   runner-mode      a runner-level mode other than --runner-version.
//   runner-shape     a line that names `scripts/rx.mjs` (a fenced-block line, an inline code span,
//                    a shell-form hook command) and is not exactly one runner call in the shape
//                    below. Shell outside that shape (substitutions, assignments, redirections,
//                    pipes, separators, backslashes, a call split across lines) is refused whole
//                    rather than read by a partial shell parser. An inline span that is only the
//                    path (`"<plugin>/scripts/rx.mjs"`, no substitution) names the file and is not a
//                    call. In prose, every scripts/rx.mjs must sit inside a single-line inline code
//                    span on its line, or the line is runner-shape (fail-closed extraction).
//   multiline-call   a line in the runner shape that `bash -n` still reads as going on into the
//                    next line (needsNextLine). A bash that cannot be spawned is exit 2.
//
// The runner shape, consumed whole by lexRunnerLine (no other reader sees a runner line):
//
//   Line   ::= H [ "$" S ] "node" S RunnerPath { S Arg } [ S "#" comment ] H EOF
//   Arg    ::= Bare | '…' (no backslash) | "…" (no backslash or backtick; `$` only as $NAME or ${NAME})
//   Bare   ::= one or more of A–Z a–z 0–9 _ . / : = , + @ % -
//   H / S  ::= zero / one or more spaces or tabs; words never touch (`--root="$X"` is refused)
//
// A `$NAME` argument is trusted as a value: its runtime contents are never checked, so a doc that sets
// `OPT=--nope` and passes "$OPT" is outside what this lint can see (decided with Chris, round 8).
// Markdown is read with a CommonMark parser (mdast-util-from-markdown); each word list the lexer
// accepts is cross-checked against the argv bash itself produces (bashArgv).
//
// RunnerPath is an Arg ending in the path component `scripts/rx.mjs`. The words after it, quotes
// removed, are rx's argv: the command, subcommand and flag names are checked against the registry
// and must be literal (a `$CMD` or `<command>` is not a known command). Values and positionals may
// be anything the shape allows; flag VALUES are never validated here.
//
// Exit: 0 clean (or without --check, after printing findings); 1 any finding with --check;
// 2 when the registry cannot be loaded or an argument is unknown.

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { fromMarkdown } from "mdast-util-from-markdown";
import { validateDocumentedCall } from "./lib/rx-protocol.mjs";
import { PLUGIN_DIR, RunnerError, loadRegistryDocument } from "./rx.mjs";

export const RUNNER_MODES = new Set(["--runner-version"]);

/**
 * @typedef {import("./lib/rx-protocol.mjs").Registry} Registry
 * @typedef {{ file: string, line: number, rule: string, message: string, text: string }} Finding
 */

/**
 * The files to scan, relative to the plugin directory.
 * @param {string} pluginDir
 * @returns {string[]} absolute paths, sorted
 */
export function scanTargets(pluginDir) {
  /** @type {string[]} */
  const files = [];
  const skills = join(pluginDir, "skills");
  if (existsSync(skills)) {
    for (const entry of readdirSync(skills, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const skill = join(skills, entry.name, "SKILL.md");
      if (existsSync(skill)) files.push(skill);
    }
  }
  const reference = join(pluginDir, "reference");
  if (existsSync(reference)) {
    for (const name of readdirSync(reference)) {
      if (!name.endsWith(".md") || name === "rx.md") continue;
      const p = join(reference, name);
      if (statSync(p).isFile()) files.push(p);
    }
  }
  const hooks = join(pluginDir, "hooks", "hooks.json");
  if (existsSync(hooks)) files.push(hooks);
  return files.sort();
}

/**
 * Validate one runner call's tokens (everything after `scripts/rx.mjs`): a runner mode, or rx argv
 * checked by the shared registry client (validateDocumentedCall).
 * @param {string[]} tokens
 * @param {Registry} registry
 * @returns {{ rule: string, message: string } | null}
 */
export function validateCall(tokens, registry) {
  const [first] = tokens;
  if (first?.startsWith("--")) {
    if (!RUNNER_MODES.has(first)) return { rule: "runner-mode", message: `${first} is not a runner mode (${[...RUNNER_MODES].join(", ")}) or a command` };
    return null;
  }
  return validateDocumentedCall(tokens, registry);
}

const MARKER = "scripts/rx.mjs";
const BARE_RX_RE = /(?:^|[\s(;|&`$]|\$\s)rx\s+(?!runner\b)([a-z][a-z-]*)(?=\s|$|[`)|;&])/;
const NPX_RE = /\bnpx\s+(?:-y\s+|--yes\s+)?raycast-harness\b/;
const BARE_CHAR = /[A-Za-z0-9_./:=,+@%-]/;
const RUNNER_PATH_RE = /(?:^|\/)scripts\/rx\.mjs$/;
const SHAPE = `node <runner path> <command> [args], each arg a bare word, '…' or "…" ($NAME allowed), with an optional trailing # comment`;

/**
 * Read one line in the runner shape (see the header) and return rx's argv, or why the line is not
 * in the shape. The whole line is consumed; nothing outside the grammar is interpreted.
 * @param {string} text one physical line
 * @returns {{ ok: true, argv: string[], runner: string, shell: string } | { ok: false, reason: string }}
 *   `shell` is the line without the documentation prompt, for bash's completeness check.
 */
export function lexRunnerLine(text) {
  const n = text.length;
  let i = 0;
  const fail = (/** @type {string} */ why) => /** @type {const} */ ({ ok: false, reason: `${why} (column ${i + 1})` });
  const space = () => {
    const from = i;
    while (i < n && (text[i] === " " || text[i] === "\t")) i++;
    return i - from;
  };
  space();
  if (text[i] === "$") {
    i++;
    if (!space()) return fail("a `$` prompt must be followed by a space");
  }
  const shellFrom = i;
  if (!text.startsWith("node", i)) return fail("the command must be `node`");
  i += 4;
  if (!space()) return fail("`node` must be followed by a space and the runner path");
  /** @type {string[]} */
  const words = [];
  while (i < n) {
    if (text[i] === "#") break; // a comment, after whitespace: the rest of the line is not shell
    const c = text[i];
    let word = "";
    if (c === "'") {
      const end = text.indexOf("'", i + 1);
      if (end === -1) return fail("unclosed '");
      word = text.slice(i + 1, end);
      if (/[\\\x00-\x1f\x7f]/.test(word)) return fail("a backslash or control character inside '…'");
      i = end + 1;
    } else if (c === '"') {
      i++;
      while (i < n && text[i] !== '"') {
        const ch = text[i];
        if (ch === "$") {
          const m = text.slice(i).match(/^\$(?:([A-Za-z_][A-Za-z0-9_]*)|\{([A-Za-z_][A-Za-z0-9_]*)\})/);
          if (!m) return fail("inside \"…\", `$` must start $NAME or ${NAME}");
          word += `$${m[1] ?? m[2]}`;
          i += m[0].length;
          continue;
        }
        if (ch === "\\" || ch === "`" || /[\x00-\x1f\x7f]/.test(ch)) return fail(`${JSON.stringify(ch)} inside "…"`);
        word += ch;
        i++;
      }
      if (i >= n) return fail('unclosed "');
      i++;
    } else if (BARE_CHAR.test(c)) {
      const from = i;
      while (i < n && BARE_CHAR.test(text[i])) i++;
      word = text.slice(from, i);
    } else return fail(`${JSON.stringify(c)} is outside the runner shape`);
    words.push(word);
    if (i < n && !space()) return fail(`${JSON.stringify(text[i])} touches the word before it`);
  }
  if (!words.length || !RUNNER_PATH_RE.test(words[0])) return fail("the first word after `node` must be the runner path ending in scripts/rx.mjs");
  return { ok: true, argv: words.slice(1), runner: words[0], shell: text.slice(shellFrom) };
}

/** @param {string} reason */
const shapeMessage = (reason) => `a line naming scripts/rx.mjs must be exactly one runner call on one line, ${SHAPE}: ${reason}`;
const MULTILINE_MESSAGE = "a runner call must fit on one physical line: bash reads this line as going on into the next one, so its tokens cannot be validated whole";

/**
 * Who decides whether a physical line is a complete shell command: bash's own parser, never a hand
 * reader. `bin` is the bash to spawn; tests point it elsewhere to prove a missing bash is an error.
 */
export const shellJudge = { bin: "bash" };
// No startup files, and stdin is /dev/null: bash sources ~/.bashrc even with `-c` when stdin is a
// socket (its "run by a remote shell daemon" rule), and Node's stdio pipes are socketpairs.
const BASH_FLAGS = ["--norc", "--noprofile"];

// Diagnostics bash prints for input that ends too early. bash 3.2 (macOS /bin/bash):
//   "unexpected EOF while looking for matching `)'", "syntax error: unexpected end of file".
// bash 4/5 add, with exit 0: "warning: here-document at line 1 delimited by end-of-file (wanted `EOF')".
const INCOMPLETE_RE = /unexpected EOF while looking for matching|unexpected end of file|here-document at line \d+ delimited by end-of-file/;
/** @type {Map<string, boolean>} */
const judged = new Map();

/**
 * Does this one physical line need the next line to be a complete command? Two parses by
 * `bash -n` (parse only, nothing runs), each an argument array with LC_ALL=C and a minimal
 * environment (no BASH_ENV):
 *   1. the line alone. A nonzero exit or an incomplete-input diagnostic (an open quote, `$(`, group,
 *      `[[`, a trailing `&&`/`||`/`|`; bash 4/5's heredoc warning) means it goes on.
 *   2. the line followed by a stray `fi`. A complete line leaves `fi` as a syntax error; when bash
 *      accepts it, the line went on into the next one: a trailing `\` joins `fi` as an argument, and a
 *      heredoc start reads it as body. bash 3.2 reports neither case in parse 1, so this is how
 *      bash itself answers them.
 * Throws RunnerError when bash cannot be spawned: the check never passes without its judge.
 * @param {string} line
 * @returns {boolean}
 */
export function needsNextLine(line) {
  const key = `${shellJudge.bin}\0${line}`;
  const hit = judged.get(key);
  if (hit !== undefined) return hit;
  const env = { PATH: process.env.PATH ?? "/usr/bin:/bin", LC_ALL: "C" };
  const parse = (/** @type {string} */ text) => {
    const r = spawnSync(shellJudge.bin, [...BASH_FLAGS, "-n", "-c", text], { env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    if (r.error) throw new RunnerError(`cannot run bash (${shellJudge.bin}) to judge runner lines: ${r.error.message}`);
    return { code: r.status ?? 2, stderr: String(r.stderr ?? "") };
  };
  // The line goes to bash exactly as written. A `<placeholder>` is a redirection to bash, so a
  // runner call in a skill writes its placeholders as shell values (`"$DIR"`), never `<dir>`.
  const alone = parse(line);
  let incomplete = alone.code !== 0 || INCOMPLETE_RE.test(alone.stderr);
  if (!incomplete) {
    const probe = parse(`${line}\nfi`);
    incomplete = probe.code === 0 || INCOMPLETE_RE.test(probe.stderr);
  }
  judged.set(key, incomplete);
  return incomplete;
}

/**
 * Remove shell comments (`#` at the start of a word, outside quotes, up to the end of its physical
 * line), so a comment's words are never read as flags or as a line continuation.
 * @param {string} text one or more physical lines
 * @returns {string}
 */
export function stripComments(text) {
  let out = "";
  let q = "";
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      out += ch;
      if (ch === "\\" && q === '"' && i + 1 < text.length) out += text[++i];
      else if (ch === q) q = "";
      continue;
    }
    if (ch === "\\" && i + 1 < text.length) {
      out += ch + text[++i];
      continue;
    }
    if (ch === "'" || ch === '"') q = ch;
    if (ch === "#" && (i === 0 || /\s/.test(text[i - 1]))) {
      const nl = text.indexOf("\n", i);
      if (nl === -1) break;
      i = nl - 1;
      continue;
    }
    out += ch;
  }
  return out;
}

// A path-only span names the runner file: one word, a bare path or a quoted one holding at most
// $NAME, with no substitution, operator or argument.
const PATH_ONLY_RE = /^(?:"(?:[^"$`\\]|\$\{?[A-Za-z_][A-Za-z0-9_]*\}?)*"|'[^'\\]*'|[A-Za-z0-9_./<>@%+:-]+)$/;

/**
 * Scan one Markdown file. Blocks and spans come from a CommonMark parser (micromark, through
 * mdast-util-from-markdown), never from a hand reader: a code block's lines (fenced or indented, in
 * any container) are shell lines, and an inline code span's text is a shell line. Fail-closed: every
 * `scripts/rx.mjs` in the source must lie inside a code block's body or an inline code span, or it is
 * a runner-shape finding (prose, link text, a URL, raw HTML, a fence's info string).
 * @param {string} text
 * @param {Registry} registry
 * @returns {{ findings: Omit<Finding, "file">[], calls: number }}
 */
export function scanMarkdown(text, registry) {
  /** @type {Omit<Finding, "file">[]} */
  const findings = [];
  let calls = 0;
  /** @type {Set<number>} lines inside a code block (their npx is reported by the shell-line scan) */
  const codeLines = new Set();
  /** @type {[number, number][]} source offset ranges whose markers were read */
  const read = [];
  // The parser replaces a NUL with U+FFFD, while bash drops it, so the bytes the checks read would not
  // be the bytes bash runs: a control character anywhere in a scanned file is a finding.
  text.split("\n").forEach((raw, i) => {
    if (/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(raw)) findings.push({ line: i + 1, rule: "runner-shape", message: shapeMessage("a control character (NUL, ESC, …) in the file; the parser and bash would read different bytes"), text: JSON.stringify(raw.trim()).slice(1, -1) });
  });
  const tree = fromMarkdown(text);
  /** @param {any} node */
  const visit = (node) => {
    if (node.type === "code") {
      const { start, end } = node.position;
      const source = text.slice(start.offset, end.offset);
      const value = String(node.value);
      // Fenced or indented, from the parser's own spans: a fenced block's source has an opener line
      // (and usually a closer) beyond its value's lines; an indented block's source is its lines.
      const fenced = end.line - start.line + 1 > value.split("\n").length;
      // The body's markers are read below; a fence's info string is never run, so it is not covered.
      const eol = text.indexOf("\n", start.offset);
      const bodyFrom = !fenced ? start.offset : eol === -1 ? end.offset : eol + 1;
      if (value !== "") read.push([bodyFrom, end.offset]);
      const first = fenced ? start.line + 1 : start.line;
      for (let k = first; k <= end.line; k++) codeLines.add(k);
      if (value === "") return;
      value.split("\n").forEach((raw, k) => {
        const line = first + k;
        // A shell line: comments ([ \t]* then `#`, as bash reads them) and verdict lines that do not
        // name the runner are not commands; everything else is scanned on its own.
        if (/^[ \t]*#/.test(raw) || (!raw.includes(MARKER) && /^\s*(PASS|FAIL|WARN|N\/A|ERROR)\b/.test(raw))) return;
        const r = scanShellLine(raw, registry);
        calls += r.calls;
        for (const f of r.findings) findings.push({ line, ...f, text: raw.trim() });
      });
      return;
    }
    if (node.type === "inlineCode") {
      const { start, end } = node.position;
      read.push([start.offset, end.offset]);
      const code = String(node.value);
      const line = start.line;
      if (code.includes(MARKER)) {
        if (code.includes("\n")) {
          findings.push({ line, rule: "runner-shape", message: shapeMessage("an inline span holding a runner call crosses a line break"), text: code.replace(/\s*\n\s*/g, " ") });
          return;
        }
        if (PATH_ONLY_RE.test(code) && code.replace(/["']/g, "").endsWith(MARKER)) return;
        const r = scanShellLine(code, registry);
        calls += r.calls;
        for (const f of r.findings) if (f.rule !== "bare-npx") findings.push({ line, ...f, text: code }); // npx is reported per line below
        return;
      }
      const inv = code.match(/^\$?\s*rx\s+([a-z][a-z-]*)(.*)$/);
      if (!inv) return;
      const rest = inv[2].trim();
      // `rx preflight` / `rx greptile fetch`: a name, allowed. Anything with flags or more is a call.
      if (rest === "" || (/^[a-z][a-z-]*$/.test(rest) && Object.hasOwn(registry.commands.find((c) => c.name === inv[1])?.subcommands ?? {}, rest))) return;
      findings.push({ line, rule: "bare-rx", message: `\`${code}\` is an rx invocation outside the runner; name the command (\`rx ${inv[1]}\`) or call node "<plugin>/scripts/rx.mjs" ${inv[1]} …`, text: code });
      return;
    }
    for (const child of node.children ?? []) visit(child);
  };
  visit(tree);
  const lines = text.split("\n");
  lines.forEach((raw, i) => {
    if (!codeLines.has(i + 1) && NPX_RE.test(raw)) findings.push({ line: i + 1, rule: "bare-npx", message: "call rx through the runner, never `npx raycast-harness`", text: raw.trim() });
  });
  // Every marker must lie in a range that was read.
  for (let at = text.indexOf(MARKER); at !== -1; at = text.indexOf(MARKER, at + 1)) {
    if (read.some(([from, to]) => at >= from && at + MARKER.length <= to)) continue;
    const line = text.slice(0, at).split("\n").length;
    findings.push({ line, rule: "runner-shape", message: shapeMessage("scripts/rx.mjs appears outside every code block body and inline code span (prose, a link, raw HTML or a fence's info string), so it cannot be read"), text: lines[line - 1].trim() });
  }
  findings.sort((x, y) => x.line - y.line);
  return { findings, calls };
}

/**
 * Split a shell line into command segments at `;`, `&&`, `&`, `||`, `|` and newlines (outside quotes),
 * so a bare `rx …` beside a runner call is still seen on its own.
 * @param {string} line
 * @returns {string[]}
 */
export function splitSegments(line) {
  /** @type {string[]} */
  const out = [];
  let cur = "";
  let quote = "";
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quote) {
      cur += ch;
      if (ch === quote) quote = "";
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      cur += ch;
      continue;
    }
    if (ch === "\\" && i + 1 < line.length) {
      cur += ch + line[++i];
      continue;
    }
    // `&` separates (`&&` and a background `&`) unless it is part of a redirection (`2>&1`, `&>`).
    const amp = ch === "&" && line[i - 1] !== ">" && line[i + 1] !== ">";
    if (ch === ";" || ch === "\n" || ch === "|" || amp) {
      if ((ch === "&" && line[i + 1] === "&") || (ch === "|" && line[i + 1] === "|")) i++;
      out.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim()).filter(Boolean);
}

/**
 * Replace the `$( … )`, `<( … )` and backtick substitutions in a shell line with the placeholder
 * `$SUB` and return their bodies, the way bash reads them: a single-quoted span is literal (nothing
 * inside it is a substitution), double quotes keep substitutions live, a backslash escapes the next
 * character, and a substitution ends at ITS closing delimiter, with parentheses inside quotes not
 * counted. One level: a substitution nested inside a body is found when that body is scanned.
 * @param {string} text
 * @returns {{ text: string, bodies: string[] }}
 */
export function substitutions(text) {
  /** @type {string[]} */
  const bodies = [];
  let out = "";
  let dq = false;
  for (let i = 0; i < text.length; ) {
    const ch = text[i];
    if (ch === "\\") {
      out += text.slice(i, i + 2);
      i += 2;
      continue;
    }
    if (ch === "'" && !dq) {
      const j = text.indexOf("'", i + 1);
      const end = j === -1 ? text.length : j + 1;
      out += text.slice(i, end);
      i = end;
      continue;
    }
    if (ch === '"') {
      dq = !dq;
      out += ch;
      i++;
      continue;
    }
    if ((ch === "$" || ch === "<") && text[i + 1] === "(") {
      const close = closingParen(text, i + 1);
      if (close !== -1) {
        bodies.push(text.slice(i + 2, close));
        out += "$SUB";
        i = close + 1;
        continue;
      }
    }
    if (ch === "`") {
      const j = text.indexOf("`", i + 1);
      if (j !== -1) {
        bodies.push(text.slice(i + 1, j));
        out += "$SUB";
        i = j + 1;
        continue;
      }
    }
    out += ch;
    i++;
  }
  return { text: out, bodies };
}

/**
 * Index of the `)` that closes the `(` at `open`, skipping quoted spans and escapes; -1 when unclosed.
 * @param {string} text
 * @param {number} open
 */
function closingParen(text, open) {
  let depth = 0;
  let quote = "";
  for (let k = open; k < text.length; k++) {
    const ch = text[k];
    if (ch === "\\" && quote !== "'") {
      k++;
      continue;
    }
    if (quote) {
      if (ch === quote) quote = "";
      continue;
    }
    if (ch === "'" || ch === '"') quote = ch;
    else if (ch === "(") depth++;
    else if (ch === ")" && --depth === 0) return k;
  }
  return -1;
}

/**
 * Scan one shell line (a fenced-block line, a shell-form hook command, an inline span holding a
 * runner call). A line that names the runner must lex as exactly one runner call (lexRunnerLine),
 * which bash then judges complete, and whose argv is validated; otherwise it is a runner-shape
 * finding, and is still searched for a bare `rx` or `npx raycast-harness`, as is every other line.
 * @param {string} line
 * @param {Registry} registry
 * @returns {{ findings: Omit<Finding, "file" | "line" | "text">[], calls: number }}
 */
export function scanShellLine(line, registry) {
  /** @type {Omit<Finding, "file" | "line" | "text">[]} */
  const findings = [];
  if (line.includes(MARKER)) {
    const lexed = /[\r\n]/.test(line) ? { ok: /** @type {const} */ (false), reason: "the call spans more than one line" } : lexRunnerLine(line);
    if (lexed.ok) {
      if (needsNextLine(lexed.shell)) return { findings: [{ rule: "multiline-call", message: MULTILINE_MESSAGE }], calls: 1 };
      const actual = bashArgv(lexed.shell);
      const expected = ["node", lexed.runner, ...lexed.argv];
      if (actual.length !== expected.length || actual.some((w, k) => w !== expected[k])) {
        return { findings: [{ rule: "runner-shape", message: shapeMessage(`bash reads these words as ${JSON.stringify(actual)}, not ${JSON.stringify(expected)}`) }], calls: 1 };
      }
      const bad = validateCall(lexed.argv, registry);
      return { findings: bad ? [bad] : [], calls: 1 };
    }
    findings.push({ rule: "runner-shape", message: shapeMessage(lexed.reason) });
  }
  findings.push(...bareCalls(line));
  return { findings, calls: 0 };
}

/**
 * The argv bash itself produces for a line the lexer accepted: the real shell is the oracle for the
 * lexer's word splitting and quote removal (differential check). Safe to run: the runner shape has no
 * substitution, redirection or operator, `-f` turns globbing off, and each `$NAME` the line uses is
 * assigned the literal text `$NAME` inside the script (after bash's own startup, which resets
 * variables such as PWD), so bash's expansion reproduces the lexer's token. A name bash refuses to
 * assign (a readonly one such as UID) stops the script, and the line fails closed.
 * @param {string} shell the line from `node` on
 * @returns {string[]}
 */
export function bashArgv(shell) {
  const env = { PATH: process.env.PATH ?? "/usr/bin:/bin", LC_ALL: "C" };
  const names = [...new Set([...shell.matchAll(/\$\{?([A-Za-z_][A-Za-z0-9_]*)/g)].map((m) => m[1]))];
  const script = [...names.map((n) => `${n}='$${n}'`), `set -- ${shell}`, `printf '%s\\0' "$@"`].join("\n");
  const r = spawnSync(shellJudge.bin, [...BASH_FLAGS, "-f", "-e", "-c", script], { env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  if (r.error) throw new RunnerError(`cannot run bash (${shellJudge.bin}) to read runner lines: ${r.error.message}`);
  if (r.status !== 0) return [`<bash exit ${r.status}: ${String(r.stderr).trim().split("\n")[0]}>`];
  return String(r.stdout).split("\0").slice(0, -1);
}

/**
 * Bare `rx …` and `npx raycast-harness` in a shell line, per segment, including inside substitutions
 * (bash runs those too). A runner path never matches: `rx` there is preceded by `/`.
 * @param {string} line
 * @returns {Omit<Finding, "file" | "line" | "text">[]}
 */
function bareCalls(line) {
  /** @type {Omit<Finding, "file" | "line" | "text">[]} */
  const findings = [];
  const { text: flat, bodies } = substitutions(stripComments(line));
  for (const body of bodies) findings.push(...bareCalls(body));
  for (const raw of splitSegments(flat)) {
    const segment = raw.replace(/\\\r?\n/g, " ");
    if (NPX_RE.test(segment)) {
      findings.push({ rule: "bare-npx", message: "call rx through the runner, never `npx raycast-harness`" });
      continue;
    }
    const bare = segment.match(BARE_RX_RE);
    if (bare) findings.push({ rule: "bare-rx", message: `\`rx ${bare[1]}\` must be called through the runner: node "<plugin>/scripts/rx.mjs" ${bare[1]} …` });
  }
  return findings;
}

/**
 * Scan hooks.json. Only hook entries (`hooks.<Event>[].hooks[]` with `"type": "command"`) are
 * examined; `description` and every other prose string are left alone. An entry is either the
 * shell form (`command: "node \"${CLAUDE_PLUGIN_ROOT}/scripts/rx.mjs\" guard"`, parsed as a shell
 * line) or the exec form (`command: "node", args: [".../scripts/rx.mjs", "guard", …]`, where
 * `[command, ...args]` is already the argument vector and is not shell-parsed).
 * @param {string} text
 * @param {Registry} registry
 * @returns {{ findings: Omit<Finding, "file">[], calls: number }}
 */
export function scanHooks(text, registry) {
  /** @type {Omit<Finding, "file">[]} */
  const findings = [];
  let calls = 0;
  /** @type {unknown} */
  let doc;
  try {
    doc = JSON.parse(text);
  } catch (e) {
    return { findings: [{ line: 1, rule: "invalid-json", message: `hooks.json is not JSON: ${/** @type {Error} */ (e).message}`, text: "" }], calls };
  }
  // Every marker in the file must survive parsing: a duplicate key silently drops the earlier value.
  /** @param {unknown} v @returns {number} */
  const markersIn = (v) => (typeof v === "string" ? v.split(MARKER).length - 1 : Array.isArray(v) ? v.reduce((n, x) => n + markersIn(x), 0) : v && typeof v === "object" ? Object.entries(v).reduce((n, [k, x]) => n + markersIn(k) + markersIn(x), 0) : 0);
  if (text.split(MARKER).length - 1 > markersIn(doc)) findings.push({ line: 1, rule: "runner-shape", message: shapeMessage("hooks.json holds scripts/rx.mjs that parsing drops (a duplicate key)"), text: "" });
  const lines = text.split(/\r?\n/);
  const lineOf = (/** @type {string} */ s) => Math.max(1, lines.findIndex((l) => l.includes(s.split("\n")[0].slice(0, 60))) + 1);
  const events = /** @type {{ hooks?: Record<string, unknown> }} */ (doc)?.hooks;
  if (!events || typeof events !== "object") return { findings, calls };
  for (const matchers of Object.values(events)) {
    if (!Array.isArray(matchers)) continue;
    for (const matcher of matchers) {
      const entries = /** @type {{ hooks?: unknown }} */ (matcher)?.hooks;
      if (!Array.isArray(entries)) continue;
      for (const entry of entries) {
        const e = /** @type {{ type?: unknown, command?: unknown, args?: unknown }} */ (entry);
        if (!e || e.type !== "command" || typeof e.command !== "string") continue;
        if (Array.isArray(e.args)) {
          // Exec form: [command, ...args] is the argument vector; what follows the runner path is rx's argv.
          const vector = [e.command, ...e.args.map(String)];
          const shown = vector.join(" ");
          const at = vector.findIndex((t) => /(^|\/)scripts\/rx\.mjs$/.test(t));
          // The runner shape in exec form is exactly [node, <runner path>, ...argv]; a marker anywhere
          // else (a `bash -c` source string, a later operand) is not a call this check can read.
          const elsewhere = vector.some((t, k) => t.includes(MARKER) && !(k === 1 && at === 1 && /(^|\/)node$/.test(vector[0])));
          if (elsewhere) {
            findings.push({ line: lineOf(vector.find((t) => t.includes(MARKER)) ?? e.command), rule: "runner-shape", message: shapeMessage("an exec-form hook must be exactly [node, <runner path>, ...argv]"), text: shown });
          } else if (at >= 0) {
            calls++;
            const bad = validateCall(vector.slice(at + 1), registry);
            if (bad) findings.push({ line: lineOf(vector[at]), ...bad, text: shown });
          } else if (vector[0] === "rx" || vector[0] === "raycast-harness") {
            findings.push({ line: lineOf(e.command), rule: "bare-rx", message: `\`${vector.slice(0, 2).join(" ")}\` must be called through the runner`, text: shown });
          } else if (vector[0] === "npx" && vector.some((t) => /^raycast-harness(@|$)/.test(t))) {
            findings.push({ line: lineOf(e.command), rule: "bare-npx", message: "call rx through the runner, never `npx raycast-harness`", text: shown });
          }
          continue;
        }
        // Shell form: one shell line, scanned per segment.
        const v = e.command;
        const r = scanShellLine(v, registry);
        calls += r.calls;
        for (const f of r.findings) findings.push({ line: lineOf(v), ...f, text: v });
      }
    }
  }
  return { findings, calls };
}

/**
 * Scan the plugin.
 * @param {string} pluginDir
 * @param {Registry} registry
 * @returns {{ findings: Finding[], calls: number, files: string[] }}
 */
export function scanPlugin(pluginDir, registry) {
  /** @type {Finding[]} */
  const findings = [];
  let calls = 0;
  const files = scanTargets(pluginDir);
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    const r = file.endsWith(".json") ? scanHooks(text, registry) : scanMarkdown(text, registry);
    calls += r.calls;
    for (const f of r.findings) findings.push({ file: relative(pluginDir, file), ...f });
  }
  return { findings, calls, files };
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
  let pluginDir = PLUGIN_DIR;
  /** @type {string | null} */
  let registryFile = null;
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t === "--check") check = true;
    else if (t === "--plugin" && argv[i + 1]) pluginDir = resolve(argv[++i]);
    else if (t === "--registry" && argv[i + 1]) registryFile = resolve(argv[++i]);
    else {
      log(`rx-calls-check: unknown argument ${JSON.stringify(t)}\n`);
      return 2;
    }
  }
  try {
    const registry = await loadRegistryDocument({ registryFile, env: io.env });
    const { findings, calls, files } = scanPlugin(pluginDir, registry);
    if (files.length === 0 || !existsSync(join(pluginDir, "skills"))) {
      log(`rx-calls-check: nothing to scan under ${pluginDir} (no skills/, references or hooks); refusing to report a clean pass\n`);
      return 2;
    }
    for (const f of findings) out(`${f.file}:${f.line}  ${f.rule}  ${f.message}\n    ${f.text}\n`);
    out(`rx-calls-check: ${files.length} file(s), ${calls} runner call(s) validated against rx ${registry.version}, ${findings.length} finding(s)\n`);
    return findings.length && check ? 1 : 0;
  } catch (e) {
    if (e instanceof RunnerError) {
      log(`rx-calls-check: ${e.message}\n`);
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
