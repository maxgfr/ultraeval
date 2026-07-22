import { execFileSync } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { readText, writeText } from "./util.js";

// Run directories are throwaway artifacts (the committed record is the
// evals/history.jsonl ledger — see score.ts). When a run dir lands inside a git
// repo, init protects that repo by appending the run path to its .gitignore —
// idempotently, and collapsing anything under a `.ultraeval/` container to the
// one conventional entry so repeated runs never accumulate lines.
export interface GitignoreResult {
  action: "added" | "already" | "skipped";
  path?: string; // the .gitignore that was written/checked
  entry?: string; // the ignore line the run dir resolves to
  reason?: string; // why skipped
}

// Root of the git repo CONTAINING the run dir (which may differ from the target
// repo). Guarded like init's gitInfo: no git / not a repo degrades to null.
function gitRootOf(dir: string): string | null {
  try {
    const out = execFileSync("git", ["-C", dir, "rev-parse", "--show-toplevel"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    return out || null;
  } catch {
    return null;
  }
}

const HEADER = "# ultraeval runs";

export function ensureGitignored(runDirAbs: string): GitignoreResult {
  const root = gitRootOf(runDirAbs);
  if (!root) return { action: "skipped", reason: "run dir is not inside a git repo" };
  // realpath both sides: git reports the physical path (e.g. /private/var on
  // macOS) while the caller may hold the symlinked one — relative() needs one world.
  const rel = relative(realpathSync(root), realpathSync(runDirAbs)).split(sep).join("/");
  if (!rel || rel.startsWith("..")) return { action: "skipped", reason: "run dir is the repo root" };

  // Collapse to the conventional `.ultraeval/` container when the run lives
  // under one; otherwise ignore the exact run dir.
  const segments = rel.split("/");
  const container = segments.indexOf(".ultraeval");
  const entry = container >= 0 ? `${segments.slice(0, container + 1).join("/")}/` : `${rel}/`;

  // Never ignore the ledger home: `score --history` commits evals/history.jsonl.
  if (entry === "evals/") return { action: "skipped", entry, reason: "refusing — the committed score ledger lives under evals/" };

  const path = join(root, ".gitignore");
  const existing = existsSync(path) ? readText(path) : "";
  const bare = entry.replace(/\/$/, "");
  const covered = existing
    .split(/\r?\n/)
    .map((l) => l.trim())
    .some((l) => l === entry || l === bare || l === `/${entry}` || l === `/${bare}`);
  if (covered) return { action: "already", path, entry };

  const eol = existing.includes("\r\n") ? "\r\n" : "\n";
  const lines: string[] = [];
  if (existing && !existing.endsWith("\n")) lines.push("");
  if (!existing.includes(HEADER)) lines.push(HEADER);
  lines.push(entry);
  try {
    writeText(path, existing + lines.join(eol) + eol);
  } catch (err) {
    return { action: "skipped", path, entry, reason: `could not write .gitignore: ${(err as Error).message}` };
  }
  return { action: "added", path, entry };
}
