// Run: node --test plugins/raycast-extensions/scripts/learnings-routes.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { END, HEADER, PLUGIN_DIR, RoutesError, START, loadCorpus, main, parseFlowList, parseRoutingFrontmatter, parseScalar, renderTable, replaceRegion, rowText } from "./learnings-routes.mjs";

/** @param {(dir: string) => void} fn */
function withTempPlugin(fn) {
  const dir = mkdtempSync(join(tmpdir(), "learnings-routes-"));
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * @param {string} dir plugin root
 * @param {string} rel path under learnings/
 * @param {string} frontmatter YAML body between the --- lines
 */
function learning(dir, rel, frontmatter) {
  const file = join(dir, "learnings", rel);
  mkdirSync(join(file, ".."), { recursive: true });
  writeFileSync(file, `---\n${frontmatter}\n---\n\n# ${rel}\n\nbody\n`);
  return file;
}

/**
 * @param {string} dir plugin root
 * @param {string} name skill directory
 * @param {string} body SKILL.md text
 */
function skill(dir, name, body) {
  const file = join(dir, "skills", name, "SKILL.md");
  mkdirSync(join(file, ".."), { recursive: true });
  writeFileSync(file, body);
  return file;
}

const WRAPPED = `---\nname: x\n---\n\n# Skill\n\nintro\n\n${START}\n| When you are about to… | Read |\n|---|---|\n| stale row | [\`gone\`](../../learnings/old/gone.md) |\n${END}\n\nrest of the skill\n`;

/** Build a plugin with two skills and three learnings; returns the dir's paths. */
function fixture(dir) {
  skill(dir, "ship", WRAPPED);
  skill(dir, "develop", WRAPPED);
  learning(dir, "workflow-issues/beta.md", 'title: b\napplies_to: ["ship", "develop"]\ntrigger: "both skills, with a | pipe"');
  learning(dir, "design-patterns/alpha.md", "title: a\napplies_to:\n  - develop\ntrigger: 'When you are about to a block-list learning'");
  learning(dir, "design-patterns/gamma.md", 'title: g\ntags: [x, y]\napplies_to: [develop]\ntrigger: "`code` first, sorts after letters"');
}

/** @param {string[]} argv @param {string} dir */
function run(argv, dir) {
  /** @type {string[]} */
  const stdout = [];
  /** @type {string[]} */
  const stderr = [];
  const code = main([...argv, "--plugin", dir], { stdout: (s) => stdout.push(s), stderr: (s) => stderr.push(s) });
  return { code, stdout: stdout.join(""), stderr: stderr.join("") };
}

test("parseRoutingFrontmatter reads flow arrays, block lists, quotes; reports absence as null; rejects malformed", () => {
  assert.deepEqual(parseRoutingFrontmatter('---\napplies_to: ["ship", develop]\ntrigger: "t"\n---\n', "f"), { appliesTo: ["ship", "develop"], trigger: "t" });
  assert.deepEqual(parseRoutingFrontmatter("---\napplies_to:\n  - ship\n  - 'develop'\ntrigger: 't'\n---\n", "f"), { appliesTo: ["ship", "develop"], trigger: "t" });
  assert.deepEqual(parseRoutingFrontmatter("---\napplies_to:\n  [\n    ship,\n    develop,\n  ]\ntrigger: t\n---\n", "f"), { appliesTo: ["ship", "develop"], trigger: "t" });
  assert.deepEqual(parseRoutingFrontmatter("---\ntitle: no routing\n---\n", "f"), { appliesTo: null, trigger: null });
  assert.deepEqual(parseRoutingFrontmatter("---\napplies_to: []\n---\n", "f"), { appliesTo: [], trigger: null });
  assert.throws(() => parseRoutingFrontmatter("# no frontmatter\n", "f"), RoutesError);
  assert.throws(() => parseRoutingFrontmatter("---\napplies_to: [ship]\n", "f"), /never closes/);
  assert.throws(() => parseRoutingFrontmatter("---\napplies_to: ship\n---\n", "f"), /must be a list/);
  assert.throws(() => parseRoutingFrontmatter("---\napplies_to: [a]\napplies_to: [b]\n---\n", "f"), /appears 2 times/);
  assert.throws(() => parseRoutingFrontmatter("---\ntrigger: a\ntrigger: b\n---\n", "f"), /appears 2 times/);
});

test("grammar (B1-7): indentless block sequence, trailing comments, quote escapes, trailing comma; empty items and stray text are errors", () => {
  assert.deepEqual(parseRoutingFrontmatter('---\napplies_to:\n- "ship"\n- develop\ntrigger: t\n---\n', "f").appliesTo, ["ship", "develop"], "indentless block sequence");
  assert.deepEqual(parseRoutingFrontmatter('---\napplies_to: ["ship"] # routing\ntrigger: "t" # why\n---\n', "f"), { appliesTo: ["ship"], trigger: "t" }, "trailing comments");
  assert.equal(parseScalar('"say \\"hi\\" and a \\\\ slash"', "f"), 'say "hi" and a \\ slash', "double-quote escapes decoded");
  assert.equal(parseScalar("'it''s'", "f"), "it's", "doubled single quote decoded");
  assert.equal(parseScalar("bare text # comment", "f"), "bare text");
  assert.equal(parseScalar("url#fragment", "f"), "url#fragment", "# without a preceding space is not a comment");
  assert.deepEqual(parseFlowList('[ship, develop,]', "f"), ["ship", "develop"], "one trailing comma allowed");
  assert.deepEqual(parseFlowList('["a,b", c]', "f"), ["a,b", "c"], "comma inside quotes");
  assert.throws(() => parseFlowList("[ship,,develop]", "f"), /empty item at position 2/);
  assert.throws(() => parseFlowList("[,ship]", "f"), /empty item at position 1/);
  assert.throws(() => parseFlowList("[ship] trailing", "f"), /unexpected text after the value/);
  assert.throws(() => parseFlowList("[ship", "f"), /never closes/);
  assert.throws(() => parseScalar('"open', "f"), /unterminated double-quoted/);
  assert.throws(() => parseScalar("'open", "f"), /unterminated single-quoted/);
  assert.throws(() => parseScalar('"a" b', "f"), /unexpected text after the value/);
  assert.throws(() => parseRoutingFrontmatter("---\napplies_to:\n- ship\n-\n---\n", "f"), /empty item/);
  assert.throws(() => parseRoutingFrontmatter("---\napplies_to:\n  [\n    ship,\n---\n", "f"), /never closes/);
  assert.throws(() => parseRoutingFrontmatter('---\napplies_to: ["ship"] junk\n---\n', "f"), /unexpected text/);
  // B1-2: a bracket inside a trailing comment or a quoted item is not the closing delimiter
  assert.deepEqual(parseFlowList("[ship] # [ship]", "f"), ["ship"]);
  assert.deepEqual(parseFlowList('["a]b", ship] # ]', "f"), ["a]b", "ship"]);
  assert.throws(() => parseFlowList("[ship # ]", "f"), /never closes/, "a ] only inside a comment does not close the list");
  // Codex W4 r3 B1: a multi-line flow list may carry a comment after each entry, and a `]` inside a comment or a quoted item never closes it
  assert.deepEqual(parseRoutingFrontmatter('---\napplies_to:\n  [\n    ship,     # the Store PR\n    develop,  # code [sic]\n  ]\ntrigger: t\n---\n', "f").appliesTo, ["ship", "develop"], "per-entry comments");
  assert.deepEqual(parseRoutingFrontmatter('---\napplies_to:\n  [\n    "a]b",\n    ship,\n  ] # done\ntrigger: t\n---\n', "f").appliesTo, ["a]b", "ship"], "] inside a quoted item on its own line");
  assert.throws(() => parseRoutingFrontmatter('---\napplies_to:\n  [\n    ship # ]\n---\n', "f"), /never closes/, "a ] only inside a comment does not close a multi-line list");
  // B1-3: only \\\\ and \\" are escapes; nothing may smuggle a line break or control character into a row
  assert.throws(() => parseScalar('"read \\q docs"', "f"), /unsupported escape \\q/);
  assert.throws(() => parseScalar('"read\\nthen act"', "f"), /unsupported escape \\n/);
  assert.throws(() => parseScalar('"tab\\there"', "f"), /unsupported escape \\t/);
  assert.equal(parseScalar('"a\\\\b \\"c\\""', "f"), 'a\\b "c"');
});

test("rowText drops the sentence opener in either case and keeps a bare continuation", () => {
  assert.equal(rowText("when you are about to ship"), "ship");
  assert.equal(rowText("When you are about to   ship "), "ship");
  assert.equal(rowText("shipping"), "shipping");
  assert.equal(rowText("when you are about to"), "");
});

test("renderTable: header first, rows sorted by trigger case-insensitively (opener dropped), relative links, pipes escaped, header-only when nothing routes", () => {
  withTempPlugin((dir) => {
    fixture(dir);
    const { learnings } = loadCorpus(dir);
    const develop = renderTable(join(dir, "skills", "develop", "SKILL.md"), "develop", learnings);
    assert.deepEqual(develop.slice(0, 2), HEADER);
    assert.deepEqual(develop.slice(2), [
      "| `code` first, sorts after letters | [`gamma`](../../learnings/design-patterns/gamma.md) |",
      "| a block-list learning | [`alpha`](../../learnings/design-patterns/alpha.md) |",
      "| both skills, with a \\| pipe | [`beta`](../../learnings/workflow-issues/beta.md) |",
    ]);
    const ship = renderTable(join(dir, "skills", "ship", "SKILL.md"), "ship", learnings);
    assert.equal(ship.length, 3, "ship gets only beta");
    assert.match(ship[2], /^\| both skills.*\[`beta`\]/);
    assert.deepEqual(renderTable(join(dir, "skills", "ship", "SKILL.md"), "nobody", learnings), HEADER);
  });
});

test("replaceRegion swaps only the lines between the markers and rejects missing, doubled or reversed markers", () => {
  const { next, current } = replaceRegion(WRAPPED, ["T1", "T2"], "s");
  assert.deepEqual(current, ["| When you are about to… | Read |", "|---|---|", "| stale row | [`gone`](../../learnings/old/gone.md) |"]);
  assert.ok(next.includes(`${START}\nT1\nT2\n${END}\n\nrest of the skill\n`));
  assert.ok(next.startsWith("---\nname: x\n---\n\n# Skill\n\nintro\n\n"));
  assert.throws(() => replaceRegion("# nothing here\n", [], "s"), /no learnings markers/);
  assert.throws(() => replaceRegion(`${START}\n${START}\n${END}\n`, [], "s"), /exactly one/);
  assert.throws(() => replaceRegion(`${END}\nx\n${START}\n`, [], "s"), /comes before/);
  assert.throws(() => replaceRegion(`  ${START}\n${END}\n`, [], "s"), /exactly one/, "an indented marker is not a marker");
});

test("main: writes both tables, then --check passes, fails on a planted stale row naming the skill, and passes again after a rewrite", () => {
  withTempPlugin((dir) => {
    fixture(dir);
    let r = run(["--check"], dir);
    assert.equal(r.code, 1, r.stdout);
    assert.match(r.stdout, /skills\/develop\/SKILL\.md routing table differs/);
    assert.match(r.stdout, /skills\/ship\/SKILL\.md routing table differs/);
    r = run([], dir);
    assert.equal(r.code, 0);
    assert.match(r.stdout, /wrote skills\/develop\/SKILL\.md/);
    assert.match(r.stdout, /wrote skills\/ship\/SKILL\.md/);
    const develop = join(dir, "skills", "develop", "SKILL.md");
    const text = readFileSync(develop, "utf8");
    assert.ok(text.includes("| a block-list learning | [`alpha`](../../learnings/design-patterns/alpha.md) |"));
    assert.ok(!text.includes("stale row"), "the hand-written row is gone");
    assert.ok(text.endsWith("rest of the skill\n"), "text after the region is intact");
    r = run(["--check"], dir);
    assert.equal(r.code, 0, r.stdout);
    assert.match(r.stdout, /2 skill tables current \(3 learnings\)/);
    r = run([], dir);
    assert.match(r.stdout, /unchanged skills\/develop\/SKILL\.md/);
    // plant a stale row in one skill only
    writeFileSync(develop, text.replace("| a block-list learning |", "| an edited trigger |"));
    r = run(["--check"], dir);
    assert.equal(r.code, 1);
    assert.match(r.stdout, /skills\/develop\/SKILL\.md routing table differs/);
    assert.doesNotMatch(r.stdout, /skills\/ship\/SKILL\.md routing table differs/);
    assert.match(r.stdout, /1 stale/);
    r = run([], dir);
    assert.equal(r.code, 0);
    assert.equal(run(["--check"], dir).code, 0);
  });
});

test("main: exit 2, nothing written, for each malformed corpus shape", () => {
  /** @param {(dir: string) => void} plant @param {RegExp} message */
  function expectTwo(plant, message) {
    withTempPlugin((dir) => {
      fixture(dir);
      plant(dir);
      const before = readFileSync(join(dir, "skills", "ship", "SKILL.md"), "utf8");
      const r = run([], dir);
      assert.equal(r.code, 2, `${message}: ${r.stdout}${r.stderr}`);
      assert.match(r.stderr, message);
      assert.equal(readFileSync(join(dir, "skills", "ship", "SKILL.md"), "utf8"), before, "nothing was written");
      assert.equal(run(["--check"], dir).code, 2);
    });
  }
  expectTwo((d) => learning(d, "x/no-applies.md", 'title: x\ntrigger: "t"'), /no applies_to/);
  expectTwo((d) => learning(d, "x/empty.md", 'title: x\napplies_to: []\ntrigger: "t"'), /applies_to is empty/);
  expectTwo((d) => learning(d, "x/unknown.md", 'title: x\napplies_to: ["screenshots"]\ntrigger: "t"'), /names "screenshots", which is not a skill directory/);
  expectTwo((d) => learning(d, "x/repeat.md", 'title: x\napplies_to: ["ship", "ship"]\ntrigger: "t"'), /repeats a skill/);
  expectTwo((d) => learning(d, "x/no-trigger.md", 'title: x\napplies_to: ["ship"]'), /no trigger/);
  expectTwo((d) => learning(d, "x/caps.md", 'title: x\napplies_to: ["ship"]\ntrigger: "Shipping"'), /capital letter/);
  expectTwo((d) => learning(d, "x/caps2.md", 'title: x\napplies_to: ["ship"]\ntrigger: "when you are about to Ship"'), /capital letter/);
  expectTwo((d) => learning(d, "x/opener-only.md", 'title: x\napplies_to: ["ship"]\ntrigger: "when you are about to"'), /says nothing after/);
  expectTwo((d) => learning(d, "x/period.md", 'title: x\napplies_to: ["ship"]\ntrigger: "shipping."'), /ends with a period/);
  expectTwo((d) => learning(d, "x/scalar.md", "title: x\napplies_to: ship\ntrigger: t"), /must be a list/);
  expectTwo((d) => learning(d, "x/double-comma.md", 'title: x\napplies_to: [ship,,develop]\ntrigger: "t"'), /empty item at position 2/);
  expectTwo((d) => learning(d, "x/unterminated.md", 'title: x\napplies_to: ["ship"]\ntrigger: "open'), /unterminated double-quoted/);
  expectTwo((d) => learning(d, "x/escape.md", 'title: x\napplies_to: ["ship"]\ntrigger: "read \\q docs"'), /unsupported escape \\q/);
  expectTwo((d) => learning(d, "x/newline.md", 'title: x\napplies_to: ["ship"]\ntrigger: "read\\nthen act"'), /unsupported escape \\n/);
  expectTwo((d) => learning(d, "x/tab.md", 'title: x\napplies_to: ["ship"]\ntrigger: "a\tb"'), /line break, tab or control character/);
  expectTwo((d) => writeFileSync(join(d, "learnings", "x.md"), "# no frontmatter at all\n"), /no frontmatter/);
  expectTwo((d) => skill(d, "screenshots", "---\nname: s\n---\n\n# No table here\n"), /skills\/screenshots\/SKILL\.md: no learnings markers/);
  expectTwo((d) => skill(d, "ship", `${START}\n${END}\n${END}\n`), /expected exactly one/);
  withTempPlugin((dir) => {
    fixture(dir);
    const r = run(["--bogus"], dir);
    assert.equal(r.code, 2);
    assert.match(r.stderr, /unknown argument/);
  });
  withTempPlugin((dir) => {
    const r = run([], dir);
    assert.equal(r.code, 2);
    assert.match(r.stderr, /no skills/);
  });
});

test("live corpus: every learning in this plugin carries valid applies_to and trigger that name real skills", () => {
  const { learnings, skills } = loadCorpus(PLUGIN_DIR);
  assert.ok(learnings.length >= 19, `expected the corpus, found ${learnings.length}`);
  assert.ok(skills.includes("ship") && skills.includes("develop"));
  for (const l of learnings) {
    assert.ok(l.appliesTo.length > 0, l.stem);
    assert.ok(!/\|/.test(l.stem));
  }
});

// No skip: a missing marker pair is an integration error (the generator exits 2), and this is the
// only test CI and pre-push run for it, so it must FAIL rather than skip.
test("live tree: every skill has its marker pair and its routing table is current (--check)", () => {
  /** @type {string[]} */
  const stdout = [];
  const code = main(["--check"], { stdout: (s) => stdout.push(s), stderr: (s) => stdout.push(s) });
  assert.equal(code, 0, `${stdout.join("")}\nrun: node scripts/learnings-routes.mjs`);
});
