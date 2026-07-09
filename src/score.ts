import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { MEETS_BAR } from "./types.js";
import type { EvalConfig, FindingsDoc, JudgeLine, Scorecard } from "./types.js";
import { exists, readJson, readText, writeJson } from "./util.js";

export function readJudges(runDir: string): JudgeLine[] {
  const p = join(runDir, "judges.jsonl");
  if (!exists(p)) return [];
  return readText(p)
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      try {
        return JSON.parse(l) as JudgeLine;
      } catch {
        return null;
      }
    })
    .filter((x): x is JudgeLine => x !== null);
}

export function computeScore(cfg: EvalConfig, judges: JudgeLine[], doc: FindingsDoc): Scorecard {
  const dims = cfg.dimensions ?? [];
  const dimensions = dims.map((d) => {
    const scores = judges.flatMap((j) => (j.dimensionScores ?? []).filter((s) => s.id === d.id).map((s) => s.score)).filter((n) => typeof n === "number");
    const avg = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
    // inter-judge dispersion: a consensual 3.0 and a 1-vs-5 split must not read the same
    const spread = scores.length > 1 ? Number((Math.max(...scores) - Math.min(...scores)).toFixed(2)) : 0;
    return { id: d.id, name: d.name, weight: d.weight, score: Number(avg.toFixed(2)), spread };
  });
  const totalWeight = dimensions.reduce((a, b) => a + b.weight, 0) || 1;
  const weighted = dimensions.reduce((a, b) => a + (b.score / 5) * b.weight, 0) / totalWeight;
  const overall = Math.round(weighted * 100);
  const bar = cfg.meetsBar ?? MEETS_BAR;
  const avgSpread = dimensions.length ? dimensions.reduce((a, b) => a + (b.spread ?? 0), 0) / dimensions.length : 0;
  const agreement = Number((1 - avgSpread / 5).toFixed(2));

  const liveP0 = (doc.findings ?? []).some((f) => f.status !== "dismissed" && f.kind !== "opportunity" && f.severity === "P0");
  const judgeSaysNo = judges.length > 0 && judges.some((j) => j.meetsExpectations === false);
  // Judge calibration (references/calibration-run.json): a panel with zero
  // passed calibrations cannot green-light the verdict — its scale is untrusted.
  const calibrated = judges.filter((j) => j.calibration?.passed === true).length;
  const judgesCalibrated = judges.length ? `${calibrated}/${judges.length}` : undefined;
  const calibrationVeto = judges.length > 0 && calibrated === 0;
  // Agreement assumes an independent panel: when every line carries the same
  // author, high agreement is self-consistency, not consensus — flag it.
  const authors = judges.map((j) => j.author).filter((a): a is string => typeof a === "string" && a.length > 0);
  const judgesIndependent = judges.length > 1 && authors.length === judges.length ? new Set(authors).size > 1 : undefined;
  const meetsBase = !liveP0 && !judgeSaysNo && !calibrationVeto;
  const meetsExpectations = meetsBase && overall >= bar;

  // Verdict stability: nudge each weight by ±0.05 (renormalized, like the real
  // scoring) and record every dimension whose nudge flips meetsExpectations.
  const overallWith = (dimId: string, delta: number): number => {
    const ws = dimensions.map((x) => ({ w: Math.max(0, x.weight + (x.id === dimId ? delta : 0)), s: x.score }));
    const tot = ws.reduce((a, b) => a + b.w, 0) || 1;
    return Math.round((ws.reduce((a, b) => a + (b.s / 5) * b.w, 0) / tot) * 100);
  };
  const flips = dimensions.filter((d) => [0.05, -0.05].some((delta) => (meetsBase && overallWith(d.id, delta) >= bar) !== meetsExpectations)).map((d) => d.id);
  const sensitivity = { robust: flips.length === 0, flips };
  const reason = liveP0
    ? "an unresolved P0 finding caps meets-expectations at false"
    : judgeSaysNo
      ? "a judge ruled it does not meet expectations"
      : calibrationVeto
        ? "no judge passed calibration — an uncalibrated panel cannot green-light the verdict"
        : overall < bar
          ? `weighted score ${overall} is below the ${bar} bar`
          : `no P0, judges agree, score ${overall} >= ${bar}`;
  return {
    overall,
    maxScore: 100,
    meetsExpectations,
    bar,
    dimensions,
    judges: judges.length,
    agreement,
    reason,
    sensitivity,
    ...(judgesCalibrated ? { judgesCalibrated } : {}),
    ...(judgesIndependent !== undefined ? { judgesIndependent } : {}),
  };
}

export function scoreRun(runDir: string): Scorecard {
  const cfg = readJson<EvalConfig>(join(runDir, "eval.config.json"));
  const doc = exists(join(runDir, "findings.json")) ? readJson<FindingsDoc>(join(runDir, "findings.json")) : { findings: [] };
  const judges = readJudges(runDir);
  // A 0-judge panel must never quietly become a plausible 0/100 scorecard.
  if (!judges.length) throw new Error("no judge verdicts in judges.jsonl — the Judge phase has not run; dispatch judges (agents/judge.md) first");
  const sc = computeScore(cfg, judges, doc);
  if (cfg.provenance) sc.provenance = cfg.provenance;
  sc.scoredAt = new Date().toISOString();
  writeJson(join(runDir, "scorecard.json"), sc);
  return sc;
}

// One committed JSONL line per scored run. Run directories are gitignored;
// the ledger is where the score trend (58 → 81 → …) survives the working tree.
export interface HistoryEntry {
  scoredAt: string;
  commit?: string;
  overall: number;
  meetsExpectations: boolean;
  bar: number;
  agreement?: number;
  counts: { p0: number; p1: number; p2: number; opps: number };
}

export function appendHistory(runDir: string, file: string): HistoryEntry {
  const scPath = join(runDir, "scorecard.json");
  if (!exists(scPath)) throw new Error("no scorecard.json — run `score --run <run>` first, then --history");
  const sc = readJson<Scorecard>(scPath);
  const doc = exists(join(runDir, "findings.json")) ? readJson<FindingsDoc>(join(runDir, "findings.json")) : { findings: [] };
  const live = (doc.findings ?? []).filter((f) => f.status !== "dismissed");
  const commit = sc.provenance?.targetGit?.commit;
  const entry: HistoryEntry = {
    scoredAt: sc.scoredAt ?? new Date().toISOString(),
    ...(commit ? { commit } : {}),
    overall: sc.overall,
    meetsExpectations: sc.meetsExpectations,
    bar: sc.bar,
    agreement: sc.agreement,
    counts: {
      p0: live.filter((f) => f.kind !== "opportunity" && f.severity === "P0").length,
      p1: live.filter((f) => f.kind !== "opportunity" && f.severity === "P1").length,
      p2: live.filter((f) => f.kind !== "opportunity" && f.severity === "P2").length,
      opps: live.filter((f) => f.kind === "opportunity").length,
    },
  };
  mkdirSync(dirname(file), { recursive: true });
  appendFileSync(file, `${JSON.stringify(entry)}\n`);
  return entry;
}

export function formatScore(sc: Scorecard): string {
  const head = `${sc.meetsExpectations ? "MEETS" : "BELOW"} expectations — ${sc.overall}/100 (${sc.judges} judge${sc.judges === 1 ? "" : "s"}${sc.judgesCalibrated ? `, ${sc.judgesCalibrated} calibrated` : ""})`;
  const lines = [head, ...sc.dimensions.map((d) => `  ${d.score.toFixed(1)}/5  ${d.name} (w=${d.weight})`), `  -> ${sc.reason}`];
  if (sc.sensitivity) {
    lines.push(
      sc.sensitivity.robust
        ? "  weights: verdict robust to ±0.05 shifts"
        : `  weights: verdict flips under a ±0.05 shift of ${sc.sensitivity.flips.join(", ")}`,
    );
  }
  if (sc.judgesIndependent === false) lines.push("  panel: single-author — agreement is self-consistency, not independence");
  if (sc.provenance) {
    const p = sc.provenance;
    const sha = p.targetGit ? ` · target ${p.targetGit.commit.slice(0, 7)}${p.targetGit.dirty ? "*" : ""}` : "";
    lines.push(`  engine ${p.engineVersion} · protocol ${p.protocolVersion} · rubric ${p.rubricVersion}${sha}`);
  }
  return lines.join("\n");
}
