import { type Dirent, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import type { Backlog, EvalConfig, Finding, FindingsDoc, FixTask, Severity, VerifyResult } from "./types.js";
import { SEVERITY_DEFS } from "./types.js";
import { exists, opportunityPriority, opportunityValue, parseEvidenceRef, readJson, resolveTargetAbs, SEV_ORDER, slug, writeJson, writeText } from "./util.js";

export interface BacklogOpts {
  out?: string;
  tdd?: boolean;
}

function targetsOf(f: Finding): string[] {
  const set = new Set<string>();
  for (const e of f.evidence ?? []) {
    const p = parseEvidenceRef(e.ref);
    if (!p.isTargetRef) continue; // skip run:/url: refs — they are not fixable target files
    set.add(p.path); // FIX-012: p.path strips a leading `analysis:` (the old inline parser did not)
  }
  return [...set];
}

// A card that tells the fix agent to create tests/foo.test.ts in a repo that
// keeps its tests colocated (foo.spec.ts) or under src/__tests__/ is pointing
// OUTSIDE the project's convention — and verify-fix then enshrines that wrong
// location. So probe the target for its dominant layout + suffix and follow it,
// falling back to today's tests/<name>.test.<ext> guess when nothing is found.
type TestLayout = "tests" | "test" | "__tests__" | "colocated" | null;
interface TestConvention {
  layout: TestLayout;
  suffix: ".test" | ".spec";
}

const TEST_PATH_RE = /(\.test\.|\.spec\.|_test\.|(^|\/)test_|(^|\/)tests?\/|(^|\/)__tests__\/)/;
const CONV_SKIP = new Set(["node_modules", "dist", "build", "coverage", "out", "vendor", "__pycache__", ".next", ".cache", ".git"]);

function scanTestFiles(targetAbs: string, limit = 500): string[] {
  const found: string[] = [];
  const walk = (dir: string) => {
    if (found.length >= limit) return;
    let entries: Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (found.length >= limit) return;
      const p = join(dir, e.name);
      if (e.isDirectory()) {
        if (!e.name.startsWith(".") && !CONV_SKIP.has(e.name)) walk(p);
        continue;
      }
      const rel = relative(targetAbs, p);
      if (TEST_PATH_RE.test(rel)) found.push(rel);
    }
  };
  walk(targetAbs);
  return found;
}

function detectTestConvention(targetAbs: string): TestConvention {
  const files = scanTestFiles(targetAbs);
  if (!files.length) return { layout: null, suffix: ".test" };
  const spec = files.filter((f) => /\.spec\./.test(f)).length;
  const test = files.filter((f) => /\.test\./.test(f)).length;
  const suffix: ".test" | ".spec" = spec > test ? ".spec" : ".test";
  const has = (re: RegExp) => files.some((f) => re.test(f));
  const layout: TestLayout = has(/(^|\/)__tests__\//) ? "__tests__" : has(/^tests\//) ? "tests" : has(/^test\//) ? "test" : "colocated";
  return { layout, suffix };
}

// `conv` is the target's test convention, detected ONCE per run (it depends only
// on the target, not the finding) and threaded in — see buildBacklog.
function guessTestFile(targets: string[], f: Finding, conv: TestConvention): string {
  const src = targets.find((t) => /\.(ts|tsx|js|jsx|mjs|cjs|py|go|rb|java|php|rs)$/.test(t));
  if (!src) return `tests/${slug(f.title)}.test.ts`;
  const dot = src.lastIndexOf(".");
  const ext = src.slice(dot);
  const stem = src.slice(0, dot); // path without the extension
  const dir = src.includes("/") ? src.slice(0, src.lastIndexOf("/")) : "";
  const name = stem.split("/").pop() ?? "target";
  // Go's test convention is fixed: colocated <name>_test.go regardless of layout.
  if (ext === ".go") return `${stem}_test.go`;
  const inDir = (base: string) => (dir ? `${dir}/${base}` : base);
  if (ext === ".py") {
    if (conv.layout === "colocated") return inDir(`test_${name}.py`);
    return `${conv.layout && conv.layout !== "__tests__" ? conv.layout : "tests"}/test_${name}.py`;
  }
  if (ext === ".rs") return `tests/${name}.rs`; // Rust integration tests live in tests/<name>.rs
  const suffix = conv.suffix;
  if (conv.layout === "colocated") return `${stem}${suffix}${ext}`;
  if (conv.layout === "__tests__") return inDir(`__tests__/${name}${suffix}${ext}`);
  const base = conv.layout ?? "tests"; // "tests" | "test"
  return `${base}/${name}${suffix}${ext}`;
}

// The convention guess can collide with a test file the target ALREADY ships
// (e.g. src/foo.ts's finding guesses tests/foo.test.ts and that file already
// exists and is green). Suggesting that pre-existing file as the RED test is a
// TDD-gate hole: verify-fix would see the file exist and green-stamp the task
// with NO failing-test-first authored. So when the guess already exists, derive
// a fresh, TASK-specific path that does not exist at backlog time — inserting the
// task id so the path stays a recognizable test file for the runner.
function distinctTestPath(rel: string, disc: string): string {
  // JS/TS/… .test./.spec. — insert before the marker so `*.test.js` still matches.
  if (/\.(test|spec)\./.test(rel)) return rel.replace(/\.(test|spec)\./, `.${disc}.$1.`);
  // Go colocated <name>_test.go — keep the trailing _test.<ext>.
  if (/_test\.[^./]+$/.test(rel)) return rel.replace(/_test\.([^./]+)$/, `.${disc}_test.$1`);
  // Python test_<name>.py / Rust tests/<name>.rs / generic — insert before the ext.
  return rel.replace(/\.([^./]+)$/, `.${disc}.$1`);
}
function freshTestFile(guess: string, disc: string, targetAbs: string): string {
  if (!exists(join(targetAbs, guess))) return guess; // the conventional guess is already new
  let candidate = distinctTestPath(guess, disc);
  for (let n = 2; exists(join(targetAbs, candidate)); n++) candidate = distinctTestPath(guess, `${disc}-${n}`);
  return candidate;
}

// A runnable test entrypoint detected from the target's manifest — verify-fix
// replays verify.command verbatim through a shell, so prose must be a last resort.
function detectVerifyCommand(targetAbs: string): string | null {
  if (exists(join(targetAbs, "package.json"))) {
    const pkg = readJson<{ scripts?: Record<string, string> }>(join(targetAbs, "package.json"));
    if (pkg.scripts?.test) {
      if (exists(join(targetAbs, "pnpm-lock.yaml"))) return "pnpm test";
      if (exists(join(targetAbs, "yarn.lock"))) return "yarn test";
      return "npm test";
    }
  }
  if (exists(join(targetAbs, "go.mod"))) return "go test ./...";
  if (exists(join(targetAbs, "Cargo.toml"))) return "cargo test";
  if (exists(join(targetAbs, "pytest.ini")) || exists(join(targetAbs, "pyproject.toml"))) return "pytest";
  return null;
}

export function buildBacklog(runDir: string, opts: BacklogOpts = {}): Backlog {
  const cfg = readJson<EvalConfig>(join(runDir, "eval.config.json"));
  const findingsPath = join(runDir, "findings.json");
  if (!exists(findingsPath)) throw new Error("no findings.json — record findings first (see agents/findings.md), then re-run backlog");
  const doc = readJson<FindingsDoc>(findingsPath);
  const failed = new Set<string>();
  const vpath = join(runDir, "VERIFY.json");
  if (exists(vpath)) {
    const v = readJson<VerifyResult>(vpath);
    for (const id of v.failures ?? []) failed.add(id);
  }
  const targetAbs = resolveTargetAbs(cfg.targetAbs, cfg.target, runDir);
  // Detect the target's test convention + runnable verify command ONCE — both
  // depend only on the target, so recomputing them per finding walked the test
  // tree and re-read the manifest O(findings) times for identical results.
  const conv = detectTestConvention(targetAbs);
  const verifyCommand = detectVerifyCommand(targetAbs);
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
    const id = `FIX-${String(i + 1).padStart(3, "0")}`;
    // Never point the RED test at a file the target already ships — pick a fresh,
    // task-specific path and record that the agent is expected to AUTHOR it, so
    // verify-fix can fail closed unless a genuine failing-test-first was written.
    const testFile = freshTestFile(guessTestFile(targets, f, conv), id, targetAbs);
    return {
      id,
      findingId: f.id,
      kind: f.kind ?? "defect",
      priority: prio(f),
      title: f.title,
      rationale: f.failureScenario || f.statement,
      targets,
      red: {
        testFile,
        expectedNew: !exists(join(targetAbs, testFile)),
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
        // Prefer the runner detected from the target's own manifest/lockfile —
        // verify-fix replays this verbatim through a shell, so a hardcoded pnpm
        // string misleads an npm/yarn/bun target. Prose is only a last resort.
        command:
          verifyCommand ??
          (cfg.kind === "skill"
            ? "pnpm test  # then re-run the target's own check/verify gate"
            : "run the new test (must pass) + the full suite (nothing regresses)"),
      },
      dependsOn: [],
    };
  });

  // Two tasks touching the same file must not run in parallel: chain each task
  // to the previous holder of each of its target files. Backward-only edges in
  // priority order — a cycle is impossible by construction.
  const lastByFile = new Map<string, string>();
  for (const t of tasks) {
    const deps = new Set<string>();
    for (const file of t.targets) {
      const prev = lastByFile.get(file);
      if (prev) deps.add(prev);
    }
    t.dependsOn = [...deps];
    for (const file of t.targets) lastByFile.set(file, t.id);
  }

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
