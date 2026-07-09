# Eval playbook — the method

The goal is a verdict you can trust and a fix plan a model can execute. Two evidence layers feed every finding:

- **Deterministic layer** — drive the target's own engine/tests and, if it ships gates, prove them in BOTH directions (pass on a genuine artifact, fail on a doctored one). Exit codes are ground truth.
- **Live layer** — act as a real user of the target and produce a real deliverable. Judge its quality, grounding, and failure modes.

## Stages

1. **Research (per dimension).** Find the *state of the art for evaluating this kind of target*, not just the target. For a RAG/skill: faithfulness / citation precision-recall / hallucination rate (RAGAS, attributable-to-source). For a SAST tool: precision/recall vs OWASP Benchmark / Juliet, false-positive rate, reachability. For requirements: INVEST, ISO/IEC/IEEE 29148. For an a11y checker: WCAG/ACT-Rules coverage, axe comparison. Distil each into a 0–5 rubric with anchors. Each dimension already carries a machine-readable `anchors[]` referential — refine it with cited justification, never silently drop it (`references/protocol.md`).

2. **Test plan.** Enumerate EVERY functionality: modes, subcommands, flags, gates, and the live end-to-end behavior — mapped to dimensions, each with a concrete command/prompt and pass criteria.

3. **Execute.** Run the deterministic layer (record exact commands + exit codes into `runs/core.md`, line numbers matter — findings cite `run:runs/core.md#Lnn`) and the live layer (`runs/live.md` + real artifacts).

4. **Findings.** One record per real defect, each grounded in `file:line` or a run log. Never keep a finding you cannot ground — delete it. Severity by impact (P0 trust/correctness/data-loss).

5. **Gate.** `check` → `verify` → `--apply` → `check --semantic --require-verify`. Iterate until green; a `refuted` finding is dismissed.

6. **Judge.** Independent panel, distinct lenses (correctness+grounding · completeness+coverage · ux+meets-expectations). Score each dimension 0–5; objective gate results outweigh opinion.

7. **Results + remediation.** Scorecard, then `backlog --tdd`.

## Scoring

Overall = weighted mean of dimension scores (weights in `dimensions.json`), normalized to 0–100. "Meets expectations" is a separate boolean: it is `false` if any P0 finding stands, or if the as-shipped path to the good deliverable has real gaps — score the *shipped* thing, not the destination an expert could reach by hand.

Every run records provenance (engine/protocol/rubric versions, target git SHA); a score is only comparable to another run's score under the same protocol and rubric versions — `compare` warns otherwise. See `references/protocol.md`.

## Anti-patterns

- Scoring the target's *potential* instead of its *shipped* behavior.
- Findings grounded in the model's memory of the code rather than the code (that is exactly what `check` catches).
- A single judge for a subjective call — use the panel.
- Stopping verification early: `check --semantic --require-verify` is the exit gate.
