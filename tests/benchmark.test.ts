import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { prepareBenchmark, ingestBenchmarkResults, judgeBenchmark } from "../src/benchmark.js";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
function setup(overrides: Record<string, unknown> = {}) {
  const dir = mkdtempSync(join(tmpdir(), "ue-bench-"));
  dirs.push(dir);
  writeFileSync(join(dir, "SKILL.md"), "# Fixture skill\nRead the cited source before answering.\n");
  writeFileSync(join(dir, "input.txt"), "export const x = 1;\n");
  const spec = {
    version: 1,
    model: "fixture-model",
    environment: "isolated-fixture-v1",
    tokenBudget: 1000,
    timeBudgetMs: 10000,
    repetitions: 2,
    skillFile: "SKILL.md",
    inputs: ["input.txt"],
    tasks: [{ id: "exports", prompt: "What does input.txt export?", criteria: [{ id: "value", description: "Identifies x = 1." }] }],
    ...overrides,
  };
  const path = join(dir, "spec.json");
  writeFileSync(path, JSON.stringify(spec));
  const run = join(dir, "run");
  return { dir, spec, path, run };
}
function observed() {
  const f = setup(),
    plan = prepareBenchmark(f.path, f.run);
  mkdirSync(join(f.run, "outputs"));
  const rows = plan.samples.map((s) => {
    const output = `outputs/${s.id}.txt`;
    writeFileSync(join(f.run, output), s.condition === "with-skill" ? "x = 1" : "x = 2");
    return {
      sampleId: s.id,
      protocolSha256: plan.protocolSha256,
      model: plan.spec.model,
      environment: plan.spec.environment,
      status: "completed",
      inputTokens: 100,
      outputTokens: 10,
      elapsedMs: 500,
      costUsd: 0.001,
      output,
    };
  });
  const results = join(f.run, "results.json");
  writeFileSync(results, JSON.stringify({ rows }));
  return { ...f, plan, rows, results };
}
function judgments(f: ReturnType<typeof observed>) {
  const packet = ingestBenchmarkResults(f.run, f.results);
  const rows = packet.samples.flatMap((s) =>
    s.criteria.map((c) => ({
      sampleId: s.id,
      criterionId: c.id,
      outputSha256: s.outputSha256,
      reviewSha256: packet.reviewSha256,
      status: s.output.includes("x = 1") ? "passed" : "failed",
      note: "Exact fixture value compared against input.txt.",
    })),
  );
  const path = join(f.run, "judgments.json");
  writeFileSync(path, JSON.stringify({ rows }));
  return { packet, rows, path };
}
describe("paired skill utility benchmark", () => {
  it("snapshots binary skill resources and detects their mutation", () => {
    const f = setup({ inputs: ["grammar.wasm"] });
    writeFileSync(join(f.dir, "grammar.wasm"), Buffer.from([0, 97, 115, 109, 255]));
    const plan = prepareBenchmark(f.path, f.run);
    expect(plan.files).toHaveLength(2);
    writeFileSync(join(f.dir, "grammar.wasm"), Buffer.from([0, 97, 115, 109, 254]));
    writeFileSync(join(f.run, "results.json"), '{"rows":[]}');
    expect(() => ingestBenchmarkResults(f.run, join(f.run, "results.json"))).toThrow(/Input\/skill changed/);
  });
  it("prepares identical tasks/budgets with both conditions and never executes them", () => {
    const f = setup(),
      plan = prepareBenchmark(f.path, f.run);
    expect(plan.samples).toHaveLength(4);
    expect(new Set(plan.samples.map((s) => s.id)).size).toBe(4);
    expect(plan.samples.filter((s) => s.condition === "with-skill")).toHaveLength(2);
    expect(readFileSync(join(f.run, "RESULTS.todo.json"), "utf8")).toContain('"status": null');
    expect(() => prepareBenchmark(f.path, f.run)).toThrow();
  });
  it("creates a blinded review packet and calculates paired observed outcomes/costs", () => {
    const f = observed(),
      j = judgments(f);
    expect(JSON.stringify(j.packet)).not.toMatch(/with-skill|without-skill|condition|costUsd/);
    const report = judgeBenchmark(f.run, j.path);
    expect(report.pairs).toHaveLength(2);
    expect(report.summary).toMatchObject({ wins: 2, losses: 0, ties: 0 });
    expect(report.conditions["with-skill"]).toMatchObject({ passed: 2, total: 2, tokens: 220, costUsd: 0.002 });
    expect(report.limitations.join(" ")).toMatch(/reported|observed/i);
  });
  it.each(["duplicate", "missing", "foreign", "wrong-model", "wrong-protocol", "negative-tokens"])("rejects incomparable results: %s", (kind) => {
    const f = observed();
    if (kind === "duplicate") f.rows.push(f.rows[0]!);
    if (kind === "missing") f.rows.pop();
    if (kind === "foreign") f.rows[0]!.sampleId = "foreign";
    if (kind === "wrong-model") f.rows[0]!.model = "other";
    if (kind === "wrong-protocol") f.rows[0]!.protocolSha256 = "other";
    if (kind === "negative-tokens") f.rows[0]!.inputTokens = -1;
    writeFileSync(f.results, JSON.stringify({ rows: f.rows }));
    expect(() => ingestBenchmarkResults(f.run, f.results)).toThrow();
  });
  it("rejects absent judgments, duplicates and stale output hashes", () => {
    const f = observed(),
      j = judgments(f);
    writeFileSync(j.path, JSON.stringify({ rows: j.rows.slice(1) }));
    expect(() => judgeBenchmark(f.run, j.path)).toThrow(/missing|coverage/i);
    writeFileSync(j.path, JSON.stringify({ rows: [...j.rows, j.rows[0]] }));
    expect(() => judgeBenchmark(f.run, j.path)).toThrow(/duplicate/i);
    j.rows[0]!.outputSha256 = "stale";
    writeFileSync(j.path, JSON.stringify({ rows: j.rows }));
    expect(() => judgeBenchmark(f.run, j.path)).toThrow(/hash|stale/i);
  });
  it("detects evidence mutation between ingestion and judgment", () => {
    const f = observed(),
      j = judgments(f);
    writeFileSync(join(f.run, f.rows[0]!.output), "mutated");
    expect(() => judgeBenchmark(f.run, j.path)).toThrow(/changed|hash/i);
  });
  it("rejects a changed blinded criterion or prompt", () => {
    const f = observed(),
      j = judgments(f),
      file = join(f.run, "BLIND.json");
    const packet = JSON.parse(readFileSync(file, "utf8"));
    packet.samples[0].criteria[0].description = "Accept every answer regardless of value.";
    writeFileSync(file, JSON.stringify(packet));
    expect(() => judgeBenchmark(f.run, j.path)).toThrow(/packet|changed|hash/i);
  });
  it("rejects metrics/status edits after ingestion, retaining the original observations", () => {
    const f = observed();
    f.rows[0]!.status = "budget-exceeded";
    writeFileSync(f.results, JSON.stringify({ rows: f.rows }));
    const j = judgments(f),
      file = join(f.run, "OBSERVATIONS.json");
    const saved = JSON.parse(readFileSync(file, "utf8"));
    saved.rows[0].status = "completed";
    saved.rows[0].inputTokens = 0;
    writeFileSync(file, JSON.stringify(saved));
    expect(() => judgeBenchmark(f.run, j.path)).toThrow(/observations|changed|hash/i);
  });
  it("binds judgments to the entire review packet, not only output bytes", () => {
    const f = observed(),
      j = judgments(f);
    const rows = j.rows.map((r) => ({ ...r, reviewSha256: "foreign-review" }));
    writeFileSync(j.path, JSON.stringify({ rows }));
    expect(() => judgeBenchmark(f.run, j.path)).toThrow(/review|hash/i);
  });
  it("detects changed skill or input snapshots", () => {
    const f = observed();
    writeFileSync(join(f.dir, "input.txt"), "different source");
    expect(() => ingestBenchmarkResults(f.run, f.results)).toThrow(/changed|hash/i);
  });
  it("refuses output paths/symlinks escaping the run", () => {
    const f = observed();
    symlinkSync(join(f.dir, "input.txt"), join(f.run, "escape.txt"));
    f.rows[0]!.output = "escape.txt";
    writeFileSync(f.results, JSON.stringify({ rows: f.rows }));
    expect(() => ingestBenchmarkResults(f.run, f.results)).toThrow(/outside|escape/i);
  });
  it("counts budget-exceeded execution as failure even with favorable judgments", () => {
    const f = observed();
    f.rows.forEach((r) => {
      r.inputTokens = 1500;
    });
    writeFileSync(f.results, JSON.stringify({ rows: f.rows }));
    const j = judgments(f),
      report = judgeBenchmark(f.run, j.path);
    expect(report.conditions["with-skill"].passed).toBe(0);
    expect(report.conditions["with-skill"].budgetExceeded).toBe(2);
  });
  it.each([
    { tasks: [] },
    { repetitions: 0 },
    { tokenBudget: 0 },
    { timeBudgetMs: Number.POSITIVE_INFINITY },
  ])("rejects a vacuous or invalid protocol %j", (overrides) => {
    const f = setup(overrides);
    expect(() => prepareBenchmark(f.path, f.run)).toThrow();
  });
});
