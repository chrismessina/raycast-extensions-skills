#!/usr/bin/env python3
"""Write a Store PR body without clobbering the user's edits.

The user edits the live body by hand (screenshots, ticked checklist boxes),
and a whole-body PATCH from a local file silently discards all of it. So the
LIVE body is always the base:

  pr-body.py <PR> --initial <body.md> [--apply]
      First post only. Refuses unless the live body is still exactly the body
      the PR was created with (no edit history, or equal to the oldest entry).

  pr-body.py <PR> --splice <edits.json> [--apply]
      Every later update. edits.json is [{"find": "...", "replace": "..."}].
      Each `find` must be one or more WHOLE lines occurring exactly once in
      the live body, and anchors must not overlap. Otherwise nothing is
      written: a missing anchor means the user rewrote that line, and the edit
      goes to them instead of being forced.

Without --apply it prints the diff and writes nothing. With --apply it
re-reads the body immediately before writing (aborting if it moved), verifies
the result, and checks the edit history for an edit that landed in the
unavoidable gap between that re-read and the write (GitHub's PATCH has no
conditional write). If one did, it prints the overwritten version and exits 2.
A write is never retried: if the PATCH fails, the outcome is reported as
unknown after a re-read.

Bodies are handled as exact strings, so CRLF line endings survive untouched.
"""

import argparse
import difflib
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time


def gh_commands() -> list[list[str]]:
    # `gh` is a shell ALIAS for `op plugin run -- gh` on this machine, and an
    # alias does not exist in a subprocess: bare `gh` runs unauthenticated.
    # Try 1Password first, then plain `gh` (which may be authenticated itself).
    cmds = []
    if shutil.which("op") and not (os.environ.get("GH_TOKEN") or os.environ.get("GITHUB_TOKEN")):
        cmds.append(["op", "plugin", "run", "--", "gh"])
    cmds.append(["gh"])
    return cmds


def die(msg: str, written: bool = False) -> None:
    print(f"ABORT: {msg}" + ("" if written else "\nNothing was written."), file=sys.stderr)
    sys.exit(1)


WORKING_GH: list[str] | None = None


def gh(*args: str, written: bool = False) -> bytes:
    """Run a READ, trying each transport; remember the one that worked."""
    global WORKING_GH
    errors = []
    # The proven transport first, then the rest: a read is safe to retry, and a
    # 1Password session can expire mid-run while plain `gh` still works.
    order = gh_commands()
    if WORKING_GH in order:
        order.remove(WORKING_GH)
        order.insert(0, WORKING_GH)
    for base in order:
        r = subprocess.run([*base, *args], capture_output=True)
        if r.returncode == 0:
            WORKING_GH = base
            return r.stdout
        errors.append(f"{' '.join(base)} (exit {r.returncode}): {r.stderr.decode(errors='replace').strip()}")
    die("gh failed:\n  " + "\n  ".join(errors), written=written)


def gh_write(*args: str) -> bool:
    """Run a WRITE exactly once, on the transport the reads proved. Never
    retried or re-sent elsewhere: a transport can fail after GitHub accepted
    the request, and a second PATCH could overwrite an edit made in between."""
    r = subprocess.run([*WORKING_GH, *args], capture_output=True)
    if r.returncode != 0:
        print(f"PATCH failed (exit {r.returncode}): {r.stderr.decode(errors='replace').strip()}", file=sys.stderr)
    return r.returncode == 0


def live_body(repo: str, pr: int, written: bool = False) -> str:
    # Raw JSON, not --jq: jq's output terminator and text-mode newline
    # translation would both alter the body.
    return json.loads(gh("api", f"repos/{repo}/pulls/{pr}", written=written))["body"] or ""


def history(repo: str, pr: int, written: bool = False) -> list[str]:
    """The newest recorded versions of the body, NEWEST first. Each `diff` is
    the whole body as of that edit (verified against the live API 2026-09-24).
    Empty when the body has never been edited."""
    owner, name = repo.split("/")
    q = ("query($o:String!,$n:String!,$p:Int!){repository(owner:$o,name:$n){pullRequest(number:$p)"
         "{userContentEdits(first:3){nodes{diff}}}}}")
    data = json.loads(gh("api", "graphql", "-f", f"query={q}", "-f", f"o={owner}", "-f", f"n={name}",
                         "-F", f"p={pr}", written=written))
    return [n["diff"] or "" for n in data["data"]["repository"]["pullRequest"]["userContentEdits"]["nodes"]]


def is_untouched(repo: str, pr: int, body: str) -> bool:
    # Compared with the PR's OWN original body, not a template copy: `ray
    # publish` posts a checklist worded differently from the repo's template.
    # `last:1` is the oldest entry however many pages the history runs to.
    owner, name = repo.split("/")
    q = ("query($o:String!,$n:String!,$p:Int!){repository(owner:$o,name:$n){pullRequest(number:$p)"
         "{userContentEdits(last:1){totalCount nodes{diff}}}}}")
    edits = json.loads(gh("api", "graphql", "-f", f"query={q}", "-f", f"o={owner}", "-f", f"n={name}",
                          "-F", f"p={pr}"))["data"]["repository"]["pullRequest"]["userContentEdits"]
    return edits["totalCount"] == 0 or (edits["nodes"][0]["diff"] or "") == body


def whole_line_spans(body: str, find: str) -> list[tuple[int, int]]:
    spans, i = [], body.find(find) if find else -1
    while i != -1:
        end = i + len(find)
        starts_line = i == 0 or body[i - 1] == "\n"
        # CRLF is one terminator: a find ending in "\r" before "\n" splits it.
        splits_crlf = find.endswith("\r") and end < len(body) and body[end] == "\n"
        ends_line = not splits_crlf and (
            end == len(body) or body[end] in "\r\n" or find.endswith("\n"))
        if starts_line and ends_line:
            spans.append((i, end))
        i = body.find(find, i + 1)
    return spans


def splice(base: str, edits: list[dict]) -> str:
    # Every anchor is located in the ORIGINAL live body and applied at once, so
    # one replacement can neither create nor destroy another's anchor.
    spans, problems = [], []
    for e in edits:
        found = whole_line_spans(base, e["find"])
        if len(found) != 1:
            problems.append(f"  {len(found)}x as whole lines: {e['find'][:80]!r}")
        else:
            spans.append((*found[0], e["replace"]))
    if problems:
        die("these anchors are not exactly once, as whole lines, in the LIVE body (edited by hand?):\n"
            + "\n".join(problems))
    spans.sort()
    for (_, a_end, _), (b_start, _, _) in zip(spans, spans[1:]):
        if b_start < a_end:
            die("two anchors overlap; merge them into one edit.")
    out, pos = [], 0
    for start, end, replace in spans:
        out += [base[pos:start], replace]
        pos = end
    return "".join(out) + base[pos:]


def gap_check(repo: str, pr: int, base: str, new: str) -> tuple[str, str | None]:
    """('ok', None), ('lost', overwritten_body) or ('unverified', None).
    Trusts the history only once its newest entry IS our write; history can
    lag, and then the entry before it proves nothing."""
    for _ in range(3):
        versions = history(repo, pr, written=True)
        if versions and versions[0] == new:
            before = versions[1] if len(versions) > 1 else None
            if before is None or before == base:
                return "ok", None
            return "lost", before
        time.sleep(2)
    return "unverified", None


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("pr", type=int)
    mode = ap.add_mutually_exclusive_group(required=True)
    mode.add_argument("--initial", metavar="BODY_MD")
    mode.add_argument("--splice", metavar="EDITS_JSON")
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--repo", default="raycast/extensions")
    args = ap.parse_args()

    base = live_body(args.repo, args.pr)
    if args.initial:
        if not is_untouched(args.repo, args.pr, base):
            die("the live body has been edited since the PR was created. "
                "Use --splice against the live body instead.")
        with open(args.initial, newline="") as f:
            new = f.read()
    else:
        with open(args.splice) as f:
            new = splice(base, json.load(f))

    if new == base:
        print("No change.")
        return
    sys.stdout.writelines(difflib.unified_diff(
        base.splitlines(True), new.splitlines(True), "live", "proposed"))
    if not args.apply:
        print("\n(dry run: pass --apply to write)")
        return

    if live_body(args.repo, args.pr) != base:
        die("the live body changed while this ran. Re-run to splice onto the new version.")
    fd, tmp = tempfile.mkstemp(suffix=".json")
    try:
        with os.fdopen(fd, "w") as f:
            json.dump({"body": new}, f)
        ok = gh_write("api", "-X", "PATCH", f"repos/{args.repo}/pulls/{args.pr}", "--input", tmp, "--silent")
    finally:
        os.unlink(tmp)
    if not ok:
        now = live_body(args.repo, args.pr, written=True)
        state = "it DID land" if now == new else "it did not land" if now == base else "the body is now something else"
        die(f"the write failed, but {state}. It was NOT retried. Re-run to see the current state.", written=True)

    if live_body(args.repo, args.pr, written=True) != new:
        die("the PATCH ran but the live body does not match what was sent. Check the PR by hand.",
            written=True)
    state, lost = gap_check(args.repo, args.pr, base, new)
    if state == "lost":
        print("\nWARNING: an edit landed between the final re-read and the write, and was overwritten.\n"
              "The overwritten version follows; splice it back in:\n\n" + lost, file=sys.stderr)
        sys.exit(2)
    if state == "unverified":
        print("\nWritten and verified, but the edit history had not caught up, so an edit in the gap "
              "between the re-read and the write cannot be ruled out. Check the PR's edit history.")
        return
    print("\nWritten and verified.")


if __name__ == "__main__":
    main()
