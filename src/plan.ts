import { rmSync } from "node:fs";
import { join } from "node:path";
import { agentContracts, findingsSchema, runbookMd, testPlanTemplate, workflowScript } from "./templates.js";
import type { EvalConfig } from "./types.js";
import { readJson, writeJson, writeText } from "./util.js";

// Emit a ready-to-launch multi-agent Workflow + subagent contracts + templates,
// all parameterized to the eval run's target and the absolute engine path.
// --eco (the family-wide low-token switch) swaps the workflow for RUNBOOK.md:
// the same stages in the same order, played sequentially against the same
// agents/*.md contracts — correctness-identical, only wall-clock differs.
export function planRun(runDir: string, engineAbs: string, opts: { eco?: boolean } = {}): string[] {
  let cfg = readJson<EvalConfig>(join(runDir, "eval.config.json"));
  const written: string[] = [];
  const w = (rel: string, content: string) => {
    const p = join(runDir, rel);
    writeText(p, content);
    written.push(p);
  };
  // Upgrade path: planning a oneshot run promotes it to the full pipeline —
  // drop the single-pass contract and clear the profile so gates/comparisons
  // treat it as a normal run from here on.
  if (cfg.oneshot || cfg.provenance?.profile) {
    rmSync(join(runDir, "ONESHOT.md"), { force: true });
    const { oneshot: _oneshot, ...rest } = cfg;
    cfg = rest as EvalConfig;
    if (cfg.provenance?.profile) {
      const { profile: _profile, ...prov } = cfg.provenance;
      cfg = { ...cfg, provenance: prov as EvalConfig["provenance"] };
    }
    writeJson(join(runDir, "eval.config.json"), cfg);
    written.push(join(runDir, "eval.config.json"));
  }
  // The two entry points are alternatives — remove the counterpart so the run
  // dir never carries both a workflow and a runbook from different invocations.
  if (opts.eco === true) {
    rmSync(join(runDir, "eval.workflow.mjs"), { force: true });
    w("RUNBOOK.md", runbookMd(cfg, runDir, engineAbs));
  } else {
    rmSync(join(runDir, "RUNBOOK.md"), { force: true });
    w("eval.workflow.mjs", workflowScript(cfg, runDir, engineAbs));
  }
  for (const [name, content] of Object.entries(agentContracts(cfg, runDir, engineAbs))) w(`agents/${name}.md`, content);
  w("TEST-PLAN.template.md", testPlanTemplate(cfg));
  w("dimensions.json", `${JSON.stringify(cfg.dimensions, null, 2)}\n`);
  w("findings.schema.json", `${JSON.stringify(findingsSchema(), null, 2)}\n`);
  return written;
}
