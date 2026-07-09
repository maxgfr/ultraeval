import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { initRun } from "../src/init.js";
import { planRun } from "../src/plan.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BUNDLE = join(ROOT, "scripts", "ultraeval.mjs");
const FIX = join(ROOT, "tests", "fixtures");
const tmps: string[] = [];

function run(args: string[]): { status: number; out: string } {
  try {
    const stdout = execFileSync("node", [BUNDLE, ...args], { encoding: "utf8", cwd: ROOT });
    return { status: 0, out: stdout };
  } catch (e) {
    const err = e as { status?: number; stdout?: string; stderr?: string };
    return { status: err.status ?? 1, out: `${err.stdout ?? ""}${err.stderr ?? ""}` };
  }
}

function freshRun(): string {
  const out = mkdtempSync(join(tmpdir(), "ue-orch-"));
  tmps.push(out);
  initRun({ target: join(FIX, "target-lib"), out, kind: "codebase" });
  return out;
}

afterAll(() => {
  for (const t of tmps.splice(0)) rmSync(t, { recursive: true, force: true });
});

describe("orchestrate — the family alias for plan", () => {
  it("`orchestrate --run` behaves exactly like `plan --run` (workflow + contracts emitted)", () => {
    const out = freshRun();
    const r = run(["orchestrate", "--run", out]);
    expect(r.status).toBe(0);
    expect(existsSync(join(out, "eval.workflow.mjs"))).toBe(true);
    expect(existsSync(join(out, "agents", "researcher.md"))).toBe(true);
    expect(r.out).toContain("Workflow({ scriptPath");
  });

  it("`plan` keeps working unchanged (back-compat)", () => {
    const out = freshRun();
    expect(run(["plan", "--run", out]).status).toBe(0);
    expect(existsSync(join(out, "eval.workflow.mjs"))).toBe(true);
  });
});

describe("plan --eco — the sequential low-token path", () => {
  it("emits RUNBOOK.md + contracts but NO workflow script", () => {
    const out = freshRun();
    const written = planRun(out, "/engine.mjs", { eco: true });
    expect(existsSync(join(out, "RUNBOOK.md"))).toBe(true);
    expect(existsSync(join(out, "agents", "researcher.md"))).toBe(true);
    expect(existsSync(join(out, "eval.workflow.mjs"))).toBe(false);
    expect(written.some((w) => w.endsWith("RUNBOOK.md"))).toBe(true);
    expect(written.some((w) => w.endsWith("eval.workflow.mjs"))).toBe(false);
  });

  it("the runbook walks the SAME stage order as the workflow, pointing at each contract", () => {
    const out = freshRun();
    planRun(out, "/engine.mjs", { eco: true });
    const rb = readFileSync(join(out, "RUNBOOK.md"), "utf8");
    for (const stage of ["researcher", "testplan", "executor", "findings", "gate", "judge", "remediator"]) {
      expect(rb, `runbook must reference agents/${stage}.md`).toContain(`agents/${stage}.md`);
    }
    // Stage order preserved: research before testplan before execute before gate before judge.
    const idx = (s: string) => rb.indexOf(s);
    expect(idx("researcher.md")).toBeLessThan(idx("testplan.md"));
    expect(idx("testplan.md")).toBeLessThan(idx("executor.md"));
    expect(idx("executor.md")).toBeLessThan(idx("gate.md"));
    expect(idx("gate.md")).toBeLessThan(idx("judge.md"));
    expect(rb).toContain("/engine.mjs");
    expect(rb).toContain(out);
  });

  it("--eco works through the shipped bundle for both verbs", () => {
    const out = freshRun();
    const r = run(["orchestrate", "--run", out, "--eco"]);
    expect(r.status).toBe(0);
    expect(existsSync(join(out, "RUNBOOK.md"))).toBe(true);
    expect(existsSync(join(out, "eval.workflow.mjs"))).toBe(false);
    expect(r.out).toContain("RUNBOOK.md");
    expect(r.out).not.toContain("Workflow({ scriptPath");
  });

  it("non-eco plan does not write a runbook (unchanged default)", () => {
    const out = freshRun();
    planRun(out, "/engine.mjs");
    expect(existsSync(join(out, "RUNBOOK.md"))).toBe(false);
    expect(existsSync(join(out, "eval.workflow.mjs"))).toBe(true);
  });
});

describe("plan/eco counterpart reconciliation", () => {
  it("switching to --eco removes a previously emitted workflow (and vice versa)", () => {
    const out = freshRun();
    planRun(out, "/engine.mjs");
    expect(existsSync(join(out, "eval.workflow.mjs"))).toBe(true);
    planRun(out, "/engine.mjs", { eco: true });
    expect(existsSync(join(out, "RUNBOOK.md"))).toBe(true);
    expect(existsSync(join(out, "eval.workflow.mjs"))).toBe(false);
    planRun(out, "/engine.mjs");
    expect(existsSync(join(out, "eval.workflow.mjs"))).toBe(true);
    expect(existsSync(join(out, "RUNBOOK.md"))).toBe(false);
  });
});

describe("runbook mode parity beyond audit", () => {
  it("an improve-mode runbook drops executor/findings and keeps analyzer/brainstormer, same as the workflow", () => {
    const out = mkdtempSync(join(tmpdir(), "ue-orch-improve-"));
    tmps.push(out);
    initRun({ target: join(FIX, "target-lib"), out, kind: "codebase", mode: "improve" });
    planRun(out, "/engine.mjs", { eco: true });
    const rb = readFileSync(join(out, "RUNBOOK.md"), "utf8");
    expect(rb).not.toContain("executor.md");
    expect(rb).not.toContain("findings.md");
    expect(rb).toContain("analyzer.md");
    expect(rb).toContain("brainstormer.md");
    const idx = (s: string) => rb.indexOf(s);
    expect(idx("analyzer.md")).toBeLessThan(idx("brainstormer.md"));
    expect(idx("brainstormer.md")).toBeLessThan(idx("gate.md"));
  });
});
