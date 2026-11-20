// Tests for pin-rx.mjs: the pin and reference/rx.md change only after npm served that exact version.

import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { main } from "./pin-rx.mjs";

/** A registry document as `rx commands --json` prints it. @param {string} version */
const doc = (version) => ({ command: "commands", version, fingerprint: null, exit: 0, data: { commands: [{ name: "guard", summary: "the hook", flags: {} }] }, results: [{ id: "commands", verdict: "PASS", message: "" }] });
/** Fake-tool source that prints `value` as JSON. @param {unknown} value */
const prints = (value) => `process.stdout.write(${JSON.stringify(JSON.stringify(value))})`;
/** The fake npx refuses to answer from a directory with anything in it (a local install could). */
const EMPTY_CWD = 'if (require("node:fs").readdirSync(process.cwd()).length) { process.stderr.write("cwd not empty\\n"); process.exit(1); }';

/**
 * Run pin-rx with fake `npm` and `npx` first on PATH, against temp copies of the pin and the
 * reference. @param {{ npm: string, npx: string, versionIsDir?: boolean }} fakes node source per tool
 */
async function pin(fakes, version = "0.2.0") {
  const dir = mkdtempSync(join(tmpdir(), "pin-rx-test-"));
  try {
    mkdirSync(join(dir, "bin"));
    for (const [tool, body] of Object.entries({ npm: fakes.npm, npx: `${EMPTY_CWD}\n${fakes.npx}` })) {
      writeFileSync(join(dir, "bin", tool), `#!${process.execPath}\n${body}\n`);
      chmodSync(join(dir, "bin", tool), 0o755);
    }
    const files = join(dir, "files");
    mkdirSync(files);
    const versionFile = join(files, "rx-version.json");
    const referenceFile = join(files, "rx.md");
    if (fakes.versionIsDir) mkdirSync(join(versionFile, "x"), { recursive: true });
    else writeFileSync(versionFile, '{\n  "version": "0.1.0"\n}\n');
    writeFileSync(referenceFile, "old reference\n");
    /** @type {string[]} */
    const err = [];
    const code = await main([version], { env: { ...process.env, PATH: join(dir, "bin") + delimiter + process.env.PATH }, versionFile, referenceFile, stdout: () => {}, stderr: (s) => err.push(s) });
    return {
      code,
      pin: fakes.versionIsDir ? null : readFileSync(versionFile, "utf8"),
      reference: readFileSync(referenceFile, "utf8"),
      leftovers: readdirSync(files).filter((f) => f.includes(".pin-rx-")),
      err: err.join(""),
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const listed = prints("0.2.0");
const serves = prints(doc("0.2.0"));

test("pin-rx writes the pin and the reference when the registry lists the version and npx serves it", async () => {
  const r = await pin({ npm: listed, npx: serves });
  assert.equal(r.code, 0, r.err);
  assert.equal(r.pin, '{\n  "version": "0.2.0"\n}\n');
  assert.match(r.reference, /Pinned version: \*\*0\.2\.0\*\*/);
  assert.deepEqual(r.leftovers, []);
});

test("pin-rx changes nothing when the registry or npx does not serve that exact version (Codex r6 R6-1)", async () => {
  /** @type {Record<string, { npm: string, npx: string }>} */
  const cases = {
    "not in the registry": { npm: 'process.stderr.write("npm error code E404\\n"); process.exit(1)', npx: serves },
    "registry lists another version": { npm: prints("0.1.9"), npx: serves },
    "npx fails": { npm: listed, npx: 'process.stderr.write("npm error code ETARGET\\n"); process.exit(1)' },
    "npx serves another version": { npm: listed, npx: prints(doc("0.1.9")) },
    "npx answers garbage": { npm: listed, npx: 'process.stdout.write("not json")' },
  };
  for (const [label, fakes] of Object.entries(cases)) {
    const r = await pin(fakes);
    assert.equal(r.code, 1, label);
    assert.equal(r.pin, '{\n  "version": "0.1.0"\n}\n', label);
    assert.equal(r.reference, "old reference\n", label);
    assert.match(r.err, /the pin is unchanged/, label);
  }
});

test("pin-rx puts the reference back when the pin cannot be replaced (Codex r6 R6-2)", async () => {
  const r = await pin({ npm: listed, npx: serves, versionIsDir: true });
  assert.equal(r.code, 1, r.err);
  assert.equal(r.reference, "old reference\n");
  assert.deepEqual(r.leftovers, []);
  assert.match(r.err, /writing the files failed/);
});

test("pin-rx refuses anything but one exact version", async () => {
  for (const argv of [[], ["latest"], ["0.2"], ["0.2.0", "extra"]]) assert.equal(await main(argv, { stderr: () => {} }), 2, JSON.stringify(argv));
});
