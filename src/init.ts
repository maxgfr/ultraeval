import { join, resolve } from "node:path";
import { defaultDimensions } from "./rubrics.js";
import type { EvalConfig, Kind } from "./types.js";
import { VERSION } from "./types.js";
import { ensureDir, exists, listMarkdown, writeJson } from "./util.js";

export interface InitOpts {
  target: string;
  out: string;
  kind?: Kind;
  category?: string;
}

// A target is a "skill" if it exposes a SKILL.md (at root or under skills/<x>/).
export function detectKind(targetAbs: string): Kind {
  if (exists(join(targetAbs, "SKILL.md"))) return "skill";
  const skillsDir = join(targetAbs, "skills");
  if (exists(skillsDir)) {
    for (const md of listMarkdown(skillsDir)) if (md.endsWith("SKILL.md")) return "skill";
  }
  return "codebase";
}

export function initRun(opts: InitOpts): { cfg: EvalConfig; runDir: string } {
  const targetAbs = resolve(process.cwd(), opts.target);
  if (!exists(targetAbs)) throw new Error(`target not found: ${opts.target}`);
  const kind = opts.kind ?? detectKind(targetAbs);
  const category = opts.category ?? (kind === "skill" ? "agent skill" : "software project");
  const cfg: EvalConfig = {
    target: opts.target,
    targetAbs,
    kind,
    category,
    dimensions: defaultDimensions(kind, category),
    note: "starter dimensions — the research stage refines them",
    version: VERSION,
  };
  const runDir = resolve(process.cwd(), opts.out);
  ensureDir(join(runDir, "runs"));
  ensureDir(join(runDir, "research"));
  writeJson(join(runDir, "eval.config.json"), cfg);
  return { cfg, runDir };
}
