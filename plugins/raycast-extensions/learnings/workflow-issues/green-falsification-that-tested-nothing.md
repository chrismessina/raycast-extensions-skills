---
title: "A green falsification test proves nothing unless you confirm it touched the code"
date: 2026-07-29
applies_to: ["develop"]
trigger: "when you are about to break code on purpose to prove a test catches it, or trust a zero-match grep or empty fetch"
problem_type: best_practice
category: best-practices
component: testing_framework
module: "src/stores, src/hooks"
severity: high
related_components:
  - verification-tooling
  - gh-cli
  - shell-pipelines
tags:
  - witnessed-red
  - false-negative
  - verification-discipline
  - shell-pipelines
  - gh-cli
  - regex-drift
applies_when:
  - "Running a witnessed-red falsification: breaking code on purpose to confirm a test notices"
  - "Using perl or sed to mutate source as part of a verification step, rather than editing by hand"
  - "Piping a verification command through stderr-discarding or grep-summarizing stages"
  - "Fetching file content from GitHub's API across branches with `gh api ... contents/...`"
  - "A test file imports a binding a module does not export, and the runner's pass count still looks plausible"
  - "A subagent reports a check passed with no findings, especially when checking its own prior work"
---

# A green falsification test proves nothing unless you confirm it touched the code

> **Provenance.** Written in the local checkout of the `claude` extension and moved here on 2026-10-18,
> when that checkout was deleted. Its `src/…` citations are to that extension's code as it stood on
> [raycast/extensions#29798](https://github.com/raycast/extensions/pull/29798) (closed without merging), so line numbers are historical.

## Context

"Witnessed red" is the discipline of proving a regression test actually tests something: break the code on purpose, watch the test fail, restore it, watch it pass. It was the standard applied throughout the storage refactor documented in [bugs-concentrate-at-module-seams.md](../architecture-patterns/bugs-concentrate-at-module-seams.md) ([raycast/extensions#29798](https://github.com/raycast/extensions/pull/29798), open and unmerged at the time of writing) — every fix there was accepted on the strength of a witnessed-red falsification.

The technique has a hidden precondition: **the "break" step has to actually break something.** On this branch, five separate probes reported a clean result — a passing suite, a matching grep, a fetched file — while checking nothing at all. Each was indistinguishable, from its output alone, from a probe that had done its job.

## Guidance

A falsification has two steps, not one: *did I actually break it*, then *did the test notice*. Reading the second step's result as the answer to both is the failure mode in every instance below.

### Instance 1 — a regex that no longer matched the code's shape

A falsification meant to break a delete path ran:

```
perl -0pi -e 's/await LocalStorage\.setItem\(HISTORY_KEY[^;]*;//g'
```

The pattern assumed `HISTORY_KEY` appeared literally at the `setItem` call site. It does not, and by two layers of indirection. In the tree today, `src/stores/recentsDelete.ts:97` reads:

```ts
await Promise.all([pruneLegacyKey<Chat>(HISTORY_KEY, chatIds), pruneLegacyKey<SavedChat>(SAVED_CHATS_KEY, chatIds)]);
```

The `await` is on `Promise.all`, not on the individual calls — and the actual write lives one level deeper inside `pruneLegacyKey`, at `src/stores/recentsDelete.ts:121`, as `await LocalStorage.setItem(key, ...)` against a **generic `key` parameter**. So `HISTORY_KEY` and `LocalStorage.setItem` never co-occur on any line. The regex had been written from a memory of how the code used to read, not from the code.

Zero occurrences matched. The file was byte-identical before and after. The suite reported **79/79 passing**, and the conclusion sitting there to be drawn was "the tests don't cover this path." False: the probe had never touched the path.

This is the general shape of regex drift — a refactor that extracts a helper doesn't just move a line, it dissolves the *textual* pattern the probe was matching on, while leaving the behavior intact. Related current shapes, for the same reason: `src/stores/collection.ts:74` declares `updateIfPresent`, `:200` implements it, and `:171` shows `persist` taking a `previouslyPersistedIds` set.

### Instance 2 — an import from the wrong module

A probe imported `recentsStore` from a relative path pointing at `recentsMigration` — a module that has never exported that binding, which is precisely why the probe was inert. `recentsStore` is defined at `src/hooks/useRecents.tsx:137`. The test file failed to *collect*, and a runner's summary after a collection failure still reads like a pass on a fast glance: the passing count is real, it is just a count of a smaller set than the author believed was running.

### Instance 3 — a substitution pattern that did not exist

A falsification meant to strip `RECENTS_OWNED_FIELDS` (`src/stores/recentsMigration.ts:560`) targeted a declaration form that differed from the real one. Nothing matched, nothing was replaced, the "broken" build was byte-identical to the fixed one, and every test passed — a false negative with no visible seam between it and a true positive.

### Instance 4 — `gh api -f` turned a read into a POST

The sharpest instance, and the one whose cause was misremembered twice: first as a "file size limit," then (in the first version of this doc) as "a body parameter on a GET that fell back to the default branch." The real chain is four tools, each reasonable alone, composing into silence:

```
gh api "repos/OWNER/REPO/contents/PATH" -f ref=BRANCH --jq '.content' \
  2>/dev/null | base64 -d 2>/dev/null | grep -c SYMBOL
```

1. `-f ref=BRANCH` is a **request-body field, and supplying one makes `gh api` default to `POST`** unless `-X GET` overrides it. The contents endpoint has no POST for a read, so the call was never the GET it was written as. The observed result was **HTTP 404**; what the server did with the method and body is not established by that status, and the earlier narration ("ignored the body, fell back to the default branch") was a guess dressed as a mechanism. The lesson does not depend on it: the request that ran was not the request intended.
2. `gh` reports the error on stderr and exits non-zero, correctly.
3. Both `2>/dev/null` redirects discard stderr, and piping discards the upstream exit code. Only empty stdout survives.
4. `base64 -d` on empty input produces empty output; `grep -c` on empty input prints **`0`**, cleanly, with no error.

That `0` was read as "the symbol is absent from the branch." It was wrong twice over: the branch was never queried, and `0` is also exactly what a genuine "found nothing" prints.

Reproduced while writing this doc:

```
$ gh api "repos/.../useAskConversation.ts" -f ref=ext/claude >/dev/null
exit: 1   stderr: gh: Not Found (HTTP 404)

$ gh api "repos/.../useAskConversation.ts?ref=ext/claude" \
    -H "Accept: application/vnd.github.raw" >/tmp/b.txt
exit: 0   bytes: 16704   matches for latchedConversationIdRef: 3
```

The correct form is an explicit GET with `ref` as a query parameter (in the URL as above, or `-X GET -f ref=BRANCH`, which `gh` then encodes into the query string) and the raw body requested through the `Accept` header.

Note what `pipefail` would and would not have done here, because it is the obvious reach and it is not the fix. Both forms — with and without `set -o pipefail` — exit `1`, because the pipeline's last stage (`grep -c` finding zero matches) already exits non-zero on its own. `pipefail` is *redundant* in this case, not defeated. The actual mistake was reading `grep`'s **stdout** (`0`) as the answer and never looking at an exit code at all. A remedy has to check the fetch on its own terms, before anything is piped into a counter.

### Instance 5 — produced while documenting this very lesson

Checking whether `pipefail` would have caught Instance 4, three follow-up probes were run inside `bash -c '...'`. All three returned **exit 4**, which looked like a parameter-semantics result and briefly seemed to prove that the corrected invocation *also* failed. Exit 4 is `gh`'s **authentication** failure: the child shell had no usable `GH_TOKEN`, so the probes were measuring a missing token, not the thing under test. The first version of this doc blamed `bash -c` for "not inheriting" the variable; that is not how environments work — an *exported* variable is inherited by every child — and the observed state was simply that the token was not in the child's environment (set but not exported, or set only in the interactive shell's `gh auth` keyring context). Attribute it to the environment you can print (`bash -c 'printenv GH_TOKEN; gh auth status'`), not to the tool.

This is the same failure one layer up: a plausible-looking non-zero exit, attributed to the hypothesis being tested rather than to the harness. Re-running with inherited auth gave the clean numbers above.

### The rules that come out of it

- **Confirm the mutation or fetch landed before trusting the result.** Grep for the change, assert the diff is non-empty, or check the byte count of what came back. Step one has to be verified on its own, not inferred from step two.
- **Distrust negatives from your own tooling more than positives.** Zero matches, empty output, "not found" — absence is what a broken probe and a true negative both produce, and the output does not distinguish them. A positive at least proves the plumbing ran end to end.
- **Read the exit code, not just stdout.** A `0` from `grep -c` carries no information about whether the upstream command succeeded. `2>/dev/null` in a verification pipeline converts a loud 404 into a quiet, uninformative number.
- **Attribute a failing exit code to the harness before attributing it to the hypothesis** (Instance 5). An unexpected non-zero exit is more often a missing token, a wrong path, or a variable that was never exported than a discovery about the code. Print the environment the probe ran in before theorizing about it.
- **A subagent's self-falsification is systematically weaker than an independent one.** Observed twice on this branch: the agent breaks the thing it was already reasoning about — the part it had already covered — so the test passes while the untested wiring stays untested. Both times this produced a "fixed everywhere" claim that had missed the highest-traffic call site. The structural fix is to have the reviewer choose the mutation, not the author.

## Why This Matters

The common shape across all five instances is that a broken probe and a correct one are indistinguishable from their output alone. `79/79 passing` looks the same whether the mutation landed or the regex silently no-opped. A collection failure's test count looks like a pass on a fast read. `grep -c` on truly-absent output and on never-fetched output both print `0`.

This compounds badly in one specific way: a falsification is the thing you reach for precisely *when* you want to trust a fix. So a silently-broken probe does not merely fail to add confidence — it manufactures confidence that isn't there, at the exact moment you have decided to stop looking.

## When to Apply

- **Before trusting a witnessed-red result**, especially one produced by regex-based source mutation rather than a hand-verified edit — confirm the substitution matched (non-empty diff, or a targeted grep for what should now be gone).
- **Before trusting a test-runner summary as a full-suite result**, when the suite includes a newly added or renamed import — a collection failure silently shrinks the set that ran.
- **Before trusting `gh api ... contents/...` across branches** — use `?ref=<branch>` in the URL (or `-X GET -f ref=<branch>`), never a bare `-f ref=` (it switches the method to POST), and prefer `-H "Accept: application/vnd.github.raw"` over hand-decoding `.content`. Resolve the repo identity independently (`gh pr view <n> --json headRepositoryOwner,headRepository`) rather than guessing a fork slug from a directory name.
- **Before writing a verification pipeline that sends stderr to `/dev/null`** — if the command can fail, its failure has to surface in the pipeline's own output.
- **Before accepting a subagent's report that its own fix is verified everywhere** — especially when the same agent wrote both the fix and the falsification for it.

## Examples

- `src/stores/collection.ts:74`, `:200`, `:171` — the current shapes (`updateIfPresent` declared, implemented, and `persist(items, previouslyPersistedIds)`) that Instance 1's memory-based regex no longer matched.
- `src/hooks/useRecents.tsx:137` — where `recentsStore` is actually defined, versus the nonexistent export path Instance 2 imported from.
- `src/stores/recentsMigration.ts:560` — the `RECENTS_OWNED_FIELDS` declaration whose real form Instance 3's pattern missed.
- `src/hooks/useAskConversation.ts` — Instance 4's falsification target; 3 matches for `latchedConversationIdRef` confirmed on the PR branch via the corrected fetch, versus `0` via the broken pipeline.

## Related

- [`self-review-does-not-catch-diagnostic-errors` → Which evidence is missing?](self-review-does-not-catch-diagnostic-errors.md#which-evidence-is-missing) — the selector that places this case (the probe never landed) beside its three siblings and says which remedy each needs.
- [bugs-concentrate-at-module-seams.md](../architecture-patterns/bugs-concentrate-at-module-seams.md) — the fixes this discipline was verifying.
- [raycast/extensions#29798](https://github.com/raycast/extensions/pull/29798) — the branch these falsifications ran against; head ref `ext/claude` on fork `chrismessina/extensions`.
