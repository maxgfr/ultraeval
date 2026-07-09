import { join } from "node:path";
import type { EvalConfig, Finding, FindingsDoc, Provenance, Scorecard } from "./types.js";
import { exists, readJson, writeText } from "./util.js";

interface Side {
  findings: Finding[];
  score: Scorecard | null;
  cfg: EvalConfig | null;
}

function load(dir: string): Side {
  const findings = exists(join(dir, "findings.json")) ? (readJson<FindingsDoc>(join(dir, "findings.json")).findings ?? []) : [];
  const score = exists(join(dir, "scorecard.json")) ? readJson<Scorecard>(join(dir, "scorecard.json")) : null;
  const cfg = exists(join(dir, "eval.config.json")) ? readJson<EvalConfig>(join(dir, "eval.config.json")) : null;
  return { findings, score, cfg };
}

// Findings are matched across runs by kind+title (ids differ between runs).
const key = (f: Finding) => `${f.kind ?? "defect"}:${f.title.toLowerCase().trim()}`;

const provLine = (p?: Provenance): string =>
  p
    ? `engine ${p.engineVersion} · protocol ${p.protocolVersion} · rubric ${p.rubricVersion}${p.targetGit ? ` · target ${p.targetGit.commit.slice(0, 7)}${p.targetGit.dirty ? "*" : ""}` : ""}`
    : "no provenance (legacy run)";

// A score delta only means something when both runs were scored the same way.
function comparabilityWarnings(base: Side, cur: Side): string[] {
  const warnings: string[] = [];
  if (!base.cfg || !cur.cfg) return warnings; // legacy side — nothing to compare against
  const rubric = (cfg: EvalConfig) => JSON.stringify((cfg.dimensions ?? []).map((d) => [d.id, d.weight]));
  if (rubric(base.cfg) !== rubric(cur.cfg)) warnings.push("rubrics differ (dimension ids/weights) — scores are not directly comparable");
  const bp = base.cfg.provenance;
  const cp = cur.cfg.provenance;
  if (bp && cp) {
    if (bp.protocolVersion !== cp.protocolVersion)
      warnings.push(`protocol versions differ (${bp.protocolVersion} → ${cp.protocolVersion}) — score delta is not comparable across protocol versions`);
    if (bp.rubricVersion !== cp.rubricVersion)
      warnings.push(`rubric versions differ (${bp.rubricVersion} → ${cp.rubricVersion}) — score delta is not comparable across rubric versions`);
  }
  return warnings;
}

export interface CompareResult {
  scoreDelta: number | null;
  resolved: Finding[]; // present-and-live in base, gone/dismissed in current
  introduced: Finding[]; // new in current
  warnings: string[]; // comparability caveats — surface them with the delta
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
  const warnings = comparabilityWarnings(base, cur);

  const line = (f: Finding) => `- ${f.kind === "opportunity" ? "opp" : f.severity} · ${f.title}`;
  const scoreLine =
    base.score && cur.score
      ? `Score: ${base.score.overall} → ${cur.score.overall} (${(scoreDelta ?? 0) >= 0 ? "+" : ""}${scoreDelta}) · meets-expectations ${base.score.meetsExpectations} → ${cur.score.meetsExpectations}`
      : "Score: (one or both runs have no scorecard.json)";
  const warningBlock = warnings.length ? `\n${warnings.map((w) => `> **⚠ ${w}**`).join("\n")}\n` : "";
  const md = `# Comparison — base \`${baseDir}\` → current \`${newDir}\`

- base: ${provLine(base.cfg?.provenance)}
- current: ${provLine(cur.cfg?.provenance)}

${scoreLine}
${warningBlock}
## Resolved since base (${resolved.length})

${resolved.map(line).join("\n") || "- none"}

## Introduced in current (${introduced.length})

${introduced.map(line).join("\n") || "- none"}
`;
  return { scoreDelta, resolved, introduced, warnings, md };
}

export function runCompare(baseDir: string, newDir: string, outDir: string): CompareResult {
  const r = compareRuns(baseDir, newDir);
  writeText(join(outDir, "COMPARE.md"), r.md);
  return r;
}
