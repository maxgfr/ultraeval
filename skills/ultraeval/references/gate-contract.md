# Gate contract — findings, evidence, check/verify

The anti-hallucination core. Two layers: `check` (structural — does the citation resolve?) and `verify` → `check --semantic` (does the cited content *support* the claim?).

## findings.json

```jsonc
{
  "findings": [
    {
      "id": "F1",                       // F<number>, unique
      "dimension": "security",           // optional; one of the run's dimension ids
      "severity": "P0",                  // P0 trust/correctness/data-loss · P1 fidelity/coverage · P2 polish
      "title": "SQL injection in /u",
      "statement": "req.query.id flows unsanitized into a SELECT string.",
      "evidence": [                       // >= 1 resolvable ref REQUIRED
        { "ref": "src/app.js:3", "note": "interpolated into SQL" },
        { "ref": "run:runs/core.md#L2", "note": "scanner confirmation" }
      ],
      "failureScenario": "GET /u?id=1 OR 1=1 dumps all users.",
      "recommendation": "Use a parameterized query.",
      "status": "confirmed"              // open | confirmed | dismissed
    }
  ]
}
```

## Evidence `ref` grammar

| form | resolves against | checked |
|------|------------------|---------|
| `path:line` or `path:start-end` | the **target** repo | file exists AND line(s) in range |
| `path` (no line) | the target repo | file exists (file-scoped citation) |
| `run:relpath` or `run:relpath#Lnn` | the **eval run** dir | file exists (and line in range) |
| `url:https://…` | — | recorded, **not** graded offline (cannot alone ground a finding) |
| absolute / outside-target path | — | never read (traversal guard); not graded |

## `check --run <RUN>` — structural gate (exit 0 = grounded)

FAILS when:
- `eval.config.json` or `findings.json` is missing/invalid.
- a non-dismissed finding has **no resolvable evidence**, or cites a **file that does not exist** or a **line out of range** (the "hallucinated or stale" case).
- `RESULTS.md` has a **dangling `[F#]`** (no such finding), or its citation coverage < `--coverage-min` (default 0.6; `--strict` = 1.0). Flag genuine narrative with `[M]`.
- `BACKLOG.json` references a missing or dismissed finding.
- `--min-findings N` and fewer findings exist.

Flags: `--semantic` (fold VERIFY.json), `--require-verify` (fail if no adjudicated VERIFY.json — the deep exit gate), `--strict`, `--coverage-min <0..1>`, `--min-findings <n>`.

## `verify` — adversarial semantic gate

- `verify --run <RUN>` writes `VERIFY.todo.json` (one `{claimId, evidenceRef, claim, digest}` pair per gradeable evidence; `digest` is the extracted source/log context) + `VERIFY.md`. `--shards N --shard i` writes a disjoint slice for parallel skeptics; `--max-verify N` caps (default 60).
- Fill each pair's `verdict`: `supported` (source states it) · `partial` (weaker version) · `unsupported` (does not address it) · `refuted` (contradicts it). An invalid token is ignored — it cannot false-green.
- `verify --run <RUN> --apply <verdicts.json|a,b,c>` reduces to `VERIFY.json`. A finding **fails** if any evidence is `refuted`, or all its evidence is `unsupported`.
- `check --run <RUN> --semantic` folds `VERIFY.json` in — additive, can only ADD a failure: a finding still `confirmed`/`open` but in `VERIFY.failures` fails the gate. Dismiss it or fix the claim.
