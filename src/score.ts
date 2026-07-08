import { join } from "node:path";
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
    return { id: d.id, name: d.name, weight: d.weight, score: Number(avg.toFixed(2)) };
  });
  const totalWeight = dimensions.reduce((a, b) => a + b.weight, 0) || 1;
  const weighted = dimensions.reduce((a, b) => a + (b.score / 5) * b.weight, 0) / totalWeight;
  const overall = Math.round(weighted * 100);

  const liveP0 = (doc.findings ?? []).some((f) => f.status !== "dismissed" && f.severity === "P0");
  const judgeSaysNo = judges.length > 0 && judges.some((j) => j.meetsExpectations === false);
  const meetsExpectations = !liveP0 && !judgeSaysNo && overall >= MEETS_BAR;
  const reason = liveP0
    ? "an unresolved P0 finding caps meets-expectations at false"
    : judgeSaysNo
      ? "a judge ruled it does not meet expectations"
      : overall < MEETS_BAR
        ? `weighted score ${overall} is below the ${MEETS_BAR} bar`
        : `no P0, judges agree, score ${overall} >= ${MEETS_BAR}`;
  return { overall, maxScore: 100, meetsExpectations, dimensions, judges: judges.length, reason };
}

export function scoreRun(runDir: string): Scorecard {
  const cfg = readJson<EvalConfig>(join(runDir, "eval.config.json"));
  const doc = exists(join(runDir, "findings.json")) ? readJson<FindingsDoc>(join(runDir, "findings.json")) : { findings: [] };
  const sc = computeScore(cfg, readJudges(runDir), doc);
  writeJson(join(runDir, "scorecard.json"), sc);
  return sc;
}

export function formatScore(sc: Scorecard): string {
  const head = `${sc.meetsExpectations ? "MEETS" : "BELOW"} expectations — ${sc.overall}/100 (${sc.judges} judge${sc.judges === 1 ? "" : "s"})`;
  return [head, ...sc.dimensions.map((d) => `  ${d.score.toFixed(1)}/5  ${d.name} (w=${d.weight})`), `  -> ${sc.reason}`].join("\n");
}
