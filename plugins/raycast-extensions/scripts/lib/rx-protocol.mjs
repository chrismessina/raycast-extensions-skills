// The plugin's one client for rx's machine protocol: the `--json` envelope and the command
// registry (`rx commands --json`). The runner (scripts/rx.mjs), CI (scripts/ci.mjs), the reference
// generator (scripts/rx-reference.mjs) and the call checker (scripts/rx-calls-check.mjs) all read
// rx output through these functions, so there is one interpretation of it. Pure: no process,
// no file, no network. Executable selection and the registry cache stay in the runner; a
// consumer's own pass rules (CI's "these exact ids must all PASS") stay in that consumer.
//
//   readEnvelope(processResult)          → { doc } | { problem }   (rx docs/commands.md §1, the verdict protocol)
//   readRegistry(processResult)          → { registry } | { problem }
//   globalFlags(registry)                → the flags every command and subcommand declares
//   locate(argv, registry)               → the command and subcommand an argv addresses
//   validateDocumentedCall(argv, registry) → { rule, message } | null
//
// Global flags (`--json`, `--help`, and any later one such as `--format`) are learned from the
// registry, never from a list here: rx merges them into every entry's `flags`.

/**
 * @typedef {{ code: number, stdout: string, stderr: string }} ProcessResult
 * @typedef {{ type: string, required?: boolean, repeat?: boolean, help: string, value?: string }} FlagSpec
 * @typedef {{ name: string, flags?: Record<string, FlagSpec>, subcommands?: Record<string, CommandEntry>, positionals?: { name: string, required?: boolean, help: string }[], root?: string, network?: string, state?: string, checks?: Record<string, unknown>, data?: Record<string, unknown>, summary?: string }} CommandEntry
 * @typedef {{ version: string, commands: CommandEntry[] }} Registry
 * @typedef {{ exit: number, results: { id: string, verdict: string, message: string }[], version?: unknown, data?: unknown }} Envelope
 */

export const VERDICTS = new Set(["PASS", "FAIL", "WARN", "N/A", "ERROR"]);

/** The first non-blank line of `s`, trimmed; "" when there is none. @param {string} s */
export function firstLine(s) {
  return String(s ?? "").split(/\r?\n/).find((l) => l.trim())?.trim() ?? "";
}

/**
 * The exit code rx's verdict protocol (rx docs/commands.md §1) assigns to a set of verdicts.
 * @param {{ verdict: string }[]} results
 */
export function protocolExit(results) {
  if (results.some((x) => x.verdict === "ERROR")) return 2;
  if (results.some((x) => x.verdict === "FAIL")) return 1;
  return 0;
}

/**
 * Parse rx's --json envelope and require that it is evidence: a results array of known verdicts,
 * an integer `exit` equal to the process exit code, and verdicts that imply that same exit.
 * @param {ProcessResult} r
 * @returns {{ doc: Envelope } | { problem: string }}
 */
export function readEnvelope(r) {
  /** @type {any} */
  let doc;
  try {
    doc = JSON.parse(r.stdout);
  } catch {
    return { problem: `rx printed no JSON (exit ${r.code}): ${firstLine(r.stderr) || firstLine(r.stdout) || "no output"}` };
  }
  if (!Array.isArray(doc?.results)) return { problem: "rx printed JSON with no results array" };
  const bad = doc.results.find((/** @type {any} */ x) => typeof x?.id !== "string" || !VERDICTS.has(x?.verdict));
  if (bad) return { problem: `rx printed a result without an id or a known verdict: ${JSON.stringify(bad).slice(0, 120)}` };
  if (!Number.isInteger(doc.exit)) return { problem: "rx's envelope has no integer exit" };
  if (doc.exit !== r.code) return { problem: `rx exited ${r.code} but its envelope says exit ${doc.exit}` };
  const implied = protocolExit(doc.results);
  if (implied !== doc.exit) return { problem: `rx's envelope says exit ${doc.exit} but its verdicts imply ${implied}` };
  return { doc };
}

/**
 * Is this a registry in the shape every consumer relies on: a version string and commands that
 * each have a name and a flags object? (Also the check on the runner's cached copy.)
 * @param {unknown} x
 * @returns {x is Registry}
 */
export function isRegistry(x) {
  const r = /** @type {Registry} */ (x);
  return !!r && typeof r.version === "string" && Array.isArray(r.commands) && r.commands.every((c) => !!c && typeof c.name === "string" && !!c.flags && typeof c.flags === "object");
}

/**
 * The registry from a `rx commands --json` run. Accepted only from a successful run: the process
 * exited 0, the envelope is evidence (readEnvelope) and says exit 0, its results are exactly one
 * `commands` result with verdict PASS (positive evidence, not just consistent silence), and
 * `data.commands` is in the registry shape. A saved document is passed with code 0.
 * @param {ProcessResult} r
 * @returns {{ registry: Registry } | { problem: string }}
 */
export function readRegistry(r) {
  if (r.code !== 0 && !r.stdout.trim()) return { problem: `\`rx commands --json\` failed (exit ${r.code}): ${firstLine(r.stderr)}` };
  /** @type {any} */
  let doc;
  try {
    doc = JSON.parse(r.stdout);
  } catch (e) {
    return { problem: `registry is not JSON (exit ${r.code}): ${/** @type {Error} */ (e).message}; ${firstLine(r.stderr) || firstLine(r.stdout)}` };
  }
  if (!Array.isArray(doc?.data?.commands)) return { problem: "registry document has no data.commands" };
  const e = readEnvelope(r);
  if ("problem" in e) return { problem: `registry rejected: ${e.problem}` };
  if (r.code !== 0 || doc.exit !== 0) return { problem: `registry rejected: rx exited ${r.code} and reports exit ${doc.exit}; registry data comes only from a successful run` };
  const results = e.doc.results;
  if (results.length !== 1 || results[0].id !== "commands" || results[0].verdict !== "PASS") {
    return { problem: `registry rejected: expected exactly one \`commands\` result with verdict PASS; got ${JSON.stringify(results.map((x) => `${x.id}:${x.verdict}`))}` };
  }
  const registry = { version: String(doc.version), commands: /** @type {CommandEntry[]} */ (doc.data.commands) };
  if (!isRegistry(registry)) return { problem: "registry rejected: data.commands has an unexpected shape (every command needs a name and a flags object)" };
  return { registry };
}

/**
 * Every command and subcommand entry in the registry, depth first.
 * @param {Registry} registry
 * @returns {CommandEntry[]}
 */
function entries(registry) {
  /** @type {CommandEntry[]} */
  const out = [];
  const visit = (/** @type {CommandEntry} */ c) => {
    out.push(c);
    for (const sub of Object.values(c.subcommands ?? {})) visit(sub);
  };
  for (const c of registry.commands) visit(c);
  return out;
}

/**
 * The global flags: those every command and every subcommand entry declares. rx merges its global
 * flags into each entry, so this is what the registry itself says is global.
 * @param {Registry} registry
 * @returns {Record<string, FlagSpec>}
 */
export function globalFlags(registry) {
  const all = entries(registry);
  if (all.length === 0) return {};
  const [first, ...rest] = all;
  return Object.fromEntries(Object.entries(first.flags ?? {}).filter(([n]) => rest.every((e) => Object.hasOwn(e.flags ?? {}, n))));
}

/**
 * Which command entry and subcommand entry does this argv address? Mirrors rx's own rule: the
 * subcommand is the first token that is neither a flag nor the value of a valued flag.
 * @param {string[]} argv
 * @param {Registry} registry
 * @returns {{ command: CommandEntry | null, subcommand: CommandEntry | null, subcommandToken: string | null }}
 */
export function locate(argv, registry) {
  const [name, ...rest] = argv;
  const command = name && !name.startsWith("--") ? registry.commands.find((c) => c.name === name) ?? null : null;
  if (!command || !command.subcommands || Object.keys(command.subcommands).length === 0) return { command, subcommand: null, subcommandToken: null };
  /** @type {Record<string, FlagSpec>} */
  const every = { ...globalFlags(registry), ...(command.flags ?? {}) };
  for (const sub of Object.values(command.subcommands)) for (const [n, f] of Object.entries(sub.flags ?? {})) every[n] ??= f;
  for (let i = 0; i < rest.length; i++) {
    const t = rest[i];
    if (!t.startsWith("--")) return { command, subcommand: Object.hasOwn(command.subcommands, t) ? command.subcommands[t] : null, subcommandToken: t };
    const def = every[t.split("=")[0]];
    if (def && def.type !== "boolean" && !t.includes("=")) i++;
  }
  return { command, subcommand: null, subcommandToken: null };
}

/**
 * Does this rx argv name a command, subcommand and flags the registry documents? Flag values and
 * positionals are not checked. Runner-level modes are the caller's to handle before this.
 * @param {string[]} argv rx's arguments (the command first)
 * @param {Registry} registry
 * @returns {{ rule: string, message: string } | null}
 */
export function validateDocumentedCall(argv, registry) {
  const [first] = argv;
  if (!first) return { rule: "unknown-command", message: "runner call names no command" };
  const { command, subcommand, subcommandToken } = locate(argv, registry);
  if (!command) return { rule: "unknown-command", message: `rx has no command ${JSON.stringify(first)}` };
  const subs = command.subcommands ?? {};
  const hasSubs = Object.keys(subs).length > 0;
  /** @type {Record<string, unknown>} */
  let flags = { ...globalFlags(registry), ...(command.flags ?? {}) };
  if (hasSubs) {
    if (!subcommandToken) return { rule: "missing-subcommand", message: `rx ${command.name} needs a subcommand (${Object.keys(subs).join(", ")})` };
    if (!subcommand) return { rule: "unknown-subcommand", message: `rx ${command.name} has no subcommand ${JSON.stringify(subcommandToken)} (${Object.keys(subs).join(", ")})` };
    flags = { ...flags, ...(subcommand.flags ?? {}) };
  }
  for (const t of argv.slice(1)) {
    if (!t.startsWith("--")) continue;
    const name = t.split("=")[0];
    if (Object.hasOwn(flags, name)) continue;
    const where = subcommand ? `rx ${command.name} ${subcommand.name}` : `rx ${command.name}`;
    return { rule: "unknown-flag", message: `${where} has no flag ${name}` };
  }
  return null;
}
