import { cpSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { agentContracts } from "./templates.js";
import type { EvalConfig } from "./types.js";
import { exists, readJson, writeText } from "./util.js";

// Test-retest verdict stability: reuse a completed run's evidence artifacts
// verbatim, wipe the judge panel, and re-judge at ~10% of a full run's cost.
// `compare --run <out> --base <run>` then shows |Δoverall| at constant SHA.

const COPY_FILES = ["eval.config.json", "dimensions.json", "findings.json", "RESULTS.md", "SUMMARY.md", "TEST-PLAN.md", "VERIFY.json"];
const COPY_DIRS = ["research", "runs"];

export function rejudgeRun(runDir: string, outDir: string, engineAbs: string): string[] {
  if (!exists(join(runDir, "eval.config.json"))) throw new Error(`refusing to rejudge ${runDir}: not an ultraeval run (no eval.config.json)`);
  const cfg = readJson<EvalConfig>(join(runDir, "eval.config.json"));
  mkdirSync(outDir, { recursive: true });
  const copied: string[] = [];
  for (const f of COPY_FILES) {
    if (!exists(join(runDir, f))) continue;
    cpSync(join(runDir, f), join(outDir, f));
    copied.push(f);
  }
  for (const d of COPY_DIRS) {
    if (!exists(join(runDir, d))) continue;
    cpSync(join(runDir, d), join(outDir, d), { recursive: true });
    copied.push(`${d}/`);
  }
  writeText(join(outDir, "judges.jsonl"), ""); // a FRESH panel — stability is only meaningful with new judges
  writeText(join(outDir, "agents", "judge.md"), agentContracts(cfg, outDir, engineAbs).judge as string);
  writeText(join(outDir, "rejudge.workflow.mjs"), rejudgeWorkflow(cfg, outDir, engineAbs, runDir));
  return copied;
}

// Minimal Workflow script: judge panel + score/compare. Deliberately no
// top-level `return` so it is also dynamically importable with stubbed globals.
function rejudgeWorkflow(cfg: EvalConfig, outAbs: string, engineAbs: string, baseAbs: string): string {
  const meta = {
    name: "ultraeval-rejudge",
    description: `Re-judge ${cfg.targetAbs} from reused artifacts (test-retest verdict stability)`,
    phases: [{ title: "Judge" }, { title: "Score" }],
  };
  return [
    `export const meta = ${JSON.stringify(meta)}`,
    ``,
    `// Constants for THIS rejudge (injected by \`ultraeval rejudge\`).`,
    `const ENGINE = ${JSON.stringify(engineAbs)}`,
    `const RUN = ${JSON.stringify(outAbs)}`,
    `const BASE = ${JSON.stringify(baseAbs)}`,
    `const AGENTS = RUN + '/agents'`,
    ``,
    `// Parse-safe guard: under plain \`node\` the Workflow-harness globals are absent.`,
    `if (typeof phase === 'undefined') {`,
    `  console.error('rejudge.workflow.mjs is a Workflow-harness script, not a plain Node script — agent()/phase()/parallel()/log() come from the harness.')`,
    `  console.error('Launch it with: Workflow({ scriptPath: ' + JSON.stringify(RUN + '/rejudge.workflow.mjs') + ' })')`,
    `  console.error('No Workflow tool? Run the stages by hand: dispatch a subagent per contract under ' + AGENTS + '/*.md (see SKILL.md).')`,
    `  process.exit(2)`,
    `}`,
    ``,
    `function contract(name, extra) {`,
    `  return 'Read and follow the dispatch contract at ' + AGENTS + '/' + name + '.md VERBATIM.\\n'`,
    `    + 'Constants: ENGINE=' + ENGINE + '  RUN=' + RUN + '.\\n'`,
    `    + 'Invoke the engine only by its ABSOLUTE path: node ' + ENGINE + ' <cmd>. Write every artifact under RUN. Do not stop early.'`,
    `    + (extra ? '\\n' + extra : '')`,
    `}`,
    ``,
    `log('ultraeval rejudge (test-retest) for ' + RUN)`,
    ``,
    `phase('Judge')`,
    `const LENSES = ['correctness+grounding', 'completeness+coverage', 'ux+meets-expectations']`,
    `await parallel(LENSES.map((lens, i) => () => agent(contract('judge', 'LENS=' + lens), { label: 'judge' + (i + 1), phase: 'Judge', agentType: 'general-purpose' })))`,
    ``,
    `phase('Score')`,
    `await agent('Run \`node ' + ENGINE + ' score --run ' + RUN + '\` then \`node ' + ENGINE + ' compare --run ' + RUN + ' --base ' + BASE + '\`. Report the verdict, |Δoverall| vs the base run and both agreement values (COMPARE.md prints a stability line at constant target commit).', { label: 'score', phase: 'Score', agentType: 'general-purpose' })`,
    ``,
    `log('rejudge complete — see ' + RUN + '/COMPARE.md')`,
    ``,
  ].join("\n");
}
