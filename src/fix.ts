import { spawnSync } from "node:child_process";
import { isAbsolute, join, resolve } from "node:path";
import type { Backlog, EvalConfig, FixTask } from "./types.js";
import { exists, readJson, resolveTargetAbs, writeJson, writeText } from "./util.js";

// Close the red-green loop: turn each BACKLOG task into an AUTONOMOUS fix-agent
// contract a harness can dispatch, and verify a finished fix by replaying the
// task's own verify command. The card tells a model WHAT to do; the contract
// adds WHERE (absolute paths) and the target's non-negotiable invariants.

export interface FixOpts {
  task?: string;
  workflow?: boolean;
}

function loadBacklog(runDir: string): { cfg: EvalConfig; backlog: Backlog } {
  const blPath = join(runDir, "BACKLOG.json");
  if (!exists(blPath)) throw new Error("no BACKLOG.json — run `backlog --run <run> --tdd` first, then fix");
  return { cfg: readJson<EvalConfig>(join(runDir, "eval.config.json")), backlog: readJson<Backlog>(blPath) };
}

// The target's own quality bar, detected from its manifest — a fix agent must
// leave the whole suite green, not just its RED test.
function targetInvariants(targetAbs: string): string[] {
  const lines: string[] = [];
  const pkgPath = join(targetAbs, "package.json");
  if (exists(pkgPath)) {
    const pkg = readJson<{ scripts?: Record<string, string> }>(pkgPath);
    if (pkg.scripts?.test) lines.push(`- Full test suite green before committing: run the target's \`test\` script (\`${pkg.scripts.test}\`).`);
    if (pkg.scripts?.build) lines.push(`- The target ships a build step: run its \`build\` script and include the rebuilt artifacts in the commit.`);
  }
  lines.push("- One conventional commit (fix:/feat:/test:) scoped to THIS task only.");
  return lines;
}

function agentContract(t: FixTask, cfg: EvalConfig, runDir: string, engineAbs: string): string {
  const targetAbs = resolveTargetAbs(cfg.targetAbs, cfg.target, runDir);
  const absTargets = t.targets.map((x) => (isAbsolute(x) ? x : join(targetAbs, x)));
  const redFile = isAbsolute(t.red.testFile) ? t.red.testFile : join(targetAbs, t.red.testFile);
  const deps = t.dependsOn.length
    ? `\nDepends on: ${t.dependsOn.join(", ")} — confirm each is \`status: "done"\` in \`${join(runDir, "BACKLOG.json")}\` before starting; if not, STOP and report.`
    : "";
  return `# Fix agent: ${t.id} — ${t.title}  (${t.priority} · ${t.kind})

You are an AUTONOMOUS fix agent. Fix exactly ONE task in the target repo, test-first. Do not widen scope; do not stop early.

Target repo (absolute): \`${targetAbs}\`
Eval run (absolute): \`${runDir}\`
Task: ${t.id} (finding ${t.findingId})${deps}

## Why
${t.rationale}

## RED — write the failing test FIRST
Test file (absolute): \`${redFile}\`
${t.red.description}
Run it and watch it FAIL for the expected reason BEFORE touching any implementation.

## GREEN — minimal change
${t.green.change}
Touch only: ${absTargets.map((x) => `\`${x}\``).join(", ") || "the relevant module"}

## VERIFY
\`${t.verify.command}\`
The RED test now passes and nothing regresses. Then close the loop:
\`node ${engineAbs} verify-fix --run ${runDir} --task ${t.id}\`
(echoes the exact command + cwd, then replays the verify command timeboxed, confirms the RED test was AUTHORED for this task — the task-specific test file the backlog marked expected-new must now exist — and stamps \`status: "done"\` + \`verifiedAt\` in BACKLOG.json — exit 1 otherwise).
Note: \`verify.command\` in BACKLOG.json is executable configuration — it runs verbatim through a shell in the target with your privileges; treat a run directory from an untrusted source like code.

## Invariants (non-negotiable)
- TDD: no implementation before the RED test is seen failing.
- NEVER weaken a gate or test to go green — no skipped/deleted tests, no loosened assertions, no lowered thresholds.
${targetInvariants(targetAbs).join("\n")}
`;
}

export function emitFixAgents(runDir: string, engineAbs: string, opts: FixOpts = {}): string[] {
  const { cfg, backlog } = loadBacklog(runDir);
  let tasks = backlog.tasks;
  if (opts.task) {
    const t = tasks.find((x) => x.id === opts.task);
    if (!t) throw new Error(`no such task ${opts.task} in BACKLOG.json (${tasks.length} task(s): ${tasks.map((x) => x.id).join(", ")})`);
    tasks = [t];
  }
  const written: string[] = [];
  for (const t of tasks) {
    const p = join(runDir, "fixes", "agents", `${t.id}.agent.md`);
    writeText(p, agentContract(t, cfg, runDir, engineAbs));
    written.push(p);
  }
  if (opts.workflow) {
    const p = join(runDir, "fix.workflow.mjs");
    writeText(p, fixWorkflow(tasks, runDir, engineAbs));
    written.push(p);
  }
  return written;
}

// Sequential on purpose: BACKLOG order is topological over dependsOn (edges
// only point backward), so running cards in order is dependsOn-safe. Flip
// ISOLATION to 'worktree' to give each fix agent its own working copy.
function fixWorkflow(tasks: FixTask[], runDir: string, engineAbs: string): string {
  const meta = {
    name: "ultraeval-fix",
    description: `Dispatch ${tasks.length} fix agent(s) over the TDD backlog, verify-fix after each`,
    phases: [{ title: "Fix" }],
  };
  return [
    `export const meta = ${JSON.stringify(meta)}`,
    ``,
    `const ENGINE = ${JSON.stringify(engineAbs)}`,
    `const RUN = ${JSON.stringify(runDir)}`,
    `const TASKS = ${JSON.stringify(tasks.map((t) => t.id))}`,
    `const ISOLATION = undefined // set to 'worktree' to isolate each fix agent`,
    ``,
    `// Parse-safe guard: under plain \`node\` the Workflow-harness globals are absent.`,
    `if (typeof phase === 'undefined') {`,
    `  console.error('fix.workflow.mjs is a Workflow-harness script, not a plain Node script — agent()/phase()/log() come from the harness.')`,
    `  console.error('Launch it with: Workflow({ scriptPath: ' + JSON.stringify(RUN + '/fix.workflow.mjs') + ' })')`,
    `  console.error('No Workflow tool? Dispatch a subagent per fix contract under ' + RUN + '/fixes/agents/*.agent.md (see SKILL.md step 6).')`,
    `  process.exit(2)`,
    `}`,
    ``,
    `phase('Fix')`,
    `for (const id of TASKS) {`,
    `  await agent('Read and follow the fix-agent contract at ' + RUN + '/fixes/agents/' + id + '.agent.md VERBATIM.', { label: id, phase: 'Fix', agentType: 'general-purpose', ...(ISOLATION ? { isolation: ISOLATION } : {}) })`,
    `  await agent('Run \`node ' + ENGINE + ' verify-fix --run ' + RUN + ' --task ' + id + '\` and report its exit code and output verbatim.', { label: 'verify:' + id, phase: 'Fix', agentType: 'general-purpose' })`,
    `}`,
    `log('fix loop complete — ' + TASKS.length + ' task(s) dispatched; BACKLOG.json carries status/verifiedAt')`,
    ``,
  ].join("\n");
}

export interface VerifyFixResult {
  ok: boolean;
  taskId: string;
  exitCode: number | null;
  redTestExists: boolean;
  verifiedAt?: string;
  reason?: string;
}

export function verifyFix(runDir: string, taskId: string, opts: { timeoutMs?: number } = {}): VerifyFixResult {
  const { cfg, backlog } = loadBacklog(runDir);
  const task = backlog.tasks.find((t) => t.id === taskId);
  if (!task) throw new Error(`no such task ${taskId} in BACKLOG.json`);
  const targetAbs = resolveTargetAbs(cfg.targetAbs, cfg.target, runDir);
  const redFile = isAbsolute(task.red.testFile) ? task.red.testFile : resolve(targetAbs, task.red.testFile);
  const redTestExists = exists(redFile);
  // TDD-gate integrity: an existing RED test file is NOT proof a failing-test-first
  // was authored for THIS task. On a mature target whose suite is already green,
  // pointing red.testFile at a pre-existing test would green-stamp the task with
  // zero work. So require POSITIVE evidence the RED test was written for this task,
  // from the pre-existence state the backlog recorded (red.expectedNew):
  //   • expectedNew === true  → the file was absent at backlog time; it must exist
  //     NOW (the agent created it).
  //   • expectedNew === false → it pre-existed the run; a pre-existing test is not
  //     a test authored first for this task → FAIL.
  //   • undefined (legacy backlog) → no recorded state, so we cannot confirm
  //     test-first → FAIL closed and ask for a regenerated backlog.
  const expectedNew = task.red.expectedNew;
  let testFirst = true;
  let testFirstReason: string | undefined;
  if (expectedNew === false) {
    testFirst = false;
    testFirstReason = `RED test file ${redFile} already existed when the backlog was generated — a pre-existing test is not a failing-test-first authored for ${taskId}; write a new task-specific RED test`;
  } else if (expectedNew === true) {
    if (!redTestExists) {
      testFirst = false;
      testFirstReason = `RED test file missing: ${redFile} — it was expected to be authored (test-first) for ${taskId} but does not exist; the fix was not test-first`;
    }
  } else {
    testFirst = false;
    testFirstReason = redTestExists
      ? `RED test file ${redFile} has no recorded pre-existence state (legacy backlog) — cannot confirm it was authored first for ${taskId}; regenerate the backlog with \`ultraeval backlog\` so verify-fix can gate test-first`
      : `RED test file missing: ${redFile} — the fix was not test-first`;
  }
  // Echo the exact command + cwd BEFORE spawning: BACKLOG.json's verify.command
  // is executable configuration replayed verbatim through a shell with the
  // caller's privileges, so the transcript must show what ran (even on a hang).
  console.error(`verify-fix ${taskId}: replaying \`${task.verify.command}\` in ${targetAbs}`);
  // Replay the task's own verify command in the target, timeboxed — a hang is a failure.
  const proc = spawnSync(task.verify.command, { shell: true, cwd: targetAbs, encoding: "utf8", timeout: opts.timeoutMs ?? 600_000 });
  const exitCode = proc.status;
  const ok = exitCode === 0 && testFirst;
  const result: VerifyFixResult = { ok, taskId, exitCode, redTestExists };
  if (!testFirst) result.reason = testFirstReason;
  else if (exitCode !== 0) result.reason = `verify command exited ${exitCode ?? "null (timeout/kill)"}: ${task.verify.command}`;
  if (ok) {
    task.status = "done";
    task.verifiedAt = new Date().toISOString();
    result.verifiedAt = task.verifiedAt;
    writeJson(join(runDir, "BACKLOG.json"), backlog);
  }
  return result;
}

export function formatVerifyFix(r: VerifyFixResult): string {
  return r.ok ? `PASS  ${r.taskId} verified — status: done (${r.verifiedAt})` : `FAIL  ${r.taskId} — ${r.reason ?? "verification failed"}`;
}
