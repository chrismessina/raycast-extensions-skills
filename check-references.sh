#!/usr/bin/env bash
# check-references.sh — anti-drift guard for the raycast-extensions plugin.
#
# Asserts that every `reference/X.md` a skill points to actually exists in the
# plugin's reference/ dir. Dangling references are the failure mode that lets a
# skill ship pointing at a file that was never authored (or lost from the install
# cache) — e.g. `ship` referencing pr-and-cleanup.md / store-guidelines.md.
#
# Run from the repo root (or anywhere): `bash check-references.sh`
# Exit 0 = all references resolve; exit 1 = at least one dangling reference.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN_DIR="$REPO_ROOT/plugins/raycast-extensions"
SKILLS_DIR="$PLUGIN_DIR/skills"
REFERENCE_DIR="$PLUGIN_DIR/reference"

if [[ ! -d "$SKILLS_DIR" ]]; then
  echo "ERROR: skills dir not found at $SKILLS_DIR" >&2
  exit 2
fi

# Collect every referenced reference/<name>.md across all skill markdown files,
# unique-sorted, then assert each exists in reference/. (Plain loop, not mapfile —
# macOS ships bash 3.2, which has no mapfile.) Use a temp marker for the failure
# flag so a subshell'd pipe loop can't swallow it.
# Match the full path so `docs/reference/<x>.md` can be told apart from the plugin's
# own `reference/<x>.md`. A skill citing the repo-level docs/reference/ corpus is not
# declaring a plugin reference file, and flagging it is a false MISSING. (2026-09-14:
# `api-changelog` cites docs/reference/raycast-api-changelog.md and tripped exactly that.)
refs="$(grep -rohE '[A-Za-z0-9_./-]*reference/[A-Za-z0-9-]+\.md' "$SKILLS_DIR" 2>/dev/null \
  | grep -v 'docs/reference/' \
  | grep -oE 'reference/[A-Za-z0-9-]+\.md' | sort -u)"
fail_marker="$(mktemp)"
trap 'rm -f "$fail_marker"' EXIT

echo "Checking referenced reference file(s) against $REFERENCE_DIR"
echo

IFS='
'
for ref in $refs; do
  [ -z "$ref" ] && continue
  base="$(basename "$ref")"
  if [ -f "$REFERENCE_DIR/$base" ]; then
    echo "  ok       $base"
  else
    echo "  MISSING  $base   <-- referenced by a skill but not authored"
    grep -rl "reference/$base" "$SKILLS_DIR" 2>/dev/null | sed "s|$REPO_ROOT/|             by: |"
    echo "x" >> "$fail_marker"
  fi
done
unset IFS

echo

# ---------------------------------------------------------------------------
# Guard 2: every skill on disk must be listed in the README table AND in both
# manifest descriptions. This drift has shipped three times — `review-pr`
# (misrouted an agent shipping claude-artifacts), `api-changelog`, and
# `greptile-loop` (shipped undocumented in 0.6.0). A skill nothing announces is
# a skill nobody invokes, so catching it by hand has a 0-for-3 record.
# ---------------------------------------------------------------------------
README="$REPO_ROOT/README.md"
PLUGIN_JSON="$PLUGIN_DIR/.claude-plugin/plugin.json"
MARKETPLACE_JSON="$REPO_ROOT/.claude-plugin/marketplace.json"

echo "Checking every skill is announced in README + both manifests"
echo
for dir in "$SKILLS_DIR"/*/; do
  [ -d "$dir" ] || continue
  skill="$(basename "$dir")"
  [ -f "$dir/SKILL.md" ] || { echo "  MISSING  $skill/SKILL.md does not exist"; echo "x" >> "$fail_marker"; continue; }

  missing=""
  grep -q "\`$skill\`" "$README"            2>/dev/null || missing="$missing README-table"
  grep -q "$skill" "$PLUGIN_JSON"             2>/dev/null || missing="$missing plugin.json"
  grep -q "$skill" "$MARKETPLACE_JSON"        2>/dev/null || missing="$missing marketplace.json"

  if [ -n "$missing" ]; then
    echo "  UNLISTED $skill   <-- not announced in:$missing"
    echo "x" >> "$fail_marker"
  else
    echo "  ok       $skill"
  fi
done

# The two manifest versions must agree — `claude plugin tag` validates exactly this pair.
pv="$(grep -o '"version"[[:space:]]*:[[:space:]]*"[^"]*"' "$PLUGIN_JSON" | head -1 | sed 's/.*"\([^"]*\)"$/\1/')"
mv="$(grep -o '"version"[[:space:]]*:[[:space:]]*"[^"]*"' "$MARKETPLACE_JSON" | head -1 | sed 's/.*"\([^"]*\)"$/\1/')"
echo
if [ "$pv" != "$mv" ]; then
  echo "  VERSION MISMATCH  plugin.json=$pv  marketplace.json=$mv"
  echo "x" >> "$fail_marker"
else
  echo "  ok       plugin version $pv matches in both manifests"
fi

# The README states the version in prose too, and it drifts independently of the manifests —
# caught exactly that way on 2026-09-16 (manifests 0.6.1, README still said 0.6.0).
if grep -q '\*\*Status:\*\* v' "$README" 2>/dev/null; then
  rv="$(grep -o '\*\*Status:\*\* v[0-9][0-9.]*' "$README" | head -1 | sed 's/.*v//')"
  if [ "$rv" != "$pv" ]; then
    echo "  VERSION MISMATCH  README says v$rv, manifests say $pv"
    echo "x" >> "$fail_marker"
  else
    echo "  ok       README states v$rv, matching the manifests"
  fi
fi

echo
if [ -s "$fail_marker" ]; then
  echo "FAIL: see MISSING / UNLISTED / VERSION MISMATCH above."
  echo "      Dangling reference -> author the file in $REFERENCE_DIR or drop the pointer."
  echo "      Unlisted skill     -> add it to the README skills table and both manifest descriptions."
  exit 1
fi
echo "PASS: every skill reference resolves, every skill is announced, versions agree."
