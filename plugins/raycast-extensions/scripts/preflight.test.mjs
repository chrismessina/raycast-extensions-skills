// Run: node --test plugins/raycast-extensions/scripts/
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { deflateSync } from "node:zlib";
import { runChecks } from "./preflight.mjs";

// A minimal valid PNG of the given size, so the screenshot check reads a real IHDR.
function png(width, height) {
  const crc = (buf) => {
    let c = ~0;
    for (const b of buf) {
      c ^= b;
      for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
    }
    return ~c >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const sum = Buffer.alloc(4);
    sum.writeUInt32BE(crc(body));
    return Buffer.concat([len, body, sum]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 0; // grayscale
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(Buffer.alloc(height * (width + 1)))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const GOOD_PKG = {
  $schema: "https://www.raycast.com/schemas/extension.json",
  name: "good",
  title: "Good Extension",
  categories: ["Productivity"],
  platforms: ["macOS"],
  commands: [{ name: "index", title: "Search Items", mode: "view" }],
  preferences: [{ name: "apiKey", title: "API Key", type: "password", required: true }],
  dependencies: { "@raycast/api": "^2.1.0" },
};

function makeExt(overrides = {}) {
  const dir = mkdtempSync(join(tmpdir(), "preflight-"));
  const files = {
    "package.json": JSON.stringify({ ...GOOD_PKG, ...(overrides.pkg || {}) }, null, 2),
    ".prettierrc": JSON.stringify({ printWidth: 120, singleQuote: false }),
    "eslint.config.js": 'const { defineConfig } = require("eslint/config");\nmodule.exports = defineConfig([]);\n',
    "CHANGELOG.md": "# Changelog\n\n## [Update] - {PR_MERGE_DATE}\n\n- New\n\n## [Initial Version] - 2026-01-02\n",
    "src/index.tsx": 'import { List, getPreferenceValues } from "@raycast/api";\nconst p = getPreferenceValues<Preferences>();\n',
    ...(overrides.files || {}),
  };
  for (const [rel, content] of Object.entries(files)) {
    if (content === null) continue;
    mkdirSync(dirname(join(dir, rel)), { recursive: true });
    writeFileSync(join(dir, rel), content);
  }
  if (!("metadata/good-1.png" in (overrides.files || {}))) {
    mkdirSync(join(dir, "metadata"), { recursive: true });
    writeFileSync(join(dir, "metadata/good-1.png"), png(2000, 1250));
  }
  return dir;
}

const failures = (dir, opts) => runChecks(dir, opts).filter((f) => f.level === "fail").map((f) => f.id);
const warnings = (dir, opts) => runChecks(dir, opts).filter((f) => f.level === "warn").map((f) => f.id);

test("a compliant extension produces no failures or warnings", () => {
  const dir = makeExt();
  assert.deepEqual(failures(dir), []);
  assert.deepEqual(warnings(dir), []);
});

test("schema: missing $schema fails", () => {
  const pkg = { ...GOOD_PKG };
  delete pkg.$schema;
  const dir = makeExt({ files: { "package.json": JSON.stringify(pkg) } });
  assert.ok(failures(dir).includes("schema"));
});

test("categories: missing, wrong case, or unknown fails; Other warns", () => {
  assert.ok(failures(makeExt({ pkg: { categories: [] } })).includes("categories"));
  assert.ok(failures(makeExt({ pkg: { categories: ["productivity"] } })).includes("categories"));
  assert.ok(failures(makeExt({ pkg: { categories: ["Developer tools"] } })).includes("categories"));
  assert.ok(warnings(makeExt({ pkg: { categories: ["Other"] } })).includes("categories"));
});

test("platforms: anything but macOS and Windows fails", () => {
  assert.ok(failures(makeExt({ pkg: { platforms: ["macOS", "Linux"] } })).includes("platforms"));
  assert.ok(!failures(makeExt({ pkg: { platforms: ["macOS", "Windows"] } })).includes("platforms"));
});

test("preference-type: number and unknown types fail, at extension and command level", () => {
  assert.ok(
    failures(makeExt({ pkg: { preferences: [{ name: "n", title: "N", type: "number", required: false }] } })).includes(
      "preference-type",
    ),
  );
  const cmd = { name: "index", title: "Search Items", mode: "view", preferences: [{ name: "x", title: "X", type: "int" }] };
  assert.ok(failures(makeExt({ pkg: { commands: [cmd] } })).includes("preference-type"));
});

test("changelog: missing file fails", () => {
  assert.ok(failures(makeExt({ files: { "CHANGELOG.md": null } })).includes("changelog-exists"));
});

test("changelog: placeholder below a dated entry, two placeholders, Unreleased, or ascending dates fail", () => {
  const cases = [
    "## [Update] - 2026-02-01\n\n## [Initial Version] - {PR_MERGE_DATE}\n",
    "## [B] - {PR_MERGE_DATE}\n\n## [A] - {PR_MERGE_DATE}\n",
    "## [Unreleased]\n\n## [Initial Version] - 2026-01-02\n",
    "## [B] - 2026-01-02\n\n## [A] - 2026-03-04\n",
  ];
  for (const log of cases) {
    assert.ok(failures(makeExt({ files: { "CHANGELOG.md": `# Changelog\n\n${log}` } })).includes("changelog-order"), log);
  }
});

test("changelog-updated: with --published, an unchanged top entry fails and a new one passes", () => {
  const published = makeExt({ files: { "CHANGELOG.md": "# Changelog\n\n## [Initial Version] - 2026-01-02\n" } });
  const same = makeExt({ files: { "CHANGELOG.md": "# Changelog\n\n## [Initial Version] - 2026-01-02\n" } });
  assert.ok(failures(same, { published }).includes("changelog-updated"));
  assert.ok(!failures(makeExt(), { published }).includes("changelog-updated"));
});

test("screenshots: a view command with no metadata PNGs fails; wrong size fails", () => {
  // Passing the key with null suppresses makeExt's default 2000x1250 screenshot.
  assert.ok(failures(makeExt({ files: { "metadata/good-1.png": null } })).includes("screenshots"));
  assert.ok(failures(makeExt({ files: { "metadata/good-1.png": png(1000, 625) } })).includes("screenshots"));
});

test("screenshots: a no-view extension needs none", () => {
  const cmd = { name: "index", title: "Do Thing", mode: "no-view" };
  assert.ok(!failures(makeExt({ pkg: { commands: [cmd] }, files: { "metadata/good-1.png": null } })).includes("screenshots"));
});

test("unused-dependencies: a dependency no source file imports fails; subpath and require count as use", () => {
  const deps = { "@raycast/api": "^2.1.0", "@raycast/utils": "^2.0.0" };
  assert.ok(failures(makeExt({ pkg: { dependencies: deps } })).includes("unused-dependencies"));
  const used = makeExt({
    pkg: { dependencies: { ...deps, lodash: "^4" } },
    files: {
      "src/a.ts": 'import { getFavicon } from "@raycast/utils/dist/x";\nconst _ = require("lodash");\n',
    },
  });
  assert.ok(!failures(used).includes("unused-dependencies"));
});

test("native-fetch: importing node-fetch fails", () => {
  const dir = makeExt({
    pkg: { dependencies: { "@raycast/api": "^2.1.0", "node-fetch": "^3" } },
    files: { "src/a.ts": 'import fetch from "node-fetch";\n' },
  });
  assert.ok(failures(dir).includes("native-fetch"));
});

test("eslint-config: legacy .eslintrc or defineConfig from 'eslint' fails", () => {
  assert.ok(failures(makeExt({ files: { ".eslintrc.json": "{}" } })).includes("eslint-config"));
  const wrong = 'import { defineConfig } from "eslint";\nexport default defineConfig([]);\n';
  assert.ok(failures(makeExt({ files: { "eslint.config.js": wrong } })).includes("eslint-config"));
  const esm = 'import { defineConfig } from "eslint/config";\nexport default defineConfig([]);\n';
  assert.ok(!failures(makeExt({ files: { "eslint.config.js": esm } })).includes("eslint-config"));
});

test("prettierrc: wrong printWidth or singleQuote fails; the four-key House Style form passes", () => {
  assert.ok(failures(makeExt({ files: { ".prettierrc": '{"printWidth":80,"singleQuote":true}' } })).includes("prettierrc"));
  const four = JSON.stringify({
    printWidth: 120,
    singleQuote: false,
    plugins: ["@ianvs/prettier-plugin-sort-imports"],
    importOrder: ["<BUILTIN_MODULES>"],
  });
  assert.ok(!failures(makeExt({ files: { ".prettierrc": four } })).includes("prettierrc"));
});

test("hand-typed-preferences: a Preferences interface or an inline getPreferenceValues type fails", () => {
  const iface = 'interface Preferences { apiKey: string }\nconst p = getPreferenceValues<Preferences>();\n';
  assert.ok(failures(makeExt({ files: { "src/a.ts": iface } })).includes("hand-typed-preferences"));
  const inline = "const { apiKey } = getPreferenceValues<{ apiKey: string }>();\n";
  assert.ok(failures(makeExt({ files: { "src/a.ts": inline } })).includes("hand-typed-preferences"));
  const scoped = "const p = getPreferenceValues<Preferences.Search>();\n";
  assert.ok(!failures(makeExt({ files: { "src/a.ts": scoped } })).includes("hand-typed-preferences"));
});

test("shortcut-platform-case: lowercase windows/macos keys fail", () => {
  const bad = 'shortcut={{ windows: { modifiers: ["ctrl"], key: "h" }, macos: { modifiers: ["cmd"], key: "h" } }}\n';
  assert.ok(failures(makeExt({ files: { "src/a.tsx": bad } })).includes("shortcut-platform-case"));
  const good = 'shortcut={{ Windows: { modifiers: ["ctrl"], key: "h" }, macOS: { modifiers: ["cmd"], key: "h" } }}\n';
  assert.ok(!failures(makeExt({ files: { "src/a.tsx": good } })).includes("shortcut-platform-case"));
});

test("title-case: lowercase significant words warn; small words and brand casing do not", () => {
  assert.ok(warnings(makeExt({ pkg: { title: "Tab width configuration" } })).includes("title-case"));
  assert.ok(!warnings(makeExt({ pkg: { title: "Search in the macOS Menu for iPhone Apps" } })).includes("title-case"));
});

test("launch-command: a Store-page link or a comment does not warn; a command deeplink does", () => {
  const storePage = 'open("raycast://extensions/someone/their-ext");\n';
  assert.ok(!warnings(makeExt({ files: { "src/a.ts": storePage } })).includes("launch-command"));
  const comment = " * Format: raycast://extensions/{author}/{extension}/{command}\n// raycast://extensions/a/b/c\n";
  assert.ok(!warnings(makeExt({ files: { "src/a.ts": comment } })).includes("launch-command"));
  const settings = '<Action.Open title="Open Preferences" target="raycast://extensions/me/ext/settings" />\n';
  assert.ok(warnings(makeExt({ files: { "src/a.tsx": settings } })).includes("launch-command"));
});

test("malformed input fails cleanly instead of crashing", () => {
  assert.ok(failures(makeExt({ files: { "package.json": '{"name":' } })).includes("package-json"));
  assert.ok(failures(makeExt({ pkg: { preferences: {} } })).includes("package-json"));
});

test("native-fetch: a dynamic import of node-fetch fails", () => {
  const src = 'const fetch = (await import("node-fetch")).default;\n';
  assert.ok(failures(makeExt({ files: { "src/a.ts": src } })).includes("native-fetch"));
});

test("shortcut-platform-case: a quoted lowercase key fails", () => {
  const src = 'shortcut={{ "windows": { modifiers: ["ctrl"], key: "h" } }}\n';
  assert.ok(failures(makeExt({ files: { "src/a.tsx": src } })).includes("shortcut-platform-case"));
});

test("changelog-order: 'Unreleased' inside an entry title is fine; an Unreleased section is not", () => {
  const ok = "# Changelog\n\n## [Fix Unreleased-Link Rendering] - {PR_MERGE_DATE}\n\n## [Initial Version] - 2026-01-02\n";
  assert.ok(!failures(makeExt({ files: { "CHANGELOG.md": ok } })).includes("changelog-order"));
  const bad = "# Changelog\n\n## Unreleased\n\n## [Initial Version] - 2026-01-02\n";
  assert.ok(failures(makeExt({ files: { "CHANGELOG.md": bad } })).includes("changelog-order"));
});

test("prettierrc: YAML syntax is accepted when the values are right, and checked when wrong", () => {
  assert.ok(!failures(makeExt({ files: { ".prettierrc": "printWidth: 120\nsingleQuote: false\n" } })).includes("prettierrc"));
  assert.ok(failures(makeExt({ files: { ".prettierrc": "printWidth: 80\nsingleQuote: true\n" } })).includes("prettierrc"));
});

test("comments are stripped lexically: trailing comments, strings containing /*, and continuation lines", () => {
  const trailing = "const x = 1; /* raycast://extensions/a/b/c */\n";
  assert.ok(!warnings(makeExt({ files: { "src/a.ts": trailing } })).includes("launch-command"));
  // A /* inside a template literal must not swallow the rest of the file.
  const template = 'const glob = `src/*.ts`;\nimport fetch from "node-fetch";\n';
  assert.ok(failures(makeExt({ files: { "src/a.ts": template } })).includes("native-fetch"));
  // A line starting with * that is multiplication, not a comment.
  const cont = 'const n = 2\n  * (await import("node-fetch")).default.length;\n';
  assert.ok(failures(makeExt({ files: { "src/a.ts": cont } })).includes("native-fetch"));
  // A regex literal containing /* is not a comment either.
  const re = 'const r = /a\\/*b/;\nimport fetch from "node-fetch";\n';
  assert.ok(failures(makeExt({ files: { "src/a.ts": re } })).includes("native-fetch"));
  // Line numbers still point at the right line after stripping a multi-line comment.
  const multi = '/*\n a\n b\n*/\nimport fetch from "node-fetch";\n';
  const f = runChecks(makeExt({ files: { "src/a.ts": multi } })).find((x) => x.id === "native-fetch");
  assert.deepEqual(f.where, ["src/a.ts:5"]);
});

test("stripComments: a regex after a keyword and nested template literals keep their content", async () => {
  const { stripComments } = await import("./preflight.mjs");
  const kw = 'function f(s) { return /[//]/.test(s) && import("node-fetch"); }';
  assert.equal(stripComments(kw), kw);
  const nested = "const u = `x ${`raycast://extensions/a/b/c`} y`; // tail";
  assert.equal(stripComments(nested), "const u = `x ${`raycast://extensions/a/b/c`} y`;        ");
  const inner = "const s = `${a /* c */ + b}`;";
  assert.equal(stripComments(inner), "const s = `${a         + b}`;");
});

test("prettierrc: YAML with quoted keys is read", () => {
  const yaml = '"printWidth": 120\n"singleQuote": false\n';
  assert.ok(!failures(makeExt({ files: { ".prettierrc": yaml } })).includes("prettierrc"));
});

test("changelog-order: a closing-ATX Unreleased heading still fails", () => {
  const log = "# Changelog\n\n## [Unreleased] ##\n\n## [Initial Version] - 2026-01-02\n";
  assert.ok(failures(makeExt({ files: { "CHANGELOG.md": log } })).includes("changelog-order"));
});

test("null members of commands or preferences fail cleanly instead of crashing", () => {
  assert.ok(failures(makeExt({ pkg: { commands: [null] } })).includes("package-json"));
  assert.ok(failures(makeExt({ pkg: { preferences: [null] } })).includes("package-json"));
});

test("comment lines never trigger a source check", () => {
  const src = "// interface Preferences { apiKey: string }\n/* import fetch from \"node-fetch\"; */\n";
  const f = failures(makeExt({ files: { "src/a.ts": src } }));
  assert.ok(!f.includes("hand-typed-preferences") && !f.includes("native-fetch"), f.join(","));
});

test("warn-only heuristics: raycast:// deeplinks, hand-built favicon URLs, shell trash, locale sniffing", () => {
  const src = [
    'open("raycast://extensions/me/ext/cmd");',
    "const icon = `https://www.google.com/s2/favicons?sz=64&domain=${d}`;",
    'execSync(`mv ${p} ~/.Trash`);',
    "const locale = navigator.language;",
  ].join("\n");
  const w = warnings(makeExt({ files: { "src/a.ts": src } }));
  for (const id of ["launch-command", "favicon", "trash", "localization"]) assert.ok(w.includes(id), id);
});
