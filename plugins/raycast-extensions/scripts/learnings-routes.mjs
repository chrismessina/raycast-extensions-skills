#!/usr/bin/env node
// Writes each skill's learnings routing table from the learnings' own frontmatter.
//
// Every learning under learnings/**/*.md declares where it routes:
//
//   applies_to: ["ship", "develop"]      # skill directory names
//   trigger: "when you are about to <do the thing>"   # lowercase, no trailing period
//
// The row shows the trigger after the table header's "When you are about to…", so a leading
// "when you are about to " in the trigger is dropped when rendering (either spelling is accepted).
//
// For every skills/<name>/SKILL.md the region between the lines
// `<!-- learnings:start -->` and `<!-- learnings:end -->` (each alone on its line) is replaced
// with the table:
//
//   | When you are about to… | Read |
//   |---|---|
//   | <trigger> | [`<file stem>`](<link relative to the skill file>) |
//
// one row per learning whose applies_to names that skill, sorted by trigger. A skill nothing
// routes to gets the header and separator only. Rows are never written by hand: set applies_to
// on the learning instead.
//
//   node scripts/learnings-routes.mjs            write every region (prints wrote/unchanged)
//   node scripts/learnings-routes.mjs --check    exit 1 and name each skill whose region differs
//   --plugin <dir>                               another plugin root (tests)
//
// Exit 2 (nothing written): a learning with malformed frontmatter, no applies_to, an empty
// applies_to, an applies_to naming a skill that does not exist, a missing or malformed trigger
// (empty, capitalized, trailing period); a skill with no marker pair, or a broken one.
// Independent of rx: plain node:fs, no dependencies.

import { existsSync, readFileSync, readdirSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const PLUGIN_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const START = "<!-- learnings:start -->";
export const END = "<!-- learnings:end -->";
export const HEADER = ["| When you are about to… | Read |", "|---|---|"];

export class RoutesError extends Error {}

/**
 * @typedef {{ file: string, stem: string, appliesTo: string[], trigger: string, row: string }} Learning
 */

/**
 * The trigger as it appears in a row: the continuation of "When you are about to…".
 * @param {string} trigger
 */
export function rowText(trigger) {
  return trigger.replace(/^when you are about to(\s+|$)/i, "").trim();
}

/**
 * Every .md file under dir, recursively, sorted.
 * @param {string} dir
 * @returns {string[]}
 */
export function listMarkdown(dir) {
  /** @type {string[]} */
  const out = [];
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...listMarkdown(p));
    else if (name.endsWith(".md")) out.push(p);
  }
  return out;
}

/**
 * The accepted frontmatter grammar — a small, explicit YAML subset. Anything outside it is an
 * error (exit 2), never a guess:
 *   scalar      ::= "…" (escapes: exactly \\ and \" — any other backslash sequence is an error)
 *                 | '…' (with '' for one quote) | bare text
 *                   a bare scalar ends at " #" (a comment); a quoted scalar may be followed by a comment
 *                   a trigger may not contain a line break, tab or other control character
 *   applies_to  ::= flow list on the key's line  [a, "b"] [# comment]
 *                 | block sequence on the following lines, indented or not:   - a
 *                 | multi-line flow list starting on the next line:  [\n a,\n b\n]
 *   trigger     ::= scalar
 * A flow list may end with one trailing comma (YAML allows it); an empty item is an error.
 */

/**
 * Parse one scalar. Returns the decoded value; throws on an unterminated quote or on text after
 * a closing quote that is not a comment.
 * @param {string} raw
 * @param {string} where for messages
 * @returns {string}
 */
export function parseScalar(raw, where) {
  const t = raw.trim();
  if (t.startsWith('"')) {
    let out = "";
    let i = 1;
    for (; i < t.length; i++) {
      const c = t[i];
      if (c === "\\") {
        const n = t[i + 1];
        if (n === undefined) throw new RoutesError(`${where}: unterminated escape in double-quoted scalar`);
        if (n !== "\\" && n !== '"') throw new RoutesError(`${where}: unsupported escape \\${n} in double-quoted scalar; only \\\\ and \\" are allowed`);
        out += n;
        i++;
      } else if (c === '"') break;
      else out += c;
    }
    if (i >= t.length) throw new RoutesError(`${where}: unterminated double-quoted scalar`);
    rejectTrailing(t.slice(i + 1), where);
    return out;
  }
  if (t.startsWith("'")) {
    let out = "";
    let i = 1;
    for (; i < t.length; i++) {
      if (t[i] === "'") {
        if (t[i + 1] === "'") {
          out += "'";
          i++;
        } else break;
      } else out += t[i];
    }
    if (i >= t.length) throw new RoutesError(`${where}: unterminated single-quoted scalar`);
    rejectTrailing(t.slice(i + 1), where);
    return out;
  }
  // bare scalar: a comment starts at " #" (or a leading "#")
  const hash = t.startsWith("#") ? 0 : t.search(/\s#/);
  return (hash >= 0 ? t.slice(0, hash) : t).trim();
}

/**
 * After a closing quote or bracket only whitespace or a comment may follow.
 * @param {string} rest
 * @param {string} where
 */
function rejectTrailing(rest, where) {
  const r = rest.trim();
  if (r === "" || r.startsWith("#")) return;
  throw new RoutesError(`${where}: unexpected text after the value: ${JSON.stringify(r)}`);
}

/**
 * Split flow-list contents on commas outside quotes.
 * @param {string} inner
 * @returns {string[]}
 */
function splitFlowItems(inner) {
  /** @type {string[]} */
  const items = [];
  let cur = "";
  /** @type {string | null} */
  let quote = null;
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i];
    if (quote) {
      cur += c;
      if (quote === '"' && c === "\\") {
        cur += inner[i + 1] ?? "";
        i++;
      } else if (c === quote) quote = null;
    } else if (c === '"' || c === "'") {
      quote = c;
      cur += c;
    } else if (c === ",") {
      items.push(cur);
      cur = "";
    } else cur += c;
  }
  items.push(cur);
  return items;
}

/**
 * Parse a flow list `[a, "b"] # comment`. Throws unless the text is exactly one flow list
 * (optionally followed by a comment) with no empty item (one trailing comma allowed).
 * @param {string} text
 * @param {string} where
 * @returns {string[]}
 */
/**
 * One line of a multi-line flow list: the text up to any comment, the quote state it leaves open,
 * and whether an unquoted `]` appeared (the list's closing bracket).
 * @param {string} line @param {string | null} quote the quote left open by the previous line
 */
function flowLine(line, quote) {
  let text = "";
  let closes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quote) {
      if (quote === '"' && c === "\\") {
        text += c + (line[i + 1] ?? "");
        i++;
        continue;
      }
      if (c === quote) quote = null;
    } else if (c === '"' || c === "'") quote = c;
    else if (c === "#" && (i === 0 || /\s/.test(line[i - 1]))) break;
    else if (c === "]" && !closes) closes = true;
    text += c;
  }
  return { text, quote, closes };
}

export function parseFlowList(text, where) {
  const t = text.trim();
  if (!t.startsWith("[")) throw new RoutesError(`${where}: applies_to must be a list such as ["ship", "develop"]`);
  // the closing bracket is the first `]` outside quotes and outside a comment (an unquoted `#` after
  // whitespace starts one) — never a `]` inside an item or inside the comment
  let close = -1;
  /** @type {string | null} */
  let quote = null;
  for (let i = 1; i < t.length && close < 0; i++) {
    const c = t[i];
    if (quote) {
      if (quote === '"' && c === "\\") i++;
      else if (c === quote) quote = null;
    } else if (c === '"' || c === "'") quote = c;
    else if (c === "#" && /\s/.test(t[i - 1])) break;
    else if (c === "]") close = i;
  }
  if (close < 0) throw new RoutesError(`${where}: applies_to flow list never closes`);
  rejectTrailing(t.slice(close + 1), where);
  const inner = t.slice(1, close).trim();
  if (inner === "") return [];
  const parts = splitFlowItems(inner);
  if (parts.length > 1 && parts[parts.length - 1].trim() === "") parts.pop(); // one trailing comma
  return parts.map((p, i) => {
    if (p.trim() === "") throw new RoutesError(`${where}: applies_to has an empty item at position ${i + 1}`);
    return parseScalar(p, where);
  });
}

/**
 * Read the two routing keys out of a learning's YAML frontmatter, within the grammar above.
 * Keys are matched at column 0 only.
 * @param {string} text file contents
 * @param {string} file for messages
 * @returns {{ appliesTo: string[] | null, trigger: string | null }}
 */
export function parseRoutingFrontmatter(text, file) {
  const lines = text.split(/\r?\n/);
  if (lines[0] !== "---") throw new RoutesError(`${file}: no frontmatter (first line is not ---)`);
  const endIdx = lines.indexOf("---", 1);
  if (endIdx === -1) throw new RoutesError(`${file}: frontmatter never closes`);
  const fm = lines.slice(1, endIdx);
  /** @type {string[] | null} */
  let appliesTo = null;
  /** @type {string | null} */
  let trigger = null;
  let seenApplies = 0;
  let seenTrigger = 0;
  for (let i = 0; i < fm.length; i++) {
    const m = /^(applies_to|trigger):(.*)$/.exec(fm[i]);
    if (!m) continue;
    const [, key, rest] = m;
    const where = `${file}: ${key}`;
    if (key === "trigger") {
      seenTrigger++;
      trigger = parseScalar(rest, where);
      continue;
    }
    seenApplies++;
    const bare = parseScalar(rest, where); // strips a comment; "" means the value is on the next lines
    if (bare !== "" || rest.trim().startsWith("[")) {
      appliesTo = parseFlowList(rest, where);
      continue;
    }
    let j = i + 1;
    if (j < fm.length && /^\s*\[/.test(fm[j])) {
      // multi-line flow list: gather lines until the closing bracket. Each line may end in a
      // comment (an unquoted `#` after whitespace), which is dropped before joining, since a joined
      // comment would swallow every later entry; a `]` inside a comment or a quoted item (quotes
      // may span lines) does not close the list.
      let buf = "";
      let closed = false;
      /** @type {string | null} */
      let quote = null;
      for (; j < fm.length; j++) {
        const r = flowLine(fm[j], quote);
        quote = r.quote;
        buf += r.text.trim() + " ";
        if (r.closes) {
          closed = true;
          break;
        }
      }
      if (!closed) throw new RoutesError(`${where}: multi-line flow list never closes`);
      appliesTo = parseFlowList(buf, where);
      continue;
    }
    /** @type {string[]} */
    const items = [];
    for (; j < fm.length && /^\s*-(\s+|$)/.test(fm[j]); j++) {
      const item = parseScalar(fm[j].replace(/^\s*-\s*/, ""), where);
      if (item === "") throw new RoutesError(`${where}: block sequence has an empty item`);
      items.push(item);
    }
    if (items.length === 0) throw new RoutesError(`${where}: applies_to is empty`);
    appliesTo = items;
  }
  if (seenApplies > 1) throw new RoutesError(`${file}: applies_to appears ${seenApplies} times`);
  if (seenTrigger > 1) throw new RoutesError(`${file}: trigger appears ${seenTrigger} times`);
  return { appliesTo, trigger };
}

/**
 * Load every learning and validate its routing against the skills that exist.
 * @param {string} pluginDir
 * @returns {{ learnings: Learning[], skills: string[] }}
 */
export function loadCorpus(pluginDir) {
  const skillsDir = join(pluginDir, "skills");
  const skills = existsSync(skillsDir)
    ? readdirSync(skillsDir)
        .filter((n) => statSync(join(skillsDir, n)).isDirectory() && existsSync(join(skillsDir, n, "SKILL.md")))
        .sort()
    : [];
  /** @type {Learning[]} */
  const learnings = [];
  for (const file of listMarkdown(join(pluginDir, "learnings"))) {
    const rel = relative(pluginDir, file).split(sep).join("/");
    const { appliesTo, trigger } = parseRoutingFrontmatter(readFileSync(file, "utf8"), rel);
    if (appliesTo === null) throw new RoutesError(`${rel}: no applies_to; name the skill directories this learning routes into`);
    if (appliesTo.length === 0) throw new RoutesError(`${rel}: applies_to is empty`);
    for (const s of appliesTo) {
      if (!skills.includes(s)) throw new RoutesError(`${rel}: applies_to names "${s}", which is not a skill directory with a SKILL.md (have: ${skills.join(", ") || "none"})`);
    }
    if (new Set(appliesTo).size !== appliesTo.length) throw new RoutesError(`${rel}: applies_to repeats a skill`);
    if (trigger === null || trigger === "") throw new RoutesError(`${rel}: no trigger; write "when you are about to <do the thing>" in lowercase, no trailing period`);
    if (/[\x00-\x1f\x7f]/.test(trigger)) throw new RoutesError(`${rel}: trigger contains a line break, tab or control character; a trigger is one line of a table row`);
    const row = rowText(trigger);
    if (row === "") throw new RoutesError(`${rel}: trigger says nothing after "when you are about to"`);
    if (/^[A-Z]/.test(row)) throw new RoutesError(`${rel}: trigger starts with a capital letter; it continues the sentence "When you are about to…"`);
    if (row.endsWith(".")) throw new RoutesError(`${rel}: trigger ends with a period`);
    learnings.push({ file, stem: basename(file, ".md"), appliesTo, trigger, row });
  }
  return { learnings, skills };
}

/** @param {string} s */
function cell(s) {
  return s.replace(/\|/g, "\\|");
}

/**
 * The table lines for one skill.
 * @param {string} skillFile absolute path of the SKILL.md
 * @param {string} skill skill directory name
 * @param {Learning[]} learnings
 * @returns {string[]}
 */
export function renderTable(skillFile, skill, learnings) {
  const rows = learnings
    .filter((l) => l.appliesTo.includes(skill))
    .sort((a, b) => {
      const x = a.row.toLowerCase();
      const y = b.row.toLowerCase();
      return x < y ? -1 : x > y ? 1 : a.stem < b.stem ? -1 : a.stem > b.stem ? 1 : 0;
    })
    .map((l) => {
      const link = relative(dirname(skillFile), l.file).split(sep).join("/");
      return `| ${cell(l.row)} | [\`${l.stem}\`](${link}) |`;
    });
  return [...HEADER, ...rows];
}

/**
 * Replace the marker region in a SKILL.md text. Throws when the markers are missing or broken.
 * @param {string} text
 * @param {string[]} table
 * @param {string} name for messages
 * @returns {{ next: string, current: string[] }}
 */
export function replaceRegion(text, table, name) {
  const nl = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = text.split(/\r?\n/);
  const starts = lines.map((l, i) => (l === START ? i : -1)).filter((i) => i >= 0);
  const ends = lines.map((l, i) => (l === END ? i : -1)).filter((i) => i >= 0);
  if (starts.length === 0 && ends.length === 0) throw new RoutesError(`${name}: no learnings markers; wrap the routing table in ${START} / ${END}, each on its own line`);
  if (starts.length !== 1 || ends.length !== 1) throw new RoutesError(`${name}: expected exactly one ${START} and one ${END}, found ${starts.length} and ${ends.length}`);
  if (ends[0] < starts[0]) throw new RoutesError(`${name}: ${END} comes before ${START}`);
  const current = lines.slice(starts[0] + 1, ends[0]);
  const next = [...lines.slice(0, starts[0] + 1), ...table, ...lines.slice(ends[0])].join(nl);
  return { next, current };
}

/**
 * @param {string[]} argv
 * @param {{ stdout?: (s: string) => void, stderr?: (s: string) => void }} [io]
 * @returns {number}
 */
export function main(argv, io = {}) {
  const out = io.stdout ?? ((s) => process.stdout.write(s));
  const log = io.stderr ?? ((s) => process.stderr.write(s));
  let check = false;
  let pluginDir = PLUGIN_DIR;
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t === "--check") check = true;
    else if (t === "--plugin" && argv[i + 1]) pluginDir = resolve(argv[++i]);
    else {
      log(`learnings-routes: unknown argument ${JSON.stringify(t)}\n`);
      return 2;
    }
  }
  try {
    const { learnings, skills } = loadCorpus(pluginDir);
    if (skills.length === 0) throw new RoutesError(`${pluginDir}: no skills/<name>/SKILL.md found`);
    /** @type {{ skill: string, file: string, next: string, changed: boolean }[]} */
    const plans = [];
    for (const skill of skills) {
      const file = join(pluginDir, "skills", skill, "SKILL.md");
      const text = readFileSync(file, "utf8");
      const table = renderTable(file, skill, learnings);
      const { next, current } = replaceRegion(text, table, `skills/${skill}/SKILL.md`);
      plans.push({ skill, file, next, changed: current.join("\n") !== table.join("\n") });
    }
    // Every skill parsed before anything is written, so a broken skill leaves the tree untouched.
    const stale = plans.filter((p) => p.changed);
    if (check) {
      for (const p of stale) out(`learnings-routes: skills/${p.skill}/SKILL.md routing table differs from the learnings' frontmatter\n`);
      if (stale.length) {
        out(`learnings-routes: ${stale.length} stale; run node scripts/learnings-routes.mjs\n`);
        return 1;
      }
      out(`learnings-routes: ${plans.length} skill tables current (${learnings.length} learnings)\n`);
      return 0;
    }
    for (const p of plans) {
      if (!p.changed) {
        out(`learnings-routes: unchanged skills/${p.skill}/SKILL.md\n`);
        continue;
      }
      writeFileSync(p.file, p.next);
      out(`learnings-routes: wrote skills/${p.skill}/SKILL.md\n`);
    }
    return 0;
  } catch (e) {
    if (e instanceof RoutesError) {
      log(`learnings-routes: ${e.message}\n`);
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
if (invokedDirectly) process.exitCode = main(process.argv.slice(2));
