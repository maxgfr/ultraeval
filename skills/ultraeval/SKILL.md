---
name: ultraeval
description: 'Use when the user wants to rigorously EVALUATE a skill or a codebase and get back grounded, AI-actionable fix docs — e.g. "evaluate this skill", "audit/grade/score this repo", "is my skill production-ready", "review this codebase and generate a fix plan", "find what is wrong and give me a TDD backlog". ultraeval researches how to test that kind of target, generates a multi-agent workflow plus subagent contracts, runs it, and grounds every finding in a real file:line — a check/verify gate rejects hallucinated ones — then emits a prioritized backlog and per-fix TDD cards (failing-test-first) a model can implement. Keywords: evaluate, eval, audit, grade, assess, review, score, test a skill, code review, fix plan, remediation, TDD backlog, meets expectations.'
license: MIT
metadata:
  version: 1.1.0
---

# ultraeval: evaluate a skill or codebase → grounded, AI-exploitable fix docs

The markdown is the program. A tiny deterministic engine scaffolds the run, generates the multi-agent workflow, and enforces a grounding gate; **you** (with fanned-out subagents) do the research, judgment, and writing. Every finding must resolve to a real `file:line` in the target — the gate rejects hallucinated ones — and the output is a prioritized backlog plus per-fix **TDD cards** a model can implement red→green→refactor.

## When to use

- "Evaluate / audit / grade / score this skill (or repo)"; "is it production-ready / does it meet expectations?"
- "Review this codebase and give me a fix plan / a TDD backlog."
- Regression-proofing your own skills after changes, or vetting a third-party one before trusting it.

Not for: a quick one-file code review (just read it); running the target's own test suite (do that directly).

## The loop

```
init → plan → run(research → test-plan → execute+gates → judge → results) → verify → backlog(TDD) → score → render
```

Everything is a plain `node <skill-dir>/scripts/ultraeval.mjs <cmd>` call. Fanning out subagents is an optimization the generated workflow encodes — never a requirement.

## Inputs to confirm

- **Target** — a path to the skill/repo to evaluate (or a git URL the user has already cloned locally).
- **Kind** — `skill` or `codebase` (auto-detected: a SKILL.md ⇒ skill). Override with `--kind`.
- **Category** — e.g. "agent skill", "CLI", "library", "web app", "security tool". Steers the starter rubric.

## Procedure

**1. Scaffold the run.**
```
node <skill-dir>/scripts/ultraeval.mjs init --target <PATH> --out <RUN> [--kind skill|codebase] [--category "<c>"]
```
Writes `eval.config.json` with starter dimensions (see `references/rubric-library.md`).

**2. Generate the workflow + subagent contracts.**
```
node <skill-dir>/scripts/ultraeval.mjs plan --run <RUN>
```
Emits `<RUN>/eval.workflow.mjs` (a ready-to-launch multi-agent Workflow, with the absolute engine + target paths baked in), `<RUN>/agents/*.md` (the dispatch contracts), `TEST-PLAN.template.md`, `dimensions.json`, `findings.schema.json`.

**3. Run the eval.** Launch the generated workflow with your harness's Workflow tool:
`Workflow({ scriptPath: "<RUN>/eval.workflow.mjs" })`. It pipelines **Research → TestPlan → Execute → Findings → Gate → Judge → Results** and self-invokes the engine gates. If you have no workflow harness, run the stages by hand: read each `agents/<stage>.md` and dispatch a subagent per the contract. See `references/orchestration.md`. **Every subagent gets the ABSOLUTE `<skill-dir>/scripts/ultraeval.mjs` path** — it has its own cwd and cannot resolve a relative one (`plan` already bakes the absolute path into the workflow).

**4. Ground every finding.** Consolidate results into `<RUN>/findings.json` (schema: `references/gate-contract.md`). Each finding cites `evidence[].ref` as `path:line` in the target or `run:relpath#Lnn` in a produced log. Then:
```
node <skill-dir>/scripts/ultraeval.mjs check --run <RUN>
```
Fix `findings.json` until it exits 0 — **repair or delete ungrounded findings; never weaken the gate.**

**5. Verify (adversarial exit gate).**
```
node <skill-dir>/scripts/ultraeval.mjs verify --run <RUN>          # writes VERIFY.todo.json
# fill each verdict: supported | partial | refuted | unsupported (use skeptic subagents; --shards N --shard i to parallelize)
node <skill-dir>/scripts/ultraeval.mjs verify --run <RUN> --apply <verdicts.json>
node <skill-dir>/scripts/ultraeval.mjs check --run <RUN> --semantic --require-verify   # exit gate — never present before this passes
```
A `refuted` finding must be set `dismissed`. A `supported`/`partial` one survives.

**6. Remediate — the deliverable.**
```
node <skill-dir>/scripts/ultraeval.mjs backlog --run <RUN> --tdd
```
Emits `BACKLOG.json` (a machine-readable, priority-ordered task list a downstream agent can execute), `REMEDIATION.md`, and one `fixes/FIX-*.md` **TDD card** per confirmed finding — each with a RED failing-test-first spec, the GREEN change, and a VERIFY command. See `references/tdd-remediation.md`.

**7. Score + render + present.**
```
node <skill-dir>/scripts/ultraeval.mjs score --run <RUN>           # judges.jsonl + dimensions -> scorecard.json (0-100 + meets-expectations)
node <skill-dir>/scripts/ultraeval.mjs render --run <RUN>          # index.html + index.md dashboard (shows the verdict)
```
`score` reduces the judge panel's `judges.jsonl` and the config dimensions to a weighted verdict; a live P0 finding (or any judge voting no, or a score below the bar) caps meets-expectations at false. Present the verdict, the P0/P1 backlog headline, and the paths (`RESULTS.md`, `BACKLOG.json`, `fixes/`) a fix agent should consume.

Exit codes across the CLI: **0** ok / gate passed · **1** gate failed (`check`/`verify`) · **2** usage or runtime error.

**8. (optional) Drive the fixes.** Hand each `fixes/FIX-*.md` to a build agent to implement TDD — the card is written so it can go red→green→refactor without re-deriving the problem.

## The grounding contract

A finding is only trustworthy if its evidence resolves. `check` opens each `path:line` in the target and confirms the line exists and is in range; a stale/invented line is a hard failure. `verify` then asks a skeptic whether the cited content actually *supports* the claim. This two-layer gate (structural + semantic) is the whole point — full grammar and pass/fail rules in `references/gate-contract.md`.

## Method & rubrics

- `references/eval-playbook.md` — the research→test-plan→execute→judge→results method, and how to build a scored rubric per dimension.
- `references/orchestration.md` — the generated workflow, the subagent dispatch contracts, and the absolute-`<skill-dir>` invariant for fan-out.
- `references/gate-contract.md` — `findings.json` schema, evidence-ref grammar, and exactly what makes `check`/`verify` pass or fail.
- `references/tdd-remediation.md` — the `BACKLOG.json` shape and the `fixes/FIX-*.md` TDD-card format.
- `references/rubric-library.md` — starter dimensions per target category.

## Safety

- ultraeval only **reads** the target and writes under `<RUN>`. It never executes the target's code; the executor subagent may run the target's *own* commands (tests, gates) — sandbox untrusted repos.
- `clean --run <RUN>` removes only derived gate/render artifacts and keeps the deliverables; `--all` removes the whole run.
