import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
  writeFileSync(join(target, "lib.js"), "libA\nres.send(user.bio)\nlibC\n");
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
const f2 = { id: "F2", severity: "P1", title: "XSS", statement: "user bio is sent without escaping", evidence: [{ ref: "lib.js:2" }], status: "confirmed" };

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

  it("--honeypots plants deterministic trap pairs and keeps the ground truth aside", () => {
    const run = scaffold([f1, f2]);
    const todo = runVerify(run, { honeypots: 2 });
    expect(todo.pairs.length).toBe(4); // 2 real + 2 planted
    const truth = JSON.parse(readFileSync(join(run, "VERIFY.honeypots.json"), "utf8"));
    expect(truth.claimIds.length).toBe(2);
    for (const id of truth.claimIds) {
      expect(["F1", "F2"]).not.toContain(id); // no collision with real finding ids
      const pair = todo.pairs.find((p) => p.claimId === id);
      expect(pair).toBeTruthy();
      // the trap pairs one finding's claim with ANOTHER finding's evidence
      const claimOwner = [f1, f2].find((f) => f.statement === pair?.claim);
      expect(claimOwner).toBeTruthy();
      expect(claimOwner?.evidence.map((e) => e.ref)).not.toContain(pair?.evidenceRef);
    }
    const again = runVerify(run, { honeypots: 2 });
    expect(JSON.stringify(again)).toBe(JSON.stringify(todo)); // seeded, not Math.random
  });

  it("apply: a complacent skeptic grading the traps supported is caught", () => {
    const run = scaffold([f1, f2]);
    const todo = runVerify(run, { honeypots: 2 });
    const all = todo.pairs.map((p) => ({ claimId: p.claimId, evidenceRef: p.evidenceRef, verdict: "supported" }));
    const r = applyVerdicts(run, verdicts(run, all));
    expect(r.honeypots?.planted).toBe(2);
    expect(r.honeypots?.caught).toBe(0);
    expect(r.honeypots?.failed.length).toBe(2);
    expect(r.ok).toBe(false);
  });

  it("apply: an honest skeptic who rejects the traps passes, findings unpolluted", () => {
    const run = scaffold([f1, f2]);
    const todo = runVerify(run, { honeypots: 2 });
    const truth = new Set(JSON.parse(readFileSync(join(run, "VERIFY.honeypots.json"), "utf8")).claimIds);
    const all = todo.pairs.map((p) => ({ claimId: p.claimId, evidenceRef: p.evidenceRef, verdict: truth.has(p.claimId) ? "unsupported" : "supported" }));
    const r = applyVerdicts(run, verdicts(run, all));
    expect(r.honeypots?.caught).toBe(2);
    expect(r.honeypots?.failed).toEqual([]);
    expect(r.ok).toBe(true);
    expect(r.failures).toEqual([]);
    expect(r.unadjudicated).toEqual([]);
    expect(r.adjudicated).toBe(2); // honeypot verdicts stay out of the findings ledger
  });

  it("never pairs a trap claim with the claim's own sibling evidence (cross-finding only)", () => {
    const fA = {
      id: "F1",
      severity: "P0",
      title: "SQLi",
      statement: "SQL built by string concatenation",
      evidence: [{ ref: "app.js:3" }, { ref: "lib.js:2" }],
      status: "confirmed",
    };
    const fB = { id: "F2", severity: "P1", title: "XSS", statement: "user bio is sent without escaping", evidence: [{ ref: "app.js:1" }], status: "confirmed" };
    const run = scaffold([fA, fB]);
    const todo = runVerify(run, { honeypots: 8 });
    const truth = new Set(JSON.parse(readFileSync(join(run, "VERIFY.honeypots.json"), "utf8")).claimIds);
    const own: Record<string, string[]> = {
      [fA.statement]: fA.evidence.map((e) => e.ref),
      [fB.statement]: fB.evidence.map((e) => e.ref),
    };
    for (const p of todo.pairs.filter((x) => truth.has(x.claimId))) {
      expect(own[p.claim], `trap ${p.claimId} reuses its own finding's evidence ${p.evidenceRef}`).not.toContain(p.evidenceRef);
    }
  });

  it("apply with a missing verdicts file errors actionably (no raw ENOENT)", () => {
    const run = scaffold([f1]);
    runVerify(run);
    expect(() => applyVerdicts(run, "/nope/verdicts.json")).toThrow(/verdicts file not found/);
  });

  it("apply without planted honeypots behaves exactly as before", () => {
    const run = scaffold([f1]);
    runVerify(run);
    const r = applyVerdicts(run, verdicts(run, [{ claimId: "F1", evidenceRef: "app.js:3", verdict: "supported" }]));
    expect(r.honeypots).toBeUndefined();
    expect(r.ok).toBe(true);
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
