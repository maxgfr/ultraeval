import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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

  it("errors when eval.config.json is missing", () => {
    const root = mkdtempSync(join(tmpdir(), "ue-check-"));
    tmps.push(root);
    expect(checkRun(root).ok).toBe(false);
  });
});
