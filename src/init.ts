import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { join, resolve } from "node:path";
import { defaultDimensions } from "./rubrics.js";
import type { Dimension, EvalConfig, Kind, Mode, Provenance } from "./types.js";
import { PROTOCOL_VERSION, RUBRIC_VERSION, VERSION } from "./types.js";
import { ensureDir, exists, listMarkdown, writeJson } from "./util.js";

export interface InitOpts {
  target: string;
  out: string;
  kind?: Kind;
  category?: string;
  mode?: Mode;
  bar?: number; // category-calibrated meets-expectations bar
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

// Guarded git lookup (same pattern as gitChurn in analyze.ts): a non-git target
// or a missing git binary degrades to `undefined`, never throws.
function gitInfo(targetAbs: string): Provenance["targetGit"] {
  const git = (args: string[]) => execFileSync("git", ["-C", targetAbs, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  try {
    const commit = git(["rev-parse", "HEAD"]);
    const dirty = git(["status", "--porcelain"]).length > 0;
    let branch: string | undefined;
    try {
      branch = git(["rev-parse", "--abbrev-ref", "HEAD"]) || undefined;
    } catch {
      branch = undefined;
    }
    return { commit, ...(branch ? { branch } : {}), dirty };
  } catch {
    return undefined;
  }
}

const dimensionsHash = (dims: Dimension[]): string => createHash("sha256").update(JSON.stringify(dims)).digest("hex").slice(0, 12);

export function initRun(opts: InitOpts): { cfg: EvalConfig; runDir: string } {
  const targetAbs = resolve(process.cwd(), opts.target);
  if (!exists(targetAbs)) throw new Error(`target not found: ${opts.target}`);
  const kind = opts.kind ?? detectKind(targetAbs);
  const category = opts.category ?? (kind === "skill" ? "agent skill" : "software project");
  const mode = opts.mode ?? "audit";
  const dimensions = defaultDimensions(kind, category);
  const targetGit = gitInfo(targetAbs);
  const provenance: Provenance = {
    engineVersion: VERSION,
    protocolVersion: PROTOCOL_VERSION,
    rubricVersion: RUBRIC_VERSION,
    createdAt: new Date().toISOString(),
    mode,
    kind,
    category,
    dimensionsHash: dimensionsHash(dimensions),
    ...(targetGit ? { targetGit } : {}),
  };
  const cfg: EvalConfig = {
    target: opts.target,
    targetAbs,
    kind,
    category,
    mode,
    dimensions,
    note: "starter dimensions — the research stage refines them",
    version: VERSION,
    provenance,
    ...(opts.bar !== undefined && Number.isFinite(opts.bar) ? { meetsBar: opts.bar } : {}),
  };
  const runDir = resolve(process.cwd(), opts.out);
  ensureDir(join(runDir, "runs"));
  ensureDir(join(runDir, "research"));
  writeJson(join(runDir, "eval.config.json"), cfg);
  return { cfg, runDir };
}
