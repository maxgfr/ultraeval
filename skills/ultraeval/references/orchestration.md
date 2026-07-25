# Orchestration — the generated workflow & subagent contracts

`plan` emits `<RUN>/eval.workflow.mjs` and `<RUN>/agents/*.md`. The workflow is the map; the contracts are the per-role instructions.

## Portability contract

Every step is a plain `node <skill-dir>/scripts/ultraeval.mjs <cmd>` call. Parallel subagents are an **optimization, not a requirement** — the same eval runs as a sequential loop. Write nothing that depends on a specific runtime.

**The absolute-path invariant.** A subagent runs in its **own context**: it sees none of this conversation, has its own cwd, and no notion of a "run dir" or "skill dir". So the parent MUST substitute the **absolute** path to `scripts/ultraeval.mjs` and the absolute `RUN`/`TARGET` into every subagent prompt. `plan` already bakes these into `eval.workflow.mjs` (it injects `ENGINE`, `TARGET`, `RUN` as constants and hands each agent its contract path), so the generated workflow is portable as-is.

## The pipeline (what eval.workflow.mjs runs)

```
stage       contract file             agents                              produces
Research    agents/researcher.md      1 per dimension, parallel           research/<dim>.md, each with a 0–5 rubric
TestPlan    agents/testplan.md        1                                   TEST-PLAN.md
Execute     agents/executor.md        2 (MODE=core, MODE=live)            runs/core.md, runs/live.md, real artifacts
Findings    agents/findings.md        1                                   findings.json (schema-checked, grounded)
Analyze     agents/analyzer.md        1  (improve/deep only)              analysis.json, ANALYSIS.md
Brainstorm  agents/brainstormer.md    1  (improve/deep only)              opportunities.json -> findings.json
Gate        agents/gate.md            1                                   check -> verify -> --apply -> check --semantic until exit 0
Judge       agents/judge.md           3, distinct lenses                  judges.jsonl (dimension scores, meetsExpectations)
Results     agents/remediator.md      1                                   RESULTS.md, SUMMARY.md, backlog --tdd, render
```

**The stage name is not always the file name.** The Results stage reads `agents/remediator.md` — there is no `agents/results.md`. `plan` writes all nine contracts unconditionally, whatever the mode; the *mode* decides which stages the workflow runs, not which contracts exist. In `--mode improve` the workflow drops Execute and Findings entirely (opportunities only); in `audit` it drops Analyze and Brainstorm; `deep` runs all of them.

Use `pipeline()` across dimensions where your harness supports it (so dimension B researches while A is judged); use `parallel()` only when a stage genuinely needs all prior results at once.

## Subagent dispatch (no-harness fallback)

For each stage, dispatch one subagent with a prompt of the form — using the **contract file name from the table above**, not the stage name:

> Read and follow the contract at `<RUN>/agents/<contract>.md` verbatim. Constants: TARGET=`<abs>` ENGINE=`<abs>` RUN=`<abs>`. Invoke the engine only by its absolute path: `node <ENGINE> <cmd>`. Write every artifact under RUN. Do not stop early. Reply with: what you wrote (paths) and any new sub-questions.

### Parallel verification (skeptics)

`verify --run <RUN> --shards N --shard i` writes a disjoint, deterministic slice `VERIFY.todo.<i>.json`. Give one shard to each skeptic subagent with the instruction: *default to the harsher verdict when unsure; save `verdicts.<i>.json`.* Reassemble with `verify --run <RUN> --apply verdicts.0.json,verdicts.1.json,…` (last-wins merge by claim+evidence key).

## Budgets

Keep the fan-out proportional to the ask: a quick "is this ok?" is a few dimensions + single-vote verify; "exhaustively audit this" is the full dimension set + a 3-skeptic verify pass + the judge panel. Log any coverage you cap (dimensions skipped, findings not verified) — silent truncation reads as "covered everything".
