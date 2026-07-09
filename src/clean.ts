import { readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { exists } from "./util.js";

// Derived artifacts a re-run regenerates. Default `clean` removes ONLY these and
// keeps the deliverables (findings.json, RESULTS.md, SUMMARY.md, research/,
// runs/, agents/, eval.workflow.mjs, eval.config.json). `--all` removes the run.
const DERIVED = ["VERIFY.todo.json", "VERIFY.md", "VERIFY.json", "index.html", "index.md", "BACKLOG.json", "REMEDIATION.md", "eval.sarif"];

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
  // sharded verify worklists (VERIFY.todo.<i>.json / VERIFY.<i>.md)
  if (exists(runDir)) {
    for (const e of readdirSync(runDir)) {
      if (/^VERIFY\.(todo\.)?\d+\.(json|md)$/.test(e)) {
        rmSync(join(runDir, e), { force: true });
        removed.push(join(runDir, e));
      }
    }
  }
  const fixes = join(runDir, "fixes");
  if (exists(fixes)) {
    rmSync(fixes, { recursive: true, force: true });
    removed.push(fixes);
  }
  return removed;
}
