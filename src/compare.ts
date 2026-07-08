import { join } from "node:path";
import type { Finding, FindingsDoc, Scorecard } from "./types.js";
import { exists, readJson, writeText } from "./util.js";

interface Side {
  findings: Finding[];
  score: Scorecard | null;
}

function load(dir: string): Side {
  const findings = exists(join(dir, "findings.json")) ? (readJson<FindingsDoc>(join(dir, "findings.json")).findings ?? []) : [];
  const score = exists(join(dir, "scorecard.json")) ? readJson<Scorecard>(join(dir, "scorecard.json")) : null;
  return { findings, score };
}

// Findings are matched across runs by kind+title (ids differ between runs).
const key = (f: Finding) => `${f.kind ?? "defect"}:${f.title.toLowerCase().trim()}`;

export interface CompareResult {
  scoreDelta: number | null;
  resolved: Finding[]; // present-and-live in base, gone/dismissed in current
  introduced: Finding[]; // new in current
  md: string;
}

export function compareRuns(baseDir: string, newDir: string): CompareResult {
  const base = load(baseDir);
  const cur = load(newDir);
  const liveBase = base.findings.filter((f) => f.status !== "dismissed");
  const liveCur = cur.findings.filter((f) => f.status !== "dismissed");
  const baseKeys = new Set(liveBase.map(key));
  const curKeys = new Set(liveCur.map(key));
  const resolved = liveBase.filter((f) => !curKeys.has(key(f)));
  const introduced = liveCur.filter((f) => !baseKeys.has(key(f)));
  const scoreDelta = base.score && cur.score ? cur.score.overall - base.score.overall : null;

  const line = (f: Finding) => `- ${f.kind === "opportunity" ? "opp" : f.severity} · ${f.title}`;
  const scoreLine =
    base.score && cur.score
      ? `Score: ${base.score.overall} → ${cur.score.overall} (${(scoreDelta ?? 0) >= 0 ? "+" : ""}${scoreDelta}) · meets-expectations ${base.score.meetsExpectations} → ${cur.score.meetsExpectations}`
      : "Score: (one or both runs have no scorecard.json)";
  const md = `# Comparison — base \`${baseDir}\` → current \`${newDir}\`

${scoreLine}

## Resolved since base (${resolved.length})

${resolved.map(line).join("\n") || "- none"}

## Introduced in current (${introduced.length})

${introduced.map(line).join("\n") || "- none"}
`;
  return { scoreDelta, resolved, introduced, md };
}

export function runCompare(baseDir: string, newDir: string, outDir: string): CompareResult {
  const r = compareRuns(baseDir, newDir);
  writeText(join(outDir, "COMPARE.md"), r.md);
  return r;
}
