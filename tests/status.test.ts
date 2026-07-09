import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { formatStatus, statusRun } from "../src/status.js";

const tmps: string[] = [];

function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), "ue-status-"));
  tmps.push(d);
  return d;
}

function seed(run: string, artifacts: string[]): void {
  for (const a of artifacts) {
    const p = join(run, a);
    mkdirSync(join(p, ".."), { recursive: true });
    writeFileSync(p, a.endsWith(".jsonl") ? '{"lens":"a"}\n' : a.endsWith(".json") ? "{}" : "# x\n");
  }
}

afterEach(() => {
  for (const t of tmps.splice(0)) rmSync(t, { recursive: true, force: true });
});

describe("status — pipeline state + next command", () => {
  it("an uninitialized dir points at init", () => {
    const s = statusRun(tmp());
    expect(s.next).toMatch(/init/);
    expect(s.steps.find((x) => x.artifact === "eval.config.json")?.present).toBe(false);
  });

  it("config without a plan points at plan --run", () => {
    const run = tmp();
    seed(run, ["eval.config.json"]);
    expect(statusRun(run).next).toMatch(/plan --run/);
  });

  it("planned but unexecuted run points at launching the workflow", () => {
    const run = tmp();
    seed(run, ["eval.config.json", "agents/executor.md", "eval.workflow.mjs"]);
    expect(statusRun(run).next).toMatch(/workflow/i);
  });

  it("findings without verification point at check/verify, then judges, then score, then backlog", () => {
    const run = tmp();
    seed(run, ["eval.config.json", "agents/executor.md", "eval.workflow.mjs", "TEST-PLAN.md", "findings.json"]);
    expect(statusRun(run).next).toMatch(/verify/);
    seed(run, ["VERIFY.json"]);
    expect(statusRun(run).next).toMatch(/judge/i);
    seed(run, ["judges.jsonl"]);
    expect(statusRun(run).next).toMatch(/score --run/);
    seed(run, ["scorecard.json"]);
    expect(statusRun(run).next).toMatch(/backlog --run/);
    seed(run, ["BACKLOG.json"]);
    expect(statusRun(run).next).toMatch(/render|fix/);
  });

  it("formatStatus prints one line per artifact and the next hint", () => {
    const run = tmp();
    seed(run, ["eval.config.json"]);
    const out = formatStatus(statusRun(run), run);
    expect(out).toMatch(/eval\.config\.json/);
    expect(out).toMatch(/agents\//);
    expect(out).toMatch(/next:/);
  });
});
