# CLAUDE.md

Guidance for agents working in this repo. The README is the human-facing manual.

## What this is

Source for the **`raycast-extensions` Claude Code plugin** (`plugins/raycast-extensions/`), plus
the learnings corpus the skills cite (`docs/solutions/`) and derived `@raycast/api` release notes
(`docs/reference/`). It is not a Raycast extension — there is no `ray build` here, and
`package.json` is `private: true` with Prettier as its only dependency.

## Editing the plugin

**Install copies into a version-keyed cache — it is not a symlink.** Editing a `SKILL.md` here does
nothing to the running plugin until the cache is refreshed, so a skill you just edited is not the
skill that runs in this session. Do not verify an edit by invoking the skill.

Bump `version` in **both** `plugins/raycast-extensions/.claude-plugin/plugin.json` and
`.claude-plugin/marketplace.json` for anything structural, and keep the README's `**Status:**`
line in step. **Run `bash check-references.sh` after touching any skill, reference, manifest, or
the README** — it fails on a dangling `reference/X.md` pointer, a skill missing from the README
table or either manifest description, and a version mismatch. Exit 0 = clean.

## `docs/solutions/`

Filed by category with YAML frontmatter (`module`, `component`, `problem_type`, `tags`); array
items are double-quoted. Match the existing vocabulary (`component: development_workflow`,
`module: publishing`, `module: skills`). `CONCEPTS.md` defines the shared terms. A learning nothing
points at does not compound — wire a new one into the skill it serves.

Cite code in public repos by GitHub URL, and files in this repo by relative path. Never by a
machine-local absolute path: this repo is public.

## Conventions

- US English everywhere (see House Style).
- Prettier covers `yml`/`yaml`/`json` only (`npm run format`). Markdown is hand-wrapped.
