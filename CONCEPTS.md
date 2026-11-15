# Concepts

Shared domain vocabulary for this project — entities, named processes, and status concepts with project-specific meaning. Seeded with core domain vocabulary, then accretes as ce-compound and ce-compound-refresh process learnings; direct edits are fine. Glossary only, not a spec or catch-all.

## Reddit data access

### Atom feed (RSS)
Reddit's public, unauthenticated `.rss` endpoints (e.g. `search.rss`, `r/<sub>/search.rss`) that return search and listing results as Atom XML. As of 2026 this is the only unauthenticated surface still serving Reddit data — the `.json` equivalents are blocked for anonymous callers. Read-only and rate-limited.

### Fullname prefix
Reddit's type tag on an object's id: `t3_` marks a post (link/self submission), `t5_` marks a subreddit (and `t1_` a comment, `t2_` a user). A single search response can mix types — a post search returns matching subreddits alongside posts — so consumers filter by this prefix to keep the intended entity type.

### Grandfathered client_id
An OAuth API application registered **before** Reddit's ~November 2025 self-service shutdown, whose credentials still authorize API access. The distinction is the *app registration date*, not the account age — an old Reddit account with no pre-cutoff registered app has no grandfathered access. After the cutoff, new registrations require manual approval.

### Responsible Builder Policy
Reddit's policy (in force since ~November 2025) requiring explicit prior approval before any new client accesses the Data API, with no personal or hobby carve-out. It is why self-service OAuth credential issuance is closed to new external tools, and why unauthenticated reads fall back to the Atom feed.

### SC markers
The `<!-- SC_OFF -->` / `<!-- SC_ON -->` HTML comments Reddit wraps around the real body of a post in its feed `content`. The submission body sits between the markers; the "submitted by … [link] [comments]" navigation chrome is appended after `SC_ON`. Body extraction cuts on these markers structurally rather than on the literal phrase "submitted by", which can appear in legitimate post text.

## Raycast platform

### Command process isolation
Each command in a Raycast extension runs in its own operating-system process, so module-level variables and reactive framework state are private to one command and are never shared with another. The same holds inside one AI tool: its `confirmation` export and the tool itself run in separate processes, even for a single request (verified live on `dev-null`, 2026-10-20), so anything the confirmation computes for the tool must go through shared storage, such as `LocalStorage` (which `dev-null` uses) or `Cache`. State that must be honored across commands (a rate-limit cooldown, for example) has to live in the shared Raycast cache, and any *correctness gate* that reads it must read synchronously at the decision point — reactive/cached copies of that state lag across process boundaries and are safe only for display.

Reading synchronously is sufficient only for a *gate*. Shared state that commands **mutate** needs more: two processes can each read the same prior value, each write a complete and well-formed result, and still lose one of the two updates. Making the write atomic prevents a torn or corrupt store but does not prevent that lost update. A Lock lease narrows the window when the whole read-decide-write cycle sits inside it, but a lease built from portable filesystem primitives does not close it (see Lock lease); when lost updates matter, the design answer is a single-owner process or `flock`, not a better file lock.

### Extension root
The directory holding the `package.json` that carries Raycast manifest keys — as distinct from the repository root, which is the same directory only for a standalone extension repo and is one or more levels up for anything derived from the extensions monorepo. Every build, lint, and publish command resolves the manifest by walking *upward* from the working directory to the nearest `package.json`, so running one above the extension root either fails with an error that names the package manager rather than the path, or — when an unrelated ancestor manifest exists — silently operates on that other package and reports success.

### Installed-extension registry
The set of built extension manifests Raycast keeps for every extension a user has installed, one per install, whether or not that extension has ever been opened. It is the only readable answer found to "which extensions does this user have": the host's own databases and its settings export could not be read.

It is easily confused with the per-extension storage folders Raycast keeps elsewhere, which look like a list of installs and are not one. A storage folder is created the first time its extension *runs*, because that is where the extension's support files and cache live, so a listing of them silently omits everything installed but never opened. Neither the storage folders nor a path derived from an extension's assets location is a registry; only the manifest set is. Any feature that filters by installs should treat an unreadable or inconsistent registry as "could not tell" rather than as an empty or partial answer, because a filter that fails closed is indistinguishable from "nothing to show".

### Development renderer replay
Raycast, outside a `production` (and `test`) environment, mounts a command's React tree in strict mode and replays effect setup on the **initial mount only** (setup → cleanup → setup), so an effect body — a network fetch included — runs twice per launch in that one sequence. Production launches do not replay. Match duplicated work against that mount sequence before calling it a harness artifact: a repeat beyond the initial-mount pair (a bad dependency array) is a real defect, and a second setup that corrupts state, overwrites newer data or strands a spinner is a cleanup bug the replay has just exposed. The diagnostic account is `plugins/raycast-extensions/learnings/workflow-issues/raycast-dev-loop-incidents.md`.

Two consequences follow, and both mislead. Diagnosing the duplication by reading the extension's own source cannot succeed, because the cause is in the host runtime. And the host runtime is a *different installed copy* of the Raycast API package than the one in the extension's dependencies, so searching the local copy for the behavior returns nothing — an absence that proves nothing about what actually runs. A fix that must survive the replay coalesces the duplicated work for the replay window only, deliberately narrower than an in-flight lock, so a later genuine refresh still starts new work.

### Copy Eval
An action in the Actions panel of a single-prompt AI Chat conversation that exports that run as an `ai.yaml` eval. Its `mocks` block is what each tool actually returned, and its `expected` block is the arguments the model actually sent, one `callsTool` entry per call. That makes it the only record that separates wrong arguments, wrong data, and a model misreading correct data. More than one `callsTool` entry for the same tool means the model called it more than once; whether that was a retry is read from the arguments, the order and the preceding mock result (a tool error followed by a changed argument such as `since: ""` is a retry; two successful calls with different arguments, today and this week, are two calls). Contrast with a hand-written eval, whose mocks are the author's assumption and which proves only its own assertions. See `plugins/raycast-extensions/learnings/workflow-issues/mocked-ai-evals-prove-only-their-assertions.md`.

### Restored value
A cached value that a caching hook hands back the moment a view mounts, before — and independently of — any request completing. At the call site it is indistinguishable from a freshly fetched one: same shape, same variable, nothing marking which it is. Three consequences follow, and each misleads in a different direction.

A failure does not clear it, so an error and perfectly usable data coexist; a view that branches on the error first throws away content it could have shown, which is most visible offline, where the cached content is the only content there is. Any freshness metadata a caller records is wrong if it is recorded when the value merely *appears*, because appearing is not fetching — only the callback that fires on a resolved request separates them, and a freshness mechanism keyed on appearance silently disables itself in exactly the case it exists for. And a caller that suppresses the hook's own failure reporting inherits responsibility for every case, including the one where stale content is on screen and nothing announces it.

None of the three is visible to a typechecker, a linter, or a build.

### Lock lease
A claim on a shared store that one command process holds while it completes a read-decide-write cycle, expressed as a file whose exclusive creation is the thing that grants it. Exclusive creation is what makes the claim; every other part of the mechanism exists to handle a holder that died mid-cycle without releasing, and it is that reclamation path that keeps the race described below.

Three properties each remove one failure mode, none fully: the lease carries an **ownership mark**, so a process releases only a lease it believes it holds; the holder **refreshes** the lease while it works, which makes a slow-but-alive holder less likely to be declared dead, not impossible; and a reclaimer **re-checks mark and age just before reclaiming**, which stops a reclaimer whose re-read happens after a successor's lock exists and nothing else. Cleanup of anything the cycle owns belongs inside the lease, after the commit — releasing first lets a concurrent writer slip in and have its work deleted by the cleanup. Network calls never belong inside a lease, since holding one across an unbounded wait is what makes a live holder look dead.

A lease built only from portable filesystem primitives keeps one irreducible race, because those primitives offer no way to make removal conditional on ownership: two reclaimers can both pass the re-check, one unlinks the stale lock, any contender then acquires a fresh lock at the same path, and the other reclaimer's already-decided unlink removes it. Its window is the retry sleep (20 ms), not a multi-second stall, and the holder whose lock was removed later writes the snapshot it read, erasing every commit made in between: the number of lost updates is not bounded, only the store's well-formedness is (writes are atomic underneath). An earlier version of this entry claimed a long-stall trigger and at most one lost update; that claim is **retracted** and kept only as history beside the counterexample in `plugins/raycast-extensions/learnings/design-patterns/portable-node-advisory-file-lock.md` (its Correction of 2026-10-28). Schemes that appear to close the race — giving each claim its own name among them — relocate it rather than remove it, and have measured worse. The residual is accepted for state where a lost update is tolerable; where it is not, use a single-owner process or `flock`.

## Fleet conventions

### Fleet
The set of Raycast extensions maintained here, split by authorship into *self-authored* extensions (own them, may add personal dependencies) and *forks* (contribute upstream, may not). The distinction gates which conventions apply: universally-good fixes are fair on anyone's extension, while personal dependencies and personal structure conventions are only for the self-authored set, because adding them to another author's extension transfers maintenance and supply-chain trust to them and to the Store's reviewers.

### House Style
The standing set of conventions every self-authored extension is held to, maintained as a single tagged checklist with two consumers: a build-time pass that applies the mutating rules while code is written, and a pre-flight audit that asserts the checkable ones before submission. Each rule carries a tag declaring which consumer owns it, and rules are admitted only with evidence from the fleet — established adoption, a concrete defect prevented, or a named gap — never on taste alone.

A rule whose compliance depends on remembering to run the audit is a weak rule; the stronger form makes the compliant call the shortest one available, so the convention holds by construction. When a rule moves to that form, every audit that checks it must be updated in the same change, or it will report the compliant code as non-compliant.

## Review

### Laundered finding

A review finding whose premise is a value the reviewer read from a vendor's published documentation rather than from the shipped artifact. It arrives with the authority of a second opinion and none of the evidence, and two reviewers reporting it is one wrong source counted twice rather than corroboration. The tell is that you cannot reproduce the problem it describes. See Evidence C of `plugins/raycast-extensions/learnings/workflow-issues/verify-the-remedy-not-just-the-finding.md`.

### Remedy premise

The claim about the world that a review finding's implied fix rests on — "this log line is emitted when the download starts", "this field means the package is a cask". A finding proves the current code wrong; it carries no evidence that the fix it implies is right, so the premise is checked separately and against the source of truth, not inferred from the finding's correctness. See `plugins/raycast-extensions/learnings/workflow-issues/verify-the-remedy-not-just-the-finding.md`.

### Review-layer convergence

Two or more independent review passes, working from different briefs, naming the same function or symbol as the source of most findings. One reviewer naming a helper is a finding about its code; two doing so independently is evidence about its design — usually that it answers a narrowly scoped question (one batch, one request, one session) with broadly scoped machinery (a global, the filesystem, another process's state). Convergence says to change the altitude of the fix rather than add another guard, and it is read by counting which symbol the rounds cluster on, not by weighing the current round's severity.

**Distinguish it from a laundered finding, where agreement is also not corroboration.** The discriminator is where the agreement comes from: reviewers converge on a *laundered* finding because they share an external source, and the tell is that you cannot reproduce it. They converge on a *symbol* because each read the code and arrived independently, and the tell is that each one's findings are individually reproducible and different from the others'. Shared source means discount the agreement; shared symbol means act on it. See `plugins/raycast-extensions/learnings/workflow-issues/count-the-review-layers-not-the-findings.md`.
