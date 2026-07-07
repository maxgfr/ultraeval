import { join } from "node:path";
import type { Backlog, EvalConfig, Finding, FindingsDoc, FixTask, VerifyResult } from "./types.js";
import { exists, readJson, slug, writeJson, writeText } from "./util.js";

const SEV_ORDER: Record<string, number> = { P0: 0, P1: 1, P2: 2 };

export interface BacklogOpts {
  out?: string;
  tdd?: boolean;
}

function targetsOf(f: Finding): string[] {
  const set = new Set<string>();
  for (const e of f.evidence ?? []) {
    const ref = e.ref;
    if (ref.startsWith("run:") || ref.startsWith("url:") || /^https?:/.test(ref)) continue;
    const path = /:\d+/.test(ref) ? ref.slice(0, ref.lastIndexOf(":")) : ref;
    set.add(path);
  }
  return [...set];
}

function guessTestFile(targets: string[], f: Finding): string {
  const src = targets.find((t) => /\.(ts|tsx|js|jsx|py|go|rb|java|php)$/.test(t));
  if (src) {
    const dot = src.lastIndexOf(".");
    const ext = src.slice(dot);
    const name = src.slice(0, dot).split("/").pop() ?? "target";
    if (ext === ".py") return `tests/test_${name}.py`;
    if (ext === ".go") return `${src.slice(0, dot)}_test.go`;
    return `tests/${name}.test${ext}`;
  }
  return `tests/${slug(f.title)}.test.ts`;
}

export function buildBacklog(runDir: string, opts: BacklogOpts = {}): Backlog {
  const cfg = readJson<EvalConfig>(join(runDir, "eval.config.json"));
  const doc = readJson<FindingsDoc>(join(runDir, "findings.json"));
  const failed = new Set<string>();
  const vpath = join(runDir, "VERIFY.json");
  if (exists(vpath)) {
    const v = readJson<VerifyResult>(vpath);
    for (const id of v.failures ?? []) failed.add(id);
  }
  const confirmed = (doc.findings ?? [])
    .filter((f) => f.status !== "dismissed" && !failed.has(f.id))
    .sort((a, b) => (SEV_ORDER[a.severity] ?? 9) - (SEV_ORDER[b.severity] ?? 9));

  const tasks: FixTask[] = confirmed.map((f, i) => {
    const targets = targetsOf(f);
    return {
      id: `FIX-${String(i + 1).padStart(3, "0")}`,
      findingId: f.id,
      priority: f.severity,
      title: f.title,
      rationale: f.failureScenario || f.statement,
      targets,
      red: {
        testFile: guessTestFile(targets, f),
        description: f.failureScenario
          ? `Write a failing test that reproduces: ${f.failureScenario}`
          : `Write a failing test asserting the correct behavior for: ${f.statement}`,
      },
      green: { change: f.recommendation || "Make the minimal change that turns the RED test green — without weakening any gate." },
      verify: {
        command:
          cfg.kind === "skill"
            ? "pnpm test  # then re-run the target's own check/verify gate"
            : "run the new test (must pass) + the full suite (nothing regresses)",
      },
      dependsOn: [],
    };
  });

  const out = opts.out ?? runDir;
  const backlog: Backlog = { target: cfg.targetAbs, generatedFrom: runDir, tasks };
  writeJson(join(out, "BACKLOG.json"), backlog);
  writeText(join(out, "REMEDIATION.md"), renderRemediation(backlog, cfg));
  if (opts.tdd) {
    const byId = new Map(doc.findings.map((f) => [f.id, f]));
    for (const t of tasks) writeText(join(out, "fixes", `${t.id}-${slug(t.title)}.md`), renderFixCard(t, byId.get(t.findingId)));
  }
  return backlog;
}

function renderRemediation(bl: Backlog, cfg: EvalConfig): string {
  const groups: Record<string, FixTask[]> = { P0: [], P1: [], P2: [] };
  for (const t of bl.tasks) (groups[t.priority] ?? (groups[t.priority] = [])).push(t);
  const section = (sev: string, label: string) => {
    const items = groups[sev] ?? [];
    if (!items.length) return "";
    return `\n## ${label} (${items.length})\n\n${items.map((t) => `- **${t.id}** ${t.title} — ${t.rationale}\n  - fix: ${t.green.change}\n  - targets: ${t.targets.join(", ") || "—"}`).join("\n")}\n`;
  };
  return `# Remediation plan — ${cfg.target}

Target: \`${bl.target}\` · ${bl.tasks.length} fix task(s), most impactful first.
Each task has a matching TDD card under \`fixes/\` (RED failing test → GREEN change → VERIFY).
${section("P0", "P0 — trust / correctness / data-loss")}${section("P1", "P1 — fidelity / coverage")}${section("P2", "P2 — polish / ergonomics")}`;
}

function renderFixCard(t: FixTask, f?: Finding): string {
  const evidence = (f?.evidence ?? []).map((e) => `\`${e.ref}\``).join(", ") || "—";
  return `# ${t.id} — ${t.title}  (${t.priority})

**Finding ${t.findingId}:** ${f?.statement ?? t.rationale}
**Evidence:** ${evidence}
**Why it matters:** ${t.rationale}

## RED — write this test first
${t.red.description}

Suggested test file: \`${t.red.testFile}\`
Run it and watch it FAIL before you touch the implementation.

## GREEN — make it pass
${t.green.change}

Touch only: ${t.targets.map((x) => `\`${x}\``).join(", ") || "the relevant module"}

## VERIFY
\`${t.verify.command}\`
The RED test now passes and no existing test regresses.
`;
}
