# Gate contract — findings, evidence, check/verify

The anti-hallucination core. Two layers: `check` (structural — does the citation resolve?) and `verify` → `check --semantic` (does the cited content *support* the claim?).

## findings.json

```jsonc
{
  "findings": [
    {
      "id": "F1",                       // F<number>, unique
      "dimension": "security",           // optional; one of the run's dimension ids
      "severity": "P0",                  // P0 Critical · P1 Major · P2 Minor — normative definitions in references/protocol.md (SEVERITY_DEFS)
      "title": "SQL injection in /u",
      "statement": "req.query.id flows unsanitized into a SELECT string.",
      "evidence": [                       // >= 1 resolvable ref REQUIRED
        { "ref": "src/app.js:3", "note": "interpolated into SQL" },
        { "ref": "run:runs/core.md#L2", "note": "scanner confirmation" }
      ],
      "failureScenario": "GET /u?id=1 OR 1=1 dumps all users.",
      "recommendation": "Use a parameterized query.",
      "tags": ["scope-exempt"],          // optional; scope-exempt = justified cross-cutting finding cited outside a declared file scope (downgrades the scope failure to a warning)
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
| `analysis:<path>` | the **target** repo | provenance-tagged (from `analyze`); resolves like a target path |
| `url:https://…` | — | recorded, **not** graded offline (cannot alone ground a finding) |
| absolute / outside-target path | — | never read (traversal guard); not graded |
| `run:../…` escaping the run dir | — | never read (same guard applied to `run:` refs); not graded |

`--scope` globs use a minimal zero-dependency dialect: `**`, `*`, `?` and `{a,b}` only — **no negation, no nested braces**. Absolute paths and `..` are rejected at `init`.

## `check --run <RUN>` — structural gate (exit 0 = grounded)

Exit **1** = the gate failed. Exit **2** = the run is unreadable (usage error), which is a different problem: `eval.config.json` or `findings.json` **present but invalid JSON**, or a run dir with no `eval.config.json` at all. A *missing* `findings.json` is a plain gate failure (exit 1).

FAILS (exit 1) when:

*Grounding*
- a non-dismissed finding has **no resolvable evidence**, or cites a **file that does not exist** or a **line out of range** (the "hallucinated or stale" case).
- **evidence laundering**: a non-dismissed finding is grounded **only** in `run:` artifacts the eval wrote itself. Every finding must also anchor to at least one target `path[:line]` — a log you produced cannot be its own proof.

*Schema*
- a finding has a non-`F\d+`/duplicate `id`, a `severity` not in `P0|P1|P2`, a `status` not in `open|confirmed|dismissed`, a missing `title`/`statement`, no `evidence` array, an invalid `kind`, or (for `kind:"opportunity"`) a missing/invalid `impact` (high|med|low) or `effort` (S|M|L).

*Reports & backlog*
- `RESULTS.md` has a **dangling `[F#]`** (no such finding), or its citation coverage < `--coverage-min` (default 0.6; `--strict` = 1.0). Flag genuine narrative with `[M]`.
- `BACKLOG.json` references a missing or dismissed finding, or is present but invalid JSON.
- `--min-findings N` and fewer findings exist. (`--min-findings 0` is falsy and therefore a no-op.)

*Scope*
- the run declares a **file scope** (`init --scope`) and a non-dismissed finding's target citations all fall **outside the scope** — unless the finding carries `tags: ["scope-exempt"]` (justified cross-cutting issue), which downgrades to a visible warning.
- `--strict-scope` on a **diff-scoped** run (`init --since`): promotes the "cites only unchanged files" warning into a hard failure.

*Semantic layer (`--semantic` / `--require-verify`)*
- a finding still `confirmed`/`open` that appears in `VERIFY.failures`.
- `VERIFY.json` present but invalid JSON.
- `--require-verify` with **no adjudicated `VERIFY.json`**, with **unadjudicated findings**, or with **incomplete pair-level coverage** — see below.
- an unresolved **honeypot failure** (a planted trap graded `supported` or `partial`).
- `--require-verify` on a **one-shot run** (`oneshot`): refused explicitly — no verify phase exists; `plan --run <RUN>` upgrades the run.

WARNS (never fails the gate): a finding still `open` · a `confirmed` finding with no `recommendation` (its backlog card will be vague) · `RESULTS.md` present without `SUMMARY.md` · a `BACKLOG.json` task marked `done` whose finding is still `open` · `--semantic` with no `VERIFY.json` at all · `--semantic` with a `VERIFY.json` carrying no verdict rows · a diff-scoped run whose findings cite only unchanged files (without `--strict-scope`) · a `scope-exempt` finding · a budgeted run (`runs/budget.md`) whose `SUMMARY.md` omits the coverage cuts · a legacy run with no provenance block · `dimensionsHash` drift (the rubric was edited after `init` — expected when research refined it) · an unresolvable `--since` ref.

Flags: `--semantic` (fold VERIFY.json) · `--require-verify` (the deep exit gate) · `--strict` · `--strict-scope` · `--coverage-min <0..1>` · `--min-findings <n>` · `--json` (print the `CheckResult` verbatim; exit code unchanged).

**`--strict` overrides `--coverage-min`, it does not take the max.** `--strict --coverage-min 0.9` runs at 1.0; `--strict` can only tighten. Conversely a non-numeric value is a usage error (exit 2) — the gate is never silently disabled by a typo.

### Two verify-layer rules that surprise people

- **`--require-verify` demands *pair-level* coverage.** Every `(finding × cited evidence)` pair in the worklist must carry a verdict; one blanket verdict per finding does not satisfy it. This is stricter than the reduction rule below, which asks only how a finding's verdicts combine.
- **`check` re-reduces the raw verdicts itself.** It recomputes `VERIFY.failures` from the `verdicts[]` rows against the *current* findings and unions the result with the stored `failures`/`unadjudicated`. Hand-scrubbing `VERIFY.json` to drop a failure therefore cannot make the gate pass — it fails closed.

## `verify` — adversarial semantic gate

- `verify --run <RUN>` writes `VERIFY.todo.json` (one `{claimId, evidenceRef, claim, digest}` pair per gradeable evidence; `digest` is the extracted source/log context) + `VERIFY.md`. `--shards N --shard i` writes a disjoint slice to `VERIFY.todo.<i>.json` + `VERIFY.<i>.md` (not the unsharded filenames) for parallel skeptics; **`--shard` without `--shards` is a usage error** (exit 2) — it must never silently write the unsharded filenames and clobber the full worklist. `--max-verify N` caps (default 60); **beyond-cap evidence is never graded**, and `check --require-verify` re-derives with the same cap, so a truncated worklist is invisible to the gate — shard instead of raising it blindly.
- **Worklist mode always exits 0.** `verify --run <RUN>` (without `--apply`) is a generator, not a gate; only `--apply` and `check` can fail.
- **Honeypots can under-plant.** A trap needs two gradeable pairs from *distinct* findings, so a small run plants fewer than requested — possibly zero, which means skeptic-QC did not run for that worklist. The reported count is always the number actually planted, never the number requested.
- Fill each pair's `verdict`: `supported` (source states it) · `partial` (weaker version) · `unsupported` (does not address it) · `refuted` (contradicts it). An invalid token is ignored — it cannot false-green.
- The verdicts file `--apply` accepts: `{ "pairs": [ { "claimId": "F1", "evidenceRef": "src/app.js:3", "verdict": "supported", "note": "…" } ] }` — a bare array of the same items works too, and the filled `VERIFY.todo.json` is itself valid input. `evidenceRef`/`note` are optional: verdicts reduce **per finding** (claimId); `evidenceRef` is the merge key when combining sharded verdict files (last one wins).
- `verify --run <RUN> --apply <verdicts.json|a,b,c>` reduces to `VERIFY.json`. A finding **fails** if any evidence is `refuted`, or all its evidence is `unsupported`. A planted honeypot graded **`supported` OR `partial`** is a skeptic-QC failure — `partial` counts, because half-endorsing a trap is still endorsing it. `--apply` resolves its argument against the cwd first, then the run dir, and rejects a wrong-shaped file with the expected schema rather than a raw `ENOENT`.
- `check --run <RUN> --semantic` folds `VERIFY.json` in — additive, can only ADD a failure: a finding still `confirmed`/`open` but in `VERIFY.failures` fails the gate. Dismiss it or fix the claim.
