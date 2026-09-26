#!/usr/bin/env node
// Deterministic pre-flight checks for a Raycast extension — the mechanical subset of the rules
// Raycast's Store reviewer (Greptile) applies, so they are caught before a review round instead
// of by one. Zero dependencies; run from the extension root:
//
//   node <plugin>/scripts/preflight.mjs [--published <dir>] [--json]
//
// --published points at a sparse checkout of the extension as it exists in raycast/extensions,
// which enables the "CHANGELOG has a new entry" check. Exit 1 when any check fails; warnings
// never change the exit code. Rule-by-rule rationale: reference/greptile-rules.md.

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, extname, basename, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const SCHEMA_URL = "https://www.raycast.com/schemas/extension.json";
const CATEGORIES = [
  "Applications", "Communication", "Data", "Documentation", "Design Tools", "Developer Tools", "Finance",
  "Fun", "Media", "News", "Productivity", "Security", "System", "Web", "Other",
];
const PLATFORMS = ["macOS", "Windows"];
const PREFERENCE_TYPES = ["textfield", "password", "checkbox", "dropdown", "appPicker", "file", "directory"];
const SCREENSHOT = { width: 2000, height: 1250 };
const PLACEHOLDER = "{PR_MERGE_DATE}";
// Words Title Case leaves lowercase unless they are first (AP style, as Raycast's own titles use).
const SMALL_WORDS = new Set([
  "a", "an", "and", "as", "at", "but", "by", "for", "from", "in", "into", "nor", "of", "on", "or", "per",
  "the", "to", "via", "vs", "with",
]);

function read(file) {
  try {
    return readFileSync(file, "utf8");
  } catch {
    return null;
  }
}

function sourceFiles(dir) {
  const root = join(dir, "src");
  const out = [];
  const walk = (d) => {
    let entries;
    try {
      entries = readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name === "node_modules" || e.name.startsWith(".")) continue;
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if ([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"].includes(extname(e.name))) out.push(p);
    }
  };
  walk(root);
  return out;
}

// Every match of a regex across the source tree, with a 1-based line number.
// Comment lines are skipped: a JSDoc example or commented-out code is not a finding.
function grepSources(dir, files, regex) {
  const hits = [];
  for (const file of files) {
    const lines = (read(file) ?? "").split("\n");
    let inBlock = false;
    lines.forEach((line, i) => {
      const t = line.trim();
      const comment = inBlock || t.startsWith("//") || t.startsWith("/*") || t.startsWith("*");
      if (t.startsWith("/*") && !t.includes("*/")) inBlock = true;
      if (inBlock && t.includes("*/")) inBlock = false;
      if (!comment && regex.test(line)) hits.push(`${relative(dir, file)}:${i + 1}`);
      regex.lastIndex = 0;
    });
  }
  return hits;
}

function pngSize(file) {
  const buf = readFileSync(file);
  if (buf.length < 24 || buf.readUInt32BE(0) !== 0x89504e47) return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

function changelogHeadings(text) {
  return text
    .split("\n")
    .filter((l) => /^##\s/.test(l))
    .map((l) => {
      const m = l.match(/^##\s+\[(.*?)\]\s*(?:-\s*(.+?))?\s*$/);
      return { raw: l.trim(), title: m?.[1] ?? l.replace(/^##\s+/, "").trim(), date: m?.[2]?.trim() ?? null };
    });
}

function allPreferences(pkg) {
  const arr = (v) => (Array.isArray(v) ? v : []);
  const prefs = arr(pkg.preferences).map((p) => ({ where: "extension", p }));
  for (const c of arr(pkg.commands)) for (const p of arr(c.preferences)) prefs.push({ where: `command ${c.name}`, p });
  return prefs;
}

function titleCaseProblems(title) {
  const words = title.split(/\s+/).filter(Boolean);
  const bad = [];
  words.forEach((w, i) => {
    const core = w.replace(/^[^A-Za-z]+|[^A-Za-z]+$/g, "");
    if (!core) return;
    if (/[A-Z]/.test(core)) return; // already capitalized, or brand casing like iPhone / macOS
    if (i > 0 && SMALL_WORDS.has(core.toLowerCase())) return;
    if (/^[a-z]/.test(core)) bad.push(core);
  });
  return bad;
}

export function runChecks(dir, opts = {}) {
  const findings = [];
  const add = (id, level, message, where = []) => findings.push({ id, level, message, where });
  const pkgText = read(join(dir, "package.json"));
  if (pkgText === null) {
    add("package-json", "fail", "no package.json — run from the extension root");
    return findings;
  }
  let pkg;
  try {
    pkg = JSON.parse(pkgText);
  } catch (e) {
    add("package-json", "fail", `package.json is not valid JSON: ${e.message}`);
    return findings;
  }
  const notArrays = ["commands", "preferences", "categories", "platforms"].filter(
    (k) => pkg[k] !== undefined && !Array.isArray(pkg[k]),
  );
  if (notArrays.length) add("package-json", "fail", `must be arrays in package.json: ${notArrays.join(", ")}`);
  const files = sourceFiles(dir);

  // schema — rule 16
  if (pkg.$schema !== SCHEMA_URL) add("schema", "fail", `package.json "$schema" must be "${SCHEMA_URL}"`);

  // categories — rule 10
  const cats = Array.isArray(pkg.categories) ? pkg.categories : [];
  if (!Array.isArray(cats) || cats.length === 0) add("categories", "fail", "package.json needs at least one category");
  else {
    const unknown = cats.filter((c) => !CATEGORIES.includes(c));
    if (unknown.length) add("categories", "fail", `unknown or miscased categories: ${unknown.join(", ")} (allowed: ${CATEGORIES.join(", ")})`);
    else if (cats.includes("Other")) add("categories", "warn", '"Other" is only for extensions no listed category fits');
  }

  // platforms — rule 18
  if (Array.isArray(pkg.platforms)) {
    const bad = (Array.isArray(pkg.platforms) ? pkg.platforms : [pkg.platforms]).filter((p) => !PLATFORMS.includes(p));
    if (bad.length) add("platforms", "fail", `platforms may only contain macOS and Windows; found ${bad.join(", ")}`);
  }

  // preference-type — rule 24 (there is no "number" type)
  const badPrefs = allPreferences(pkg).filter(({ p }) => !PREFERENCE_TYPES.includes(p.type));
  if (badPrefs.length)
    add("preference-type", "fail",
      `preference types must be one of ${PREFERENCE_TYPES.join(", ")}: ` +
        badPrefs.map(({ where, p }) => `${p.name} (${where}) is "${p.type}"`).join("; "));

  // title-case — rule 11 (heuristic: warn)
  const commands = Array.isArray(pkg.commands) ? pkg.commands : [];
  const titles = [["extension", pkg.title], ...commands.map((c) => [`command ${c.name}`, c.title]),
    ...allPreferences(pkg).map(({ where, p }) => [`preference ${p.name} (${where})`, p.title])];
  const untitled = titles.filter(([, t]) => typeof t === "string" && titleCaseProblems(t).length);
  if (untitled.length)
    add("title-case", "warn", "titles should be Title Case: " +
      untitled.map(([w, t]) => `${w}: "${t}" (${titleCaseProblems(t).join(", ")})`).join("; "));

  // changelog — rules 2, 7, 8
  const log = read(join(dir, "CHANGELOG.md"));
  if (log === null) add("changelog-exists", "fail", "CHANGELOG.md is missing");
  else {
    const heads = changelogHeadings(log);
    const problems = [];
    const placeholders = heads.filter((h) => h.date === PLACEHOLDER);
    if (placeholders.length > 1) problems.push(`${placeholders.length} entries use ${PLACEHOLDER}; only the new top entry may`);
    if (placeholders.length && heads[0]?.date !== PLACEHOLDER) problems.push(`${PLACEHOLDER} must be on the top entry`);
    if (heads.some((h) => /^\[?\s*unreleased\s*\]?$/i.test(h.title) || /unreleased/i.test(h.date ?? "")))
      problems.push('no "Unreleased" section — use ' + PLACEHOLDER);
    const dated = heads.map((h) => h.date).filter((d) => d && /^\d{4}-\d{2}-\d{2}$/.test(d));
    for (let i = 1; i < dated.length; i++)
      if (dated[i] > dated[i - 1]) problems.push(`dates must descend: ${dated[i - 1]} is above ${dated[i]}`);
    const malformed = heads.filter((h) => h.date && h.date !== PLACEHOLDER && !/^\d{4}-\d{2}-\d{2}$/.test(h.date));
    if (malformed.length) problems.push(`dates must be YYYY-MM-DD or ${PLACEHOLDER}: ${malformed.map((h) => h.raw).join(" | ")}`);
    if (problems.length) add("changelog-order", "fail", problems.join("; "));

    if (opts.published) {
      const pub = read(join(opts.published, "CHANGELOG.md"));
      const pubTop = pub === null ? null : changelogHeadings(pub)[0]?.raw;
      if (pubTop && heads[0]?.raw === pubTop && heads[0]?.date !== PLACEHOLDER)
        add("changelog-updated", "fail", `CHANGELOG has no new entry — the top entry is still "${pubTop}"`);
    }
  }

  // screenshots — rule 3, plus the Store's 2000×1250 requirement
  if (commands.some((c) => c.mode === "view")) {
    const metaDir = join(dir, "metadata");
    const pngs = existsSync(metaDir) ? readdirSync(metaDir).filter((f) => f.toLowerCase().endsWith(".png")) : [];
    if (!pngs.length) add("screenshots", "fail", "a view command needs at least one screenshot in metadata/");
    const wrong = pngs.filter((f) => {
      const s = pngSize(join(metaDir, f));
      return !s || s.width !== SCREENSHOT.width || s.height !== SCREENSHOT.height;
    });
    if (wrong.length) add("screenshots", "fail", `screenshots must be ${SCREENSHOT.width}×${SCREENSHOT.height} PNG: ${wrong.map((f) => `metadata/${f}`).join(", ")}`);
  }

  // unused-dependencies — rule 4
  const sources = files.map((f) => read(f) ?? "").join("\n");
  const unused = Object.keys(pkg.dependencies ?? {}).filter((dep) => {
    if (dep.startsWith("@types/")) return false;
    const esc = dep.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
    return !new RegExp(`(from\\s*|require\\(\\s*|import\\(\\s*|import\\s+)["'\`]${esc}(/[^"'\`]*)?["'\`]`).test(sources);
  });
  if (unused.length) add("unused-dependencies", "fail", `dependencies no file under src/ imports: ${unused.join(", ")}`);

  // native-fetch — rule 12
  const fetchHits = grepSources(dir, files, /(from\s*|require\(\s*|import\(\s*)["'](node-fetch|cross-fetch|isomorphic-fetch)["']/);
  if (fetchHits.length) add("native-fetch", "fail", "fetch is a global on Raycast's Node runtime; drop the polyfill import", fetchHits);

  // eslint-config — rules 5, 14
  const legacy = readdirSync(dir).filter((f) => f.startsWith(".eslintrc"));
  if (legacy.length) add("eslint-config", "fail", `legacy ESLint config ${legacy.join(", ")}; use eslint.config.js with defineConfig from "eslint/config"`);
  const flat = readdirSync(dir).find((f) => /^eslint\.config\.(c|m)?[jt]s$/.test(f));
  if (flat) {
    const src = read(join(dir, flat)) ?? "";
    if (/(from\s*|require\(\s*)["']eslint["']/.test(src) && /defineConfig/.test(src))
      add("eslint-config", "fail", `${flat} imports defineConfig from "eslint"; import it from "eslint/config"`);
    else if (!/defineConfig/.test(src)) add("eslint-config", "warn", `${flat} does not use defineConfig from "eslint/config"`);
  }

  // prettierrc — rule 9
  const prettier = read(join(dir, ".prettierrc"));
  if (prettier === null) add("prettierrc", "fail", ".prettierrc is missing (printWidth 120, singleQuote false)");
  else {
    let conf = null;
    try {
      conf = JSON.parse(prettier);
    } catch {
      // .prettierrc may be YAML; read the two keys this rule is about.
      const yaml = {};
      for (const line of prettier.split("\n")) {
        const m = line.match(/^\s*(printWidth|singleQuote)\s*:\s*([^#\s]+)/);
        if (m) yaml[m[1]] = m[1] === "printWidth" ? Number(m[2]) : m[2] === "true" ? true : m[2] === "false" ? false : m[2];
      }
      conf = Object.keys(yaml).length ? yaml : null;
      if (!conf) add("prettierrc", "fail", ".prettierrc is neither JSON nor YAML with printWidth and singleQuote");
    }
    if (conf && (conf.printWidth !== 120 || conf.singleQuote !== false))
      add("prettierrc", "fail", `.prettierrc must set printWidth 120 and singleQuote false (has ${conf.printWidth}, ${conf.singleQuote})`);
  }

  // hand-typed-preferences — rules 1, 13
  const handTyped = [
    ...grepSources(dir, files, /\b(interface|type)\s+(Preferences|Arguments)\b(?!\.)/),
    ...grepSources(dir, files, /getPreferenceValues\s*<\s*\{/),
  ];
  if (handTyped.length)
    add("hand-typed-preferences", "fail", "use the generated Preferences / Arguments types from raycast-env.d.ts", handTyped);

  // shortcut-platform-case — rule 19
  const caseHits = grepSources(dir, files, /[{,]\s*["']?(windows|macos|MacOS|Macos|MacOs)["']?\s*:\s*\{/);
  if (caseHits.length) add("shortcut-platform-case", "fail", "platform keys are Windows and macOS", caseHits);

  // warn-only heuristics — rules 6, 17, 20/34, 21
  const heuristics = [
    // Three path segments is a command deeplink; two is a Store page, which launchCommand cannot open.
    ["launch-command", /raycast:\/\/extensions\/[^/"'`\s]+\/[^/"'`\s]+\/[^/"'`\s]+/,
      "prefer launchCommand() (or openExtensionPreferences()) over a raycast://extensions/<author>/<ext>/<command> deeplink"],
    ["favicon", /google\.com\/s2\/favicons|icons\.duckduckgo\.com\/ip[23]|favicon\.yandex/,
      "prefer getFavicon() from @raycast/utils — unless this code adds validation, racing, or sources getFavicon lacks"],
    ["trash", /(exec|execSync|spawn|spawnSync|execFile)\b.*(\.Trash|\brm\s+-)/, "prefer trash() from @raycast/api over a shell command"],
    ["localization", /navigator\.language|resolvedOptions\(\)\.locale|process\.env\.LANG\b|getSystemLocale/,
      "Raycast is US English only; make locale-dependent behavior a preference"],
  ];
  for (const [id, re, msg] of heuristics) {
    const hits = grepSources(dir, files, re);
    if (hits.length) add(id, "warn", msg, hits);
  }
  return findings;
}

function main(argv) {
  const opts = {};
  let json = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--published") opts.published = resolve(argv[++i]);
    else if (argv[i] === "--json") json = true;
  }
  const dir = process.cwd();
  const findings = runChecks(dir, opts);
  if (json) console.log(JSON.stringify(findings, null, 2));
  else {
    const name = basename(dir);
    if (!findings.length) console.log(`PASS  ${name}: every deterministic pre-flight check passed`);
    for (const f of findings) {
      console.log(`${f.level.toUpperCase().padEnd(4)}  ${f.id.padEnd(24)} ${f.message}`);
      for (const w of f.where) console.log(`      ${"".padEnd(24)} ${w}`);
    }
    if (!opts.published) console.log("note  changelog-updated not checked (pass --published <dir>)");
  }
  process.exitCode = findings.some((f) => f.level === "fail") ? 1 : 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main(process.argv.slice(2));
void statSync;
