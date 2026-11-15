// Run: node --test plugins/raycast-extensions/scripts/lib/rx-protocol.test.mjs
// The shared rx protocol client. Pure functions over saved process results; no rx, no network.
import { test } from "node:test";
import assert from "node:assert/strict";
import { globalFlags, isRegistry, locate, protocolExit, readEnvelope, readRegistry, validateDocumentedCall } from "./rx-protocol.mjs";

const G = { "--json": { type: "boolean", help: "" }, "--help": { type: "boolean", help: "" } };
/** @type {import("./rx-protocol.mjs").Registry} */
const REGISTRY = {
  version: "0.1.0",
  commands: [
    { name: "doctor", flags: { "--root": { type: "string", help: "" }, ...G }, subcommands: {} },
    { name: "preflight", flags: { "--root": { type: "string", help: "" }, "--preset": { type: "string", help: "" }, ...G }, subcommands: {} },
    {
      name: "holdout",
      flags: { ...G },
      subcommands: {
        out: { name: "out", flags: { "--root": { type: "string", help: "" }, "--preset": { type: "string", help: "" }, ...G } },
        in: { name: "in", flags: { "--root": { type: "string", help: "" }, ...G } },
      },
    },
  ],
};

/** A registry in which rx has added one more global flag to every entry, as `--format` will be. */
const WITH_FORMAT = /** @type {typeof REGISTRY} */ (
  JSON.parse(JSON.stringify(REGISTRY, (k, v) => (k === "flags" ? { ...v, "--format": { type: "string", value: "<fmt>", help: "" } } : v)))
);

/** @param {object} doc @param {number} [code] */
const proc = (doc, code = 0) => ({ code, stdout: JSON.stringify(doc), stderr: "" });
const OK_DOC = { command: "commands", version: "0.1.0", exit: 0, data: { commands: REGISTRY.commands }, results: [{ id: "commands", verdict: "PASS", message: "3 commands" }] };

test("protocolExit: ERROR 2, FAIL 1, else 0", () => {
  assert.equal(protocolExit([{ verdict: "PASS" }, { verdict: "ERROR" }, { verdict: "FAIL" }]), 2);
  assert.equal(protocolExit([{ verdict: "WARN" }, { verdict: "FAIL" }]), 1);
  assert.equal(protocolExit([{ verdict: "N/A" }]), 0);
});

test("readEnvelope requires evidence: JSON, known verdicts, an integer exit equal to the process exit and implied by the verdicts", () => {
  assert.ok("doc" in readEnvelope(proc({ exit: 1, results: [{ id: "a", verdict: "FAIL" }] }, 1)));
  assert.match(/** @type {any} */ (readEnvelope({ code: 2, stdout: "ERROR args", stderr: "" })).problem, /no JSON \(exit 2\): ERROR args/);
  assert.match(/** @type {any} */ (readEnvelope(proc({ exit: 0 }))).problem, /no results array/);
  assert.match(/** @type {any} */ (readEnvelope(proc({ exit: 0, results: [{ id: "a", verdict: "OK" }] }))).problem, /known verdict/);
  assert.match(/** @type {any} */ (readEnvelope(proc({ results: [] }))).problem, /no integer exit/);
  assert.match(/** @type {any} */ (readEnvelope(proc({ exit: 0, results: [] }, 2))).problem, /exited 2 but its envelope says exit 0/);
  assert.match(/** @type {any} */ (readEnvelope(proc({ exit: 0, results: [{ id: "a", verdict: "ERROR" }] }))).problem, /verdicts imply 2/);
});

test("readRegistry accepts only a successful run with exactly one `commands` PASS and registry-shaped data", () => {
  const ok = readRegistry(proc(OK_DOC));
  assert.ok("registry" in ok);
  assert.deepEqual(ok.registry, { version: "0.1.0", commands: REGISTRY.commands });
  assert.match(/** @type {any} */ (readRegistry({ code: 2, stdout: "", stderr: "boom\n" })).problem, /failed \(exit 2\): boom/);
  assert.match(/** @type {any} */ (readRegistry({ code: 0, stdout: "nope", stderr: "" })).problem, /not JSON/);
  assert.match(/** @type {any} */ (readRegistry(proc({ ...OK_DOC, data: {} }))).problem, /no data\.commands/);
  assert.match(/** @type {any} */ (readRegistry(proc(OK_DOC, 2))).problem, /exited 2 but its envelope says exit 0/);
  assert.match(/** @type {any} */ (readRegistry(proc({ ...OK_DOC, results: [] }))).problem, /exactly one `commands` result with verdict PASS/);
  assert.match(/** @type {any} */ (readRegistry(proc({ ...OK_DOC, results: [{ id: "commands", verdict: "WARN", message: "" }] }))).problem, /exactly one `commands` result/);
  assert.match(/** @type {any} */ (readRegistry(proc({ ...OK_DOC, data: { commands: [{ name: "doctor" }] } }))).problem, /unexpected shape/);
});

test("isRegistry: a version and commands that each have a name and a flags object", () => {
  assert.equal(isRegistry(REGISTRY), true);
  assert.equal(isRegistry({ version: "1", commands: [{ name: "x" }] }), false);
  assert.equal(isRegistry({ commands: [] }), false);
  assert.equal(isRegistry(null), false);
});

test("globalFlags are learned from the registry: the flags every command and subcommand declares", () => {
  assert.deepEqual(Object.keys(globalFlags(REGISTRY)).sort(), ["--help", "--json"]);
  assert.deepEqual(Object.keys(globalFlags(WITH_FORMAT)).sort(), ["--format", "--help", "--json"], "a new global appears with no change here");
  assert.deepEqual(globalFlags({ version: "1", commands: [] }), {});
});

test("locate mirrors rx's subcommand rule, skipping a valued global flag's value", () => {
  assert.equal(locate(["holdout", "--root", "out", "in"], REGISTRY).subcommandToken, "in");
  assert.equal(locate(["holdout", "--root=x", "out"], REGISTRY).subcommandToken, "out");
  assert.equal(locate(["holdout", "--json", "out"], REGISTRY).subcommand?.name, "out");
  assert.equal(locate(["holdout", "--json"], REGISTRY).subcommandToken, null);
  assert.equal(locate(["--help"], REGISTRY).command, null);
  assert.equal(locate(["nope"], REGISTRY).command, null);
  assert.equal(locate(["holdout", "--format", "md", "out"], WITH_FORMAT).subcommand?.name, "out", "--format's value is not the subcommand");
});

test("validateDocumentedCall: commands, subcommands and flags against the registry, globals included", () => {
  assert.equal(validateDocumentedCall(["preflight", "--root", ".", "--json"], REGISTRY), null);
  assert.equal(validateDocumentedCall(["holdout", "--root", ".", "out", "--preset", "p"], REGISTRY), null);
  assert.equal(validateDocumentedCall([], REGISTRY)?.rule, "unknown-command");
  assert.equal(validateDocumentedCall(["bogus"], REGISTRY)?.rule, "unknown-command");
  assert.equal(validateDocumentedCall(["holdout"], REGISTRY)?.rule, "missing-subcommand");
  assert.equal(validateDocumentedCall(["holdout", "sideways"], REGISTRY)?.rule, "unknown-subcommand");
  assert.equal(validateDocumentedCall(["holdout", "in", "--preset", "p"], REGISTRY)?.rule, "unknown-flag", "a sibling's flag is not this subcommand's");
  assert.equal(validateDocumentedCall(["doctor", "--format", "md"], REGISTRY)?.rule, "unknown-flag", "not a flag this registry declares");
  assert.equal(validateDocumentedCall(["doctor", "--format", "md"], WITH_FORMAT), null, "the same call is valid once the registry declares --format globally");
  assert.equal(validateDocumentedCall(["doctor", "--constructor"], REGISTRY)?.rule, "unknown-flag", "own flags only, never inherited names");
});
