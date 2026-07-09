import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { checkRun } from "../src/check.js";

const tmps: string[] = [];

function scaffold(findings: unknown[], files: Record<string, string> = {}): string {
  const root = mkdtempSync(join(tmpdir(), "ue-check-"));
  tmps.push(root);
  const target = join(root, "target");
  mkdirSync(target, { recursive: true });
  writeFileSync(join(target, "app.js"), "line1\nline2\nline3\nline4\nline5\n"); // 5 lines
  const run = join(root, "run");
  mkdirSync(run, { recursive: true });
  writeFileSync(
    join(run, "eval.config.json"),
    JSON.stringify({ target: "target", targetAbs: target, kind: "codebase", category: "library", dimensions: [], version: "0.0.0" }),
  );
  writeFileSync(join(run, "findings.json"), JSON.stringify({ findings }));
  for (const [name, content] of Object.entries(files)) {
    const dest = join(run, name);
    mkdirSync(join(dest, ".."), { recursive: true });
    writeFileSync(dest, content);
  }
  return run;
}

afterEach(() => {
  for (const t of tmps.splice(0)) rmSync(t, { recursive: true, force: true });
});

const genuine = {
  id: "F1",
  severity: "P1",
  title: "SQLi",
  statement: "SQL built by string concatenation",
  evidence: [{ ref: "app.js:3" }],
  status: "confirmed",
};

describe("check — grounding gate", () => {
  it("passes when every finding cites a resolvable file:line", () => {
    expect(checkRun(scaffold([genuine])).ok).toBe(true);
  });

  it("fails when a cited line is out of range (hallucinated/stale)", () => {
    const r = checkRun(scaffold([{ ...genuine, evidence: [{ ref: "app.js:99" }] }]));
    expect(r.ok).toBe(false);
    expect(r.errors.join(" ")).toMatch(/out of range/);
  });

  it("fails when a cited file does not exist", () => {
    const r = checkRun(scaffold([{ ...genuine, evidence: [{ ref: "ghost.js:1" }] }]));
    expect(r.ok).toBe(false);
    expect(r.errors.join(" ")).toMatch(/not found/);
  });

  it("fails when a finding has no resolvable evidence", () => {
    const r = checkRun(scaffold([{ ...genuine, evidence: [{ ref: "url:https://example.com" }] }]));
    expect(r.ok).toBe(false);
    expect(r.errors.join(" ")).toMatch(/no resolvable evidence/);
  });

  it("accepts a file-scoped citation with no line number", () => {
    expect(checkRun(scaffold([{ ...genuine, evidence: [{ ref: "app.js" }] }])).ok).toBe(true);
  });

  it("resolves a run: artifact reference", () => {
    const run = scaffold([{ ...genuine, evidence: [{ ref: "run:runs/core.md#L1" }] }], { "runs/core.md": "the log line\nsecond line\n" });
    expect(checkRun(run).ok).toBe(true);
  });

  it("skips dismissed findings", () => {
    expect(checkRun(scaffold([{ ...genuine, status: "dismissed", evidence: [{ ref: "app.js:99" }] }])).ok).toBe(true);
  });

  it("fails a dangling [F#] in RESULTS.md", () => {
    const r = checkRun(scaffold([genuine], { "RESULTS.md": "# R\nThe finding about string concatenation is real and quite severe [F9].\n" }));
    expect(r.ok).toBe(false);
    expect(r.errors.join(" ")).toMatch(/F9/);
  });

  it("passes RESULTS.md when claims cite real findings", () => {
    expect(checkRun(scaffold([genuine], { "RESULTS.md": "# R\nThe SQL injection finding is confirmed and clearly exploitable here [F1].\n" })).ok).toBe(true);
  });

  it("--strict fails on an uncited substantive claim in RESULTS.md", () => {
    const r = checkRun(scaffold([genuine], { "RESULTS.md": "# R\nThis is a long uncited claim about the target with many words but no citation at all.\n" }), {
      strict: true,
    });
    expect(r.ok).toBe(false);
    expect(r.errors.join(" ")).toMatch(/coverage/);
  });

  it("--require-verify fails with no VERIFY.json", () => {
    expect(checkRun(scaffold([genuine]), { requireVerify: true }).ok).toBe(false);
  });

  it("--semantic fails when a non-dismissed finding was refuted", () => {
    const run = scaffold([genuine], {
      "VERIFY.json": JSON.stringify({
        ok: false,
        failures: ["F1"],
        adjudicated: 1,
        supported: 0,
        partial: 0,
        refuted: 1,
        unsupported: 0,
        unadjudicated: [],
        verdicts: [],
      }),
    });
    expect(checkRun(run, { semantic: true }).ok).toBe(false);
  });

  it("--min-findings enforces a floor", () => {
    expect(checkRun(scaffold([genuine]), { minFindings: 3 }).ok).toBe(false);
  });

  it("fails on an invalid severity (schema)", () => {
    const r = checkRun(scaffold([{ ...genuine, severity: "critical" }]));
    expect(r.ok).toBe(false);
    expect(r.errors.join(" ")).toMatch(/invalid severity/);
  });

  it("fails on a duplicate finding id (schema)", () => {
    const r = checkRun(scaffold([genuine, { ...genuine, evidence: [{ ref: "app.js:1" }] }]));
    expect(r.ok).toBe(false);
    expect(r.errors.join(" ")).toMatch(/duplicate/);
  });

  it("fails on an id that is not F<number> (schema)", () => {
    expect(checkRun(scaffold([{ ...genuine, id: "bug1" }])).ok).toBe(false);
  });

  it("warns (not fails) on a confirmed finding with no recommendation", () => {
    const r = checkRun(scaffold([genuine])); // genuine has no recommendation
    expect(r.ok).toBe(true);
    expect(r.warnings.join(" ")).toMatch(/no recommendation/);
  });

  it("passes a grounded opportunity carrying impact + effort", () => {
    const opp = {
      id: "F2",
      kind: "opportunity",
      severity: "P2",
      impact: "high",
      effort: "S",
      title: "Split the god file",
      statement: "app.js is large and would benefit from a split",
      evidence: [{ ref: "app.js:1" }],
      status: "confirmed",
      recommendation: "split it",
    };
    expect(checkRun(scaffold([opp])).ok).toBe(true);
  });

  it("fails an opportunity missing impact/effort", () => {
    const opp = {
      id: "F2",
      kind: "opportunity",
      severity: "P2",
      title: "x",
      statement: "y is worth improving",
      evidence: [{ ref: "app.js:1" }],
      status: "confirmed",
    };
    const r = checkRun(scaffold([opp]));
    expect(r.ok).toBe(false);
    expect(r.errors.join(" ")).toMatch(/impact/);
  });

  it("errors when eval.config.json is missing", () => {
    const root = mkdtempSync(join(tmpdir(), "ue-check-"));
    tmps.push(root);
    expect(checkRun(root).ok).toBe(false);
  });

  it("warns (never fails) on a legacy run whose config has no provenance", () => {
    const r = checkRun(scaffold([genuine]));
    expect(r.ok).toBe(true);
    expect(r.warnings.join(" ")).toMatch(/provenance/);
  });

  it("does not warn about provenance when the config records it", () => {
    const run = scaffold([genuine]);
    const cfgPath = join(run, "eval.config.json");
    const cfg = JSON.parse(readFileSync(cfgPath, "utf8"));
    cfg.provenance = {
      engineVersion: "1.0.0",
      protocolVersion: "1",
      rubricVersion: "1",
      createdAt: "2026-01-01T00:00:00.000Z",
      mode: "audit",
      kind: "codebase",
      category: "library",
      dimensionsHash: "abc123def456",
    };
    writeFileSync(cfgPath, JSON.stringify(cfg));
    const r = checkRun(run);
    expect(r.warnings.join(" ")).not.toMatch(/provenance/);
  });
});
