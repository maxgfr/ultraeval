# ultraeval — how it works

A deep companion to the [README](./README.md). ultraeval is a thin, deterministic engine plus a thick
markdown playbook: the engine grounds, gates, scores, and generates; the AI (via the SKILL) researches,
judges, and writes.

## The pipeline

```
init → plan → run(research → test-plan → execute+gates → judge → results) → verify → backlog(TDD) → score → render
```

`plan` emits a ready-to-launch multi-agent Workflow (`eval.workflow.mjs`) plus `agents/*.md` dispatch
contracts, with the absolute engine/target paths baked in. Launch it with a Workflow harness, or run the
stages by hand from the contracts. Either way the same engine commands enforce the guarantees below.

## The grounding gate (the point)

The failure mode of every "AI evaluates X" tool is confident, ungrounded findings. `check` makes that
structurally hard:

1. **Schema** — every finding has a well-formed `id` (unique `F\d+`), a `severity` in `P0|P1|P2`, a
   `status` in `open|confirmed|dismissed`, a title/statement, and an `evidence` array.
2. **Grounding** — every non-dismissed finding resolves to a real location: a `path:line` in the target
   (range-checked against the file) or a `run:relpath#Lnn` log line. A stale or invented line is a hard
   failure — this is the content-level check most eval tools skip.
3. **Report integrity** — `RESULTS.md` may not cite a `[F#]` that does not exist, and (in `--strict`)
   every substantive claim must carry a citation.
4. **Backlog integrity** — every `BACKLOG.json` task references a live finding.

`verify` adds the semantic layer: a skeptic judges whether each cited location actually *supports* the
claim (`supported`/`partial`/`refuted`/`unsupported`); `check --semantic --require-verify` folds those
verdicts in and is the exit gate. Verdicts reduce conservatively — a finding fails if any evidence is
refuted or all of it is unsupported.

## Scoring

`score` reduces `judges.jsonl` (one JSON line per judge: per-dimension 0–5 scores + a meets-expectations
vote) and the config dimensions to a weighted `scorecard.json`. The overall is the weight-normalized mean
of the per-dimension averages, scaled to 0–100. `meetsExpectations` is `false` if any live P0 finding
stands, any judge votes no, or the overall is below the bar (`MEETS_BAR`, default 80). `render` shows the
verdict banner + dimension table.

## Rubrics

`init` seeds dimensions from the target kind and specializes by `--category` (see
`skills/ultraeval/references/rubric-library.md`): security → precision/recall/false-positive-rate; web →
+accessibility/auth; research/RAG → faithfulness/retrieval; requirements → ISO/IEC/IEEE 29148. Weights
need not sum to 1 — `score` normalizes.

## The normed process

The evaluation is standardized end to end (normative text: `skills/ultraeval/references/protocol.md`):

- **Anchored rubrics** — every dimension carries machine-readable `anchors[]` tracing it to the clause of
  an external referential (ISO/IEC 25010:2023 for codebases, the *ultraeval skill referential v1* — an
  ISO 25010/25059 composite — for skills, 29148/WCAG/OWASP/RAGAS per category). The contracts,
  `dimensions.json` and the rendered dashboard all surface them; research may refine an anchor with cited
  justification, never silently drop it.
- **Codified severities** — `SEVERITY_DEFS` (`src/types.ts`) is the single machine-readable source for what
  P0/P1/P2 mean (CVSS-v4-aligned bands, meaning, gate effect); the findings contract,
  `findings.schema.json` and `REMEDIATION.md` all derive from it.
- **Provenance & comparability** — `init` stamps every run with engine/protocol/rubric versions, an
  ISO-8601 timestamp, a dimensions hash and the target git SHA (+ dirty flag); `score` copies it into
  `scorecard.json` with `scoredAt`; `compare` prints both sides' provenance and warns when
  protocol/rubric versions or dimension ids/weights differ — a rubric change must never silently read as
  a quality delta.

## Analysis & opportunities (improve / deep modes)

Beyond defects, ultraeval discovers grounded improvement **opportunities**:

- **`analyze`** (`src/analyze.ts`) is deterministic, zero-dep, offline. It walks the target and emits
  `analysis.json` + `ANALYSIS.md`: size/complexity hotspots, a local import graph with cycles, git churn
  (`git log`, skipped for non-repos), test-to-source ratio + untested files, docs presence, TODO density.
- **`brainstorm`** (`src/brainstorm.ts`) is divergent → convergent. `brainstorm --run` emits a lens-based
  worklist (`BRAINSTORM.todo.md`) anchored on the hotspots; the AI fills `opportunities.json`; `brainstorm
  --rank` dedups, ranks by **value = impact / effort**, and folds them into `findings.json` as
  `kind:"opportunity"`.
- Opportunities are the same `Finding` type with `kind:"opportunity"` + `impact`/`effort`. `check` grounds
  and schema-validates them exactly like defects; they do **not** cap meets-expectations; `backlog` emits a
  spec/characterization-test card; `render` shows an impact × effort matrix and flags quick wins.

`--mode audit|improve|deep` selects which stages `plan` bakes into the generated workflow. The generated
executor contract is hardened against the failure that once hung a self-run for hours: strict Bash
timeboxes and a ban on launching another live/fan-out tool inside the executor.

## Why the bundle is committed

`scripts/ultraeval.mjs` is a single zero-dependency ESM bundle built by tsup from `src/*.ts` and mirrored
byte-for-byte into `skills/ultraeval/scripts/` so `npx skills add` installs a working skill with no
install step. `check:build` rebuilds and asserts the committed bundle matches `src/`; `verify:bundle`
asserts the install-bundle shape (no root SKILL.md, engine + references present).

## Extending

- New engine behavior: TDD in `tests/`, implement in `src/`, `pnpm run build`, keep `pnpm run eval`
  (the RED/GREEN probe) green. See [CONTRIBUTING](./CONTRIBUTING.md).
- New rubric category: add a set in `src/rubrics.ts` and a matcher in `defaultDimensions`, document it in
  `references/rubric-library.md`.

## Exit codes

`0` ok / gate passed · `1` gate failed (`check`/`verify`) · `2` usage or runtime error.
