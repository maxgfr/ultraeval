# Troubleshooting — symptom → cause → command

Mid-run recovery. Start with `status --run <RUN>`: it prints which artifacts exist and the exact next command, and it answers "where did I stop?" faster than reading this file.

`check`, `status` and `history` write nothing — run them as often as you like, in parallel, without side effects.

## The pipeline stalled or the run is half-finished

**I lost track of where the run is.**
`status --run <RUN>` (add `--json` for a machine-readable checklist). Every stage is idempotent from its inputs: re-running `plan`, `check`, `verify`, `backlog`, `score` or `render` on an existing run is safe. Only `clean --all` and `verify --apply` change history.

**`eval.workflow.mjs` throws a `SyntaxError`, or nothing happens, under `node`.**
It is a Workflow-harness script — `agent()`, `phase()`, `parallel()`, `log()` are globals the harness injects, not Node builtins. Launch it with your Workflow tool (`Workflow({ scriptPath: "<RUN>/eval.workflow.mjs" })`), or run the stages by hand from `agents/*.md`. Run under plain `node` it prints that guidance and exits 2.

**I have no Workflow harness at all.**
`plan --run <RUN> --eco` writes `RUNBOOK.md` instead: the same stages, the same contracts, played sequentially as self-pass checklists. Correctness-identical; only wall-clock differs. Note that `--eco` **deletes** `eval.workflow.mjs` and vice versa — the two entry points never coexist.

**A stage subagent came back with nothing, or with prose instead of artifacts.**
Almost always a relative path: a subagent has its own cwd and cannot resolve `scripts/ultraeval.mjs`. Re-dispatch with the **absolute** ENGINE, TARGET and RUN paths in the prompt (`plan` already bakes them into the workflow). Second most common cause: the contract file name — the Results stage reads `agents/remediator.md`, not `agents/results.md`.

**The target is too big to read.**
Scope it rather than skimming it: `init --scope "src/domain/**"` binds every contract to those globs and makes `check` fail findings cited outside them. For a PR-sized run use `init --since origin/main`. To navigate a large repo at all, the sibling skill **ultraindex** builds a map first.

**A live step is hanging.**
Kill it. Every Bash step in the executor contract is timeboxed (≤ 10 min) and a hang is worse than a gap — it consumes the budget and produces nothing. Record "timed out", degrade to the offline path, continue. If the target is itself an evaluator or orchestrator, you must NOT launch its generated multi-agent workflow from inside the executor: that nested fan-out once hung a self-run for about four hours (`references/protocol.md`, self-evaluation constraint).

## The gate is red

**`check` fails on a citation.**
Read `references/finding-quality.md` § *Deleting versus repairing*. Short version: if you can point at the code before searching for a line number, fix the ref; if you are hunting for a line to justify a sentence you already wrote, delete the finding. Never lower `--coverage-min` to get past it.

**`check` fails with "grounded only in the run's own artifacts".**
The evidence-laundering guard. A finding cited only as `run:runs/core.md#L12` is proving itself with a log it wrote. Add at least one target `path[:line]`.

**`check --require-verify` fails although I filled every verdict.**
It demands **pair-level** coverage: every `(finding × cited evidence)` pair needs a verdict, not one blanket verdict per finding. Re-open `VERIFY.todo.json` and check for pairs with an empty `verdict`. An invalid verdict token is ignored rather than accepted, so a typo reads as unfilled.

**I edited `VERIFY.json` and the gate still fails.**
By design. `check` re-reduces the raw `verdicts[]` against the current findings and unions the result with the stored failures, so hand-scrubbing cannot make it pass. Fix the finding or dismiss it.

**`check` warns "dimensions changed since init".**
The `dimensionsHash` stamped at `init` no longer matches `eval.config.json`. This is a WARNING and it is EXPECTED when the research stage refined the rubric — it is recorded for the audit trail and never fails the gate.

**`check --coverage-min 0.9 --strict` behaves like 1.0.**
`--strict` overrides `--coverage-min`; it does not take the maximum. `--strict` can only tighten.

**A flag value is rejected with "expects a number".**
Deliberate. A non-numeric value used to become `NaN` and silently switch the gate off while exiting 0. Pass a real number.

## verify / skeptics

**`verify --apply` says "verdicts file not found".**
The path does not exist. `--apply` resolves against the cwd first, then the run dir. Point it at the FILLED `VERIFY.todo.json` (or a `{"pairs":[…]}` file) — **never** at `VERIFY.honeypots.json`, which is the ground truth and must never reach a skeptic.

**`verify --apply` exits 1 on a honeypot.**
A planted trap was graded `supported` or `partial` — the skeptic rubber-stamped. `partial` counts: half-endorsing a trap is endorsing it. The exit gate stays red until a **fresh** skeptic re-verifies; do not re-grade with the same agent, and do not lower `--honeypots`.

**`verify --honeypots N` warns "only k/N planted", or "0 planted".**
A trap needs two gradeable claim↔evidence pairs from DISTINCT findings, and a small run exhausts that pool. Lower `--honeypots` or add grounded findings. `0 planted` means skeptic-QC did not run for that worklist — say so rather than reporting the requested count.

**`verify --shard 1` is rejected.**
`--shard` and `--shards` are two halves of one knob. A shard index alone used to fall through to the *unsharded* filenames and overwrite the full worklist, so the pairs that skeptic never saw vanished from the gate. Pass both: `--shards 3 --shard 1`.

**Sharded skeptics finished — how do I reassemble?**
`verify --run <RUN> --apply verdicts.0.json,verdicts.1.json,verdicts.2.json`. Later files win per claim+evidence pair.

**The worklist is truncated.**
`--max-verify` caps at 60 pairs and beyond-cap evidence is never graded — and `check --require-verify` re-derives with the same cap, so the shortfall is invisible to the gate. Shard the work instead of raising the cap blindly, and record the truncation in `SUMMARY.md`.

## score / judge / compare

**`score` errors instead of printing a number; `judges.jsonl` is missing.**
`score` refuses to emit a plausible `0/100` from an empty panel: with no `judges.jsonl` it throws ("no judge verdicts…") and exits 2. Dispatch the judge panel (`agents/judge.md`) to append `judges.jsonl`, then re-run.

**`agreement` is `NA`.**
A single-judge panel has zero dispersion everywhere, which the formula would read as perfect consensus. Agreement is only reported for a panel of two or more.

**`judgesIndependent: false`.**
Every `judges.jsonl` line carries the same `author`. High agreement across one author is self-consistency, not consensus — dispatch genuinely separate judges.

**`meetsExpectations` is false although the score is above 80.**
Four separate vetoes exist: a live P0 defect, any judge voting no, a panel with zero passed calibrations (`judgesCalibrated: 0/N`), or a score below **the run's** bar — which is 80 by default but is set per run with `init --bar <n>`. Read the scorecard's verdict line; it names which one fired.

**`compare` refuses to read a delta / warns about provenance.**
Two runs are comparable only when `protocolVersion`, `rubricVersion` and the dimension ids/weights all match. A rubric change must never read as a quality delta. Note that `compare` does **not** flag a differing `meetsBar` — check that yourself before reporting a trend.

**A one-shot run cannot be gated.**
`check --require-verify` refuses on a `oneshot` profile: there is no verify phase. Present the result as indicative, or upgrade in place with `plan --run <RUN>` (which removes `ONESHOT.md` and clears the profile).

## fix loop

**`verify-fix` fails although the tests pass.**
It gates test-first via `red.expectedNew`, and it fails closed. A test file that already existed when the backlog was generated is not a failing-test-first authored for this task, and a backlog predating the field cannot be verified at all — regenerate it with `backlog --run <RUN> --tdd`. Full table in `references/tdd-remediation.md`.

**`verify-fix` hangs.**
Its verify command runs through a shell with a fixed 10-minute timeout and there is no flag to change it. Make the card's `verify.command` narrow (the new test plus the suite), not a full CI pipeline.

**`fix` cannot find `BACKLOG.json`.**
`backlog --out <dir>` can write the backlog elsewhere, but `fix` and `verify-fix` only read it from `<RUN>`. Keep the backlog in the run dir.

## cleanup

**What does `clean` actually remove?**
Derived gate/render artifacts only: `VERIFY.todo.json`, `VERIFY.md`, `VERIFY.json`, `VERIFY.honeypots.json`, every sharded `VERIFY.*`, `index.html`, `index.md`, `eval.sarif`. It keeps the deliverables — `findings.json`, `RESULTS.md`, `SUMMARY.md`, `BACKLOG.json`, `fixes/`, `scorecard.json`, `ANALYSIS.md`, `COMPARE.md`. `--all` removes the whole run. It refuses to touch a directory with no `eval.config.json` (exit 2), so it can never be pointed at a source tree by accident.
