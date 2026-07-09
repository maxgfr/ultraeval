import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { appendHistory, formatScore, scoreRun } from "../src/score.js";

const tmps: string[] = [];

function scaffold(judges: unknown[], findings: unknown[] = []): string {
  const run = mkdtempSync(join(tmpdir(), "ue-score-"));
  tmps.push(run);
  writeFileSync(
    join(run, "eval.config.json"),
    JSON.stringify({
      target: "t",
      targetAbs: "/t",
      kind: "codebase",
      category: "library",
      dimensions: [
        { id: "security", name: "Security", weight: 0.6, whatPerfectLooksLike: "x" },
        { id: "correctness", name: "Correctness", weight: 0.4, whatPerfectLooksLike: "x" },
      ],
      version: "0.0.0",
    }),
  );
  writeFileSync(join(run, "findings.json"), JSON.stringify({ findings }));
  writeFileSync(join(run, "judges.jsonl"), judges.map((j) => JSON.stringify(j)).join("\n"));
  return run;
}

afterEach(() => {
  for (const t of tmps.splice(0)) rmSync(t, { recursive: true, force: true });
});

describe("score — weighted scorecard from judges.jsonl", () => {
  it("averages each dimension across judges and weights to 0-100", () => {
    const run = scaffold([
      {
        dimensionScores: [
          { id: "security", score: 4 },
          { id: "correctness", score: 5 },
        ],
        meetsExpectations: true,
        calibration: { passed: true },
      },
      {
        dimensionScores: [
          { id: "security", score: 5 },
          { id: "correctness", score: 5 },
        ],
        meetsExpectations: true,
        calibration: { passed: true },
      },
    ]);
    const sc = scoreRun(run);
    // security avg 4.5, correctness 5 → (4.5/5*.6 + 5/5*.4) = .54+.4 = .94 → 94
    expect(sc.overall).toBe(94);
    expect(sc.dimensions.find((d) => d.id === "security")?.score).toBe(4.5);
    expect(sc.meetsExpectations).toBe(true);
  });

  it("meets-expectations is false when a live P0 finding exists", () => {
    const run = scaffold(
      [
        {
          dimensionScores: [
            { id: "security", score: 5 },
            { id: "correctness", score: 5 },
          ],
          meetsExpectations: true,
        },
      ],
      [{ id: "F1", severity: "P0", status: "confirmed", title: "x", statement: "y", evidence: [{ ref: "a:1" }] }],
    );
    const sc = scoreRun(run);
    expect(sc.meetsExpectations).toBe(false);
    expect(sc.reason).toMatch(/P0/);
  });

  it("meets-expectations is false when a judge votes no", () => {
    const run = scaffold([
      {
        dimensionScores: [
          { id: "security", score: 5 },
          { id: "correctness", score: 5 },
        ],
        meetsExpectations: false,
      },
    ]);
    expect(scoreRun(run).meetsExpectations).toBe(false);
  });

  it("meets-expectations is false when the weighted score is below the bar", () => {
    const run = scaffold([
      {
        dimensionScores: [
          { id: "security", score: 2 },
          { id: "correctness", score: 3 },
        ],
        meetsExpectations: true,
        calibration: { passed: true },
      },
    ]);
    const sc = scoreRun(run);
    expect(sc.overall).toBeLessThan(80);
    expect(sc.meetsExpectations).toBe(false);
  });

  it("writes scorecard.json", () => {
    const run = scaffold([{ dimensionScores: [{ id: "security", score: 5 }], meetsExpectations: true, calibration: { passed: true } }]);
    scoreRun(run);
    expect(existsSync(join(run, "scorecard.json"))).toBe(true);
  });

  it("stamps the scorecard with the run provenance and scoredAt when the config has it", () => {
    const run = scaffold([{ dimensionScores: [{ id: "security", score: 5 }], meetsExpectations: true, calibration: { passed: true } }]);
    const cfgPath = join(run, "eval.config.json");
    const cfg = JSON.parse(readFileSync(cfgPath, "utf8"));
    cfg.provenance = {
      engineVersion: "9.9.9",
      protocolVersion: "1",
      rubricVersion: "1",
      createdAt: "2026-01-01T00:00:00.000Z",
      mode: "audit",
      kind: "codebase",
      category: "library",
      dimensionsHash: "abc123def456",
    };
    writeFileSync(cfgPath, JSON.stringify(cfg));
    const sc = scoreRun(run);
    expect(sc.provenance?.engineVersion).toBe("9.9.9");
    expect(Number.isNaN(Date.parse(sc.scoredAt ?? ""))).toBe(false);
  });

  it("a legacy config without provenance still scores and omits it from the scorecard", () => {
    const run = scaffold([{ dimensionScores: [{ id: "security", score: 5 }], meetsExpectations: true, calibration: { passed: true } }]);
    const sc = scoreRun(run);
    expect(sc.provenance).toBeUndefined();
    expect(sc.overall).toBeGreaterThan(0);
  });

  it("uses the config's meetsBar when present and records the applied bar", () => {
    const run = scaffold([
      {
        dimensionScores: [
          { id: "security", score: 4 },
          { id: "correctness", score: 3 },
        ],
        meetsExpectations: true,
        calibration: { passed: true },
      },
    ]);
    const cfgPath = join(run, "eval.config.json");
    const cfg = JSON.parse(readFileSync(cfgPath, "utf8"));
    cfg.meetsBar = 60;
    writeFileSync(cfgPath, JSON.stringify(cfg));
    const sc = scoreRun(run);
    expect(sc.overall).toBe(72); // (4/5*.6 + 3/5*.4) * 100
    expect(sc.bar).toBe(60);
    expect(sc.meetsExpectations).toBe(true); // 72 >= 60
  });

  it("defaults the bar to 80 and records it", () => {
    const run = scaffold([{ dimensionScores: [{ id: "security", score: 5 }], meetsExpectations: true, calibration: { passed: true } }]);
    expect(scoreRun(run).bar).toBe(80);
  });

  it("stamps judgesIndependent: false when every judge line shares one author", () => {
    const line = { dimensionScores: [{ id: "security", score: 5 }], meetsExpectations: true, calibration: { passed: true } };
    const run = scaffold([
      { ...line, lens: "a", author: "sess-1" },
      { ...line, lens: "b", author: "sess-1" },
      { ...line, lens: "c", author: "sess-1" },
    ]);
    const sc = scoreRun(run);
    expect(sc.judgesIndependent).toBe(false);
    expect(formatScore(sc)).toMatch(/single-author|independen/i);
  });

  it("judgesIndependent is true with distinct authors and unset when authors are absent", () => {
    const line = { dimensionScores: [{ id: "security", score: 5 }], meetsExpectations: true, calibration: { passed: true } };
    const distinct = scoreRun(
      scaffold([
        { ...line, author: "s1" },
        { ...line, author: "s2" },
      ]),
    );
    expect(distinct.judgesIndependent).toBe(true);
    const anonymous = scoreRun(scaffold([{ ...line }, { ...line }]));
    expect(anonymous.judgesIndependent).toBeUndefined();
  });

  it("refuses to score without judges — no judges.jsonl or an empty panel errors instead of a silent 0/100", () => {
    const run = scaffold([{ dimensionScores: [{ id: "security", score: 5 }], meetsExpectations: true, calibration: { passed: true } }]);
    rmSync(join(run, "judges.jsonl"));
    expect(() => scoreRun(run)).toThrow(/judges\.jsonl/);
    writeFileSync(join(run, "judges.jsonl"), "");
    expect(() => scoreRun(run)).toThrow(/judges\.jsonl/);
    expect(existsSync(join(run, "scorecard.json"))).toBe(false); // nothing plausible written
  });

  it("calibration: counts calibrated judges and keeps the verdict when some passed", () => {
    const run = scaffold([
      {
        dimensionScores: [
          { id: "security", score: 5 },
          { id: "correctness", score: 5 },
        ],
        meetsExpectations: true,
        calibration: { scores: { grounding: 1 }, passed: true },
      },
      {
        dimensionScores: [
          { id: "security", score: 5 },
          { id: "correctness", score: 5 },
        ],
        meetsExpectations: true,
        calibration: { scores: { grounding: 2 }, passed: true },
      },
      {
        dimensionScores: [
          { id: "security", score: 5 },
          { id: "correctness", score: 5 },
        ],
        meetsExpectations: true,
      },
    ]);
    const sc = scoreRun(run);
    expect(sc.judgesCalibrated).toBe("2/3");
    expect(sc.meetsExpectations).toBe(true);
  });

  it("calibration: a panel with zero calibrated judges forces meets-expectations false", () => {
    const run = scaffold([
      {
        dimensionScores: [
          { id: "security", score: 5 },
          { id: "correctness", score: 5 },
        ],
        meetsExpectations: true,
      },
      {
        dimensionScores: [
          { id: "security", score: 5 },
          { id: "correctness", score: 5 },
        ],
        meetsExpectations: true,
        calibration: { scores: { grounding: 5 }, passed: false },
      },
    ]);
    const sc = scoreRun(run);
    expect(sc.judgesCalibrated).toBe("0/2");
    expect(sc.meetsExpectations).toBe(false);
    expect(sc.reason).toMatch(/calibrat/i);
  });

  it("marks a comfortable verdict robust under ±0.05 weight shifts", () => {
    const run = scaffold([
      {
        dimensionScores: [
          { id: "security", score: 5 },
          { id: "correctness", score: 5 },
        ],
        meetsExpectations: true,
        calibration: { passed: true },
      },
    ]);
    const sc = scoreRun(run);
    expect(sc.sensitivity?.robust).toBe(true);
    expect(sc.sensitivity?.flips).toEqual([]);
  });

  it("flags dimensions whose ±0.05 weight shift flips a knife-edge verdict", () => {
    const run = scaffold([
      {
        dimensionScores: [
          { id: "security", score: 5 },
          { id: "correctness", score: 2.5 },
        ],
        meetsExpectations: true,
        calibration: { passed: true },
      },
    ]);
    const sc = scoreRun(run);
    expect(sc.overall).toBe(80); // exactly at the bar
    expect(sc.meetsExpectations).toBe(true);
    expect(sc.sensitivity?.robust).toBe(false);
    expect(sc.sensitivity?.flips).toContain("security");
    expect(sc.sensitivity?.flips).toContain("correctness");
  });

  it("computes sensitivity when weights do not sum to 1 (renormalized like the score)", () => {
    const run = scaffold([{ dimensionScores: [{ id: "security", score: 5 }], meetsExpectations: true, calibration: { passed: true } }]);
    const cfgPath = join(run, "eval.config.json");
    const cfg = JSON.parse(readFileSync(cfgPath, "utf8"));
    cfg.dimensions = [
      { id: "security", name: "Security", weight: 3, whatPerfectLooksLike: "x" },
      { id: "correctness", name: "Correctness", weight: 1, whatPerfectLooksLike: "x" },
    ];
    writeFileSync(cfgPath, JSON.stringify(cfg));
    const sc = scoreRun(run);
    expect(sc.sensitivity?.robust).toBe(true);
  });

  it("formatScore surfaces the weight-sensitivity verdict", () => {
    const run = scaffold([
      {
        dimensionScores: [
          { id: "security", score: 5 },
          { id: "correctness", score: 5 },
        ],
        meetsExpectations: true,
        calibration: { passed: true },
      },
    ]);
    expect(formatScore(scoreRun(run))).toMatch(/±0\.05/);
  });

  it("history: appends one JSONL entry per call with verdict, commit and counts", () => {
    const run = scaffold(
      [
        {
          dimensionScores: [
            { id: "security", score: 5 },
            { id: "correctness", score: 5 },
          ],
          meetsExpectations: true,
          calibration: { passed: true },
        },
      ],
      [
        { id: "F1", severity: "P1", status: "confirmed", title: "x", statement: "y", evidence: [{ ref: "a:1" }] },
        { id: "F2", kind: "opportunity", severity: "P2", impact: "high", effort: "S", title: "o", statement: "y", evidence: [{ ref: "a:1" }], status: "open" },
        { id: "F3", severity: "P2", status: "dismissed", title: "z", statement: "y", evidence: [{ ref: "a:1" }] },
      ],
    );
    const cfgPath = join(run, "eval.config.json");
    const cfg = JSON.parse(readFileSync(cfgPath, "utf8"));
    cfg.provenance = {
      engineVersion: "9.9.9",
      protocolVersion: "1",
      rubricVersion: "1",
      createdAt: "2026-01-01T00:00:00.000Z",
      mode: "deep",
      kind: "codebase",
      category: "library",
      dimensionsHash: "abc123def456",
      targetGit: { commit: "c".repeat(40), dirty: false },
    };
    writeFileSync(cfgPath, JSON.stringify(cfg));
    scoreRun(run);
    const file = join(run, "ledger.jsonl");
    appendHistory(run, file);
    appendHistory(run, file);
    const lines = readFileSync(file, "utf8").trim().split("\n");
    expect(lines.length).toBe(2);
    const e = JSON.parse(lines[0] ?? "{}");
    expect(e.overall).toBe(100);
    expect(e.meetsExpectations).toBe(true);
    expect(e.bar).toBe(80);
    expect(e.commit).toBe("c".repeat(40));
    expect(e.counts).toEqual({ p0: 0, p1: 1, p2: 0, opps: 1 });
    expect(Number.isNaN(Date.parse(e.scoredAt))).toBe(false);
  });

  it("history: omits the commit field on a run without provenance", () => {
    const run = scaffold([{ dimensionScores: [{ id: "security", score: 5 }], meetsExpectations: true, calibration: { passed: true } }]);
    scoreRun(run);
    const file = join(run, "ledger.jsonl");
    appendHistory(run, file);
    const e = JSON.parse(readFileSync(file, "utf8").trim());
    expect(e.commit).toBeUndefined();
    expect("commit" in e).toBe(false);
  });

  it("history: creates the parent directory when seeding a fresh ledger", () => {
    const run = scaffold([{ dimensionScores: [{ id: "security", score: 5 }], meetsExpectations: true, calibration: { passed: true } }]);
    scoreRun(run);
    const file = join(run, "evals", "history.jsonl");
    appendHistory(run, file);
    expect(existsSync(file)).toBe(true);
  });

  it("records per-dimension judge spread and an overall agreement index", () => {
    const run = scaffold([
      {
        dimensionScores: [
          { id: "security", score: 5 },
          { id: "correctness", score: 5 },
        ],
        meetsExpectations: true,
      },
      {
        dimensionScores: [
          { id: "security", score: 1 },
          { id: "correctness", score: 5 },
        ],
        meetsExpectations: true,
      },
    ]);
    const sc = scoreRun(run);
    expect(sc.dimensions.find((d) => d.id === "security")?.spread).toBe(4);
    expect(sc.dimensions.find((d) => d.id === "correctness")?.spread).toBe(0);
    expect(sc.agreement).toBeCloseTo(0.6, 2); // 1 - avgSpread/5 = 1 - 2/5
  });
});
