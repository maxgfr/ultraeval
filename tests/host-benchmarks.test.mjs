import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hostCommand, parseEvents, prepareWorkspace, runProcess, verifyPlan } from "../scripts/run-host-benchmarks.mjs";
import { prepareBenchmark, ingestBenchmarkResults, judgeBenchmark } from "../src/benchmark.ts";

const dirs = [];
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "host-bench-"));
  dirs.push(dir);
  const skill = join(dir, "skill"),
    workspace = join(dir, "fixture");
  mkdirSync(skill);
  mkdirSync(workspace);
  writeFileSync(join(skill, "SKILL.md"), "Use the supplied evidence.");
  writeFileSync(join(workspace, "input.txt"), "Expected value: 7");
  const spec = {
    version: 1,
    model: "test-model",
    environment: "fixture",
    tokenBudget: 100,
    timeBudgetMs: 1000,
    repetitions: 1,
    skillFile: join(skill, "SKILL.md"),
    inputs: [join(workspace, "input.txt")],
    tasks: [{ id: "read", prompt: "What is the value?", criteria: [{ id: "value", description: "Reports 7" }] }],
  };
  writeFileSync(join(dir, "spec.json"), JSON.stringify(spec));
  const run = join(dir, "run"),
    plan = prepareBenchmark(join(dir, "spec.json"), run);
  return { dir, workspace, run, plan };
}
describe("real host benchmark adapter", () => {
  it("keeps both workspaces identical except for the selected skill", () => {
    const f = fixture();
    const prompts = f.plan.samples.map((s) => {
      const target = join(f.dir, s.condition);
      const prompt = prepareWorkspace(f.plan, s, f.workspace, target);
      expect(readFileSync(join(target, "input.txt"), "utf8")).toBe("Expected value: 7");
      expect(readdirSync(target)).toEqual(["input.txt"]);
      if (s.condition === "with-skill") expect(readFileSync(join(f.dir, "selected-skill/skill/SKILL.md"), "utf8")).toContain("supplied evidence");
      expect(prompt.includes("Use the skill at")).toBe(s.condition === "with-skill");
      return prompt;
    });
    expect(prompts.every((p) => p.includes("What is the value?"))).toBe(true);
    expect(verifyPlan(f.run).protocolSha256).toBe(f.plan.protocolSha256);
    writeFileSync(join(f.workspace, "input.txt"), "Changed");
    expect(() => verifyPlan(f.run)).toThrow(/changed/);
  });
  it("disables inherited Codex skills without changing the user's configuration", () => {
    const [cmd, args] = hostCommand("codex", "cheap", "low", ["/some path/SKILL.md"]);
    expect(cmd).toBe("codex");
    expect(args).toContain("--ignore-user-config");
    expect(args).toContain('skills.config=[{path="/some path/SKILL.md",enabled=false}]');
    expect(args).not.toContain("--dangerously-bypass-approvals-and-sandbox");
    expect(() => hostCommand("unknown", "cheap", "low")).toThrow();
  });
  it("counts cached Claude input and keeps unavailable Codex usage unknown", () => {
    const raw = JSON.stringify({
      type: "result",
      subtype: "success",
      usage: { input_tokens: 10, cache_read_input_tokens: 20, cache_creation_input_tokens: 30, output_tokens: 4 },
      total_cost_usd: 0.01,
      result: "answer",
    });
    expect(parseEvents("claude", raw)).toMatchObject({ inputTokens: 60, outputTokens: 4, text: "answer", finished: true });
    expect(parseEvents("codex", '{"type":"turn.started"}')).toMatchObject({ inputTokens: null, outputTokens: null, finished: false });
    expect(parseEvents("codex", '{"type":"error","message":"usage limit reached"}').quota).toBe(true);
    expect(
      parseEvents("codex", JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "The source contains a rate limit error." } })).quota,
    ).toBe(false);
  });
  it("preserves missing or malformed usage as unknown instead of crashing or inventing tokens", () => {
    for (const usage of [undefined, {}, { input_tokens: -1, output_tokens: 2 }, { input_tokens: "10", output_tokens: 2 }]) {
      expect(parseEvents("codex", JSON.stringify({ type: "turn.completed", usage }))).toMatchObject({ failed: true, inputTokens: null, outputTokens: null });
      expect(parseEvents("claude", JSON.stringify({ type: "result", subtype: "success", usage }))).toMatchObject({
        failed: true,
        inputTokens: null,
        outputTokens: null,
      });
    }
  });
  it("executes a process with literal stdin and captures measured usage", async () => {
    const f = fixture();
    const script =
      'process.stdin.resume();process.stdin.on("end",()=>console.log(JSON.stringify({type:"turn.completed",usage:{input_tokens:4,output_tokens:2}})))';
    const r = await runProcess(process.execPath, ["-e", script], { cwd: f.dir, prompt: "$(do-not-execute)", timeoutMs: 3000, tokenBudget: 100, host: "codex" });
    expect(r.code).toBe(0);
    expect(parseEvents("codex", r.stdout).inputTokens).toBe(4);
  });
  it("terminates a hung host and retains its partial evidence", async () => {
    const f = fixture();
    const r = await runProcess(process.execPath, ["-e", 'console.log("started");setInterval(()=>{},1000)'], {
      cwd: f.dir,
      prompt: "",
      stdoutPath: join(f.dir, "partial.jsonl"),
      timeoutMs: 500,
      tokenBudget: 100,
      host: "codex",
    });
    expect(r.stopped).toBe("timeout");
    expect(r.stdout).toContain("started");
    expect(readFileSync(join(f.dir, "partial.jsonl"), "utf8")).toBe(r.stdout);
    expect(parseEvents("codex", r.stdout).inputTokens).toBe(null);
  });
  it("retains failed trials with unknown usage without reporting free execution", () => {
    const f = fixture();
    const rows = f.plan.samples.map((s) => {
      writeFileSync(join(f.run, `${s.id}.txt`), "Host stopped before usage was returned.");
      return {
        sampleId: s.id,
        protocolSha256: f.plan.protocolSha256,
        model: f.plan.spec.model,
        environment: f.plan.spec.environment,
        status: "error",
        inputTokens: null,
        outputTokens: null,
        elapsedMs: 500,
        costUsd: null,
        output: `${s.id}.txt`,
      };
    });
    writeFileSync(join(f.run, "results.json"), JSON.stringify({ rows }));
    const packet = ingestBenchmarkResults(f.run, join(f.run, "results.json"));
    const judged = packet.samples.map((s) => ({
      sampleId: s.id,
      criterionId: "value",
      status: "failed",
      note: "No answer was produced.",
      outputSha256: s.outputSha256,
      reviewSha256: packet.reviewSha256,
    }));
    writeFileSync(join(f.run, "judgments.json"), JSON.stringify({ rows: judged }));
    const report = judgeBenchmark(f.run, join(f.run, "judgments.json"));
    expect(report.conditions["with-skill"]).toMatchObject({ tokens: null, errors: 1, passed: 0 });
    expect(readFileSync(join(f.run, "BENCHMARK-REPORT.md"), "utf8")).toContain("unknown");
  });
});
