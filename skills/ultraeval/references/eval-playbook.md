# Eval playbook — the method

The goal is a verdict you can trust and a fix plan a model can execute. Two evidence layers feed every finding:

- **Deterministic layer** — drive the target's own engine/tests and, if it ships gates, prove them in BOTH directions (pass on a genuine artifact, fail on a doctored one). Exit codes are ground truth.
- **Live layer** — act as a real user of the target and produce a real deliverable. Judge its quality, grounding, and failure modes.

## Stages

1. **Research (per dimension).** Establish the *state of the art for evaluating this kind of target*, not facts about the target. **Start from `references/methodology-library.md`** — it already carries, per dimension: the metric, how to obtain it on a real target, 0–5 anchors, and what fools the metric (RAGAS faithfulness for a RAG/skill; precision/recall/FPR vs OWASP Benchmark or Juliet for a SAST tool; the ISO/IEC/IEEE 29148 characteristics for requirements; WCAG 2.2 AA + ACT Rules for a11y). That pack is the baseline rubric.

   Web-search **only** to close a gap the pack leaves, to re-check a figure that could have moved, or when no block covers the category — the methodology for a category does not change between targets, so rediscovering it every run is pure cost. No network is not a blocker: derive the rubric from the pack, say so in the note, and continue.

   Each dimension already carries a machine-readable `anchors[]` referential — refine it with cited justification, never silently drop it (`references/protocol.md`).

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
