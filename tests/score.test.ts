import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { appendHistory, computeScore, formatHistory, formatScore, readHistory, scoreRun } from "../src/score.js";
import type { EvalConfig } from "../src/types.js";

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

// The two dimensions the scaffold configures, fully scored — the shape every
// judge verdict owes the rubric.
const FULL = [
  { id: "security", score: 5 },
  { id: "correctness", score: 5 },
];
// The golden answers of skills/ultraeval/references/calibration-run.json
// (grounding 1±1, coverage 4±1, docs 2±1) — what a genuinely calibrated judge
// reports alongside passed: true.
const CALIBRATED = { scores: { grounding: 1, coverage: 4, docs: 2 }, passed: true };

describe("score — weighted scorecard from judges.jsonl", () => {
  it("averages each dimension across judges and weights to 0-100", () => {
    const run = scaffold([
      {
        dimensionScores: [
          { id: "security", score: 4 },
          { id: "correctness", score: 5 },
        ],
        meetsExpectations: true,
        calibration: CALIBRATED,
      },
      {
        dimensionScores: [
          { id: "security", score: 5 },
          { id: "correctness", score: 5 },
        ],
        meetsExpectations: true,
        calibration: CALIBRATED,
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
        calibration: CALIBRATED,
      },
    ]);
    const sc = scoreRun(run);
    expect(sc.overall).toBeLessThan(80);
    expect(sc.meetsExpectations).toBe(false);
  });

  it("writes scorecard.json", () => {
    const run = scaffold([{ dimensionScores: FULL, meetsExpectations: true, calibration: CALIBRATED }]);
    scoreRun(run);
    expect(existsSync(join(run, "scorecard.json"))).toBe(true);
  });

  it("stamps the scorecard with the run provenance and scoredAt when the config has it", () => {
    const run = scaffold([{ dimensionScores: FULL, meetsExpectations: true, calibration: CALIBRATED }]);
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
    const run = scaffold([{ dimensionScores: FULL, meetsExpectations: true, calibration: CALIBRATED }]);
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
        calibration: CALIBRATED,
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
    const run = scaffold([{ dimensionScores: FULL, meetsExpectations: true, calibration: CALIBRATED }]);
    expect(scoreRun(run).bar).toBe(80);
  });

  it("stamps judgesIndependent: false when every judge line shares one author", () => {
    const line = { dimensionScores: FULL, meetsExpectations: true, calibration: CALIBRATED };
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
    const line = { dimensionScores: FULL, meetsExpectations: true, calibration: CALIBRATED };
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
    const run = scaffold([{ dimensionScores: FULL, meetsExpectations: true, calibration: CALIBRATED }]);
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
        calibration: CALIBRATED,
      },
      {
        dimensionScores: [
          { id: "security", score: 5 },
          { id: "correctness", score: 5 },
        ],
        meetsExpectations: true,
        // the far edge of every tolerance band — still calibrated
        calibration: { scores: { grounding: 2, coverage: 3, docs: 3 }, passed: true },
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
        calibration: CALIBRATED,
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
        calibration: CALIBRATED,
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
    const run = scaffold([{ dimensionScores: FULL, meetsExpectations: true, calibration: CALIBRATED }]);
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
        calibration: CALIBRATED,
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
          calibration: CALIBRATED,
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
    const run = scaffold([{ dimensionScores: FULL, meetsExpectations: true, calibration: CALIBRATED }]);
    scoreRun(run);
    const file = join(run, "ledger.jsonl");
    appendHistory(run, file);
    const e = JSON.parse(readFileSync(file, "utf8").trim());
    expect(e.commit).toBeUndefined();
    expect("commit" in e).toBe(false);
  });

  it("history: creates the parent directory when seeding a fresh ledger", () => {
    const run = scaffold([{ dimensionScores: FULL, meetsExpectations: true, calibration: CALIBRATED }]);
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

  it("reports agreement as NA (undefined), not a false 1.0, for a single-judge panel (FIX-005)", () => {
    // Agreement is inter-judge — undefined for n=1. A lone judge has spread 0 on
    // every dimension, so the old formula reported 1.0 (reads as full consensus).
    const run = scaffold([
      {
        dimensionScores: [
          { id: "security", score: 5 },
          { id: "correctness", score: 5 },
        ],
        meetsExpectations: true,
        calibration: CALIBRATED,
      },
    ]);
    const sc = scoreRun(run);
    expect(sc.judges).toBe(1);
    expect(sc.agreement).toBeUndefined(); // NOT 1.0 — no consensus is possible with one judge
  });

  it("still reports a real agreement number for a genuine multi-judge panel (formula unchanged)", () => {
    const line = (sec: number) => ({
      dimensionScores: [
        { id: "security", score: sec },
        { id: "correctness", score: 5 },
      ],
      meetsExpectations: true,
    });
    const sc = scoreRun(scaffold([line(5), line(5)]));
    expect(sc.judges).toBe(2);
    expect(sc.agreement).toBe(1); // two agreeing judges DO have full consensus
  });

  it("formatHistory prints '—' for an absent agreement so a lone-judge run cannot masquerade as full consensus (FIX-005)", () => {
    const out = formatHistory(
      [
        {
          scoredAt: "2026-01-01T00:00:00.000Z",
          commit: "a".repeat(40),
          overall: 70,
          meetsExpectations: false,
          bar: 80,
          counts: { p0: 0, p1: 0, p2: 0, opps: 0 },
        },
      ],
      "/tmp/ledger.jsonl",
    );
    expect(out).toMatch(/agr —/);
  });
});

describe("history — reading and formatting the score-trend ledger (FIX-022)", () => {
  function ledger(entries: unknown[]): string {
    const run = mkdtempSync(join(tmpdir(), "ue-hist-"));
    tmps.push(run);
    const file = join(run, "history.jsonl");
    writeFileSync(file, entries.map((e) => JSON.stringify(e)).join("\n"));
    return file;
  }

  it("readHistory returns [] for a missing ledger (never throws)", () => {
    expect(readHistory(join(tmpdir(), `ue-nope-${Date.now()}.jsonl`))).toEqual([]);
  });

  it("readHistory parses one entry per non-blank line and skips malformed lines", () => {
    const file = ledger([
      { scoredAt: "2026-01-01T00:00:00.000Z", overall: 58, meetsExpectations: false, bar: 80, counts: { p0: 1, p1: 2, p2: 3, opps: 0 } },
      { scoredAt: "2026-01-02T00:00:00.000Z", overall: 81, meetsExpectations: true, bar: 80, counts: { p0: 0, p1: 1, p2: 2, opps: 1 } },
    ]);
    writeFileSync(file, `${readFileSync(file, "utf8")}\nnot json\n`); // a corrupt trailing line must not crash the reader
    const entries = readHistory(file);
    expect(entries.length).toBe(2);
    expect(entries[0]?.overall).toBe(58);
    expect(entries[1]?.overall).toBe(81);
  });

  it("formatHistory renders a compact trend with the per-run delta between consecutive entries", () => {
    const entries = [
      {
        scoredAt: "2026-01-01T00:00:00.000Z",
        commit: "a".repeat(40),
        overall: 58,
        meetsExpectations: false,
        bar: 80,
        agreement: 0.9,
        counts: { p0: 1, p1: 2, p2: 3, opps: 0 },
      },
      {
        scoredAt: "2026-01-02T00:00:00.000Z",
        commit: "b".repeat(40),
        overall: 81,
        meetsExpectations: true,
        bar: 80,
        agreement: 0.95,
        counts: { p0: 0, p1: 1, p2: 2, opps: 1 },
      },
    ];
    const out = formatHistory(entries, "/tmp/ledger.jsonl");
    expect(out).toMatch(/58/);
    expect(out).toMatch(/81/);
    expect(out).toMatch(/\+23/); // 81 - 58
    expect(out).toMatch(/MEETS/);
    expect(out).toMatch(/aaaaaaa/); // short commit sha
  });

  it("formatHistory warns when entries span different protocol/rubric versions", () => {
    const entries = [
      {
        scoredAt: "2026-01-01T00:00:00.000Z",
        overall: 70,
        meetsExpectations: false,
        bar: 80,
        counts: { p0: 0, p1: 0, p2: 0, opps: 0 },
        protocol: "1",
        rubric: "1",
      },
      {
        scoredAt: "2026-01-02T00:00:00.000Z",
        overall: 90,
        meetsExpectations: true,
        bar: 80,
        counts: { p0: 0, p1: 0, p2: 0, opps: 0 },
        protocol: "2",
        rubric: "1",
      },
    ];
    expect(formatHistory(entries, "/tmp/ledger.jsonl")).toMatch(/protocol|version|comparable/i);
  });

  it("appendHistory records the protocol/rubric versions from provenance so the trend can flag incomparable runs", () => {
    const run = scaffold([{ dimensionScores: FULL, meetsExpectations: true, calibration: CALIBRATED }]);
    const cfgPath = join(run, "eval.config.json");
    const cfg = JSON.parse(readFileSync(cfgPath, "utf8"));
    cfg.provenance = {
      engineVersion: "9.9.9",
      protocolVersion: "2",
      rubricVersion: "1",
      createdAt: "2026-01-01T00:00:00.000Z",
      mode: "audit",
      kind: "codebase",
      category: "library",
      dimensionsHash: "abc123def456",
    };
    writeFileSync(cfgPath, JSON.stringify(cfg));
    scoreRun(run);
    const file = join(run, "ledger.jsonl");
    appendHistory(run, file);
    const e = JSON.parse(readFileSync(file, "utf8").trim());
    expect(e.protocol).toBe("2");
    expect(e.rubric).toBe("1");
  });

  it("stamps oneshot on the scorecard and the ledger entry for a one-shot run", () => {
    const run = scaffold([{ dimensionScores: FULL, meetsExpectations: true, calibration: CALIBRATED }]);
    const cfgPath = join(run, "eval.config.json");
    const cfg = JSON.parse(readFileSync(cfgPath, "utf8"));
    cfg.oneshot = true;
    writeFileSync(cfgPath, JSON.stringify(cfg));
    const sc = scoreRun(run);
    expect(sc.oneshot).toBe(true);
    const file = join(run, "ledger.jsonl");
    appendHistory(run, file);
    const e = JSON.parse(readFileSync(file, "utf8").trim());
    expect(e.oneshot).toBe(true);
  });

  it("a full run stamps no oneshot marker anywhere", () => {
    const run = scaffold([{ dimensionScores: FULL, meetsExpectations: true, calibration: CALIBRATED }]);
    const sc = scoreRun(run);
    expect(sc.oneshot).toBeUndefined();
    const file = join(run, "ledger.jsonl");
    appendHistory(run, file);
    expect(JSON.parse(readFileSync(file, "utf8").trim()).oneshot).toBeUndefined();
  });
});

// Append a RAW (possibly torn) line to an existing judges.jsonl.
function appendRawJudge(run: string, line: string): void {
  const p = join(run, "judges.jsonl");
  writeFileSync(p, `${readFileSync(p, "utf8")}\n${line}\n`);
}

describe("score — judges.jsonl integrity (F1)", () => {
  it("rejects a malformed non-blank row naming the file and line, and writes no scorecard", () => {
    const run = scaffold([{ dimensionScores: FULL, meetsExpectations: true, calibration: CALIBRATED }]);
    appendRawJudge(run, JSON.stringify({ lens: "b", dimensionScores: FULL }).slice(0, 20)); // a torn write
    expect(() => scoreRun(run)).toThrow(/judges\.jsonl:2/);
    expect(existsSync(join(run, "scorecard.json"))).toBe(false); // nothing plausible written
  });

  it("a malformed DISSENTING judge is never silently dropped into a passing verdict", () => {
    const run = scaffold([{ dimensionScores: FULL, meetsExpectations: true, calibration: CALIBRATED }]);
    // The second line votes no but is truncated — dropping it flips the verdict.
    appendRawJudge(run, JSON.stringify({ lens: "skeptic", meetsExpectations: false, dimensionScores: FULL }).slice(0, -5));
    expect(() => scoreRun(run)).toThrow(/judges\.jsonl:2/);
    expect(existsSync(join(run, "scorecard.json"))).toBe(false);
  });

  it("rejects a score outside the 0-5 rubric range instead of emitting 2000/100 MEETS", () => {
    const run = scaffold([
      {
        dimensionScores: [
          { id: "security", score: 100 },
          { id: "correctness", score: 100 },
        ],
        meetsExpectations: true,
        calibration: CALIBRATED,
      },
    ]);
    expect(() => scoreRun(run)).toThrow(/0-5/);
    expect(existsSync(join(run, "scorecard.json"))).toBe(false);
  });

  it("rejects a negative score", () => {
    const run = scaffold([
      {
        dimensionScores: [
          { id: "security", score: -1 },
          { id: "correctness", score: 3 },
        ],
        meetsExpectations: true,
        calibration: CALIBRATED,
      },
    ]);
    expect(() => scoreRun(run)).toThrow(/0-5/);
  });

  it("rejects a non-numeric or non-finite score", () => {
    const strung = scaffold([
      {
        dimensionScores: [
          { id: "security", score: "5" },
          { id: "correctness", score: 5 },
        ],
        meetsExpectations: true,
        calibration: CALIBRATED,
      },
    ]);
    expect(() => scoreRun(strung)).toThrow(/score/i);
    const nulled = scaffold([
      {
        dimensionScores: [
          { id: "security", score: null },
          { id: "correctness", score: 5 },
        ],
        meetsExpectations: true,
        calibration: CALIBRATED,
      },
    ]);
    expect(() => scoreRun(nulled)).toThrow(/score/i);
  });

  it("rejects a dimension scored twice in one verdict (double-weighting one opinion)", () => {
    const run = scaffold([
      {
        dimensionScores: [
          { id: "security", score: 5 },
          { id: "security", score: 5 },
          { id: "correctness", score: 5 },
        ],
        meetsExpectations: true,
        calibration: CALIBRATED,
      },
    ]);
    expect(() => scoreRun(run)).toThrow(/security/);
    expect(existsSync(join(run, "scorecard.json"))).toBe(false);
  });

  it("rejects a dimension id outside the configured rubric", () => {
    const run = scaffold([{ dimensionScores: [...FULL, { id: "vibes", score: 5 }], meetsExpectations: true, calibration: CALIBRATED }]);
    expect(() => scoreRun(run)).toThrow(/vibes/);
  });

  it("rejects a verdict that leaves a configured dimension unscored", () => {
    const run = scaffold([{ dimensionScores: [{ id: "security", score: 5 }], meetsExpectations: true, calibration: CALIBRATED }]);
    expect(() => scoreRun(run)).toThrow(/correctness/);
  });

  it("accepts fractional in-range scores (a 4.5 is a legitimate verdict)", () => {
    const run = scaffold([
      {
        dimensionScores: [
          { id: "security", score: 4.5 },
          { id: "correctness", score: 0 },
        ],
        meetsExpectations: true,
        calibration: CALIBRATED,
      },
    ]);
    expect(scoreRun(run).dimensions.find((d) => d.id === "security")?.score).toBe(4.5);
  });

  it("keeps lens, author and rationale optional — a bare complete verdict still scores", () => {
    const bare = scaffold([{ dimensionScores: FULL, meetsExpectations: true, calibration: CALIBRATED }]);
    expect(scoreRun(bare).overall).toBe(100);
    const rich = scaffold([
      {
        lens: "security",
        author: "s1",
        dimensionScores: [
          { id: "security", score: 5, rationale: "read src/x.ts:1" },
          { id: "correctness", score: 5 },
        ],
        meetsExpectations: true,
        calibration: CALIBRATED,
      },
    ]);
    expect(scoreRun(rich).overall).toBe(100);
  });

  it("computeScore validates its own input so a direct consumer cannot bypass the rubric", () => {
    const run = scaffold([{ dimensionScores: FULL, meetsExpectations: true, calibration: CALIBRATED }]);
    const cfg = JSON.parse(readFileSync(join(run, "eval.config.json"), "utf8")) as EvalConfig;
    const bad = (scores: { id: string; score: number }[]) => () => computeScore(cfg, [{ dimensionScores: scores, meetsExpectations: true }], { findings: [] });
    expect(
      bad([
        { id: "security", score: 100 },
        { id: "correctness", score: 5 },
      ]),
    ).toThrow(/0-5/);
    expect(
      bad([
        { id: "security", score: 5 },
        { id: "security", score: 5 },
        { id: "correctness", score: 5 },
      ]),
    ).toThrow(/security/);
  });
});

describe("score — calibration is derived from the golden fixture, not trusted (F2)", () => {
  it("a judge whose fixture scores contradict the golden reference is NOT calibrated", () => {
    const run = scaffold([
      {
        dimensionScores: FULL,
        meetsExpectations: true,
        // grounding 5 (expected 1±1), coverage 0 (expected 4±1), docs 5 (expected 2±1)
        calibration: { scores: { grounding: 5, coverage: 0, docs: 5 }, passed: true },
      },
    ]);
    const sc = scoreRun(run);
    expect(sc.judgesCalibrated).toBe("0/1");
    expect(sc.meetsExpectations).toBe(false);
    expect(sc.reason).toMatch(/calibrat/i);
  });

  it("a complete in-tolerance fixture score set with passed:true is calibrated", () => {
    const run = scaffold([{ dimensionScores: FULL, meetsExpectations: true, calibration: CALIBRATED }]);
    const sc = scoreRun(run);
    expect(sc.judgesCalibrated).toBe("1/1");
    expect(sc.meetsExpectations).toBe(true);
  });

  it("tolerance is honoured: each score may sit one point either side of the expected value", () => {
    const run = scaffold([{ dimensionScores: FULL, meetsExpectations: true, calibration: { scores: { grounding: 2, coverage: 3, docs: 3 }, passed: true } }]);
    expect(scoreRun(run).judgesCalibrated).toBe("1/1");
  });

  it("a legacy passed:true with no fixture scores stays uncalibrated and vetoes the verdict", () => {
    const run = scaffold([{ dimensionScores: FULL, meetsExpectations: true, calibration: { passed: true } }]);
    const sc = scoreRun(run);
    expect(sc.judgesCalibrated).toBe("0/1");
    expect(sc.meetsExpectations).toBe(false);
    expect(sc.reason).toMatch(/calibrat/i);
  });

  it("partial, out-of-range or unpassed fixture scores count as uncalibrated — never a crash", () => {
    const partial = scaffold([{ dimensionScores: FULL, meetsExpectations: true, calibration: { scores: { grounding: 1 }, passed: true } }]);
    expect(scoreRun(partial).judgesCalibrated).toBe("0/1");
    const outOfRange = scaffold([
      { dimensionScores: FULL, meetsExpectations: true, calibration: { scores: { grounding: 9, coverage: 4, docs: 2 }, passed: true } },
    ]);
    expect(scoreRun(outOfRange).judgesCalibrated).toBe("0/1");
    // Correct fixture answers, but the judge reported a failed calibration: the
    // explicit flag still has to say passed.
    const unpassed = scaffold([{ dimensionScores: FULL, meetsExpectations: true, calibration: { scores: CALIBRATED.scores, passed: false } }]);
    expect(scoreRun(unpassed).judgesCalibrated).toBe("0/1");
  });

  it("keeps the golden reference in the engine in sync with the shipped calibration fixture", async () => {
    const { CALIBRATION_FIXTURE } = (await import("../src/types.js")) as unknown as {
      CALIBRATION_FIXTURE: { id: string; expected: number; tolerance: number }[];
    };
    const p = join(dirname(fileURLToPath(import.meta.url)), "..", "skills", "ultraeval", "references", "calibration-run.json");
    const shipped = JSON.parse(readFileSync(p, "utf8")) as { dimensions: { id: string; expected: number; tolerance: number }[] };
    expect(CALIBRATION_FIXTURE.map((d) => ({ id: d.id, expected: d.expected, tolerance: d.tolerance }))).toEqual(
      shipped.dimensions.map((d) => ({ id: d.id, expected: d.expected, tolerance: d.tolerance })),
    );
  });
});
