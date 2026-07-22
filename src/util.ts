import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
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
  // Read outside the try so a missing-file error stays an ENOENT (not misreported
  // as a parse error). On a parse failure, name the offending file rather than
  // forwarding the raw V8 phrasing ("Expected property name … at position 2"),
  // which reaches the operator with a byte offset but no filename.
  const raw = readFileSync(p, "utf8");
  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new Error(`${basename(p)} is not valid JSON: ${p}`);
  }
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

// A per-invocation memo of `readFileSync(absPath).split("\n")` + the derived
// line count. A finding hotspot is routinely cited by many refs; without this
// each ref re-read and re-split the same file (gate time scaled as refs × file
// size). SCOPE IT PER checkRun/buildWorklist CALL — never process-lifetime:
// files may change between CLI invocations, so a run-scoped Map is safe but a
// global cache would serve stale content.
export type LineCache = Map<string, { count: number; lines: string[] }>;

function readFileCached(absPath: string, cache?: LineCache): { count: number; lines: string[] } {
  const hit = cache?.get(absPath);
  if (hit) return hit;
  const raw = readFileSync(absPath, "utf8");
  const lines = raw.split("\n");
  // A trailing newline does not add a line; "a\nb\n" is 2 lines. (Identical to
  // the previous lineCount logic — behavior-preserving.)
  const count = raw === "" ? 0 : raw.endsWith("\n") ? lines.length - 1 : lines.length;
  const entry = { count, lines };
  cache?.set(absPath, entry);
  return entry;
}

export interface ResolveOpts {
  targetAbs: string;
  runDir: string;
  // Optional per-invocation read cache; when present a file cited by K refs is
  // read once, not K times. Callers scope it to a single checkRun/buildWorklist.
  lineCache?: LineCache;
}

function parseLineSpec(spec: string): { start: number; end: number } | null {
  const m = spec.match(/^(\d+)(?:-(\d+))?$/);
  if (!m) return null;
  const start = Number(m[1]);
  const end = m[2] ? Number(m[2]) : start;
  return { start, end };
}

function lineCount(absPath: string, cache?: LineCache): number {
  return readFileCached(absPath, cache).count;
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
      const total = lineCount(absPath, opts.lineCache);
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
    const total = lineCount(absPath, opts.lineCache);
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
// Shares the per-invocation cache with resolveEvidence so the file a finding
// cites is read once, not once to range-check and again to extract context.
export function extractContext(absPath: string, start?: number, end?: number, pad = 2, cache?: LineCache): string {
  if (!existsSync(absPath)) return "";
  const { lines } = readFileCached(absPath, cache);
  if (start === undefined) return lines.slice(0, 12).join("\n");
  const from = Math.max(0, start - 1 - pad);
  const to = Math.min(lines.length, (end ?? start) + pad);
  return lines
    .slice(from, to)
    .map((l, i) => `${from + i + 1}: ${l}`)
    .join("\n");
}

// ---- canonical evidence-ref path parser ----------------------------------
// A finding cites evidence via a `ref` string ("path:line" | "path:start-end" |
// "run:relpath[#Lnn]" | "url:..." | "analysis:path[:line]"). Several call sites
// each re-derived "which file does this ref name" with subtly different regexes
// (verify honeypot pooling, backlog targets, compare fingerprints, check diff
// scope). This is the ONE source for that extraction. It does NOT touch the
// filesystem — resolveEvidence does the actual resolution/range-checking.
//
// The crude line strip (`/:\d/` + lastIndexOf) intentionally matches what those
// sites used, so the refactor is byte-for-byte behavior-preserving; the fields
// expose the three historical shapes callers need.
const stripLineSuffix = (s: string): string => (/:\d/.test(s) ? s.slice(0, s.lastIndexOf(":")) : s);

export interface ParsedEvidenceRef {
  kind: "run" | "url" | "analysis" | "path";
  gradeable: boolean; // checkable offline in principle — everything except url
  isTargetRef: boolean; // names a TARGET-repo path (path|analysis), not a run:/url: artifact
  path: string; // target file path with the :line suffix AND an `analysis:` prefix removed
  pathWithLine: string; // `analysis:` prefix removed but the :line KEPT (line-precise fingerprints)
  rawPath: string; // :line stripped, scheme left intact (whole-ref path key; verify honeypot pooling)
}

export function parseEvidenceRef(ref: string): ParsedEvidenceRef {
  const kind: ParsedEvidenceRef["kind"] = ref.startsWith("run:")
    ? "run"
    : ref.startsWith("url:") || /^https?:/.test(ref)
      ? "url"
      : ref.startsWith("analysis:")
        ? "analysis"
        : "path";
  const rawPath = stripLineSuffix(ref);
  return {
    kind,
    gradeable: kind !== "url",
    isTargetRef: kind === "path" || kind === "analysis",
    path: rawPath.replace(/^analysis:/, ""),
    pathWithLine: ref.replace(/^analysis:/, ""),
    rawPath,
  };
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

// ---- category detection ---------------------------------------------------
// The single category-matching ladder shared by the rubric picker
// (rubrics.defaultDimensions) and the live-scenario picker
// (templates.liveScenarioFor). Both used to carry a byte-identical 5-regex copy
// that had to be kept in sync by hand; this is the one source. Returns null for
// a category that matches no specialization — each caller supplies its own
// kind-based fallback (skill vs codebase). Order is significant and preserved.
export type CategoryKey = "security" | "requirements" | "business" | "research" | "web" | "cli";
export function categoryKey(category: string): CategoryKey | null {
  const cat = (category ?? "").toLowerCase();
  if (/secur|sast|vuln|taint|pentest|appsec/.test(cat)) return "security";
  if (/requirement|\bprd\b|\bsrd\b|\bspec\b|specification/.test(cat)) return "requirements";
  // Before research: a "domain documentation" category is a métier eval, not a
  // docs one — when the user names the business domain, that intent wins.
  if (/\bm[ée]tier\b|\bbusiness\b|\bdomain\b|\bddd\b/.test(cat)) return "business";
  if (/research|\brag\b|retrieval|search|documentation|\bq&a\b|\bqa\b/.test(cat)) return "research";
  if (/\bweb\b|frontend|browser|website|\bsite\b|web app|webapp/.test(cat)) return "web";
  if (/\bcli\b|command.?line|terminal/.test(cat)) return "cli";
  return null;
}

// ---- file-scope matching --------------------------------------------------
// A run may declare a file scope (eval.config.json `scope`: target-relative
// globs). Zero-dep minimal dialect — `**` crosses directories, `*` stays within
// one segment, `?` is one char, `{a,b}` alternates literals; a glob-free entry
// is a directory prefix (or exact file). Anything fancier (negation, nested
// braces) is deliberately unsupported.
const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const normPath = (p: string): string => p.replace(/\\/g, "/").replace(/^\.\//, "");

export function globToRegExp(glob: string): RegExp {
  const g = normPath(glob);
  let re = "";
  for (let i = 0; i < g.length; i++) {
    const c = g[i] as string;
    if (c === "*") {
      if (g[i + 1] === "*") {
        // `**` — swallow a following "/" so "a/**/b" also matches "a/b".
        i++;
        if (g[i + 1] === "/") {
          i++;
          re += "(?:[^/]+/)*";
        } else re += ".*";
      } else re += "[^/]*";
    } else if (c === "?") {
      re += "[^/]";
    } else if (c === "{") {
      const end = g.indexOf("}", i);
      if (end === -1) {
        re += "\\{";
      } else {
        re += `(?:${g
          .slice(i + 1, end)
          .split(",")
          .map(escapeRe)
          .join("|")})`;
        i = end;
      }
    } else re += escapeRe(c);
  }
  return new RegExp(`^${re}$`);
}

export function inScope(relPath: string, scope: string[]): boolean {
  if (!scope?.length) return true;
  const p = normPath(relPath);
  return scope.some((entry) => {
    const g = normPath(entry).replace(/\/+$/, "");
    if (!/[*?{]/.test(g)) return p === g || p.startsWith(`${g}/`);
    return globToRegExp(g).test(p);
  });
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
