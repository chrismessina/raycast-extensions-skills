#!/usr/bin/env bash
# Set up (or update) a standalone GitHub mirror of a published Raycast extension so
# the upstream sync works on its FIRST run, instead of failing one setting at a time.
#   usage: setup-mirror.sh [--update]      run from the mirror's root
# Commits nothing and pushes nothing; it prints those steps at the end.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
TEMPLATE="$HERE/../templates/sync-from-upstream.yml"
WF=.github/workflows/sync-from-upstream.yml
UPDATE=0; [ "${1:-}" = --update ] && UPDATE=1
die() { echo "STOP  $*" >&2; exit 1; }
ok() { echo "ok    $*"; }
# A shell alias like `gh='op plugin run -- gh'` (1Password's shell plugin) doesn't
# reach a script, where plain gh then has no login. Fall back to the plugin.
gh() {
  if command gh auth token >/dev/null 2>&1 || ! command -v op >/dev/null; then command gh "$@"
  else op plugin run -- gh "$@"; fi
}

[ -f package.json ] && [ -d .git ] || die "run from the mirror's root (package.json and .git)"
NAME=$(jq -r .name package.json)
URL=$(git remote get-url origin 2>/dev/null) \
  || die "no origin. Create the GitHub repo empty (no README, license or .gitignore), then: git remote add origin <url>"
SLUG=$(sed -E 's#^(https://github\.com/|git@github\.com:|ssh://git@github\.com/)##; s#\.git$##; s#/$##' <<<"$URL")
[[ $SLUG =~ ^[A-Za-z0-9._-]+/[A-Za-z0-9._-]+$ ]] || die "origin isn't a GitHub repo URL: $URL"
# The workflow and the printed push both target main.
[ "$(git branch --show-current)" = main ] || die "check out main first; the sync workflow has to land on main"

# 1. The monorepo directory the workflow reads. It defaults to package.json's name;
#    a mirror whose directory differs keeps its override in the workflow file.
EXT_DIR=$NAME; OVR=""
if [ -f "$WF" ]; then
  v=$(sed -nE 's/^  UPSTREAM_EXT_DIR: "(.+)"$/\1/p' "$WF")
  [ -n "$v" ] && EXT_DIR=$v && OVR=$v
fi
[[ $EXT_DIR =~ ^[a-z0-9][a-z0-9._-]*$ ]] || die "not a monorepo directory name: '$EXT_DIR'"
gh api "repos/raycast/extensions/contents/extensions/$EXT_DIR" >/dev/null 2>&1 \
  || die "can't read extensions/$EXT_DIR in raycast/extensions. Not merged yet, a network/auth failure, or the directory name differs from package.json's (set UPSTREAM_EXT_DIR in $WF)."
ok "upstream is extensions/$EXT_DIR"

# 2. Remote history. A repo created with GitHub's "Add a README/license" makes a root
#    commit unrelated to local history, and the first push is rejected.
git fetch -q origin || die "can't fetch origin, so its history can't be checked"
if git rev-parse -q --verify origin/main >/dev/null; then
  git merge-base --is-ancestor origin/main HEAD 2>/dev/null \
    || die "origin/main has commits that aren't in local history (GitHub's auto-created initial commit?). Inspect: git diff HEAD origin/main --stat. If it holds nothing you need, force-push main once; otherwise git merge --allow-unrelated-histories origin/main."
  ok "origin/main is part of local history"
  PUSHED=1
else
  echo "note  origin has no main yet"
  PUSHED=0
fi

# 3. The workflow, rendered from the canonical template. The cron minute is staggered
#    by repo name (GitHub queues same-minute schedules); an existing file keeps its minute.
MIN=$(( $(printf %s "$NAME" | cksum | cut -d' ' -f1) % 60 ))
# ponytail: two mirrors can hash to the same minute; harmless, GitHub queues them together.
if [ -f "$WF" ]; then
  m=$(sed -nE 's/^    - cron: "([0-9]+) 9 \* \* \*"$/\1/p' "$WF")
  [[ $m =~ ^[0-9]+$ ]] && MIN=$m
fi
render() {
  sed -E "s/^    - cron: \"[0-9]+ 9 \* \* \*\"$/    - cron: \"$MIN 9 * * *\"/; s/^  UPSTREAM_EXT_DIR: \"\"$/  UPSTREAM_EXT_DIR: \"$OVR\"/" "$TEMPLATE"
}
if [ -f "$WF" ] && ! render | cmp -s - "$WF" && [ $UPDATE = 0 ]; then
  die "$WF differs from the template. Re-run with --update to replace it (keeps its cron minute and UPSTREAM_EXT_DIR)."
fi
mkdir -p .github/workflows
render >"$WF"
ok "$WF (cron minute $MIN)"

# 4. The sync delivers every change as a pull request, and new repos don't let
#    Actions open one. Without this the run fails at "Open a pull request".
gh api -X PUT "repos/$SLUG/actions/permissions/workflow" \
  -f default_workflow_permissions=read -F can_approve_pull_request_reviews=true >/dev/null
ok "Actions may create pull requests on $SLUG"

# 5. The commit-msg hook that refuses claude.ai session URLs in a public repo. Its
#    installer skips any repo whose origin doesn't answer anonymously, which includes
#    an origin with nothing pushed yet.
INSTALLER="$HOME/Developer/dotfiles/git-hooks/install-no-session-url.sh"
if [ ! -f "$INSTALLER" ]; then
  echo "note  no hook installer at $INSTALLER"
elif [ $PUSHED = 0 ]; then
  echo "note  hook not installed yet: push main, then re-run this script"
else
  line=$(sh "$INSTALLER" "$(dirname "$PWD")" | grep -E "^[a-zA-Z]+ +$(basename "$PWD")( |$)" || true)
  case "$line" in
    added*|ok*) ok "commit-msg hook: $line" ;;
    *) echo "WARN  commit-msg hook NOT installed: ${line:-installer printed nothing for this repo}" ;;
  esac
fi

cat <<EOF

Next (this script commits and pushes nothing):
  git add $WF && git commit -m "Add upstream sync workflow"
  git push -u origin main
  gh workflow run sync-from-upstream.yml, then gh run watch
  then ONE of:
    nothing to sync: origin/main's newest commit is
      github-actions[bot]: chore: record upstream sync baseline …
    upstream differs: a sync PR (branch sync/upstream-…) that carries the state
      file; review it and merge it, and the baseline lands on main with it
    a conflict issue: reconcile the named files by hand, then re-run
EOF
