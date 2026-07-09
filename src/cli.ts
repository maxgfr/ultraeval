import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { changedFiles, runAnalyze } from "./analyze.js";
import { buildBacklog } from "./backlog.js";
import { rankBrainstorm, runBrainstorm } from "./brainstorm.js";
import { checkRun, formatCheckReport } from "./check.js";
import { gateFailures, runCompare } from "./compare.js";
import { writeSarif } from "./sarif.js";
import { clean } from "./clean.js";
import { initRun } from "./init.js";
import { planRun } from "./plan.js";
import { render } from "./render.js";
import { formatScore, scoreRun } from "./score.js";
import type { EvalConfig, Kind, Mode } from "./types.js";
import { VERSION } from "./types.js";
import { readJson, resolveTargetAbs } from "./util.js";
import { applyVerdicts, formatVerifyReport, runVerify } from "./verify.js";

const HELP = `ultraeval v${VERSION} — evaluate a skill or codebase, then generate grounded, AI-exploitable TDD fix docs.

Usage: node <skill-dir>/scripts/ultraeval.mjs <command> [flags]

Commands:
  init     --target <path> --out <run> [--kind skill|codebase] [--category <c>] [--mode audit|improve|deep] [--bar <n>]
             Scaffold an eval run: detect the target, write eval.config.json + starter dimensions + provenance.
             --bar calibrates the meets-expectations threshold (default 80); the applied bar is recorded in the scorecard.
  plan     --run <run>
             Generate eval.workflow.mjs (a multi-agent Workflow) + agents/*.md contracts + templates.
  analyze  --run <run> [--since <ref>] [--json]   (or --target <dir> --out <dir>)
             Deterministic repo analysis -> analysis.json + ANALYSIS.md (hotspots, deps, churn, test/doc gaps).
  brainstorm --run <run> [--rank [--check]]
             Emit BRAINSTORM.todo.md (divergent lenses); --rank folds opportunities.json into findings.json (--check gates them).
  compare  --run <new> --base <old> [--json] [--gate]
             Diff two eval runs -> COMPARE.md (score delta, resolved/introduced/retitled findings).
             --json prints the result; --gate exits 1 when the score dropped or a new P0 defect appeared.
  check    --run <run> [--semantic] [--require-verify] [--strict] [--min-findings n] [--coverage-min f]
             Grounding gate: every finding must resolve to a real file:line in the target (or a run: artifact).
  verify   --run <run> [--apply <verdicts>] [--max-verify n] [--shards n --shard i]
             Adversarial claim<->evidence worklist; --apply reduces verdicts to VERIFY.json.
  backlog  --run <run> [--tdd] [--out <dir>]
             Emit BACKLOG.json + REMEDIATION.md from confirmed findings; --tdd also writes fixes/FIX-*.md cards.
  score    --run <run> [--json]
             Reduce judges.jsonl + config dimensions to a weighted scorecard.json (0-100 + meets-expectations).
  render   --run <run> [--out <dir>] [--no-html] [--no-md] [--sarif]
             Self-contained dashboard (index.html + index.md), including the verdict when scorecard.json exists.
             --sarif also writes eval.sarif (SARIF 2.1.0) for code-scanning ingestion.
  clean    --run <run> [--all]
             Remove derived gate/render artifacts (keeps deliverables); --all removes the whole run.

  help | --help        version | --version

Exit codes: 0 = ok / gate passed · 1 = gate failed (check/verify) · 2 = usage or runtime error.`;

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
  "--mode",
  "--since",
  "--base",
  "--apply",
  "--min-findings",
  "--coverage-min",
  "--max-verify",
  "--shards",
  "--shard",
  "--bar",
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
  if (args.version || cmd === "version") {
    console.log(VERSION);
    return;
  }
  if (args.help || cmd === "help" || !cmd) {
    console.log(HELP);
    return;
  }
  const run = str(args.run);
  try {
    switch (cmd) {
      case "init": {
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
        });
        console.log(`ultraeval init: ${cfg.kind} · ${cfg.category} · mode ${cfg.mode} · ${cfg.dimensions.length} dimensions -> ${runDir}`);
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
      case "analyze": {
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
        return;
      }
      case "brainstorm": {
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
        return;
      }
      case "compare": {
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
          const shards = num(args.shards);
          const shard = num(args.shard);
          const todo = runVerify(run, { maxVerify: num(args["max-verify"]), shards, shard });
          const todoName = shards !== undefined && shard !== undefined ? `VERIFY.todo.${shard}.json` : "VERIFY.todo.json";
          console.log(`ultraeval verify: ${todo.pairs.length} pair(s) -> ${run}/${todoName} (fill verdicts, then --apply <file>)`);
        }
        return;
      }
      case "backlog": {
        if (!run) throw new Error("backlog requires --run <run>");
        const bl = buildBacklog(run, { tdd: !!args.tdd, out: str(args.out) });
        console.log(`ultraeval backlog: ${bl.tasks.length} fix task(s)${args.tdd ? " + TDD cards" : ""} -> ${str(args.out) ?? run}`);
        return;
      }
      case "score": {
        if (!run) throw new Error("score requires --run <run>");
        const sc = scoreRun(run);
        console.log(args.json ? JSON.stringify(sc, null, 2) : formatScore(sc));
        return;
      }
      case "render": {
        if (!run) throw new Error("render requires --run <run>");
        const written = render(run, { out: str(args.out), html: !args["no-html"], md: !args["no-md"] });
        if (args.sarif) written.push(writeSarif(run, str(args.out)));
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
