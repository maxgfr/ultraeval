import { join } from "node:path";
import type { Backlog, EvalConfig, Finding, FindingsDoc, FixTask, Severity, VerifyResult } from "./types.js";
import { SEVERITY_DEFS } from "./types.js";
import { exists, opportunityPriority, opportunityValue, readJson, slug, writeJson, writeText } from "./util.js";

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
  const prio = (f: Finding): Severity => (f.kind === "opportunity" ? opportunityPriority(f.impact) : f.severity);
  const confirmed = (doc.findings ?? [])
    .filter((f) => f.status !== "dismissed" && !failed.has(f.id))
    .sort((a, b) => {
      const pa = SEV_ORDER[prio(a)] ?? 9;
      const pb = SEV_ORDER[prio(b)] ?? 9;
      if (pa !== pb) return pa - pb;
      // within a band, rank opportunities by value (impact/effort); defects keep order
      const va = a.kind === "opportunity" ? opportunityValue(a.impact, a.effort) : 0;
      const vb = b.kind === "opportunity" ? opportunityValue(b.impact, b.effort) : 0;
      return vb - va;
    });

  const tasks: FixTask[] = confirmed.map((f, i) => {
    const targets = targetsOf(f);
    const isOpp = f.kind === "opportunity";
    return {
      id: `FIX-${String(i + 1).padStart(3, "0")}`,
      findingId: f.id,
      kind: f.kind ?? "defect",
      priority: prio(f),
      title: f.title,
      rationale: f.failureScenario || f.statement,
      targets,
      red: {
        testFile: guessTestFile(targets, f),
        description: isOpp
          ? `Write a spec/characterization test that pins the desired behavior: ${f.recommendation || f.statement}`
          : f.failureScenario
            ? `Write a failing test that reproduces: ${f.failureScenario}`
            : `Write a failing test asserting the correct behavior for: ${f.statement}`,
      },
      green: {
        change:
          f.recommendation ||
          (isOpp
            ? "Implement the improvement so the spec test passes."
            : "Make the minimal change that turns the RED test green — without weakening any gate."),
      },
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
${(["P0", "P1", "P2"] as const).map((s) => section(s, `${s} — ${SEVERITY_DEFS[s].label}: ${SEVERITY_DEFS[s].meaning}`)).join("")}`;
}

function renderFixCard(t: FixTask, f?: Finding): string {
  const evidence = (f?.evidence ?? []).map((e) => `\`${e.ref}\``).join(", ") || "—";
  const tag = t.kind === "opportunity" ? `OPPORTUNITY · impact ${f?.impact ?? "?"} · effort ${f?.effort ?? "?"}` : "DEFECT";
  return `# ${t.id} — ${t.title}  (${t.priority} · ${tag})

**${t.kind === "opportunity" ? "Opportunity" : "Finding"} ${t.findingId}:** ${f?.statement ?? t.rationale}
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
