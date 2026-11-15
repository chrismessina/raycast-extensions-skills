---
title: "Keyboard.Shortcut.Common: which source was wrong when — the dated history of the linter, the docs and the runtime shim disagreeing"
date: 2026-09-15
last_updated: 2026-10-31
category: tooling-decisions
module: skills
component: development_workflow
problem_type: tooling_decision
severity: medium
applies_when:
  - "Citing a `Keyboard.Shortcut.Common` binding from the vendor docs, from `@raycast/eslint-plugin`, or from the installed app"
  - "A review finding or a lint `--fix` disagrees with the shortcut you observe in Raycast"
  - "Explaining why `prefer-common-shortcut` flagged or rewrote a shortcut"
  - "Re-verifying the shortcut table after a Raycast app update or an `@raycast/eslint-config` bump"
applies_to: ["develop", "review-pr", "api-changelog"]
trigger: "when you are about to cite a Keyboard.Shortcut.Common binding from the docs, the linter or the runtime"
tags:
  - keyboard
  - shortcuts
  - eslint-plugin
  - runtime-shim
  - vendor-docs
---

# `Keyboard.Shortcut.Common`: which source was wrong when

The policy is one sentence in
[`keyboard-conventions.md`](../../reference/keyboard-conventions.md): current vendor docs are an
acceptable source for a binding; the installed runtime shim wins any disagreement; the linter's
table is never a binding source. This file is the dated record behind that sentence, and the
extraction recipes for the two sources `rx shortcuts runtime` does not read.

## Chronology

| Date | What was observed | Standing today |
|---|---|---|
| 2026-06-19 | The conventions table was taken from the linter and carried **five wrong macOS bindings** (`CopyName`, `CopyPath`, `Duplicate`, `Pin`, `Remove`). | Superseded; the table is regenerated from an artifact, never from prose. |
| 2026-07-13 | Table re-snapshotted from `@raycast/eslint-plugin` alone. The same day, on `reader-mode`, two hand-typed literals (`⌘S` = `Common.Save`, `⌘⇧C` = `Common.Copy`) collided with existing `Common` actions; `--fix` canonicalized them and the linter was briefly blamed. | The literal-equals-constant trap is hazard 1 in the conventions file. |
| 2026-09-07 | `developers.raycast.com/api-reference/keyboard` documented `Common.Pin` as ⌘⇧P, which did not match the app. A reviewer cited it; correcting code to match cost a user-visible shortcut change, then a revert. Incident: Evidence C of [`verify-the-remedy-not-just-the-finding`](../workflow-issues/verify-the-remedy-not-just-the-finding.md). | Fixed by Raycast via `raycast/extensions` #30879 and #30538. ⌘⇧P is no longer on that page; if someone cites it, ask for the source. |
| 2026-09-11 | Against the Raycast **2.3.0.0** runtime shim and `@raycast/eslint-plugin` **2.2.0**: the linter's `COMMON_SHORTCUTS` disagreed with the runtime on **five constants** (`Duplicate` macOS, `MoveDown`, `MoveUp`, `Remove` macOS, `RemoveAll`). The 2026-07-13 linter snapshot therefore no longer matched the app. | The five rows are marked in the conventions table; the linter is not a binding source. |
| 2026-09-15 | Fetched the docs page as Markdown and compared every row against the runtime shim: **17/17 identical**, `Pin` included. Docs and runtime agree; the linter is the outlier. | Docs are an acceptable source again; the conventions file no longer tells you to distrust them. |
| 2026-09-26 | On `osaurus`, "Copy Model Card as Markdown" got a literal `⌥⌘C` in a panel whose "Copy Repo ID" already used `Common.CopyName` — which **is** `⌥⌘C`. `--fix` rewrote the literal to `Common.CopyName`; only the pre-ship Codex review caught the duplicate. | Same trap as 2026-07-13: check the table before typing a combo. |
| 2026-09-30 | Against the Raycast **2.6.0.0** shim: all 17 bindings unchanged; only the minified variable name moved (`i.Common` in 2.3.0, `A.Common` in 2.6.0). | A pinned minified name fails with a bare `AttributeError` on the next update; match any identifier. |

**What is established and what is not.** Established: at those versions the linter disagreed with
both the runtime and the published docs, which agreed with each other; two independent
Raycast-controlled sources agreeing makes the linter the outlier rather than a matter of
interpretation. *Not* established: when the split opened, or which side moved. Raycast's v2 release
note says *"Some common shortcuts have also changed on macOS to match Raycast 2.0"*, making "the app
and docs moved, the linter did not" the likely story — but that is inference. Do not cite a version
as the origin.

**A stale warning about a vendor doc is itself a hazard.** The ⌘⇧P warning kept asserting the docs
were wrong for a week after they were right, and it got repeated into `api-changelog` as
present-tense fact. Date every claim about a third-party document, and re-fetch before repeating it.

## Where each source lives, and how to read it

- **Runtime shim (authoritative).** `rx shortcuts runtime` reads the installed app's
  `@raycast/api/index.js` shim, writes the full `Common` table with the app version and a shim
  fingerprint to the cache, and `rx shortcuts check` compares an extension against it. The hand
  extraction it replaced walked the minified source for `\b\w+\.Common=\{`, balanced the braces, and
  parsed the object — extracting **all 17, not just the five known-diverging ones**, because a grep
  pinned to today's divergence list cannot show you the sixth constant that moves next. That
  directory has no `package.json` and carries no version of its own; the app version is
  `plutil -p /Applications/Raycast.app/Contents/Info.plist | grep CFBundleShortVersionString`.
  The npm `@raycast/api` ships types only and has no `index.js`, so looking there finds nothing and
  feels like confirmation.
- **Docs (acceptable cross-check).**
  `curl -sL https://developers.raycast.com/api-reference/keyboard.md | awk '/### Keyboard.Shortcut.Common/,0' | grep -E '^\|'`
  — the `.md` suffix returns raw Markdown, so the table is directly diffable. Re-fetch rather than
  trusting any note about what that page says.
- **Linter (for explaining lint behavior only).** `COMMON_SHORTCUTS` in
  `node_modules/@raycast/eslint-plugin/dist/rules/prefer-common-shortcut.js`:
  ```bash
  node --input-type=commonjs -e '
    const src = require("fs").readFileSync("node_modules/@raycast/eslint-plugin/dist/rules/prefer-common-shortcut.js","utf8");
    const list = eval(src.match(/const COMMON_SHORTCUTS = (\[[\s\S]*?\n\]);/)[1]);
    for (const c of list) console.log(c.name, "|", c.macOS.modifiers.join("+")+"+"+c.macOS.key, "|", c.Windows.modifiers.join("+")+"+"+c.Windows.key);
  '
  ```
  Consult it only to explain why `prefer-common-shortcut` flagged or rewrote something. It is not
  evidence about what a shortcut does.

**Drift guard.** Re-run the runtime extraction and the linter extraction whenever
`@raycast/eslint-config` is bumped **or the Raycast app updates**, and diff the two full 17-member
lists — watching only the linter cannot surface a runtime-only change, which is exactly how the
2026-09-11 split went unnoticed. If either set changed, update the conventions table, refresh the
divergence list, and bump its "last verified" line.
