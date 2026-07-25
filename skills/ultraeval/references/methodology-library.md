# Methodology library — how to evaluate each dimension

**Read this before the Research stage does any web search.** Every starter dimension in `references/rubric-library.md` has a block below: the metric that actually measures it, how to obtain that metric on a real target, the 0–5 anchors, and the failure modes that fool the metric.

The state of the art for *evaluating a kind of target* is a property of the **category**, not of the target — RAGAS does not change because you pointed it at a different RAG system. So this pack is written once and reused, and the Research stage's job shrinks from "find the methodology" to "refine it for THIS target":

1. Read your dimension's block here. It is the baseline rubric.
2. Web-search **only** to fill a gap this pack leaves, to check a figure that could have moved (a benchmark version, a standard's revision), or because the target is in a category no block covers.
3. Write `research/<dim>.md` citing what you actually consulted — this pack counts as a citation (`methodology-library.md#<dimension>`), a URL you fetched counts, your memory does not.
4. Refine the anchors for the target and say what you changed and why. You MAY refine an `anchors[]` referential with cited justification; you MUST NOT silently drop it.

**No network? Not a blocker.** This pack is the offline path: derive the rubric from the block, record `research/<dim>.md` with a "no network — baseline rubric from methodology-library.md, unrefined" note, and continue. Never stall the pipeline on a search, and never invent a citation to paper over a failed fetch.

## The two evidence layers (every dimension, every category)

Any score you give must trace to one of these. Nothing else is evidence.

- **Deterministic** — you ran a command and recorded the exit code and output. Exit codes are ground truth. If the target ships a gate, prove it in BOTH directions: it passes a genuine artifact AND fails a hand-doctored one. A gate only ever proven green is unproven.
- **Live** — you acted as a real user and produced a real deliverable, then judged it. See `references/live-scenarios.md` for the normed scenario per category.

A dimension scored from neither is a vibe. Delete it or go get the evidence.

## Universal 0–5 scale

Category blocks below refine this; when a block is silent, this is the anchor.

| score | meaning |
|---|---|
| 0 | not implemented, or fails immediately on the documented main path |
| 1 | works only on a hand-held path; breaks on the first realistic variation |
| 2 | main path works; documented secondary paths or edge cases fail |
| 3 | main and secondary paths work; gaps are real but have workarounds |
| 4 | works as documented including edge cases; gaps are cosmetic |
| 5 | works as documented, degrades gracefully under adverse conditions, and the failure modes are themselves handled and documented |

Score the **shipped** thing, never the destination an expert could reach by hand. That single rule is the most common way an eval goes wrong.

---

# Agent skill (kind = skill)

## grounding — Correctness & grounding
*Anchor: ISO/IEC 25059:2023 functional correctness for AI systems; RAGAS faithfulness (informative).*

**Metric.** Attributability: the fraction of the deliverable's factual claims that a reader can verify against a source the skill actually consulted. The research lineage is AIS (*Attributable to Identified Sources*) and RAGAS `faithfulness`. Two derived numbers matter more than a single average:
- **citation precision** — of the claims that carry a citation, how many are actually supported by it? (A citation that resolves but does not support is the dangerous case: it *looks* grounded.)
- **citation recall / coverage** — of the claims that need a citation, how many carry one?

**How to measure.** Produce one real deliverable (the live scenario). Sample 10–20 factual claims from it — biased toward the load-bearing ones, not the easy ones. For each, open the cited source and grade `supported | partial | unsupported | refuted`. Precision = supported+partial / cited. If the skill ships its own grounding gate, ALSO doctor an artifact (invent a line number, point at a deleted file) and confirm the gate rejects it.

| 0–5 | anchor |
|---|---|
| 0 | claims are fabricated; citations point at files that do not exist |
| 1 | citations resolve as paths but routinely fail to support the claim |
| 2 | most claims supported; some unsupported ones survive to the deliverable |
| 3 | claims supported; the gate catches invented citations but not stale ones |
| 4 | every sampled claim supported; the gate rejects invented AND stale citations |
| 5 | as 4, plus the gate is proven in both directions and cannot be made to pass by editing its own output |

**What fools this metric.** A skill that cites *itself* (its own logs as its own proof) reads as fully grounded — insist on an independent anchor. A high citation rate with low precision is worse than no citations. And a skill that refuses to answer scores perfectly on faithfulness; always pair grounding with coverage.

## coverage — Functional coverage
*Anchor: ISO/IEC 25010:2023 functional completeness.*

**Metric.** Documented-surface coverage: (commands × flags × modes × gates exercised) / (documented). The denominator is the docs, not the code — a feature nobody documents cannot be "expected".

**How to measure.** Enumerate the surface from `--help` AND the docs (they disagree more often than not — that disagreement is itself a `docs` finding). Drive each row with a concrete command and record the exit code. `TEST-PLAN.md` is this enumeration.

| 0–5 | anchor |
|---|---|
| 0 | the documented main command does not run |
| 1 | main path only; most documented flags untested or broken |
| 2 | commands work; several documented flags do nothing or error |
| 3 | every command works; edge flags and error paths are shaky |
| 4 | every documented mode/command/flag/gate behaves as documented |
| 5 | as 4, plus undocumented-but-present surface is either documented or removed |

**What fools this metric.** Counting commands you *invoked* rather than commands you *verified*: exit 0 with wrong output is a failure, not coverage.

## ux — UX & meets-expectations
*Anchor: ISO/IEC 25010:2023 interaction capability (operability, user engagement).*

**Metric.** Friction on the golden path: number of steps a competent user must take that the docs did not tell them, plus time-to-first-useful-artifact.

**How to measure.** Follow the skill's own quickstart verbatim, changing nothing. Every time you have to guess, read source, or fix a command, that is one friction point — record it with the exact step. Then judge the deliverable: would you ship it?

| 0–5 | anchor |
|---|---|
| 0 | the quickstart cannot be followed to a deliverable |
| 1 | reaching a deliverable needs reading the source |
| 2 | works after several undocumented corrections |
| 3 | works with one or two guesses; the deliverable needs manual cleanup |
| 4 | quickstart runs verbatim; the deliverable is usable as-is |
| 5 | as 4, and the tool tells you the next command at every point |

**What fools this metric.** Your own expertise. You know this domain; a first-time user does not. Count the guess even when you made it instantly.

## safety — Safety & robustness
*Anchor: ISO/IEC 25010:2023 safety (fail safe, operational constraint); NIST AI RMF 1.0 (informative).*

**Metric.** Blast radius of the default invocation, plus graceful-degradation rate across adverse conditions (no network, missing optional dependency, unreadable file, non-git target, empty input).

**How to measure.** Read what the skill writes and where, before running it. Then run the adverse matrix on a throwaway fixture. Every condition either degrades with a message or it is a finding.

| 0–5 | anchor |
|---|---|
| 0 | a default invocation can destroy user data |
| 1 | writes outside its own output dir without saying so |
| 2 | stays in its lane but crashes on any missing dependency |
| 3 | degrades on some adverse conditions, hangs or stack-traces on others |
| 4 | writes only where documented; every adverse condition degrades with an actionable message |
| 5 | as 4, plus destructive operations are opt-in and every long step is timeboxed |

**What fools this metric.** A hang is not a graceful degradation — it is the worst failure, because it consumes the budget and produces nothing. Treat "still running after the timebox" as a crash.

## docs — Docs consistency
*Anchor: ISO/IEC 25010:2023 user assistance; ISO/IEC/IEEE 26514:2022 (informative).*

**Metric.** Contradiction count across the four surfaces: SKILL.md, README, `--help`, and observed behavior. Weight a contradiction that makes a user's command fail far above a stale adjective.

**How to measure.** Diff the surfaces mechanically: extract the command/flag list from `--help` and grep each token in the docs, and vice versa. Then run every example in the docs verbatim.

| 0–5 | anchor |
|---|---|
| 0 | the documented commands are not the implemented ones |
| 1 | examples do not run |
| 2 | examples run; flags and behavior are documented wrongly in places |
| 3 | minor drift only (undocumented flags, stale wording) |
| 4 | all four surfaces agree; every example runs verbatim |
| 5 | as 4, and a test enforces the agreement so it cannot silently drift |

**What fools this metric.** Reading the docs for plausibility instead of executing them. A wrong example is indistinguishable from a right one until you run it.

---

# Codebase / library (kind = codebase)

## correctness — Correctness
*Anchor: ISO/IEC 25010:2023 functional correctness; reliability — faultlessness.*

**Metric.** Defects per exercised path, split happy vs edge. Ground every claimed defect in a concrete failing input.

**How to measure.** Do not read for style. Pick the load-bearing functions (highest fan-in from `analyze`'s import graph, highest churn) and trace real values through them: boundary values (0, 1, empty, max), the error branch, and the interaction of two rules. A defect you cannot express as "input X produces Y, expected Z" is not yet a defect.

| 0–5 | anchor |
|---|---|
| 0 | the documented main path produces wrong results |
| 1 | happy path correct; the first edge case is wrong |
| 2 | several real logic bugs on documented paths |
| 3 | happy and secondary paths correct; edge cases have known bugs |
| 4 | correct on happy and edge paths; no logic bug found by targeted tracing |
| 5 | as 4, and invariants are enforced in code rather than assumed |

**What fools this metric.** Code that *looks* wrong but is guarded upstream. Always trace to the entry point before filing — this is the single largest source of false positives in an AI code review.

## tests — Test quality
*Anchor: ISO/IEC 25010:2023 maintainability — testability.*

**Metric.** **Mutation score**, not line coverage. Coverage tells you a line ran; mutation tells you a test would have *noticed* it changing. If a mutation tool exists for the stack (Stryker for JS/TS, PIT for Java, mutmut/cosmic-ray for Python, `go test -cover` plus manual mutation for Go), run it on the core module. If none is available, hand-mutate: flip a comparison, drop a guard clause, return a constant — and see whether the suite goes red.

**How to measure.** Three hand-mutations in the most important module is a valid, cheap proxy. Record each mutation, the command, and whether the suite caught it. A suite that stays green under a flipped comparison is decorative regardless of its coverage badge.

| 0–5 | anchor |
|---|---|
| 0 | no tests, or the suite does not run |
| 1 | tests exist; a hand-mutation of core logic goes unnoticed |
| 2 | tests assert shapes, not behavior; some mutations survive |
| 3 | core logic is guarded; edge cases and error paths are not |
| 4 | every hand-mutation of core logic is caught; error paths are tested |
| 5 | as 4, with a mutation score measured by a tool and gates in CI |

**What fools this metric.** High coverage with assertion-free tests. Also: snapshot tests that were regenerated to match the bug.

## security — Security
*Anchor: ISO/IEC 25010:2023 security; OWASP Top 10 (2021) (informative).*

**Metric.** Reachable source→sink flows. A vulnerability is only real if untrusted input can actually get there — trace the path, do not pattern-match the sink.

**How to measure.** Enumerate sources (HTTP params, argv, env, file reads, message payloads) and sinks (SQL string building, `exec`/`spawn`, `eval`, path joins, template rendering, outbound URLs, deserializers). For each candidate pair, walk the call chain and record every hop as evidence. Then check the guard: is it validation, escaping, or parameterization — and can it be bypassed? Also check dependencies for known CVEs and the repo for committed secrets.

| 0–5 | anchor |
|---|---|
| 0 | a reachable injection/traversal/SSRF from an untrusted source |
| 1 | exploitable flow behind weak authentication |
| 2 | no reachable injection, but inputs are unvalidated and guards are ad-hoc |
| 3 | inputs validated at the boundary; some internal trust assumptions unproven |
| 4 | no exploitable source→sink flow; validation is systematic |
| 5 | as 4, plus authz checked per resource (no IDOR) and secrets handled out-of-band |

**What fools this metric.** A sink in a test fixture, a build script, or dead code — none of it is reachable from an untrusted source. Sibling skill: for a dedicated audit use **ultrasec**, which enumerates these flows deterministically.

## maintainability — Maintainability
*Anchor: ISO/IEC 25010:2023 maintainability — modularity, analysability, modifiability.*

**Metric.** Cognitive complexity of the hot files (preferred over raw cyclomatic complexity: it penalizes nesting and short-circuits the way a reader experiences them), duplication ratio, and dependency-graph health — fan-in/fan-out and **cycles**. `analyze` produces all of these offline.

**How to measure.** Start from `ANALYSIS.md`'s hotspots (size × churn): that is where maintenance cost is actually paid. For each, ask the modifiability question concretely — "to add feature X, how many files change?" — rather than scoring aesthetics.

| 0–5 | anchor |
|---|---|
| 0 | no module boundaries; a change touches everything |
| 1 | import cycles between core modules; heavy duplication |
| 2 | boundaries exist but leak; hot files are long and deeply nested |
| 3 | clear boundaries; a few high-complexity hotspots remain |
| 4 | clear boundaries, low duplication, no cycles, complexity contained |
| 5 | as 4, plus the seams are where change actually happens (verified against churn) |

**What fools this metric.** Style preferences dressed as findings. "This should use a different pattern" is not a maintainability defect unless you can name the change it makes expensive.

## performance — Performance
*Anchor: ISO/IEC 25010:2023 performance efficiency.*

**Metric.** Asymptotic behavior on the hot path plus measured wall-clock on a realistic input. Complexity class first, constants second.

**How to measure.** Find the loops that run per-item on the largest realistic input. Look for the classic shapes: a nested scan that should be a map/index, an I/O call inside a loop (N+1), repeated re-parsing of the same file, an unbounded cache. Then *measure* — time the real command on a realistic input before and after your hypothesis, and cite the numbers.

| 0–5 | anchor |
|---|---|
| 0 | unusable at documented input sizes |
| 1 | quadratic or worse on the main path |
| 2 | measurable hot-path waste (repeated I/O or re-parsing per item) |
| 3 | acceptable at realistic sizes; obvious wins remain |
| 4 | no hot-path waste; scales to realistic inputs |
| 5 | as 4, with caching/streaming where it matters and the limits documented |

**What fools this metric.** Micro-optimizations on cold code. If it does not run per-item on a realistic input, it is not a performance finding.

---

# Security / SAST tool

Score a detector on its **detection statistics against a labelled corpus** — never against its own output.

**Corpora.** OWASP Benchmark (Java, ~2,700 labelled test cases, reports TPR/FPR and the Youden-index "Benchmark score" = TPR − FPR) and NIST SAMATE **Juliet** (C/C++/Java/C#, flawed/fixed pairs per CWE). If neither fits the target's language, build a small labelled fixture yourself: N vulnerable cases and N sanitized twins, and say so — a hand-built corpus is valid evidence if you publish its labels.

| dimension | metric | how | 0 → 5 |
|---|---|---|---|
| precision | TP / (TP + FP) | run on the labelled corpus, classify each report against the labels | 0: mostly false positives · 3: majority true · 5: near-zero FP on the safe twins |
| recall | TP / (TP + FN) | count labelled vulns the tool missed | 0: misses the canonical cases · 3: finds the common CWEs · 5: finds the labelled set including variants |
| false-positive-rate | FP / (FP + TN) | run on the **sanitized** twins only — every report here is a false positive | 0: floods the safe variant · 3: a few · 5: clean |
| reachability | of the true positives, how many are actually reachable from an untrusted source | trace each reported sink back to a source | 0: pattern-matches sinks · 3: intra-procedural only · 5: cross-file taint with a cited path per hop |
| maintainability | cost of adding a rule | add one and see | as the codebase block |

**What fools these metrics.** Tuning on the corpus you score against. And reporting *count* of findings as a quality signal: a tool that reports everything has perfect recall and is useless.

---

# Requirements / PRD / SRD

Every dimension is a characteristic from **ISO/IEC/IEEE 29148:2018**. The standard defines characteristics for a single requirement (necessary, appropriate, unambiguous, complete, singular, feasible, verifiable, correct, conforming) and for the *set* (complete, consistent, feasible, comprehensible, able to be validated). The starter dimensions sample this.

| dimension | metric | how | 0 → 5 |
|---|---|---|---|
| completeness | coverage of the declared scope by requirements | list the scope's capabilities, map each to a requirement; unmapped = gap | 0: scope unaddressed · 3: main capabilities covered · 5: every capability covered, and out-of-scope stated explicitly |
| consistency | contradiction count across requirements | cross-read requirements sharing a term or an actor | 0: core contradictions · 3: minor terminology drift · 5: one term, one meaning, verified |
| verifiable-acceptance | fraction of requirements with testable Given/When/Then criteria | sample 10; ask "could two engineers disagree on whether this passed?" | 0: none · 3: most have criteria, some untestable · 5: every requirement has criteria a test could execute |
| traceability | fraction of requirements traced both ways (to scope, to build tasks) | follow 5 requirements up and down | 0: no links · 3: one direction only · 5: bidirectional and complete |

**What fools these metrics.** Volume. A 300-requirement document that no test can execute scores worse than 40 verifiable ones. And "the requirement is clear to me" — ambiguity is measured by whether two readers agree, so state the second reading you can imagine.

---

# Business / domain ("métier")

The eval judges **only** the business logic. Generic axes are out of scope by construction — pair with `init --scope "src/domain/**"`.

| dimension | metric | how | 0 → 5 |
|---|---|---|---|
| business-correctness | rules producing the documented outcome on realistic inputs | build a small table of real domain cases with expected outcomes (from the docs or the domain expert's wording), run them | 0: core rule wrong · 3: main rules right, combinations wrong · 5: every rule and combination right |
| domain-model | term-to-code correspondence | list the domain's nouns; find each in code; flag one concept with two representations, or one name meaning two things | 0: code has no domain vocabulary · 3: mostly aligned, some synonyms · 5: ubiquitous language, one concept one representation |
| invariants | invariants that hold on every path | name each invariant explicitly, then try to break it via each public entry point | 0: violable by normal input · 3: enforced on the main path only · 5: enforced on every path, violating input rejected with state consistent |
| edge-cases-metier | boundary and interaction coverage | zero, negative, empty, max, expired, duplicate, concurrent, and two rules firing together | 0: happy path only · 3: boundaries handled, interactions not · 5: both |
| rule-traceability | rules traced to a documented requirement | pick 5 implemented rules; find the requirement | 0: none traceable · 3: some · 5: each rule traces both ways |

**What fools these metrics.** Judging the domain by your own intuition of how the business *should* work. The referential is the target's documented domain semantics — when they are absent, that absence is the finding (`rule-traceability`), not a licence to invent rules.

---

# Research / RAG / doc tool

Metrics from **RAGAS** and classical IR (TREC).

| dimension | metric | how | 0 → 5 |
|---|---|---|---|
| faithfulness | fraction of claims attributable to a fetched source (RAGAS `faithfulness`; AIS) | sample 10–20 claims from a real answer, open each cited source, grade support | 0: fabricated · 3: mostly supported · 5: every sampled claim supported by a source actually fetched |
| retrieval | recall@k and MRR for the needed evidence | ask a question whose answer you know lives in document D; is D retrieved, and at what rank? | 0: relevant docs never retrieved · 3: retrieved but ranked low · 5: high recall@k, relevant doc ranked first |
| coverage | fraction of the question answered | decompose the question into sub-questions; count answered | 0: off-topic · 3: partial · 5: complete, with gaps named |
| hallucination | ungrounded statements per answer, and abstention on the unanswerable | ask a question the corpus **cannot** answer | 0: fabricates a confident answer with fake citations · 3: hedges but still asserts · 5: explicit abstention, zero fabricated citations |

**What fools these metrics.** Grading faithfulness alone: a system that always answers "I don't know" is perfectly faithful and worthless. Always pair faithfulness with coverage, and always include one unanswerable question — that single probe separates a grounded tool from a fluent one.

---

# Flavour dimensions

## accessibility (web) — WCAG 2.2 AA
*Anchor: WCAG 2.2 level AA (lineage ISO/IEC 40500).*

**Metric.** Violations per success criterion, split into what a static check can decide and what needs rendering. Automated checks (axe-core, ACT Rules) cover roughly a third of the criteria — never report the automated pass as conformance.

**How to measure.** Run the static pass (semantic landmarks, alt text, form labels, heading order, ARIA validity, positive tabindex), then keyboard-drive the main page: tab order, visible focus, no traps. Contrast, reflow at 320px and focus appearance need rendering — if you cannot render, name them as residual risks rather than passing them.

| 0 | keyboard-inoperable or unlabeled core controls · 3 | no blocking violations, rendering criteria unverified · 5 | AA verified including the rendering criteria |

Sibling skill: **ultra11y** for a full audit or a diff-scoped a11y review.

## auth (web) — AuthN / AuthZ
*Anchor: ISO/IEC 25010:2023 authenticity, accountability; OWASP ASVS 4.0 V2/V4 (informative).*

**Metric.** Missing authorization checks per protected resource. The classic failure is **IDOR**: authentication passes, authorization is never asked.

**How to measure.** List every endpoint that reads or writes a user-owned resource. For each, find the check that the *authenticated* user owns *that* resource — not merely that someone is logged in. Then check session handling: expiry, rotation on privilege change, cookie flags.

| 0 | any user can read any user's data · 3 | checks present but inconsistent across endpoints · 5 | ownership checked per resource, sessions rotate, no IDOR found |

## ergonomics (CLI)
*Anchor: ISO/IEC 25010:2023 operability, user error protection.*

**Metric.** Actionability of error messages — does the message name the fix, or only the failure? — plus exit-code consistency and `--help` completeness.

**How to measure.** Trigger the error paths deliberately: unknown subcommand, missing required argument, malformed flag value, unreadable path. For each: does it exit non-zero, print to stderr, name the offending input, and say what to do? A raw stack trace is a failure. So is a typo'd flag being *ignored*.

| 0 | errors are stack traces, or a bad flag is silently ignored · 3 | errors are clear, exit codes inconsistent · 5 | every error names the fix, exit codes are documented and honored, `--help` matches behavior |

---

# When no block fits

The target is in a category this pack does not cover. Then, and only then, do the full cold research:

1. Name the closest block and say what differs.
2. Search for the *evaluation* literature of that category — "how is X benchmarked", "metrics for X", "X evaluation harness" — not for the target itself.
3. Prefer a standard (ISO/IEC, IEEE, W3C, NIST) over a blog, and a labelled corpus over an opinion.
4. Distil to the same shape: metric → how to measure → 0–5 anchors → what fools it.
5. Propose the new block back into this file. That is how the pack grows, and why the next run will not pay for this search again.
