import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { checkRun } from "../src/check.js";
import { dimensionsHash } from "../src/init.js";

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

  it("resolves a run: artifact reference (but a run-only finding still needs a target anchor)", () => {
    const run = scaffold([{ ...genuine, evidence: [{ ref: "run:runs/core.md#L1" }] }], { "runs/core.md": "the log line\nsecond line\n" });
    const r = checkRun(run);
    expect(r.errors.join(" ")).not.toMatch(/cites run:/); // the ref itself resolves
    expect(r.errors.join(" ")).toMatch(/only in the run's own artifacts/); // laundering guard
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

  it("fails --require-verify when some findings are still unadjudicated (partial-adjudication bypass)", () => {
    const run = scaffold([genuine, { ...genuine, id: "F2", evidence: [{ ref: "app.js:2" }] }], {
      "VERIFY.json": JSON.stringify({
        ok: true,
        adjudicated: 1,
        supported: 1,
        partial: 0,
        refuted: 0,
        unsupported: 0,
        failures: [],
        unadjudicated: ["F2"],
        verdicts: [{ claimId: "F1", verdict: "supported" }],
      }),
    });
    const r = checkRun(run, { requireVerify: true });
    expect(r.ok).toBe(false);
    expect(r.errors.join(" ")).toMatch(/unadjudicated/);
  });

  it("diff scope: warns when a finding cites a file unchanged since provenance.sinceRef", () => {
    const run = scaffold([genuine, { ...genuine, id: "F2", evidence: [{ ref: "lib.js:1" }] }]);
    const cfgPath = join(run, "eval.config.json");
    const cfg = JSON.parse(readFileSync(cfgPath, "utf8"));
    const target = cfg.targetAbs;
    writeFileSync(join(target, "lib.js"), "libline1\n");
    const git = (args: string[]) => execFileSync("git", ["-C", target, "-c", "user.email=t@t", "-c", "user.name=t", ...args], { stdio: "ignore" });
    git(["init", "-q"]);
    git(["add", "."]);
    git(["commit", "-q", "-m", "base"]);
    writeFileSync(join(target, "app.js"), "line1\nline2\nline3 changed\nline4\nline5\n");
    git(["add", "."]);
    git(["commit", "-q", "-m", "change app.js"]);
    cfg.provenance = {
      engineVersion: "1.5.0",
      protocolVersion: "2",
      rubricVersion: "1",
      createdAt: "2026-07-09T00:00:00.000Z",
      mode: "audit",
      kind: "codebase",
      category: "library",
      dimensionsHash: "abc123def456",
      sinceRef: "HEAD~1",
    };
    writeFileSync(cfgPath, JSON.stringify(cfg));
    const r = checkRun(run);
    expect(r.ok).toBe(true); // warning, not error
    expect(r.warnings.join(" ")).toMatch(/F2.*unchanged since|outside the diff scope/i);
    expect(r.warnings.join(" ")).not.toMatch(/F1[^0-9].*unchanged|F1[^0-9].*diff scope/); // app.js changed — in scope
  });

  it("diff scope: --strict-scope promotes the out-of-scope citation to a hard failure (FIX-009)", () => {
    const run = scaffold([genuine, { ...genuine, id: "F2", evidence: [{ ref: "lib.js:1" }] }]);
    const cfgPath = join(run, "eval.config.json");
    const cfg = JSON.parse(readFileSync(cfgPath, "utf8"));
    const target = cfg.targetAbs;
    writeFileSync(join(target, "lib.js"), "libline1\n");
    const git = (args: string[]) => execFileSync("git", ["-C", target, "-c", "user.email=t@t", "-c", "user.name=t", ...args], { stdio: "ignore" });
    git(["init", "-q"]);
    git(["add", "."]);
    git(["commit", "-q", "-m", "base"]);
    writeFileSync(join(target, "app.js"), "line1\nline2\nline3 changed\nline4\nline5\n");
    git(["add", "."]);
    git(["commit", "-q", "-m", "change app.js"]);
    cfg.provenance = {
      engineVersion: "1.5.0",
      protocolVersion: "2",
      rubricVersion: "1",
      createdAt: "2026-07-09T00:00:00.000Z",
      mode: "audit",
      kind: "codebase",
      category: "library",
      dimensionsHash: "abc123def456",
      sinceRef: "HEAD~1",
    };
    writeFileSync(cfgPath, JSON.stringify(cfg));
    const r = checkRun(run, { strictScope: true });
    expect(r.ok).toBe(false); // opt-in: out-of-scope citation now fails the gate
    expect(r.errors.join(" ")).toMatch(/F2.*unchanged since|outside the diff scope/i);
    // In-scope finding must not be flagged, and it is an ERROR now, not a warning.
    expect(r.errors.join(" ")).not.toMatch(/F1[^0-9].*unchanged|F1[^0-9].*diff scope/);
    expect(r.warnings.join(" ")).not.toMatch(/F2.*outside the diff scope/i);
  });

  it("diff scope: --strict-scope on a non-diff run (no sinceRef) changes nothing (default behavior preserved)", () => {
    const r = checkRun(scaffold([genuine]), { strictScope: true });
    expect(r.ok).toBe(true);
  });

  it("warns when a BACKLOG task is done but its finding is still open", () => {
    const run = scaffold([{ ...genuine, status: "open" }], {
      "BACKLOG.json": JSON.stringify({
        target: "/t",
        generatedFrom: "r",
        tasks: [{ id: "FIX-001", findingId: "F1", status: "done", verifiedAt: "2026-07-09T00:00:00.000Z" }],
      }),
    });
    const r = checkRun(run);
    expect(r.warnings.join(" ")).toMatch(/done but finding/i);
  });

  it("warns (not fails) when runs/budget.md records cuts but SUMMARY.md does not mention them", () => {
    const run = scaffold([genuine], {
      "runs/budget.md": "# Budget coverage cuts\n- judges: 3 lenses -> 2\n",
      "SUMMARY.md": "# Summary\nEverything is fine [F1]\n",
    });
    const r = checkRun(run);
    expect(r.ok).toBe(true);
    expect(r.warnings.join(" ")).toMatch(/budget/i);
  });

  it("no budget warning when SUMMARY.md reports the cuts", () => {
    const run = scaffold([genuine], {
      "runs/budget.md": "# Budget coverage cuts\n- judges: 3 lenses -> 2\n",
      "SUMMARY.md": "# Summary\nBudget cuts: judges 3 -> 2 [M]\n",
    });
    expect(checkRun(run).warnings.join(" ")).not.toMatch(/budget/i);
  });

  it("fails --require-verify while a honeypot failure is unresolved", () => {
    const run = scaffold([genuine], {
      "VERIFY.json": JSON.stringify({
        ok: false,
        adjudicated: 1,
        supported: 1,
        partial: 0,
        refuted: 0,
        unsupported: 0,
        failures: [],
        unadjudicated: [],
        verdicts: [{ claimId: "F1", verdict: "supported" }],
        honeypots: { planted: 2, caught: 1, failed: ["F9"] },
      }),
    });
    const r = checkRun(run, { requireVerify: true });
    expect(r.ok).toBe(false);
    expect(r.errors.join(" ")).toMatch(/honeypot/i);
  });

  it("passes --require-verify when every finding is adjudicated", () => {
    const run = scaffold([genuine], {
      "VERIFY.json": JSON.stringify({
        ok: true,
        adjudicated: 1,
        supported: 1,
        partial: 0,
        refuted: 0,
        unsupported: 0,
        failures: [],
        unadjudicated: [],
        verdicts: [{ claimId: "F1", verdict: "supported" }],
      }),
    });
    expect(checkRun(run, { requireVerify: true }).ok).toBe(true);
  });

  it("fails a finding grounded only in the run's own artifacts (evidence-laundering guard)", () => {
    const run = scaffold([{ ...genuine, evidence: [{ ref: "run:runs/core.md#L1" }] }], { "runs/core.md": "scanner confirmed X\n" });
    const r = checkRun(run);
    expect(r.ok).toBe(false);
    expect(r.errors.join(" ")).toMatch(/only in the run's own artifacts/);
  });

  it("passes a finding that pairs a run: log with a target anchor", () => {
    const run = scaffold([{ ...genuine, evidence: [{ ref: "run:runs/core.md#L1" }, { ref: "app.js:3" }] }], { "runs/core.md": "scanner confirmed X\n" });
    expect(checkRun(run).ok).toBe(true);
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

  // Trustless ledger: the semantic/require-verify gate must RE-REDUCE the raw
  // verdict rows against the CURRENT findings, not trust VERIFY.json's stored
  // failures[]/unadjudicated[] (which an edit to findings.json — or a hand-edit
  // of the ledger — leaves stale). Two class fail-opens are probed here.
  it("STALE-LEDGER: fails --require-verify when a finding carries no verdict row even though stored unadjudicated[] is empty", () => {
    // F2 was added (or edited) AFTER verify --apply: the verdict rows only cover
    // F1, and the stored unadjudicated[] (computed before F2 existed) is empty.
    const run = scaffold([genuine, { ...genuine, id: "F2", evidence: [{ ref: "app.js:2" }] }], {
      "VERIFY.json": JSON.stringify({
        ok: true,
        adjudicated: 1,
        supported: 1,
        partial: 0,
        refuted: 0,
        unsupported: 0,
        failures: [],
        unadjudicated: [], // STALE — does not include the never-adjudicated F2
        verdicts: [{ claimId: "F1", verdict: "supported" }],
      }),
    });
    const r = checkRun(run, { requireVerify: true });
    expect(r.ok).toBe(false);
    expect(r.errors.join(" ")).toMatch(/unadjudicated/);
    expect(r.errors.join(" ")).toMatch(/F2/);
  });

  it("DELETED-VERDICT: --semantic re-derives a refuted finding from verdicts[] even when stored failures[] was scrubbed", () => {
    // The refuting verdict row survives in verdicts[] but was deleted from the
    // stored failures[] summary; a trustless gate must re-reduce and still fail.
    const run = scaffold([genuine], {
      "VERIFY.json": JSON.stringify({
        ok: true,
        adjudicated: 1,
        supported: 0,
        partial: 0,
        refuted: 1,
        unsupported: 0,
        failures: [], // SCRUBBED — F1 removed from the failure summary
        unadjudicated: [],
        verdicts: [{ claimId: "F1", verdict: "refuted" }],
      }),
    });
    const r = checkRun(run, { semantic: true });
    expect(r.ok).toBe(false);
    expect(r.errors.join(" ")).toMatch(/refuted|unsupported/);
    expect(r.errors.join(" ")).toMatch(/F1/);
  });
});

describe("check — dimensionsHash re-validation (FIX-009)", () => {
  const dims = [{ id: "correctness", name: "Correctness", weight: 1, whatPerfectLooksLike: "x" }];
  function stamp(run: string, dimensions: unknown[], hash: string): void {
    const cfgPath = join(run, "eval.config.json");
    const cfg = JSON.parse(readFileSync(cfgPath, "utf8"));
    cfg.dimensions = dimensions;
    cfg.provenance = {
      engineVersion: "1.0.0",
      protocolVersion: "1",
      rubricVersion: "1",
      createdAt: "2026-01-01T00:00:00.000Z",
      mode: "audit",
      kind: "codebase",
      category: "library",
      dimensionsHash: hash,
    };
    writeFileSync(cfgPath, JSON.stringify(cfg));
  }

  it("does not warn when the recorded hash matches the live dimensions", () => {
    const run = scaffold([genuine]);
    stamp(run, dims, dimensionsHash(dims));
    const r = checkRun(run);
    expect(r.ok).toBe(true);
    expect(r.warnings.join(" ")).not.toMatch(/dimensions changed since init/);
  });

  it("warns (never fails) when the dimensions were refined after init (hash mismatch)", () => {
    const run = scaffold([genuine]);
    const mutated = [...dims, { id: "extra", name: "Extra", weight: 1, whatPerfectLooksLike: "y" }];
    stamp(run, mutated, dimensionsHash(dims)); // hash recorded from the ORIGINAL dims
    const r = checkRun(run);
    expect(r.ok).toBe(true);
    expect(r.warnings.join(" ")).toMatch(/dimensions changed since init/);
  });

  it("does not warn or crash on a legacy run with no provenance/hash", () => {
    const r = checkRun(scaffold([genuine])); // scaffold stamps no provenance
    expect(r.ok).toBe(true);
    expect(r.warnings.join(" ")).not.toMatch(/dimensions changed since init/);
  });
});
