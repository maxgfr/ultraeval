# Rubric library — starter dimensions per category

`init` seeds `eval.config.json` with a starter set by kind; the research stage refines weights and anchors. Below are proven dimension sets to adapt. Every dimension carries machine-readable `anchors[]` (see `references/protocol.md` for the normative anchoring rules); the tables below show the operative anchor.

## Referentials

- **ISO/IEC 25010:2023** — the SQuaRE product-quality model (nine characteristics); the operative referential for codebase dimensions.
- **ultraeval skill referential v1** — there is no ISO standard for agent skills, so skill dimensions anchor to a named, versioned composite: an ISO/IEC 25010:2023 subset (functional completeness, interaction capability, safety) + **ISO/IEC 25059:2023** (the AI-systems extension of SQuaRE, for grounding/functional correctness) + skill-specific criteria (attributability à la RAGAS). Bump the version when the composite changes.
- Category referentials: **ISO/IEC/IEEE 29148:2018** (requirements), **WCAG 2.2** (accessibility, lineage ISO/IEC 40500), **OWASP Benchmark / NIST SAMATE Juliet** (SAST corpora), **RAGAS / IR metrics** (research & retrieval).

## Agent skill (kind = skill) — ultraeval skill referential v1

| id | dimension | w | anchor | perfect |
|----|-----------|---|--------|---------|
| grounding | Correctness & grounding | .30 | ISO/IEC 25059:2023 — functional correctness for AI systems | every claim resolves to real source; gates pass on genuine AND fail on doctored artifacts |
| coverage | Functional coverage | .25 | ISO/IEC 25010:2023 — functional completeness | every mode/command/flag/gate works as documented |
| ux | UX & meets-expectations | .20 | ISO/IEC 25010:2023 — interaction capability | the real deliverable is production-quality, low-friction |
| safety | Safety & robustness | .15 | ISO/IEC 25010:2023 — safety (fail safe) | no destructive defaults, graceful degradation without deps/network |
| docs | Docs consistency | .10 | ISO/IEC 25010:2023 — user assistance | SKILL.md, README, --help, and behavior agree; examples run |

## Codebase / library (kind = codebase) — ISO/IEC 25010:2023

| id | dimension | w | anchor | perfect |
|----|-----------|---|--------|---------|
| correctness | Correctness | .30 | functional correctness; faultlessness | correct on happy AND edge paths; no logic bugs |
| tests | Test quality | .20 | maintainability — testability | tests fail when the code is wrong (not just coverage %) |
| security | Security | .20 | security — confidentiality, integrity, resistance | no exploitable source→sink flows; inputs validated |
| maintainability | Maintainability | .20 | maintainability — modularity, analysability, modifiability | clear boundaries, low duplication |
| performance | Performance | .10 | performance efficiency | no hot-path waste; scales to realistic inputs |

## Category tweaks

`init --category "<c>"` now auto-selects the right set: a category matching security/SAST → precision/recall/false-positive-rate; web/frontend → base + accessibility + auth; research/RAG/retrieval → faithfulness/retrieval/coverage/hallucination; requirements/PRD/SRD → completeness/consistency/verifiable-acceptance/traceability; CLI → base + ergonomics. Otherwise the kind base applies. The research stage still refines weights/anchors.


- **CLI tool** — add `ergonomics` (help, error messages, exit codes); weight `ux` up.
- **Web app** — add `accessibility` (WCAG 2.2 AA) and `auth` (authz/session); weight `security` up.
- **Security/analysis tool** — split `correctness` into `precision` and `recall` (measure against a labelled corpus: OWASP Benchmark, Juliet); add `false-positive-rate`.
- **Research / RAG / doc tool** — replace `correctness` with `faithfulness` (attributable-to-source) + `retrieval` (recall@k, MRR).
- **Requirements / PRD generator** — dimensions from ISO/IEC/IEEE 29148: `completeness`, `consistency`, `verifiable-acceptance`, `traceability`.

## Rules

- Weights sum to ~1.0. Keep 4–6 dimensions — more dilutes the signal.
- Every dimension needs a measurable 0–5 anchor, not a vibe. If you cannot state how to measure it, it is not a dimension.
- Every dimension MUST carry at least one `anchors[]` referential entry; research MAY refine it with cited justification, never silently drop it (normative rules: `references/protocol.md`).
- A P0 finding on any dimension caps "meets expectations" at false regardless of the weighted mean (severity definitions: `references/protocol.md`).
