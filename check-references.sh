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

# ---------------------------------------------------------------------------
# Guard 3: every learning is cited where it applies, and every relative link resolves.
# A learning only a folder listing points at is one an agent rediscovers after the
# review instead of reading before the work (2026-09-23: 10 of 14 were cited nowhere).
# Citations from other learnings do not count; one from a skill or reference does.
# ---------------------------------------------------------------------------
LEARN_DIR="$PLUGIN_DIR/learnings"
echo
echo "Checking every learning is cited by a skill or reference"
echo
cited_file="$(mktemp)"
python3 - "$SKILLS_DIR" "$REFERENCE_DIR" > "$cited_file" <<'PY'
# Print every file a skill or reference links to, resolved to an absolute path.
# A citation is a real Markdown link — a filename mentioned in prose or code does not count.
import os, re, sys
from urllib.parse import unquote
link = re.compile(r"\]\(([^)\s]+)\)")
for top in sys.argv[1:]:
    for d, _, files in os.walk(top):
        for f in files:
            if not f.endswith(".md"):
                continue
            in_fence = False
            for line in open(os.path.join(d, f), encoding="utf-8"):
                if line.lstrip().startswith("```"):
                    in_fence = not in_fence
                if in_fence:
                    continue
                for t in link.findall(re.sub(r"`[^`]*`", "", line)):
                    t = unquote(t.split("#", 1)[0])
                    if t and not re.match(r"^[a-z]+:", t):
                        print(os.path.realpath(os.path.join(d, t)))
PY
for f in "$LEARN_DIR"/*/*.md; do
  [ -f "$f" ] || continue
  name="$(basename "$f")"
  if grep -qxF "$(cd "$(dirname "$f")" && pwd -P)/$name" "$cited_file"; then
    echo "  ok       $name"
  else
    echo "  ORPHAN   $name   <-- no skill or reference links to it; add it to the trigger table of the skill it serves"
    echo "x" >> "$fail_marker"
  fi
done
rm -f "$cited_file"

echo
echo "Checking relative Markdown links resolve"
echo
broken_file="$(mktemp)"
python3 - "$REPO_ROOT" > "$broken_file" <<'PY'
import os, re, sys
root = sys.argv[1]
link = re.compile(r"\]\(([^)\s]+)\)")
for d, _, files in os.walk(root):
    if "/.git" in d or "node_modules" in d:
        continue
    for f in files:
        if not f.endswith(".md"):
            continue
        p = os.path.join(d, f)
        in_fence = False
        for n, line in enumerate(open(p, encoding="utf-8"), 1):
            if line.lstrip().startswith("```"):
                in_fence = not in_fence
            if in_fence:
                continue
            for target in link.findall(re.sub(r"`[^`]*`", "", line)):
                t = target.split("#", 1)[0]
                if not t or re.match(r"^[a-z]+:", t) or t.startswith("<"):
                    continue
                if not os.path.exists(os.path.normpath(os.path.join(d, t))):
                    print(f"{os.path.relpath(p, root)}:{n}  {target}")
PY
broken="$(cat "$broken_file")"; rm -f "$broken_file"
if [ -n "$broken" ]; then
  echo "$broken" | sed 's/^/  BROKEN   /'
  echo "x" >> "$fail_marker"
else
  echo "  ok       every relative link resolves"
fi

echo
if [ -s "$fail_marker" ]; then
  echo "FAIL: see MISSING / UNLISTED / VERSION MISMATCH / ORPHAN / BROKEN above."
  echo "      Dangling reference -> author the file in $REFERENCE_DIR or drop the pointer."
  echo "      Unlisted skill     -> add it to the README skills table and both manifest descriptions."
  exit 1
fi
echo "PASS: references resolve, skills are announced, versions agree, every learning is cited, links resolve."
