---
name: ship
description: Get an existing Raycast extension into raycast/extensions and clean up — runs the pre-flight through `rx` (examples gate, staleness, preflight, API floor, build/tsc/lint) and records the house-style and Greptile judgment audit, submits with `npm run publish`, posts the PR body onto the draft, hands the review rounds to `raycast-pr-loop`, and sweeps after merge. Fires on "submit / publish / ship to the Store", "npm run publish", "run preflight", "check this extension", "is this ready to ship" (those three run the pre-flight and stop), or "address review feedback (metadata/screenshots)." Does NOT change code behavior — if feedback needs code, hands BACK to `develop`.
metadata:
  stage: "2a + 3 + 5 + 6 + 7 — pre-flight, compliance, PR, review, cleanup"
---

# ship

## The seam: `ship` never changes code behavior

> **Reviewing someone else's PR is not this skill.** `ship` submits *your* extension and drives
> feedback *on* it; a contributor's PR against an extension you maintain is [`review-pr`](../review-pr/SKILL.md).
> **Once the PR is open and Greptile posts, the round-by-round loop is [`raycast-pr-loop`](../raycast-pr-loop/SKILL.md).**

`ship` runs non-breaking dep hygiene, the read-only house-style audit, weeding, compliance, the
submission and the cleanup. The moment a code change is needed it **hands back to `develop`** with
context and receives the change forward again; doc-only edits stay here.

**Every mechanical check is an `rx` command, called through the plugin runner:**

```bash
node "<plugin>/scripts/rx.mjs" stale --json   # one example; any command: <command> [subcommand] [--flags]. <plugin> = two levels above this skill's base directory
```

A command prints `VERDICT  check-id  message` lines and exits 0 (PASS/WARN/N/A only), 1 (a FAIL)
or 2 (an ERROR); `--json` prints one envelope. **Branch on the exit code and quote the FAIL/ERROR
lines in the report; never re-implement a check in prose or shell.** The runner injects the preset
(`<plugin>/presets/chrismessina.json`): never pass `--preset`, never write a bare `rx …` command,
never call the retired `preflight.mjs`, `greptile-drift.mjs` or `pr-body.py`. Contracts and check
ids: [`reference/rx.md`](../../reference/rx.md); rule policy by ID: [`reference/house-style.md`](../../reference/house-style.md);
Greptile coverage and what stays judgment: [`reference/greptile-rules.md`](../../reference/greptile-rules.md).

## Documented learnings — read before the review cycle, not after it

`learnings/` holds write-ups of defects and decisions from previous runs, each with the trigger that makes it relevant. **Read the matching row before doing the thing**; rediscovering it after the review costs a round.

<!-- learnings:start -->
| When you are about to… | Read |
|---|---|
| act on the Greptile rule changes that `rx gates` (its `greptile-rules` step) or `rx greptile outdated` lists during a pre-flight | [`read-every-drifted-greptile-rule-before-the-first-publish`](../../learnings/workflow-issues/read-every-drifted-greptile-rule-before-the-first-publish.md) |
| add or edit a verboseLogging, strictRedaction, or any preference description or label | [`logger-preference-copy-and-length-measurements`](../../learnings/tooling-decisions/logger-preference-copy-and-length-measurements.md) |
| adopt @chrismessina/raycast-kit or import one of its subpaths | [`raycast-kit-adoption-and-subpath-resolution`](../../learnings/tooling-decisions/raycast-kit-adoption-and-subpath-resolution.md) |
| bump, floor, or migrate @raycast/api and want to know why the policy says what it says | [`raycast-api-policy-history`](../../learnings/tooling-decisions/raycast-api-policy-history.md) |
| comply with a review finding, answer a rating that will not clear, or act on a collision or value you cannot reproduce | [`verify-the-remedy-not-just-the-finding`](../../learnings/workflow-issues/verify-the-remedy-not-just-the-finding.md) |
| edit templates/sync-from-upstream.yml or diagnose a failed mirror sync run | [`upstream-sync-workflow-incident-history`](../../learnings/workflow-issues/upstream-sync-workflow-incident-history.md) |
| introduce a helper that encodes a rule an audit already greps for | [`audit-coupled-to-the-hand-written-form-of-a-rule`](../../learnings/workflow-issues/audit-coupled-to-the-hand-written-form-of-a-rule.md) |
| run npm or ray from anywhere but a resolved extension root | [`extension-root-npm-walks-up-and-runs-the-parent`](../../learnings/workflow-issues/extension-root-npm-walks-up-and-runs-the-parent.md) |
| start a third review pass that is finding defects in the previous pass's fixes | [`count-the-review-layers-not-the-findings`](../../learnings/workflow-issues/count-the-review-layers-not-the-findings.md) |
| triage a png, a readme, an agents.md or a contribution conflict and want the incident behind the rule | [`ship-submission-incident-history`](../../learnings/workflow-issues/ship-submission-incident-history.md) |
| verify a Store PR after publishing, or explain why it shows far more changed files than the branch touched | [`raycast-store-pr-base-diverged-fork-main`](../../learnings/workflow-issues/raycast-store-pr-base-diverged-fork-main.md) |
<!-- learnings:end -->

## The evidence contract — what authorizes a submission

The plugin's `rx guard` hook allows `npm run publish` only when **both** of these exist for the
exact tree being published, and it checks them on every attempt:

1. **A current, successful `rx gates` receipt** (`.git/rx/receipt.json`): `stale` → `scan` →
   `preflight` → `api-floor` → `build` → `tsc` → `lint`, in that order, every step present, no
   FAIL or ERROR, fingerprinted over the whole payload (ignored and untracked files included),
   HEAD, the publish range, the preset and the forbidden list. **Any change to the tree after
   `rx gates` stales the receipt** (a dep bump, a merge, a CHANGELOG edit, a holdout): re-run gates, then the audit.
2. **A valid `rx audit record`** (`.git/rx/audit.json`) tied to that receipt's fingerprint: the
   judgment evidence the receipt cannot hold. Its entries file is one JSON array carrying:
   - one **rule entry** per applicable preset rule (every non-build rule whose *Applies* holds;
     `unknown` applicability still needs one), `result` `pass` / `fail` / `n-a` with evidence.
     Severity comes from the preset: a `block` rule's `fail` blocks, a `report` rule's `fail` is
     recorded and does not, so the bar is zero *blocking* failures, not "zero violations";
   - one rule entry per **Greptile judgment rule**, id `greptile/<rule id>` (`changelog-entries`, `no-silent-failure`, …;
     take the ids from the current list, `GREPTILE_JUDGMENT_RULES` in `$RX/src/audit/greptile.mjs`, never from a count;
     `rx audit record` reports it in `data.applicable`, and `audit-coverage` FAILs naming each id missing), each read against
     the **branch diff**; all blocking (except `changelog-hardcoded-date`, report-only), since a Greptile finding at any severity holds a Store PR
     *(brew #31820, 2026-10-01: a hardcoded `toLocaleString("en-US")` passed the green script and was
     caught only when Chris asked whether the Greptile rules had run)*;
   - a **disposition** for every `stale-check` / `stale-new` / `stale-remove` / `stale-deleted` row in the receipt and every
     png `OLDER-SHOT` in this run, keyed exactly on `{ path, localHash, baseline }` as `rx stale` and
     `rx png` report them (a disposition matching nothing is itself a failure; `stale-remove` and `stale-deleted` take `remove-published` with `localHash` `"absent"`, and nothing else does);
   - a **verification** per external effect the preset's applicability detects in `src/`
     (`writes-files`, `web-requests`, `calls-ai`): the **runtime and destination evidence**. `ship`
     does not run the extension, so this is a hand-back: if the diff touches a clipboard write, a
     saved file, a Finder reveal or an `open` handoff and nobody confirmed the payload *where it
     lands*, STOP and send it to `develop`'s walk-the-states step (2026-07-26: every gate passed a
     build whose "Copy Icon" pasted a file path instead of an image).
   `record` also runs `rx shortcuts check` and `rx png` in-process and embeds them; a shortcut ERROR/FAIL or a png FAIL/ERROR blocks.

```json
[
  { "id": "copy-error", "scope": "src/**", "result": "pass", "evidence": "4 failure toasts, each paired with a Copy Error action: src/a.tsx:41, …" },
  { "id": "kit", "scope": "src/**", "result": "n-a", "evidence": "report-only; no toast or count copy changed in this branch" },
  { "id": "greptile/no-silent-failure", "scope": "branch diff", "result": "pass", "evidence": "every catch surfaces a toast or an empty state; none swallows" },
  { "path": "CHANGELOG.md", "localHash": "<git blob id: stale's .data.files[].localHash>", "baseline": "<upstream SHA: stale's .data.baseline>", "disposition": "keep-local", "reason": "published == my commit abc1234; every hunk since is this release" },
  { "path": "metadata/x-1.png", "localHash": "sha256:<png's .data.files[].localHash>", "baseline": "<provenance commit in YOUR history: png's .data.files[].baseline, not the upstream SHA>", "disposition": "keep-local", "reason": "the published shot is the one I submitted in #N; local is the retake Chris approved" },
  { "verification": "writes-files", "result": "pass", "evidence": "exported CSV opened in Numbers from ~/Downloads; 12 rows, formulas neutralized" }
]
```

**The publish sequence, in this order, from the extension root.** Each step is its **own Bash tool
invocation**: the guard reads the whole tool command, so a multi-line or compound command is `unknown`
and denied, and step 5 is the bare line `npm run publish`. (`rx holdout out` goes first: holding out changes the tree, which the receipt fingerprints.)

1. `node "<plugin>/scripts/rx.mjs" holdout out` — untracked local-only files → `.git/rx/holdout/`, with an inventory.
2. `node "<plugin>/scripts/rx.mjs" gates --forbidden "$SCRATCHPAD/forbidden.txt"`
3. `node "<plugin>/scripts/rx.mjs" shortcuts runtime` — once per installed Raycast version.
4. `WORK="$(mktemp -d "${TMPDIR:-/tmp}/rx-audit.XXXXXX")"`, write `$WORK/entries.json` (OUTSIDE the
   extension root), then `node "<plugin>/scripts/rx.mjs" audit record --entries "$WORK/entries.json" --extension-typescript` (gates already ran the build; without it a text scan can block on a shortcut that isn't there).
5. `npm run publish`
6. `node "<plugin>/scripts/rx.mjs" publication record raycast/extensions "$PR" "$REMOTE_HEAD_SHA"`, with the PR number and the head SHA of the fork branch it was opened from
7. `node "<plugin>/scripts/rx.mjs" holdout in` — restores from the inventory and verifies every entry.

Guard constraints: the publish is **exactly** `npm run publish` as the whole command (optionally
after one `cd <absolute or ./… or ../… dir> &&`; plain output redirections allowed); **any other
Bash command containing the whole word "publish" is blocked** (a commit message, an `echo`,
`npm publish`, `rtk npm run publish`: if auto mode quotes that rewrite back, resend the bare one),
as is marking a PR ready; **never write under `.git/rx/`** or hand-edit `receipt.json`,
`audit.json`, `publication.json`; an entries file in the extension root (`.git/` too) would ship, so it is `ERROR input`.

## Pre-flight (the "cake") — each layer is gardening, not engineering

−2. **USER-SUPPLIED EXAMPLES GATE — ask before any of them goes public** *(Chris, 2026-10-27)*.
   A real example Chris handed over to reproduce a bug (a URL, handle, email, post or video ID, a
   path with a name in it) is often personal and is not a fixture. **Before anything leaves the
   machine for GitHub, list every such value and everything derived from it** (shortcodes, the IDs
   or usernames an API returned for it, filenames built from it, encoded or split forms) **and get
   his explicit OK for each.** A value without his OK goes on the forbidden list, one literal per
   line, kept in the session scratchpad as `$SCRATCHPAD/forbidden.txt` (outside the extension root;
   the guard re-hashes it at publish time, so it must still exist then), and is replaced with an
   obviously fake one (`AbCdEfGhIjK`, `example_user`) everywhere, dated CHANGELOG entries included
   (the entry keeps its date; record it for `rx changelog` in a `--redactions` file). `rx scan`
   (inside `rx gates`) scans **the payload itself, not a diff of it**: file **contents and names**
   of everything `ray publish` copies (untracked and gitignored included), the **commit messages**
   in the range ray logs (`HEAD...<publish tag>`, else all history), and every `--pr-text <file>` you
   pass (each PR body, comment and bot reply, as the exact file you are about to send).
   `scan-binary` WARN lists screenshots and icons for a human look; an empty list is `N/A every
   example approved`, never PASS, so say so. Once on GitHub it cannot be fully taken back (a
   force-push leaves the commit reachable by SHA; a body keeps every revision) *(instagram-media-downloader
   #32858, 2026-10-27: a reproduction post's shortcode and its four media IDs shipped in tests, the CHANGELOG and the PR body)*.

−1. **STALENESS GATE — is the local tree behind the PUBLISHED extension?** `rx stale`, the first
   step of `rx gates`; `develop` runs the same command at its entry, so staleness is checked at
   both checkpoints. It sparse-fetches the published copy into `~/.cache/raycast-harness/upstream/`,
   compares **content** of everything the publisher copies (a name-only comparison cannot see the
   upstream edit a re-publish overwrites), fails closed on any lookup error other than a real 404,
   and classifies every differing path:

   | Result | Meaning | Action |
   | --- | --- | --- |
   | `stale-only-pub` FAIL | upstream has a file you do not | **STOP**: publishing deletes it. A file the preset's `holdout.localOnly` lists (`AGENTS.md`, …) is `stale-remove` WARN instead: disposition `remove-published` (step 3) |
   | `stale-deleted` WARN | you deleted a file the Store copy has, and its published version is in your history at that path | deliberate → disposition `remove-published` (`localHash` `"absent"`); otherwise restore it |
   | `stale-upstream` FAIL | published content is not in this path's history (a rename of yours lands here too) | **STOP**: publishing reverts their fix |
   | `stale-unhandled` FAIL | a symlink, a mode change, an undecidable line | **STOP**: classify by hand |
   | `stale-check` WARN | published == an **older** commit of yours | **disposition required**: read `git --literal-pathspecs log --oneline -- <path>` and the diff against the published copy. Yours only if the published version is the last one before your unpublished commits and every hunk is one of them; anything else is upstream → STOP |
   | `stale-new` WARN | you have a file the published tree lacks | **disposition required**: yours if untracked or added in unpublished commits (`git log --diff-filter=A`); if it predates your last merged submission, upstream deleted it → STOP. On a mirror, `.github/` and a gitignored `.claude/` are yours; whether they ship is step 3's call |
   | `stale-mine` PASS | published == your HEAD | your uncommitted update |

   **Either STOP → hand to `develop`'s staleness gate for reconciliation; do not publish.** Others
   contribute to published extensions directly in `raycast/extensions`, and the author may not know
   *(store-updates 2026-07-28: a local copy missing a shipped menu-bar command and a preference, found last; hence this check runs first)*.

   Set the published directory once for the later commands: run `node "<plugin>/scripts/rx.mjs" stale --json` and set `PUB_DIR` to its `.data.publishedDir`; it is the
   literal `null` for an unpublished extension, and then every `--published` flag below is omitted.

   **Screenshots: `node "<plugin>/scripts/rx.mjs" png --published "$PUB_DIR"`** (read-only; also
   embedded in `rx audit record`; without `--published` every file is `LOCAL-ONLY`). Raycast CI
   recompresses PNGs on merge (`oxipng -o 6 --strip safe`, `pull_request_merge.yml`, read 2026-10-18),
   so a published screenshot's bytes always differ from yours and a plain hash cannot separate "CI
   re-encoded my shot" from "someone replaced it". `rx png` decodes both copies, compares size, RGBA
   pixels and color metadata, then provenance:

   | Outcome | Case | Action |
   | --- | --- | --- |
   | `SAME-PIXELS` PASS | CI re-encoded the shot you have | **adopt the published copy** (`cp` it over yours); it is what ships, and keeping yours differs on every future run |
   | `OLDER-SHOT` WARN | the published image equals an older commit of yours; local is a different shot | **disposition required**: `keep-local` only if that commit is the shot you last submitted and local is your newer replacement. A contributor's shot pulled in by a sync, or an old shot restored upstream, lands here too → STOP |
   | `NOT-YOURS` FAIL | in none of your commits: a contributor's shot or one you never committed | **STOP**: look at both and ask Chris; keeping local reverts a contributor's shot |
   | `UNDECIDED` FAIL | 16-bit PNG (decoding to 8 bits merges distinct values) or differing `gAMA`/`iCCP`/`sRGB`/`cHRM` (same bytes render differently) | **STOP**: compare by eye and ask |
   | `LOCAL-ONLY` N/A | no published copy | keep local |

   Never blanket-adopt and never blanket-keep; `HEAD` is not a safe baseline, because committed
   new assets equal `HEAD` trivially *(karakeep 2.4.0, 2026-07-30: a `HEAD`-based script said
   "adopt upstream" for all six just-replaced screenshots and the icon; get-app-icon 2026-07-29:
   three recompressions adopted, two fresh shots kept; full accounts of these and every other
   ship-time incident: [`ship-submission-incident-history`](../../learnings/workflow-issues/ship-submission-incident-history.md))*. The same merge job adds
   `"platforms": ["macOS"]` to a `package.json` missing it: adopt that diff or declare `platforms`
   yourself. Raycast's `metadata-images` CI compares every screenshot's background with the first
   (RMS limit 12.0, single-platform only) and fails a dev icon in the bottom bar or a shot with no
   Window Capture frame; **only the files you change get pushed, so one retaken screenshot is tested
   against the old published set** *(brew #31534, 2026-09-24: `brew-4.png` scored 42.3 against the
   published `brew-1.png`)*: retake the whole set or check against the published copies.

   **If the extension has a mirror, read its sync state first** (`raycast-mirror`'s `mirror` skill):
   an open `upstream-sync` issue, a failed run or an open `sync/upstream-*` PR is a **STOP**; a green
   run is one past run, not proof, so `rx stale` still runs *(threads 2026-10-21: the sync had failed daily for a week)*.

0. **`rx gates` — the deterministic pre-flight, before reading the extension's code.** Raycast's
   reviewer applies about twenty rules that need no judgment (`$schema`, categories, `platforms`,
   preference types, CHANGELOG placeholder and order, screenshot count/format/size, icon size,
   README asset folders and relative links, unused deps, `node-fetch`, ESLint and Prettier config,
   hand-typed `Preferences`, shortcut platform-key case, the scaffolding/dev-material heuristics,
   the `agents-md-*` assertions); `rx preflight` runs them, with `--published` when `rx stale` says
   published. `rx gates` keeps the Greptile rules current, and its first step, `greptile-rules`, lists each change. Read every changed rule's text against
   this branch, write one report line each, and map it in `reference/greptile-rules.md` as a separate plugin change. `rx guard` requires the receipt, the audit and the rules in use to agree.
   **Any FAIL blocks** (config and metadata fixes here, code to `develop`); **WARN lines are judgment**: fix, or say why each stands.

   **Build, tsc and lint are separate gates**, run by `rx gates` as the steps `build`, `tsc` and
   `lint` in that order: `npm run build` first because it generates `raycast-env.d.ts`, then
   `npx tsc --noEmit` (`ray lint` never typechecks and a plain `ray build` does not either; a non-zero
   `tsc` fails even with build and lint green; house-style `tsc-gate`), then `npm run lint`.

1. **Dep hygiene** — non-breaking bumps only; major migrations are `develop`'s, gated by
   [`reference/dep-gates.md`](../../reference/dep-gates.md). **Never run bare `npm audit fix`**
   (`--dry-run` to preview only): it rewrites the lockfile transitively, so the artifact you ship
   is not the one you typechecked. `npm outdated` and `npm audit --json` to review; apply fixes
   explicitly (`npm install <pkg>@<version>`), one decision at a time; review the lockfile diff.
   **Re-run `rx gates` after any dependency change**: a green run followed by a dep mutation is a false green (the guard refuses the stale receipt anyway).

   **`@raycast/api`: `rx api-floor`** (inside `rx gates`) reads the policy from the preset.
   `api-floor-lockfile` FAIL below the floor (1.x: `1.104.25`; 2.x: `2.1.0`) blocks;
   `api-floor-new` FAIL means a never-published extension resolved to 1.x (new extensions start on
   2.x; never roll one back); `api-currency` and `api-floor-manifest` WARNs are information.
   **Submit the version the extension was last exercised in Raycast; npm's newest is advisory**:
   npm publishes ahead of the app that can run it and the Store refuses a newer declared API, so a
   ship-time bump needs a re-run in Raycast first. Crossing a major → `develop`. History:
   [`raycast-api-policy-history`](../../learnings/tooling-decisions/raycast-api-policy-history.md).

2. **House-style audit** (read-only) → the rule entries of the audit. Walk the generated matrix
   at the end of `reference/house-style.md`: for every row whose *Applies* holds (read
   `package.json` `platforms` first; absent ⇒ macOS-only; self-authored vs fork scope per row), run
   that rule's **Audit** and write `pass` / `fail` / `n-a` with evidence. A `block` failure goes to
   `develop`'s house-style audit fix; a `report` failure goes in the entry and never holds the PR alone.
   - **`copy-error` is the one most often gotten wrong:** a per-call-site pairing review. A count of
     `"Copy Error"` strings proves nothing; kit-using code has none at all.
   - **`keyboard`**: `rx shortcuts runtime` extracts the installed app's `Keyboard.Shortcut.Common`
     table; `rx shortcuts check`, embedded in `rx audit record`, resolves every panel and toast
     against it (`shortcut-ambiguous`, `shortcut-reserved`); no table while shortcuts are declared is
     `ERROR runtime evidence unavailable`. A green `ray lint` is not evidence (`@raycast/eslint-plugin`
     disagrees with the runtime on five `Common` constants and never checks the conflict invariant);
     if `ray lint --fix` touched a shortcut, say so: the three `--fix` hazards in
     `reference/keyboard-conventions.md` apply.
   - **`kit` (report only):** one line on the adoption opportunity. **Disable the Impeccable design
     hook first** if installed (`impeccable-off`), so a design false positive cannot pass for a finding.

3. **Weeding** — screenshots, README and CHANGELOG current. Self-authored only unless noted; **forks
   skip the identity items** (never add your own `AGENTS.md`, `LICENSE` or badges to an extension you do not own).
   - 🚨 **`AGENTS.md`, `CONCEPTS.md`, `CLAUDE.md` and `HANDOFF.md` never ship in a Store PR unless `ship.keep` keeps them; FRESHEN
     `AGENTS.md` / `CONCEPTS.md` in the mirror on every self-authored PR.** Greptile raised
     `AGENTS.md` as a P1 on cosign #33077 and Chris ruled (2026-11-03): *"we DO need to remove
     AGENTS.md after all."* All four stay in the mirror, listed in its **`.gitignore`**. Each part of the
     ruling has its own mechanism ([file policy](../../reference/greptile-rules.md#file-policy)): `rx holdout
     out` holds them out of the payload; `holdout-tracked` names a tracked one and its `git rm
     --cached` fix; a published one is `stale-remove`, deleted through a **`remove-published`**
     disposition; `rx pr files` accepts them only as `removed`. **A published one may stay at Chris's discretion** (2026-11-20: Greptile no longer raises a file already on `main`): ask, then list it in `ship.keep`. The freshening contract is **checked in
     pre-flight, before the holdout**: `rx preflight`'s four `agents-md-*` checks (paths, `npm run`
     scripts, no home-directory path, `symbol()`s in `src/`) plus the audit's `agents-md-claims`
     entry. For that entry, **re-read the behavioral claims about the area this branch changed against the code and
     print each cited line back**; "no changes needed" is valid only if both ran. Never invent a
     claim to fill a gap: delete the stale line and say so. Failure modes, all observed: a symbol
     moved or changed meaning; a claim quietly became false (threads: "requires `image/*` or
     `video/*`" for a release whose headline feature was audio); a deleted path; a bulk `sed` that
     made a true line false. A user-level `verify-agents-md` skill is a convenience, never the
     contract. *(digger 2026-09-04: five adversarial passes, four found a false claim; threads 2026-09-09: six false claims and a machine path shipped.)*
   - **What ships by policy and what stays out.** Contributor `docs/` (architecture, configuration,
     known issues, `docs/solutions/`; not `docs/agents/` or `docs/planning/`) and an already-published
     `LICENSE` or `CONTRIBUTING.md` ship; `TODO.md` ships on `brew` and `dev-null` only (the preset's
     `ship.keep`). Every other path an `agent-scaffolding` / `dev-material` WARN names goes in the
     extension's `.gitignore`. The `no-agent-scaffolding` entry is `pass` when, after `rx holdout
     out`, the payload holds none of the four (evidence: holdout's inventory and `agent-scaffolding`) and each
     published one has its `remove-published` disposition or is kept by `ship.keep` on Chris's say (no disposition; a changed kept file FAILs `pr-local-only`, expected, as on reader-mode). A published path outside
     `holdout.localOnly` stays `stale-only-pub` (FAIL): take it to Chris. Check the **published** directory too *(digger 2026-09-02: `.private/docs/` public since an earlier release)*. A dot-prefix is not privacy.
   - **`LICENSE` (MIT) is mandatory in every self-authored MIRROR and stays out of the Store copy
     unless already published** (`raycast/extensions`' own MIT covers every extension; Greptile's
     `no-dev-material` flags a new one), so the README's License badge links the mirror's file by
     absolute URL (`https://github.com/chrismessina/raycast-<name>/blob/main/LICENSE`); a relative
     `](LICENSE)` 404s on the Store page. Fleet debt (2026-08-29): `ios-apps`, `get-app-icon`.
   - **README** follows [`reference/readme-template.md`](../../reference/readme-template.md);
     report gaps, do not rewrite prose at ship time. `rx preflight` asserts `readme-assets` (images
     from `media/`, never `metadata/`, the checklist's own words, nor `assets/`, which ships to every
     user forever) and `readme-links` (every relative link resolves from its own directory, including
     past anything you exclude; claude-artifacts v1.0 shipped a dead `docs/shelf.md` link). Two
     judgment items go in the `readme-preamble` entry: every nav anchor resolves to a heading
     (nerd-font-picker's `#-features` against plain `## Features`, all five dead) and the badge row
     names **this** extension's slug. `.github/FUNDING.yml` is mirror-only and never a blocker.
   - **CHANGELOG: a NEW top entry carrying `{PR_MERGE_DATE}`; never touch an entry with a real
     date.** Run `node "<plugin>/scripts/rx.mjs" changelog --published "$PUB_DIR"` (add
     `--redactions <file>` when gate −2 redacted a dated entry; `rx gates` runs preflight, not this);
     exit 1 blocks. `changelog-placeholder` (exactly one, on top; two means a shipped entry got
     reverted and would re-stamp with today's date, Bookface #28961), `changelog-history` (dated
     entries byte-equal to the published copy except the recorded redactions; `N/A` without
     `--published`), `changelog-bullets` (≤ 280 chars, WARN). **The submission never carries a
     hardcoded date on the new entry.** raycastbot stamps it on the PR branch seconds before merging
     (attio #30910: bot commit 04:10:54Z, merge 04:11:29Z), so a review bot flagging "Merge Date Is
     Hardcoded" is critiquing raycastbot: answer with the commit-author receipt
     (`gh api repos/raycast/extensions/pulls/<N>/commits --jq '.[].commit.author.name'`), never
     "fix" it; the post-merge stamp is the only hand-written real date. **Entries describe what a
     user notices, not how the code works** (the `changelog-bullets` judgment entry; check them
     against the diff: get-app-icon 2026-07-30 shipped three entries describing deleted internals).
   - **Comments in the diff earn their keep.** Delete a comment the branch adds or touches that
     describes code that no longer exists ("the previous design…"), cites a gone symbol, hardcodes
     a local census ("150 of 327 apps here"), or restates the next line; one relitigating a design
     decision for the last reviewer belongs in the commit message. Verify a comment-only sweep
     changed no code (`git diff -U0`). *(get-app-icon 2026-07-30: after four review rounds, 227 comment lines against 214 of code, two stale.)*

**Any violation that needs code → STOP and hand to `develop`; never ship around it.** Then record
the audit (the evidence contract) and paste the `rx gates` and `rx audit record` output in the
report; "I ran them" is not a receipt.

## Store compliance gate

Fetch the authoritative Store docs (context7 `/llmstxt/developers_raycast_llms-full_txt`, else WebFetch); never audit from memory. Procedure and live-source precedence: [`reference/store-guidelines.md`](../../reference/store-guidelines.md).

## PR prep — the body goes onto the draft, and the PR stays a DRAFT

Title and the whole body procedure (`rx pr verify` → `rx pr files` → `rx scan` with `--pr-text` →
`rx pr body`): [`reference/pr-and-cleanup.md`](../../reference/pr-and-cleanup.md). Two rules live
here. **PR-body edit preservation**: every body write goes through `rx pr body` (`--initial` only
onto the untouched template body, `--splice` from the live body with whole-line anchors, re-read
before the single write, history check after), never a whole-body PATCH, because Chris edits the
draft by hand and a PATCH from your copy discards his screenshot and ticked boxes without an error
(brew #31534, 2026-09-24). **Draft-state ownership**: marking the PR ready is Chris's click, made
after reading the body; the guard blocks the command, and your report ends with the URL, the body
as posted, and *read it, then click "Ready for review" yourself.*

### If the draft state changed, ASK GITHUB WHO DID IT before saying anything

Chris works solo. When a PR's `draft` flips between two of your reads, **he is the overwhelmingly
likely actor**: the two of you get ahead of each other, and he marks his own submission ready
without narrating it. The race model is **human speed**: a change nobody in this session triggered
is him, until GitHub says otherwise; the exception is a change *your own actions* could have
caused, and then the timeline is the arbiter, not timing. It costs one call:

```bash
gh api "repos/raycast/extensions/issues/$PR/timeline?per_page=100" \
  -H "Accept: application/vnd.github+json" \
  --jq '.[] | select(.event=="ready_for_review" or .event=="convert_to_draft")
        | {event, actor:.actor.login, at:.created_at}'
```

- **Actor is Chris** → say nothing alarming; one line at most, only if it changes his next step
  ("PR is ready-for-review as of 00:51, so this push updates a live PR").
- **Someone else, or the timeline is empty and you cannot attribute it** → raise it, and say
  plainly that you could not attribute it.

**Do not infer the actor from timing.** brew #30598, 2026-08-27: an agent saw `draft: false` right
after its own `npm run publish`, concluded `ray publish` had flipped it, and opened its report with
a STOP; the timeline showed all three flips were Chris's, one six minutes *before* the publish.
`ray publish` prints "It will be reviewed by the Raycast team shortly" on every update whatever the
draft state, which made the wrong inference feel confirmed. The rule that stands is about *your*
actions (you never mark it ready); it is not a license to police his.

## Submission — `ray publish`

`npm run publish` (`ray publish`) **is the whole submission flow**, first submission or update,
your extension or a fork: it syncs your `<you>/extensions` fork, prepares a clone, pushes
`ext/<name>` and opens a **draft** PR against `raycast/extensions`; there is no destination to
choose. Run it only as the publish sequence above orders, with the change committed and signed. On
success relay the draft PR URL, **read the PR's file list** (`rx pr files`, the only record of what went up), and draft the body.

> 🚨 **What ships is decided in TWO steps (copy, then stage), and only the extension's own
> `.gitignore` filters both.** Read from `@raycast/api` 2.2.1: **(1) Copy** — `copyDir`
> (`dist/utils/publish/copy-dir.js`) copies the extension root into a checkout of your fork,
> skipping only `.git`, `.github`, `.direnv`, `.swiftpm`, `.raycast-swift-build`,
> `compiled_raycast_rust`, `compiled_raycast_swift`, `node_modules`, `raycast-env.d.ts`; it reads no
> ignore file, so gitignored files land in the fork checkout, and the extension's `.gitignore` is
> copied in with them. **(2) Stage** — the checkout is committed with a plain, non-forced
> `git add "<path>"` (`publish-to-public-repo.js`), which honors every `.gitignore` *inside the fork
> checkout*. So a file listed in the extension's `.gitignore` stays out of the PR unless the fork
> already tracks it (published → staged whatever `.gitignore` says); a file hidden only by
> `.git/info/exclude` (never copied) or by nothing at all ships. Publishing refuses a dirty tree, so
> an ordinary untracked file blocks rather than ships; **`rx holdout out`** moves untracked
> local-only entries (`.env`, `.claude`, `AGENTS.md`, …, per the preset) under `.git/rx/holdout/`
> with an inventory (source, destination, type, hash), never a tracked or `ship.keep` file, and
> **`rx holdout in` restores every entry and verifies it**, refusing to overwrite a changed
> destination; an empty inventory while a listed path exists is an ERROR, not "nothing to hold out"
> (#32975, 2026-10-30: an `ls` alias hid `.claude`). Keep the holdout out until `publish` and any
> `pull-contributions` merge are finished *(otty #32699, 2026-10-23: a gitignored `CLAUDE.md` and
> `TODO.md` vanished across a failed publish; recovered from file history; cause unknown)*. Verified
> 2026-10-04 on fathom (`.claude/` gitignored, absent from #31218 and #31922); karakeep 2026-08-28: a doc hidden via `.git/info/exclude` shipped, was deleted from the fork branch by API, and that
> deletion then blocked the next publish as "edits were made on your PR".

> **Deletions reach the PR on every publish except a brand-new extension's first push.** The
> "preparing extension" step `rmSync`s the extension directory in the fork clone when it already
> holds the extension, then copies your root back in (bundled CLI, same in 1.103.10 and 2.4.1;
> store-updates #31447, 2026-09-23: a locally deleted `eslint.config.mjs` arrived as `removed`). So a
> committed deletion always lands, **anything upstream has that you lack is deleted by your publish**
> (why `stale-only-pub` is a STOP), and a file leaves an open PR by deleting it on disk, committing and re-running the sequence; the fork-branch API delete is the fallback.

**Known failure — stale fork** (`error - getting fork … Sync fork dropdown … Update branch`, often
`HTTP error: 500`): routine; needs Chris's browser (fork → **Sync fork** → **Update branch**), then
re-run the sequence. The `422 … without 'workflow' scope` variant is Raycast's OAuth app being refused
when upstream's pending commits touch `.github/workflows/*`; `gh auth refresh -s workflow` and `gh repo sync`
hit the same wall, only the browser button works (it acts as Chris), and the durable fix is a scheduled `gh repo sync` workflow inside the fork. Never sync the fork with a git push: fork `main` is diverged (18 ahead, 95 behind on 2026-09-20), so that is an unasked public merge.

**Known failure — `checking for new contributions`.** Two messages, two causes. *"some
contributions are available"* means fork `main` moved (usually unrelated extensions). *"some edits
were made on your PR"* means the `ext/<name>` branch changed: your own API edit coming back, or
raycastbot's merge-time date stamp on a branch whose PR already **merged** (`rx contributions` reports
that lone stamp as `contribution-branch` WARN); `pull-contributions` then says `no new contributions` and starts no merge, which is success: re-run the sequence. **A gitignored local folder can cause it on its own.** `ray` compares against the `__raycast_latest_publish_ext/<name>__` tag, so the `.gitignore` in force is the one at that commit, and a folder only a newer `.gitignore` lists shows as untracked. Tell: upstream's copy is byte-identical to the tag's tree, and `git status --ignored --porcelain` lists the folder. `rx holdout out` moves it when the preset lists it (`.claude` is listed); otherwise hold it out of the root by hand, re-run the sequence, restore it and verify it. Do not run `pull-contributions` *(day-one #33409, 2026-11-11: `.claude/settings.local.json`, added to `.gitignore` in the same release)*. When a merge does start:

1. Commit first (`pull-contributions` merges in your working tree); `rx holdout out` stays in effect.
2. `npx @raycast/api@latest pull-contributions --non-interactive` (there is no `--dry-run`).
3. With `MERGE_HEAD` present, from the extension root:
   ```bash
   node "<plugin>/scripts/rx.mjs" contributions --published "$PUB_DIR"
   ```
   One result per conflicted path: `OURS-SAFE` (incoming == published, or every incoming CHANGELOG
   entry is already in ours byte for byte; containment decides `CHANGELOG.md` only) → take ours for
   **that file**; `REAL-CONTRIBUTION` (incoming != published) → a contributor's change: code is read
   and reconciled by hand (which side wins is judgment, recorded in the audit; a fix with no
   CHANGELOG entry is still a contribution); for `metadata/*.png` the `rx png` outcome decides
   (theirs on `SAME-PIXELS`, ours on a dispositioned `OLDER-SHOT`, ask otherwise). *(video-downloader
   #32975, 2026-10-30: two merges, one from a merged PR's leftover branch and one byte-identical to
   the published version, both lacking three shipped releases ours carried; get-app-icon #29845,
   2026-07-29: `--ours` on the CHANGELOG would have re-dated the shipped July 27 entry, `--theirs`
   on the PNGs would have reverted the new shots.)*
4. **CHANGELOG: never `git checkout --ours` and never hand-edit the markers.** Ours holds
   `{PR_MERGE_DATE}` on the new entry; theirs holds the real dates. `rx changelog` with `--merge`
   rebuilds `CHANGELOG.md` from HEAD and MERGE_HEAD by heading structure (a stamped heading and its
   placeholder form are the same entry); an ambiguous boundary is `ERROR changelog-merge` with both
   headings and nothing written: resolve that by hand.
5. `git merge --continue` (or `git commit --no-edit`), then **re-run `rx gates` and the audit**: the
   tree changed, so the earlier receipt is stale, and the guard would refuse it anyway.

**Known failure — `git checkout .` / `pathspec '.' did not match`** during the contributions check:
the first publish of an already-published extension from a monorepo clone with no local
`__raycast_latest_publish_ext/<name>__` tag, so ray falls back to the repo's root commit (raycast's
2021 initial commit, where the extension does not exist). The tag decides what ray treats as a
contribution, so seed it **only after `rx stale` is clean**, on your branch's base commit, and only
if `git diff --quiet <base> upstream/main -- ":(top)extensions/<name>"` exits 0:
`git tag -a "__raycast_latest_publish_ext/<name>__" -m "baseline" <base>`. Ray moves it with
`git tag -f` once the push succeeds (2.9.0; instagram-media-downloader #32858: fixed on the first retry).

After every publish: `rx pr verify` (author, head, draft, open, **base**: a `pr-base` FAIL is the
diverged-fork-main case, [`raycast-store-pr-base-diverged-fork-main`](../../learnings/workflow-issues/raycast-store-pr-base-diverged-fork-main.md))
and `rx pr files` (every path under `extensions/<name>/`), then the `rx publication record`
line, which `raycast-pr-loop`'s `rx greptile can-reply` reads for a `--claims-fix` reply. Identity,
base and files FAILs STOP. `pr-draft` must PASS on the PR's **first** publish; on a re-publish to a PR
Chris already submitted it FAILs by design: run the timeline query above, continue if he flipped it,
STOP only if you cannot attribute the flip. The Greptile rounds, the holdout on every re-publish, and
the three-round and no-re-review bounds are that skill's.

## Post-merge cleanup

Stamp the CHANGELOG to the merge date (only the entry that merged), push the mirror, sweep the
local branch (by PR state, never git ancestry: Raycast squash-merges), refresh "open" wording in
docs this session wrote, and on a new extension's first release run `setup-mirror.sh`:
[`reference/pr-and-cleanup.md`](../../reference/pr-and-cleanup.md) *Post-merge cleanup*.

## Throughline A (hard rail)

**Never sync the full monorepo.** `rx stale` fetches a sparse, blobless checkout of the one
extension: [`reference/sparse-checkout-discipline.md`](../../reference/sparse-checkout-discipline.md).
