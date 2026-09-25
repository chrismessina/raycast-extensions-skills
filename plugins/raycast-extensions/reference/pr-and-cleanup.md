# PR prep & post-merge cleanup

## PR title

- **Update:** `Update <Title> extension` (default — multiple changes, no single dominant one).
- **Single dominant fix:** `[<Title>] <short fix>`.
- **New extension:** `Add <Title> extension`.
- **No Conventional Commits.** Raycast doesn't use them for extension PRs.

Verified examples: `Add bookface extension` (#28614, initial), `Update Bookface
extension` (#28961, v1.1).

## PR body

Follow Raycast's PR template: a **Description** section + a **checklist**. Tick only
boxes that are genuinely true:

- read the extension guidelines / publishing docs
- ran `npm run build` and tested the distribution build in Raycast
- ran `npm run lint` — and `npx tsc --noEmit` (see the tsc gate; build+lint do NOT typecheck)
- update does not break existing commands / remove functionality
- updated `CHANGELOG.md` per changelog conventions

Write the body to a file — multi-line bodies with backticks and checklists are mangled
by inline flags. Use `.git/pr-body.md`: never tracked, never published.

**The flag differs by how the PR is created, and getting it wrong is publicly visible:**

| Situation | Flag |
| --- | --- |
| `gh pr create` (a PR made by hand) | `--body-file "$BODY"` |
| Body onto `ray publish`'s draft, first post or any update | **`ship/scripts/pr-body.py`**: `--initial` writes a local body only while the live one is still the PR's original, and `--splice` builds every later update from the live body. Never PATCH a body from a local file yourself; it overwrites the user's own edits (see ship step 4) |

⚠️ **For `gh api` it is `-F` (uppercase).** Lowercase `-f` does *not* expand `@path` — it
posts the literal string `@.git/pr-body.md` as the body. Verified 2026-07-28 against the
live API: `-F key=@path` preserves newlines and backticks exactly.

**Ticking boxes is a claim made in the user's name.** Tick only what ran green in this
session and paste the output; otherwise leave it unticked and flag it.

**The PR stays a draft.** Post the body, then stop — clicking "Ready for review" submits
it to Raycast's reviewers and is the user's decision, made after reading it. Never run
`gh pr ready`. Full procedure: `ship` → *PR prep → Draft the PR body and post it*.

## Creating the PR — `gh` write calls hang in this sandbox

`gh pr create` and `gh api -X POST` to `raycast/extensions` **hang (~2 min timeout)
and auto-background with no output** in the current environment, while `gh` *reads*
(`gh repo view`, `gh api GET`, `gh pr list`) mostly work. This is environmental, not
a command error.

**Protocol (mirrors the 1Password stage-and-wait routine):**

1. Push the fork branch (that works — it's `git push`, not the GitHub API).
2. Attempt the PR create **once**. If it times out, do NOT retry 3× — the write isn't
   completing from here.
3. Verify whether it landed anyway: `gh pr list --repo raycast/extensions
   --author @me --state open` (redirect to a file; read that).
4. If absent, hand the user the exact ready-to-run command (with `--body-file`
   pointing at the written body) for them to run in their own shell. They paste back
   the PR URL.

Don't burn calls rediscovering this — first timeout ⇒ hand off.

## Post-merge cleanup

Raycast **squash-merges**, which re-SHAs the commit — so git ancestry (`git branch
--merged`) will NOT show the fork branch as merged. **Track by PR head instead:**

```bash
gh pr list --repo raycast/extensions --author @me --state merged \
  --search "head:update/<name>-<topic>"
```

Once the PR shows MERGED:
- Delete the fork branch: `git push fork --delete update/<name>-<topic>`.
- In the local working repo, the feature branch is already fast-forwarded into
  `main`; delete it: `git branch -d <feature-branch>`.
- Fast-forward the standalone repo's `main` and push.

Record the PR number in the project's `docs/reviews/` so a later session can find it
for review-feedback routing (code feedback → `develop`; metadata/screenshots → `ship`).
