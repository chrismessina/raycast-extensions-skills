---
title: "Sectioning an ActionPanel by scope: the TestFlight panel that produced the rule, and the three things that broke while applying it"
date: 2026-09-02
last_updated: 2026-10-31
category: design-patterns
module: skills
component: development_workflow
problem_type: design_pattern
severity: medium
applies_when:
  - "Splitting a flat ActionPanel into `ActionPanel.Section`s"
  - "Titling a section with an item's display name"
  - "Adding `Keyboard.Shortcut.Common.*` shortcuts while re-arranging a panel"
  - "An auditor flags a flat five-action panel that all acts on one item"
applies_to: ["develop"]
trigger: "when you are about to split an ActionPanel into sections or title a section with a display name"
tags:
  - actionpanel
  - sections
  - shortcuts
  - testflight
  - house-style
---

# Sectioning an ActionPanel by scope: receipts

The policy is the `actionpanel-sections` rule in
[`house-style.md`](../../reference/house-style.md#actionpanel-sections): section only when a
resolved panel has five or more direct actions spanning two or more scopes; a submenu counts as
one; title the item section with the item's display name; keep a destructive action beside what it
destroys. This file holds the panel that produced the rule and what broke while applying it.

## The panel that produced the rule (TestFlight testers, 2026-09-02)

In a list row's panel, "Remove From Group" and "Add New Tester" sat adjacent and looked like peers
— one destroys the selected tester, the other creates something in the group. Nothing in a flat
panel distinguished them, and the destructive one is the one you cannot undo. The boundary that
fixed it was **scope, not category**: not "reads vs writes", not "safe vs destructive", but *what
does this act on?* — everything acting on *this tester* in a section titled with the tester's
display name, the group-level actions in a following untitled section.

```tsx
<ActionPanel>
  <ActionPanel.Section title={betaTesterDisplayName(tester)}>
    {copyAction(tester)}
    {removeTesterAction(tester)}   {/* destructive lives WITH what it destroys */}
  </ActionPanel.Section>
  <ActionPanel.Section>
    {addNewTesterAction()}
    {manageBuildsAction()}
  </ActionPanel.Section>
</ActionPanel>
```

Quarantining the destructive action into a "Danger" section at the bottom was the first instinct
and it was wrong here: it separates the action from the thing it names, which is exactly the
association the section titles exist to make. Destructiveness is already carried by
`Action.Style.Destructive` and the confirm dialog. A build's `Export Compliance` was the one case
that earned a *titled* second section — a genuinely different scope that is neither the build's
identity nor the list's.

## Three things that broke while applying it

1. **A section title needs a display-name helper, not string concatenation.** Reaching for
   `firstName + " " + lastName` inline produced a trailing space for anyone with no surname —
   public-link TestFlight testers have none, so *every* such row had one — and the string was now
   rendered in two places (row title *and* section title) where it must agree. Extracting one
   helper is what surfaced the bug; the duplication was the symptom.
2. **Sectioning changes shortcut adjacency.** Moving an action into a section is also the moment you
   notice it had no shortcut at all; adding `Common.New`/`Common.Remove` while sectioning is normal
   and is exactly when a collision gets introduced. `ray lint` does not check this; `rx shortcuts
   check` does (`shortcut-ambiguous`), per resolved panel.
3. **Two actions in *different rows'* panels may share a shortcut.** A file with two `Common.Remove`
   is not a collision if each lives in a separate row's ActionPanel (here: "Revoke" on an
   invitation, "Remove" on a member). Count per resolved panel, not per file, or the audit produces
   false positives.

## Why the rule is `[build]` and not `[both]`

Condition 2 — whether two actions share a scope — is a judgment call that cannot be decided by
grep. An auditor that mechanically flags every flat five-action panel produces false positives on
exactly the single-scope panels the rule exempts (five actions that all act on the same item stay
flat; inventing a second scope produces an empty or artificial section). `ship` does not assert
this; `develop` applies it while writing, and a reviewer may raise it. It should not be promoted to
`[verify]` without a mechanical scope test.
