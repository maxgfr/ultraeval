import type { EvalConfig } from "./types.js";

// ---------------------------------------------------------------------------
// The generator. `plan` calls these to emit, into an eval run dir:
//   - eval.workflow.mjs   a ready-to-launch multi-agent Workflow script
//   - agents/*.md         the subagent dispatch contracts it references
//   - TEST-PLAN.template.md, dimensions.json, findings.schema.json
// The workflow is built by string concatenation with the run's constants
// injected as JSON literals — so it needs no interpolation-escaping and runs
// as-is under the Workflow tool.
// ---------------------------------------------------------------------------

export function workflowScript(cfg: EvalConfig, runDirAbs: string, engineAbs: string): string {
  const meta = {
    name: `ultraeval-${cfg.kind}`,
    description: `Evaluate ${cfg.targetAbs} across ${cfg.dimensions.length} dimensions, ground every finding, then emit a TDD fix backlog`,
  };
  return [
    `export const meta = { name: ${JSON.stringify(meta.name)}, description: ${JSON.stringify(meta.description)}, phases: [{ title: 'Research' }, { title: 'TestPlan' }, { title: 'Execute' }, { title: 'Findings' }, { title: 'Gate' }, { title: 'Judge' }, { title: 'Results' }] }`,
    ``,
    `// Constants for THIS eval run (injected by \`ultraeval plan\`).`,
    `const TARGET = ${JSON.stringify(cfg.targetAbs)}`,
    `const ENGINE = ${JSON.stringify(engineAbs)}`,
    `const RUN = ${JSON.stringify(runDirAbs)}`,
    `const AGENTS = RUN + '/agents'`,
    `const CATEGORY = ${JSON.stringify(cfg.category)}`,
    `const KIND = ${JSON.stringify(cfg.kind)}`,
    `const DIMENSIONS = ${JSON.stringify(cfg.dimensions)}`,
    ``,
    `// Each subagent is handed the absolute path to its dispatch contract plus the`,
    `// run constants — a subagent has its own cwd and sees none of this file.`,
    `function contract(name, extra) {`,
    `  return 'Read and follow the dispatch contract at ' + AGENTS + '/' + name + '.md VERBATIM.\\n'`,
    `    + 'Constants: TARGET=' + TARGET + '  ENGINE=' + ENGINE + '  RUN=' + RUN + '  KIND=' + KIND + '  CATEGORY=' + CATEGORY + '.\\n'`,
    `    + 'Invoke the engine only by its ABSOLUTE path: node ' + ENGINE + ' <cmd>. Write every artifact under RUN. Do not stop early.'`,
    `    + (extra ? '\\n' + extra : '')`,
    `}`,
    ``,
    `log('ultraeval: research -> test-plan -> execute+gates -> judge -> findings -> backlog for ' + TARGET)`,
    ``,
    `phase('Research')`,
    `await parallel(DIMENSIONS.map((d) => () => agent(contract('researcher', 'DIMENSION=' + d.id + ' (' + d.name + '). Write ' + RUN + '/research/' + d.id + '.md (cited).'), { label: 'research:' + d.id, phase: 'Research', agentType: 'general-purpose' })))`,
    ``,
    `phase('TestPlan')`,
    `await agent(contract('testplan'), { label: 'testplan', phase: 'TestPlan', agentType: 'general-purpose' })`,
    ``,
    `phase('Execute')`,
    `await parallel([`,
    `  () => agent(contract('executor', 'MODE=core — deterministic engine + gate exercises on genuine AND doctored artifacts.'), { label: 'run-core', phase: 'Execute', agentType: 'general-purpose' }),`,
    `  () => agent(contract('executor', 'MODE=live — realistic end-to-end run of the target.'), { label: 'run-live', phase: 'Execute', agentType: 'general-purpose' }),`,
    `])`,
    ``,
    `phase('Findings')`,
    `await agent(contract('findings'), { label: 'findings', phase: 'Findings', agentType: 'general-purpose' })`,
    ``,
    `phase('Gate')`,
    `await agent(contract('gate'), { label: 'gate', phase: 'Gate', agentType: 'general-purpose' })`,
    ``,
    `phase('Judge')`,
    `const LENSES = ['correctness+grounding', 'completeness+coverage', 'ux+meets-expectations']`,
    `await parallel(LENSES.map((lens, i) => () => agent(contract('judge', 'LENS=' + lens), { label: 'judge' + (i + 1), phase: 'Judge', agentType: 'general-purpose' })))`,
    ``,
    `phase('Results')`,
    `await agent(contract('remediator'), { label: 'results', phase: 'Results', agentType: 'general-purpose' })`,
    ``,
    `return { target: TARGET, run: RUN }`,
    ``,
  ].join("\n");
}

const GATE_CHEATSHEET = (engineAbs: string, run: string) =>
  [
    `- \`node ${engineAbs} check --run ${run}\` — structural grounding gate (every finding must resolve to a real file:line in the target, or a run: artifact). Exit 0 = grounded.`,
    `- \`node ${engineAbs} verify --run ${run}\` — writes VERIFY.todo.json (claim↔evidence). Fill each verdict honestly: \`supported\`/\`partial\`/\`refuted\`/\`unsupported\`.`,
    `- \`node ${engineAbs} verify --run ${run} --apply <verdicts.json>\` — reduces to VERIFY.json.`,
    `- \`node ${engineAbs} check --run ${run} --semantic --require-verify\` — folds verdicts in; the exit gate.`,
  ].join("\n");

export function agentContracts(cfg: EvalConfig, runDirAbs: string, engineAbs: string): Record<string, string> {
  const dims = cfg.dimensions.map((d) => `- **${d.id}** ${d.name} (w=${d.weight}): ${d.whatPerfectLooksLike}`).join("\n");
  return {
    researcher: `# Contract: researcher

You research the *state of the art for how to evaluate* one DIMENSION of a ${cfg.kind} (category: ${cfg.category}).

Do REAL web research (WebSearch + WebFetch; if not loaded, ToolSearch \`select:WebSearch,WebFetch\`). Find authoritative methodology — metrics, benchmarks, rubrics, known failure modes — specific to this dimension and category.

Deliver:
1. Write a cited markdown note at \`${runDirAbs}/research/<DIMENSION>.md\` — every non-obvious methodological claim cites a fetched URL.
2. End the note with a **scoring rubric** for this dimension: 0–5 anchors and how to measure each on THIS target.

Dimensions in scope:
${dims}
`,
    testplan: `# Contract: testplan

Read \`${cfg.targetAbs}\` (its SKILL.md/README/CLI \`--help\`, or its source) and the research notes under \`${runDirAbs}/research/\`.

Enumerate EVERY functionality worth testing — modes, subcommands, flags, gates, and the live end-to-end behavior — mapped to the dimensions. For each: id, what it is, the concrete command or user prompt that tests it, and explicit pass criteria.

Write \`${runDirAbs}/TEST-PLAN.md\` (a reviewable checklist with the rubric embedded). Be exhaustive about the CLI/behavior surface.
`,
    executor: `# Contract: executor

You produce the raw evidence an eval stands on. Two MODES; do the one named in your prompt.

**MODE=core (deterministic).** Drive the target's own engine/tests and, if the target ships anti-hallucination gates, prove them in BOTH directions: pass on a genuine artifact, fail on a hand-doctored one. Record every command + exit code into \`${runDirAbs}/runs/core.md\`. If the target has a test suite, run it and record the result.

**MODE=live (realistic).** Act as a real user of the target. Follow its own instructions faithfully and produce a real deliverable into \`${runDirAbs}/runs/live-*\`. Use live network/Docker where the target needs it; timebox heavy steps (Bash timeout up to 600000 ms) and degrade gracefully. Write a narrative to \`${runDirAbs}/runs/live.md\` covering what was produced, grounding quality, any hallucination, and each gate's outcome.

Record exact command lines and exit codes verbatim — later stages cite \`run:runs/core.md#Lnn\` as evidence, so line numbers matter.
`,
    findings: `# Contract: findings

Consolidate the test-plan results and the run logs into \`${runDirAbs}/findings.json\` following \`${runDirAbs}/findings.schema.json\`.

RULES (the grounding gate will enforce these):
- Every finding MUST carry at least one resolvable \`evidence.ref\`:
  - \`path:line\` or \`path:start-end\` — a real location IN THE TARGET (\`${cfg.targetAbs}\`).
  - \`run:relpath#Lnn\` — a line in a log this run produced.
- Do NOT invent line numbers. If you cite \`src/x.ts:42\`, line 42 must exist and support the claim.
- \`severity\`: P0 (trust/correctness/data-loss), P1 (fidelity/coverage cap), P2 (polish).
- \`status\`: \`confirmed\` (evidence holds) or \`open\` (needs verification). Never keep a finding you cannot ground — delete it.

Also draft \`${runDirAbs}/RESULTS.md\` (per-functionality results, every claim citing \`[F#]\`) and \`${runDirAbs}/SUMMARY.md\` (scorecard + headline). Flag any narrative sentence that is not a finding with \`[M]\`.
`,
    gate: `# Contract: gate

Run the target's grounding gate over the eval artifacts and iterate until green:

${GATE_CHEATSHEET(engineAbs, runDirAbs)}

If \`check\` fails, FIX \`findings.json\` (remove/repair ungrounded findings — do not weaken the gate) and re-run. If a finding is \`refuted\` by verification, set its status to \`dismissed\`. Report the final exit codes of \`check --run ${runDirAbs} --semantic --require-verify\` — it MUST be 0 before results.
`,
    judge: `# Contract: judge

You are an INDEPENDENT judge. You did not run the eval. Judge through the LENS named in your prompt.

Read \`${runDirAbs}/\`: research/, TEST-PLAN.md, runs/core.md, runs/live.md, findings.json, and spot-check the artifacts. Score each dimension 0–5 with a one-line rationale grounded in a path you actually read. Objective gate results (VERIFY.json, check exit codes) are ground truth — weight them.

Append your verdict to \`${runDirAbs}/judges.jsonl\` as one JSON line: \`{ "lens": "...", "dimensionScores": [{"id","score","rationale"}], "overall": 0-100, "meetsExpectations": bool, "topFindings": [] }\`.
`,
    remediator: `# Contract: remediator

Finalize the eval and generate the AI-exploitable fix docs.

1. Ensure \`${runDirAbs}/RESULTS.md\` and \`SUMMARY.md\` are complete and cite \`[F#]\`; fold in the judges' scores from \`judges.jsonl\` (average the overalls).
2. Emit the TDD backlog: \`node ${engineAbs} backlog --run ${runDirAbs} --tdd\` → writes \`BACKLOG.json\`, \`REMEDIATION.md\`, and one \`fixes/FIX-*.md\` card per confirmed finding (RED failing-test-first → GREEN change → VERIFY).
3. Render the dashboard: \`node ${engineAbs} render --run ${runDirAbs}\` → \`index.md\` + \`index.html\`.
4. Re-run \`node ${engineAbs} check --run ${runDirAbs} --semantic\` and confirm exit 0 (backlog integrity is part of the gate).

Report the scorecard, the P0/P1 backlog headline, and the paths a downstream fix agent should consume.
`,
  };
}

export function testPlanTemplate(cfg: EvalConfig): string {
  const dims = cfg.dimensions.map((d) => `### ${d.name} (weight ${d.weight})\n> Perfect: ${d.whatPerfectLooksLike}\n\n- [ ] …\n`).join("\n");
  return `# Test plan — ${cfg.target}

Target: \`${cfg.targetAbs}\` · kind: ${cfg.kind} · category: ${cfg.category}

## Rubric & dimensions

${dims}

## Functionalities to test

| id | functionality | how tested (command / prompt) | pass criteria |
|----|---------------|-------------------------------|---------------|
| T1 | … | … | … |

## Gate exercises (anti-hallucination, both directions)

- [ ] genuine artifact → gate PASS
- [ ] doctored artifact → gate FAIL
`;
}

export function findingsSchema(): unknown {
  return {
    $schema: "informal",
    type: "object",
    required: ["findings"],
    properties: {
      findings: {
        type: "array",
        items: {
          type: "object",
          required: ["id", "severity", "title", "statement", "evidence", "status"],
          properties: {
            id: { type: "string", pattern: "^F\\d+$" },
            dimension: { type: "string" },
            severity: { enum: ["P0", "P1", "P2"] },
            title: { type: "string" },
            statement: { type: "string" },
            evidence: {
              type: "array",
              minItems: 1,
              items: {
                type: "object",
                required: ["ref"],
                properties: { ref: { type: "string", description: "path:line | path:start-end | run:relpath#Lnn | url:..." }, note: { type: "string" } },
              },
            },
            failureScenario: { type: "string" },
            recommendation: { type: "string" },
            status: { enum: ["open", "confirmed", "dismissed"] },
          },
        },
      },
    },
  };
}
