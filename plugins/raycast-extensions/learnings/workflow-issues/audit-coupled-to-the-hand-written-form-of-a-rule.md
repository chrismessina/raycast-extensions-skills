---
module: skills
date: 2026-07-26
applies_to: ["develop", "ship"]
trigger: "when you are about to introduce a helper that encodes a rule an audit already greps for"
problem_type: workflow_issue
component: development_workflow
severity: medium
applies_when:
  - "Introducing a helper or library that encodes a rule an audit already checks"
  - "An audit greps for a literal string that only appears in the hand-written form of a pattern"
  - "A compliance check reports a regression on code that just became more compliant"
tags:
  - audit
  - house-style
  - grep
  - false-negative
  - raycast
  - skills
related_components:
  - documentation
  - tooling
---

# An audit coupled to the hand-written form of a rule false-fails on the fix

## Context

A house-style rule said: every `Toast.Style.Failure` must carry a "Copy Error"
action. The `ship` skill audited it the obvious way — grep for the literal string
`"Copy Error"` and compare the count against the number of failure toasts.

Then a shared package was introduced whose whole purpose was to satisfy that rule
by construction: `showError()` and `failToast()` attach the copy action *inside the
package*. The first extension migrated to it went from 4 non-compliant failure
sites to 0.

The audit reported it as **zero Copy-Error actions — FAIL**.

The audit was not wrong about what it measured. It was measuring the wrong thing:
the presence of a hand-written string, as a proxy for the presence of a behavior.
The moment the behavior could be satisfied another way, the proxy broke — and it
broke in the most damaging direction, flagging the *most* compliant code in the
fleet as the least.

## Guidance

**When you introduce a helper that satisfies a rule by construction, updating the
audit is part of the same change — not a follow-up.** The helper and the audit are
two halves of one mechanism; shipping one without the other leaves the rule in a
worse state than before, because now there are two compliant forms and the checker
only recognizes one.

Concretely, the audit has to accept **every** compliant form, and it has to look at each
site, not at a count. The canonical audit is the `copy-error` rule in
[`house-style.md`](../../reference/house-style.md): list every failure site
(`rg -n 'Toast\.Style\.Failure|showFailureToast\(' src`), then read each one and confirm a
Copy Error `primaryAction` in the same call or on the same toast; `showError(` / `failToast(`
sites comply without one. A global count of any string proves nothing — one compliant toast
can mask ten that are not.

The three greps this incident produced are kept as the record of **failed proxies**, not as
checks to run:

```bash
# WRONG — only sees the hand-written form; returns 0 on kit-using code
rg -c '"Copy Error"' src

# ALSO WRONG (the first "fix") — a line filter: a multiline raw toast whose action sits on a
# later line still appears here even when it is compliant, and a one-line helper call hides
# nothing about the sites that bypass it
rg -n 'Toast\.Style\.Failure' src | rg -v 'failToast|showError'
# ALSO WRONG (the first "fix") — a global marker count: one helper import or one string
# elsewhere inflates it without fixing any other site
rg -cn '"Copy Error"|failToast\(|showError\(' src
```

The shape that holds up is *enumerate every site, then pair each with its remedy*. Counting
markers — good ones or bad ones — is the proxy that broke, and the "fix" above only swapped one
spelling for three.

**Three questions to ask when adding any rule-encoding helper:**

1. **What checks this rule today, and does it look for a behavior or a spelling?**
   Grep-based audits almost always look for a spelling.
2. **After the helper exists, how many valid forms satisfy the rule?** If the answer
   is more than one, every checker must know all of them.
3. **Which direction does the checker fail in?** A checker that under-reports
   compliance will block correct work — worse than one that over-reports, because
   it trains people to ignore it.

**Write the trap into the audit itself, not just the changelog.** The `copy-error` rule in
`house-style.md` carries the warning inline — a literal `grep "Copy Error"` gives a false
failure on kit-using code, because `showError` / `failToast` attach the action inside the
package — so the next person to touch the audit sees why a count is wrong before they
simplify it back to one.

## Why This Matters

The failure mode is self-concealing. An audit that flags compliant code produces a
finding that looks like ordinary work — someone "fixes" it by adding a redundant
hand-written copy action next to the helper that already provides one, and the
audit goes green. The rule is now satisfied twice, the code is worse, and nothing
recorded that the checker was broken.

It is also a hand-off hazard. The extension in question had a handoff doc for a
different agent to ship it. Without the warning written down, that agent would have
run the audit, seen `Copy-Error=0 / FAIL`, and either bounced a correct change back
for rework or reverted the migration.

The general principle: **an audit that greps for an implementation detail is
coupled to that implementation.** The coupling is invisible while only one
implementation exists, and it surfaces as a false failure the first time you
improve the code — precisely when you least expect a compliance regression.

## When to Apply

- Introducing any wrapper, helper, or library that makes a rule true by
  construction (error handling, logging, auth checks, telemetry).
- Reviewing an audit or lint rule that matches a string literal rather than a
  structural property.
- When a compliance check reports a regression immediately after a refactor that
  should have improved compliance — suspect the checker before the code.
- **Not** applicable to audits that already assert structurally (AST-based lint
  rules, type constraints); those track the behavior rather than its spelling.

## Examples

**Before** — the audit and the rule agreed, because only one form existed:

```
124 Toast.Style.Failure across 20 repos
 26 "Copy Error" across 9 repos      → ~20% compliance. Accurate.
```

**After the helper, before the audit fix** — the same audit on the migrated repo:

```
  1 Toast.Style.Failure (a user-state message with no error to copy)
  0 "Copy Error"                     → reported FAIL
  4 sites actually compliant via failToast()/showError()
```

**After the per-site audit** — same repo, same code:

```
sites still needing a copy action: 1   (the user-state toast — correctly excluded
                                        from the rule, no error object to copy)
compliant sites: 4
```

One further detail worth keeping: the per-site audit still reports that single
remaining site, and that is right. It is a `Toast.Style.Failure` used for a
*user-state* message ("Export folder not found") with no error object behind it.
The rule is about errors the user might need to report; blanket-converting
user-state messages to `showError` would be wrong. An audit that enumerates
needs-attention sites lets a human make that call; an audit that counts markers
cannot express it.
