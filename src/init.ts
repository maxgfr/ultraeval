import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { isAbsolute, join, resolve } from "node:path";
import { ensureGitignored, type GitignoreResult } from "./gitignore.js";
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
  since?: string; // diff-scope the eval to changes since this git ref (PR gating)
  scope?: string[]; // file-scope the eval to target-relative globs (e.g. métier eval: src/domain/**)
  gitignore?: boolean; // default true: gitignore the run dir in the repo containing it (--no-gitignore opts out)
  oneshot?: boolean; // stamp the single-pass profile (the `oneshot` command sets this; `plan` clears it on upgrade)
}

// Scope entries are target-relative globs; an absolute path or a `..` escape
// would let a "scoped" eval cite files outside the target — reject at init.
function normalizeScope(scope: string[] | undefined): string[] | undefined {
  if (!scope) return undefined;
  const clean: string[] = [];
  for (const raw of scope) {
    const entry = raw.trim();
    if (!entry) continue;
    if (isAbsolute(entry) || entry.split(/[\\/]/).includes(".."))
      throw new Error(`--scope ${entry}: entries must be target-relative globs (no absolute paths, no ..)`);
    if (!clean.includes(entry)) clean.push(entry);
  }
  return clean.length ? clean : undefined;
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

// sha256 (first 12 hex) of the dimensions at init — stamped into provenance so a
// consumer (check) can detect a rubric refined after init. Exported so the
// recompute lives next to the definition and cannot drift from it.
export const dimensionsHash = (dims: Dimension[]): string => createHash("sha256").update(JSON.stringify(dims)).digest("hex").slice(0, 12);

export function initRun(opts: InitOpts): { cfg: EvalConfig; runDir: string; gitignore?: GitignoreResult } {
  const targetAbs = resolve(process.cwd(), opts.target);
  if (!exists(targetAbs)) throw new Error(`target not found: ${opts.target}`);
  const kind = opts.kind ?? detectKind(targetAbs);
  const category = opts.category ?? (kind === "skill" ? "agent skill" : "software project");
  const mode = opts.mode ?? "audit";
  const dimensions = defaultDimensions(kind, category);
  const scope = normalizeScope(opts.scope);
  const targetGit = gitInfo(targetAbs);
  // --since must be a ref the TARGET repo can resolve — a typo'd ref would
  // silently scope the eval to nothing.
  if (opts.since) {
    try {
      execFileSync("git", ["-C", targetAbs, "rev-parse", "--verify", `${opts.since}^{commit}`], { stdio: ["ignore", "ignore", "ignore"] });
    } catch {
      throw new Error(`--since ${opts.since}: not a resolvable git ref in ${targetAbs}`);
    }
  }
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
    ...(opts.since ? { sinceRef: opts.since } : {}),
    ...(scope ? { scope } : {}),
    ...(opts.oneshot ? { profile: "oneshot" as const } : {}),
  };
  const cfg: EvalConfig = {
    target: opts.target,
    targetAbs,
    kind,
    category,
    mode,
    dimensions,
    ...(scope ? { scope } : {}),
    ...(opts.oneshot ? { oneshot: true } : {}),
    note: "starter dimensions — the research stage refines them",
    version: VERSION,
    provenance,
    ...(opts.bar !== undefined && Number.isFinite(opts.bar) ? { meetsBar: opts.bar } : {}),
  };
  const runDir = resolve(process.cwd(), opts.out);
  ensureDir(join(runDir, "runs"));
  ensureDir(join(runDir, "research"));
  writeJson(join(runDir, "eval.config.json"), cfg);
  const gitignore = opts.gitignore === false ? undefined : ensureGitignored(runDir);
  return { cfg, runDir, ...(gitignore ? { gitignore } : {}) };
}
