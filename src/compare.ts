import { join } from "node:path";
import type { EvalConfig, Finding, FindingsDoc, Scorecard } from "./types.js";
import { exists, parseEvidenceRef, provLine, readJson, titleKey, writeText } from "./util.js";

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

// Findings are matched across runs by kind+title (ids differ between runs)…
const key = (f: Finding) => `${f.kind ?? "defect"}:${titleKey(f.title)}`;

// …with a secondary evidence fingerprint (kind + sorted target refs, line spec
// included) so a mere retitle is not miscounted as one resolved + one
// introduced. Line-level precision matters: two different findings often share
// a hotspot file; if lines shifted between runs the fingerprint just misses and
// degrades safely to resolved+introduced.
function targetRefOf(ref: string): string | null {
  const p = parseEvidenceRef(ref);
  // Keep the :line (pathWithLine) — line precision is what makes the fingerprint
  // distinguish two findings that share a hotspot file.
  return p.isTargetRef ? p.pathWithLine : null;
}
function fingerprint(f: Finding): string | null {
  const refs = [...new Set((f.evidence ?? []).map((e) => targetRefOf(e.ref)).filter((x): x is string => !!x))].sort();
  return refs.length ? `${f.kind ?? "defect"}:${refs.join(",")}` : null;
}

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
    // Profile mismatch is the one caveat --gate refuses outright (gateFailures
    // keys on this exact phrase): a single-pass indicative read cannot gate —
    // or be gated by — the normed full pipeline.
    if ((bp.profile ?? "full") !== (cp.profile ?? "full"))
      warnings.push("one-shot vs full-pipeline comparison — the two runs have different rigor; the delta is indicative only");
    if (JSON.stringify(bp.scope ?? []) !== JSON.stringify(cp.scope ?? []))
      warnings.push(
        `file scopes differ (${(bp.scope ?? []).join(", ") || "unscoped"} → ${(cp.scope ?? []).join(", ") || "unscoped"}) — the runs judged different subsets of the target`,
      );
  }
  return warnings;
}

export interface CompareResult {
  scoreDelta: number | null;
  resolved: Finding[]; // present-and-live in base, gone/dismissed in current
  introduced: Finding[]; // new in current
  retitled: { from: Finding; to: Finding }[]; // same evidence fingerprint, new title
  warnings: string[]; // comparability caveats — surface them with the delta
  md: string;
}

// The CI regression gate: a comparison fails when quality regressed.
export function gateFailures(r: CompareResult): string[] {
  const fails: string[] = [];
  // Ungateable pairing (comparabilityWarnings stamps this exact phrase): a
  // one-shot run and a full run measure with different rigor — refuse the gate.
  if (r.warnings.some((w) => w.includes("one-shot vs full-pipeline")))
    fails.push("one-shot vs full-pipeline comparison is not gateable — rerun both sides at the same rigor");
  if (r.scoreDelta !== null && r.scoreDelta < 0) fails.push(`score dropped by ${-r.scoreDelta}`);
  const p0 = r.introduced.filter((f) => f.kind !== "opportunity" && f.severity === "P0");
  if (p0.length) fails.push(`introduced P0 defect(s): ${p0.map((f) => f.title).join("; ")}`);
  // A finding escalated to P0 while keeping the same evidence fingerprint is
  // classified as a retitle, not an introduction — so inspect retitled pairs too,
  // or a P1→P0 upgrade at the same cited line would silently bypass the gate.
  const escalated = r.retitled.filter((p) => p.to.kind !== "opportunity" && p.to.severity === "P0" && p.from.severity !== "P0");
  if (escalated.length) fails.push(`escalated to P0 defect(s): ${escalated.map((p) => `${p.from.severity}→P0 ${p.to.title}`).join("; ")}`);
  return fails;
}

export function compareRuns(baseDir: string, newDir: string): CompareResult {
  const base = load(baseDir);
  const cur = load(newDir);
  const liveBase = base.findings.filter((f) => f.status !== "dismissed");
  const liveCur = cur.findings.filter((f) => f.status !== "dismissed");
  const baseKeys = new Set(liveBase.map(key));
  const curKeys = new Set(liveCur.map(key));
  let resolved = liveBase.filter((f) => !curKeys.has(key(f)));
  let introduced = liveCur.filter((f) => !baseKeys.has(key(f)));
  const retitled: { from: Finding; to: Finding }[] = [];
  const introducedLeft = [...introduced];
  const resolvedLeft: Finding[] = [];
  for (const f of resolved) {
    const fp = fingerprint(f);
    const match = fp ? introducedLeft.find((g) => fingerprint(g) === fp) : undefined;
    if (match) {
      retitled.push({ from: f, to: match });
      introducedLeft.splice(introducedLeft.indexOf(match), 1);
    } else resolvedLeft.push(f);
  }
  resolved = resolvedLeft;
  introduced = introducedLeft;
  const scoreDelta = base.score && cur.score ? cur.score.overall - base.score.overall : null;
  const warnings = comparabilityWarnings(base, cur);

  const line = (f: Finding) => `- ${f.kind === "opportunity" ? "opp" : f.severity} · ${f.title}`;
  const scoreLine =
    base.score && cur.score
      ? `Score: ${base.score.overall} → ${cur.score.overall} (${(scoreDelta ?? 0) >= 0 ? "+" : ""}${scoreDelta}) · meets-expectations ${base.score.meetsExpectations} → ${cur.score.meetsExpectations}`
      : "Score: (one or both runs have no scorecard.json)";
  const warningBlock = warnings.length ? `\n${warnings.map((w) => `> **⚠ ${w}**`).join("\n")}\n` : "";
  // Test-retest: at constant target commit the delta measures judge variance,
  // not target change — surface it as a stability reading.
  const baseCommit = base.cfg?.provenance?.targetGit?.commit;
  const curCommit = cur.cfg?.provenance?.targetGit?.commit;
  const stabilityLine =
    base.score && cur.score && baseCommit && curCommit && baseCommit === curCommit
      ? `\nStability (same target commit ${baseCommit.slice(0, 7)}): |Δoverall| = ${Math.abs(scoreDelta ?? 0)} · agreement ${base.score.agreement ?? "—"} → ${cur.score.agreement ?? "—"}`
      : "";
  const md = `# Comparison — base \`${baseDir}\` → current \`${newDir}\`

- base: ${provLine(base.cfg?.provenance, "no provenance (legacy run)")}
- current: ${provLine(cur.cfg?.provenance, "no provenance (legacy run)")}

${scoreLine}${stabilityLine}
${warningBlock}
## Resolved since base (${resolved.length})

${resolved.map(line).join("\n") || "- none"}

## Introduced in current (${introduced.length})

${introduced.map(line).join("\n") || "- none"}

## Retitled (same evidence, new title) (${retitled.length})

${retitled.map((p) => `- ${p.from.title} → ${p.to.title}`).join("\n") || "- none"}
`;
  return { scoreDelta, resolved, introduced, retitled, warnings, md };
}

export function runCompare(baseDir: string, newDir: string, outDir: string): CompareResult {
  const r = compareRuns(baseDir, newDir);
  writeText(join(outDir, "COMPARE.md"), r.md);
  return r;
}
