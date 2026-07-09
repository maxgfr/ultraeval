import { dirname, join } from "node:path";
import type { Dimension, EvalConfig } from "./types.js";
import { SEVERITY_DEFS, VALID_SEVERITIES } from "./types.js";
import { exists } from "./util.js";

// The golden judge-calibration fixture ships with the skill (references/), next
// to the engine bundle; fall back to the repo-dev layout when planning from a
// checkout's scripts/ bundle.
function calibrationFixturePath(engineAbs: string): string {
  const candidates = [
    join(dirname(engineAbs), "..", "references", "calibration-run.json"),
    join(dirname(engineAbs), "..", "skills", "ultraeval", "references", "calibration-run.json"),
  ];
  return candidates.find(exists) ?? (candidates[0] as string);
}

// One-line rendering of a dimension's standards anchors (for contracts/templates).
const anchorText = (d: Dimension): string => (d.anchors?.length ? d.anchors.map((a) => `${a.standard} — ${a.ref}`).join("; ") : "");

// Severity legend derived from the codified SEVERITY_DEFS (single source of truth).
const severityLegend = (): string => VALID_SEVERITIES.map((s) => `${s} (${SEVERITY_DEFS[s].label}: ${SEVERITY_DEFS[s].meaning})`).join(" · ");

// Normed Execute-phase live scenarios, one block per category — the compact
// twin of references/live-scenarios.md, matched like defaultDimensions().
interface LiveScenario {
  golden: string;
  error: string;
  help: string;
  artifact: string;
  pass: string;
}
const LIVE_SCENARIOS: Record<string, LiveScenario> = {
  "agent skill": {
    golden: "follow SKILL.md's quickstart end-to-end on a small local fixture and produce the skill's primary deliverable",
    error: "invoke a documented command with a missing/invalid required flag — expect an actionable message, no raw stack trace, non-zero exit",
    help: "every command SKILL.md documents exists; --help (or equivalent) matches the docs",
    artifact: "the deliverable under runs/live-* plus the runs/live.md narrative",
    pass: "deliverable complete and usable; the skill's own gates pass; no hallucinated paths/claims",
  },
  cli: {
    golden: "run the README's first documented command sequence against a tmp fixture",
    error: "an unknown subcommand AND a missing required argument — both exit non-zero with an actionable stderr message",
    help: "--help exits 0 and lists every documented command; exit codes match the documented contract",
    artifact: "verbatim command lines + exit codes + trimmed outputs in runs/live.md",
    pass: "outputs and exit codes match the docs; errors name the fix",
  },
  library: {
    golden: "import the package and run the README quickstart snippet as-is",
    error: "call a public API with invalid input — expect the documented (typed) error, not a deep crash",
    help: "the exported API surface matches the docs/types; the quickstart runs unmodified",
    artifact: "the runnable snippet + its output log under runs/live-*",
    pass: "snippet runs as documented; the error path fails the documented way",
  },
  "web app": {
    golden: "boot the app locally and drive the primary user journey (create + read the core entity)",
    error: "submit an invalid form and hit a non-existent route — validation feedback and a proper 404, never a 5xx",
    help: "the README's run instructions work verbatim (install → start → URL)",
    artifact: "HTTP transcripts or screenshots + runs/live.md narrative",
    pass: "journey completes; no 5xx; basic a11y smoke on the main page",
  },
  security: {
    golden: "scan a small labelled vulnerable fixture — the known true positives are reported",
    error: "scan the sanitized variant — NO findings (false-positive check); an invalid target errors actionably",
    help: "--help documents the scan modes used; exit codes distinguish clean/findings/error",
    artifact: "both scan reports (vulnerable + safe) under runs/live-*",
    pass: "labelled TPs found, safe variant clean, exit codes per contract",
  },
  requirements: {
    golden: "render/validate the spec suite; the traceability check passes on the genuine document",
    error: "remove a required section from a COPY — the validator fails naming the missing section",
    help: "documented validate/render commands exist and match the docs",
    artifact: "the validation report for both directions under runs/live-*",
    pass: "gate proven in both directions (genuine passes, doctored fails)",
  },
  research: {
    golden: "ask a question answerable from a small local corpus — the answer cites the fetched sources",
    error: "ask an unanswerable question — explicit abstention, zero fabricated citations",
    help: "the documented modes/flags exist; citation format matches the docs",
    artifact: "the cited report under runs/live-*",
    pass: "every claim attributable to a fetched source; the unanswerable question is refused",
  },
};

// Category → scenario key, mirroring defaultDimensions()'s matching.
function liveScenarioFor(cfg: EvalConfig): LiveScenario {
  const cat = (cfg.category ?? "").toLowerCase();
  if (/secur|sast|vuln|taint|pentest|appsec/.test(cat)) return LIVE_SCENARIOS.security as LiveScenario;
  if (/requirement|\bprd\b|\bsrd\b|\bspec\b|specification/.test(cat)) return LIVE_SCENARIOS.requirements as LiveScenario;
  if (/research|\brag\b|retrieval|search|documentation|\bq&a\b|\bqa\b/.test(cat)) return LIVE_SCENARIOS.research as LiveScenario;
  if (/\bweb\b|frontend|browser|website|\bsite\b|web app|webapp/.test(cat)) return LIVE_SCENARIOS["web app"] as LiveScenario;
  if (/\bcli\b|command.?line|terminal/.test(cat)) return LIVE_SCENARIOS.cli as LiveScenario;
  return (cfg.kind === "skill" ? LIVE_SCENARIOS["agent skill"] : LIVE_SCENARIOS.library) as LiveScenario;
}

const liveScenarioBlock = (cfg: EvalConfig): string =>
  [
    `**Normed live scenario for this category** (full library: \`references/live-scenarios.md\` next to the engine):`,
    `- Golden path: ${liveScenarioFor(cfg).golden}.`,
    `- Error path: ${liveScenarioFor(cfg).error}.`,
    `- Help contract: ${liveScenarioFor(cfg).help}.`,
    `- Expected artifact: ${liveScenarioFor(cfg).artifact}.`,
    `- Pass criteria: ${liveScenarioFor(cfg).pass}.`,
  ].join("\n");

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
  const mode = cfg.mode ?? "audit";
  const doDefects = mode !== "improve"; // audit + deep hunt defects
  const doOpps = mode !== "audit"; // improve + deep discover opportunities
  const meta = {
    name: `ultraeval-${cfg.kind}`,
    description: `Evaluate ${cfg.targetAbs} (mode: ${mode}) — ground every finding, then emit a TDD backlog`,
  };
  const phases: { title: string }[] = [{ title: "Research" }, { title: "TestPlan" }];
  if (doDefects) phases.push({ title: "Execute" }, { title: "Findings" });
  if (doOpps) phases.push({ title: "Analyze" }, { title: "Brainstorm" });
  phases.push({ title: "Gate" }, { title: "Judge" }, { title: "Results" });

  const head = [
    `export const meta = { name: ${JSON.stringify(meta.name)}, description: ${JSON.stringify(meta.description)}, phases: ${JSON.stringify(phases)} }`,
    ``,
    `// NOT a plain Node script: launch via the Workflow tool — Workflow({ scriptPath: ${JSON.stringify(`${runDirAbs}/eval.workflow.mjs`)} }).`,
    `// agent()/phase()/parallel()/log() and the top-level return only exist inside that harness.`,
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
    `function contract(name, extra) {`,
    `  return 'Read and follow the dispatch contract at ' + AGENTS + '/' + name + '.md VERBATIM.\\n'`,
    `    + 'Constants: TARGET=' + TARGET + '  ENGINE=' + ENGINE + '  RUN=' + RUN + '  KIND=' + KIND + '  CATEGORY=' + CATEGORY + '.\\n'`,
    `    + 'Invoke the engine only by its ABSOLUTE path: node ' + ENGINE + ' <cmd>. Write every artifact under RUN. Do not stop early.'`,
    `    + (extra ? '\\n' + extra : '')`,
    `}`,
    ``,
    `log(${JSON.stringify(`ultraeval ${mode} eval for `)} + TARGET)`,
    ``,
    `// Budget discipline (protocol v2): under a harness token target, scale down`,
    `// DELIBERATELY and record every coverage cut — a silent cut reads as full coverage.`,
    `let LENSES = ['correctness+grounding', 'completeness+coverage', 'ux+meets-expectations']`,
    `let RESEARCH_GROUPED = false`,
    `const CUTS = []`,
    `if (typeof budget !== 'undefined' && budget && budget.total) {`,
    `  const left = budget.remaining()`,
    `  if (left < 600000) { RESEARCH_GROUPED = true; CUTS.push('research: ' + DIMENSIONS.length + ' per-dimension agents -> 1 grouped agent (' + Math.round(left / 1000) + 'k tokens left < 600k)') }`,
    `  if (left < 300000) { LENSES = LENSES.slice(0, 2); CUTS.push('judges: 3 lenses -> 2 (' + Math.round(left / 1000) + 'k tokens left < 300k)') }`,
    `}`,
    `if (CUTS.length) {`,
    `  log('budget: recording ' + CUTS.length + ' coverage cut(s) to ' + RUN + '/runs/budget.md')`,
    `  await agent('Create the file ' + RUN + '/runs/budget.md (mkdir -p its directory) containing a markdown doc titled "# Budget coverage cuts" with one bullet per cut: ' + CUTS.map((c) => '"' + c + '"').join(', ') + '. Write NOTHING else and change no other file.', { label: 'budget-scribe', agentType: 'general-purpose' })`,
    `}`,
    ``,
    `phase('Research')`,
    `if (RESEARCH_GROUPED) {`,
    `  await agent(contract('researcher', 'DIMENSIONS=ALL (budget cut — see runs/budget.md). Cover EVERY dimension in one pass; write one ' + RUN + '/research/<id>.md per dimension (cited).'), { label: 'research:all', phase: 'Research', agentType: 'general-purpose' })`,
    `} else {`,
    `  await parallel(DIMENSIONS.map((d) => () => agent(contract('researcher', 'DIMENSION=' + d.id + ' (' + d.name + '). Write ' + RUN + '/research/' + d.id + '.md (cited).'), { label: 'research:' + d.id, phase: 'Research', agentType: 'general-purpose' })))`,
    `}`,
    ``,
    `phase('TestPlan')`,
    `await agent(contract('testplan'), { label: 'testplan', phase: 'TestPlan', agentType: 'general-purpose' })`,
    ``,
  ];
  const defectStage = [
    `phase('Execute')`,
    `await parallel([`,
    `  () => agent(contract('executor', 'MODE=core — deterministic engine + gate exercises on genuine AND doctored artifacts.'), { label: 'run-core', phase: 'Execute', agentType: 'general-purpose' }),`,
    `  () => agent(contract('executor', 'MODE=live — realistic end-to-end run of the target.'), { label: 'run-live', phase: 'Execute', agentType: 'general-purpose' }),`,
    `])`,
    ``,
    `phase('Findings')`,
    `await agent(contract('findings'), { label: 'findings', phase: 'Findings', agentType: 'general-purpose' })`,
    ``,
  ];
  const oppStage = [
    `phase('Analyze')`,
    `await agent(contract('analyzer'), { label: 'analyze', phase: 'Analyze', agentType: 'general-purpose' })`,
    ``,
    `phase('Brainstorm')`,
    `await agent(contract('brainstormer'), { label: 'brainstorm', phase: 'Brainstorm', agentType: 'general-purpose' })`,
    ``,
  ];
  const tail = [
    `phase('Gate')`,
    `await agent(contract('gate'), { label: 'gate', phase: 'Gate', agentType: 'general-purpose' })`,
    ``,
    `phase('Judge')`,
    `await parallel(LENSES.map((lens, i) => () => agent(contract('judge', 'LENS=' + lens), { label: 'judge' + (i + 1), phase: 'Judge', agentType: 'general-purpose' })))`,
    ``,
    `phase('Results')`,
    `await agent(contract('remediator', CUTS.length ? 'BUDGET CUTS to report in SUMMARY.md (also listed in ' + RUN + '/runs/budget.md): ' + CUTS.join(' | ') : ''), { label: 'results', phase: 'Results', agentType: 'general-purpose' })`,
    ``,
    `return { target: TARGET, run: RUN }`,
    ``,
  ];
  return [...head, ...(doDefects ? defectStage : []), ...(doOpps ? oppStage : []), ...tail].join("\n");
}

const GATE_CHEATSHEET = (engineAbs: string, run: string) =>
  [
    `- \`node ${engineAbs} check --run ${run}\` — structural grounding gate (every finding must resolve to a real file:line in the target, or a run: artifact). Exit 0 = grounded.`,
    `- \`node ${engineAbs} verify --run ${run}\` — writes VERIFY.todo.json (claim↔evidence). Fill each verdict honestly: \`supported\`/\`partial\`/\`refuted\`/\`unsupported\`.`,
    `- \`node ${engineAbs} verify --run ${run} --apply <verdicts.json>\` — reduces to VERIFY.json.`,
    `- \`node ${engineAbs} check --run ${run} --semantic --require-verify\` — folds verdicts in; the exit gate.`,
  ].join("\n");

export function agentContracts(cfg: EvalConfig, runDirAbs: string, engineAbs: string): Record<string, string> {
  const dims = cfg.dimensions
    .map((d) => `- **${d.id}** ${d.name} (w=${d.weight}${anchorText(d) ? `, anchored to ${anchorText(d)}` : ""}): ${d.whatPerfectLooksLike}`)
    .join("\n");
  return {
    researcher: `# Contract: researcher

You research the *state of the art for how to evaluate* one DIMENSION of a ${cfg.kind} (category: ${cfg.category}).

Do REAL web research (WebSearch + WebFetch; if not loaded, ToolSearch \`select:WebSearch,WebFetch\`). Find authoritative methodology — metrics, benchmarks, rubrics, known failure modes — specific to this dimension and category.

Deliver:
1. Write a cited markdown note at \`${runDirAbs}/research/<DIMENSION>.md\` — every non-obvious methodological claim cites a fetched URL.
2. End the note with a **scoring rubric** for this dimension: 0–5 anchors and how to measure each on THIS target.

Each dimension is anchored to an external referential (see below). Your research MAY refine an anchor with cited justification; it MUST NOT silently drop the referential.

Dimensions in scope:
${dims}
`,
    testplan: `# Contract: testplan

Read \`${cfg.targetAbs}\` (its SKILL.md/README/CLI \`--help\`, or its source) and the research notes under \`${runDirAbs}/research/\`.

Enumerate EVERY functionality worth testing — modes, subcommands, flags, gates, and the live end-to-end behavior — mapped to the dimensions. For each: id, what it is, the concrete command or user prompt that tests it, and explicit pass criteria.

The live rows MUST map to the category's normed scenario set (golden path, error path, help contract — see \`references/live-scenarios.md\` next to the engine; the executor contract embeds this category's block).

Write \`${runDirAbs}/TEST-PLAN.md\` (a reviewable checklist with the rubric embedded). Be exhaustive about the CLI/behavior surface.
`,
    executor: `# Contract: executor

You produce the raw evidence an eval stands on. Two MODES; do the one named in your prompt.

**MODE=core (deterministic).** Drive the target's own engine/tests and, if the target ships anti-hallucination gates, prove them in BOTH directions: pass on a genuine artifact, fail on a hand-doctored one. Record every command + exit code into \`${runDirAbs}/runs/core.md\`. If the target has a test suite, run it and record the result.

**MODE=live (realistic).** Act as a real user of the target. Follow its own instructions faithfully and produce a real deliverable into \`${runDirAbs}/runs/live-*\`. Write a narrative to \`${runDirAbs}/runs/live.md\` covering what was produced, grounding quality, any hallucination, and each gate's outcome.

${liveScenarioBlock(cfg)}

HARD LIMITS (never block the pipeline):
- **Every Bash step is timeboxed** — set an explicit \`timeout\` (≤ 600000 ms). If a step exceeds it, kill it and record "timed out", then continue.
- **Do NOT launch another live/network tool that itself fans out** — no nested web-research / "deep" / long-crawl runs of the target against a THIRD project. Exercise the target on a small, local, offline input. (A prior run hung ~4h doing exactly this.)
- If a live step is genuinely blocked (missing Docker, no network, rate-limit), degrade to the offline path, record what completed, and move on. Partial evidence is fine; a hang is not.

SAFETY:
- The target's own commands (tests, gates) run with YOUR privileges — sandbox untrusted targets before executing anything they ship.
- Helper scripts you write under RUN inherit the enclosing repo's package.json module type — name them \`.mjs\`/\`.cjs\` explicitly so ESM/CJS resolution never surprises you.

Record exact command lines and exit codes verbatim — later stages cite \`run:runs/core.md#Lnn\` as evidence, so line numbers matter.
`,
    findings: `# Contract: findings

Consolidate the test-plan results and the run logs into \`${runDirAbs}/findings.json\` following \`${runDirAbs}/findings.schema.json\`.

RULES (the grounding gate will enforce these):
- Every finding MUST carry at least one resolvable \`evidence.ref\`:
  - \`path:line\` or \`path:start-end\` — a real location IN THE TARGET (\`${cfg.targetAbs}\`).
  - \`run:relpath#Lnn\` — a line in a log this run produced.
- Do NOT invent line numbers. If you cite \`src/x.ts:42\`, line 42 must exist and support the claim.
- \`severity\`: ${severityLegend()}.
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

**Step 0 — CALIBRATION (required).** Read the golden fixture at \`${calibrationFixturePath(engineAbs)}\`. Score its \`artifacts\` 0–5 on each of its \`dimensions\` (use each dimension's name, NOT its \`expected\`/\`signal\` fields — read the artifacts first, then compare). \`passed\` = every one of your scores is within \`tolerance\` of \`expected\`. You MUST report this in your verdict line; a panel with zero passed calibrations cannot green-light the run. Do NOT let the fixture influence how you score the real run.

Read \`${runDirAbs}/\`: research/, TEST-PLAN.md, runs/core.md, runs/live.md, findings.json, and spot-check the artifacts. Score each dimension 0–5 against its anchored referential (each dimension's \`anchors\` in \`dimensions.json\` names the standard it operationalizes) with a one-line rationale grounded in a path you actually read. Objective gate results (VERIFY.json, check exit codes) are ground truth — weight them.

Append your verdict to \`${runDirAbs}/judges.jsonl\` as one JSON line: \`{ "lens": "...", "dimensionScores": [{"id","score","rationale"}], "overall": 0-100, "meetsExpectations": bool, "topFindings": [], "calibration": { "scores": {"<fixture-dim>": n}, "passed": bool } }\`.
`,
    remediator: `# Contract: remediator

Finalize the eval and generate the AI-exploitable fix docs.

1. Ensure \`${runDirAbs}/RESULTS.md\` and \`SUMMARY.md\` are complete and cite \`[F#]\`; \`score\` computes the weighted verdict and judge agreement from \`judges.jsonl\` — do not hand-average.
2. Score: \`node ${engineAbs} score --run ${runDirAbs}\` → \`scorecard.json\` (weighted 0-100 + meets-expectations, from judges.jsonl).
3. Emit the TDD backlog: \`node ${engineAbs} backlog --run ${runDirAbs} --tdd\` → \`BACKLOG.json\`, \`REMEDIATION.md\`, and one \`fixes/FIX-*.md\` card per confirmed finding/opportunity (RED failing/spec test → GREEN change → VERIFY).
4. Render the dashboard: \`node ${engineAbs} render --run ${runDirAbs}\` → \`index.md\` + \`index.html\` (shows the verdict + opportunities matrix).
5. Re-run \`node ${engineAbs} check --run ${runDirAbs} --semantic\` and confirm exit 0 (backlog integrity is part of the gate).
6. If \`${runDirAbs}/runs/budget.md\` exists (a budgeted run recorded coverage cuts), report EVERY cut in \`SUMMARY.md\` — \`check\` warns when the summary omits them; a silent cut reads as full coverage.

Report the verdict, the P0/P1 backlog headline, the top opportunities (impact×effort), and the paths a downstream fix agent should consume.
`,
    analyzer: `# Contract: analyzer

Produce deterministic signal for the brainstorm stage.

Run \`node ${engineAbs} analyze --run ${runDirAbs}\` → writes \`analysis.json\` + \`ANALYSIS.md\` (size/complexity hotspots, import graph + cycles, git churn, test/doc gaps). Then read \`ANALYSIS.md\` and note the 5-8 highest-signal hotspots the brainstorm should anchor on. This stage is deterministic — do not invent metrics; report what the tool found.
`,
    brainstormer: `# Contract: brainstormer

Discover grounded improvement leads (both internal health AND product/capability) — be divergent, then keep the grounded ones.

1. \`node ${engineAbs} brainstorm --run ${runDirAbs}\` → emits \`BRAINSTORM.todo.md\` (lenses + hotspots).
2. Work every lens against the hotspots in \`ANALYSIS.md\` and the code. Generate MANY candidates, then write \`${runDirAbs}/opportunities.json\`: each \`{ dimension?, impact: high|med|low, effort: S|M|L, title, statement, recommendation, evidence:[{ref}] }\`. Every opportunity MUST anchor to a real \`file:line\` in the target or \`analysis:<file>\` — no ungrounded "rewrite everything". Rate impact/effort honestly (quick wins = high/S).
3. \`node ${engineAbs} brainstorm --run ${runDirAbs} --rank\` → folds ranked opportunities into \`findings.json\` as kind:opportunity. The Gate stage then \`check\`s them; drop any that do not resolve.
`,
  };
}

export function testPlanTemplate(cfg: EvalConfig): string {
  const dims = cfg.dimensions
    .map(
      (d) => `### ${d.name} (weight ${d.weight})\n> Perfect: ${d.whatPerfectLooksLike}${anchorText(d) ? `\n> Anchored to: ${anchorText(d)}` : ""}\n\n- [ ] …\n`,
    )
    .join("\n");
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
    $schema: "https://json-schema.org/draft/2020-12/schema",
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
            kind: { enum: ["defect", "opportunity"], description: "defect (default) or opportunity — the gate requires impact+effort for opportunities" },
            dimension: { type: "string" },
            severity: {
              enum: [...VALID_SEVERITIES],
              description: VALID_SEVERITIES.map(
                (s) => `${s} — ${SEVERITY_DEFS[s].label} (${SEVERITY_DEFS[s].cvssBand}): ${SEVERITY_DEFS[s].meaning}; gate: ${SEVERITY_DEFS[s].gateEffect}`,
              ).join(" | "),
            },
            impact: { enum: ["high", "med", "low"], description: "opportunities: value axis" },
            effort: { enum: ["S", "M", "L"], description: "opportunities: cost axis" },
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
          allOf: [
            {
              if: { properties: { kind: { const: "opportunity" } }, required: ["kind"] },
              then: { required: ["impact", "effort"] },
            },
          ],
        },
      },
    },
  };
}
