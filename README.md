# raycast-extensions-skills

A [Claude Code](https://claude.com/claude-code) plugin for building, shipping, and reviewing [Raycast](https://www.raycast.com) extensions — from a blank directory to a merged Store PR.

The skills come out of shipping and maintaining a couple dozen extensions in [`raycast/extensions`](https://github.com/raycast/extensions). Every rule in them was earned: each one records the defect or review round it prevents.

## Install

```sh
claude plugin marketplace add chrismessina/raycast-extensions-skills
claude plugin install raycast-extensions@raycast-extensions-skills
```

Restart Claude Code so the skills load. To pick up a new release later:

```sh
claude plugin marketplace update raycast-extensions-skills
claude plugin update raycast-extensions   # then restart Claude Code
```

A GitHub install is a copy kept in `~/.claude/plugins/cache/`; it changes only when you update it.

`scaffold` builds on [`superpowers:brainstorming`](https://github.com/obra/superpowers) for ideation; the other skills have no plugin dependencies.

## Skills

Skills are keyed to lifecycle **stages** (verbs), not roles, so their triggers don't overlap.

| Skill | Fires when | Owns |
|---|---|---|
| **`api-changelog`** | "what's new in `@raycast/api` X", "is it safe to upgrade" | Deriving the release notes Raycast doesn't publish: diff the npm tarballs and the installed Raycast.app bundles, place each change in the version that introduced it, and write a verified entry in [`docs/reference/raycast-api-changelog.md`](docs/reference/raycast-api-changelog.md). |
| **`scaffold`** | "create / start a **new** extension" | Ideate and scaffold a net-new extension with House Style applied from the first file. |
| **`develop`** | "change code", "migrate to ESLint 10 / new Node", "bring this up to house style" | Features and refactors, gated major dependency migrations, and the house-style audit fix. |
| **`ship`** | "submit / publish to the Store", "address review feedback" | Pre-flight (dependency hygiene, house-style audit, metadata weeding), Store-compliance gate, `ray publish`, PR prep, the review-feedback cycle, and post-merge cleanup. |
| **`greptile-loop`** | "address the greptile feedback", "loop until 5/5" | Driving an already-submitted Store PR's automated review to 5/5: triage every finding (fix the valid, answer the invalid with receipts), re-publish, wait for the next round. Never marks the PR ready — that's your click. |
| **`review-pr`** | "review this PR", a pasted `raycast/extensions/pull/<N>` URL | Reviewing **someone else's** submission: resolve their fork and branch, sparse-fetch only the touched extension, run it locally, report findings. |

The `develop` ↔ `ship` handoff is two-way: when `ship`'s read-only audit or Store feedback needs a code change, it hands back to `develop`.

Shared references live in [`plugins/raycast-extensions/reference/`](plugins/raycast-extensions/reference/): `house-style.md` (the tagged convention checklist both the build and the audit read), `keyboard-conventions.md` (including where the linter, the runtime, and the docs disagree), `dep-gates.md`, `store-guidelines.md`, `readme-template.md`, `sparse-checkout-discipline.md`, `pr-and-cleanup.md`, and an `eslint-rules/` directory.

> **Status:** v0.7.0 — all six skills are authored and in use.

## Also in this repo

- **[`docs/reference/raycast-api-changelog.md`](docs/reference/raycast-api-changelog.md)** — derived `@raycast/api` release notes, useful whether or not you use the plugin.
- **[`docs/solutions/`](docs/solutions/)** — learnings from real extension work, filed by category: caching semantics of `useCachedPromise`, error display as a credential-disclosure surface, AppleScript/JXA integration, advisory file locks across command processes, and how to handle automated review findings.
- **[`CONCEPTS.md`](CONCEPTS.md)** — the vocabulary the skills and learnings use.

## Developing the plugin

Point a local-path marketplace at a checkout:

```sh
claude plugin marketplace add ~/path/to/raycast-extensions-skills
claude plugin install raycast-extensions@raycast-extensions-skills
```

A local-directory marketplace loads the plugin **in place** from your checkout: edits take effect in the next session, or immediately after `/reload-plugins`. No reinstall or version bump is needed to see them.

Bump `version` in both `plugins/raycast-extensions/.claude-plugin/plugin.json` and `.claude-plugin/marketplace.json` when you cut a release, so GitHub installs see an update. Run `bash check-references.sh` before committing; CI runs it too.

## License

MIT
