# README template

The standard shape for a **self-authored** extension README. Adapted from
[`nerd-font-picker`](https://github.com/raycast/extensions/tree/main/extensions/nerd-font-picker),
whose top-matter Chris adopted on 2026-08-26, merged with the follow/stars/Store badge row
already shipping across the fleet.

**One file, two audiences.** The same `README.md` is rendered on the extension's Raycast
Store page *and* in `raycast/extensions`. There is no separate Store copy. Badges and
centered HTML survive Store review — verified 2026-08-26: the published
`extensions/get-app-icon/README.md` carries all three badges upstream.

**Scope:** self-authored extensions only. Do not impose this on a fork you contribute to —
the personal follow/stars badges transfer *your* identity onto someone else's extension.

---

## The template

Replace every `<placeholder>`. `<slug>` is `package.json` `name`; `<repo>` is the standalone
standalone repo, normally `raycast-<slug>`.

````markdown
<div align="center">

<img src="media/<icon-filename>" width="128" alt="<Extension Title>">

# <Extension Title>

[![Raycast Store](https://img.shields.io/badge/Raycast-Store-FF6363?style=flat-square&logo=raycast&logoColor=white)](https://www.raycast.com/chrismessina/<slug>)
[![Licence MIT](https://img.shields.io/badge/Licence-MIT-22C55E?style=flat-square)](LICENSE)
[![Follow @chrismessina](https://img.shields.io/github/followers/chrismessina?label=Follow%20chrismessina&style=social)](https://github.com/chrismessina)
[![Stars](https://img.shields.io/github/stars/chrismessina/<repo>?style=social)](https://github.com/chrismessina/<repo>/stargazers)

**<One sentence. What it does and for whom — not a feature list.>**

[Features](#features) • [Requirements](#requirements) • [Quick Start](#quick-start) • [Usage](#usage) • [Development](#development)

</div>

---

## Features

- **<Capability>** — <what it does, and the detail that makes it non-obvious>
- **<Capability>** — <…>

---

## Requirements

- [Raycast](https://www.raycast.com/) installed
- <Anything else: an installed app, an API key, a minimum OS. Omit the section entirely if there is nothing beyond Raycast.>

---

## Quick Start

1. Open Raycast and search for **"<Command Title>"**
2. <First-run behavior — a scan, an auth prompt, a cache build. Say if it takes time.>
3. <The core interaction>

---

## Usage

### Commands

| Command | Mode | Description |
| --- | --- | --- |
| <Command Title> | `view` | <what it does> |

### Actions

| Action | Shortcut | Description |
| --- | --- | --- |
| <Action Title> | `⌘ ⏎` | <what it does> |

### Preferences

| Preference | Values | Default |
| --- | --- | --- |
| <Title> | <type or options> | <default, or blank> |

---

## Development

### Project Structure

```
<repo>/
├── src/
│   └── <command>.tsx    # <role>
├── assets/              # Extension icon (runtime)
├── media/               # README images
├── package.json
└── tsconfig.json
```

### Scripts

| Script | Description |
| --- | --- |
| `npm run dev` | Start in development mode with hot reload |
| `npm run build` | Build for production |
| `npm run lint` | Run Raycast ESLint config |
| `npm run fix-lint` | Auto-fix lint issues |
| `npm run publish` | Publish to the Raycast Store |

### Clone & Run

```sh
git clone https://github.com/chrismessina/<repo>.git
cd <repo>
npm install
npm run dev
```

---

## Tech Stack

| Package | Role |
| --- | --- |
| `@raycast/api` | Raycast extension primitives |
| `@raycast/utils` | Higher-level Raycast utilities |
| `<dep>` | <role> |

---

MIT © [Chris Messina](https://github.com/chrismessina)
````

---

## Rules that are not obvious from the shape

### Markdown everywhere it works; HTML only for centering and sizing

Prefer markdown. The two places it genuinely cannot do the job are **centering** and
**image dimensions** — and both are confined to the header block.

**GitHub Flavored Markdown has no image-sizing syntax.** `![alt](img.png =128x128)` and
`{width=128}` are other flavors (Pandoc, GitLab, Typora); GitHub renders them as literal
text or ignores them. Verified against GitHub's own "Basic writing and formatting syntax"
docs, 2026-08-29: images are covered, sizing is not mentioned at all. So an `<img>` tag is
the only way to show a 512px icon at 128px.

| Where | Syntax | Why |
| --- | --- | --- |
| Header icon | `<img src="media/<icon>" width="128">` | needs sizing, and already sits inside the centered `<div>` |
| Header badges | markdown `[![…](…)](…)` | no sizing needed; shields.io serves them at final size |
| Body screenshots | markdown `![alt](media/<shot>.png)` | displayed at natural width — nothing to size |

**The header `<img>` costs no extra HTML.** `<div align="center">` is required for the
block regardless, so the icon tag lives inside HTML that already exists. Markdown *does*
render inside that div (blank-line separated), which is why the title, badges, and tagline
stay markdown — only the one tag that needs a `width` is HTML.

> **Don't "fix" this by shrinking the file to 128px and switching to markdown.** It works,
> but GitHub renders at natural size, so a 128px source displays 1× — visibly soft on the
> retina displays nearly everyone reads GitHub on. Pointing `width="128"` at the 512px
> original gives 4× density for free. The HTML tag is buying image quality, not just
> convenience.

### The icon is embedded from `media/` — a COPY, never a reference into `assets/`

The header shows the extension icon at **128px** above the title (the
[`filezilla`](https://github.com/raycast/extensions/tree/main/extensions/filezilla) shape).
Copy it in; the filename is whatever `package.json` `icon` says, which varies per extension:

```bash
ICON="$(jq -r .icon package.json)"          # e.g. extension-icon.png — do NOT hardcode
mkdir -p media && cp "assets/$ICON" "media/$ICON"
```

**Why a copy, when `assets/<icon>` already ships?** Because `ship`'s pre-flight asserts the
README references neither `metadata/` nor `assets/`:

```bash
grep -o 'metadata/[^)"]*' README.md                        # must be empty
grep -oE '\(assets/[^)"]*\.(png|jpg|jpeg|gif)' README.md   # must be empty
```

`assets/` is the **runtime** folder — everything in it is downloaded by every user — so the
rule exists to stop a 1.6 MB README screenshot riding along in the bundle. The icon is an
honest edge case (it is already in `assets/` for runtime reasons, so pointing at it would
cost nothing), but carving out an exception per-file is how the rule erodes. One
destination for every README image is the cheaper rule to keep. The duplicated icon is a
few hundred KB in the repo and is **not** in the runtime bundle.

**Every image the README body embeds goes in `media/` too** — screenshots, diagrams, GIFs.
Not `metadata/` (Store-listing screenshots only, and embedding from it fails the submission
checklist verbatim) and not `assets/`.

**`media/` does ship to the monorepo, so Store-page embeds resolve.** Verified 2026-08-29:
`extensions/get-app-icon/` upstream contains a `media/` directory. This matters — a README
image that only exists in the standalone repo renders as a broken image on the Store page, and
nothing in `ray build`/`ray lint` catches it.

| Folder | Holds | Ships to monorepo | In the runtime bundle |
| --- | --- | --- | --- |
| `assets/` | runtime files the extension loads (the icon, images used in code) | yes | **yes** |
| `metadata/` | Store-listing screenshots only | yes | no |
| `media/` | README / docs images | yes | no |

### Nav anchors are plain — do NOT copy the source's `#-feature` form

`nerd-font-picker` links `[Features](#-features)` against a plain `## Features` heading.
**All five of its nav links are dead** — verified 2026-08-26 by slugifying its headings
(`#features #requirements #quick-start #usage #development`) against its link targets
(`#-features #-requirements …`). The leading dash is what GitHub generates for an
*emoji-prefixed* heading, and those headings carry no emoji.

So: either plain headings + plain anchors (this template), or emoji headings + the
dash form. **Never mix.** Check with:

```bash
diff <(grep -oE '\(#[a-z-]+\)' README.md | tr -d '()' | sort -u) \
     <(grep -E '^## ' README.md | sed 's/^## //' | tr 'A-Z' 'a-z' | tr ' ' '-' | sed 's/^/#/' | sort -u)
```

Lines only on the left are broken links.

### `<slug>` and `<repo>` are different strings — the badge URLs 404 if you swap them

- `<repo>` (stars badge, ×2) = the **full** standalone repo name, e.g.
  `raycast-reader`. The `raycast-` prefix is part of `<repo>`, not the template — don't
  double it.
- `<slug>` (Store badge) = `package.json` **`name`**, which is the Store slug — *not* the
  repo name. Canonical mismatch: repo `raycast-reader` has `name: "reader-mode"`, so the
  badge URL is `raycast.com/chrismessina/reader-mode`; using `raycast-reader` there 404s.

(When `name` also differs from the *monorepo directory*, the sync layer's
`UPSTREAM_EXT_DIR` handles that separate mapping — the badge only ever cares about `name`.)

**The Store badge implies publication.** It deep-links to `raycast.com/chrismessina/<slug>`,
which 404s until the extension is actually in the Store. Add the badge block **at publish
time**, not at scaffold time — and when auditing, check the URL resolves rather than only
that the block exists. (`central-icon-system` carried the badge while its Store URL 404'd —
the reason for this rule.)

### The Licence badge links to a `LICENSE` file — which must actually exist

`[![Licence MIT](…)](LICENSE)` is a relative link. With no `LICENSE` file in the repo it is
a 404 on both GitHub and the Store page, and nothing in `ray build`/`ray lint` checks it.

**Known fleet debt (2026-08-29):** `raycast-ios-apps` and `raycast-get-app-icon` — the two
extensions this template was drawn from — both carry the badge with **no `LICENSE` file**.
`raycast-digger` and `raycast-reader` do it correctly. Fix on next touch; don't propagate.

Assert it whenever the badge is present:

```bash
grep -q '](LICENSE)' README.md && { [ -f LICENSE ] || echo "BROKEN: Licence badge, no LICENSE file"; }
```

`package.json` `"license": "MIT"` is a *declaration*; the file is what makes the badge
resolve. `LICENSE` ships to the monorepo (verified: `extensions/digger`,
`extensions/reader-mode`), so adding it is safe.

### Badge order is deliberate

Store link first — it is the only badge a *user* (rather than a developer) can act on.
Licence second because Store reviewers look for it. The two social badges last: they are
the personal half, and they are the half that must never appear on a fork.

The `TypeScript` badge from the source template is deliberately dropped. It tells a reader
nothing they cannot infer, and every extension in the fleet would carry an identical one.

### The tagline is not the `package.json` description

`description` is indexed by Store search and should be keyword-bearing. The README tagline
is read by a human deciding whether to install. They are allowed to differ, and usually
should.

### Omit sections that would be empty

A `## Preferences` table with no preferences, or `## Requirements` listing only "Raycast
installed", is worse than no section. Delete it. The nav row must then drop the same entry
— a nav link to a deleted section is the failure this file's own anchor rule is about.

### `.github/FUNDING.yml` is standalone-repo only

It lives in the standalone repo and **never ships to the monorepo**: a published
extension directory contains no `.github/` at all (verified 2026-08-26 against
`extensions/nerd-font-picker`, and `ray publish` drops `.github/` regardless). Funding for
`raycast/extensions` is the Raycast org's own, not a contributor's.

Canonical content, already in most of the fleet:

```yaml
github: [chrismessina]
custom: [https://venmo.com/Chris-Messina]
ko_fi: [chris]
```

Every self-authored **standalone repo** should carry it. Its absence is not a Store blocker and must
never block a submission.
