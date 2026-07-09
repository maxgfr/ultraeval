import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { emitFixAgents, verifyFix } from "../src/fix.js";

const tmps: string[] = [];

function scaffold(opts: { verifyCommand?: string; redTestFile?: string; withRedTest?: boolean } = {}): { run: string; target: string } {
  const root = mkdtempSync(join(tmpdir(), "ue-fix-"));
  tmps.push(root);
  const target = join(root, "target");
  mkdirSync(join(target, "src"), { recursive: true });
  mkdirSync(join(target, "tests"), { recursive: true });
  writeFileSync(join(target, "src", "app.js"), "a\nb\nc\n");
  writeFileSync(
    join(target, "package.json"),
    JSON.stringify({ name: "t", scripts: { test: "node -e 'process.exit(0)'", build: "node -e 'process.exit(0)'" } }),
  );
  if (opts.withRedTest !== false) writeFileSync(join(target, "tests", "app.test.js"), "// red test\n");
  const run = join(root, "run");
  mkdirSync(run, { recursive: true });
  writeFileSync(
    join(run, "eval.config.json"),
    JSON.stringify({ target: "target", targetAbs: target, kind: "codebase", category: "library", dimensions: [], version: "1.0.0" }),
  );
  writeFileSync(
    join(run, "findings.json"),
    JSON.stringify({
      findings: [
        { id: "F1", severity: "P0", title: "bug one", statement: "s1", evidence: [{ ref: "src/app.js:1" }], status: "confirmed", recommendation: "fix it" },
        { id: "F2", severity: "P1", title: "bug two", statement: "s2", evidence: [{ ref: "src/app.js:2" }], status: "confirmed", recommendation: "fix that" },
      ],
    }),
  );
  const mkTask = (id: string, findingId: string, dependsOn: string[]) => ({
    id,
    findingId,
    kind: "defect",
    priority: "P1",
    title: `task ${id}`,
    rationale: "because",
    targets: ["src/app.js"],
    red: { testFile: opts.redTestFile ?? "tests/app.test.js", description: "write the failing test" },
    green: { change: "make it pass" },
    verify: { command: opts.verifyCommand ?? "node -e 'process.exit(0)'" },
    dependsOn,
  });
  writeFileSync(
    join(run, "BACKLOG.json"),
    JSON.stringify({ target, generatedFrom: run, tasks: [mkTask("FIX-001", "F1", []), mkTask("FIX-002", "F2", ["FIX-001"])] }),
  );
  return { run, target };
}

afterEach(() => {
  for (const t of tmps.splice(0)) rmSync(t, { recursive: true, force: true });
});

describe("fix — dispatchable fix-agent contracts", () => {
  it("emits one autonomous contract per task: absolute paths, TDD card, invariants, no gate weakening", () => {
    const { run, target } = scaffold();
    const written = emitFixAgents(run, "/abs/engine.mjs");
    expect(written.length).toBeGreaterThanOrEqual(2);
    const p = join(run, "fixes", "agents", "FIX-001.agent.md");
    expect(existsSync(p)).toBe(true);
    const md = readFileSync(p, "utf8");
    expect(md).toContain(target); // absolute target path baked in
    expect(md).toContain(run); // absolute run path baked in
    expect(md).toMatch(/## RED/);
    expect(md).toMatch(/## GREEN/);
    expect(md).toMatch(/## VERIFY/);
    expect(md).toMatch(/weaken/i); // no-gate-weakening rule
    expect(md).toMatch(/verify-fix/); // closes the loop
    expect(md).toContain(join(target, "tests", "app.test.js")); // RED test as absolute path
  });

  it("a dependent task's contract names its dependency", () => {
    const { run } = scaffold();
    emitFixAgents(run, "/abs/engine.mjs");
    expect(readFileSync(join(run, "fixes", "agents", "FIX-002.agent.md"), "utf8")).toContain("FIX-001");
  });

  it("--task emits only the named card and errors on an unknown id", () => {
    const { run } = scaffold();
    const written = emitFixAgents(run, "/abs/engine.mjs", { task: "FIX-002" });
    expect(written.some((w) => w.endsWith("FIX-002.agent.md"))).toBe(true);
    expect(existsSync(join(run, "fixes", "agents", "FIX-001.agent.md"))).toBe(false);
    expect(() => emitFixAgents(run, "/abs/engine.mjs", { task: "FIX-999" })).toThrow(/FIX-999/);
  });

  it("--workflow emits a sequential pipeline in dependsOn (topological) order", () => {
    const { run } = scaffold();
    emitFixAgents(run, "/abs/engine.mjs", { workflow: true });
    const wf = readFileSync(join(run, "fix.workflow.mjs"), "utf8");
    expect(wf).toContain("ultraeval-fix");
    expect(wf.indexOf("FIX-001")).toBeLessThan(wf.indexOf("FIX-002"));
    expect(wf).toMatch(/verify-fix/);
  });

  it("errors actionably without a BACKLOG.json", () => {
    const { run } = scaffold();
    rmSync(join(run, "BACKLOG.json"));
    expect(() => emitFixAgents(run, "/abs/engine.mjs")).toThrow(/no BACKLOG\.json/);
  });

  it("plain `node fix.workflow.mjs` exits 2 with launch guidance, not a raw ReferenceError", () => {
    const { run } = scaffold();
    emitFixAgents(run, "/abs/engine.mjs", { workflow: true });
    const p = join(run, "fix.workflow.mjs");
    const r = spawnSync("node", [p], { encoding: "utf8" });
    const out = `${r.stdout}${r.stderr}`;
    expect(out).not.toMatch(/ReferenceError/); // no raw stack trace from an undefined harness global
    expect(out).not.toMatch(/SyntaxError/); // no illegal top-level return
    expect(r.status).toBe(2); // usage error, NOT 1 (gate-failed) — a CI wrapper must not misread it
    expect(out).toMatch(/Workflow\(\{ scriptPath/); // names the correct launcher
  });
});

describe("verify-fix — close the red-green loop", () => {
  it("marks the task done + verifiedAt when the verify command passes and the RED test exists", () => {
    const { run } = scaffold();
    const r = verifyFix(run, "FIX-001");
    expect(r.ok).toBe(true);
    const bl = JSON.parse(readFileSync(join(run, "BACKLOG.json"), "utf8"));
    const t = bl.tasks.find((x: { id: string }) => x.id === "FIX-001");
    expect(t.status).toBe("done");
    expect(Number.isNaN(Date.parse(t.verifiedAt))).toBe(false);
  });

  it("fails (no status change) when the verify command exits non-zero", () => {
    const { run } = scaffold({ verifyCommand: "node -e 'process.exit(1)'" });
    const r = verifyFix(run, "FIX-001");
    expect(r.ok).toBe(false);
    const bl = JSON.parse(readFileSync(join(run, "BACKLOG.json"), "utf8"));
    expect(bl.tasks[0].status).toBeUndefined();
  });

  it("fails when the RED test file does not exist even if the command passes", () => {
    const { run } = scaffold({ withRedTest: false });
    const r = verifyFix(run, "FIX-001");
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/test file/i);
  });

  it("throws on an unknown task id", () => {
    const { run } = scaffold();
    expect(() => verifyFix(run, "FIX-999")).toThrow(/FIX-999/);
  });

  it("echoes the exact verify command and its cwd BEFORE replaying it (transcript trace)", () => {
    const { run, target } = scaffold({ verifyCommand: "echo replay-marker" });
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    let logged = "";
    try {
      verifyFix(run, "FIX-001");
      logged = spy.mock.calls.map((c) => c.join(" ")).join("\n"); // read BEFORE restore (mockRestore clears calls)
    } finally {
      spy.mockRestore();
    }
    expect(logged).toContain("echo replay-marker"); // the exact shell command
    expect(logged).toContain(target); // its cwd (the target repo the command runs in)
  });
});
