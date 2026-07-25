---
name: ultraeval
description: 'Use when the user wants to rigorously EVALUATE a skill or a codebase and get back grounded, AI-actionable fix docs — e.g. "evaluate this skill", "audit/grade/score this repo", "is my skill production-ready", "review this codebase and give me a fix plan", "find what is wrong and give me a TDD backlog", "does this meet expectations". Also when regression-proofing your own skill after changes, vetting a third-party one before trusting it, or gating a PR on a normed score. Keywords: evaluate, eval, audit, grade, assess, review, score, test a skill, code review, fix plan, remediation, TDD backlog, meets expectations, normed evaluation.'
license: MIT
metadata:
  version: 1.16.0
---

# ultraeval: evaluate a skill or codebase → grounded, AI-exploitable fix docs

The markdown is the program. A tiny deterministic engine scaffolds the run, generates the multi-agent workflow, and enforces a grounding gate; **you** (with fanned-out subagents) do the research, judgment, and writing. Every finding must resolve to a real `file:line` in the target — the gate rejects hallucinated ones — and the output is a prioritized backlog plus per-fix **TDD cards** a model can implement red→green→refactor.

New to it? `references/worked-example.md` is a real five-minute run, including a finding the gate rejects. Read that first.

## When to use

- "Evaluate / audit / grade / score this skill (or repo)"; "is it production-ready / does it meet expectations?"
- "Review this codebase and give me a fix plan / a TDD backlog."
- Regression-proofing your own skills after changes, or vetting a third-party one before trusting it.
- Gating a PR on a normed score (`init --since`, then `compare --gate`).

Not for: a quick one-file code review (just read it); running the target's own test suite (do that directly).

### Routing — ultraeval or a sibling?

"Audit this repo" is ambiguous. ultraeval's specific job is a **normed verdict plus a grounded, executable backlog**; when the user wants one specific lens, the specialist is faster and deeper.

| the ask | use |
|---|---|
| "find vulnerabilities", taint analysis, CVEs, secrets | **ultrasec** |
| "audit WCAG / make this accessible", a11y review of a diff | **ultra11y** |
| "how does X work in \<library\>", document an OSS project | **ultradoc** |
| "this repo is too big for context", map it, where is X handled | **ultraindex** |
| review a branch/PR against standards or a spec | **/code-review** |
| **score it, decide if it meets expectations, hand me the fix plan** | **ultraeval** |

Downstream: `BACKLOG.json` is the handoff. Feed it to `fix --workflow` (autonomous fix agents), to a to-issues skill (one issue per task), or execute it directly with a TDD workflow.

## The loop

```
init → plan → run(research → test-plan → execute → findings)
     → gate(check → verify(+honeypots) → check --semantic --require-verify)
     → judge → score(+history) → backlog(TDD) → render → fix → verify-fix
```

That order is the dependency order, and it is the one `status --run <RUN>` walks: the gate must be green before anyone judges, `score` needs `judges.jsonl`, `backlog` needs confirmed findings, `render` shows the verdict, and `fix` consumes the backlog.

Everything is a plain `node <skill-dir>/scripts/ultraeval.mjs <cmd>` call. Fanning out subagents is an optimization the generated workflow encodes — never a requirement.

At any point, `status --run <RUN>` (`--json` for CI) prints the pipeline checklist and the exact next command. Stuck? `references/troubleshooting.md` is symptom → cause → command.

## Quick reference

`check`, `status` and `history` write nothing — safe to re-run anytime. Every other stage is idempotent from its inputs.

| command | key flags | writes | gate |
|---|---|---|---|
| `init` | `--target --out --kind --category --mode --bar --scope --since --no-gitignore` | `eval.config.json` + provenance | — |
| `oneshot` | `--target --out --kind --category --bar --scope --no-gitignore` | `+ ONESHOT.md` (profile `oneshot`) | — |
| `plan` (alias `orchestrate`) | `--run --eco` | `eval.workflow.mjs` **or** `RUNBOOK.md`, `agents/*.md`, `dimensions.json`, `findings.schema.json` | — |
| `analyze` | `--run --since --json` (or `--target --out`) | `analysis.json`, `ANALYSIS.md` | — |
| `brainstorm` | `--run --rank --check` | `BRAINSTORM.todo.md` → folds `opportunities.json` | `--check` exits 1 |
| `check` | `--run --semantic --require-verify --strict --strict-scope --min-findings --coverage-min --json` | nothing | **exit 1** |
| `verify` | `--run --apply --max-verify --shards --shard --honeypots` | `VERIFY.todo[.i].json`, `VERIFY.json` | `--apply` exits 1 |
| `backlog` | `--run --tdd --out` | `BACKLOG.json`, `REMEDIATION.md`, `fixes/FIX-*.md` | — |
| `fix` | `--run --task --workflow` | `fixes/agents/FIX-*.agent.md`, `fix.workflow.mjs` | — |
| `verify-fix` | `--run --task` | stamps `status: done` in `BACKLOG.json` | **exit 1** |
| `score` | `--run --json --history [file]` | `scorecard.json` + ledger line | — |
| `history` | `--run --file <f> [<path>] --json` | nothing | — |
| `compare` | `--run --base --json --gate` | `COMPARE.md` | `--gate` exits 1 |
| `rejudge` | `--run --out` | a fresh-panel copy + `rejudge.workflow.mjs` | — |
| `render` | `--run --out --no-html --no-md --sarif` | `index.html`, `index.md`, `eval.sarif` | — |
| `status` | `--run --json` | nothing | — |
| `clean` | `--run --all` | removes derived artifacts (`--all`: the run) | — |

`--no-html` / `--no-md` narrow the dashboard to one format; `--sarif` emits SARIF 2.1.0 for code scanning. `history --file <f>` (or a bare path) reads a ledger other than the run-anchored default.

## Cost & depth

Size the run to the ask. Log every coverage cut you make — silent truncation reads as "covered everything", and `check` warns when `runs/budget.md` exists but `SUMMARY.md` omits the cuts.

| depth | agents | what runs | when |
|---|---|---|---|
| `oneshot` | 1 | one pass, structural gate only, **no verify/judges** | the user explicitly asked for a quick pre-check |
| `plan --eco` | 0 (sequential) | every stage, played as a self-pass checklist | no workflow harness, or a low-token budget |
| full pipeline | ~9 | the default: research per dimension, 2 executors, 3 judges | the default — never downgrade silently |
| exhaustive | 12+ | full dimension set, 3-skeptic sharded verify, honeypots | "exhaustively audit this" |

Where the budget actually goes, and the levers:

- **Research is the most expensive stage** — one agent per dimension. `references/methodology-library.md` is why it should no longer be a cold web search: the methodology for a category is target-independent, so the contract reads the pack and searches only to close a gap.
- **Verify scales with evidence**, capped at 60 pairs (`--max-verify`). Beyond-cap evidence is never graded *and the gate re-derives with the same cap*, so shard (`--shards N --shard i`) rather than raising it blindly.
- **`rejudge` costs about a tenth of a full run** — it reuses the evidence and only re-runs the panel. That is the cheap way to test verdict stability.
- **Scope instead of skimming**: `--scope "src/domain/**"` or `--since origin/main` shrinks the work honestly; skimming a huge target shrinks only the evidence.
- **Timebox every live step** (≤ 10 min). A hang is worse than a gap: it burns the budget and produces nothing.

## Inputs to confirm

- **Target** — a path to the skill/repo to evaluate (or a git URL the user has already cloned locally).
- **Kind** — `skill` or `codebase` (auto-detected: a SKILL.md ⇒ skill). Override with `--kind`.
- **Category** — e.g. "agent skill", "CLI", "library", "web app", "security tool", "métier". Steers the starter rubric (a business/métier category selects the business-logic dimensions and drops the generic axes).
- **Mode** — `audit` (defects, default) · `improve` (grounded improvement opportunities) · `deep` (both). Set with `--mode`.
- **Scope** (optional) — target-relative globs when only part of the repo is under evaluation (`--scope "src/domain/**"`). A **métier-only eval** combines both: `--category métier --scope "src/domain/**"`. The generated contracts bind agents to the scope and `check` fails findings cited only outside it (tag `scope-exempt` to keep a justified cross-cutting one).
- **Bar** (optional) — `--bar <n>` calibrates the meets-expectations threshold per run (default 80). It is recorded in the config and stamped into the scorecard; read every score against its own bar.
- **Depth** — the full pipeline is the default. Offer the **one-shot** path only when the user explicitly asks for a quick/light single-pass read (see "One-shot path" below); never silently downgrade.

## Modes & improvement discovery

ultraeval finds two things, both grounded and gated:
- **Defects** (`audit`, `deep`) — something is wrong; each cites a real `file:line`.
- **Opportunities** (`improve`, `deep`) — a grounded improvement lead (internal health *and* product/capability), rated **impact × effort**. Discovered by `analyze` (deterministic hotspots/deps/churn/test-gaps) → `brainstorm` (divergent lenses) → `brainstorm --rank` (folds ranked opportunities into `findings.json` as `kind:"opportunity"`). The same gate applies — an opportunity must anchor to real code/metrics, so it never becomes vague "rewrite everything". See `references/analysis-playbook.md`.

The mode selects which stages `plan` bakes into the generated workflow — it **swaps** stages, it does not only add them:

| mode | Execute + Findings | Analyze + Brainstorm | finds |
|---|---|---|---|
| `audit` (default) | yes | no | defects only |
| `improve` | **no** | yes | opportunities only |
| `deep` | yes | yes | both |

So `--mode improve` is not "audit plus extras": it drops the defect-hunting half entirely. Use `deep` when you want both.

## Procedure

**1. Scaffold the run.**
```
node <skill-dir>/scripts/ultraeval.mjs init --target <PATH> --out <RUN> [--kind skill|codebase] [--category "<c>"] [--scope "<glob[,glob]>"] [--bar <n>]
```
Writes `eval.config.json` with starter dimensions (see `references/rubric-library.md`) and the run's **provenance** (engine/protocol/rubric versions, target git SHA + dirty flag, dimensions hash, scope) — the audit trail `score` stamps into the scorecard and `compare` uses to refuse non-comparable deltas. When `<RUN>` sits inside a git repo, `init` **gitignores the run dir there** (idempotent, one conventional `.ultraeval/` line; it never touches `evals/` — the committed score ledger lives at `evals/history.jsonl`); `--no-gitignore` opts out. Métier-only eval example: `init --target . --out .ultraeval/metier --category métier --scope "src/domain/**"`.

**2. Generate the workflow + subagent contracts.**
```
node <skill-dir>/scripts/ultraeval.mjs plan --run <RUN>          # alias: orchestrate (the family verb)
```
Emits `<RUN>/eval.workflow.mjs` (a ready-to-launch multi-agent Workflow, with the absolute engine + target paths baked in), `<RUN>/agents/*.md` (the nine dispatch contracts — all nine, whatever the mode), `TEST-PLAN.template.md`, `dimensions.json`, `findings.schema.json`. **Eco mode** (`plan --run <RUN> --eco` — when the user asks for the low-token path, or no subagents exist): swaps the workflow for `<RUN>/RUNBOOK.md`, the same stages played sequentially against the same contracts — correctness-identical, only wall-clock differs.

**3. Run the eval.** Launch the generated workflow with your harness's Workflow tool:
`Workflow({ scriptPath: "<RUN>/eval.workflow.mjs" })`. It pipelines **Research → TestPlan → Execute → Findings → Gate → Judge → Results** and self-invokes the engine gates. If you have no workflow harness, run the stages by hand: read each contract under `agents/` and dispatch a subagent per its terms (or, eco / no subagents at all: follow `<RUN>/RUNBOOK.md` sequentially). **The stage name is not always the file name** — the Results stage reads `agents/remediator.md`. See `references/orchestration.md`. **Every subagent gets the ABSOLUTE `<skill-dir>/scripts/ultraeval.mjs` path** — it has its own cwd and cannot resolve a relative one (`plan` already bakes the absolute path into the workflow).

**4. Ground every finding.** Consolidate results into `<RUN>/findings.json` (schema: `references/gate-contract.md`; how to decide what is a defensible finding and what severity it carries: `references/finding-quality.md`). Each finding cites `evidence[].ref` as `path:line` in the target or `run:relpath#Lnn` in a produced log — and never *only* the latter, since a log this eval wrote cannot be its own proof. Then:
```
node <skill-dir>/scripts/ultraeval.mjs check --run <RUN>
```
Fix `findings.json` until it exits 0 — **repair or delete ungrounded findings; never weaken the gate.** `check --run <RUN> --json` prints the machine-readable `CheckResult` (`{ ok, errors, warnings }`) verbatim for CI (exit code unchanged).

**5. Verify (adversarial exit gate).**
```
node <skill-dir>/scripts/ultraeval.mjs verify --run <RUN> --honeypots 3   # writes VERIFY.todo.json incl. 3 trap pairs
# fill each verdict: supported | partial | refuted | unsupported (use skeptic subagents; --shards N --shard i to parallelize)
node <skill-dir>/scripts/ultraeval.mjs verify --run <RUN> --apply <verdicts.json>
node <skill-dir>/scripts/ultraeval.mjs verify --run <RUN> --apply verdicts.0.json,verdicts.1.json   # reassemble sharded skeptics (later files win per claim+evidence pair)
node <skill-dir>/scripts/ultraeval.mjs check --run <RUN> --semantic --require-verify   # exit gate — never present before this passes
```
When you shard with `--shards N --shard i`, each skeptic fills its own `VERIFY.todo.<i>.json`; merge the filled shards back with a comma-joined `--apply verdicts.0.json,verdicts.1.json,…` (later files win per claim+evidence pair). Pass both halves — `--shard` alone is a usage error, because a lone shard index would overwrite the full worklist.

`--honeypots n` guards the guard: it plants n trap pairs (one finding's claim glued to another finding's evidence; ground truth in `VERIFY.honeypots.json` — **never paste that file into a skeptic prompt**). A trap graded `supported` **or `partial`** means the skeptic rubber-stamped — half-endorsing a trap is still endorsing it: `--apply` exits 1 and the exit gate stays red until a fresh skeptic re-verifies. Fewer than `n` traps may actually be planted (each needs two gradeable pairs from distinct findings); the reported count is the planted one, and `0 planted` means skeptic-QC did not run.

For real findings the reduction is the opposite way round: a `refuted` finding must be set `dismissed`; a `supported`/`partial` one survives.

**6. Score.**
```
node <skill-dir>/scripts/ultraeval.mjs score --run <RUN> --history # judges.jsonl + dimensions -> scorecard.json + one committed ledger line (evals/history.jsonl, anchored to the target repo's git root)
node <skill-dir>/scripts/ultraeval.mjs history --run <RUN>        # read the score trend back: each run's overall vs bar, verdict, Δ, counts (--json for CI)
```
`score` reduces the judge panel's `judges.jsonl` and the config dimensions to a weighted verdict; a live P0 finding (or any judge voting no, a panel with zero passed calibrations, or a score below the run's bar) caps meets-expectations at false. The scorecard also carries `sensitivity` (does a ±0.05 weight shift flip the verdict?) and `judgesCalibrated`. To measure verdict stability, `rejudge --run <RUN> --out <RUN2>` re-judges the same artifacts with a fresh panel — about a tenth of a full run, since the evidence is reused — and `compare` prints a Stability line at constant target commit.

**7. Remediate + render — the deliverable.**
```
node <skill-dir>/scripts/ultraeval.mjs backlog --run <RUN> --tdd
node <skill-dir>/scripts/ultraeval.mjs render --run <RUN> [--sarif]   # index.html + index.md dashboard (shows the verdict); --sarif also writes eval.sarif for code scanning
```
`backlog` emits `BACKLOG.json` (a machine-readable, priority-ordered task list a downstream agent can execute), `REMEDIATION.md`, and one `fixes/FIX-*.md` **TDD card** per confirmed finding — each with a RED failing-test-first spec, the GREEN change, and a VERIFY command. See `references/tdd-remediation.md`.

Exit codes across the CLI: **0** ok / gate passed · **1** gate failed · **2** usage or runtime error (including a malformed `eval.config.json`/`findings.json` — a *missing* `findings.json` is a plain gate failure). Five paths can exit 1: `check`, `verify --apply`, `compare --gate`, `verify-fix`, and `brainstorm --rank --check`. **`verify` in worklist mode always exits 0** — it generates the worklist, it never gates.

**8. Drive the fixes (the closed loop).**
```
node <skill-dir>/scripts/ultraeval.mjs fix --run <RUN> [--task FIX-XXX] [--workflow]   # one autonomous fix-agent contract per task (fixes/agents/FIX-*.agent.md)
node <skill-dir>/scripts/ultraeval.mjs verify-fix --run <RUN> --task FIX-XXX           # replay the task's verify command; stamps status done + verifiedAt
```
Dispatch each `fixes/agents/FIX-XXX.agent.md` to a build agent (respect `dependsOn`; `--workflow` emits a sequential `fix.workflow.mjs`). The contract embeds the TDD card, absolute paths, the target's invariants and a no-gate-weakening rule. `verify-fix` closes the loop: it re-runs the task's verify command (timeboxed at 10 min, no override) and **gates test-first via `red.expectedNew`** before marking the task `done` in `BACKLOG.json` — a RED test that already existed when the backlog was generated fails, and a backlog predating the field fails closed asking to be regenerated. Full table: `references/tdd-remediation.md`.

**PR gating (diff-scoped runs).** `init --target <repo> --out <RUN> --since origin/main` scopes the eval to the changed set: the executor/findings/brainstormer contracts work only on changed behavior and `check` warns on findings citing unchanged files (`--strict-scope` promotes that warning to a hard failure). Gate the PR with `compare --run <RUN> --base <previous-run> --gate` (exit 1 on score drop or a new P0).

## Handoff — presenting the result

Present in this order; it is also the order a reader should open the artifacts.

1. **The verdict in one line** — `overall/bar`, meets-expectations true/false, and *which veto fired* if false (live P0 · a judge voted no · zero passed calibrations · below bar). Never report a bare number.
2. **The headline** — P0/P1 counts and the single worst finding, in one sentence.
3. **The caveats** — coverage cuts you made, `0 planted` honeypots, unverified dimensions, `judgesIndependent: false`. Say them out loud; a silent cut reads as full coverage.
4. **The paths** — `SUMMARY.md` (headline) → `RESULTS.md` (per-functionality, cites `[F#]`) → `BACKLOG.json` (what to execute) → `fixes/` (the TDD cards) → `index.html` (dashboard).
5. **The next command** — `fix --run <RUN> --workflow` to drive remediation, or `compare --run <RUN> --base <prev> --gate` to gate a PR.

A one-shot verdict is presented as **indicative**, never as verified or normed.

## One-shot path (opt-in quick eval)

When the user explicitly asks for a quick single-pass read (a pre-check, a small target, a tight budget) — never as a silent default:
```
node <skill-dir>/scripts/ultraeval.mjs oneshot --target <PATH> --out <RUN> [--category "<c>"] [--scope "<glob[,glob]>"] [--bar <n>]
```
Scaffolds the run (config stamped `profile: oneshot`) and writes `<RUN>/ONESHOT.md` — ONE self-contained contract: skim the target, evaluate every dimension in one pass, write `findings.json` (same schema, same evidence grammar) + `SUMMARY.md`, then gate with `check --run <RUN>` until exit 0. **The structural gate is not optional**; the verify/honeypot/judge machinery is out of contract (`check --require-verify` refuses with the upgrade path). Present the result as **indicative — never as a verified or normed verdict**. Upgrading to the full pipeline is in-place: `plan --run <RUN>` removes ONESHOT.md and clears the profile.

## Non-negotiables

Everything above is procedure; this is the part that is not negotiable. The value of an ultraeval run is that its verdict can be trusted, and every rule below exists because skipping it produces a run that *looks* identical and means nothing.

**Violating the letter of these is violating the spirit of them.** They are cheap to follow and there is no version of "we were in a hurry" that makes an ungrounded verdict useful.

1. **Never present before `check --semantic --require-verify` exits 0.** A number without the exit gate is a guess with a decimal point.
2. **Never weaken a gate to get past it.** Not `--coverage-min`, not `--min-findings`, not deleting a warning. Repair the finding or delete it.
3. **Never keep a finding you cannot ground.** If you are searching for a line number to justify a sentence you already wrote, delete the sentence.
4. **Never downgrade to `oneshot` silently.** The full pipeline is the default; one-shot is something the user asks for, and its verdict is labelled indicative.
5. **Never show `VERIFY.honeypots.json` to a skeptic.** It is the answer key. A leaked trap makes the whole verify layer decorative.
6. **Never let a rubber-stamped honeypot stand.** A trap graded `supported` or `partial` means that skeptic's verdicts are untrusted — a *fresh* skeptic re-verifies, you do not re-grade with the same one.
7. **Never cut coverage silently.** Fewer dimensions, fewer judges, an unverified finding, a truncated worklist — record each in `runs/budget.md` and repeat it in `SUMMARY.md`.
8. **Never launch the target's own fan-out from inside the executor.** When evaluating an evaluator or orchestrator (including ultraeval itself), exercise it on a small local fixture, timeboxed. A prior self-run hung ~4 h on exactly this nested fan-out.

### Rationalizations — and what is actually true

| the thought | the reality |
|---|---|
| "The user is in a hurry, I'll skip verify." | Then say you skipped it and call the result indicative. An unverified run presented as a verdict is the one failure mode this tool exists to prevent. |
| "The finding is obviously real, the citation is a formality." | Obvious findings are exactly the ones built from memory. The gate costs seconds; being wrong in a fix backlog costs a day. |
| "`--coverage-min 0.3` just reflects that this report is narrative." | Then mark the narrative `[M]`. Lowering the threshold hides uncited claims instead of labelling them. |
| "The skeptic passed the trap, but it graded everything else well." | A skeptic that endorses a trap has demonstrated it does not check. Its other verdicts carry no information. |
| "This target is small, one-shot is basically the same." | One-shot has no verify, no honeypots, no panel. It is a different rigor, which is why the profile is stamped and the gate refuses `--require-verify`. |
| "I ran out of budget, but the dimensions I covered were the important ones." | Possibly true, and still a coverage cut. Record it. The reader cannot see what you did not run. |
| "I'll fix the finding's wording so the evidence supports it." | That produces a technically-true statement nobody can act on. Repair the citation or delete the finding. |
| "Re-running the same skeptic is faster than finding a fresh one." | It is, and it re-uses the judgment that just failed QC. |

### Red flags — stop and re-read this section

- You are about to report a score and `check --semantic --require-verify` has not exited 0.
- You are editing a threshold flag, or `VERIFY.json`, rather than a finding.
- You are looking for a line number that would make a claim you already wrote resolvable.
- You are about to say "the eval covered X" when X was partially skipped.
- You opened `VERIFY.honeypots.json` while preparing a skeptic prompt.
- You are describing a one-shot result with the words "verified", "normed", or "meets expectations".

## The grounding contract

A finding is only trustworthy if its evidence resolves. `check` opens each `path:line` in the target and confirms the line exists and is in range; a stale/invented line is a hard failure. `verify` then asks a skeptic whether the cited content actually *supports* the claim. This two-layer gate (structural + semantic) is the whole point — full grammar and pass/fail rules in `references/gate-contract.md`, and what makes a claim worth grounding in the first place in `references/finding-quality.md`.

## Method & rubrics

- `references/protocol.md` — **the normative protocol** (RFC-2119): phase entry/exit criteria, gate thresholds, codified P0/P1/P2 severities, anchoring rules, provenance & comparability, and the self-evaluation constraint.
- `references/worked-example.md` — a real end-to-end miniature run, including the finding the gate rejects and why.
- `references/methodology-library.md` — **how to evaluate each dimension**: the metric, how to measure it, 0–5 anchors, what fools it. The Research stage reads this before searching.
- `references/finding-quality.md` — the bar for a defensible finding, the severity decision procedure, and the false-positive catalogue.
- `references/eval-playbook.md` — the research→test-plan→execute→judge→results method, and how to build a scored rubric per dimension.
- `references/orchestration.md` — the generated workflow, the subagent dispatch contracts, and the absolute-`<skill-dir>` invariant for fan-out.
- `references/gate-contract.md` — `findings.json` schema, evidence-ref grammar, and exactly what makes `check`/`verify` pass or fail.
- `references/tdd-remediation.md` — the `BACKLOG.json` shape, the `fixes/FIX-*.md` TDD-card format, and the `red.expectedNew` test-first gate.
- `references/rubric-library.md` — starter dimensions per target category, and how a category selects a set.
- `references/live-scenarios.md` — the normed Execute-phase live scenarios per category (golden path, error path, help contract, expected artifact, pass criteria); the executor contract embeds the matching block.
- `references/analysis-playbook.md` — the `analyze` signals, the brainstorm lenses, and how opportunities stay grounded.
- `references/troubleshooting.md` — symptom → cause → command, for when a run stalls or a gate goes red.

## Safety

- ultraeval only **reads** the target and writes under `<RUN>` — plus, by default, one idempotent line in the `.gitignore` of the repo containing `<RUN>` (`--no-gitignore` opts out; `evals/` is never ignored). It never executes the target's code; the executor subagent may run the target's *own* commands (tests, gates) — sandbox untrusted repos.
- `clean --run <RUN>` removes only derived gate/render artifacts and keeps the deliverables; `--all` removes the whole run. It refuses to touch a directory with no `eval.config.json`, so it can never be pointed at a source tree by accident.
