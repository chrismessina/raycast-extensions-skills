---
module: shared-tooling
date: 2026-07-26
problem_type: security_issue
component: tooling
severity: high
symptoms:
  - "A thrown SDK error renders a live API key into a user-visible toast"
  - "A 'Copy Error' action puts an `authorization: Bearer …` header on the clipboard"
  - "Redaction looks present but a credential survives it (only the scheme word was masked)"
root_cause: missing_validation
resolution_type: code_fix
tags:
  - security
  - redaction
  - credentials
  - error-handling
  - raycast
  - code-review
related_components:
  - documentation
---

# Error-display code is a credential-disclosure surface

## Problem

Any helper that turns a caught error into user-visible text is a disclosure
surface, because thrown errors from HTTP clients and SDKs routinely carry
credentials in their payloads. If that text is also *copyable* — a "Copy Error"
action, a log, a bug-report template — the secret leaves the machine.

`@chrismessina/raycast-kit`'s `showError` both displays error text in a toast and
copies it to the clipboard. It shipped without redaction, then shipped three more
times with incomplete redaction. Each round was found by a different reviewer, and
none of the three found the same leaks.

## Symptoms

A realistic Anthropic SDK 401 payload rendered verbatim into both the toast and
the clipboard:

```js
{ status: 401,
  headers: { authorization: "Bearer sk-ant-api03-REALKEYMATERIAL…" },
  request: { headers: { "x-api-key": "sk-ant-SECRET…" } } }
```

Later rounds surfaced subtler versions of the same class:

- `Authorization: Basic dXNlcjpwYXNz` → masked to `Authorization: *** dXNlcjpwYXNz`.
  The base64 decodes to `user:pass`. **Worse than no redaction, because it looks
  redacted.**
- `postgres://admin:hunter2@db:5432/prod` passed through untouched, while
  `https://user:pw@api.example.com` was masked — the dotted host matched an email
  rule and the dotless one did not.
- `{"api_key":"alpha\"bravo"}` → `{"api_key":"***"bravo"}`. The escaped quote ended
  the value class early and leaked the tail.

## What Didn't Work

**Assuming the sibling package's protections carried over.** The package was
deliberately built to mirror an existing logger module (zero deps, same peer, same
shape) — and the mirroring stopped at structure. The logger had a `redactString`
that masked bearer tokens, labeled secrets, and emails. The new package copied the
*architecture* and not the *protection*, which is the most plausible way this
happens: the design felt complete because it matched a known-good template.

**Assuming the caller's own string is trusted.** `showError(error, { message })`
let a caller override the displayed message, and that override skipped redaction
on the theory that a hand-written message contains only what the author put there.
But callers write `message: \`Upload failed: ${err.detail}\`` — interpolating the
very payload the redactor exists for. The clipboard path was already safe, which is
exactly why this survived: the leak existed only on the visible surface, so a test
of the copy payload passed.

**Reading the regex instead of attacking it.** Every leak in the list above was
found by *running* adversarial inputs, never by inspecting the pattern. The
`postgres://` case is the clearest example — reading the code, the URL rule looked
adequate, because the dotted-host variant it was tested against did get masked.

## Solution

Redact at the display/copy boundary, treat every string as untrusted, and order
the rules deliberately.

```ts
// 1. Route EVERY path that reaches the surface through redaction — including the
//    caller's own override. `message === undefined` (not `??`) so an explicit
//    `undefined` in a ternary still means "derive it".
const errorMessage =
  message === undefined ? getErrorMessage(error) : redactSecrets(message);

// 2. Redact BEFORE clamping. Reversed, truncation can split a secret and leave
//    the first half readable.
return clamp(redactSecrets(extractMessage(error)));
```

Ordering inside the redactor is load-bearing, not cosmetic:

1. **PEM/PGP private-key blocks first.** The body is bare base64; later rules would
   partially rewrite it and destroy the block match.
2. **JWTs before the bearer rule**, so an *unlabeled* `eyJ…` token is still caught.
3. **Auth schemes mask the credential, not the scheme word** —
   `Basic|Digest|Negotiate|NTLM|Token|ApiKey` followed by the value.
4. **URL-authority credentials** (`scheme://user:pw@host`) as their own rule, with
   `[^\s/:@]*` (not `+`) for the username so `redis://:pw@host` matches.
5. **Bare provider keys** that carry no label at all: `sk-…`, `ghp_…`, `xoxb-…`,
   and AWS `AKIA…`/`ASIA…` ids.

Bound the patterns so a hostile payload cannot hang the extension. A bounded
header class (`[^-\n]{0,40}`) took PEM scanning from **231ms → 32ms** on 6000
unterminated `BEGIN` markers.

## Why This Works

The fix is not "a better regex" — it is **moving redaction to the boundary and
removing every path that can skip it**. Three properties make it hold:

- **Single choke point.** Both the derived message and the caller override go
  through one function, so there is no second path to forget.
- **Untrusted-by-default.** The question is not "did the author put a secret here"
  but "can a secret reach here." Interpolation means yes.
- **Order-as-contract.** The ordering constraints are written as comments at each
  rule, because the next person to append a rule will otherwise put it first.

Note that the surviving risk is *under*-masking, never over-masking: verified that
ordinary error text, file paths, and credential-free URLs pass through unchanged.

## Prevention

**Attack it; don't review it.** Keep a fixture list of real credential shapes and
assert on it. Every leak here was found by running inputs, and the leaks that
review missed were the ones whose *near-neighbor* case already passed:

```js
const SHAPES = [
  ["bearer",        'authorization: Bearer sk-ant-api03-REALKEY…'],
  ["basic",         "Authorization: Basic dXNlcjpwYXNz"],
  ["jwt",           "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.dBjftJeZ4CVP…"],
  ["pem",           "-----BEGIN RSA PRIVATE KEY-----\nMIIEow\n-----END RSA PRIVATE KEY-----"],
  ["pgp",           "-----BEGIN PGP PRIVATE KEY BLOCK-----\nlQOY\n-----END PGP PRIVATE KEY BLOCK-----"],
  ["aws-id",        "AKIAIOSFODNN7EXAMPLE"],
  ["conn-string",   "postgres://admin:hunter2@db:5432/prod"],  // dotless host
  ["escaped-quote", '{"api_key":"alpha\\"bravo"}'],
];
for (const [name, input] of SHAPES) {
  assert.doesNotMatch(redactSecrets(input), /REALKEY|dXNlcjpwYXNz|hunter2|bravo/, name);
}
```

**Test the near-neighbor of anything that passes.** `https://user:pw@host` was
masked and `postgres://user:pw@db:5432` was not. One passing variant is not
coverage of the class.

**Assert the boundary, not just the function.** A redactor with 100% unit coverage
is still bypassable if one caller path skips it. Test through the public API —
including every override and option:

```js
await showError(new Error("x"), { title: "T", message: "token=SUPERSECRET123456" });
assert.doesNotMatch(capturedToast.message, /SUPERSECRET123456/);
```

**Bound every pattern and test for backtracking.** Assert a wall-clock ceiling on
adversarial input (5k–50k chars of base64, unterminated PEM headers, thousands of
repeated matches) so a future rule cannot reintroduce quadratic behavior.

**Redact before truncating.** Add a test with a secret straddling the clamp
boundary; that ordering bug is invisible otherwise.

**Deprecate the leaky version rather than only superseding it.** A published
version with a known disclosure bug stays installable and pinnable. `npm deprecate`
puts a warning in front of anyone who lands on it, and does not unpublish.

**Run more than one reviewer, and count them as non-redundant.** Three passes found
three disjoint sets: the original absence of redaction, four shapes found by
self-attack, and four more found afterward in the just-hardened code. A single
clean pass — including a self-review — is not evidence of absence here.
