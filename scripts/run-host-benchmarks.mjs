#!/usr/bin/env node
// Optional development runner. The benchmark engine still works without a CLI agent.
import { createHash } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";

const hash = (data) => createHash("sha256").update(data).digest("hex");
const json = (path) => JSON.parse(readFileSync(path, "utf8"));
const write = (path, value) => writeFileSync(path, JSON.stringify(value, null, 2) + "\n", { flag: "wx" });
const within = (root, path) => {
  const rel = relative(root, path);
  return rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
};

export function verifyPlan(run) {
  const plan = json(join(run, "BENCHMARK.json"));
  if (hash(JSON.stringify({ spec: plan.spec, files: plan.files, samples: plan.samples })) !== plan.protocolSha256) throw new Error("Protocol hash changed");
  for (const file of plan.files) {
    if (hash(readFileSync(file.path)) !== file.sha256) throw new Error(`Input/skill changed: ${file.path}`);
  }
  if (!Number.isSafeInteger(plan.spec.tokenBudget) || plan.spec.tokenBudget <= 0 || !Number.isSafeInteger(plan.spec.timeBudgetMs) || plan.spec.timeBudgetMs <= 0) {
    throw new Error("Invalid execution budgets");
  }
  const expected = new Set(plan.spec.tasks.flatMap((t) => Array.from({ length: plan.spec.repetitions }, (_, i) => ["with-skill", "without-skill"].map((c) => JSON.stringify([t.id, i + 1, c])))).flat());
  const ids = new Set();
  for (const s of plan.samples) {
    if (!/^[a-zA-Z0-9-]+$/.test(s.id) || ids.has(s.id) || !expected.delete(JSON.stringify([s.taskId, s.repetition, s.condition]))) throw new Error("Invalid sample identity");
    ids.add(s.id);
  }
  if (expected.size) throw new Error("Missing sample coverage");
  return plan;
}

export function skillPaths(roots) {
  const paths = [];
  const walk = (dir) => {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.name === "node_modules" || entry.name === ".git") continue;
      if (entry.isDirectory()) walk(path);
      else if (entry.name === "SKILL.md") paths.push(path);
      else if (entry.isSymbolicLink() && existsSync(join(path, "SKILL.md"))) paths.push(join(path, "SKILL.md"));
    }
  };
  roots.forEach(walk);
  return [...new Set(paths)].sort();
}

export function hostCommand(host, model, effort, disabledSkills = [], network = false) {
  if (host === "codex") {
    const disable = "skills.config=[" + disabledSkills.map((p) => `{path=${JSON.stringify(p)},enabled=false}`).join(",") + "]";
    return ["codex", ["exec", "--ignore-user-config", "--ephemeral", "--json", "--skip-git-repo-check", "--disable", "plugins", "--disable", "apps", "--disable", "hooks", "--disable", "multi_agent", "-c", "project_doc_max_bytes=0", "-c", "approval_policy=\"never\"", "-c", `model_reasoning_effort=${JSON.stringify(effort)}`, "-c", disable, "-c", `sandbox_workspace_write.network_access=${network}`, "--model", model, "--sandbox", "workspace-write", "-"]];
  }
  if (host === "claude") {
    return ["claude", ["--print", "--verbose", "--output-format", "stream-json", "--no-session-persistence", "--safe-mode", "--model", model, "--effort", effort, "--permission-mode", "dontAsk", "--allowedTools", "Read,Write,Edit,Glob,Grep,Bash,WebFetch,WebSearch", "--strict-mcp-config", "--mcp-config", "{\"mcpServers\":{}}"]];
  }
  throw new Error("--host must be codex or claude");
}

export function parseEvents(host, raw) {
  let inputTokens = null, outputTokens = null, costUsd = null;
  let finished = false, failed = false;
  const count = (value) => Number.isSafeInteger(value) && value >= 0;
  const messages = [], models = new Set(), errors = [];
  for (const line of raw.split("\n")) {
    let e;
    try { e = JSON.parse(line); } catch { continue; }
    if (host === "codex") {
      if (e.type === "turn.completed") {
        if (count(e.usage?.input_tokens) && count(e.usage?.output_tokens)) {
          inputTokens = (inputTokens ?? 0) + e.usage.input_tokens;
          outputTokens = (outputTokens ?? 0) + e.usage.output_tokens;
        } else {
          failed = true;
          errors.push("Completed Codex turn has no valid token usage");
        }
        finished = true;
      }
      if (e.type === "item.completed" && e.item?.type === "agent_message") messages.push(e.item.text);
      if (e.type === "turn.failed" || e.type === "error") { failed = true; errors.push(JSON.stringify(e)); }
    } else {
      if (e.type === "assistant" && e.message?.model) models.add(e.message.model);
      if (e.type === "result") {
        const u = e.usage;
        if (u && [u.input_tokens, u.output_tokens, u.cache_read_input_tokens ?? 0, u.cache_creation_input_tokens ?? 0].every(count)) {
          inputTokens = u.input_tokens + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0);
          outputTokens = u.output_tokens;
        } else {
          failed = true;
          errors.push("Claude result has no valid token usage");
        }
        costUsd = e.total_cost_usd ?? null;
        finished = true;
        failed ||= Boolean(e.is_error) || e.subtype !== "success";
        if (e.is_error || e.subtype !== "success") errors.push(JSON.stringify(e));
        if (e.result) messages.push(e.result);
      }
    }
  }
  const quota = /(?:usage limit|rate.?limit|insufficient.quota|quota.exceeded|hit your limit|out of extra usage)/i.test(errors.join("\n"));
  return { inputTokens, outputTokens, costUsd, finished, failed, quota, models: [...models], text: messages.join("\n\n") };
}

export function runProcess(command, args, { cwd, prompt, timeoutMs, tokenBudget, host, env = process.env, stdoutPath, stderrPath }) {
  return new Promise((res, reject) => {
    if (stdoutPath) writeFileSync(stdoutPath, "", { flag: "wx" });
    if (stderrPath) writeFileSync(stderrPath, "", { flag: "wx" });
    const start = performance.now();
    const child = spawn(command, args, { cwd, env, detached: process.platform !== "win32", stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "", stderr = "", stopped = null;
    const stop = (reason) => {
      if (stopped) return;
      stopped = reason;
      try { if (process.platform === "win32") child.kill("SIGKILL"); else process.kill(-child.pid, "SIGKILL"); } catch { /* already exited */ }
    };
    const timer = setTimeout(() => stop("timeout"), timeoutMs);
    child.stdout.on("data", (data) => {
      if (stdoutPath) appendFileSync(stdoutPath, data);
      stdout += data;
      const usage = parseEvents(host, stdout);
      if (usage.inputTokens !== null && usage.outputTokens !== null && usage.inputTokens + usage.outputTokens > tokenBudget) stop("tokens");
      if (stdout.length > 32 * 1024 * 1024) stop("output-limit");
    });
    child.stderr.on("data", (data) => { if (stderrPath) appendFileSync(stderrPath, data); stderr += data; if (stderr.length > 4 * 1024 * 1024) stop("output-limit"); });
    child.on("error", (error) => { clearTimeout(timer); reject(error); });
    child.on("close", (code, signal) => { clearTimeout(timer); res({ stdout, stderr, code, signal, stopped, elapsedMs: Math.round(performance.now() - start) }); });
    child.stdin.on("error", () => {});
    child.stdin.end(prompt);
  });
}

export function prepareWorkspace(plan, sample, fixtureRoot, destination) {
  mkdirSync(destination, { recursive: true });
  const skillRoot = dirname(plan.spec.skillFile);
  const selectedSkill = join(dirname(destination), "selected-skill", basename(skillRoot));
  for (const file of plan.files) {
    let target;
    if (within(skillRoot, file.path)) {
      if (sample.condition !== "with-skill") continue;
      target = join(selectedSkill, relative(skillRoot, file.path));
    } else if (within(fixtureRoot, file.path)) {
      target = join(destination, relative(fixtureRoot, file.path));
    } else throw new Error(`Input is outside --workspace and skill directory: ${file.path}`);
    if (!within(destination, target) && !within(selectedSkill, target)) throw new Error("Input escapes sample directories");
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, readFileSync(file.path), { flag: "wx" });
  }
  const task = plan.spec.tasks.find((t) => t.id === sample.taskId);
  const shared = "Write only in the current workspace. Task inputs are local files here. Write requested deliverables here. Do not publish, contact people, install global tools, or read personal files. The session is noninteractive: report an essential missing decision instead of inventing approval. Finish with your result and verification evidence.";
  const skill = sample.condition === "with-skill" ? `\nUse the skill at ${join(selectedSkill, "SKILL.md")}. Reading this separate skill directory is permitted; it is not part of the repository being evaluated. Read its instructions and the relevant bundled references. Resolve its script paths from that directory.\n` : "\n";
  return `${shared}${skill}\n${task.prompt}\n`;
}

export async function executeBenchmarks({ run, workspace, host, effort = "low", limit = Infinity, dryRun = false, network = false }) {
  run = realpathSync(run);
  workspace = realpathSync(workspace);
  const plan = verifyPlan(run);
  if (network && host !== "codex") throw new Error("--network configures Codex shell access only; Claude uses its host network policy");
  const disabledSkills = skillPaths([join(homedir(), ".agents", "skills"), join(process.env.CODEX_HOME || join(homedir(), ".codex"), "skills")]);
  const [command, args] = hostCommand(host, plan.spec.model, effort, disabledSkills, network);
  const version = spawnSync(command, ["--version"], { encoding: "utf8" });
  if (version.status !== 0) throw new Error(`${command} is unavailable: ${version.stderr || version.error?.message}`);
  const identity = { protocolSha256: plan.protocolSha256, host, model: plan.spec.model, effort, hostVersion: version.stdout.trim(), networkAccess: host === "codex" ? network : "host-default", workspace, disabledSkills, runnerSha256: hash(readFileSync(fileURLToPath(import.meta.url))) };
  const identityPath = join(run, "HOST-EXECUTION.json");
  if (existsSync(identityPath) && JSON.stringify(json(identityPath)) !== JSON.stringify(identity)) throw new Error("Execution settings changed; prepare a fresh benchmark run");
  if (dryRun) return { ...identity, samples: plan.samples.length, command, args };
  if (!existsSync(identityPath)) write(identityPath, identity);
  const outputs = join(run, "host-outputs");
  mkdirSync(outputs, { recursive: true });
  let count = 0;
  for (const sample of plan.samples) {
    if (count >= limit) break;
    verifyPlan(run);
    const dir = join(outputs, sample.id), record = join(dir, "observation.json");
    if (existsSync(record)) continue;
    if (existsSync(dir)) throw new Error(`Interrupted sample ${sample.id}; preserve its logs and explicitly reconcile it before resuming`);
    mkdirSync(dir);
    const cwd = join(dir, "workspace");
    const prompt = prepareWorkspace(plan, sample, workspace, cwd);
    // The skill lives beside the workspace: even filesystem-based repository
    // indexes must see identical target inputs in both conditions.
    for (const gitArgs of [["init", "-q"], ["add", "--", "."], ["-c", "user.name=Benchmark", "-c", "user.email=benchmark@example.invalid", "-c", "commit.gpgsign=false", "commit", "-qm", "Fixture baseline"]]) {
      const seeded = spawnSync("git", ["-c", "core.hooksPath=/dev/null", ...gitArgs], { cwd, encoding: "utf8" });
      if (seeded.status !== 0) throw new Error(`Fixture git initialization failed: ${seeded.stderr}`);
    }
    writeFileSync(join(dir, "prompt.txt"), prompt, { flag: "wx" });
    const result = await runProcess(command, args, { cwd, prompt, timeoutMs: plan.spec.timeBudgetMs, tokenBudget: plan.spec.tokenBudget, host, stdoutPath: join(dir, "events.jsonl"), stderrPath: join(dir, "stderr.txt") });
    const parsed = parseEvents(host, result.stdout);
    const status = result.stopped === "timeout" || result.stopped === "tokens" ? "budget-exceeded" : result.code !== 0 || parsed.failed || !parsed.finished || parsed.inputTokens === null || parsed.outputTokens === null ? "error" : "completed";
    const output = relative(run, join(dir, "result.txt"));
    writeFileSync(join(run, output), parsed.text || result.stderr || result.stdout || `Process exited ${result.code}; signal ${result.signal}; stop ${result.stopped}.`, { flag: "wx" });
    const row = { sampleId: sample.id, protocolSha256: plan.protocolSha256, model: plan.spec.model, environment: plan.spec.environment, status, inputTokens: parsed.inputTokens, outputTokens: parsed.outputTokens, elapsedMs: result.elapsedMs, costUsd: parsed.costUsd, output };
    write(record, { row, process: { code: result.code, signal: result.signal, stopped: result.stopped }, quota: parsed.quota, resolvedModels: parsed.models, outputSha256: hash(readFileSync(join(run, output))) });
    count++;
    console.log(JSON.stringify({ sample: sample.id, task: sample.taskId, status, elapsedMs: result.elapsedMs, inputTokens: parsed.inputTokens, outputTokens: parsed.outputTokens }));
    if (parsed.quota) throw new Error(`Quota unavailable at ${sample.id}; campaign stopped, evidence preserved`);
  }
  const rows = [];
  for (const sample of plan.samples) {
    const path = join(outputs, sample.id, "observation.json");
    if (!existsSync(path)) continue;
    const saved = json(path);
    if (hash(readFileSync(join(run, saved.row.output))) !== saved.outputSha256) throw new Error(`Saved output changed: ${sample.id}`);
    rows.push(saved.row);
  }
  if (rows.length < plan.samples.length) return { executed: count, remaining: plan.samples.length - rows.length };
  const results = join(run, "HOST-RESULTS.json");
  if (!existsSync(results)) write(results, { rows });
  return { executed: count, remaining: 0, results };
}

if (process.argv[1] && realpathSync(resolve(process.argv[1])) === realpathSync(fileURLToPath(import.meta.url))) {
  const argv = process.argv.slice(2), opts = {};
  try {
    if (argv.length === 1 && argv[0] === "--help") {
      console.log("Usage: node scripts/run-host-benchmarks.mjs --run <benchmark> --workspace <fixture-root> --host codex|claude [--effort low] [--limit N] [--network] [--dry-run]");
      process.exit(0);
    }
    for (let i = 0; i < argv.length; i++) {
      const key = argv[i];
      if (key === "--network") { opts.network = true; continue; }
      if (key === "--dry-run") { opts.dryRun = true; continue; }
      if (!["--run", "--workspace", "--host", "--effort", "--limit"].includes(key) || !argv[i + 1] || argv[i + 1].startsWith("--")) throw new Error(`Invalid argument ${key}`);
      opts[key.slice(2)] = argv[++i];
    }
    if (!opts.run || !opts.workspace || !opts.host) throw new Error("Usage: node scripts/run-host-benchmarks.mjs --run <benchmark> --workspace <fixture-root> --host codex|claude [--effort low] [--limit N] [--network] [--dry-run]");
    if (opts.limit !== undefined) {
      opts.limit = Number(opts.limit);
      if (!Number.isSafeInteger(opts.limit) || opts.limit < 1) throw new Error("--limit must be a positive integer");
    }
    console.log(JSON.stringify(await executeBenchmarks(opts), null, 2));
  } catch (e) { console.error(e.message); process.exitCode = 2; }
}
