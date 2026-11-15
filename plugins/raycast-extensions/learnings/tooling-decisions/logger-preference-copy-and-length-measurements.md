---
title: "Preference copy: the fleet drift that fixed the logger blocks verbatim, and the two screenshots that set the 80/50-character limits"
date: 2026-09-05
last_updated: 2026-10-31
category: tooling-decisions
module: skills
component: development_workflow
problem_type: tooling_decision
severity: medium
applies_when:
  - "Adding or editing a `verboseLogging` or `strictRedaction` preference"
  - "Writing any preference `description` or `label`, including a command-level preference"
  - "Tempted to reword a fixed copy block 'to be more helpful' for one extension"
  - "Deciding whether a logger behavior belongs in code or in a user-held preference"
applies_to: ["develop", "ship"]
trigger: "when you are about to add or edit a verboseLogging, strictRedaction, or any preference description or label"
tags:
  - preferences
  - raycast-logger
  - copy
  - fleet-audit
  - house-style
---

# Preference copy: the drift behind the fixed logger blocks, and the measurements behind 80/50

The policy is three rules in [`house-style.md`](../../reference/house-style.md#logger):
`logger`, `logger-verbose-copy`, `logger-strict-redaction`, plus `pref-description-length`. They
are mechanical now — `rx preflight` emits `logger`, `logger-verbose-copy`, `logger-strict-redaction`,
`pref-description-length` and `pref-label-length` — so the reference keeps the two JSON blocks and
the limits, and this file keeps why they are what they are.

## Why the `verboseLogging` copy is fixed, not a suggestion (decided 2026-09-05)

The `name` is what the logger reads (`getPreferenceValues().verboseLogging`, so a differently named
toggle silently does nothing); the three copy fields are what the user reads, and they were
fleet-wide drift: **3 different titles and 11 different label/description pairs across 11
extensions**, for one toggle that does exactly one thing everywhere. Raycast 2 renders `title` as
the settings group heading, so an extension with `title: "Verbose Logging"` puts a jargon term where
every other row shows plain language.

- **Do not reword it per extension.** "Enable detailed logging for debugging Tesla API calls" is
  not more helpful than the standard line; it is one more string to maintain and it makes the
  fleet look hand-assembled. If an extension genuinely needs to say something extra — that values
  are redacted, say — that belongs in its README, not the toggle.
- **`title` is a group heading, not a row label.** Several extensions had the label text in `title`
  and left `label` doing the work, which renders the toggle under a heading that repeats it.
- **Keep the trailing period on `description`, and none on `label`.** That is what the rendered UI
  looks right with; mixed punctuation across rows is visible in Settings.
- The description says *console*, not *Raycast console* or *logs* — accurate for `ray develop` and
  for the packaged extension both.

## `strictRedaction`: why a preference and not code

`@chrismessina/raycast-logger` 1.5.0 reads a second preference, `strictRedaction`. Standard
redaction masks values by *name* (`password`, `token`, `?access_token=`); strict also masks every URL
query string and fragment, which catches a secret under an unremarkable name (`?sid=…`). The logger
reads it per call, and the user's setting wins over the extension's configured level.

`new Logger({ enableRedaction: "strict" })` is always strict, and a query string is often the thing
being diagnosed. The person who knows a log is about to leave the machine is the user, so the user
holds the switch. It is optional in the Raycast sense (`required: false`, default off): nothing about
ordinary logging changes, and the user sees it only in the extension's settings.

This is UI copy in `package.json`, so it ships — changing it is a Store PR. Fold it into the next PR
that touches the extension rather than opening one that changes three strings. A caret range like
`^1.2.2` admits 1.5.0 without installing it, which is why the rule keys on the *installed* version
(`npm ls @chrismessina/raycast-logger`), and why an extension still pinned below 1.5.0 is reported,
not blocked — bumping the logger is its own change.

## The measurements behind "80 characters, label under 50"

- **2026-09-25.** The first `strictRedaction` description was 237 characters and rendered as three
  wrapped lines behind a **Show more / Show less** disclosure; Chris flagged it on sight. Measured
  from that screenshot, a line wraps at about **86 characters** at the default settings width, so
  the target became **80 or fewer**, with room for a narrower window. The replacement is the
  one-line description now in the canonical block.
- **2026-10-22 (`dev-null`), second measurement.** A text field's description wrapped at about **51
  characters**, and the pane showed **two lines** before **Show more** (a 129-character description
  was cut mid-word). So at that width 80 characters still avoids the disclosure but takes two
  lines: aim for 50 or fewer when the copy allows; 80 stays the hard limit.
- **`label` has its own budget: under 50.** It renders in a larger font on the same row as the
  switch.
- **Command-level preferences count too.** A command's own `preferences` array renders in the same
  pane, and the first version of the audit skipped it — which is why `rx preflight` walks both the
  extension-level and every command's `preferences`.

These are *targets measured once*, not documented Raycast limits. If a screenshot shows a line
wrapping earlier, lower the number in the rule; do not raise it without one.

## The shell audits this replaces (historical)

Before `rx`, the rule carried three `jq` one-liners: a `select(.name=="verboseLogging")` field
comparison, a `select(.name=="strictRedaction")` title/description print, and a length filter over
`[(.preferences // [])[], (.commands[]?.preferences // [])[]]`. The audit of the audit (2026-10-30)
found that the verbose check compared only three copy fields, the strict check only title and
description (omitting `label`, `type`, `required`, `default`), and that both selectors print nothing
when the preference is absent — so a green shell exit did not prove compliance. `rx preflight`
compares the full block, and a missing block on an *applicable* check is a failure ("no preference
named …; declare the block verbatim"). The emitted verdict follows the preset's severity for the
rule: `logger-verbose-copy` is `block`, so it prints `FAIL`; `logger-strict-redaction` is `report`,
so the same missing block prints `WARN logger-strict-redaction  no preference named strictRedaction;
declare the block verbatim` — a capped verdict, not a lesser finding. `N/A` is reserved for the check
not applying (no logger installed, no `verboseLogging` declared for `logger-verbose-copy`, a fork).
Never silence.
