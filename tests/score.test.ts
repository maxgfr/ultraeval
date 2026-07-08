import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { scoreRun } from "../src/score.js";

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
      },
    ]);
    const sc = scoreRun(run);
    expect(sc.overall).toBeLessThan(80);
    expect(sc.meetsExpectations).toBe(false);
  });

  it("writes scorecard.json", () => {
    const run = scaffold([{ dimensionScores: [{ id: "security", score: 5 }], meetsExpectations: true }]);
    scoreRun(run);
    expect(existsSync(join(run, "scorecard.json"))).toBe(true);
  });
});
