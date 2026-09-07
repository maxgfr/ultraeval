import { createHash, randomInt, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";

type Condition = "with-skill" | "without-skill";
type Criterion = { id: string; description: string };
type Task = { id: string; prompt: string; criteria: Criterion[] };
interface Spec {
  version: 1;
  model: string;
  environment: string;
  tokenBudget: number;
  timeBudgetMs: number;
  repetitions: number;
  skillFile: string;
  inputs: string[];
  tasks: Task[];
}
type Snapshot = { path: string; sha256: string };
type Sample = { id: string; taskId: string; repetition: number; condition: Condition };
export interface BenchmarkPlan {
  spec: Spec;
  files: Snapshot[];
  protocolSha256: string;
  samples: Sample[];
}
type Metrics = { inputTokens: number; outputTokens: number; elapsedMs: number; costUsd: number | null };
type Observation = Metrics & { sampleId: string; output: string; outputSha256: string; status: "completed" | "error" | "budget-exceeded" };
export interface BlindPacket {
  protocolSha256: string;
  observationsSha256: string;
  reviewSha256: string;
  samples: { id: string; taskId: string; repetition: number; prompt: string; criteria: Criterion[]; output: string; outputSha256: string }[];
}

const MAX_BYTES = 2 * 1024 * 1024;
const digest = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
function read(path: string): string {
  const stat = statSync(path);
  if (!stat.isFile() || stat.size > MAX_BYTES) throw new Error(`Expected a regular file <= ${MAX_BYTES} bytes: ${path}`);
  const raw = readFileSync(path);
  const text = raw.toString("utf8");
  if (!Buffer.from(text, "utf8").equals(raw) || text.includes("\0")) throw new Error(`Expected UTF-8 text: ${path}`);
  return text;
}
function json(path: string): unknown {
  return JSON.parse(read(path));
}
function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label}: expected object`);
  return value as Record<string, unknown>;
}
function text(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim() || value.length > 50000) throw new Error(`${label}: expected nonempty text`);
  return value;
}
function number(value: unknown, label: string, min = 0, max = Number.MAX_SAFE_INTEGER, integer = true): number {
  if (typeof value !== "number" || !Number.isFinite(value) || (integer && !Number.isSafeInteger(value)) || value < min || value > max)
    throw new Error(`${label}: invalid number`);
  return value;
}
function array(value: unknown, label: string, min = 1, max = 4000): unknown[] {
  if (!Array.isArray(value) || value.length < min || value.length > max) throw new Error(`${label}: expected ${min}–${max} rows`);
  return value;
}
function unique(values: string[], label: string): void {
  if (new Set(values).size !== values.length) throw new Error(`${label}: duplicate identity`);
}
function parseSpec(value: unknown, base: string): Spec {
  const raw = object(value, "spec");
  if (raw.version !== 1) throw new Error("spec.version must be 1");
  const tasks = array(raw.tasks, "tasks", 1, 100).map((value) => {
    const task = object(value, "task");
    const criteria = array(task.criteria, "criteria", 1, 50).map((value) => {
      const c = object(value, "criterion");
      return { id: text(c.id, "criterion.id"), description: text(c.description, "criterion.description") };
    });
    unique(
      criteria.map((c) => c.id),
      "criteria",
    );
    return { id: text(task.id, "task.id"), prompt: text(task.prompt, "task.prompt"), criteria };
  });
  unique(
    tasks.map((t) => t.id),
    "tasks",
  );
  const inputs = array(raw.inputs ?? [], "inputs", 0, 100).map((p) => resolve(base, text(p, "input")));
  unique(inputs, "inputs");
  return {
    version: 1,
    model: text(raw.model, "model"),
    environment: text(raw.environment, "environment"),
    tokenBudget: number(raw.tokenBudget, "tokenBudget", 1),
    timeBudgetMs: number(raw.timeBudgetMs, "timeBudgetMs", 1),
    repetitions: number(raw.repetitions, "repetitions", 1, 20),
    skillFile: resolve(base, text(raw.skillFile, "skillFile")),
    inputs,
    tasks,
  };
}
const protocolHash = (spec: Spec, files: Snapshot[], samples: Sample[]) => digest(JSON.stringify({ spec, files, samples }));
const writeJson = (path: string, data: unknown) => {
  const encoded = JSON.stringify(data, null, 2) + "\n";
  if (Buffer.byteLength(encoded) > MAX_BYTES) throw new Error(`Artifact exceeds ${MAX_BYTES} bytes; split the experiment into smaller runs`);
  writeFileSync(path, encoded, { flag: "wx" });
};

/** Prepare a protocol only. No subprocess, LLM, network call or personal skill change. */
export function prepareBenchmark(specPath: string, out: string): BenchmarkPlan {
  const spec = parseSpec(json(specPath), dirname(resolve(specPath)));
  const files = [...new Set([spec.skillFile, ...spec.inputs])].map((path) => ({ path, sha256: digest(read(path)) }));
  const samples: Sample[] = [];
  for (const task of spec.tasks)
    for (let repetition = 1; repetition <= spec.repetitions; repetition++) {
      for (const condition of ["with-skill", "without-skill"] as const) samples.push({ id: randomUUID(), taskId: task.id, repetition, condition });
    }
  // Random execution order and opaque labels reduce order/label bias; isolation
  // and not exposing the executor plan to a judge remain the caller's duties.
  for (let i = samples.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [samples[i], samples[j]] = [samples[j]!, samples[i]!];
  }
  const plan: BenchmarkPlan = { spec, files, protocolSha256: protocolHash(spec, files, samples), samples };
  mkdirSync(dirname(resolve(out)), { recursive: true });
  mkdirSync(out); // A fresh run is mandatory; never overwrite measurements.
  writeJson(join(out, "BENCHMARK.json"), plan);
  writeJson(join(out, "RESULTS.todo.json"), {
    rows: samples.map((s) => ({
      sampleId: s.id,
      protocolSha256: plan.protocolSha256,
      model: spec.model,
      environment: spec.environment,
      status: null,
      inputTokens: null,
      outputTokens: null,
      elapsedMs: null,
      costUsd: null,
      output: null,
    })),
  });
  writeFileSync(
    join(out, "BENCHMARK.md"),
    `# Paired skill utility experiment\n\nProtocol: ${plan.protocolSha256}\n\nRun every sample in BENCHMARK.json in a fresh isolated session, using exactly the recorded model, environment, task, inputs and token/time budgets. Only the with-skill condition loads the recorded skill. Count all input/output tokens, including skill loading. Record errors and budget exhaustion, not only successful attempts. This command has executed no task.\n\nSave real UTF-8 outputs inside this directory. Fill RESULTS.todo.json with observed metrics (costUsd may be null when unknown) and status completed/error/budget-exceeded. Import with benchmark --run <dir> --results <file>. Give only BLIND.json and JUDGMENTS.todo.json to a judge, never this plan or arm labels; output content itself can reveal the condition. Follow each criterion, then benchmark --run <dir> --judgments <file>.\n\nThe report verifies pair coverage, input/output hashes and numeric contracts, not the honesty of reported measurements. It is descriptive evidence on exercised tasks, not a normed score or proof of general utility. Include all skill references/scripts used among spec.inputs to snapshot them too.\n`,
    { flag: "wx" },
  );
  return plan;
}

function loadPlan(run: string): BenchmarkPlan {
  const plan = json(join(run, "BENCHMARK.json")) as BenchmarkPlan;
  const spec = parseSpec(plan.spec, run);
  if (protocolHash(spec, plan.files, plan.samples) !== plan.protocolSha256) throw new Error("Protocol hash changed");
  for (const file of plan.files) if (digest(read(file.path)) !== file.sha256) throw new Error(`Input/skill changed: ${file.path}`);
  const samples = array(plan.samples, "samples").map((s) => object(s, "sample"));
  unique(
    samples.map((s) => text(s.id, "sample.id")),
    "samples",
  );
  const expected = new Set(
    spec.tasks.flatMap((t) =>
      Array.from({ length: spec.repetitions }, (_, i) => ["with-skill", "without-skill"].map((c) => JSON.stringify([t.id, i + 1, c]))).flat(),
    ),
  );
  for (const s of samples) if (!expected.delete(JSON.stringify([s.taskId, s.repetition, s.condition]))) throw new Error("Foreign/duplicate sample pair");
  if (expected.size) throw new Error("Missing sample pair");
  return plan;
}

function outputFile(run: string, rel: string): string {
  if (isAbsolute(rel)) throw new Error("Output must be relative to the run");
  const root = realpathSync(run),
    full = realpathSync(resolve(root, rel)),
    within = relative(root, full);
  if (!within || within === ".." || within.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) || isAbsolute(within))
    throw new Error("Output escapes outside the run");
  return full;
}
function observations(run: string, plan: BenchmarkPlan, value: unknown): Observation[] {
  const rows = array(object(value, "results").rows, "results.rows"),
    expected = new Set(plan.samples.map((s) => s.id));
  return rows
    .map((value): Observation => {
      const r = object(value, "result"),
        sampleId = text(r.sampleId, "sampleId");
      if (!expected.delete(sampleId)) throw new Error("Foreign or duplicate sampleId");
      if (r.protocolSha256 !== plan.protocolSha256 || r.model !== plan.spec.model || r.environment !== plan.spec.environment)
        throw new Error("Incomparable model/environment/protocol hash");
      if (r.status !== "completed" && r.status !== "error" && r.status !== "budget-exceeded") throw new Error("Invalid execution status");
      const inputTokens = number(r.inputTokens, "inputTokens"),
        outputTokens = number(r.outputTokens, "outputTokens"),
        elapsedMs = number(r.elapsedMs, "elapsedMs", 0, Number.MAX_SAFE_INTEGER, false);
      const costUsd = r.costUsd === null ? null : number(r.costUsd, "costUsd", 0, Number.MAX_SAFE_INTEGER, false);
      const output = text(r.output, "output"),
        body = read(outputFile(run, output));
      if (!body.trim()) throw new Error("Output evidence must not be empty (record the error log for failed executions)");
      const exceeded = inputTokens + outputTokens > plan.spec.tokenBudget || elapsedMs > plan.spec.timeBudgetMs;
      return { sampleId, inputTokens, outputTokens, elapsedMs, costUsd, status: exceeded ? "budget-exceeded" : r.status, output, outputSha256: digest(body) };
    })
    .map((row, _, all) => {
      if (expected.size || all.length !== plan.samples.length) throw new Error("Missing sample coverage");
      return row;
    });
}

function blindPacket(run: string, plan: BenchmarkPlan, rows: Observation[], sourceSha256: string): BlindPacket {
  const byId = new Map(rows.map((r) => [r.sampleId, r]));
  const content = {
    protocolSha256: plan.protocolSha256,
    observationsSha256: digest(JSON.stringify({ sourceSha256, rows })),
    samples: plan.samples.map((s) => {
      const task = plan.spec.tasks.find((t) => t.id === s.taskId)!,
        row = byId.get(s.id)!;
      return {
        id: s.id,
        taskId: s.taskId,
        repetition: s.repetition,
        prompt: task.prompt,
        criteria: task.criteria,
        output: read(outputFile(run, row.output)),
        outputSha256: row.outputSha256,
      };
    }),
  };
  return { ...content, reviewSha256: digest(JSON.stringify(content)) };
}

/** Validate actual supplied observations; emit a condition-free packet, not judgments. */
export function ingestBenchmarkResults(run: string, resultsPath: string): BlindPacket {
  const plan = loadPlan(run),
    raw = read(resultsPath),
    rows = observations(run, plan, JSON.parse(raw));
  const packet = blindPacket(run, plan, rows, digest(raw));
  writeFileSync(join(run, "IMPORTED-RESULTS.json"), raw, { flag: "wx" });
  writeJson(join(run, "OBSERVATIONS.json"), { protocolSha256: plan.protocolSha256, sourceSha256: digest(raw), rows });
  writeJson(join(run, "BLIND.json"), packet);
  writeJson(join(run, "JUDGMENTS.todo.json"), {
    rows: packet.samples.flatMap((s) =>
      s.criteria.map((c) => ({ sampleId: s.id, criterionId: c.id, outputSha256: s.outputSha256, reviewSha256: packet.reviewSha256, status: null, note: "" })),
    ),
  });
  return packet;
}

/** Reduce a complete independent review; reveal arms only after judgments exist. */
export function judgeBenchmark(run: string, judgmentsPath: string) {
  const plan = loadPlan(run),
    saved = object(json(join(run, "OBSERVATIONS.json")), "observations");
  if (saved.protocolSha256 !== plan.protocolSha256) throw new Error("Observation protocol hash changed");
  const savedRows = array(saved.rows, "observations.rows").map((r) => object(r, "observation"));
  const raw = read(join(run, "IMPORTED-RESULTS.json"));
  if (digest(raw) !== saved.sourceSha256) throw new Error("Imported observations source hash changed");
  const rows = observations(run, plan, JSON.parse(raw));
  for (const row of rows)
    if (savedRows.find((r) => r.sampleId === row.sampleId)?.outputSha256 !== row.outputSha256) throw new Error("Output evidence hash changed");
  if (JSON.stringify(rows) !== JSON.stringify(savedRows)) throw new Error("Observations changed after import");
  const packet = blindPacket(run, plan, rows, digest(raw));
  if (JSON.stringify(json(join(run, "BLIND.json"))) !== JSON.stringify(packet)) throw new Error("Blinded review packet changed after import");
  const rawJudgments = read(judgmentsPath),
    rawRows = array(object(JSON.parse(rawJudgments), "judgments").rows, "judgments.rows", 1, 200000);
  const expected = new Map(
    plan.samples.flatMap((s) => plan.spec.tasks.find((t) => t.id === s.taskId)!.criteria.map((c) => [JSON.stringify([s.id, c.id]), s.id] as const)),
  );
  const passed = new Map<string, number>();
  for (const value of rawRows) {
    const j = object(value, "judgment"),
      key = JSON.stringify([j.sampleId, j.criterionId]);
    if (!expected.has(key)) throw new Error("Foreign or duplicate judgment");
    const sampleId = expected.get(key)!;
    expected.delete(key);
    if (j.outputSha256 !== rows.find((r) => r.sampleId === sampleId)?.outputSha256) throw new Error("Stale judgment output hash");
    if (j.reviewSha256 !== packet.reviewSha256) throw new Error("Stale judgment review hash (protocol, criteria, outputs or observations changed)");
    if (j.status !== "passed" && j.status !== "failed") throw new Error("Judgment status must be passed or failed");
    text(j.note, "judgment.note");
    if (j.status === "passed") passed.set(sampleId, (passed.get(sampleId) ?? 0) + 1);
  }
  if (expected.size) throw new Error(`Missing judgment coverage: ${expected.size} criteria`);
  const tally = (condition: Condition) => {
    const ids = new Set(plan.samples.filter((s) => s.condition === condition).map((s) => s.id)),
      selected = rows.filter((r) => ids.has(r.sampleId));
    return {
      total: selected.length,
      passed: selected.filter(
        (r) =>
          r.status === "completed" &&
          passed.get(r.sampleId) === plan.spec.tasks.find((t) => t.id === plan.samples.find((s) => s.id === r.sampleId)!.taskId)!.criteria.length,
      ).length,
      tokens: selected.reduce((sum, r) => sum + r.inputTokens + r.outputTokens, 0),
      elapsedMs: selected.reduce((sum, r) => sum + r.elapsedMs, 0),
      costUsd: selected.some((r) => r.costUsd === null) ? null : selected.reduce((sum, r) => sum + (r.costUsd ?? 0), 0),
      budgetExceeded: selected.filter((r) => r.status === "budget-exceeded").length,
      errors: selected.filter((r) => r.status === "error").length,
    };
  };
  const pairs = plan.spec.tasks.flatMap((task) =>
    Array.from({ length: plan.spec.repetitions }, (_, i) => {
      const get = (condition: Condition) => {
        const sample = plan.samples.find((s) => s.taskId === task.id && s.repetition === i + 1 && s.condition === condition)!,
          row = rows.find((r) => r.sampleId === sample.id)!;
        return row.status === "completed" ? (passed.get(sample.id) ?? 0) / task.criteria.length : 0;
      };
      const withSkill = get("with-skill"),
        withoutSkill = get("without-skill");
      return { taskId: task.id, repetition: i + 1, withSkill, withoutSkill, delta: withSkill - withoutSkill };
    }),
  );
  const limitations = [
    "Descriptive results on the observed tasks, not statistical significance or a normed score.",
    "Execution metrics and judgments are supplied by the operator; file hashes establish artifact consistency, not measurement honesty.",
    "Opaque labels remove condition metadata, but output content can reveal the condition. Use independent fresh sessions and a judge who has not seen BENCHMARK.json.",
    "Only the entrypoint and explicitly listed input files are snapshotted; list every skill resource and fixture actually used.",
  ];
  const report = {
    protocolSha256: plan.protocolSha256,
    observationsSha256: digest(read(join(run, "OBSERVATIONS.json"))),
    judgmentsSha256: digest(rawJudgments),
    summary: {
      wins: pairs.filter((p) => p.delta > 0).length,
      losses: pairs.filter((p) => p.delta < 0).length,
      ties: pairs.filter((p) => p.delta === 0).length,
    },
    conditions: { "with-skill": tally("with-skill"), "without-skill": tally("without-skill") },
    pairs,
    limitations,
  };
  writeJson(join(run, "BENCHMARK-REPORT.json"), report);
  const lines = [
    "# Observed paired skill utility",
    "",
    `Pairs: ${pairs.length}; wins ${report.summary.wins}, losses ${report.summary.losses}, ties ${report.summary.ties} (criterion pass fraction).`,
    "",
    "| Condition | Fully passed | Tokens | Elapsed ms | Cost USD | Budget exceeded | Errors |",
    "| --- | --- | --- | --- | --- | --- | --- |",
    ...Object.entries(report.conditions).map(
      ([name, c]) => `| ${name} | ${c.passed}/${c.total} | ${c.tokens} | ${c.elapsedMs} | ${c.costUsd ?? "unknown"} | ${c.budgetExceeded} | ${c.errors} |`,
    ),
    "",
    ...limitations.map((s) => `- ${s}`),
    "",
  ];
  writeFileSync(join(run, "BENCHMARK-REPORT.md"), lines.join("\n"), { flag: "wx" });
  return report;
}
