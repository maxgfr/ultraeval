# Paired utility experiments

Use `benchmark` to measure a specific skill's benefit on the same tasks with and
without it. This is separate from a normed code-quality score. The engine prepares
and checks records; it does not execute agents, provide judgments, or manufacture
measurements.

## 1. Freeze a protocol

Author a UTF-8 JSON file (paths relative to that file):

```json
{
  "version": 1,
  "model": "exact-model-and-settings",
  "environment": "isolated-image-and-fixture-revision",
  "tokenBudget": 12000,
  "timeBudgetMs": 300000,
  "repetitions": 3,
  "skillFile": "skills/example/SKILL.md",
  "inputs": ["fixtures/source.txt", "skills/example/references/workflow.md"],
  "tasks": [{
    "id": "locate-behavior",
    "prompt": "Locate the behavior in source.txt and cite the exact lines.",
    "criteria": [{"id": "correct-location", "description": "Cites the actual implementation and explains its observable result."}]
  }]
}
```

Run `benchmark --spec protocol.json --out /absolute/fresh-run`. It snapshots the
skill entrypoint and explicitly listed inputs, creates randomized sample order
and opaque IDs, and writes `BENCHMARK.json` plus `RESULTS.todo.json`. List **all**
skill scripts/references and fixtures used in `inputs`; an unlisted file is not
snapshotted. Include model settings and environment identity in the declared
strings; the engine cannot inspect another session's actual configuration.

For every sample, use a fresh isolated session with the same model, prompt,
fixtures and budgets. Only `with-skill` loads the skill. Prevent automatic skill
activation in the control session. Count skill loading and all input/output
tokens. Do not omit failed or budget-exhausted attempts. Execution authorization
and side-effect boundaries come from the user's task, not this protocol.

## 2. Import real observations

Fill one row per sample in the generated results template. `status` is
`completed`, `error`, or `budget-exceeded`. Record nonnegative observed
`inputTokens`, `outputTokens`, `elapsedMs`, `costUsd` (or `null` when cost is
unknown). `output` is the relative path to the real UTF-8 result/log inside the
run directory. Preserve the assigned protocol hash, model and environment.

`benchmark --run /absolute/fresh-run --results results.json` refuses missing,
foreign or duplicate samples, incomparable protocol/model/environment, invalid
metrics, changed inputs and output paths/symlinks escaping the run. Exceeding a
budget automatically marks execution `budget-exceeded`; it remains in the
comparison as a failed attempt. Artifacts and input text are bounded to 2 MiB
each; split larger experiments. Each stage is create-only to preserve evidence.

## 3. Blind review, then reveal

Give an independent judge only `BLIND.json`, the task's reference material and
`JUDGMENTS.todo.json`. Do **not** show BENCHMARK.json or condition labels. The
packet hides conditions/costs, though generated content itself can reveal them.
For every sample × criterion, record `passed` or `failed`, a concrete note and
the supplied output and review hashes. The review hash binds the exact protocol,
criteria, outputs and imported measurements; the raw import is retained as
`IMPORTED-RESULTS.json`. Editing the packet or observation summaries invalidates
the review. Uncertain/not-tested criteria must not be marked
passed. Save the judgments and run:

```sh
node <skill-dir>/scripts/ultraeval.mjs benchmark --run /absolute/fresh-run --judgments judgments.json
```

The reducer rechecks inputs, output bytes, identity coverage and output hashes;
missing, duplicate, malformed or stale judgments exit 2. Reports are
`BENCHMARK-REPORT.json` and `.md`: paired criterion-pass fractions, wins/losses/
ties, full-task passes, total tokens/time/costs and failed executions. Errors and
budget exhaustion force that sample's pass fraction to zero regardless of its
judgments. Unknown cost stays unknown. Exit 0 means a valid comparison was
written, **not** that the skill won.

These are descriptive results for exercised tasks, not statistical significance
or a universal benefit claim. Measurements and judgments remain operator-supplied;
hash checks establish consistency, not honesty. Keep the raw outputs for later
independent validation. Synthetic fixtures can test this command but cannot be
reported as a measured productivity benefit from the skill.
