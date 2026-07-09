import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { rejudgeRun } from "../src/rejudge.js";

const tmps: string[] = [];

function scaffold(): string {
  const root = mkdtempSync(join(tmpdir(), "ue-rejudge-"));
  tmps.push(root);
  const run = join(root, "run");
  mkdirSync(join(run, "research"), { recursive: true });
  mkdirSync(join(run, "runs"), { recursive: true });
  mkdirSync(join(run, "agents"), { recursive: true });
  writeFileSync(
    join(run, "eval.config.json"),
    JSON.stringify({
      target: "t",
      targetAbs: "/t",
      kind: "codebase",
      category: "library",
      dimensions: [{ id: "correctness", name: "Correctness", weight: 1, whatPerfectLooksLike: "x" }],
      version: "1.0.0",
    }),
  );
  writeFileSync(join(run, "dimensions.json"), "[]");
  writeFileSync(join(run, "findings.json"), JSON.stringify({ findings: [] }));
  writeFileSync(join(run, "RESULTS.md"), "# results\n");
  writeFileSync(join(run, "SUMMARY.md"), "# summary\n");
  writeFileSync(join(run, "TEST-PLAN.md"), "# plan\n");
  writeFileSync(join(run, "VERIFY.json"), "{}");
  writeFileSync(join(run, "judges.jsonl"), '{"lens":"old","dimensionScores":[]}\n');
  writeFileSync(join(run, "research", "correctness.md"), "# note\n");
  writeFileSync(join(run, "runs", "core.md"), "# core\n");
  writeFileSync(join(run, "agents", "judge.md"), "old contract\n");
  return run;
}

afterEach(() => {
  for (const t of tmps.splice(0)) rmSync(t, { recursive: true, force: true });
});

describe("rejudge — test-retest verdict stability scaffolding", () => {
  it("copies the judged artifacts, empties judges.jsonl and regenerates the judge contract + workflow", () => {
    const run = scaffold();
    const out = join(run, "..", "rejudge");
    rejudgeRun(run, out, "/abs/engine.mjs");
    for (const f of ["eval.config.json", "dimensions.json", "findings.json", "RESULTS.md", "SUMMARY.md", "TEST-PLAN.md", "VERIFY.json"]) {
      expect(existsSync(join(out, f)), f).toBe(true);
    }
    expect(existsSync(join(out, "research", "correctness.md"))).toBe(true);
    expect(existsSync(join(out, "runs", "core.md"))).toBe(true);
    expect(readFileSync(join(out, "judges.jsonl"), "utf8").trim()).toBe(""); // a FRESH panel re-judges
    const judge = readFileSync(join(out, "agents", "judge.md"), "utf8");
    expect(judge).not.toContain("old contract");
    expect(judge).toMatch(/calibration-run\.json/);
    expect(existsSync(join(out, "rejudge.workflow.mjs"))).toBe(true);
  });

  it("refuses a --run that is not an ultraeval run", () => {
    const root = mkdtempSync(join(tmpdir(), "ue-rejudge-"));
    tmps.push(root);
    expect(() => rejudgeRun(root, join(root, "out"), "/abs/engine.mjs")).toThrow(/eval\.config\.json/);
  });

  it("generates a loadable workflow that panels 3 judge lenses then scores", async () => {
    const run = scaffold();
    const out = join(run, "..", "rejudge");
    rejudgeRun(run, out, "/abs/engine.mjs");
    const calls: string[] = [];
    const g = globalThis as Record<string, unknown>;
    g.phase = (t: string) => calls.push(`phase:${t}`);
    g.log = () => {};
    g.agent = async () => {
      calls.push("agent");
      return "";
    };
    g.parallel = async (thunks: (() => Promise<unknown>)[]) => Promise.all(thunks.map((t) => t()));
    try {
      const mod = await import(pathToFileURL(join(out, "rejudge.workflow.mjs")).href);
      expect(mod.meta.name).toBe("ultraeval-rejudge");
      expect(calls).toContain("phase:Judge");
      expect(calls).toContain("phase:Score");
      expect(calls.filter((c) => c === "agent").length).toBe(4); // 3 lenses + 1 score step
    } finally {
      delete g.phase;
      delete g.log;
      delete g.agent;
      delete g.parallel;
    }
  });

  it("plain `node rejudge.workflow.mjs` exits 2 with launch guidance, not a raw ReferenceError", () => {
    const run = scaffold();
    const out = join(run, "..", "rejudge");
    rejudgeRun(run, out, "/abs/engine.mjs");
    const r = spawnSync("node", [join(out, "rejudge.workflow.mjs")], { encoding: "utf8" });
    const output = `${r.stdout}${r.stderr}`;
    expect(output).not.toMatch(/ReferenceError/); // no raw stack trace from an undefined harness global
    expect(output).not.toMatch(/SyntaxError/); // no illegal top-level return
    expect(r.status).toBe(2); // usage error, NOT 1 (gate-failed)
    expect(output).toMatch(/Workflow\(\{ scriptPath/); // names the correct launcher
  });
});
