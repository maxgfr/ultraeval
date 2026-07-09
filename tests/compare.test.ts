import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { compareRuns, gateFailures } from "../src/compare.js";

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

const f = (title: string, ref = "a:1") => ({ id: "F1", severity: "P1", title, statement: "s", evidence: [{ ref }], status: "confirmed" });

// biome-ignore lint/suspicious/noExplicitAny: test scaffolding
function withConfig(dir: string, dimensions: any[], provenance?: any): string {
  writeFileSync(
    join(dir, "eval.config.json"),
    JSON.stringify({
      target: "t",
      targetAbs: "/t",
      kind: "codebase",
      category: "library",
      dimensions,
      version: "1.0.0",
      ...(provenance ? { provenance } : {}),
    }),
  );
  return dir;
}

const dims = [{ id: "correctness", name: "Correctness", weight: 0.5, whatPerfectLooksLike: "x" }];
const prov = (over: Record<string, unknown> = {}) => ({
  engineVersion: "1.0.0",
  protocolVersion: "1",
  rubricVersion: "1",
  createdAt: "2026-01-01T00:00:00.000Z",
  mode: "audit",
  kind: "codebase",
  category: "library",
  dimensionsHash: "aaaaaaaaaaaa",
  targetGit: { commit: "a".repeat(40), dirty: false },
  ...over,
});

describe("compare — two eval runs", () => {
  it("reports score delta, resolved and introduced findings", () => {
    const base = runDir([f("bug A", "a:1"), f("bug B", "a:2")], 70);
    const cur = runDir([f("bug B", "a:2"), f("bug C", "a:3")], 85);
    const r = compareRuns(base, cur);
    expect(r.scoreDelta).toBe(15);
    expect(r.resolved.map((x) => x.title)).toEqual(["bug A"]);
    expect(r.introduced.map((x) => x.title)).toEqual(["bug C"]);
  });

  it("score delta is null when a scorecard is missing", () => {
    expect(compareRuns(runDir([]), runDir([], 90)).scoreDelta).toBeNull();
  });

  it("prints a stability line when both runs share the same target commit (test-retest)", () => {
    const base = withConfig(runDir([f("bug A")], 80), dims, prov());
    const cur = withConfig(runDir([f("bug A")], 84), dims, prov());
    const r = compareRuns(base, cur);
    expect(r.md).toMatch(/stability/i);
    expect(r.md).toMatch(/\|Δoverall\| = 4/);
  });

  it("prints no stability line when the target commits differ", () => {
    const base = withConfig(runDir([f("bug A")], 80), dims, prov());
    const cur = withConfig(runDir([f("bug A")], 84), dims, prov({ targetGit: { commit: "b".repeat(40), dirty: false } }));
    expect(compareRuns(base, cur).md).not.toMatch(/stability/i);
  });
});

describe("compare — evidence fingerprint matching", () => {
  it("a retitled finding with the same evidence files is reported as retitled, not resolved+introduced", () => {
    const base = runDir([{ ...f("SQL injection in /u"), evidence: [{ ref: "src/app.js:3" }, { ref: "run:runs/core.md#L2" }] }], 70);
    const cur = runDir([{ ...f("SQLi via req.query.id in /u"), evidence: [{ ref: "src/app.js:3" }] }], 75);
    const r = compareRuns(base, cur);
    expect(r.resolved).toEqual([]);
    expect(r.introduced).toEqual([]);
    expect(r.retitled.length).toBe(1);
    expect(r.retitled[0]?.from.title).toBe("SQL injection in /u");
    expect(r.retitled[0]?.to.title).toBe("SQLi via req.query.id in /u");
    expect(r.md).toMatch(/Retitled/);
  });

  it("different evidence files still count as resolved + introduced", () => {
    const base = runDir([{ ...f("bug A"), evidence: [{ ref: "src/a.js:1" }] }], 70);
    const cur = runDir([{ ...f("bug B"), evidence: [{ ref: "src/b.js:1" }] }], 75);
    const r = compareRuns(base, cur);
    expect(r.resolved.length).toBe(1);
    expect(r.introduced.length).toBe(1);
    expect(r.retitled).toEqual([]);
  });
});

describe("compare — CI regression gate", () => {
  it("gate fails when the score drops", () => {
    const base = runDir([f("a")], 80);
    const cur = runDir([f("a")], 70);
    const r = compareRuns(base, cur);
    expect(gateFailures(r).join(" ")).toMatch(/score/);
  });

  it("gate fails when a new P0 defect is introduced", () => {
    const base = runDir([], 80);
    const cur = runDir([{ ...f("new disaster"), severity: "P0" }], 85);
    const r = compareRuns(base, cur);
    expect(gateFailures(r).join(" ")).toMatch(/P0/);
  });

  it("gate passes on an improved run with no new P0", () => {
    const base = runDir([f("a")], 70);
    const cur = runDir([], 85);
    expect(gateFailures(compareRuns(base, cur))).toEqual([]);
  });
});

describe("compare — comparability & provenance", () => {
  it("warns that scores are not directly comparable when the rubrics differ", () => {
    const base = withConfig(runDir([f("a")], 70), dims);
    const cur = withConfig(runDir([f("a")], 85), [{ ...dims[0], weight: 0.9 }]);
    const r = compareRuns(base, cur);
    expect(r.warnings.join(" ")).toMatch(/not directly comparable/);
    expect(r.md).toMatch(/not directly comparable/);
  });

  it("warns when protocol or rubric versions differ between runs", () => {
    const base = withConfig(runDir([f("a")], 70), dims, prov());
    const cur = withConfig(runDir([f("a")], 85), dims, prov({ protocolVersion: "2" }));
    expect(compareRuns(base, cur).warnings.join(" ")).toMatch(/protocol/);
  });

  it("emits no comparability warning for identical rubric and versions", () => {
    const base = withConfig(runDir([f("a")], 70), dims, prov());
    const cur = withConfig(runDir([f("a")], 85), dims, prov());
    expect(compareRuns(base, cur).warnings).toEqual([]);
  });

  it("prints each side's provenance header in COMPARE.md", () => {
    const base = withConfig(runDir([f("a")], 70), dims, prov());
    const cur = withConfig(runDir([f("a")], 85), dims, prov());
    const r = compareRuns(base, cur);
    expect(r.md).toMatch(/engine 1\.0\.0 · protocol 1 · rubric 1 · target aaaaaaa/);
  });
});
