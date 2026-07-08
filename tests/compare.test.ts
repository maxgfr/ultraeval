import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { compareRuns } from "../src/compare.js";

const tmps: string[] = [];

function runDir(findings: unknown[], overall?: number): string {
  const d = mkdtempSync(join(tmpdir(), "ue-cmp-"));
  tmps.push(d);
  writeFileSync(join(d, "findings.json"), JSON.stringify({ findings }));
  if (overall !== undefined) {
    writeFileSync(
      join(d, "scorecard.json"),
      JSON.stringify({ overall, maxScore: 100, meetsExpectations: overall >= 80, dimensions: [], judges: 1, reason: "x" }),
    );
  }
  return d;
}

afterEach(() => {
  for (const t of tmps.splice(0)) rmSync(t, { recursive: true, force: true });
});

const f = (title: string) => ({ id: "F1", severity: "P1", title, statement: "s", evidence: [{ ref: "a:1" }], status: "confirmed" });

describe("compare — two eval runs", () => {
  it("reports score delta, resolved and introduced findings", () => {
    const base = runDir([f("bug A"), f("bug B")], 70);
    const cur = runDir([f("bug B"), f("bug C")], 85);
    const r = compareRuns(base, cur);
    expect(r.scoreDelta).toBe(15);
    expect(r.resolved.map((x) => x.title)).toEqual(["bug A"]);
    expect(r.introduced.map((x) => x.title)).toEqual(["bug C"]);
  });

  it("score delta is null when a scorecard is missing", () => {
    expect(compareRuns(runDir([]), runDir([], 90)).scoreDelta).toBeNull();
  });
});
