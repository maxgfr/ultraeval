# Orchestration — the generated workflow & subagent contracts

`plan` emits `<RUN>/eval.workflow.mjs` and `<RUN>/agents/*.md`. The workflow is the map; the contracts are the per-role instructions.

## Portability contract

Every step is a plain `node <skill-dir>/scripts/ultraeval.mjs <cmd>` call. Parallel subagents are an **optimization, not a requirement** — the same eval runs as a sequential loop. Write nothing that depends on a specific runtime.

**The absolute-path invariant.** A subagent runs in its **own context**: it sees none of this conversation, has its own cwd, and no notion of a "run dir" or "skill dir". So the parent MUST substitute the **absolute** path to `scripts/ultraeval.mjs` and the absolute `RUN`/`TARGET` into every subagent prompt. `plan` already bakes these into `eval.workflow.mjs` (it injects `ENGINE`, `TARGET`, `RUN` as constants and hands each agent its contract path), so the generated workflow is portable as-is.

## The pipeline (what eval.workflow.mjs runs)

```
Research (1 agent per dimension, parallel)   -> research/<dim>.md, each with a 0–5 rubric
TestPlan (1 agent)                            -> TEST-PLAN.md
Execute  (2 agents: MODE=core, MODE=live)     -> runs/core.md, runs/live.md, real artifacts
Findings (1 agent)                            -> findings.json (schema-checked, grounded)
Gate     (1 agent)                            -> runs check -> verify -> --apply -> check --semantic until exit 0
Judge    (3 agents, distinct lenses)          -> judges.jsonl (dimension scores, meetsExpectations)
Results  (1 agent)                            -> RESULTS.md, SUMMARY.md, backlog --tdd, render
```

Use `pipeline()` across dimensions where your harness supports it (so dimension B researches while A is judged); use `parallel()` only when a stage genuinely needs all prior results at once.

## Subagent dispatch (no-harness fallback)

For each stage, dispatch one subagent with a prompt of the form:

> Read and follow the contract at `<RUN>/agents/<stage>.md` verbatim. Constants: TARGET=`<abs>` ENGINE=`<abs>` RUN=`<abs>`. Invoke the engine only by its absolute path: `node <ENGINE> <cmd>`. Write every artifact under RUN. Do not stop early. Reply with: what you wrote (paths) and any new sub-questions.

### Parallel verification (skeptics)

`verify --run <RUN> --shards N --shard i` writes a disjoint, deterministic slice `VERIFY.todo.<i>.json`. Give one shard to each skeptic subagent with the instruction: *default to the harsher verdict when unsure; save `verdicts.<i>.json`.* Reassemble with `verify --run <RUN> --apply verdicts.0.json,verdicts.1.json,…` (last-wins merge by claim+evidence key).

## Budgets

Keep the fan-out proportional to the ask: a quick "is this ok?" is a few dimensions + single-vote verify; "exhaustively audit this" is the full dimension set + a 3-skeptic verify pass + the judge panel. Log any coverage you cap (dimensions skipped, findings not verified) — silent truncation reads as "covered everything".
