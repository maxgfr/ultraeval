import { join } from "node:path";
import type { GitignoreResult } from "./gitignore.js";
import { initRun, type InitOpts } from "./init.js";
import { findingsSchema, oneshotMd } from "./templates.js";
import type { EvalConfig } from "./types.js";
import { writeText } from "./util.js";

// `oneshot` = init + ONE self-contained single-pass contract, instead of the
// multi-agent plan. Audit-only, no --since (a diff-scoped eval is PR gating —
// that deserves the full pipeline). The full pipeline stays the default;
// `plan --run <run>` upgrades a oneshot run in place.
export type OneshotOpts = Omit<InitOpts, "mode" | "since" | "oneshot">;

export function oneshotRun(opts: OneshotOpts, engineAbs: string): { cfg: EvalConfig; runDir: string; written: string[]; gitignore?: GitignoreResult } {
  const { cfg, runDir, gitignore } = initRun({ ...opts, mode: "audit", oneshot: true });
  const written: string[] = [join(runDir, "eval.config.json")];
  const w = (rel: string, content: string) => {
    const p = join(runDir, rel);
    writeText(p, content);
    written.push(p);
  };
  w("ONESHOT.md", oneshotMd(cfg, runDir, engineAbs));
  w("dimensions.json", `${JSON.stringify(cfg.dimensions, null, 2)}\n`);
  w("findings.schema.json", `${JSON.stringify(findingsSchema(), null, 2)}\n`);
  return { cfg, runDir, written, ...(gitignore ? { gitignore } : {}) };
}
