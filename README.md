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
init → plan → run(research → test-plan → execute+gates → judge → results) → verify(+honeypots) → backlog(TDD) → fix → verify-fix → score(+history) → render
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

`init --category` auto-selects a fitting rubric (security → precision/recall/FP-rate; web → +accessibility/auth; research → faithfulness/retrieval; requirements → 29148). `check` also validates the findings record's schema (id/severity/status/evidence/kind), not just grounding. Exit codes: **0** ok/gate-passed · **1** gate failed · **2** usage/runtime error. Run `node scripts/ultraeval.mjs --help` for the full flag surface. The grounding contract, orchestration, gate rules, and TDD-card format are documented under [`skills/ultraeval/references/`](./skills/ultraeval/references/).

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
