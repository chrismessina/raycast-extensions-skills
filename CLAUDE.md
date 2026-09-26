# CLAUDE.md

Guidance for agents working in this repo. The README is the human-facing manual.

## What this is

Source for the **`raycast-extensions` Claude Code plugin** (`plugins/raycast-extensions/`), plus
the learnings the skills cite (`plugins/raycast-extensions/learnings/`) and derived `@raycast/api` release notes
(`docs/reference/`). It is not a Raycast extension — there is no `ray build` here, and
`package.json` is `private: true` with Prettier as its only dependency.

## Editing the plugin

**A local-directory marketplace loads the plugin in place from this checkout.** An edit to a
`SKILL.md` reaches the next session, or the current one after `/reload-plugins` — not before. So
the skill already loaded in this session is the pre-edit version: do not verify an edit by
invoking the skill without reloading first. (Verified 2026-09-22 on Claude Code 2.1.280: a marker
added to a skill description appeared in a fresh session while the copy under
`~/.claude/plugins/cache/` did not have it. That cache copy is what GitHub installs run, not
what a local checkout runs.)

Bump `version` in **both** `plugins/raycast-extensions/.claude-plugin/plugin.json` and
`.claude-plugin/marketplace.json` for a release, so GitHub installs see an update, and keep the
README's `**Status:**` line in step. **Run `bash check-references.sh` after touching any skill, reference, manifest, or
the README** — it fails on a dangling `reference/X.md` pointer, a skill missing from the README
table or either manifest description, a version mismatch, a learning no skill or reference
cites, and a relative link that does not resolve. Exit 0 = clean.

## `scripts/preflight.mjs`

The deterministic half of Raycast's Store-review rules, run by `ship` before anything is read —
the mapping from each rule to its check is `plugins/raycast-extensions/reference/greptile-rules.md`.
Zero dependencies, so it runs from any extension root. **Add a check here, not prose to a skill,
whenever a rule can be decided mechanically**, with a failing test first in
`scripts/preflight.test.mjs` (`node --test plugins/raycast-extensions/scripts/preflight.test.mjs`;
CI runs it). Then run it across real extension checkouts before trusting it: a check that fires on
compliant code costs a review round on every extension it touches.

## `learnings/`

The learnings live **inside the plugin** so they ship with every install and the skills can
link them by relative path. A learning that only a folder listing points at gets rediscovered
after the review instead of read before the work, so each one is cited in a *When you are about
to… / Read* table in the skill it serves, or inline in the House Style rule it backs.
`check-references.sh` fails on a learning nothing cites.


Filed by category with YAML frontmatter (`module`, `component`, `problem_type`, `tags`); array
items are double-quoted. Match the existing vocabulary (`component: development_workflow`,
`module: publishing`, `module: skills`). `CONCEPTS.md` defines the shared terms. A learning nothing
points at does not compound: add a new one to the trigger table of the skill it serves, in the
same change that adds the file.

Cite code in public repos by GitHub URL, and files in this repo by relative path. Never by a
machine-local absolute path: this repo is public.

## Conventions

- US English everywhere (see House Style).
- Prettier covers `yml`/`yaml`/`json` only (`npm run format`). Markdown is hand-wrapped.
