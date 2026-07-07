import { fileURLToPath } from "node:url";
import { buildBacklog } from "./backlog.js";
import { checkRun, formatCheckReport } from "./check.js";
import { clean } from "./clean.js";
import { initRun } from "./init.js";
import { planRun } from "./plan.js";
import { render } from "./render.js";
import type { Kind } from "./types.js";
import { VERSION } from "./types.js";
import { applyVerdicts, formatVerifyReport, runVerify } from "./verify.js";

const HELP = `ultraeval v${VERSION} — evaluate a skill or codebase, then generate grounded, AI-exploitable TDD fix docs.

Usage: node <skill-dir>/scripts/ultraeval.mjs <command> [flags]

Commands:
  init     --target <path> --out <run> [--kind skill|codebase] [--category <c>]
             Scaffold an eval run: detect the target, write eval.config.json + starter dimensions.
  plan     --run <run>
             Generate eval.workflow.mjs (a multi-agent Workflow) + agents/*.md contracts + templates.
  check    --run <run> [--semantic] [--require-verify] [--strict] [--min-findings n] [--coverage-min f]
             Grounding gate: every finding must resolve to a real file:line in the target (or a run: artifact).
  verify   --run <run> [--apply <verdicts>] [--max-verify n] [--shards n --shard i]
             Adversarial claim<->evidence worklist; --apply reduces verdicts to VERIFY.json.
  backlog  --run <run> [--tdd] [--out <dir>]
             Emit BACKLOG.json + REMEDIATION.md from confirmed findings; --tdd also writes fixes/FIX-*.md cards.
  render   --run <run> [--out <dir>] [--no-html] [--no-md]
             Self-contained dashboard (index.html + index.md).
  clean    --run <run> [--all]
             Remove derived gate/render artifacts (keeps deliverables); --all removes the whole run.

  help | --help        version | --version`;

interface Args {
  _: string[];
  [k: string]: string | boolean | string[];
}

const VALUE_FLAGS = new Set([
  "--target",
  "--out",
  "--run",
  "--kind",
  "--category",
  "--apply",
  "--min-findings",
  "--coverage-min",
  "--max-verify",
  "--shards",
  "--shard",
]);

function parse(argv: string[]): Args {
  const args: Args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === undefined) continue;
    if (a === "-h") args.help = true;
    else if (a === "-v") args.version = true;
    else if (a.startsWith("--")) {
      if (VALUE_FLAGS.has(a)) args[a.slice(2)] = argv[++i] ?? "";
      else args[a.slice(2)] = true;
    } else args._.push(a);
  }
  return args;
}

function num(v: string | boolean | string[] | undefined): number | undefined {
  return typeof v === "string" && v !== "" ? Number(v) : undefined;
}
function str(v: string | boolean | string[] | undefined): string | undefined {
  return typeof v === "string" ? v : undefined;
}

function main(): void {
  const args = parse(process.argv.slice(2));
  const cmd = args._[0];
  if (args.help || cmd === "help" || !cmd) {
    console.log(HELP);
    return;
  }
  if (args.version || cmd === "version") {
    console.log(VERSION);
    return;
  }
  const run = str(args.run);
  try {
    switch (cmd) {
      case "init": {
        const target = str(args.target);
        const out = str(args.out);
        if (!target || !out) throw new Error("init requires --target <path> and --out <run>");
        const { cfg, runDir } = initRun({ target, out, kind: str(args.kind) as Kind | undefined, category: str(args.category) });
        console.log(`ultraeval init: ${cfg.kind} · ${cfg.category} · ${cfg.dimensions.length} dimensions -> ${runDir}`);
        return;
      }
      case "plan": {
        if (!run) throw new Error("plan requires --run <run>");
        const engine = fileURLToPath(import.meta.url);
        const written = planRun(run, engine);
        console.log(`ultraeval plan: generated\n${written.map((w) => `  ${w}`).join("\n")}`);
        console.log(`\nLaunch the eval: Workflow({ scriptPath: "${run}/eval.workflow.mjs" })  — or run the stages by hand via agents/*.md`);
        return;
      }
      case "check": {
        if (!run) throw new Error("check requires --run <run>");
        const r = checkRun(run, {
          semantic: !!args.semantic,
          requireVerify: !!args["require-verify"],
          strict: !!args.strict,
          minFindings: num(args["min-findings"]),
          coverageMin: num(args["coverage-min"]),
        });
        console.log(formatCheckReport(r, run));
        process.exitCode = r.ok ? 0 : 1;
        return;
      }
      case "verify": {
        if (!run) throw new Error("verify requires --run <run>");
        const apply = str(args.apply);
        if (apply) {
          const res = applyVerdicts(run, apply);
          console.log(formatVerifyReport(res));
          process.exitCode = res.ok ? 0 : 1;
        } else {
          const todo = runVerify(run, { maxVerify: num(args["max-verify"]), shards: num(args.shards), shard: num(args.shard) });
          console.log(`ultraeval verify: ${todo.pairs.length} pair(s) -> ${run}/VERIFY.todo.json (fill verdicts, then --apply <file>)`);
        }
        return;
      }
      case "backlog": {
        if (!run) throw new Error("backlog requires --run <run>");
        const bl = buildBacklog(run, { tdd: !!args.tdd, out: str(args.out) });
        console.log(`ultraeval backlog: ${bl.tasks.length} fix task(s)${args.tdd ? " + TDD cards" : ""} -> ${str(args.out) ?? run}`);
        return;
      }
      case "render": {
        if (!run) throw new Error("render requires --run <run>");
        const written = render(run, { out: str(args.out), html: !args["no-html"], md: !args["no-md"] });
        console.log(`ultraeval render:\n${written.map((w) => `  ${w}`).join("\n")}`);
        return;
      }
      case "clean": {
        if (!run) throw new Error("clean requires --run <run>");
        const removed = clean(run, { all: !!args.all });
        console.log(removed.length ? `ultraeval clean: removed\n${removed.map((w) => `  ${w}`).join("\n")}` : "ultraeval clean: nothing to remove");
        return;
      }
      default:
        console.error(`unknown command: ${cmd}\n\n${HELP}`);
        process.exitCode = 2;
    }
  } catch (e) {
    console.error(`ultraeval ${cmd}: ${(e as Error).message}`);
    process.exitCode = 2;
  }
}

main();
