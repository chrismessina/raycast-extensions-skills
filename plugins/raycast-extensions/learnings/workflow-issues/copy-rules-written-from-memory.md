---
title: "Copy rules written from memory: the house style had the exact text, and it was never read"
date: 2026-10-31
last_updated: 2026-10-31
category: workflow-issues
module: develop
component: development_workflow
problem_type: developer_experience
severity: medium
applies_to: ["develop"]
trigger: "when you are about to write a preference description, an empty-state description, or any other string a user reads"
applies_when:
  - "Adding or rewording a preference in `package.json`, especially `verboseLogging` or `strictRedaction`"
  - "Writing a `List.EmptyView` description or a toast message"
  - "Writing comments, identifiers or CHANGELOG lines in a fleet whose house style is US English"
tags:
  - house-style
  - copy
  - preferences
  - us-english
  - empty-state
---

# Copy rules written from memory

No gate reads words, so copy defects reach Chris first. Twice the rule that would have caught the
defect was already in `reference/house-style.md`, with the exact text to type, and the agent wrote
the string from memory instead. The procedure in `skills/develop/SKILL.md` now names the five copy
rules and their scopes at the point where copy is written; this file holds the two receipts.

## 2026-10-30, `video-downloader` (a fork)

Both logger preferences were written from memory. `verboseLogging` got a reworded 109-character
description, and `strictRedaction` came back with the 237-character text the house style had
already flagged as drift on 2026-09-25 (`pref-description-length` records that measurement).
The canonical blocks (`logger-verbose-copy`, `logger-strict-redaction`) existed and were never
read. Chris caught it in the Settings pane.

The second defect was a scope error as well as a copy error: `logger-strict-redaction` applies to
self-authored extensions on logger 1.5.0+, and the fork rule is to fix only the preferences you
wrote. The skill's bullet at the time told the agent to type the strict-redaction block verbatim
regardless of author (job-B of the 2026-10-30 audit, P2). The fix was to make each rule's own
scope the instruction, not a summary of it.

## 2026-10-10, `raycast-digger`

A new no-URL view shipped a three-line `List.EmptyView` description (`empty-state-copy`: one
sentence, steps in the actions), and a new component declared a British-spelled `cancelled` flag (`us-english`). <!-- us-english-ok: quoted defect -->
Both rules were already in the house style. Chris caught them both on his first look, along with
a British-spelled "analyses" already in `package.json`. <!-- us-english-ok: quoted defect -->

## What changed because of these

- `rx preflight` now emits `pref-description-length`, `pref-label-length`, `logger-verbose-copy`
  and `logger-strict-redaction` as results with their scope from the preset, so the mechanical
  half of the copy audit no longer depends on an agent remembering to run a `jq` line.
- `us-english` and `empty-state-copy` stay judgment rules; the US-English regex lives with the rule
  in `reference/house-style.md`.
- The develop skill points at the rules by ID instead of restating their text, so the text cannot
  drift between the two files.
