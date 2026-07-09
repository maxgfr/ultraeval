import { describe, expect, it } from "vitest";
import { agentContracts, workflowScript } from "../src/templates.js";
import type { EvalConfig } from "../src/types.js";

const cfg = (over: Partial<EvalConfig> = {}): EvalConfig =>
  ({
    target: "t",
    targetAbs: "/t",
    kind: "codebase",
    category: "library",
    mode: "deep",
    dimensions: [{ id: "correctness", name: "Correctness", weight: 1, whatPerfectLooksLike: "x" }],
    version: "1.0.0",
    ...over,
  }) as EvalConfig;

describe("templates — budget-aware generated workflow", () => {
  it("guards on the harness budget and records every coverage cut to runs/budget.md", () => {
    const script = workflowScript(cfg(), "/run", "/engine.mjs");
    expect(script).toMatch(/typeof budget !== ['"]undefined['"]/); // unbudgeted runs stay unchanged
    expect(script).toContain("runs/budget.md");
    expect(script).toContain("CUTS");
    expect(script).toMatch(/LENSES\.slice\(0, 2\)/); // judges 3 -> 2 under pressure
    expect(script).toMatch(/RESEARCH_GROUPED/); // per-dimension research grouped into one agent
  });

  it("passes the recorded cuts to the remediator so SUMMARY.md reports them", () => {
    const script = workflowScript(cfg(), "/run", "/engine.mjs");
    expect(script).toMatch(/remediator['"]?,\s*CUTS/);
  });

  it("the generated workflow says how to launch it — Workflow harness, not plain node", () => {
    expect(workflowScript(cfg(), "/run", "/engine.mjs")).toMatch(/Workflow\(\{ scriptPath/);
  });
});

describe("templates — diff-scoped eval (init --since)", () => {
  const prov = {
    engineVersion: "1.5.0",
    protocolVersion: "2",
    rubricVersion: "1",
    createdAt: "2026-07-09T00:00:00.000Z",
    mode: "deep",
    kind: "codebase",
    category: "library",
    dimensionsHash: "abc123def456",
    sinceRef: "origin/main",
  };

  it("scopes the executor/findings/brainstormer contracts to the changed set when provenance carries sinceRef", () => {
    const contracts = agentContracts(cfg({ provenance: prov } as never), "/run", "/engine.mjs");
    for (const name of ["executor", "findings", "brainstormer"]) {
      expect(contracts[name], `${name} contract is diff-scoped`).toMatch(/DIFF SCOPE/);
      expect(contracts[name]).toContain("origin/main");
    }
  });

  it("emits no diff-scope block without sinceRef", () => {
    expect(agentContracts(cfg(), "/run", "/engine.mjs").executor).not.toMatch(/DIFF SCOPE/);
  });
});

describe("templates — normed live-scenario library", () => {
  it("embeds the CLI scenario block in the executor contract for a CLI category", () => {
    const ex = agentContracts(cfg({ category: "CLI tool" }), "/run", "/engine.mjs").executor as string;
    expect(ex).toMatch(/golden path/i);
    expect(ex).toMatch(/--help/);
    expect(ex).toMatch(/exit code/i);
  });

  it("embeds the agent-skill scenario block for a skill target", () => {
    const ex = agentContracts(cfg({ kind: "skill", category: "agent skill" }), "/run", "/engine.mjs").executor as string;
    expect(ex).toMatch(/golden path/i);
    expect(ex).toMatch(/SKILL\.md/);
  });

  it("testplan contract points at the live-scenario library", () => {
    expect(agentContracts(cfg(), "/run", "/engine.mjs").testplan).toMatch(/live-scenarios\.md/);
  });

  it("remediator reports budget cuts in SUMMARY.md when runs/budget.md exists", () => {
    expect(agentContracts(cfg(), "/run", "/engine.mjs").remediator).toMatch(/budget\.md/);
  });
});
