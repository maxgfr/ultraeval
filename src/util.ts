import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import type { Effort, Impact, Provenance } from "./types.js";

// ---- fs helpers ----------------------------------------------------------
export function exists(p: string): boolean {
  return existsSync(p);
}

export function ensureDir(p: string): void {
  mkdirSync(p, { recursive: true });
}

export function readText(p: string): string {
  return readFileSync(p, "utf8");
}

let tmpCounter = 0;
export function writeText(p: string, s: string): void {
  ensureDir(dirname(p));
  // Atomic write: stage into a temp file in the SAME directory (rename is only
  // atomic within a filesystem) then rename over the target, so a crash
  // mid-write can never leave a truncated file. Empty content (s === "") is
  // written faithfully. writeJson delegates here, so JSON is covered too.
  const tmp = `${p}.${process.pid}.${tmpCounter++}.tmp`;
  try {
    writeFileSync(tmp, s);
    renameSync(tmp, p);
  } catch (err) {
    // Best-effort cleanup of the partial temp file; surface the original error.
    rmSync(tmp, { force: true });
    throw err;
  }
}

export function readJson<T = unknown>(p: string): T {
  return JSON.parse(readFileSync(p, "utf8")) as T;
}

export function writeJson(p: string, data: unknown): void {
  writeText(p, `${JSON.stringify(data, null, 2)}\n`);
}

export function slug(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "item"
  );
}

export function listMarkdown(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith(".md")) out.push(p);
    }
  };
  walk(dir);
  return out;
}

// The stored absolute target path is used when it still exists (normal run);
// otherwise (a committed/moved eval run) the target is resolved relative to the
// run dir, so a self-contained sample run stays portable across machines/CI.
export function resolveTargetAbs(targetAbs: string, target: string, runDir: string): string {
  if (targetAbs && existsSync(targetAbs)) return targetAbs;
  return resolve(runDir, target);
}

// ---- evidence reference resolution --------------------------------------
// A finding cites evidence via a `ref` string. This resolves it against the
// TARGET repo (for code citations) or the eval RUN dir (for produced logs).
// The core anti-hallucination guarantee: a gradeable ref must point at a real
// file, and a real line within range — a stale/invented line is a hard failure.
export type EvidenceKind = "file" | "run" | "url" | "external";

export interface ResolvedEvidence {
  raw: string;
  kind: EvidenceKind;
  gradeable: boolean; // can this ref, in principle, be checked offline?
  resolved: boolean; // does it actually point at something real?
  reason?: string; // why unresolved
  absPath?: string;
  lineStart?: number;
  lineEnd?: number;
}

export interface ResolveOpts {
  targetAbs: string;
  runDir: string;
}

function parseLineSpec(spec: string): { start: number; end: number } | null {
  const m = spec.match(/^(\d+)(?:-(\d+))?$/);
  if (!m) return null;
  const start = Number(m[1]);
  const end = m[2] ? Number(m[2]) : start;
  return { start, end };
}

function lineCount(absPath: string): number {
  const raw = readFileSync(absPath, "utf8");
  if (raw === "") return 0;
  // A trailing newline does not add a line; "a\nb\n" is 2 lines.
  const n = raw.split("\n").length;
  return raw.endsWith("\n") ? n - 1 : n;
}

export function resolveEvidence(ref: string, opts: ResolveOpts): ResolvedEvidence {
  let raw = String(ref ?? "").trim();

  // `analysis:<targetpath[:line]>` is a provenance-tagged citation to a metric's
  // subject file — resolve it like an ordinary target path.
  if (raw.startsWith("analysis:")) raw = raw.slice("analysis:".length);

  if (raw.startsWith("url:") || /^https?:\/\//.test(raw)) {
    return { raw, kind: "url", gradeable: false, resolved: false, reason: "external URL (not resolvable offline)" };
  }

  // "run:relpath[#Lnn]" — a file the eval run produced (a log/artifact).
  if (raw.startsWith("run:")) {
    const body = raw.slice(4);
    const [rel = "", anchor] = body.split("#");
    const absPath = resolve(opts.runDir, rel);
    // Same containment guard as target refs: a run: citation must stay inside
    // the run dir — `run:../../x` escaping it is never graded as evidence.
    const relFromRun = relative(opts.runDir, absPath);
    if (relFromRun.startsWith("..") || isAbsolute(relFromRun)) {
      return { raw, kind: "external", gradeable: false, resolved: false, reason: "path escapes the run directory (not graded)", absPath };
    }
    if (!existsSync(absPath)) return { raw, kind: "run", gradeable: true, resolved: false, reason: `run artifact not found: ${rel}`, absPath };
    const line = anchor?.match(/^L(\d+)$/);
    if (line) {
      const n = Number(line[1]);
      const total = lineCount(absPath);
      if (n < 1 || n > total)
        return { raw, kind: "run", gradeable: true, resolved: false, reason: `line ${n} out of range (1-${total})`, absPath, lineStart: n, lineEnd: n };
      return { raw, kind: "run", gradeable: true, resolved: true, absPath, lineStart: n, lineEnd: n };
    }
    return { raw, kind: "run", gradeable: true, resolved: true, absPath };
  }

  // "path:line" | "path:start-end" | "path" — a location in the TARGET repo.
  let path = raw;
  let lineSpec: { start: number; end: number } | null = null;
  const lastColon = raw.lastIndexOf(":");
  if (lastColon > 0) {
    const maybe = parseLineSpec(raw.slice(lastColon + 1));
    if (maybe) {
      path = raw.slice(0, lastColon);
      lineSpec = maybe;
    }
  }

  const absPath = isAbsolute(path) ? path : resolve(opts.targetAbs, path);
  const rel = relative(opts.targetAbs, absPath);
  const outsideTarget = rel.startsWith("..") || isAbsolute(rel);
  if (outsideTarget) {
    // Never read outside the target (path-traversal guard); record but don't grade.
    return { raw, kind: "external", gradeable: false, resolved: false, reason: "path is outside the target repo (not graded)", absPath };
  }
  if (!existsSync(absPath)) {
    return {
      raw,
      kind: "file",
      gradeable: true,
      resolved: false,
      reason: `file not found: ${path}`,
      absPath,
      lineStart: lineSpec?.start,
      lineEnd: lineSpec?.end,
    };
  }
  if (lineSpec) {
    const total = lineCount(absPath);
    if (lineSpec.start < 1 || lineSpec.end < lineSpec.start || lineSpec.end > total) {
      return {
        raw,
        kind: "file",
        gradeable: true,
        resolved: false,
        reason: `line ${lineSpec.start}-${lineSpec.end} out of range (1-${total}) — hallucinated or stale`,
        absPath,
        lineStart: lineSpec.start,
        lineEnd: lineSpec.end,
      };
    }
    return { raw, kind: "file", gradeable: true, resolved: true, absPath, lineStart: lineSpec.start, lineEnd: lineSpec.end };
  }
  // File-scoped citation (no line) — accepted if the file exists.
  return { raw, kind: "file", gradeable: true, resolved: true, absPath };
}

// Pull a short context window around the cited line(s) for a verify digest.
export function extractContext(absPath: string, start?: number, end?: number, pad = 2): string {
  if (!existsSync(absPath)) return "";
  const lines = readFileSync(absPath, "utf8").split("\n");
  if (start === undefined) return lines.slice(0, 12).join("\n");
  const from = Math.max(0, start - 1 - pad);
  const to = Math.min(lines.length, (end ?? start) + pad);
  return lines
    .slice(from, to)
    .map((l, i) => `${from + i + 1}: ${l}`)
    .join("\n");
}

// ---- shared ranking / identity helpers ------------------------------------
// Single copies of the severity ordering and the title identity key (previously
// duplicated across verify/backlog and compare/brainstorm).
export const SEV_ORDER: Record<string, number> = { P0: 0, P1: 1, P2: 2 };
export const titleKey = (title: string): string => title.toLowerCase().trim();

// The provenance one-liner (engine/protocol/rubric + short target SHA + dirty
// star). Shared by compare (COMPARE.md) and render (index.md/html); the two
// callers differ only in what an ABSENT provenance renders as — compare labels
// it "no provenance (legacy run)", render prints nothing.
export function provLine(p?: Provenance, emptyText = ""): string {
  return p
    ? `engine ${p.engineVersion} · protocol ${p.protocolVersion} · rubric ${p.rubricVersion}${p.targetGit ? ` · target ${p.targetGit.commit.slice(0, 7)}${p.targetGit.dirty ? "*" : ""}` : ""}`
    : emptyText;
}

// ---- opportunity ranking -------------------------------------------------
// value = impact / effort — a "quick win" (high/S) tops a "big bet" (high/L).
export function opportunityValue(impact?: Impact, effort?: Effort): number {
  const i = impact === "high" ? 3 : impact === "med" ? 2 : 1;
  const e = effort === "S" ? 1 : effort === "M" ? 2 : 3;
  return i / e;
}

// backlog priority band for an opportunity (never P0 — opportunities aren't defects)
export function opportunityPriority(impact?: Impact): "P1" | "P2" {
  return impact === "high" ? "P1" : "P2";
}
