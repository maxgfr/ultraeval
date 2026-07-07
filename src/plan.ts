import { join } from "node:path";
import { agentContracts, findingsSchema, testPlanTemplate, workflowScript } from "./templates.js";
import type { EvalConfig } from "./types.js";
import { readJson, writeText } from "./util.js";

// Emit a ready-to-launch multi-agent Workflow + subagent contracts + templates,
// all parameterized to the eval run's target and the absolute engine path.
export function planRun(runDir: string, engineAbs: string): string[] {
  const cfg = readJson<EvalConfig>(join(runDir, "eval.config.json"));
  const written: string[] = [];
  const w = (rel: string, content: string) => {
    const p = join(runDir, rel);
    writeText(p, content);
    written.push(p);
  };
  w("eval.workflow.mjs", workflowScript(cfg, runDir, engineAbs));
  for (const [name, content] of Object.entries(agentContracts(cfg, runDir, engineAbs))) w(`agents/${name}.md`, content);
  w("TEST-PLAN.template.md", testPlanTemplate(cfg));
  w("dimensions.json", `${JSON.stringify(cfg.dimensions, null, 2)}\n`);
  w("findings.schema.json", `${JSON.stringify(findingsSchema(), null, 2)}\n`);
  return written;
}
