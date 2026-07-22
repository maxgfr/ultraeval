# Protocol — the normed evaluation process

**Normative.** The key words MUST, MUST NOT, SHOULD, MAY are to be interpreted as in RFC 2119. This document is versioned: `PROTOCOL_VERSION` and `RUBRIC_VERSION` (in `src/types.ts`, recorded in every run's provenance) are bumped by hand in the commit that changes phase/gate semantics or starter dimensions/weights/anchors respectively.

## Phases — entry and exit criteria

Every run walks these phases in order. A phase's exit criteria MUST hold before the next phase starts; the required artifacts are the audit trail.

| phase | entry | exit criteria (required artifacts) |
|---|---|---|
| Init | target path exists | `eval.config.json` with starter dimensions AND a provenance block |
| Plan | `eval.config.json` | `eval.workflow.mjs`, `agents/*.md`, `dimensions.json`, `findings.schema.json`, `TEST-PLAN.template.md` — absolute ENGINE/TARGET/RUN paths baked in |
| Research | `dimensions.json` | one `research/<dim>.md` per dimension, each ending in a 0–5 rubric; anchors refined only with cited justification |
| TestPlan | research notes | `TEST-PLAN.md` enumerating every mode/command/flag/gate with pass criteria |
| Execute | `TEST-PLAN.md` | `runs/core.md` (exact commands + exit codes) and `runs/live.md` + real artifacts; any shipped gate proven in BOTH directions (genuine passes, doctored fails) |
| Findings | run logs | `findings.json` schema-valid; every non-dismissed finding carries ≥1 resolvable evidence ref |
| Analyze → Brainstorm (improve/deep only) | `analysis.json` | ranked opportunities folded into `findings.json` as `kind:"opportunity"`, each grounded |
| Gate | `findings.json` | `check` exit 0 → `verify` fully adjudicated → `check --semantic --require-verify` exit 0 |
| Judge | gate green | `judges.jsonl`: every dimension scored 0–5 by every lens (≥3 independent lenses SHOULD be used), each rationale grounded in a path the judge read; every judge MUST first score the golden fixture `references/calibration-run.json` and report `calibration:{scores,passed}` in its line; each line SHOULD carry an `author` (agent/session id) — agreement assumes an independent panel, and a single-author panel is flagged `judgesIndependent: false` |
| Results | `judges.jsonl` | `scorecard.json`, `RESULTS.md`, `SUMMARY.md`, `BACKLOG.json`, `fixes/`, `index.md`/`index.html`; final `check --semantic` exit 0 |

## Gate thresholds (normative constants)

- Citation coverage in `RESULTS.md`: **0.6** default, **1.0** under `--strict` (`CAPS` in `src/types.ts`).
- Verify worklist cap: **60** claim↔evidence pairs (`--max-verify`); shard for more.
- A finding FAILS verification if any evidence is `refuted`, or none is `supported`/`partial`.
- Honeypots (skeptic quality control): `verify --honeypots N` plants N deterministic trap pairs — one finding's claim glued to another finding's evidence — seeded on the run's `dimensionsHash`. Ground truth lives in `VERIFY.honeypots.json` and MUST NOT be shown to a skeptic. A trap graded `supported`/`partial` fails `verify --apply` and blocks `check --require-verify` until a fresh skeptic re-verifies; trap verdicts never reach the findings ledger.
- `MEETS_BAR = 80`. `meetsExpectations` MUST be `false` when any of: a live P0 defect exists · any judge votes no · weighted overall < 80 · the judge panel has zero passed calibrations (`scorecard.judgesCalibrated`).

## Scoped runs (init --scope)

A run MAY declare a **file scope**: target-relative globs (`init --scope "src/domain/**"`, e.g. a métier/business-domain eval) recorded in `eval.config.json` and in provenance.

- The generated contracts MUST bind agents to the scope: out-of-scope code is context, never a finding.
- `check` MUST fail a finding whose target citations all fall outside the scope. The `tags: ["scope-exempt"]` escape MUST be reserved for a cross-cutting issue that genuinely breaks in-scope behavior, MUST be justified in the finding's statement, and downgrades the failure to a visible warning — never silence.
- Judges MUST score in-scope behavior only.
- Two runs with different scopes are not directly comparable; `compare` MUST surface the mismatch.

## One-shot profile (oneshot)

The `oneshot` command scaffolds a **single-pass** run: `provenance.profile = "oneshot"`, one self-contained `ONESHOT.md` contract, no research fan-out, no verify/honeypots, no judge panel. The full pipeline remains the default; one-shot is opt-in only.

- The structural gate is NOT relaxed: `check --run <RUN>` MUST pass before results are presented.
- `check --require-verify` MUST refuse on a one-shot run (there is no verify phase) and MUST name the upgrade path.
- A one-shot verdict is **indicative**: it MUST NOT be presented as verified or normed; `scorecard.oneshot` and the ledger's `oneshot` field mark it.
- A one-shot vs full-pipeline `compare --gate` MUST fail (different rigor); `plan --run <RUN>` upgrades the run in place (removes `ONESHOT.md`, clears the profile).

## Budget discipline

A budgeted run (the harness set a token target) MAY scale coverage down — fewer judge lenses, grouped research — but it MUST record every coverage cut in `runs/budget.md` and report the cuts in `SUMMARY.md` (`check` warns when the summary omits them). A silent cut reads as full coverage and is a protocol violation.

## Severities (normative definitions)

Tokens stay `P0|P1|P2`. `SEVERITY_DEFS` in `src/types.ts` is the machine-readable copy of this table; the two MUST stay in sync. Band language aligns with CVSS v4.0 qualitative ratings; the membership test is degradation of a scored dimension.

| sev | label | CVSS band | meaning | gate effect |
|---|---|---|---|---|
| P0 | Critical | Critical/High | breaks trust, correctness, safety, or data integrity of the primary deliverable; the documented main path fails | caps meets-expectations at false while unresolved |
| P1 | Major | Medium | materially degrades a scored dimension (fidelity, coverage, robustness); a workaround or secondary path exists | weighs on the dimension score and leads the backlog after P0 |
| P2 | Minor | Low | polish, consistency, or documentation drift; no scored dimension materially degraded | informs the backlog tail; never blocks the verdict |

Opportunities are rated **impact × effort**, not severity; a live opportunity MUST NOT cap meets-expectations.

## Anchoring rules

- Every dimension MUST carry at least one `anchors[]` entry `{ standard, ref, note? }` tracing it to the external referential it operationalizes.
- Codebase dimensions anchor to **ISO/IEC 25010:2023**; skill dimensions to the **ultraeval skill referential v1** (ISO/IEC 25010:2023 subset + ISO/IEC 25059:2023 + skill-specific criteria — defined in `references/rubric-library.md`); category sets per their tables (29148, WCAG 2.2, OWASP Benchmark, RAGAS…).
- The research stage MAY refine an anchor with cited justification; it MUST NOT silently drop the referential.
- `note: "informative"` marks non-normative citations; anchors without it are the operative mapping.

## Provenance & comparability

- `init` MUST record: engine/protocol/rubric versions, ISO-8601 `createdAt`, mode/kind/category, `dimensionsHash`, and `targetGit` (commit + dirty flag, guarded lookup) when the target is a git repo.
- `score` MUST copy the provenance into `scorecard.json` and stamp `scoredAt`.
- Two runs are directly comparable ONLY when their `protocolVersion`, `rubricVersion`, and dimension ids/weights all match; `compare` MUST surface a warning otherwise and MUST print both sides' provenance in `COMPARE.md`.
- A run without provenance is a *legacy run*: `check` emits a warning (never an error).
- Run directories are typically gitignored — `init` does this automatically when the run dir sits inside a git repo (idempotent; `--no-gitignore` opts out) and MUST NOT gitignore the ledger path. The committed history ledger is where the score trend survives. A release self-eval SHOULD append its verdict: `score --run <RUN> --history [file]` (default `evals/history.jsonl` under the working directory).

## Self-evaluation constraint

When the target is itself an evaluator or orchestrator (including ultraeval evaluating itself), the live executor MUST exercise it against a small local fixture *inside the target* (e.g. `tests/fixtures/`), MUST NOT launch the target's own generated multi-agent workflow (no nested fan-out), MUST NOT dispatch subagents itself, and MUST timebox every step (≤ 10 min). A prior self-run hung ~4 hours on exactly this nested fan-out.
