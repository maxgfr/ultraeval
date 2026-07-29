# ultraeval

[![CI](https://github.com/maxgfr/ultraeval/actions/workflows/ci.yml/badge.svg)](https://github.com/maxgfr/ultraeval/actions/workflows/ci.yml)

> Evaluate a **skill or codebase** with a multi-agent workflow, ground every finding in a real `file:line`, and get back **AI-exploitable fix docs** — a prioritized backlog plus per-fix **TDD cards** a model can implement red→green→refactor.

ultraeval is an [Agent Skill](https://www.skills.sh/) (the open agent-skills ecosystem). A tiny zero-dependency engine scaffolds the run, **generates the workflow + subagent contracts**, and enforces a grounding gate; the AI does the research, judgment, and writing. It is the method productized: the same one used to audit a whole family of skills, packaged so you can replay it on any target.

## Install

```bash
npx skills add maxgfr/ultraeval        # into the current project (committed, team-shared)
npx skills add -g maxgfr/ultraeval     # globally
```

No `npm install`, no API keys — the engine is a single committed `.mjs` bundle.

## What it does

```
init → plan → run(research → test-plan → execute → findings)
     → gate(check → verify(+honeypots) → check --semantic --require-verify)
     → judge → score(+history) → backlog(TDD) → render → fix → verify-fix
```

- **`plan`** generates `eval.workflow.mjs` — a ready-to-launch multi-agent Workflow parameterized to your target — plus `agents/*.md` dispatch contracts. This is the "generate the workflow and subagents" part.
- Every finding must resolve to a real `file:line` in the target (or a produced run-log line). **`check` rejects a hallucinated or stale citation**; **`verify`** adversarially confirms the cited content actually supports the claim.
- **`backlog --tdd`** turns confirmed findings into `BACKLOG.json` (machine-readable, priority-ordered) and one `fixes/FIX-*.md` **TDD card** per finding (RED failing-test-first → GREEN change → VERIFY).
- **The process is normed.** Every rubric dimension anchors to an external referential (ISO/IEC 25010:2023 for code, an ISO 25010/25059 composite for skills, 29148/WCAG/OWASP per category), P0/P1/P2 severities are codified (CVSS-aligned bands), and every run records **provenance** (engine/protocol/rubric versions, target git SHA) under a versioned protocol — `compare` refuses to read a delta across incompatible runs. Normative text: [`references/protocol.md`](./skills/ultraeval/references/protocol.md).

## What it produces

```
<run>/
  eval.config.json         # target, kind, category, scored dimensions
  eval.workflow.mjs        # the generated multi-agent Workflow
  agents/*.md              # subagent dispatch contracts
  research/<dim>.md        # cited methodology per dimension
  TEST-PLAN.md             # every functionality + gate to test
  runs/core.md, live.md    # deterministic + live evidence (cited by findings)
  findings.json            # grounded findings (the gate enforces file:line resolution)
  VERIFY.todo.json/.json   # adversarial claim↔evidence verdicts
  RESULTS.md / SUMMARY.md  # scored report (claims cite [F#])
  BACKLOG.json             # priority-ordered fix tasks
  fixes/FIX-*.md           # per-fix TDD cards
  REMEDIATION.md           # the human-readable plan
  index.html / index.md    # dashboard
```

## Standalone CLI (the engine)

```bash
ENGINE=node scripts/ultraeval.mjs
$ENGINE init --target ../my-skill --out /tmp/eval --category "agent skill" --mode deep   # add --since origin/main for a diff-scoped PR-gating run
$ENGINE init --target ../my-app --out ../my-app/.ultraeval/metier --category métier --scope "src/domain/**"   # business-only eval: métier rubric + file scope (check fails out-of-scope findings)
$ENGINE oneshot --target ../my-app --out /tmp/quick [--category ...] [--scope ...]   # single-pass quick eval: ONESHOT.md contract, structural gate kept, indicative verdict; plan --run upgrades it
$ENGINE status --run /tmp/eval                      # pipeline checklist + the exact next command
$ENGINE plan --run /tmp/eval                       # generate the workflow + agents (Analyze+Brainstorm stages in improve/deep)
$ENGINE analyze --run /tmp/eval [--since <ref>] [--json]   # deterministic hotspots/deps/churn/test-gaps -> analysis.json
$ENGINE brainstorm --run /tmp/eval                  # divergent lenses -> BRAINSTORM.todo.md
$ENGINE brainstorm --run /tmp/eval --rank [--check] # fold ranked, grounded opportunities into findings.json (and gate them)
$ENGINE compare --run /tmp/eval-new --base /tmp/eval-old   # diff two runs -> COMPARE.md (score Δ, resolved, introduced)
$ENGINE check --run /tmp/eval                       # grounding gate (exit 1 on a hallucinated citation); add --json for the CheckResult in CI
$ENGINE verify --run /tmp/eval --honeypots 3        # adversarial worklist + planted traps that catch a rubber-stamping skeptic
$ENGINE verify --run /tmp/eval --apply verdicts.json
$ENGINE check --run /tmp/eval --semantic --require-verify   # exit gate (also fails while a honeypot failure is unresolved)
$ENGINE backlog --run /tmp/eval --tdd               # BACKLOG.json + fixes/FIX-*.md (dependsOn derived from shared files)
$ENGINE fix --run /tmp/eval --workflow              # one autonomous fix-agent contract per task + fix.workflow.mjs
$ENGINE verify-fix --run /tmp/eval --task FIX-001   # replay the task's verify command; stamp status done + verifiedAt
$ENGINE score --run /tmp/eval --history             # scorecard.json (verdict + weight-sensitivity + judgesCalibrated) + ledger line
$ENGINE history --run /tmp/eval                     # read the score trend back (overall vs bar, Δ, counts); --json for CI
$ENGINE rejudge --run /tmp/eval --out /tmp/eval-rj  # fresh judge panel over the same artifacts (test-retest stability)
$ENGINE render --run /tmp/eval                      # index.html + index.md (shows the verdict)
$ENGINE clean --run /tmp/eval                       # remove derived artifacts (keeps deliverables)
```

**Modes.** `--mode audit` (defects, default) · `improve` (grounded improvement **opportunities** — internal health *and* product/capability, rated impact × effort) · `deep` (both). Opportunities are discovered by `analyze` → `brainstorm` and held to the *same* grounding gate, so a lead always anchors to real code or a real metric — never vague "rewrite everything". `render` shows an impact × effort matrix and flags quick wins.

`init --category` auto-selects a fitting rubric (security → precision/recall/FP-rate; métier/business/domain → business-logic dimensions only; web → +accessibility/auth; research → faithfulness/retrieval; requirements → 29148). `init --scope "<glob[,glob]>"` file-scopes the eval: agents are bound to the globs and `check` fails a finding cited only outside them (tag `scope-exempt` to keep a justified cross-cutting one). `check` also validates the findings record's schema (id/severity/status/evidence/kind), not just grounding. `init --bar <n>` calibrates the meets-expectations threshold per run (default 80); it is stamped into the scorecard and the ledger, and `compare` warns when two runs were scored against different bars. Exit codes: **0** ok/gate-passed · **1** gate failed · **2** usage/runtime error. Run `node scripts/ultraeval.mjs --help` for the full flag surface.

## The reference pack

The skill is markdown first — [`skills/ultraeval/references/`](./skills/ultraeval/references/) is the substance, and `tests/docs-drift.test.ts` keeps it honest by comparing every rubric set, live-scenario block, severity row and CLI flag against the engine's own values.

| reference | what it is for |
|---|---|
| [`protocol.md`](./skills/ultraeval/references/protocol.md) | the normative process (RFC-2119): phase entry/exit, gate thresholds, severities, provenance |
| [`worked-example.md`](./skills/ultraeval/references/worked-example.md) | a real, reproducible end-to-end run — including the finding the gate rejects |
| [`methodology-library.md`](./skills/ultraeval/references/methodology-library.md) | how to evaluate each dimension: metric, measurement, 0–5 anchors, what fools it — so Research refines instead of re-searching |
| [`finding-quality.md`](./skills/ultraeval/references/finding-quality.md) | the bar for a defensible finding, the severity decision procedure, the false-positive catalogue |
| [`gate-contract.md`](./skills/ultraeval/references/gate-contract.md) | `findings.json` schema, evidence grammar, exactly what `check`/`verify` fail and warn on |
| [`tdd-remediation.md`](./skills/ultraeval/references/tdd-remediation.md) | `BACKLOG.json`, the TDD cards, and the `red.expectedNew` test-first gate |
| [`rubric-library.md`](./skills/ultraeval/references/rubric-library.md) · [`live-scenarios.md`](./skills/ultraeval/references/live-scenarios.md) | starter dimensions and normed live scenarios, per category |
| [`orchestration.md`](./skills/ultraeval/references/orchestration.md) · [`eval-playbook.md`](./skills/ultraeval/references/eval-playbook.md) · [`analysis-playbook.md`](./skills/ultraeval/references/analysis-playbook.md) | the workflow, the method, and how opportunities stay grounded |
| [`troubleshooting.md`](./skills/ultraeval/references/troubleshooting.md) | symptom → cause → command when a run stalls or a gate goes red |

**Auto-gitignore.** When the run dir (`--out`) sits inside a git repo, `init`/`oneshot` idempotently add it to that repo's `.gitignore` (the conventional `.ultraeval/` container gets one line covering all runs). `--no-gitignore` opts out; `evals/history.jsonl` — the committed score ledger — is never ignored.

**One-shot evals.** `oneshot` scaffolds a single-pass run (`ONESHOT.md`: one agent, all dimensions in one pass, findings in the same gated schema). The structural `check` gate still applies; verify/judges are out of contract, so the verdict is indicative — the full pipeline stays the default, and `plan --run <run>` upgrades a oneshot run in place.

## Use it as an MCP server

The skill shells out to the CLI and parses its output. An MCP server skips both:
your agent calls ultraeval as typed tools, with JSON schemas in and structured
results out. Same engine, same run directory, no wrapper.

```bash
# stdio — the default, and what Claude Code / Claude Desktop / Cursor expect
claude mcp add ultraeval -- node /abs/path/to/scripts/ultraeval.mjs mcp

# or over HTTP, on loopback
node scripts/ultraeval.mjs mcp --transport http --port 7344
claude mcp add --transport http ultraeval http://127.0.0.1:7344/mcp
```

```jsonc
// Claude Desktop takes stdio servers only — a remote URL here will not work.
{ "mcpServers": { "ultraeval": { "command": "node", "args": ["/abs/path/to/scripts/ultraeval.mjs", "mcp"] } } }
// Cursor, HTTP:
{ "mcpServers": { "ultraeval": { "url": "http://127.0.0.1:7344/mcp" } } }
```

It serves all three MCP primitives, because a skill is three things: the engine
(**tools**), the method (**prompts**), and the documentation the method refers
to (**resources**). Here that matters directly: `score` is a pure reduction of
the judgements *recorded in the run*, so a client given only the tools produces
an empty scorecard and reports it as a grade.

### Tools

| Tool | What it does |
|------|--------------|
| `ultraeval_status` | Where the run got to, and the exact next command |
| `ultraeval_analyze` | Hotspots, churn, test and doc gaps — where to LOOK, not what to conclude |
| `ultraeval_check` | The anti-hallucination gate: every finding must resolve to a real file:line |
| `ultraeval_verify` | Adversarial worklist, shardable, with **honeypots** that catch rubber-stamping |
| `ultraeval_backlog` | Verified findings → TDD fix cards |
| `ultraeval_score` | Reduce the recorded judgements into a scorecard |
| `ultraeval_compare` | Diff two runs; a score drop or a new P0 is a regression |
| `ultraeval_history` | The score trend over time |
| `ultraeval_read` | A file, or a line range, from the run or the target |

`--allow-write` additionally exposes `ultraeval_init`, `ultraeval_render`,
`ultraeval_clean` (destructive) and `ultraeval_verify_fix`. That last one is the
only tool in the family that **executes the target's own commands** — it is
annotated open-world and non-idempotent for exactly that reason, so point it
only at a target you trust.

Pass `--run <run>` at startup to dedicate the server to one evaluation — `run`
then becomes optional on every tool except `ultraeval_clean`, which never
inherits a target it was not given.

### Prompts — the workflow, not just the tools

| Prompt | Arguments | What it drives |
|--------|-----------|----------------|
| `evaluate_skill` | `run` | analyze → research per dimension → check → verify with honeypots → score → backlog |
| `write_findings` | `run`, `dimension?` | Test the behaviour, not the documentation; report what you could not determine |
| `judge_dimension` | `run`, `dimension?` | Grade on evidence — and treat agreeing with everything as the signal it is |

### Resources — the skill's own documentation

`SKILL.md` and the `references/*.md` are served under `skill://`, read off disk
at request time — so a documentation fix reaches every client without a rebuild.

Two things worth knowing:

- **Calls on one run are serialized.** `verify --apply`, `backlog`, `score` and
  `verify-fix` are all read-merge-write over the same findings, and sharding
  skeptics across a worklist is exactly the parallel pattern this server invites.
- **The HTTP transport binds `127.0.0.1` and refuses anything else** unless you
  pass `--allow-remote`. This server reads local files and can run a target's
  test command; an exposed port is a run-anything primitive for whoever finds it.

## Why the gate matters

The failure mode of every "AI evaluates X" tool is confident, ungrounded findings. ultraeval makes that structurally hard: `check` opens each cited `file:line` in the target and fails if it does not exist or is out of range; `verify` then asks a skeptic whether the content actually supports the claim, and `check --semantic --require-verify` is the exit gate. A fix backlog you cannot trace back to real code is worse than none.

## Development

```bash
pnpm install
pnpm run build        # tsup -> scripts/ultraeval.mjs, mirrored into skills/ultraeval/scripts/
pnpm test             # vitest
pnpm run eval         # RED/GREEN gate probe against the shipped bundle
pnpm run check:build  # bundle is reproducible + install-bundle shape is valid
```

The engine source is `src/*.ts`; the shipped bundle is committed so the skill installs with zero dependencies. Keep the two engine copies byte-identical (`check:build` enforces it).

## Security

ultraeval only **reads** the evaluated target and writes under the run dir; it never executes the target's code. The `executor` subagent may run the target's *own* commands (its tests/gates) — sandbox untrusted repos.

## License

MIT © maxgfr
