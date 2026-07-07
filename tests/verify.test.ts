import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { applyVerdicts, reduceVerdicts, runVerify } from "../src/verify.js";

const tmps: string[] = [];

function scaffold(findings: unknown[]): string {
  const root = mkdtempSync(join(tmpdir(), "ue-verify-"));
  tmps.push(root);
  const target = join(root, "target");
  mkdirSync(target, { recursive: true });
  writeFileSync(join(target, "app.js"), "line1\nline2\nSQL = 'select ' + id\nline4\nline5\n");
  const run = join(root, "run");
  mkdirSync(run, { recursive: true });
  writeFileSync(
    join(run, "eval.config.json"),
    JSON.stringify({ target: "target", targetAbs: target, kind: "codebase", category: "library", dimensions: [], version: "0.0.0" }),
  );
  writeFileSync(join(run, "findings.json"), JSON.stringify({ findings }));
  return run;
}
function verdicts(run: string, items: unknown[]): string {
  const p = join(run, "verdicts.json");
  writeFileSync(p, JSON.stringify({ pairs: items }));
  return p;
}
afterEach(() => {
  for (const t of tmps.splice(0)) rmSync(t, { recursive: true, force: true });
});

const f1 = { id: "F1", severity: "P0", title: "SQLi", statement: "SQL built by string concatenation", evidence: [{ ref: "app.js:3" }], status: "confirmed" };

describe("verify — worklist + reduce", () => {
  it("emits one pair per gradeable evidence, with a source digest", () => {
    const run = scaffold([f1]);
    const todo = runVerify(run);
    expect(todo.pairs.length).toBe(1);
    expect(todo.pairs[0]?.claimId).toBe("F1");
    expect(todo.pairs[0]?.digest).toMatch(/SQL = 'select/);
  });

  it("excludes dismissed findings from the worklist", () => {
    const run = scaffold([{ ...f1, status: "dismissed" }]);
    expect(runVerify(run).pairs.length).toBe(0);
  });

  it("apply: a refuted verdict makes the finding fail (exit gate)", () => {
    const run = scaffold([f1]);
    runVerify(run);
    const r = applyVerdicts(run, verdicts(run, [{ claimId: "F1", evidenceRef: "app.js:3", verdict: "refuted" }]));
    expect(r.ok).toBe(false);
    expect(r.failures).toContain("F1");
  });

  it("apply: a supported verdict passes", () => {
    const run = scaffold([f1]);
    runVerify(run);
    const r = applyVerdicts(run, verdicts(run, [{ claimId: "F1", evidenceRef: "app.js:3", verdict: "supported" }]));
    expect(r.ok).toBe(true);
    expect(r.supported).toBe(1);
  });

  it("reduce: all-unsupported evidence fails the finding", () => {
    const r = reduceVerdicts([{ claimId: "F1", verdict: "unsupported" }], [f1] as never);
    expect(r.ok).toBe(false);
    expect(r.failures).toContain("F1");
  });

  it("reduce: an invalid verdict token is ignored (cannot false-green)", () => {
    const r = reduceVerdicts([{ claimId: "F1", verdict: "totally-fine" } as never], [f1] as never);
    expect(r.adjudicated).toBe(0);
    expect(r.unadjudicated).toContain("F1");
  });
});
