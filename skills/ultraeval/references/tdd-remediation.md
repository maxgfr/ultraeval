# TDD remediation — BACKLOG.json & FIX cards

`backlog --run <RUN> --tdd` turns confirmed findings into work a model can execute red→green→refactor. Dismissed findings and ones `verify` refuted are excluded automatically.

## BACKLOG.json (machine-readable)

```jsonc
{
  "target": "/abs/path/to/target",
  "generatedFrom": "/abs/path/to/run",
  "tasks": [
    {
      "id": "FIX-001",
      "findingId": "F1",
      "kind": "defect",                 // defect | opportunity (mirrors the finding's kind)
      "priority": "P0",                 // tasks are emitted P0 → P1 → P2
      "title": "SQL injection in /u via req.query.id",
      "rationale": "GET /u?id=1 OR 1=1 dumps all users.",
      "targets": ["src/app.js"],        // files the fix touches (from the finding evidence)
      "red":   {
        "testFile": "tests/app.test.js",
        "expectedNew": true,            // the file did NOT exist at backlog time -> verify-fix requires it to exist now
        "description": "Write a failing test that reproduces: …"
      },
      "green": { "change": "Use a parameterized query for the id." },
      "verify":{ "command": "run the new test (must pass) + the full suite (nothing regresses)" },
      "dependsOn": []                   // derived: tasks sharing a target file chain to the previous holder
    }
  ]
}
```

`dependsOn` is derived from shared `targets` files: when two tasks touch the same file, the later (lower-priority) one depends on the earlier — respect it before dispatching fix agents in parallel. Task order in `tasks[]` is topological over `dependsOn`.

## Closing the loop: `fix` and `verify-fix`

- `fix --run <RUN> [--task FIX-XXX] [--workflow]` emits one **autonomous fix-agent contract** per task at `fixes/agents/FIX-XXX.agent.md` — the TDD card plus absolute target/run paths, the target's own invariants (test suite, build step, conventional commit) and a no-gate-weakening rule. `--workflow` also emits `fix.workflow.mjs` (sequential over the cards, dependsOn-safe; set its `ISOLATION` const to `'worktree'` to isolate each agent).
- `verify-fix --run <RUN> --task FIX-XXX` replays the task's `verify.command` (timeboxed, in the target) **and gates test-first via `red.expectedNew`**; on success it stamps `status: "done"` + `verifiedAt` (ISO 8601) into `BACKLOG.json`, otherwise exit 1. A `done` task whose finding is still `open` makes `check` warn.
- Tasks without a `status` field are simply not-yet-verified.

### The test-first gate (`red.expectedNew`)

`backlog` records whether the RED test file **already existed** when the card was generated. `verify-fix` uses that to tell a genuinely test-first fix from one that rode on a pre-existing test — it **fails closed**, never open:

| `red.expectedNew` | file exists now? | verdict |
|---|---|---|
| `true` (file was absent at backlog time) | yes | **pass** — a test was authored for this task |
| `true` | no | **fail** — the fix was not test-first |
| `false` (file already existed) | yes or no | **fail** — a pre-existing test is not a failing-test-first authored for this task; write a new task-specific RED test |
| absent (legacy backlog) | yes or no | **fail** — no recorded pre-existence state, so test-first cannot be confirmed; regenerate the backlog with `backlog --run <RUN> --tdd` |

A backlog generated before this field existed therefore cannot be verified: regenerate it rather than hand-adding `expectedNew`.

A downstream agent (or a `to-issues`-style skill) consumes `tasks[]` directly: one issue/PR per task, priority-ordered.

## fixes/FIX-*.md (one TDD card per task)

Each card is self-contained so a build agent needs nothing else:

```
# FIX-001 — <title>  (P0)
**Finding F1:** <statement>
**Evidence:** `src/app.js:3`, `run:runs/core.md#L2`
**Why it matters:** <failureScenario>

## RED — write this test first
<what to assert>            ← write it, watch it FAIL before touching impl
Suggested test file: `tests/app.test.js`

## GREEN — make it pass
<the minimal change>        ← touch only the listed targets, do not weaken any gate

## VERIFY
<command>                   ← RED test now passes, nothing regresses
```

## Driving the fixes

Feed cards to a build agent **one at a time, P0 first**. Enforce the discipline: the RED test is written and observed failing *before* the implementation changes (that is the whole value — a test written after the fix proves nothing). After GREEN, re-run the target's own gate and, if it is an ultraeval-evaluated skill, re-run `check --semantic` on the eval run to confirm the finding is genuinely resolved.
