import { readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { exists } from "./util.js";

// Derived gate/render artifacts a re-run regenerates. Default `clean` removes ONLY
// these and keeps the deliverables — findings.json, RESULTS.md, SUMMARY.md,
// research/, runs/, agents/, eval.workflow.mjs, eval.config.json, and the
// remediation deliverable (BACKLOG.json, REMEDIATION.md, fixes/FIX-*.md) a fix
// agent consumes. `--all` removes the whole run. This matches SKILL.md §Safety and
// the `--help` text, which both promise clean "keeps the deliverables".
const DERIVED = ["VERIFY.todo.json", "VERIFY.md", "VERIFY.json", "VERIFY.honeypots.json", "index.html", "index.md", "eval.sarif"];

export function clean(runDir: string, opts: { all?: boolean } = {}): string[] {
  const removed: string[] = [];
  // Run-guard: refuse to delete anything from a directory that is not an
  // ultraeval run — a typo'd --run must never destroy an arbitrary directory.
  if (exists(runDir) && !exists(join(runDir, "eval.config.json"))) {
    throw new Error(`refusing to clean ${runDir}: not an ultraeval run (no eval.config.json)`);
  }
  if (opts.all) {
    if (exists(runDir)) {
      rmSync(runDir, { recursive: true, force: true });
      removed.push(runDir);
    }
    return removed;
  }
  for (const name of DERIVED) {
    const p = join(runDir, name);
    if (exists(p)) {
      rmSync(p, { force: true });
      removed.push(p);
    }
  }
  // sharded verify worklists (VERIFY.todo.<i>.json / VERIFY.<i>.md / VERIFY.honeypots.<i>.json)
  if (exists(runDir)) {
    for (const e of readdirSync(runDir)) {
      if (/^VERIFY\.(todo\.|honeypots\.)?\d+\.(json|md)$/.test(e)) {
        rmSync(join(runDir, e), { force: true });
        removed.push(join(runDir, e));
      }
    }
  }
  // fixes/ (the TDD-card tree) is a remediation deliverable, not a derived
  // gate/render artifact — default clean preserves it; only `--all` removes it.
  return removed;
}
