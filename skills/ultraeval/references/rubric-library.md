# Rubric library — starter dimensions per category

`init` seeds `eval.config.json` with a starter set chosen by **kind × category**; the research stage refines weights and anchors. Every dimension carries machine-readable `anchors[]` (normative rules: `references/protocol.md`); the tables below are the shipped sets verbatim — ids, weights and operative anchors — so a run's `dimensions.json` should match one of them before research touches it.

`tests/docs-drift.test.ts` compares these tables against `src/rubrics.ts`: if a set changes in the engine and not here, the build fails. Keep them in step.

## How a set is selected

`defaultDimensions(kind, category)` runs one ladder (`src/rubrics.ts`). A **replacement** category discards the kind base entirely; a **flavour** category adds dimensions to it.

| `--category` matches | result | base kept? |
|---|---|---|
| security / SAST | Security set | no — replaced |
| requirements / PRD / SRD | Requirements set | no — replaced |
| métier / business / domain / DDD | Business set | no — replaced |
| research / RAG / retrieval | Research set | no — replaced |
| web / frontend | base **+ accessibility + auth** | yes |
| CLI | base **+ ergonomics** | yes |
| anything else (or empty) | the kind base | yes |

The kind base is the Agent-skill set when `--kind skill` (auto-detected from a `SKILL.md`), the Codebase set otherwise.

## Referentials

- **ISO/IEC 25010:2023** — the SQuaRE product-quality model (nine characteristics); the operative referential for codebase dimensions.
- **ultraeval skill referential v1** — there is no ISO standard for agent skills, so skill dimensions anchor to a named, versioned composite: an ISO/IEC 25010:2023 subset (functional suitability, interaction capability, safety) + **ISO/IEC 25059:2023** (the AI-systems extension of SQuaRE, for grounding/functional correctness) + skill-specific criteria (attributability à la RAGAS). Bump the version when the composite changes.
- Category referentials: **ISO/IEC/IEEE 29148:2018** (requirements), **WCAG 2.2** (accessibility, lineage ISO/IEC 40500), **OWASP Benchmark / NIST SAMATE Juliet** (SAST corpora), **RAGAS / TREC IR metrics** (research & retrieval), **OWASP Top 10 / ASVS** and **CVSS v4.0** (security, informative).

An anchor marked `(informative)` is a non-normative citation; the others are the operative mapping.

## Agent skill (kind = skill) — ultraeval skill referential v1

| id | dimension | w | operative anchor | perfect |
|----|-----------|---|--------|---------|
| grounding | Correctness & grounding | .30 | ISO/IEC 25059:2023 — functional correctness for AI systems (+ RAGAS faithfulness, informative) | every claim resolves to real source; gates pass on genuine AND fail on doctored artifacts |
| coverage | Functional coverage | .25 | ISO/IEC 25010:2023 — Functional suitability — functional completeness | every mode/command/flag/gate works as documented |
| ux | UX & meets-expectations | .20 | ISO/IEC 25010:2023 — Interaction capability — operability, user engagement | the real deliverable is production-quality, low-friction |
| safety | Safety & robustness | .15 | ISO/IEC 25010:2023 — Safety — fail safe, operational constraint (+ NIST AI RMF 1.0, informative) | no destructive defaults; graceful degradation without deps/network |
| docs | Docs consistency | .10 | ISO/IEC 25010:2023 — Interaction capability — user assistance (+ ISO/IEC/IEEE 26514:2022, informative) | SKILL.md, README, --help, and behavior agree; examples run |

## Codebase / library (kind = codebase) — ISO/IEC 25010:2023

| id | dimension | w | operative anchor | perfect |
|----|-----------|---|--------|---------|
| correctness | Correctness | .30 | Functional suitability — functional correctness; Reliability — faultlessness | correct on happy AND edge paths; no logic bugs |
| tests | Test quality | .20 | Maintainability — testability | tests fail when the code is wrong (not just coverage %) |
| security | Security | .20 | Security — confidentiality, integrity, resistance (+ OWASP Top 10 2021, informative) | no exploitable source→sink flows; inputs validated |
| maintainability | Maintainability | .20 | Maintainability — modularity, analysability, modifiability | clear boundaries, low duplication |
| performance | Performance | .10 | Performance efficiency — time behaviour, resource utilization, capacity | no hot-path waste; scales to realistic inputs |

## Security / SAST — OWASP Benchmark

Replaces the base entirely: a detector is judged on its detection statistics, not on generic axes.

| id | dimension | w | operative anchor | perfect |
|----|-----------|---|--------|---------|
| precision | Precision | .25 | OWASP Benchmark — true-positive rate vs labelled corpus | reported findings are real exploitable issues, not false positives |
| recall | Recall | .25 | OWASP Benchmark — recall vs labelled corpus (+ NIST SAMATE / Juliet, informative) | known vulnerabilities in a labelled corpus are all found |
| false-positive-rate | False-positive rate | .20 | OWASP Benchmark — false-positive rate on safe variants | sanitized/safe code is never flagged |
| reachability | Reachability | .15 | CVSS v4.0 — exploitability metrics (attack vector, complexity) (interpretive) | flagged sinks are actually reachable from untrusted input |
| maintainability | Maintainability | .15 | ISO/IEC 25010:2023 — Maintainability — modifiability | clear rules, easy to extend |

Precision and recall need a **labelled corpus** — score them against OWASP Benchmark or Juliet, never against the tool's own output.

## Requirements / PRD / SRD — ISO/IEC/IEEE 29148:2018

Replaces the base entirely. Each dimension is one of 29148's requirement characteristics.

| id | dimension | w | operative anchor | perfect |
|----|-----------|---|--------|---------|
| completeness | Completeness | .30 | 29148 — complete | every needed requirement is present; no gaps |
| consistency | Consistency | .25 | 29148 — consistent | no contradictions across requirements/sections |
| verifiable-acceptance | Verifiable acceptance | .25 | 29148 — verifiable | every requirement has testable Given/When/Then acceptance criteria |
| traceability | Traceability | .20 | 29148 — traceable | requirements trace to scope/build tasks and back |

## Business / domain — "métier" — ISO/IEC 25010:2023 functional suitability + 29148

Replaces the base entirely: the eval judges ONLY the business logic — no generic security/perf/docs/a11y axes. Pair it with `init --scope` to also restrict the files under evaluation (a métier-only eval = this category + a domain-code scope).

| id | dimension | w | operative anchor | perfect |
|----|-----------|---|--------|---------|
| business-correctness | Business-rule correctness | .35 | Functional suitability — functional correctness | every business rule computes the documented outcome on realistic domain inputs; no logic bugs |
| domain-model | Domain-model coherence | .25 | Functional suitability — functional appropriateness (+ DDD, Evans 2003, informative) | entities/terms match the domain language; one concept, one representation; boundaries make sense |
| invariants | Invariants & consistency | .15 | Reliability — faultlessness; 29148 — verifiable | domain invariants hold on every path; a rule-violating input is rejected with state left consistent |
| edge-cases-metier | Functional edge cases | .15 | Functional suitability — functional completeness | boundary values, empty/overflow cases, and rule interactions are handled, not just the happy path |
| rule-traceability | Rule traceability | .10 | 29148 — traceable | each implemented rule traces to a documented business requirement and back |

## Research / RAG / doc tool — RAGAS + TREC

Replaces the base entirely — including `correctness`, which is meaningless for a retrieval system: what matters is whether the answer is *attributable*.

| id | dimension | w | operative anchor | perfect |
|----|-----------|---|--------|---------|
| faithfulness | Faithfulness | .35 | RAGAS — faithfulness (+ AIS attributable-to-identified-sources, informative) | every claim is attributable to a fetched source |
| retrieval | Retrieval | .25 | IR evaluation (TREC) — recall@k, MRR | high recall@k and MRR for the needed evidence |
| coverage | Coverage | .20 | ISO/IEC 25010:2023 — Functional suitability — functional completeness | the question is answered completely, not partially |
| hallucination | Hallucination control | .20 | RAGAS — answer attribution / hallucination rate | no ungrounded or fabricated statements survive the gate |

## Flavour categories (base + delta)

These keep the kind base and append. Note the weights then sum above 1.0 — `score` normalizes, so a flavour dimension genuinely adds pull rather than diluting the base.

**Web / frontend** — base **+**:

| id | dimension | w | operative anchor | perfect |
|----|-----------|---|--------|---------|
| accessibility | Accessibility (WCAG 2.2 AA) | .15 | WCAG 2.2 — conformance level AA (lineage ISO/IEC 40500) | no blocking a11y violations |
| auth | AuthN / AuthZ | .20 | Security — authenticity, accountability (+ OWASP ASVS 4.0 V2/V4, informative) | sessions and authorization are correct; no IDOR |

**CLI** — base **+**:

| id | dimension | w | operative anchor | perfect |
|----|-----------|---|--------|---------|
| ergonomics | Ergonomics | .15 | Interaction capability — operability, user error protection | clear --help, actionable errors, consistent exit codes |

## Rules

- Weights sum to ~1.0 for a replacement set. Keep 4–6 dimensions — more dilutes the signal.
- Every dimension needs a measurable 0–5 anchor, not a vibe. If you cannot state how to measure it, it is not a dimension. The 0–5 anchors themselves live in `references/methodology-library.md`, one block per set.
- Every dimension MUST carry at least one `anchors[]` referential entry; research MAY refine it with cited justification, never silently drop it (normative rules: `references/protocol.md`).
- A P0 finding on any dimension caps "meets expectations" at false regardless of the weighted mean (severity definitions: `references/protocol.md`).
- Adding a set means editing `src/rubrics.ts` **and** this file — the drift test enforces the pair.
