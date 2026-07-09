import { realpathSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { changedFiles, runAnalyze } from "./analyze.js";
import { buildBacklog } from "./backlog.js";
import { rankBrainstorm, runBrainstorm } from "./brainstorm.js";
import { checkRun, formatCheckReport } from "./check.js";
import { gateFailures, runCompare } from "./compare.js";
import { writeSarif } from "./sarif.js";
import { clean } from "./clean.js";
import { initRun } from "./init.js";
import { planRun } from "./plan.js";
import { emitFixAgents, formatVerifyFix, verifyFix } from "./fix.js";
import { rejudgeRun } from "./rejudge.js";
import { render } from "./render.js";
import { appendHistory, defaultLedgerPath, formatHistory, formatScore, readHistory, scoreRun } from "./score.js";
import { formatStatus, statusRun } from "./status.js";
import type { EvalConfig, Kind, Mode } from "./types.js";
import { VERSION } from "./types.js";
import { type Args, COMMAND_FLAGS, num, parse, str } from "./cliargs.js";
import { exists, readJson, resolveTargetAbs } from "./util.js";
import { applyVerdicts, formatVerifyReport, runVerify } from "./verify.js";

const HELP = `ultraeval v${VERSION} — evaluate a skill or codebase, then generate grounded, AI-exploitable TDD fix docs.

Usage: node <skill-dir>/scripts/ultraeval.mjs <command> [flags]

Commands:
  init     --target <path> --out <run> [--kind skill|codebase] [--category <c>] [--mode audit|improve|deep] [--bar <n>] [--since <ref>]
             Scaffold an eval run: detect the target, write eval.config.json + starter dimensions + provenance.
             --bar calibrates the meets-expectations threshold (default 80); the applied bar is recorded in the scorecard.
             --since <git-ref> diff-scopes the eval (PR gating): contracts target the changed set; check warns on out-of-scope findings.
  plan     --run <run> [--eco]        (alias: orchestrate — the family verb)
             Generate eval.workflow.mjs (a multi-agent Workflow) + agents/*.md contracts + templates.
             --eco skips the workflow and writes RUNBOOK.md instead — the sequential low-token
             path: same stages, same contracts (played as self-pass checklists), same gates.
  analyze  --run <run> [--since <ref>] [--json]   (or --target <dir> --out <dir>)
             Deterministic repo analysis -> analysis.json + ANALYSIS.md (hotspots, deps, churn, test/doc gaps).
  brainstorm --run <run> [--rank [--check]]
             Emit BRAINSTORM.todo.md (divergent lenses); --rank folds opportunities.json into findings.json (--check gates them).
  compare  --run <new> --base <old> [--json] [--gate]
             Diff two eval runs -> COMPARE.md (score delta, resolved/introduced/retitled findings).
             --json prints the result; --gate exits 1 when the score dropped or a new P0 defect appeared.
  check    --run <run> [--semantic] [--require-verify] [--strict] [--strict-scope] [--min-findings n] [--coverage-min f] [--json]
             Grounding gate: every finding must resolve to a real file:line in the target (or a run: artifact).
             --strict-scope hard-fails a diff-scoped (init --since) run whose findings cite only unchanged files.
             --json prints the CheckResult ({ ok, errors, warnings }) verbatim (exit code unchanged) for CI.
  verify   --run <run> [--apply <verdicts[,v2,…]>] [--max-verify n] [--shards n --shard i] [--honeypots n]
             Adversarial claim<->evidence worklist; --apply reduces verdicts to VERIFY.json.
             --apply <f1,f2,…> merges sharded verdict files (later files win per claim+evidence pair) — reassembles --shards runs.
             --honeypots plants n trap pairs (ground truth in VERIFY.honeypots.json — never show it to skeptics);
             a trap graded supported fails --apply and blocks check --require-verify.
  backlog  --run <run> [--tdd] [--out <dir>]
             Emit BACKLOG.json + REMEDIATION.md from confirmed findings; --tdd also writes fixes/FIX-*.md cards.
  fix      --run <run> [--task FIX-XXX] [--workflow]
             Emit one autonomous fix-agent contract per backlog task (fixes/agents/FIX-*.agent.md, absolute
             paths + target invariants + no-gate-weakening rule); --workflow also emits fix.workflow.mjs.
  verify-fix --run <run> --task FIX-XXX
             Replay the task's verify command (timeboxed) + require its RED test file; stamps status done
             + verifiedAt in BACKLOG.json on success, exit 1 otherwise.
  status   --run <run> [--json]
             Pipeline checklist (which artifacts exist) + the exact next command to run.
  score    --run <run> [--json] [--history [file]]
             Reduce judges.jsonl + config dimensions to a weighted scorecard.json (0-100 + meets-expectations).
             --history appends a one-line ledger entry; the default file is evals/history.jsonl anchored to the
             TARGET repo's git root (stable across cwds), or under the cwd when the target is not a git repo.
  history  [--run <run>] [--file <f>] [<path>] [--json]
             Read back the score-trend the ledger records: each run's overall vs bar, verdict, Δ, and finding counts.
             Ledger resolution: an explicit <path>/--file, else the --run target-anchored default; --json emits the raw array.
  rejudge  --run <run> --out <run2>
             Reuse a completed run's artifacts with a FRESH judge panel (test-retest verdict stability).
             Launch <run2>/rejudge.workflow.mjs, then score --run <run2> and compare --run <run2> --base <run>.
  render   --run <run> [--out <dir>] [--no-html] [--no-md] [--sarif]
             Self-contained dashboard (index.html + index.md), including the verdict when scorecard.json exists.
             --sarif also writes eval.sarif (SARIF 2.1.0) for code-scanning ingestion.
  clean    --run <run> [--all]
             Remove derived gate/render artifacts (keeps deliverables); --all removes the whole run.

  help | --help        version | --version

Exit codes: 0 = ok / gate passed · 1 = gate failed (check/verify) · 2 = usage or runtime error.`;

// COMMAND_FLAGS (the per-command allow-list rejectUnknownFlags enforces) is
// derived from FLAG_SPEC in cliargs.ts alongside the parser's VALUE_FLAGS, so a
// typo'd or value-flag drift between the two registries is now impossible.

// Smallest edit distance for the did-you-mean hint.
function editDistance(a: string, b: string): number {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array<number>(b.length).fill(0)]);
  for (let j = 0; j <= b.length; j++) (dp[0] as number[])[j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      (dp[i] as number[])[j] = Math.min(
        ((dp[i - 1] as number[])[j] as number) + 1,
        ((dp[i] as number[])[j - 1] as number) + 1,
        ((dp[i - 1] as number[])[j - 1] as number) + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
  return (dp[a.length] as number[])[b.length] as number;
}

function rejectUnknownFlags(cmd: string, args: Args): void {
  const known = COMMAND_FLAGS[cmd];
  if (!known) return;
  for (const k of Object.keys(args)) {
    if (k === "_" || k === "help" || k === "version" || known.includes(k)) continue;
    const best = [...known].sort((x, y) => editDistance(k, x) - editDistance(k, y))[0];
    const hint = best && editDistance(k, best) <= 3 ? ` (did you mean --${best}?)` : "";
    throw new Error(`unknown flag --${k} for ${cmd}${hint}`);
  }
}

// Per-command handlers. Each owns exactly one command's body (parse its own
// flags, do the work, set process.exitCode where it gates). main() is a thin
// router: parse → reject unknown flags → look up the handler → own the one catch.
// Extracting per-command bodies isolates per-command churn and makes each handler
// unit-testable without invoking process side effects.

function cmdInit(args: Args): void {
  const target = str(args.target);
  const out = str(args.out);
  if (!target || !out) throw new Error("init requires --target <path> and --out <run>");
  const { cfg, runDir } = initRun({
    target,
    out,
    kind: str(args.kind) as Kind | undefined,
    category: str(args.category),
    mode: str(args.mode) as Mode | undefined,
    bar: num(args.bar),
    since: str(args.since),
  });
  console.log(`ultraeval init: ${cfg.kind} · ${cfg.category} · mode ${cfg.mode} · ${cfg.dimensions.length} dimensions -> ${runDir}`);
}

// `orchestrate` is the family-wide verb (every sibling skill's engine has it);
// `plan` remains the historical ultraeval name. Same command; the handler echoes
// whichever verb was invoked. --eco skips the workflow for a sequential RUNBOOK.
function cmdPlan(args: Args, cmd: string): void {
  const run = str(args.run);
  if (!run) throw new Error(`${cmd} requires --run <run>`);
  const engine = fileURLToPath(import.meta.url);
  const eco = args.eco === true;
  const written = planRun(run, engine, { eco });
  console.log(`ultraeval ${cmd}: generated\n${written.map((w) => `  ${w}`).join("\n")}`);
  if (eco) console.log(`\nSequential eco path: follow ${run}/RUNBOOK.md, playing each agents/*.md contract yourself.`);
  else console.log(`\nLaunch the eval: Workflow({ scriptPath: "${run}/eval.workflow.mjs" })  — or run the stages by hand via agents/*.md`);
}

function cmdAnalyze(args: Args): void {
  const run = str(args.run);
  const since = str(args.since);
  let targetAbs: string | undefined;
  let out: string | undefined;
  if (run) {
    const cfg = readJson<EvalConfig>(join(run, "eval.config.json"));
    targetAbs = resolveTargetAbs(cfg.targetAbs, cfg.target, run);
    out = run;
  } else {
    targetAbs = str(args.target);
    out = str(args.out);
  }
  if (!targetAbs || !out) throw new Error("analyze requires --run <run> (or --target <dir> --out <dir>)");
  const onlyFiles = since ? changedFiles(targetAbs, since) : undefined;
  const a = runAnalyze(targetAbs, out, { onlyFiles });
  if (args.json) console.log(JSON.stringify(a, null, 2));
  else
    console.log(
      `ultraeval analyze: ${a.files} files · ${a.loc} LOC · ${a.hotspots.length} hotspots · ${a.deps.edges} edges · tests ${a.tests.ratio}${since ? ` · since ${since}` : ""} -> ${out}/analysis.json`,
    );
}

function cmdBrainstorm(args: Args): void {
  const run = str(args.run);
  if (!run) throw new Error("brainstorm requires --run <run>");
  if (args.rank) {
    const r = rankBrainstorm(run);
    console.log(`ultraeval brainstorm --rank: +${r.added} opportunities folded into findings.json (${r.total} total)`);
    for (const s of r.skipped) console.log(`  ! skipped${s.title ? ` "${s.title}"` : ""}: ${s.reason}`);
    if (args.check) {
      const c = checkRun(run);
      console.log(formatCheckReport(c, run));
      process.exitCode = c.ok ? 0 : 1;
    } else {
      console.log("  next: `check --run <run>` to gate them.");
    }
  } else {
    const r = runBrainstorm(run);
    console.log(`ultraeval brainstorm: ${r.lenses} lenses -> ${run}/BRAINSTORM.todo.md (fill opportunities.json, then --rank)`);
  }
}

function cmdCompare(args: Args): void {
  const run = str(args.run);
  if (!run) throw new Error("compare requires --run <new-run> and --base <old-run>");
  const base = str(args.base);
  if (!base) throw new Error("compare requires --base <old-run>");
  const r = runCompare(base, run, run);
  if (args.json) {
    const { md: _md, ...rest } = r;
    console.log(JSON.stringify(rest, null, 2));
  } else {
    console.log(
      `ultraeval compare: score Δ ${r.scoreDelta ?? "n/a"} · ${r.resolved.length} resolved · ${r.introduced.length} introduced · ${r.retitled.length} retitled -> ${run}/COMPARE.md`,
    );
  }
  for (const w of r.warnings) console.log(`  ! ${w}`);
  if (args.gate) {
    const fails = gateFailures(r);
    for (const f of fails) console.log(`  ✗ gate: ${f}`);
    process.exitCode = fails.length ? 1 : 0;
  }
}

function cmdCheck(args: Args): void {
  const run = str(args.run);
  if (!run) throw new Error("check requires --run <run>");
  // A nonexistent/uninitialized run is a usage error (exit 2), not a gate verdict (exit 1).
  if (!exists(join(run, "eval.config.json"))) throw new Error(`no eval.config.json under ${run} — not an ultraeval run; run \`ultraeval init\` first`);
  const r = checkRun(run, {
    semantic: !!args.semantic,
    requireVerify: !!args["require-verify"],
    strict: !!args.strict,
    strictScope: !!args["strict-scope"],
    minFindings: num(args["min-findings"]),
    coverageMin: num(args["coverage-min"]),
  });
  console.log(args.json ? JSON.stringify(r, null, 2) : formatCheckReport(r, run));
  // A malformed core artifact is a usage/runtime error (exit 2); a genuine
  // grounding failure is the gate-failed exit 1; a clean run exits 0.
  process.exitCode = r.usageError ? 2 : r.ok ? 0 : 1;
}

function cmdVerify(args: Args): void {
  const run = str(args.run);
  if (!run) throw new Error("verify requires --run <run>");
  const apply = str(args.apply);
  if (apply) {
    const res = applyVerdicts(run, apply);
    console.log(formatVerifyReport(res));
    process.exitCode = res.ok ? 0 : 1;
  } else {
    const shards = num(args.shards);
    const shard = num(args.shard);
    const honeypots = num(args.honeypots);
    const todo = runVerify(run, { maxVerify: num(args["max-verify"]), shards, shard, honeypots });
    const todoName = shards !== undefined && shard !== undefined ? `VERIFY.todo.${shard}.json` : "VERIFY.todo.json";
    // Report the ACTUALLY-planted count, never the requested one — a small
    // run can plant fewer (or zero) traps than asked (pool exhaustion).
    const planted = todo.planted ?? 0;
    const hp = honeypots ? ` (incl. ${planted} honeypot(s))` : "";
    console.log(`ultraeval verify: ${todo.pairs.length} pair(s)${hp} -> ${run}/${todoName} (fill verdicts, then --apply <file>)`);
    if (honeypots && planted < honeypots)
      console.log(
        planted === 0
          ? "  ! 0 planted — run too small for honeypots (need >= 2 gradeable pairs across distinct findings); skeptic-QC will not run"
          : `  ! only ${planted}/${honeypots} honeypot(s) planted — cross-pair pool exhausted; skeptic-QC is thinner than requested`,
      );
  }
}

function cmdBacklog(args: Args): void {
  const run = str(args.run);
  if (!run) throw new Error("backlog requires --run <run>");
  const bl = buildBacklog(run, { tdd: !!args.tdd, out: str(args.out) });
  console.log(`ultraeval backlog: ${bl.tasks.length} fix task(s)${args.tdd ? " + TDD cards" : ""} -> ${str(args.out) ?? run}`);
}

function cmdStatus(args: Args): void {
  const run = str(args.run);
  if (!run) throw new Error("status requires --run <run>");
  const s = statusRun(run);
  console.log(args.json ? JSON.stringify(s, null, 2) : formatStatus(s, run));
}

function cmdScore(args: Args): void {
  const run = str(args.run);
  if (!run) throw new Error("score requires --run <run>");
  const sc = scoreRun(run);
  console.log(args.json ? JSON.stringify(sc, null, 2) : formatScore(sc));
  if (args.history !== undefined) {
    // Default the ledger to the TARGET repo (its git root), not the caller's
    // cwd — subagents/harnesses invoke by absolute path from arbitrary cwds,
    // so a cwd default fragments the one trend across directories (FIX-015).
    const file = typeof args.history === "string" && args.history !== "" ? args.history : defaultLedgerPath(run);
    appendHistory(run, file);
    // keep --json stdout pure JSON — the ledger notice goes to stderr there
    (args.json ? console.error : console.log)(`ultraeval score: history entry appended -> ${file}`);
  }
}

function cmdHistory(args: Args): void {
  const run = str(args.run);
  // Ledger resolution: an explicit path arg / --file wins; otherwise the
  // --run's target-anchored default. Reading a trend must never require a run.
  const explicit = str(args.file) || args._[1];
  const file = explicit || (run ? defaultLedgerPath(run) : undefined);
  if (!file) throw new Error("history requires a ledger path, --file <f>, or --run <run> (to locate the default ledger)");
  const entries = readHistory(file);
  if (args.json) {
    console.log(JSON.stringify(entries, null, 2));
    return;
  }
  console.log(
    entries.length ? formatHistory(entries, file) : `ultraeval history: no ledger entries at ${file} — run \`score --run <run> --history\` to record a trend`,
  );
}

function cmdFix(args: Args): void {
  const run = str(args.run);
  if (!run) throw new Error("fix requires --run <run>");
  const engine = fileURLToPath(import.meta.url);
  const written = emitFixAgents(run, engine, { task: str(args.task), workflow: !!args.workflow });
  console.log(`ultraeval fix: ${written.length} file(s) -> ${run}/fixes/agents (dispatch each *.agent.md to an autonomous fix agent)`);
}

function cmdVerifyFix(args: Args): void {
  const run = str(args.run);
  const task = str(args.task);
  if (!run || !task) throw new Error("verify-fix requires --run <run> and --task FIX-XXX");
  const res = verifyFix(run, task);
  console.log(formatVerifyFix(res));
  process.exitCode = res.ok ? 0 : 1;
}

function cmdRejudge(args: Args): void {
  const run = str(args.run);
  const out = str(args.out);
  if (!run || !out) throw new Error("rejudge requires --run <run> and --out <run2>");
  const engine = fileURLToPath(import.meta.url);
  const copied = rejudgeRun(run, out, engine);
  console.log(`ultraeval rejudge: ${copied.length} artifact(s) reused, fresh judges.jsonl -> ${out}`);
  console.log(`  launch ${out}/rejudge.workflow.mjs, then: score --run ${out} && compare --run ${out} --base ${run}`);
}

function cmdRender(args: Args): void {
  const run = str(args.run);
  if (!run) throw new Error("render requires --run <run>");
  const written = render(run, { out: str(args.out), html: !args["no-html"], md: !args["no-md"] });
  if (args.sarif) written.push(writeSarif(run, str(args.out)));
  console.log(`ultraeval render:\n${written.map((w) => `  ${w}`).join("\n")}`);
}

function cmdClean(args: Args): void {
  const run = str(args.run);
  if (!run) throw new Error("clean requires --run <run>");
  const removed = clean(run, { all: !!args.all });
  console.log(removed.length ? `ultraeval clean: removed\n${removed.map((w) => `  ${w}`).join("\n")}` : "ultraeval clean: nothing to remove");
}

// The dispatch table: command name -> handler. Keyed identically to FLAG_SPEC so
// a command the parser dispatches always has a handler (asserted in cli.test.ts).
export const commandHandlers: Record<string, (args: Args, cmd: string) => void> = {
  init: cmdInit,
  plan: cmdPlan,
  orchestrate: cmdPlan,
  analyze: cmdAnalyze,
  brainstorm: cmdBrainstorm,
  compare: cmdCompare,
  check: cmdCheck,
  verify: cmdVerify,
  backlog: cmdBacklog,
  status: cmdStatus,
  score: cmdScore,
  history: cmdHistory,
  fix: cmdFix,
  "verify-fix": cmdVerifyFix,
  rejudge: cmdRejudge,
  render: cmdRender,
  clean: cmdClean,
};

function main(): void {
  const args = parse(process.argv.slice(2));
  const cmd = args._[0];
  if (args.version || cmd === "version") {
    console.log(VERSION);
    return;
  }
  // Explicit help (`help`, `--help`, `-h`) is success: help on stdout, exit 0.
  if (args.help || cmd === "help") {
    console.log(HELP);
    return;
  }
  // A bare invocation with no subcommand is a usage error, not success: help on
  // stderr, exit 2 (matches the documented "2 = usage or runtime error" contract).
  if (!cmd) {
    console.error(HELP);
    process.exitCode = 2;
    return;
  }
  try {
    rejectUnknownFlags(cmd, args);
    const handler = commandHandlers[cmd];
    if (!handler) {
      console.error(`unknown command: ${cmd}\n\n${HELP}`);
      process.exitCode = 2;
      return;
    }
    handler(args, cmd);
  } catch (e) {
    console.error(`ultraeval ${cmd}: ${(e as Error).message}`);
    process.exitCode = 2;
  }
}

// Run main() only when executed as a script (the shipped bundle), never on import
// — so the command handlers can be unit-tested without triggering process side
// effects (exit codes, stdout) from parsing the test runner's own argv.
function isEntrypoint(): boolean {
  try {
    return import.meta.url === pathToFileURL(realpathSync(process.argv[1] ?? "")).href;
  } catch {
    return false;
  }
}

if (isEntrypoint()) main();
