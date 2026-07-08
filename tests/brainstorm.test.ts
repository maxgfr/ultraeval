import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { rankBrainstorm, runBrainstorm } from "../src/brainstorm.js";

const tmps: string[] = [];

function run(opps: unknown[], findings: unknown[] = []): string {
  const dir = mkdtempSync(join(tmpdir(), "ue-bs-"));
  tmps.push(dir);
  writeFileSync(
    join(dir, "eval.config.json"),
    JSON.stringify({
      target: "t",
      targetAbs: "/t",
      kind: "codebase",
      category: "library",
      dimensions: [{ id: "correctness", name: "Correctness", weight: 1, whatPerfectLooksLike: "x" }],
      version: "0",
    }),
  );
  writeFileSync(join(dir, "findings.json"), JSON.stringify({ findings }));
  writeFileSync(join(dir, "opportunities.json"), JSON.stringify({ opportunities: opps }));
  return dir;
}

afterEach(() => {
  for (const t of tmps.splice(0)) rmSync(t, { recursive: true, force: true });
});

// biome-ignore lint/suspicious/noExplicitAny: test assertions on parsed JSON
type F = any;

describe("brainstorm — worklist + rank", () => {
  it("emits a divergent worklist with lenses", () => {
    const dir = run([]);
    expect(runBrainstorm(dir).lenses).toBeGreaterThan(4);
    expect(existsSync(join(dir, "BRAINSTORM.todo.md"))).toBe(true);
  });

  it("ranks by value and folds opportunities into findings as kind:opportunity", () => {
    const dir = run(
      [
        { title: "big bet", impact: "high", effort: "L", statement: "s", evidence: [{ ref: "a.ts:1" }] },
        { title: "quick win", impact: "high", effort: "S", statement: "s", evidence: [{ ref: "a.ts:1" }] },
      ],
      [{ id: "F1", severity: "P0", title: "bug", statement: "s", evidence: [{ ref: "a.ts:1" }], status: "confirmed" }],
    );
    const res = rankBrainstorm(dir);
    expect(res.added).toBe(2);
    const doc = JSON.parse(readFileSync(join(dir, "findings.json"), "utf8"));
    const opps = doc.findings.filter((f: F) => f.kind === "opportunity");
    expect(opps.length).toBe(2);
    expect(opps[0].title).toBe("quick win"); // value 3 > big bet value 1
    expect(opps[0].id).toBe("F2");
    expect(doc.findings.some((f: F) => f.id === "F1" && f.kind !== "opportunity")).toBe(true);
  });

  it("dedups an opportunity already present in findings", () => {
    const dir = run(
      [{ title: "Quick Win", impact: "high", effort: "S", statement: "s", evidence: [{ ref: "a.ts:1" }] }],
      [
        {
          id: "F2",
          kind: "opportunity",
          severity: "P1",
          impact: "high",
          effort: "S",
          title: "quick win",
          statement: "s",
          evidence: [{ ref: "a.ts:1" }],
          status: "confirmed",
        },
      ],
    );
    expect(rankBrainstorm(dir).added).toBe(0);
  });
});
