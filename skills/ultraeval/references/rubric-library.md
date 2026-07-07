# Rubric library — starter dimensions per category

`init` seeds `eval.config.json` with a starter set by kind; the research stage refines weights and anchors. Below are proven dimension sets to adapt.

## Agent skill (kind = skill)

| id | dimension | w | perfect |
|----|-----------|---|---------|
| grounding | Correctness & grounding | .30 | every claim resolves to real source; gates pass on genuine AND fail on doctored artifacts |
| coverage | Functional coverage | .25 | every mode/command/flag/gate works as documented |
| ux | UX & meets-expectations | .20 | the real deliverable is production-quality, low-friction |
| safety | Safety & robustness | .15 | no destructive defaults, graceful degradation without deps/network |
| docs | Docs consistency | .10 | SKILL.md, README, --help, and behavior agree; examples run |

## Codebase / library (kind = codebase)

| id | dimension | w | perfect |
|----|-----------|---|---------|
| correctness | Correctness | .30 | correct on happy AND edge paths; no logic bugs |
| tests | Test quality | .20 | tests fail when the code is wrong (not just coverage %) |
| security | Security | .20 | no exploitable source→sink flows; inputs validated |
| maintainability | Maintainability | .20 | clear boundaries, low duplication |
| performance | Performance | .10 | no hot-path waste; scales to realistic inputs |

## Category tweaks

- **CLI tool** — add `ergonomics` (help, error messages, exit codes); weight `ux` up.
- **Web app** — add `accessibility` (WCAG 2.2 AA) and `auth` (authz/session); weight `security` up.
- **Security/analysis tool** — split `correctness` into `precision` and `recall` (measure against a labelled corpus: OWASP Benchmark, Juliet); add `false-positive-rate`.
- **Research / RAG / doc tool** — replace `correctness` with `faithfulness` (attributable-to-source) + `retrieval` (recall@k, MRR).
- **Requirements / PRD generator** — dimensions from ISO/IEC/IEEE 29148: `completeness`, `consistency`, `verifiable-acceptance`, `traceability`.

## Rules

- Weights sum to ~1.0. Keep 4–6 dimensions — more dilutes the signal.
- Every dimension needs a measurable 0–5 anchor, not a vibe. If you cannot state how to measure it, it is not a dimension.
- A P0 finding on any dimension caps "meets expectations" at false regardless of the weighted mean.
