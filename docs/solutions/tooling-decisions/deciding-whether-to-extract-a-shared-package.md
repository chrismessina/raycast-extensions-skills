---
module: shared-tooling
date: 2026-07-26
problem_type: tooling_decision
component: tooling
severity: medium
applies_when:
  - "Considering extracting a shared utility package out of several repos you own"
  - "A house-style rule keeps being violated and you suspect the rule is the problem, not the discipline"
  - "Deciding which helpers belong in a personal package vs the platform's own utils library"
tags:
  - shared-package
  - fleet-audit
  - house-style
  - npm
  - raycast
  - decision-procedure
related_components:
  - documentation
---

# Deciding whether to extract a shared package: measure compliance, not duplication

## Context

The instinct that starts this is "I keep rewriting the same helpers — I should
make a utils package." That instinct is usually right about the *feeling* and
wrong about the *contents*, because the helpers that feel repetitive and the
helpers that are actually worth sharing are different sets.

The trigger here was a real question: 24 self-authored Raycast extensions, a
recurring sense of rewriting text/date/number utilities, and a reluctance to add
dependencies to Store-submitted extensions. Rather than answer from taste, the
fleet was measured. The measurement inverted the answer: the "obvious" utils
(dates, text, numbers) were rejected, and the thing worth extracting was a
category that had not been on the list — the primitives behind house-style rules
that were being violated.

## Guidance

**Do not score candidates by how duplicated they are. Score them by whether the
duplicated code is also non-compliant with a rule you already decided you wanted.**

Duplication alone is weak evidence — it can mean "shared need" but just as often
means "similar name, different behavior." A *compliance gap* is strong evidence,
because it proves the rule and the ergonomic path point in opposite directions,
and that only a change in ergonomics will fix it.

### The procedure

**1. Enumerate and gate on ownership.** A shared personal package can only go
into repos you own. Split the fleet first:

```bash
for d in raycast-*/; do
  jq -r --arg d "${d%/}" '"\($d) \(.author)"' "$d/package.json" 2>/dev/null
done
```

Of 36 extension repos here, 24 were self-authored and 12 were forks. The forks
are out of scope before any counting starts — see the fork prohibition in
[the House Style kit rule](../../../plugins/raycast-extensions/reference/house-style.md).

**2. Count each candidate pattern per repo — occurrences AND repo spread.** Repo
spread is the load-bearing number; total occurrences mislead badly. Example from
this audit: `truncate` showed 79 uses and looked fleet-wide, until the per-repo
breakdown showed **40 of them in a single extension**. It is one extension's
idiom, not a fleet pattern.

**3. For any pattern governed by a rule, count the rule's satisfaction rate
separately.** This is the step that changes answers:

| Pattern | Occurrences | Repos |
| --- | --- | --- |
| `Toast.Style.Failure` | 124 | 20 |
| …carrying the required "Copy Error" action | **26** | **9** |
| `error instanceof Error ? …` ternary | 98 | 16 |
| Count-bearing copy (`${n} items`, `item(s)`) | 34 | 11 |

Roughly 20% compliance on a rule that had been written down for months. One
extension had 51 failure toasts and zero copy actions — because it called
`showFailureToast` from the platform's own utils library 42 times, and that
helper has no copy action. **The rule and the shortest path disagreed, and the
shortest path won every time.** That is the finding that justifies a package:
not "this is repetitive" but "the compliant call needs to become the shortest
call."

**4. Check whether candidates share a *behavior* or only a *name*.** Read the
signatures before consolidating:

```
formatDate(dateString: string, monthFormat: "short" | "long")   // repo A
formatDate(timestamp: number)                                   // repo B
formatDate(date: Date | string, format)                         // repo C
formatDate(timestamp: string, period: Period)                   // repo D
formatDate(dateString: string | undefined)                      // repo E
formatDate(date: Date) → "YYYY-MM-DD"                           // repo F
```

Eight implementations, eight signatures. Consolidating means inventing a superset
signature nobody currently wants, then rewriting every call site to use it. That
is negative value, and it is the single most common way a "utils" package becomes
a liability.

**5. Defer to the platform's own library.** 19 of 24 extensions already imported
`@raycast/utils`. Generic helpers belong there; a personal package should hold
only what encodes *your* conventions — the things no upstream library will ever
ship.

**6. Write the reject list into the durable docs, not just the commit message.**
A package with a stated scope boundary resists the drift that turns three exports
into thirty. The rejected candidates and the reason are recorded in the
package README's Scope section and in the house-style rule.

## Why This Matters

The version of this project that skipped the audit would have shipped a
`formatDate`/`truncate`/`pluralize` utils package: high perceived value, wide
adoption friction (every call site needs rewriting to a new signature), and zero
effect on the compliance problem nobody had noticed. It would also have grown
without limit, because "utils" has no natural boundary.

The measured version shipped four exports, replaced ~220 hand-written instances
of rules that already existed, and closed a latent security gap as a side effect
(the hand-rolled toasts copied unredacted error text to the clipboard — see
[error-display code is a credential-disclosure surface](../security-issues/error-display-is-a-credential-disclosure-surface.md)).

The deeper principle: **a rule enforced by an audit is a rule that depends on
someone remembering to run the audit.** A rule enforced by the shortest available
call is a rule that holds by default. When you find a rule at 20% compliance, the
useful question is not "how do we get people to comply" but "what makes
compliance the path of least resistance."

## When to Apply

- Before extracting any shared package out of repos you control.
- When a documented convention keeps getting violated and the reflex is to add
  more discipline or more audit steps.
- When choosing what belongs in a personal library vs the platform's own.
- **Not** applicable to one-off refactors inside a single repo, or to packages
  whose value is genuinely a shared *algorithm* rather than a shared convention.

## Examples

**Rejected by the procedure** — these looked like obvious candidates and failed
step 2 or step 4:

| Candidate | Measurement | Verdict |
| --- | --- | --- |
| date formatting | 8 impls, 8 different signatures | reject — shared name, not behavior |
| `truncate` | 79 uses, but 40 in one repo | reject — one repo's idiom |
| `slugify` | 0 uses | reject — invented need |
| `date-fns` adoption | 0 repos | reject |
| `Intl.NumberFormat` | 1 repo | reject |
| relative time | 5 repos, ~15 total occurrences | reject — below the bar |

**Accepted by the procedure** — each tied to a rule with a measured compliance
gap, and each replacing a pattern the fleet was writing by hand:

```ts
// The whole package, v0.1.x
showError(error, { title })   // failure toast; Copy Error attached by definition
failToast(toast, error, opts) // same guarantee, mutating an in-flight progress toast
getErrorMessage(unknown)      // the one canonical catch-unwrap
countOf(n, "item")            // count copy that agrees at 0 / 1 / many
```

`failToast` is worth calling out: it was **not** in the original design and only
appeared when the package was applied to real code. Three of four failure paths in
the first adopting extension mutated an existing progress toast rather than
creating one, so a package offering only `showError` would have missed the
majority of real failure sites — which were precisely the non-compliant ones. The
lesson is procedural: **adopt into one real repo before finalizing the API**, and
treat the first adoption as part of the design, not as validation of it.
