# CONTRIBUTING.md template (mirror only)

The contributor guide for an extension Chris authored lives in its standalone mirror
(`chrismessina/raycast-<name>`), never in the Store copy. Raycast's Greptile rule `no-dev-material`
names `CONTRIBUTING.md`, and a README Development section draws the `readme-user-facing` P1 (twice
by 2026-11-18, the second on #33710). This file gives that content a home.

## When to write one

- **Only when `author` is `chrismessina`.** Never add one to an extension someone else authored,
  even one Chris contributes to or keeps a contribution mirror of.
- **Not when the Store copy already ships a `CONTRIBUTING.md`** (`brew`, `reader-mode`, verified
  2026-11-19). Those were accepted upstream; leave them and edit them in place.
- Otherwise every mirror gets one. A README whose Development section is being removed gets one in
  the same change, and the removed content moves into it rather than being lost.

## How it stays out of the Store PR

1. List it in the extension's own `.gitignore` (`CONTRIBUTING.md` on its own line). The fork-side
   `git add` honors that file, so `ray publish` copies it but the PR never carries it. This is the
   same mechanism as an unpublished `LICENSE`.
2. Keep it tracked in the mirror. `rx holdout` must not list it: a tracked local-only path is
   `FAIL holdout-tracked`.
3. Link it from the README only by absolute URL,
   `https://github.com/chrismessina/raycast-<name>/blob/main/CONTRIBUTING.md`. A relative link to
   a file that does not ship fails `readme-links`.
4. The mirror sync leaves it alone: it deletes a mirror file only when upstream used to serve that
   path, and upstream never has.

## Where contributions go

Chris's rule (2026-11-19): changes to a published extension go through `raycast/extensions`,
where Raycast's reviewers see them, and the mirror sync brings the merged result back. The mirror
takes pull requests only for an extension with no Store listing (`ios-apps`). Use the matching
variant of the "Contributing" section below.

## Filling it in

Replace each `{{…}}`. Take the scripts table from the extension's `package.json` `scripts`, listing
only the ones that exist. The architecture section is the one part written per extension: it is
where a removed README Development section's project tree and design notes go. Cut a section that
would be empty. Write in US English and keep it short. No Code of Conduct boilerplate, and never
tell anyone to clone the whole monorepo.

````markdown
# Contributing to {{TITLE}}

Thanks for helping. This guide covers running {{TITLE}} locally and sending a change.

## Where changes go

<!-- Published extension: -->
{{TITLE}} is published in the [Raycast Store](https://www.raycast.com/chrismessina/{{NAME}}).
Open pull requests against [`raycast/extensions`](https://github.com/raycast/extensions/tree/main/extensions/{{NAME}}),
not this repository: Raycast reviews every change there, and merged changes sync back here
automatically. Open [issues](https://github.com/chrismessina/raycast-{{NAME}}/issues) here or in
`raycast/extensions`, whichever you prefer.

<!-- Unpublished extension (no Store listing), instead: -->
{{TITLE}} is not in the Raycast Store, so this repository is where it is developed. Open issues and
pull requests here.

## Run it locally

You need [Raycast](https://www.raycast.com/) and Node.js {{NODE}} or later.

<!-- Published extension: -->
1. In Raycast, find {{TITLE}} in the Store and choose **Fork Extension** from the action panel.
   Raycast checks out only this extension's folder from `raycast/extensions`.
2. In that folder, run `npm ci`, then `npm run dev`. Raycast opens the development version, and
   saving a file reloads it.

<!-- Unpublished extension, instead: -->
1. `git clone https://github.com/chrismessina/raycast-{{NAME}}.git`, then `cd raycast-{{NAME}}`.
2. Run `npm ci`, then `npm run dev`. Raycast opens the development version, and saving a file
   reloads it.

{{SETUP_NOTES}}

## Scripts

| Script | What it does |
| --- | --- |
| `npm run dev` | Run the extension in Raycast and reload on save |
| `npm run build` | Build the distribution bundle |
| `npm run lint` | Run Raycast's ESLint and Prettier checks |
| `npm run fix-lint` | Fix what the linter can fix |
| `npm test` | Run the unit tests |

## How it works

{{ARCHITECTURE}}

## Before you open a pull request

- `npm run build`, `npx tsc --noEmit` and `npm run lint` all pass, and so does `npm test` if the
  extension has tests.
- You tried the change in Raycast, including its error and empty states.
- `CHANGELOG.md` has a new entry at the top, dated `{PR_MERGE_DATE}`. Raycast fills in the date
  when the pull request merges.
- New or changed screenshots go in `metadata/`, taken with Raycast's Window Capture.
````
