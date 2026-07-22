import { join } from "node:path";
import type { EvalConfig } from "./types.js";
import { exists, readJson, readText } from "./util.js";

// Where is this run in the pipeline, and what is the EXACT next command?
// Purely artifact-based (no engine state): each step names the artifact that
// proves it happened, in pipeline order; `next` is derived from the first gap.

export interface StatusStep {
  artifact: string;
  present: boolean;
  stage: string;
}

export interface RunStatus {
  steps: StatusStep[];
  next: string;
}

export function statusRun(runDir: string): RunStatus {
  const has = (rel: string) => exists(join(runDir, rel));
  // Oneshot runs walk a shorter pipeline. Guarded read: a missing/broken config
  // degrades to the full artifact-based checklist (status never throws).
  let oneshot = false;
  try {
    if (has("eval.config.json")) oneshot = readJson<EvalConfig>(join(runDir, "eval.config.json")).oneshot === true;
  } catch {
    oneshot = false;
  }
  if (oneshot) {
    const steps: StatusStep[] = [
      { artifact: "eval.config.json", present: has("eval.config.json"), stage: "init" },
      { artifact: "ONESHOT.md", present: has("ONESHOT.md"), stage: "oneshot" },
      { artifact: "findings.json", present: has("findings.json"), stage: "findings" },
      { artifact: "SUMMARY.md", present: has("SUMMARY.md"), stage: "findings" },
      { artifact: "scorecard.json", present: has("scorecard.json"), stage: "score" },
    ];
    return { steps, next: oneshotNextHint(steps, runDir) };
  }
  const judgesPresent = has("judges.jsonl") && readText(join(runDir, "judges.jsonl")).trim().length > 0;
  const steps: StatusStep[] = [
    { artifact: "eval.config.json", present: has("eval.config.json"), stage: "init" },
    { artifact: "agents/", present: has("agents"), stage: "plan" },
    { artifact: "eval.workflow.mjs", present: has("eval.workflow.mjs"), stage: "plan" },
    { artifact: "TEST-PLAN.md", present: has("TEST-PLAN.md"), stage: "testplan" },
    { artifact: "findings.json", present: has("findings.json"), stage: "findings" },
    { artifact: "VERIFY.json", present: has("VERIFY.json"), stage: "verify" },
    { artifact: "judges.jsonl", present: judgesPresent, stage: "judge" },
    { artifact: "scorecard.json", present: has("scorecard.json"), stage: "score" },
    { artifact: "BACKLOG.json", present: has("BACKLOG.json"), stage: "backlog" },
    { artifact: "index.html", present: has("index.html"), stage: "render" },
  ];
  return { steps, next: nextHint(steps, runDir) };
}

function oneshotNextHint(steps: StatusStep[], runDir: string): string {
  const missing = (stage: string) => steps.some((s) => s.stage === stage && !s.present);
  if (missing("oneshot")) return `oneshot --target <target> --out ${runDir} (regenerates ONESHOT.md)`;
  if (missing("findings")) return `follow ${runDir}/ONESHOT.md — one pass, then check --run ${runDir}`;
  return `check --run ${runDir} until exit 0 — then optional: score --run ${runDir}, backlog --run ${runDir} --tdd, or plan --run ${runDir} to upgrade to the full pipeline`;
}

function nextHint(steps: StatusStep[], runDir: string): string {
  const missing = (stage: string) => steps.some((s) => s.stage === stage && !s.present);
  if (missing("init")) return `init --target <target> --out ${runDir}`;
  if (missing("plan")) return `plan --run ${runDir}`;
  if (missing("testplan") || missing("findings"))
    return `launch the generated workflow — Workflow({ scriptPath: "${runDir}/eval.workflow.mjs" }) — or run the stages by hand via agents/*.md`;
  if (missing("verify"))
    return `check --run ${runDir} && verify --run ${runDir} --honeypots 3, fill verdicts, then verify --apply and check --semantic --require-verify`;
  if (missing("judge")) return `dispatch the judge panel (agents/judge.md) to append judges.jsonl`;
  if (missing("score")) return `score --run ${runDir} --history`;
  if (missing("backlog")) return `backlog --run ${runDir} --tdd`;
  if (missing("render")) return `render --run ${runDir} — then fix --run ${runDir} [--workflow] and verify-fix per task`;
  return `done — drive remediation: fix --run ${runDir} [--workflow], then verify-fix --run ${runDir} --task FIX-XXX`;
}

export function formatStatus(s: RunStatus, runDir: string): string {
  const lines = [`status  ${runDir}`];
  for (const st of s.steps) lines.push(`  ${st.present ? "✓" : "·"} ${st.artifact}  (${st.stage})`);
  lines.push(`  next: ${s.next}`);
  return lines.join("\n");
}
