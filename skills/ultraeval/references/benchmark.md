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
unknown). Failed or budget-exhausted executions may also record `null` token
counts when the host never emitted usage; completed executions require measured
counts. A total containing unknown usage remains unknown, not zero. `output` is the relative path to the real UTF-8 result/log inside the
run directory. Preserve the assigned protocol hash, model and environment.

`benchmark --run /absolute/fresh-run --results results.json` refuses missing,
foreign or duplicate samples, incomparable protocol/model/environment, invalid
metrics, changed inputs and output paths/symlinks escaping the run. Exceeding a
budget automatically marks execution `budget-exceeded`; it remains in the
comparison as a failed attempt. Report artifacts and the skill entrypoint are bounded to 2 MiB each.
Snapshotted resources may be binary (for example WASM grammars), up to 16 MiB
per file; split larger experiments. Each stage is create-only to preserve evidence.

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

## Optional local CLI execution

From a development checkout with Codex or Claude Code already authenticated:

```sh
node scripts/run-host-benchmarks.mjs --run /absolute/run --workspace /absolute/fixtures --host codex --dry-run
node scripts/run-host-benchmarks.mjs --run /absolute/run --workspace /absolute/fixtures --host codex --limit 1
```

`--workspace` contains the fixture files listed in the frozen protocol. List all
required skill references, scripts and binary resources in `inputs` as well.
The runner copies only declared inputs to a fresh Git repository for each sample;
only the treatment receives the skill directory. It loads the skill by absolute
path. This measures the workflow, not native slash-command discovery or plugin
installation, which need separate smoke tests.

The model comes from the protocol; `--effort` defaults to `low`. The runner
records CLI version and settings, disables inherited Codex skills and plugins,
and uses Claude safe mode with explicit skill-file loading. It keeps the user's
configuration and installations unchanged. A dry run starts no agent session.
Run one pilot before a campaign: the host's system prompt and repeated cached
input count toward the token budget and can exceed a small budget by themselves.

Each finished sample saves raw events, stderr, final text, usage and process
status. Re-running skips recorded samples and refuses changed inputs, settings
or outputs. An interrupted runner leaves an unfinished sample directory; retain
its evidence and reconcile it explicitly before resuming. A quota error stops
the campaign. `--limit` limits newly executed samples, not previously recorded
ones. The runner kills the process group at the time limit; token excess is
recognized when the host emits usage, so hosts that emit usage only at turn end
can overshoot the declared token budget. Such attempts remain failed budget
observations, never successful cheap runs.

Once every sample is recorded, import `HOST-RESULTS.json` with the normal
`benchmark --run ... --results ...` command. Review the resulting blinded packet
and generated workspace artifacts before judging; execution success does not
establish task correctness. Unknown token counts stay visible in the comparison.

The selected skill is copied beside the disposable repository, never inside it.
Both arms therefore expose identical project files even to filesystem indexers.

Codex shell network access defaults to disabled. For an authorized web-research
benchmark whose engine must fetch pages, pass `--network` in both conditions;
the setting is frozen in `HOST-EXECUTION.json`. Native web search can work even
when shell DNS/fetch is blocked, so verify both capabilities before comparing
retrieval workflows. Claude uses its host network policy and rejects this
Codex-only flag. Stream logs are written incrementally, including before a host
finishes; interrupted usage remains unknown until the host reports it.

Git branches, commits and worktrees need writes to repository metadata, which
Codex protects even in a writable workspace. For authorized build benchmarks,
pass `--git-write` in both arms. It permits only each disposable fixture's own
`.git` directory, retains workspace sandboxing, and records the policy plus the
actual per-sample command. It does not grant access to the original repository.
Probe required host capabilities before counting a blocked workflow as a skill
failure; retain restricted runs as diagnostics and replay in a fresh protocol.
