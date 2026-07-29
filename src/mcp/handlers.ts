import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, join, resolve, sep } from "node:path";
import { changedFiles, runAnalyze } from "../analyze.js";
import { buildBacklog } from "../backlog.js";
import { checkRun } from "../check.js";
import { clean } from "../clean.js";
import { runCompare } from "../compare.js";
import { verifyFix } from "../fix.js";
import { initRun } from "../init.js";
import { render } from "../render.js";
import { writeSarif } from "../sarif.js";
import { scoreRun } from "../score.js";
import { statusRun } from "../status.js";
import { runVerify } from "../verify.js";
import { withRunLock } from "../run-lock.js";

// Where a tool name becomes work. Every handler calls the same library
// functions the CLI does — nothing here shells out to `ultraeval`, and nothing
// here calls cli.ts, whose handlers set process.exitCode and print.

export interface HandlerDefaults {
  defaultRun?: string;
  allowWrite?: boolean;
}

export class ToolError extends Error {}

export interface ToolOutcome {
  text: string;
  artifact?: string;
}

const MAX_READ_LINES = 2000;
const MAX_READ_BYTES = 8 * 1024 * 1024;

const WRITE_TOOL_NAMES = new Set(["ultraeval_init", "ultraeval_render", "ultraeval_verify_fix", "ultraeval_clean"]);

// --------------------------------------------------------------------------
// Argument coercion
// --------------------------------------------------------------------------

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() !== "" ? v : undefined;
}

function num(v: unknown): number | undefined {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : undefined;
}

function bool(v: unknown): boolean {
  return v === true || v === "true";
}

function strArray(v: unknown): string[] | undefined {
  const a = Array.isArray(v) && v.every((x) => typeof x === "string") ? (v as string[]) : undefined;
  return a && a.length ? a : undefined;
}

function positive(v: unknown, key: string): number | undefined {
  const n = num(v);
  if (n === undefined) return undefined;
  if (n <= 0) throw new ToolError(`\`${key}\` must be greater than 0.`);
  return n;
}

function requiredStr(args: Record<string, unknown>, key: string, hint: string): string {
  const v = str(args[key]);
  if (!v) throw new ToolError(`\`${key}\` is required — ${hint}`);
  return v;
}

function requiredRun(args: Record<string, unknown>, defaults: HandlerDefaults): string {
  const run = str(args.run) ?? defaults.defaultRun;
  if (!run) throw new ToolError("`run` is required: the evaluation run directory.");
  if (!isAbsolute(run)) throw new ToolError("`run` must be an absolute path.");
  const abs = resolve(run);
  if (!existsSync(join(abs, "eval.config.json"))) {
    throw new ToolError(`no evaluation run at ${abs} — scaffold one first with ultraeval_init (it writes there).`);
  }
  return abs;
}

// The run's target, read off its config. Every read tool is confined to the run
// and this, so a finding's real code can be opened without a second argument.
function targetOf(run: string): string | undefined {
  try {
    const cfg = JSON.parse(readFileSync(join(run, "eval.config.json"), "utf8")) as { target?: string };
    return typeof cfg.target === "string" ? cfg.target : undefined;
  } catch {
    return undefined;
  }
}

// --------------------------------------------------------------------------
// Dispatch
// --------------------------------------------------------------------------

export async function callTool(name: string, args: Record<string, unknown>, defaults: HandlerDefaults = {}): Promise<ToolOutcome> {
  if (WRITE_TOOL_NAMES.has(name) && !defaults.allowWrite) {
    throw new ToolError(`${name} writes to your filesystem and is disabled — start the server with --allow-write to enable it.`);
  }

  // Creates the run, so there is nothing yet to lock against.
  if (name === "ultraeval_init") return outcome(handleInit(args));

  const run = requiredRun(args, defaults);
  // Serialized per run: verify --apply, backlog, score and verify-fix are all
  // read-merge-write over the same findings, and sharding skeptics across a
  // worklist is exactly the parallel pattern this server invites.
  return await withRunLock(run, async () => {
    try {
      return outcome(dispatch(name, args, run));
    } catch (e) {
      if (e instanceof ToolError) throw e;
      // The library throws plain Errors carrying actionable prose — "the Judge
      // phase has not run", "no findings yet" — and cli.ts turns exactly those
      // into its exit-2 "usage or runtime error" bucket. They are states the
      // caller can fix, not server bugs, so they come back as a readable tool
      // result rather than an internal error the model reads as a crash.
      throw new ToolError((e as Error).message);
    }
  });
}

function dispatch(name: string, args: Record<string, unknown>, run: string): unknown {
  switch (name) {
    case "ultraeval_status":
      return { run, ...statusRun(run) };
    case "ultraeval_analyze":
      return handleAnalyze(args, run);
    case "ultraeval_check":
      return handleCheck(args, run);
    case "ultraeval_verify":
      return handleVerify(args, run);
    case "ultraeval_backlog":
      return handleBacklog(args, run);
    case "ultraeval_score":
      return handleScore(run);
    case "ultraeval_compare":
      return handleCompare(args, run);
    case "ultraeval_history":
      return handleHistory(run);
    case "ultraeval_render":
      return handleRender(args, run);
    case "ultraeval_verify_fix":
      return handleVerifyFix(args, run);
    case "ultraeval_clean":
      return { run, removed: clean(run, { all: bool(args.all) }) };
    case "ultraeval_read":
      return handleRead(args, run);
    default:
      // Unreachable: the server rejects an unknown tool before dispatch.
      throw new ToolError(`unknown tool: ${name}`);
  }
}

function outcome(result: unknown): ToolOutcome {
  return { text: JSON.stringify(result, null, 2) + "\n", artifact: artifactFor(result) };
}

// Where an oversized result already exists on disk, so an over-cap refusal can
// point at it instead of just saying no.
function artifactFor(result: unknown): string | undefined {
  if (typeof result !== "object" || result === null) return undefined;
  const r = result as Record<string, unknown>;
  if (typeof r.path === "string") return r.path;
  return Array.isArray(r.written) && typeof r.written[0] === "string" ? (r.written[0] as string) : undefined;
}

// --------------------------------------------------------------------------
// Handlers
// --------------------------------------------------------------------------

function handleInit(args: Record<string, unknown>): unknown {
  const target = requiredStr(args, "target", "an absolute path to the skill or codebase to evaluate.");
  const out = requiredStr(args, "out", "an absolute path for the run directory.");
  if (!isAbsolute(target)) throw new ToolError("`target` must be an absolute path.");
  if (!isAbsolute(out)) throw new ToolError("`out` must be an absolute path.");
  if (!existsSync(target)) throw new ToolError(`target not found: ${target}`);

  const kind = str(args.kind);
  if (kind !== undefined && kind !== "skill" && kind !== "codebase") throw new ToolError(`\`kind\` must be one of: skill, codebase (got "${kind}")`);
  const mode = str(args.mode);
  if (mode !== undefined && !["audit", "improve", "deep"].includes(mode)) throw new ToolError(`\`mode\` must be one of: audit, improve, deep (got "${mode}")`);

  const res = initRun({
    target,
    out,
    kind: kind as "skill" | "codebase" | undefined,
    mode: mode as "audit" | "improve" | "deep" | undefined,
    bar: positive(args.bar, "bar"),
    since: str(args.since),
    scope: strArray(args.scope),
  });
  return {
    run: res.runDir,
    kind: res.cfg.kind,
    dimensions: res.cfg.dimensions?.length ?? 0,
    next:
      "The engine scaffolded the run and nothing more. Research each dimension against the real target, write findings that cite file:line, " +
      "then prove them with ultraeval_check — an empty run scores nothing, which is a fact about the run and not a grade.",
  };
}

function handleAnalyze(args: Record<string, unknown>, run: string): unknown {
  const target = targetOf(run);
  if (!target) throw new ToolError(`could not read the target from ${join(run, "eval.config.json")}.`);

  // AnalyzeOpts scopes by an explicit file set, so `since` is resolved to one
  // here — the same way cmdAnalyze does it.
  const since = str(args.since);
  let onlyFiles: Set<string> | undefined;
  if (since) {
    onlyFiles = changedFiles(target, since);
    if (!onlyFiles.size) throw new ToolError(`no files changed since "${since}" — nothing to analyze. Drop \`since\` to analyze the whole target.`);
  }

  const analysis = runAnalyze(target, run, onlyFiles ? { onlyFiles } : {});
  return {
    run,
    target,
    ...(since ? { since, scoped_files: onlyFiles?.size } : {}),
    analysis,
    next: "This is where to LOOK. Every finding still has to be earned by reading the code.",
  };
}

function handleRender(args: Record<string, unknown>, run: string): unknown {
  const written = render(run, {});
  // SARIF is a separate writer, exactly as the CLI treats it.
  if (bool(args.sarif)) written.push(writeSarif(run));
  return { run, written };
}

function handleCheck(args: Record<string, unknown>, run: string): unknown {
  const res = checkRun(run, {
    semantic: bool(args.semantic),
    requireVerify: bool(args.require_verify),
    strict: bool(args.strict),
    minFindings: positive(args.min_findings, "min_findings"),
  });
  // ok:false is a verdict, not a failure: the tool did its job and a finding
  // does not resolve.
  return { run, ...res };
}

function handleVerify(args: Record<string, unknown>, run: string): unknown {
  const shards = positive(args.shards, "shards");
  const shard = num(args.shard);
  if (shards !== undefined && shard !== undefined && (shard < 0 || shard >= shards)) {
    throw new ToolError(`\`shard\` must be between 0 and ${shards - 1}.`);
  }
  const res = runVerify(run, {
    maxVerify: positive(args.max_verify, "max_verify"),
    shards,
    shard,
    honeypots: positive(args.honeypots, "honeypots"),
  });
  return {
    ...res,
    run,
    next:
      "Adjudicate each pair against the real code. Any honeypots planted here are traps: grading one 'supported' fails the fold, " +
      "which is how a rubber-stamped adjudication gets caught.",
  };
}

function handleBacklog(args: Record<string, unknown>, run: string): unknown {
  return { run, ...buildBacklog(run, { tdd: bool(args.tdd) }) };
}

function handleScore(run: string): unknown {
  const card = scoreRun(run);
  return {
    run,
    ...card,
    note: "A pure reduction of the judgements recorded in this run. With none recorded it scores nothing — that is a fact about the run, not a grade.",
  };
}

function handleCompare(args: Record<string, unknown>, run: string): unknown {
  const base = requiredStr(args, "base", "the baseline run directory to compare against.");
  if (!isAbsolute(base)) throw new ToolError("`base` must be an absolute path.");
  if (!existsSync(join(base, "eval.config.json"))) throw new ToolError(`no evaluation run at ${base}.`);
  return { run, base, ...runCompare(base, run, run) };
}

function handleHistory(run: string): unknown {
  const target = targetOf(run);
  const file = join(run, "..", "evals", "history.jsonl");
  if (!existsSync(file)) return { run, target, entries: [], note: "No history recorded yet — it accrues one line per scored run." };
  const entries = readFileSync(file, "utf8")
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
  return { run, target, entries };
}

function handleVerifyFix(args: Record<string, unknown>, run: string): unknown {
  const task = requiredStr(args, "task", "the fix task id (e.g. FIX-003).");
  const res = verifyFix(run, task, { timeoutMs: positive(args.timeout_ms, "timeout_ms") });
  return { run, task, ...res };
}

function handleRead(args: Record<string, unknown>, run: string): unknown {
  const raw = requiredStr(args, "path", "relative to the run, or an absolute path inside the run or the target.");
  const target = targetOf(run);
  const abs = isAbsolute(raw) ? raw : join(run, raw);

  // Containment on the REALPATH: a symlink inside the run normalises cleanly as
  // a string and only escapes once the filesystem resolves it. This server can
  // be reached over HTTP.
  let real: string;
  try {
    real = realpathSync(abs);
  } catch {
    throw new ToolError(`no such file: ${raw}`);
  }
  const roots = [run, ...(target ? [target] : [])].map((d) => {
    try {
      return realpathSync(d);
    } catch {
      return resolve(d);
    }
  });
  if (!roots.some((root) => real === root || real.startsWith(root + sep))) {
    throw new ToolError(`path is outside the run and its target: ${raw}. Use your own file tool for anything else.`);
  }

  const st = statSync(real);
  if (!st.isFile()) throw new ToolError(`not a file: ${raw}`);
  if (st.size > MAX_READ_BYTES) throw new ToolError(`file is too large to read (${st.size} bytes): ${raw}`);

  const lines = readFileSync(real, "utf8").split("\n");
  const total = lines.length;
  const start = Math.max(1, Math.floor(num(args.start_line) ?? 1));
  if (start > total) throw new ToolError(`start_line ${start} is past the end of the file (${total} lines).`);
  const requestedEnd = Math.floor(num(args.end_line) ?? total);
  const end = Math.min(total, Math.max(start, requestedEnd), start + MAX_READ_LINES - 1);

  return {
    path: isAbsolute(raw) ? real : raw,
    start_line: start,
    end_line: end,
    total_lines: total,
    truncated: end < Math.min(total, requestedEnd),
    content: lines.slice(start - 1, end).join("\n"),
  };
}
