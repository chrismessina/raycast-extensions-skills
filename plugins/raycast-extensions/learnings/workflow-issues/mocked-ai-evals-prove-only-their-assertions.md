---
title: Mocked AI evals prove only their assertions — a live Copy Eval is the ground truth
date: 2026-09-26
category: workflow-issues
module: development-workflow
component: development_workflow
problem_type: workflow_issue
severity: high
applies_when:
  - "Writing, reviewing, or approving a Raycast AI tool (`src/tools/`) or its `ai.yaml` evals"
  - "`npx ray evals` is green and that is being offered as evidence the tool works"
  - "A live Ask AI answer is wrong and the cause is unclear: arguments, data, or the model"
  - "An eval fails with only `[object Object]`"
tags:
  - ai-extensions
  - evals
  - ai-yaml
  - verification
  - ground-truth
related_components:
  - development_workflow
---

# Mocked AI evals prove only their assertions — a live Copy Eval is the ground truth

## Context

In [raycast/extensions#31407](https://github.com/raycast/extensions/pull/31407), a contributor added a `find-store-updates` Ask AI tool to `raycast-store-updates`. The PR arrived with `npx ray evals` at 6/6, 4 Vitest tests, and green CI. The first live question, "@raycast-store-updates what's new this week?", answered that there were **no updates**. Copy Eval showed the tool had been called with correct arguments (`days: 7`, `type: all`, `query: ""`) and had returned `totalMatches: 46`. The model had read the @-mention of the extension as the subject of the question.

Over three review rounds, every real defect was found by running the tool live, never by the eval suite:

| Defect | How it was found | Why the evals could not catch it |
| --- | --- | --- |
| The model answered "no updates" about a 46-match result | Live question, then Copy Eval | Each eval checked only the arguments and a title from its own mock |
| "Last 7 days" of updates really covered about one day (the latest 50 PRs, sorted by last activity) | Live answers where every update was dated the same day, then measuring the real PR page | Mocks return whatever data the author wrote, so a truncated data source never shows up |
| The model's first call sent `since: ""`, the tool threw, and the model retried | The `expected` list in Copy Eval held **two** `callsTool` entries | A mock replaces the tool, so the tool's own validation never runs |

## Guidance

### 1. A passing eval proves exactly its assertions and nothing more

`mocks` replace the tool's return value. A bare `callsTool` proves the tool was called. An argument matcher proves only the arguments it names. `includes` on a mocked title proves the model repeated its input. Nothing checks the real data the tool returns, the tool's own input validation, or how the model reads a real result. A 6/6 suite is not evidence that the tool works. To pin down arguments the model must *not* send, use a `not` expectation (`{not: {callsTool: …}}`).

### 2. Use Copy Eval on a live run, in a new single-prompt conversation

Run `npm run dev`, ask the question in a new AI Chat, then choose **Copy Eval** from the Actions panel. Its `mocks` block is what the tool actually returned, and its `expected` block is the arguments the model actually sent. Together they split a wrong answer into three possible causes: wrong arguments, wrong data, or the model misreading correct data.

- **Start a new conversation.** Copy Eval supports only single-prompt conversations. Answers from a long chat also carry over earlier context: one "what's new?" answer came back filtered to installed extensions because an earlier turn had asked about them.
- **Count the `callsTool` entries.** More than one means the model retried after an error. That is how the `since: ""` bug surfaced.
- **Paste the run back in as a regression eval**, trimmed to a few items. Keep counts like `totalMatches` so the "N more" arithmetic is still tested.

### 3. Models send `""` for optional string parameters

Both live runs passed `query: ""`, and one passed `since: ""`. Treat a blank string as absent: `const since = input.since?.trim() || undefined;`. Cover it with a unit test. An eval cannot, because the mock skips the tool.

### 4. A tool's date filter is only as honest as its data window

If the tool filters a fixed-size page (the latest N items) by date, then a longer `days` value silently returns whatever the page happened to reach. The model then presents that as complete. The tool must report how far back its data reaches, and the instructions must tell the model to say so. On #31407, both transports sort PRs by `updated_at` descending, so the last item's `updated_at` is an exact cutoff: any PR merged after it has a later `updated_at` and must be in the page.

### 5. Writing evals: an invalid eval reports only `[object Object]`

- `matches` is compiled as a JavaScript `RegExp`, and inline flags like `(?i)` are not valid in one. Spell out case variants instead (`[Ss]ep`). Measured on #31407: the same two evals failed as `[object Object]` with `(?i)` and passed 12/12 without it.
- A first attempt using `meetsCriteria` failed the same way, but it was not tested on its own, so it is not established that `meetsCriteria` itself is at fault.
- To check an eval before suggesting it to someone, add it to a scratch checkout and run `npx ray evals --non-interactive --skipBuild`.

## Why This Matters

An AI tool fails in the gap between code that is correct and a model that reads its output wrong. That gap is exactly what mocks remove. On #31407 the contributor did everything a checklist asks (evals, unit tests, green CI, a Greptile review) and the tool still told the first real user that nothing had happened in a week with 46 changes. Every fix that mattered came from a handful of live questions plus Copy Eval.

## When to Apply

- Before approving or shipping any Raycast AI tool: ask its obvious questions live ("what's new this week?"), not just the ones the evals cover.
- Whenever a live answer is wrong: take a Copy Eval before guessing. On #31407 the first guess (the model passed the extension name as `query`) was wrong, and Copy Eval showed it in one step.
- When writing evals: keep live-derived regression evals, and a unit test for anything that only the tool's own code does (input validation, empty strings).

## Examples

A regression eval built from a live Copy Eval. With `totalMatches: 49` and 3 items returned, it checks both the coverage warning and the "N more" count:

```yaml
- input: "@raycast-store-updates what's new this week?"
  usedAsExample: false
  mocks:
    find-store-updates:
      totalMatches: 49
      updatesCoverageSince: "2026-09-25T12:49:01Z"
      updatesWindowIncomplete: true
      items:
        - { title: Orion, type: updated, date: "2026-09-26T19:51:21Z", url: https://www.raycast.com/plonq/orion }
        # …two more items
  expected:
    - includes: Orion
    - matches: "([Ss]ep(tember)?\\.? ?25|9/25|2026-09-25)"   # no (?i): not valid in a JS RegExp
    - matches: "(missing|incomplete|partial|may not|might not|older|[Oo]nly)"
    - matches: "(46|forty-six)"
```

Related: [verify the remedy a review implies, not just the finding](verify-the-remedy-not-just-the-finding.md) makes the same point about tests: a green suite that measures whether code runs says nothing about whether its premise holds.
