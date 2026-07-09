#!/usr/bin/env node

// src/cli.ts
import { join as join18 } from "path";
import { fileURLToPath } from "url";

// src/analyze.ts
import { execFileSync } from "child_process";
import { readdirSync as readdirSync2, readFileSync as readFileSync2 } from "fs";
import { extname, join as join2, relative as relative2 } from "path";

// src/util.ts
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, isAbsolute, join, relative, resolve } from "path";
function exists(p) {
  return existsSync(p);
}
function ensureDir(p) {
  mkdirSync(p, { recursive: true });
}
function readText(p) {
  return readFileSync(p, "utf8");
}
function writeText(p, s) {
  ensureDir(dirname(p));
  writeFileSync(p, s);
}
function readJson(p) {
  return JSON.parse(readFileSync(p, "utf8"));
}
function writeJson(p, data) {
  writeText(p, `${JSON.stringify(data, null, 2)}
`);
}
function slug(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "item";
}
function listMarkdown(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith(".md")) out.push(p);
    }
  };
  walk(dir);
  return out;
}
function resolveTargetAbs(targetAbs, target, runDir) {
  if (targetAbs && existsSync(targetAbs)) return targetAbs;
  return resolve(runDir, target);
}
function parseLineSpec(spec) {
  const m = spec.match(/^(\d+)(?:-(\d+))?$/);
  if (!m) return null;
  const start = Number(m[1]);
  const end = m[2] ? Number(m[2]) : start;
  return { start, end };
}
function lineCount(absPath) {
  const raw = readFileSync(absPath, "utf8");
  if (raw === "") return 0;
  const n = raw.split("\n").length;
  return raw.endsWith("\n") ? n - 1 : n;
}
function resolveEvidence(ref, opts) {
  let raw = String(ref ?? "").trim();
  if (raw.startsWith("analysis:")) raw = raw.slice("analysis:".length);
  if (raw.startsWith("url:") || /^https?:\/\//.test(raw)) {
    return { raw, kind: "url", gradeable: false, resolved: false, reason: "external URL (not resolvable offline)" };
  }
  if (raw.startsWith("run:")) {
    const body = raw.slice(4);
    const [rel2 = "", anchor] = body.split("#");
    const absPath2 = resolve(opts.runDir, rel2);
    const relFromRun = relative(opts.runDir, absPath2);
    if (relFromRun.startsWith("..") || isAbsolute(relFromRun)) {
      return { raw, kind: "external", gradeable: false, resolved: false, reason: "path escapes the run directory (not graded)", absPath: absPath2 };
    }
    if (!existsSync(absPath2)) return { raw, kind: "run", gradeable: true, resolved: false, reason: `run artifact not found: ${rel2}`, absPath: absPath2 };
    const line = anchor?.match(/^L(\d+)$/);
    if (line) {
      const n = Number(line[1]);
      const total = lineCount(absPath2);
      if (n < 1 || n > total)
        return { raw, kind: "run", gradeable: true, resolved: false, reason: `line ${n} out of range (1-${total})`, absPath: absPath2, lineStart: n, lineEnd: n };
      return { raw, kind: "run", gradeable: true, resolved: true, absPath: absPath2, lineStart: n, lineEnd: n };
    }
    return { raw, kind: "run", gradeable: true, resolved: true, absPath: absPath2 };
  }
  let path = raw;
  let lineSpec = null;
  const lastColon = raw.lastIndexOf(":");
  if (lastColon > 0) {
    const maybe = parseLineSpec(raw.slice(lastColon + 1));
    if (maybe) {
      path = raw.slice(0, lastColon);
      lineSpec = maybe;
    }
  }
  const absPath = isAbsolute(path) ? path : resolve(opts.targetAbs, path);
  const rel = relative(opts.targetAbs, absPath);
  const outsideTarget = rel.startsWith("..") || isAbsolute(rel);
  if (outsideTarget) {
    return { raw, kind: "external", gradeable: false, resolved: false, reason: "path is outside the target repo (not graded)", absPath };
  }
  if (!existsSync(absPath)) {
    return {
      raw,
      kind: "file",
      gradeable: true,
      resolved: false,
      reason: `file not found: ${path}`,
      absPath,
      lineStart: lineSpec?.start,
      lineEnd: lineSpec?.end
    };
  }
  if (lineSpec) {
    const total = lineCount(absPath);
    if (lineSpec.start < 1 || lineSpec.end < lineSpec.start || lineSpec.end > total) {
      return {
        raw,
        kind: "file",
        gradeable: true,
        resolved: false,
        reason: `line ${lineSpec.start}-${lineSpec.end} out of range (1-${total}) \u2014 hallucinated or stale`,
        absPath,
        lineStart: lineSpec.start,
        lineEnd: lineSpec.end
      };
    }
    return { raw, kind: "file", gradeable: true, resolved: true, absPath, lineStart: lineSpec.start, lineEnd: lineSpec.end };
  }
  return { raw, kind: "file", gradeable: true, resolved: true, absPath };
}
function extractContext(absPath, start, end, pad = 2) {
  if (!existsSync(absPath)) return "";
  const lines = readFileSync(absPath, "utf8").split("\n");
  if (start === void 0) return lines.slice(0, 12).join("\n");
  const from = Math.max(0, start - 1 - pad);
  const to = Math.min(lines.length, (end ?? start) + pad);
  return lines.slice(from, to).map((l, i) => `${from + i + 1}: ${l}`).join("\n");
}
var SEV_ORDER = { P0: 0, P1: 1, P2: 2 };
var titleKey = (title) => title.toLowerCase().trim();
function opportunityValue(impact, effort) {
  const i = impact === "high" ? 3 : impact === "med" ? 2 : 1;
  const e = effort === "S" ? 1 : effort === "M" ? 2 : 3;
  return i / e;
}
function opportunityPriority(impact) {
  return impact === "high" ? "P1" : "P2";
}

// src/analyze.ts
var SKIP_DIRS = /* @__PURE__ */ new Set(["node_modules", "dist", "build", "coverage", "out", "vendor", "__pycache__", ".next", ".cache"]);
var CODE_EXT = /* @__PURE__ */ new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".py", ".go", ".rb", ".php", ".java", ".rs", ".vue", ".svelte"]);
var TEST_RE = /(\.test\.|\.spec\.|_test\.|(^|\/)test_|(^|\/)tests?\/)/;
var LARGE_LOC = 300;
var DEEP_NEST = 7;
function locOf(content) {
  if (!content) return 0;
  const body = content.endsWith("\n") ? content.slice(0, -1) : content;
  return body.split("\n").length;
}
function maxIndentOf(content) {
  let max = 0;
  for (const l of content.split("\n")) {
    if (!l.trim()) continue;
    const ws = (l.match(/^[ \t]*/)?.[0] ?? "").replace(/\t/g, "  ").length;
    max = Math.max(max, Math.floor(ws / 2));
  }
  return max;
}
function importsOf(content, ext) {
  const out = [];
  if (ext === ".py") {
    for (const m of content.matchAll(/^\s*(?:from\s+(\S+)\s+import|import\s+(\S+))/gm)) out.push((m[1] ?? m[2] ?? "").split(".")[0] ?? "");
    return out;
  }
  for (const m of content.matchAll(/(?:from\s+|require\(\s*|import\(\s*)['"]([^'"]+)['"]/g)) out.push(m[1] ?? "");
  return out;
}
function walkFiles(root) {
  const out = [];
  const walk = (dir) => {
    let entries;
    try {
      entries = readdirSync2(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = join2(dir, e.name);
      if (e.isDirectory()) {
        if (!e.name.startsWith(".") && !SKIP_DIRS.has(e.name)) walk(p);
        continue;
      }
      const ext = extname(e.name);
      if (!CODE_EXT.has(ext)) continue;
      let content = "";
      try {
        content = readFileSync2(p, "utf8");
      } catch {
        continue;
      }
      const rel = relative2(root, p);
      out.push({
        rel,
        ext,
        loc: locOf(content),
        isTest: TEST_RE.test(rel),
        imports: importsOf(content, ext),
        todos: (content.match(/\b(TODO|FIXME|HACK|XXX)\b/g) ?? []).length,
        maxIndent: maxIndentOf(content)
      });
    }
  };
  walk(root);
  return out;
}
function resolveImport(imp, fromRel, relSet) {
  if (!imp.startsWith(".")) return null;
  const dir = fromRel.includes("/") ? fromRel.slice(0, fromRel.lastIndexOf("/")) : "";
  const base = join2(dir, imp);
  const cands = [
    base,
    base.replace(/\.(js|mjs|cjs)$/, ".ts"),
    base.replace(/\.(js|mjs|cjs)$/, ".tsx"),
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.js`,
    `${base}.jsx`,
    `${base}.mjs`,
    `${base}/index.ts`,
    `${base}/index.js`
  ];
  for (const c of cands) if (relSet.has(c)) return c;
  return null;
}
function findCycles(adj) {
  const cycles = [];
  const color = /* @__PURE__ */ new Map();
  const stack = [];
  const dfs = (u) => {
    color.set(u, 1);
    stack.push(u);
    for (const v of adj.get(u) ?? []) {
      const c = color.get(v) ?? 0;
      if (c === 0) dfs(v);
      else if (c === 1) {
        const i = stack.indexOf(v);
        if (i >= 0) cycles.push(stack.slice(i));
      }
    }
    stack.pop();
    color.set(u, 2);
  };
  for (const u of adj.keys()) if ((color.get(u) ?? 0) === 0) dfs(u);
  return cycles;
}
function gitChurn(root) {
  const m = /* @__PURE__ */ new Map();
  try {
    const out = execFileSync("git", ["-C", root, "log", "--pretty=format:", "--name-only"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      maxBuffer: 32 * 1024 * 1024
    });
    for (const line of out.split("\n")) {
      const f = line.trim();
      if (f) m.set(f, (m.get(f) ?? 0) + 1);
    }
    return { churn: m, ok: true };
  } catch {
    return { churn: m, ok: false };
  }
}
function testSubject(rel) {
  const base = (rel.split("/").pop() ?? "").replace(/\.[^.]+$/, "");
  return base.replace(/\.(test|spec)$/, "").replace(/_test$/, "").replace(/^test_/, "");
}
function buildTestSubjects(files) {
  const set = /* @__PURE__ */ new Set();
  for (const t of files) if (t.isTest) set.add(testSubject(t.rel));
  return set;
}
function hasTest(f, testSubjects) {
  const base = (f.rel.split("/").pop() ?? "").replace(/\.[^.]+$/, "");
  return !!base && testSubjects.has(base);
}
function isGenerated(f, relSet) {
  if (!/\.(js|mjs|cjs)$/.test(f.rel) || f.loc < 400) return false;
  return f.imports.every((imp) => resolveImport(imp, f.rel, relSet) === null);
}
function changedFiles(targetAbs, since) {
  const set = /* @__PURE__ */ new Set();
  const gitList = (args) => {
    try {
      return execFileSync("git", ["-C", targetAbs, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    } catch {
      return "";
    }
  };
  for (const line of `${gitList(["diff", "--name-only", since, "--"])}
${gitList(["ls-files", "--others", "--exclude-standard"])}`.split("\n")) {
    const f = line.trim();
    if (f) set.add(f);
  }
  return set;
}
function analyzeRepo(targetAbs, opts = {}) {
  const all = walkFiles(targetAbs);
  const fullSet = new Set(all.map((f) => f.rel));
  let files = all.filter((f) => !isGenerated(f, fullSet));
  if (opts.onlyFiles) files = files.filter((f) => opts.onlyFiles?.has(f.rel));
  const relSet = new Set(files.map((f) => f.rel));
  const { churn, ok: churnOk } = gitChurn(targetAbs);
  const notes = [];
  if (!churnOk) notes.push("git churn unavailable (not a git repo, or git missing) \u2014 hotspots are ranked by size only");
  let edges = 0;
  const adj = /* @__PURE__ */ new Map();
  for (const f of files) {
    for (const imp of f.imports) {
      const to = resolveImport(imp, f.rel, relSet);
      if (to && to !== f.rel) {
        edges++;
        const set = adj.get(f.rel) ?? /* @__PURE__ */ new Set();
        set.add(to);
        adj.set(f.rel, set);
      }
    }
  }
  const cycles = findCycles(adj).slice(0, 5);
  const score = (f) => f.loc + (churn.get(f.rel) ?? 0) * 20;
  const hotspots = [...files].sort((a, b) => score(b) - score(a)).slice(0, 12).map((f) => {
    const ch = churn.get(f.rel);
    const reasons = [`${f.loc} LOC`];
    if (f.loc >= LARGE_LOC) reasons[0] = `large: ${f.loc} LOC`;
    if (ch && ch >= 10) reasons.push(`${ch} commits (churn)`);
    if (f.maxIndent >= DEEP_NEST) reasons.push(`nesting depth ${f.maxIndent}`);
    return { path: f.rel, loc: f.loc, churn: ch, reason: reasons.join(", ") };
  });
  const src = files.filter((f) => !f.isTest);
  const testFiles = files.filter((f) => f.isTest).length;
  const testSubjects = buildTestSubjects(files);
  const untested = src.filter((f) => !hasTest(f, testSubjects)).map((f) => f.rel).slice(0, 20);
  const languages = {};
  for (const f of files) languages[f.ext] = (languages[f.ext] ?? 0) + 1;
  const docs = ["README.md", "DOCUMENTATION.md", "CONTRIBUTING.md", "docs"].filter((d) => exists(join2(targetAbs, d)));
  return {
    target: targetAbs,
    files: files.length,
    loc: files.reduce((a, f) => a + f.loc, 0),
    languages,
    hotspots,
    deps: { edges, cycles },
    tests: { sourceFiles: src.length, testFiles, ratio: src.length ? Number((testFiles / src.length).toFixed(2)) : 0, untested },
    todos: files.reduce((a, f) => a + f.todos, 0),
    docs,
    notes
  };
}
function runAnalyze(targetDir, outDir, opts = {}) {
  const a = analyzeRepo(targetDir, opts);
  writeJson(join2(outDir, "analysis.json"), a);
  writeText(join2(outDir, "ANALYSIS.md"), renderAnalysisMd(a));
  return a;
}
function renderAnalysisMd(a) {
  const langs = Object.entries(a.languages).sort((x, y) => y[1] - x[1]).map(([e, n]) => `${e} ${n}`).join(" \xB7 ");
  return `# Analysis \u2014 ${a.target}

${(a.notes ?? []).map((n) => `> \u26A0 ${n}
`).join("")}${a.files} files \xB7 ${a.loc} LOC \xB7 ${langs}
deps: ${a.deps.edges} local import edges${a.deps.cycles.length ? `, ${a.deps.cycles.length} cycle(s)` : ""} \xB7 tests: ${a.tests.testFiles}/${a.tests.sourceFiles} (ratio ${a.tests.ratio}) \xB7 TODO/FIXME: ${a.todos} \xB7 docs: ${a.docs.join(", ") || "none"}

## Hotspots (size + churn)

| file | LOC | churn | note |
|------|-----|-------|------|
${a.hotspots.map((h) => `| \`${h.path}\` | ${h.loc} | ${h.churn ?? "\u2014"} | ${h.reason} |`).join("\n")}

${a.deps.cycles.length ? `## Import cycles

${a.deps.cycles.map((c) => `- ${c.join(" \u2192 ")} \u2192 ${c[0]}`).join("\n")}
` : ""}${a.tests.untested.length ? `## Source files without an obvious test

${a.tests.untested.map((u) => `- \`${u}\``).join("\n")}
` : ""}`;
}

// src/backlog.ts
import { join as join3 } from "path";

// src/types.ts
var VERSION = "1.5.0";
var CAPS = {
  maxVerify: 60,
  // claim<->evidence pairs a single verify worklist emits
  minClaimWords: 6,
  // a report line shorter than this is not treated as a factual claim
  coverageMin: 0.6,
  // default fraction of report claim-units that must carry a citation
  coverageStrict: 1
  // --strict raises coverage to this
};
var VALID_VERDICTS = ["supported", "partial", "refuted", "unsupported"];
var VALID_SEVERITIES = ["P0", "P1", "P2"];
var SEVERITY_DEFS = {
  P0: {
    label: "Critical",
    cvssBand: "Critical/High",
    meaning: "breaks trust, correctness, safety, or data integrity of the primary deliverable; the documented main path fails",
    gateEffect: "caps meets-expectations at false while unresolved"
  },
  P1: {
    label: "Major",
    cvssBand: "Medium",
    meaning: "materially degrades a scored dimension (fidelity, coverage, robustness); a workaround or secondary path exists",
    gateEffect: "weighs on the dimension score and leads the backlog after P0"
  },
  P2: {
    label: "Minor",
    cvssBand: "Low",
    meaning: "polish, consistency, or documentation drift; no scored dimension materially degraded",
    gateEffect: "informs the backlog tail; never blocks the verdict"
  }
};
var VALID_IMPACT = ["high", "med", "low"];
var VALID_EFFORT = ["S", "M", "L"];
var PROTOCOL_VERSION = "2";
var RUBRIC_VERSION = "1";
var MEETS_BAR = 80;

// src/backlog.ts
function targetsOf(f) {
  const set = /* @__PURE__ */ new Set();
  for (const e of f.evidence ?? []) {
    const ref = e.ref;
    if (ref.startsWith("run:") || ref.startsWith("url:") || /^https?:/.test(ref)) continue;
    const path = /:\d+/.test(ref) ? ref.slice(0, ref.lastIndexOf(":")) : ref;
    set.add(path);
  }
  return [...set];
}
function guessTestFile(targets, f) {
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
function detectVerifyCommand(targetAbs) {
  if (exists(join3(targetAbs, "package.json"))) {
    const pkg = readJson(join3(targetAbs, "package.json"));
    if (pkg.scripts?.test) {
      if (exists(join3(targetAbs, "pnpm-lock.yaml"))) return "pnpm test";
      if (exists(join3(targetAbs, "yarn.lock"))) return "yarn test";
      return "npm test";
    }
  }
  if (exists(join3(targetAbs, "go.mod"))) return "go test ./...";
  if (exists(join3(targetAbs, "Cargo.toml"))) return "cargo test";
  if (exists(join3(targetAbs, "pytest.ini")) || exists(join3(targetAbs, "pyproject.toml"))) return "pytest";
  return null;
}
function buildBacklog(runDir, opts = {}) {
  const cfg = readJson(join3(runDir, "eval.config.json"));
  const findingsPath = join3(runDir, "findings.json");
  if (!exists(findingsPath)) throw new Error("no findings.json \u2014 record findings first (see agents/findings.md), then re-run backlog");
  const doc = readJson(findingsPath);
  const failed = /* @__PURE__ */ new Set();
  const vpath = join3(runDir, "VERIFY.json");
  if (exists(vpath)) {
    const v = readJson(vpath);
    for (const id of v.failures ?? []) failed.add(id);
  }
  const prio = (f) => f.kind === "opportunity" ? opportunityPriority(f.impact) : f.severity;
  const confirmed = (doc.findings ?? []).filter((f) => f.status !== "dismissed" && !failed.has(f.id)).sort((a, b) => {
    const pa = SEV_ORDER[prio(a)] ?? 9;
    const pb = SEV_ORDER[prio(b)] ?? 9;
    if (pa !== pb) return pa - pb;
    const va = a.kind === "opportunity" ? opportunityValue(a.impact, a.effort) : 0;
    const vb = b.kind === "opportunity" ? opportunityValue(b.impact, b.effort) : 0;
    return vb - va;
  });
  const tasks = confirmed.map((f, i) => {
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
        description: isOpp ? `Write a spec/characterization test that pins the desired behavior: ${f.recommendation || f.statement}` : f.failureScenario ? `Write a failing test that reproduces: ${f.failureScenario}` : `Write a failing test asserting the correct behavior for: ${f.statement}`
      },
      green: {
        change: f.recommendation || (isOpp ? "Implement the improvement so the spec test passes." : "Make the minimal change that turns the RED test green \u2014 without weakening any gate.")
      },
      verify: {
        // Prefer the runner detected from the target's own manifest/lockfile —
        // verify-fix replays this verbatim through a shell, so a hardcoded pnpm
        // string misleads an npm/yarn/bun target. Prose is only a last resort.
        command: detectVerifyCommand(cfg.targetAbs) ?? (cfg.kind === "skill" ? "pnpm test  # then re-run the target's own check/verify gate" : "run the new test (must pass) + the full suite (nothing regresses)")
      },
      dependsOn: []
    };
  });
  const lastByFile = /* @__PURE__ */ new Map();
  for (const t of tasks) {
    const deps = /* @__PURE__ */ new Set();
    for (const file of t.targets) {
      const prev = lastByFile.get(file);
      if (prev) deps.add(prev);
    }
    t.dependsOn = [...deps];
    for (const file of t.targets) lastByFile.set(file, t.id);
  }
  const out = opts.out ?? runDir;
  const backlog = { target: cfg.targetAbs, generatedFrom: runDir, tasks };
  writeJson(join3(out, "BACKLOG.json"), backlog);
  writeText(join3(out, "REMEDIATION.md"), renderRemediation(backlog, cfg));
  if (opts.tdd) {
    const byId = new Map(doc.findings.map((f) => [f.id, f]));
    for (const t of tasks) writeText(join3(out, "fixes", `${t.id}-${slug(t.title)}.md`), renderFixCard(t, byId.get(t.findingId)));
  }
  return backlog;
}
function renderRemediation(bl, cfg) {
  const groups = { P0: [], P1: [], P2: [] };
  for (const t of bl.tasks) (groups[t.priority] ?? (groups[t.priority] = [])).push(t);
  const section = (sev, label) => {
    const items = groups[sev] ?? [];
    if (!items.length) return "";
    return `
## ${label} (${items.length})

${items.map((t) => `- **${t.id}** ${t.title} \u2014 ${t.rationale}
  - fix: ${t.green.change}
  - targets: ${t.targets.join(", ") || "\u2014"}`).join("\n")}
`;
  };
  return `# Remediation plan \u2014 ${cfg.target}

Target: \`${bl.target}\` \xB7 ${bl.tasks.length} fix task(s), most impactful first.
Each task has a matching TDD card under \`fixes/\` (RED failing test \u2192 GREEN change \u2192 VERIFY).
${["P0", "P1", "P2"].map((s) => section(s, `${s} \u2014 ${SEVERITY_DEFS[s].label}: ${SEVERITY_DEFS[s].meaning}`)).join("")}`;
}
function renderFixCard(t, f) {
  const evidence = (f?.evidence ?? []).map((e) => `\`${e.ref}\``).join(", ") || "\u2014";
  const tag = t.kind === "opportunity" ? `OPPORTUNITY \xB7 impact ${f?.impact ?? "?"} \xB7 effort ${f?.effort ?? "?"}` : "DEFECT";
  return `# ${t.id} \u2014 ${t.title}  (${t.priority} \xB7 ${tag})

**${t.kind === "opportunity" ? "Opportunity" : "Finding"} ${t.findingId}:** ${f?.statement ?? t.rationale}
**Evidence:** ${evidence}
**Why it matters:** ${t.rationale}

## RED \u2014 write this test first
${t.red.description}

Suggested test file: \`${t.red.testFile}\`
Run it and watch it FAIL before you touch the implementation.

## GREEN \u2014 make it pass
${t.green.change}

Touch only: ${t.targets.map((x) => `\`${x}\``).join(", ") || "the relevant module"}

## VERIFY
\`${t.verify.command}\`
The RED test now passes and no existing test regresses.
`;
}

// src/brainstorm.ts
import { join as join4 } from "path";
var LENSES = [
  { id: "simplify", group: "internal", q: "What could be simpler or removed \u2014 dead code, duplication, over-abstraction?" },
  { id: "performance", group: "internal", q: "What does needless work on a hot path or at scale?" },
  { id: "security", group: "internal", q: "What untrusted input reaches a sink unvalidated; what secret/authz risk?" },
  { id: "testability", group: "internal", q: "What is untested or hard to test; what characterization test is missing?" },
  { id: "dx", group: "internal", q: "What confuses a contributor \u2014 an error message, flag, default, or unclear name?" },
  { id: "architecture", group: "internal", q: "What boundary is muddy; which hotspot module does too much and should split?" },
  { id: "feature-gap", group: "product", q: "What capability would a user reasonably expect that is missing?" },
  { id: "new-mode", group: "product", q: "What new command/flag/mode would multiply the tool's value?" },
  { id: "adjacent", group: "product", q: "What adjacent use-case is one small step away?" }
];
function runBrainstorm(runDir) {
  const cfg = readJson(join4(runDir, "eval.config.json"));
  const analysis = exists(join4(runDir, "analysis.json")) ? readJson(join4(runDir, "analysis.json")) : null;
  writeText(join4(runDir, "BRAINSTORM.todo.md"), renderTodo(cfg, analysis));
  return { lenses: LENSES.length };
}
function renderTodo(cfg, a) {
  const hot = a?.hotspots.slice(0, 8).map((h) => `- \`${h.path}\` (${h.reason})`).join("\n") || "- (run `analyze` first for hotspots)";
  const dims = (cfg.dimensions ?? []).map((d) => `- ${d.id}: ${d.name}`).join("\n");
  const internal = LENSES.filter((l) => l.group === "internal");
  const product = LENSES.filter((l) => l.group === "product");
  const lensBlock = (ls) => ls.map((l) => `- **${l.id}** \u2014 ${l.q}`).join("\n");
  return `# Brainstorm worklist \u2014 ${cfg.target}

Generate MANY candidate improvement leads (be divergent), then keep the grounded ones. Target: \`${cfg.targetAbs}\`.

## Hotspots to anchor on
${hot}

## Dimensions
${dims}

## Lenses \u2014 internal health
${lensBlock(internal)}

## Lenses \u2014 product / capability
${lensBlock(product)}

## Output: write \`opportunities.json\`

\`{ "opportunities": [ { "dimension"?, "impact": "high|med|low", "effort": "S|M|L", "title", "statement", "recommendation", "evidence": [ { "ref": "src/x.ts:42" | "analysis:src/x.ts" } ] } ] }\`

Rules (the gate enforces them after \`brainstorm --rank\`):
- Every opportunity MUST cite a resolvable anchor \u2014 a real \`file:line\` in the target, or \`analysis:<file>\` for a metric-driven one. No ungrounded "rewrite everything".
- Rate impact (value) and effort (cost) honestly; quick wins are high-impact + low-effort.
- Then run \`brainstorm --rank\` to fold them into findings.json (ranked by impact/effort) and \`check\` to gate them.
`;
}
function rankBrainstorm(runDir) {
  const oppsPath = join4(runDir, "opportunities.json");
  if (!exists(oppsPath)) throw new Error("no opportunities.json \u2014 fill the BRAINSTORM.todo.md worklist first");
  const opps = readJson(oppsPath).opportunities ?? [];
  const doc = exists(join4(runDir, "findings.json")) ? readJson(join4(runDir, "findings.json")) : { findings: [] };
  let maxN = 0;
  for (const f of doc.findings) {
    const m = /^F(\d+)$/.exec(f.id);
    if (m?.[1]) maxN = Math.max(maxN, Number(m[1]));
  }
  const seen = new Set(doc.findings.filter((f) => f.kind === "opportunity").map((f) => titleKey(f.title)));
  const ranked = [...opps].sort((x, y) => opportunityValue(y.impact, y.effort) - opportunityValue(x.impact, x.effort));
  let added = 0;
  const skipped = [];
  for (const o of ranked) {
    if (!o?.title) {
      skipped.push({ reason: "missing title" });
      continue;
    }
    if (seen.has(titleKey(o.title))) {
      skipped.push({ title: o.title, reason: "duplicate title (already folded or present)" });
      continue;
    }
    if (!VALID_IMPACT.includes(o.impact) || !VALID_EFFORT.includes(o.effort)) {
      skipped.push({ title: o.title, reason: `invalid impact/effort "${o.impact}/${o.effort}" (expected high|med|low / S|M|L)` });
      continue;
    }
    seen.add(titleKey(o.title));
    maxN++;
    doc.findings.push({
      id: `F${maxN}`,
      kind: "opportunity",
      dimension: o.dimension,
      severity: opportunityPriority(o.impact),
      impact: o.impact,
      effort: o.effort,
      title: o.title,
      statement: o.statement,
      evidence: o.evidence ?? [],
      recommendation: o.recommendation,
      // Folded, not adjudicated: verify/adjudication decides confirmed|dismissed,
      // and check's still-open warning keeps the gap visible until then.
      status: "open"
    });
    added++;
  }
  writeJson(join4(runDir, "findings.json"), doc);
  return { added, total: doc.findings.length, skipped };
}

// src/check.ts
import { execFileSync as execFileSync2 } from "child_process";
import { join as join5 } from "path";

// src/citations.ts
var TOKEN_RE = /\[([^\]\n]+)\](?!\()/g;
var FINDING_RE = /^F\d+$/;
var MODEL_HINT_RE = /^(M|model-hint)$/i;
function tokensIn(text) {
  const out = [];
  for (const m of text.matchAll(TOKEN_RE)) {
    const raw = (m[1] ?? "").trim();
    for (const piece of raw.split(",").map((s) => s.trim()).filter(Boolean)) {
      const isFinding = FINDING_RE.test(piece);
      const isModelHint = MODEL_HINT_RE.test(piece);
      const isEvidence = !isFinding && !isModelHint && (piece.startsWith("run:") || piece.startsWith("url:") || /^[\w./-]+:\d+/.test(piece));
      out.push({ raw: piece, isFinding, findingId: isFinding ? piece : void 0, isModelHint, isEvidence });
    }
  }
  return out;
}
function isCited(text) {
  return tokensIn(text).some((t) => t.isFinding || t.isEvidence || t.isModelHint);
}
function claimWordCount(text) {
  const stripped = text.replace(TOKEN_RE, " ").replace(/\bhttps?:\/\/\S+/g, " ").replace(/[#*_>`|—–-]+/g, " ");
  const words = stripped.split(/\s+/).filter((w) => /[a-zA-Z0-9]/.test(w));
  return words.length;
}
function extractUnits(md) {
  const lines = md.split("\n");
  const units = [];
  let inFence = false;
  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i] ?? "";
    const line = rawLine.trim();
    if (/^(```|~~~)/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    if (line === "" || /^#{1,6}\s/.test(line) || /^([-*_])\1{2,}$/.test(line)) continue;
    let body = line;
    if (body.startsWith(">")) {
      body = body.replace(/^>\s?/, "").trim();
      if (/\[(?:M|model-hint)\]/i.test(body) || body.toLowerCase().startsWith("[model-hint]")) continue;
    }
    if (/^\|?[\s:|-]+\|[\s:|-]+$/.test(body) && body.includes("-")) continue;
    body = body.replace(/^[-*+]\s+/, "").replace(/^\d+\.\s+/, "");
    if (claimWordCount(body) < CAPS.minClaimWords) continue;
    units.push({ text: body, line: i + 1 });
  }
  return units;
}
function findingRefs(md) {
  const ids = /* @__PURE__ */ new Set();
  for (const t of tokensIn(md)) if (t.isFinding && t.findingId) ids.add(t.findingId);
  return [...ids];
}

// src/check.ts
var HARD_FILES = ["RESULTS.md"];
var SOFT_FILES = ["SUMMARY.md"];
function checkRun(runDir, opts = {}) {
  const errors = [];
  const warnings = [];
  const cfgPath = join5(runDir, "eval.config.json");
  if (!exists(cfgPath)) {
    errors.push("no eval.config.json \u2014 run `ultraeval init` first");
    return { ok: false, errors, warnings };
  }
  let cfg;
  try {
    cfg = readJson(cfgPath);
  } catch {
    errors.push("eval.config.json is not valid JSON");
    return { ok: false, errors, warnings };
  }
  const findingsPath = join5(runDir, "findings.json");
  if (!exists(findingsPath)) {
    errors.push("no findings.json \u2014 the eval produced no findings record");
    return { ok: false, errors, warnings };
  }
  let doc;
  try {
    doc = readJson(findingsPath);
  } catch {
    errors.push("findings.json is not valid JSON");
    return { ok: false, errors, warnings };
  }
  const findings = Array.isArray(doc.findings) ? doc.findings : [];
  const ids = new Set(findings.map((f) => f.id));
  const STATUSES = ["open", "confirmed", "dismissed"];
  const seenIds = /* @__PURE__ */ new Set();
  for (const f of findings) {
    const fid = typeof f.id === "string" ? f.id : "?";
    if (!/^F\d+$/.test(fid)) errors.push(`finding id "${fid}" must match F<number>`);
    else if (seenIds.has(fid)) errors.push(`duplicate finding id ${fid}`);
    seenIds.add(fid);
    if (!VALID_SEVERITIES.includes(f.severity)) errors.push(`${fid} has invalid severity "${f.severity}" (expected P0|P1|P2)`);
    if (!STATUSES.includes(f.status)) errors.push(`${fid} has invalid status "${f.status}" (expected open|confirmed|dismissed)`);
    if (!f.title || !f.statement) errors.push(`${fid} is missing a title or statement`);
    if (!Array.isArray(f.evidence)) errors.push(`${fid} has no evidence array`);
    if (f.kind !== void 0 && f.kind !== "defect" && f.kind !== "opportunity")
      errors.push(`${fid} has invalid kind "${f.kind}" (expected defect|opportunity)`);
    if (f.kind === "opportunity") {
      if (!VALID_IMPACT.includes(f.impact)) errors.push(`${fid} (opportunity) needs impact high|med|low`);
      if (!VALID_EFFORT.includes(f.effort)) errors.push(`${fid} (opportunity) needs effort S|M|L`);
    }
  }
  if (opts.minFindings && findings.length < opts.minFindings) {
    errors.push(`only ${findings.length} finding(s) recorded; --min-findings ${opts.minFindings} required`);
  }
  const resolveOpts = { targetAbs: resolveTargetAbs(cfg.targetAbs, cfg.target, runDir), runDir };
  for (const f of findings) {
    if (f.status === "dismissed") continue;
    const ev = Array.isArray(f.evidence) ? f.evidence : [];
    let anyResolved = false;
    let anyTargetAnchored = false;
    for (const e of ev) {
      const r = resolveEvidence(e.ref, resolveOpts);
      if (r.gradeable && !r.resolved) errors.push(`${f.id} cites ${e.ref}: ${r.reason}`);
      if (r.resolved) anyResolved = true;
      if (r.resolved && r.kind === "file") anyTargetAnchored = true;
    }
    if (!anyResolved) errors.push(`${f.id} has no resolvable evidence \u2014 a finding must point at a real file:line (or run: artifact)`);
    else if (!anyTargetAnchored)
      errors.push(`${f.id} is grounded only in the run's own artifacts \u2014 cite at least one target file[:line] alongside the run: log`);
  }
  const coverageMin = opts.strict ? CAPS.coverageStrict : opts.coverageMin ?? CAPS.coverageMin;
  for (const file of [...HARD_FILES, ...SOFT_FILES]) {
    const p = join5(runDir, file);
    if (!exists(p)) continue;
    const md = readText(p);
    for (const id of findingRefs(md)) if (!ids.has(id)) errors.push(`${file} cites ${id} but no such finding exists (dangling citation)`);
    if (HARD_FILES.includes(file)) {
      const units = extractUnits(md);
      if (units.length) {
        const cited = units.filter((u) => isCited(u.text)).length;
        const ratio = cited / units.length;
        if (ratio < coverageMin)
          errors.push(
            `${file} citation coverage ${(ratio * 100).toFixed(0)}% < ${(coverageMin * 100).toFixed(0)}% \u2014 cite findings [F#]/[file:line] or flag narrative with [M]`
          );
      }
    }
  }
  const backlogPath = join5(runDir, "BACKLOG.json");
  if (exists(backlogPath)) {
    try {
      const bl = readJson(backlogPath);
      for (const t of bl.tasks ?? []) {
        const f = findings.find((x) => x.id === t.findingId);
        if (!f) errors.push(`BACKLOG ${t.id} references ${t.findingId} which is not a finding`);
        else if (f.status === "dismissed") errors.push(`BACKLOG ${t.id} references dismissed finding ${t.findingId}`);
        else if (t.status === "done" && f.status === "open")
          warnings.push(`BACKLOG ${t.id} is done but finding ${t.findingId} is still open \u2014 adjudicate the finding or reopen the task`);
      }
    } catch {
      errors.push("BACKLOG.json is not valid JSON");
    }
  }
  const verifyPath = join5(runDir, "VERIFY.json");
  if (opts.requireVerify) {
    if (!exists(verifyPath)) errors.push("--require-verify: no VERIFY.json \u2014 run `ultraeval verify --apply <verdicts>`");
    else {
      try {
        const v = readJson(verifyPath);
        if (!v.adjudicated) errors.push("--require-verify: VERIFY.json has no adjudicated verdicts");
        if (v.honeypots?.failed?.length)
          errors.push(
            `--require-verify: ${v.honeypots.failed.length} honeypot(s) graded supported (${v.honeypots.failed.join(", ")}) \u2014 the skeptic rubber-stamped; re-verify with a fresh skeptic`
          );
        const pending = (v.unadjudicated ?? []).filter((fid) => {
          const f = findings.find((x) => x.id === fid);
          return f && f.status !== "dismissed";
        });
        if (pending.length) errors.push(`--require-verify: ${pending.length} finding(s) still unadjudicated (${pending.join(", ")}) \u2014 grade every verify pair`);
      } catch {
        errors.push("--require-verify: VERIFY.json is not valid JSON");
      }
    }
  }
  if (opts.semantic && exists(verifyPath)) {
    try {
      const v = readJson(verifyPath);
      for (const fid of v.failures ?? []) {
        const f = findings.find((x) => x.id === fid);
        if (f && f.status !== "dismissed")
          errors.push(`--semantic: ${fid} was refuted/unsupported by verification but is still "${f.status}" \u2014 dismiss it or fix the claim`);
      }
    } catch {
      errors.push("--semantic: VERIFY.json is not valid JSON");
    }
  }
  const sinceRef = cfg.provenance?.sinceRef;
  if (sinceRef) {
    const targetAbs = resolveTargetAbs(cfg.targetAbs, cfg.target, runDir);
    let changed = null;
    try {
      changed = new Set(
        execFileSync2("git", ["-C", targetAbs, "diff", "--name-only", sinceRef], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).split("\n").map((l) => l.trim()).filter(Boolean)
      );
    } catch {
      warnings.push(`diff scope: could not resolve ${sinceRef} in the target \u2014 out-of-scope findings not checked`);
    }
    if (changed) {
      for (const f of findings) {
        if (f.status === "dismissed") continue;
        const files = (f.evidence ?? []).map((e) => e.ref).filter((r) => !r.startsWith("run:") && !r.startsWith("url:") && !/^https?:/.test(r)).map((r) => (/:\d/.test(r) ? r.slice(0, r.lastIndexOf(":")) : r).replace(/^analysis:/, ""));
        if (files.length && !files.some((x) => changed.has(x)))
          warnings.push(`${f.id} cites only files unchanged since ${sinceRef} (${files.join(", ")}) \u2014 outside the diff scope of this run`);
      }
    }
  }
  for (const f of findings) {
    if (f.status === "dismissed") continue;
    if (f.status === "open") warnings.push(`${f.id} is still "open" \u2014 adjudicate it (confirmed/dismissed) before backlog`);
    if (f.status === "confirmed" && !f.recommendation) warnings.push(`${f.id} is confirmed but has no recommendation \u2014 its backlog card will be vague`);
  }
  if (exists(join5(runDir, "RESULTS.md")) && !exists(join5(runDir, "SUMMARY.md"))) warnings.push("RESULTS.md present but no SUMMARY.md");
  if (exists(join5(runDir, "runs", "budget.md"))) {
    const summaryPath = join5(runDir, "SUMMARY.md");
    if (!exists(summaryPath) || !/budget/i.test(readText(summaryPath)))
      warnings.push("runs/budget.md records coverage cuts but SUMMARY.md does not mention them \u2014 report every cut in the summary");
  }
  if (!cfg.provenance) warnings.push("legacy run (pre-protocol) \u2014 no provenance recorded; re-init to stamp engine/protocol/rubric versions");
  return { ok: errors.length === 0, errors, warnings };
}
function formatCheckReport(r, runDir) {
  const lines = [r.ok ? `PASS  ${runDir}` : `FAIL  ${runDir}`];
  for (const e of r.errors) lines.push(`  \u2717 ${e}`);
  for (const w of r.warnings) lines.push(`  ! ${w}`);
  if (r.ok && !r.warnings.length) lines.push("  every finding is grounded in the target.");
  return lines.join("\n");
}

// src/compare.ts
import { join as join6 } from "path";
function load(dir) {
  const findings = exists(join6(dir, "findings.json")) ? readJson(join6(dir, "findings.json")).findings ?? [] : [];
  const score = exists(join6(dir, "scorecard.json")) ? readJson(join6(dir, "scorecard.json")) : null;
  const cfg = exists(join6(dir, "eval.config.json")) ? readJson(join6(dir, "eval.config.json")) : null;
  return { findings, score, cfg };
}
var key = (f) => `${f.kind ?? "defect"}:${titleKey(f.title)}`;
function targetRefOf(ref) {
  if (ref.startsWith("run:") || ref.startsWith("url:") || /^https?:/.test(ref)) return null;
  return ref.startsWith("analysis:") ? ref.slice("analysis:".length) : ref;
}
function fingerprint(f) {
  const refs = [...new Set((f.evidence ?? []).map((e) => targetRefOf(e.ref)).filter((x) => !!x))].sort();
  return refs.length ? `${f.kind ?? "defect"}:${refs.join(",")}` : null;
}
var provLine = (p) => p ? `engine ${p.engineVersion} \xB7 protocol ${p.protocolVersion} \xB7 rubric ${p.rubricVersion}${p.targetGit ? ` \xB7 target ${p.targetGit.commit.slice(0, 7)}${p.targetGit.dirty ? "*" : ""}` : ""}` : "no provenance (legacy run)";
function comparabilityWarnings(base, cur) {
  const warnings = [];
  if (!base.cfg || !cur.cfg) return warnings;
  const rubric = (cfg) => JSON.stringify((cfg.dimensions ?? []).map((d) => [d.id, d.weight]));
  if (rubric(base.cfg) !== rubric(cur.cfg)) warnings.push("rubrics differ (dimension ids/weights) \u2014 scores are not directly comparable");
  const bp = base.cfg.provenance;
  const cp = cur.cfg.provenance;
  if (bp && cp) {
    if (bp.protocolVersion !== cp.protocolVersion)
      warnings.push(`protocol versions differ (${bp.protocolVersion} \u2192 ${cp.protocolVersion}) \u2014 score delta is not comparable across protocol versions`);
    if (bp.rubricVersion !== cp.rubricVersion)
      warnings.push(`rubric versions differ (${bp.rubricVersion} \u2192 ${cp.rubricVersion}) \u2014 score delta is not comparable across rubric versions`);
  }
  return warnings;
}
function gateFailures(r) {
  const fails = [];
  if (r.scoreDelta !== null && r.scoreDelta < 0) fails.push(`score dropped by ${-r.scoreDelta}`);
  const p0 = r.introduced.filter((f) => f.kind !== "opportunity" && f.severity === "P0");
  if (p0.length) fails.push(`introduced P0 defect(s): ${p0.map((f) => f.title).join("; ")}`);
  return fails;
}
function compareRuns(baseDir, newDir) {
  const base = load(baseDir);
  const cur = load(newDir);
  const liveBase = base.findings.filter((f) => f.status !== "dismissed");
  const liveCur = cur.findings.filter((f) => f.status !== "dismissed");
  const baseKeys = new Set(liveBase.map(key));
  const curKeys = new Set(liveCur.map(key));
  let resolved = liveBase.filter((f) => !curKeys.has(key(f)));
  let introduced = liveCur.filter((f) => !baseKeys.has(key(f)));
  const retitled = [];
  const introducedLeft = [...introduced];
  const resolvedLeft = [];
  for (const f of resolved) {
    const fp = fingerprint(f);
    const match = fp ? introducedLeft.find((g) => fingerprint(g) === fp) : void 0;
    if (match) {
      retitled.push({ from: f, to: match });
      introducedLeft.splice(introducedLeft.indexOf(match), 1);
    } else resolvedLeft.push(f);
  }
  resolved = resolvedLeft;
  introduced = introducedLeft;
  const scoreDelta = base.score && cur.score ? cur.score.overall - base.score.overall : null;
  const warnings = comparabilityWarnings(base, cur);
  const line = (f) => `- ${f.kind === "opportunity" ? "opp" : f.severity} \xB7 ${f.title}`;
  const scoreLine = base.score && cur.score ? `Score: ${base.score.overall} \u2192 ${cur.score.overall} (${(scoreDelta ?? 0) >= 0 ? "+" : ""}${scoreDelta}) \xB7 meets-expectations ${base.score.meetsExpectations} \u2192 ${cur.score.meetsExpectations}` : "Score: (one or both runs have no scorecard.json)";
  const warningBlock = warnings.length ? `
${warnings.map((w) => `> **\u26A0 ${w}**`).join("\n")}
` : "";
  const baseCommit = base.cfg?.provenance?.targetGit?.commit;
  const curCommit = cur.cfg?.provenance?.targetGit?.commit;
  const stabilityLine = base.score && cur.score && baseCommit && curCommit && baseCommit === curCommit ? `
Stability (same target commit ${baseCommit.slice(0, 7)}): |\u0394overall| = ${Math.abs(scoreDelta ?? 0)} \xB7 agreement ${base.score.agreement ?? "\u2014"} \u2192 ${cur.score.agreement ?? "\u2014"}` : "";
  const md = `# Comparison \u2014 base \`${baseDir}\` \u2192 current \`${newDir}\`

- base: ${provLine(base.cfg?.provenance)}
- current: ${provLine(cur.cfg?.provenance)}

${scoreLine}${stabilityLine}
${warningBlock}
## Resolved since base (${resolved.length})

${resolved.map(line).join("\n") || "- none"}

## Introduced in current (${introduced.length})

${introduced.map(line).join("\n") || "- none"}

## Retitled (same evidence, new title) (${retitled.length})

${retitled.map((p) => `- ${p.from.title} \u2192 ${p.to.title}`).join("\n") || "- none"}
`;
  return { scoreDelta, resolved, introduced, retitled, warnings, md };
}
function runCompare(baseDir, newDir, outDir) {
  const r = compareRuns(baseDir, newDir);
  writeText(join6(outDir, "COMPARE.md"), r.md);
  return r;
}

// src/sarif.ts
import { join as join7, relative as relative3, sep } from "path";
var LEVEL = { P0: "error", P1: "warning", P2: "note" };
function buildSarif(cfg, doc, runDir) {
  const targetAbs = resolveTargetAbs(cfg.targetAbs, cfg.target, runDir);
  const live = (doc.findings ?? []).filter((f) => f.status !== "dismissed");
  const ruleOf = (f) => `ultraeval/${f.dimension ?? f.kind ?? "defect"}`;
  const results = live.map((f) => {
    const locations = (f.evidence ?? []).map((e) => resolveEvidence(e.ref, { targetAbs, runDir })).filter((r) => r.resolved && r.kind === "file" && r.absPath).map((r) => ({
      physicalLocation: {
        artifactLocation: {
          uri: relative3(targetAbs, r.absPath).split(sep).join("/")
        },
        ...r.lineStart ? { region: { startLine: r.lineStart, ...r.lineEnd && r.lineEnd !== r.lineStart ? { endLine: r.lineEnd } : {} } } : {}
      }
    }));
    return {
      ruleId: ruleOf(f),
      level: LEVEL[f.severity] ?? "warning",
      message: { text: `${f.title} \u2014 ${f.statement}` },
      ...locations.length ? { locations } : {},
      properties: {
        findingId: f.id,
        severity: f.severity,
        status: f.status,
        ...f.kind ? { kind: f.kind } : {},
        ...f.impact ? { impact: f.impact } : {},
        ...f.effort ? { effort: f.effort } : {}
      }
    };
  });
  return {
    $schema: "https://docs.oasis-open.org/sarif/sarif/v2.1.0/errata01/os/schemas/sarif-schema-2.1.0.json",
    version: "2.1.0",
    runs: [
      {
        tool: {
          driver: {
            name: "ultraeval",
            version: cfg.version,
            informationUri: "https://github.com/maxgfr/ultraeval",
            rules: [...new Set(results.map((r) => r.ruleId))].map((id) => ({ id }))
          }
        },
        results
      }
    ]
  };
}
function writeSarif(runDir, out) {
  const cfg = readJson(join7(runDir, "eval.config.json"));
  const doc = readJson(join7(runDir, "findings.json"));
  const p = join7(out ?? runDir, "eval.sarif");
  writeJson(p, buildSarif(cfg, doc, runDir));
  return p;
}

// src/clean.ts
import { readdirSync as readdirSync3, rmSync } from "fs";
import { join as join8 } from "path";
var DERIVED = [
  "VERIFY.todo.json",
  "VERIFY.md",
  "VERIFY.json",
  "VERIFY.honeypots.json",
  "index.html",
  "index.md",
  "BACKLOG.json",
  "REMEDIATION.md",
  "eval.sarif"
];
function clean(runDir, opts = {}) {
  const removed = [];
  if (exists(runDir) && !exists(join8(runDir, "eval.config.json"))) {
    throw new Error(`refusing to clean ${runDir}: not an ultraeval run (no eval.config.json)`);
  }
  if (opts.all) {
    if (exists(runDir)) {
      rmSync(runDir, { recursive: true, force: true });
      removed.push(runDir);
    }
    return removed;
  }
  for (const name of DERIVED) {
    const p = join8(runDir, name);
    if (exists(p)) {
      rmSync(p, { force: true });
      removed.push(p);
    }
  }
  if (exists(runDir)) {
    for (const e of readdirSync3(runDir)) {
      if (/^VERIFY\.(todo\.|honeypots\.)?\d+\.(json|md)$/.test(e)) {
        rmSync(join8(runDir, e), { force: true });
        removed.push(join8(runDir, e));
      }
    }
  }
  const fixes = join8(runDir, "fixes");
  if (exists(fixes)) {
    rmSync(fixes, { recursive: true, force: true });
    removed.push(fixes);
  }
  return removed;
}

// src/init.ts
import { execFileSync as execFileSync3 } from "child_process";
import { createHash } from "crypto";
import { join as join9, resolve as resolve2 } from "path";

// src/rubrics.ts
var iso25010 = (ref, note) => ({ standard: "ISO/IEC 25010:2023", ref, ...note ? { note } : {} });
var iso25059 = (ref) => ({ standard: "ISO/IEC 25059:2023", ref });
var informative = (standard, ref) => ({ standard, ref, note: "informative" });
var SKILL_DIMS = [
  {
    id: "grounding",
    name: "Correctness & grounding",
    weight: 0.3,
    whatPerfectLooksLike: "every claim resolves to real source; gates pass on genuine AND fail on doctored artifacts",
    anchors: [iso25059("functional correctness for AI systems"), informative("RAGAS", "faithfulness / attributable-to-source")]
  },
  {
    id: "coverage",
    name: "Functional coverage",
    weight: 0.25,
    whatPerfectLooksLike: "every mode/command/flag/gate works as documented",
    anchors: [iso25010("Functional suitability \u2014 functional completeness")]
  },
  {
    id: "ux",
    name: "UX & meets-expectations",
    weight: 0.2,
    whatPerfectLooksLike: "the real deliverable is production-quality, low-friction",
    anchors: [iso25010("Interaction capability \u2014 operability, user engagement")]
  },
  {
    id: "safety",
    name: "Safety & robustness",
    weight: 0.15,
    whatPerfectLooksLike: "no destructive defaults; graceful degradation without deps/network",
    anchors: [iso25010("Safety \u2014 fail safe, operational constraint"), informative("NIST AI RMF 1.0", "Safe characteristic")]
  },
  {
    id: "docs",
    name: "Docs consistency",
    weight: 0.1,
    whatPerfectLooksLike: "SKILL.md, README, --help, and behavior agree; examples run",
    anchors: [iso25010("Interaction capability \u2014 user assistance"), informative("ISO/IEC/IEEE 26514:2022", "user documentation design")]
  }
];
var CODEBASE_DIMS = [
  {
    id: "correctness",
    name: "Correctness",
    weight: 0.3,
    whatPerfectLooksLike: "correct on happy AND edge paths; no logic bugs",
    anchors: [iso25010("Functional suitability \u2014 functional correctness"), iso25010("Reliability \u2014 faultlessness")]
  },
  {
    id: "tests",
    name: "Test quality",
    weight: 0.2,
    whatPerfectLooksLike: "tests fail when the code is wrong (not just coverage %)",
    anchors: [iso25010("Maintainability \u2014 testability")]
  },
  {
    id: "security",
    name: "Security",
    weight: 0.2,
    whatPerfectLooksLike: "no exploitable source->sink flows; inputs validated",
    anchors: [iso25010("Security \u2014 confidentiality, integrity, resistance"), informative("OWASP Top 10 (2021)", "categories A01\u2013A10")]
  },
  {
    id: "maintainability",
    name: "Maintainability",
    weight: 0.2,
    whatPerfectLooksLike: "clear boundaries, low duplication",
    anchors: [iso25010("Maintainability \u2014 modularity, analysability, modifiability")]
  },
  {
    id: "performance",
    name: "Performance",
    weight: 0.1,
    whatPerfectLooksLike: "no hot-path waste; scales to realistic inputs",
    anchors: [iso25010("Performance efficiency \u2014 time behaviour, resource utilization, capacity")]
  }
];
var SECURITY_DIMS = [
  {
    id: "precision",
    name: "Precision",
    weight: 0.25,
    whatPerfectLooksLike: "reported findings are real exploitable issues, not false positives",
    anchors: [{ standard: "OWASP Benchmark", ref: "true-positive rate vs labelled corpus" }]
  },
  {
    id: "recall",
    name: "Recall",
    weight: 0.25,
    whatPerfectLooksLike: "known vulnerabilities in a labelled corpus are all found",
    anchors: [{ standard: "OWASP Benchmark", ref: "recall vs labelled corpus" }, informative("NIST SAMATE / Juliet", "labelled vulnerability test suites")]
  },
  {
    id: "false-positive-rate",
    name: "False-positive rate",
    weight: 0.2,
    whatPerfectLooksLike: "sanitized/safe code is never flagged",
    anchors: [{ standard: "OWASP Benchmark", ref: "false-positive rate on safe variants" }]
  },
  {
    id: "reachability",
    name: "Reachability",
    weight: 0.15,
    whatPerfectLooksLike: "flagged sinks are actually reachable from untrusted input",
    anchors: [{ standard: "CVSS v4.0", ref: "exploitability metrics (attack vector, complexity)", note: "interpretive" }]
  },
  {
    id: "maintainability",
    name: "Maintainability",
    weight: 0.15,
    whatPerfectLooksLike: "clear rules, easy to extend",
    anchors: [iso25010("Maintainability \u2014 modifiability")]
  }
];
var REQ_29148 = (characteristic) => ({
  standard: "ISO/IEC/IEEE 29148:2018",
  ref: `requirement characteristic \u2014 ${characteristic}`
});
var REQUIREMENTS_DIMS = [
  {
    id: "completeness",
    name: "Completeness",
    weight: 0.3,
    whatPerfectLooksLike: "every needed requirement is present; no gaps (ISO/IEC/IEEE 29148)",
    anchors: [REQ_29148("complete")]
  },
  {
    id: "consistency",
    name: "Consistency",
    weight: 0.25,
    whatPerfectLooksLike: "no contradictions across requirements/sections",
    anchors: [REQ_29148("consistent")]
  },
  {
    id: "verifiable-acceptance",
    name: "Verifiable acceptance",
    weight: 0.25,
    whatPerfectLooksLike: "every requirement has testable Given/When/Then acceptance criteria",
    anchors: [REQ_29148("verifiable")]
  },
  {
    id: "traceability",
    name: "Traceability",
    weight: 0.2,
    whatPerfectLooksLike: "requirements trace to scope/build tasks and back",
    anchors: [REQ_29148("traceable")]
  }
];
var RESEARCH_DIMS = [
  {
    id: "faithfulness",
    name: "Faithfulness",
    weight: 0.35,
    whatPerfectLooksLike: "every claim is attributable to a fetched source",
    anchors: [{ standard: "RAGAS", ref: "faithfulness" }, informative("AIS", "attributable to identified sources")]
  },
  {
    id: "retrieval",
    name: "Retrieval",
    weight: 0.25,
    whatPerfectLooksLike: "high recall@k and MRR for the needed evidence",
    anchors: [{ standard: "IR evaluation (TREC)", ref: "recall@k, MRR" }]
  },
  {
    id: "coverage",
    name: "Coverage",
    weight: 0.2,
    whatPerfectLooksLike: "the question is answered completely, not partially",
    anchors: [iso25010("Functional suitability \u2014 functional completeness")]
  },
  {
    id: "hallucination",
    name: "Hallucination control",
    weight: 0.2,
    whatPerfectLooksLike: "no ungrounded or fabricated statements survive the gate",
    anchors: [{ standard: "RAGAS", ref: "answer attribution / hallucination rate" }]
  }
];
var webFlavored = (base) => [
  ...base,
  {
    id: "accessibility",
    name: "Accessibility (WCAG 2.2 AA)",
    weight: 0.15,
    whatPerfectLooksLike: "no blocking a11y violations",
    anchors: [{ standard: "WCAG 2.2", ref: "conformance level AA", note: "lineage ISO/IEC 40500" }]
  },
  {
    id: "auth",
    name: "AuthN / AuthZ",
    weight: 0.2,
    whatPerfectLooksLike: "sessions and authorization are correct; no IDOR",
    anchors: [iso25010("Security \u2014 authenticity, accountability"), informative("OWASP ASVS 4.0", "V2 authentication, V4 access control")]
  }
];
var cliFlavored = (base) => [
  ...base,
  {
    id: "ergonomics",
    name: "Ergonomics",
    weight: 0.15,
    whatPerfectLooksLike: "clear --help, actionable errors, consistent exit codes",
    anchors: [iso25010("Interaction capability \u2014 operability, user error protection")]
  }
];
function defaultDimensions(kind, category = "") {
  const cat = category.toLowerCase();
  if (/secur|sast|vuln|taint|pentest|appsec/.test(cat)) return SECURITY_DIMS;
  if (/requirement|\bprd\b|\bsrd\b|\bspec\b|specification/.test(cat)) return REQUIREMENTS_DIMS;
  if (/research|\brag\b|retrieval|search|documentation|\bq&a\b|\bqa\b/.test(cat)) return RESEARCH_DIMS;
  const base = kind === "skill" ? SKILL_DIMS : CODEBASE_DIMS;
  if (/\bweb\b|frontend|browser|website|\bsite\b|web app|webapp/.test(cat)) return webFlavored(base);
  if (/\bcli\b|command.?line|terminal/.test(cat)) return cliFlavored(base);
  return base;
}

// src/init.ts
function detectKind(targetAbs) {
  if (exists(join9(targetAbs, "SKILL.md"))) return "skill";
  const skillsDir = join9(targetAbs, "skills");
  if (exists(skillsDir)) {
    for (const md of listMarkdown(skillsDir)) if (md.endsWith("SKILL.md")) return "skill";
  }
  return "codebase";
}
function gitInfo(targetAbs) {
  const git = (args) => execFileSync3("git", ["-C", targetAbs, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  try {
    const commit = git(["rev-parse", "HEAD"]);
    const dirty = git(["status", "--porcelain"]).length > 0;
    let branch;
    try {
      branch = git(["rev-parse", "--abbrev-ref", "HEAD"]) || void 0;
    } catch {
      branch = void 0;
    }
    return { commit, ...branch ? { branch } : {}, dirty };
  } catch {
    return void 0;
  }
}
var dimensionsHash = (dims) => createHash("sha256").update(JSON.stringify(dims)).digest("hex").slice(0, 12);
function initRun(opts) {
  const targetAbs = resolve2(process.cwd(), opts.target);
  if (!exists(targetAbs)) throw new Error(`target not found: ${opts.target}`);
  const kind = opts.kind ?? detectKind(targetAbs);
  const category = opts.category ?? (kind === "skill" ? "agent skill" : "software project");
  const mode = opts.mode ?? "audit";
  const dimensions = defaultDimensions(kind, category);
  const targetGit = gitInfo(targetAbs);
  if (opts.since) {
    try {
      execFileSync3("git", ["-C", targetAbs, "rev-parse", "--verify", `${opts.since}^{commit}`], { stdio: ["ignore", "ignore", "ignore"] });
    } catch {
      throw new Error(`--since ${opts.since}: not a resolvable git ref in ${targetAbs}`);
    }
  }
  const provenance = {
    engineVersion: VERSION,
    protocolVersion: PROTOCOL_VERSION,
    rubricVersion: RUBRIC_VERSION,
    createdAt: (/* @__PURE__ */ new Date()).toISOString(),
    mode,
    kind,
    category,
    dimensionsHash: dimensionsHash(dimensions),
    ...targetGit ? { targetGit } : {},
    ...opts.since ? { sinceRef: opts.since } : {}
  };
  const cfg = {
    target: opts.target,
    targetAbs,
    kind,
    category,
    mode,
    dimensions,
    note: "starter dimensions \u2014 the research stage refines them",
    version: VERSION,
    provenance,
    ...opts.bar !== void 0 && Number.isFinite(opts.bar) ? { meetsBar: opts.bar } : {}
  };
  const runDir = resolve2(process.cwd(), opts.out);
  ensureDir(join9(runDir, "runs"));
  ensureDir(join9(runDir, "research"));
  writeJson(join9(runDir, "eval.config.json"), cfg);
  return { cfg, runDir };
}

// src/plan.ts
import { join as join11 } from "path";

// src/templates.ts
import { dirname as dirname2, join as join10 } from "path";
function calibrationFixturePath(engineAbs) {
  const candidates = [
    join10(dirname2(engineAbs), "..", "references", "calibration-run.json"),
    join10(dirname2(engineAbs), "..", "skills", "ultraeval", "references", "calibration-run.json")
  ];
  return candidates.find(exists) ?? candidates[0];
}
var anchorText = (d) => d.anchors?.length ? d.anchors.map((a) => `${a.standard} \u2014 ${a.ref}`).join("; ") : "";
var severityLegend = () => VALID_SEVERITIES.map((s) => `${s} (${SEVERITY_DEFS[s].label}: ${SEVERITY_DEFS[s].meaning})`).join(" \xB7 ");
var LIVE_SCENARIOS = {
  "agent skill": {
    golden: "follow SKILL.md's quickstart end-to-end on a small local fixture and produce the skill's primary deliverable",
    error: "invoke a documented command with a missing/invalid required flag \u2014 expect an actionable message, no raw stack trace, non-zero exit",
    help: "every command SKILL.md documents exists; --help (or equivalent) matches the docs",
    artifact: "the deliverable under runs/live-* plus the runs/live.md narrative",
    pass: "deliverable complete and usable; the skill's own gates pass; no hallucinated paths/claims"
  },
  cli: {
    golden: "run the README's first documented command sequence against a tmp fixture",
    error: "an unknown subcommand AND a missing required argument \u2014 both exit non-zero with an actionable stderr message",
    help: "--help exits 0 and lists every documented command; exit codes match the documented contract",
    artifact: "verbatim command lines + exit codes + trimmed outputs in runs/live.md",
    pass: "outputs and exit codes match the docs; errors name the fix"
  },
  library: {
    golden: "import the package and run the README quickstart snippet as-is",
    error: "call a public API with invalid input \u2014 expect the documented (typed) error, not a deep crash",
    help: "the exported API surface matches the docs/types; the quickstart runs unmodified",
    artifact: "the runnable snippet + its output log under runs/live-*",
    pass: "snippet runs as documented; the error path fails the documented way"
  },
  "web app": {
    golden: "boot the app locally and drive the primary user journey (create + read the core entity)",
    error: "submit an invalid form and hit a non-existent route \u2014 validation feedback and a proper 404, never a 5xx",
    help: "the README's run instructions work verbatim (install \u2192 start \u2192 URL)",
    artifact: "HTTP transcripts or screenshots + runs/live.md narrative",
    pass: "journey completes; no 5xx; basic a11y smoke on the main page"
  },
  security: {
    golden: "scan a small labelled vulnerable fixture \u2014 the known true positives are reported",
    error: "scan the sanitized variant \u2014 NO findings (false-positive check); an invalid target errors actionably",
    help: "--help documents the scan modes used; exit codes distinguish clean/findings/error",
    artifact: "both scan reports (vulnerable + safe) under runs/live-*",
    pass: "labelled TPs found, safe variant clean, exit codes per contract"
  },
  requirements: {
    golden: "render/validate the spec suite; the traceability check passes on the genuine document",
    error: "remove a required section from a COPY \u2014 the validator fails naming the missing section",
    help: "documented validate/render commands exist and match the docs",
    artifact: "the validation report for both directions under runs/live-*",
    pass: "gate proven in both directions (genuine passes, doctored fails)"
  },
  research: {
    golden: "ask a question answerable from a small local corpus \u2014 the answer cites the fetched sources",
    error: "ask an unanswerable question \u2014 explicit abstention, zero fabricated citations",
    help: "the documented modes/flags exist; citation format matches the docs",
    artifact: "the cited report under runs/live-*",
    pass: "every claim attributable to a fetched source; the unanswerable question is refused"
  }
};
function liveScenarioFor(cfg) {
  const cat = (cfg.category ?? "").toLowerCase();
  if (/secur|sast|vuln|taint|pentest|appsec/.test(cat)) return LIVE_SCENARIOS.security;
  if (/requirement|\bprd\b|\bsrd\b|\bspec\b|specification/.test(cat)) return LIVE_SCENARIOS.requirements;
  if (/research|\brag\b|retrieval|search|documentation|\bq&a\b|\bqa\b/.test(cat)) return LIVE_SCENARIOS.research;
  if (/\bweb\b|frontend|browser|website|\bsite\b|web app|webapp/.test(cat)) return LIVE_SCENARIOS["web app"];
  if (/\bcli\b|command.?line|terminal/.test(cat)) return LIVE_SCENARIOS.cli;
  return cfg.kind === "skill" ? LIVE_SCENARIOS["agent skill"] : LIVE_SCENARIOS.library;
}
var diffScopeBlock = (cfg) => cfg.provenance?.sinceRef ? `
**DIFF SCOPE (binding).** This eval is scoped to changes since \`${cfg.provenance.sinceRef}\` (run \`git -C ${cfg.targetAbs} diff --name-only ${cfg.provenance.sinceRef}\` for the changed set). Exercise and report ONLY changed behavior; findings MUST cite changed files (unchanged files are context, not findings \u2014 \`check\` warns on out-of-scope citations). Finish with \`compare --run <RUN> --base <previous-run> --gate\` semantics in mind: this run gates a delta, not the whole repo.
` : "";
var liveScenarioBlock = (cfg) => [
  `**Normed live scenario for this category** (full library: \`references/live-scenarios.md\` next to the engine):`,
  `- Golden path: ${liveScenarioFor(cfg).golden}.`,
  `- Error path: ${liveScenarioFor(cfg).error}.`,
  `- Help contract: ${liveScenarioFor(cfg).help}.`,
  `- Expected artifact: ${liveScenarioFor(cfg).artifact}.`,
  `- Pass criteria: ${liveScenarioFor(cfg).pass}.`
].join("\n");
function workflowScript(cfg, runDirAbs, engineAbs) {
  const mode = cfg.mode ?? "audit";
  const doDefects = mode !== "improve";
  const doOpps = mode !== "audit";
  const meta = {
    name: `ultraeval-${cfg.kind}`,
    description: `Evaluate ${cfg.targetAbs} (mode: ${mode}) \u2014 ground every finding, then emit a TDD backlog`
  };
  const phases = [{ title: "Research" }, { title: "TestPlan" }];
  if (doDefects) phases.push({ title: "Execute" }, { title: "Findings" });
  if (doOpps) phases.push({ title: "Analyze" }, { title: "Brainstorm" });
  phases.push({ title: "Gate" }, { title: "Judge" }, { title: "Results" });
  const head = [
    `export const meta = { name: ${JSON.stringify(meta.name)}, description: ${JSON.stringify(meta.description)}, phases: ${JSON.stringify(phases)} }`,
    ``,
    `// NOT a plain Node script: launch via the Workflow tool \u2014 Workflow({ scriptPath: ${JSON.stringify(`${runDirAbs}/eval.workflow.mjs`)} }).`,
    `// agent()/phase()/parallel()/log() only exist inside that harness; plain \`node\` prints guidance and exits 2.`,
    ``,
    `// Constants for THIS eval run (injected by \`ultraeval plan\`).`,
    `const TARGET = ${JSON.stringify(cfg.targetAbs)}`,
    `const ENGINE = ${JSON.stringify(engineAbs)}`,
    `const RUN = ${JSON.stringify(runDirAbs)}`,
    `const AGENTS = RUN + '/agents'`,
    `const CATEGORY = ${JSON.stringify(cfg.category)}`,
    `const KIND = ${JSON.stringify(cfg.kind)}`,
    `const DIMENSIONS = ${JSON.stringify(cfg.dimensions)}`,
    ``,
    `// Parse-safe guard: under plain \`node\` the Workflow-harness globals are absent.`,
    `if (typeof phase === 'undefined') {`,
    `  console.error('eval.workflow.mjs is a Workflow-harness script, not a plain Node script \u2014 agent()/phase()/parallel()/log() come from the harness.')`,
    `  console.error('Launch it with: Workflow({ scriptPath: ' + JSON.stringify(RUN + '/eval.workflow.mjs') + ' })')`,
    `  console.error('No Workflow tool? Run the stages by hand: dispatch a subagent per contract under ' + AGENTS + '/*.md (see SKILL.md step 3).')`,
    `  process.exit(2)`,
    `}`,
    ``,
    `function contract(name, extra) {`,
    `  return 'Read and follow the dispatch contract at ' + AGENTS + '/' + name + '.md VERBATIM.\\n'`,
    `    + 'Constants: TARGET=' + TARGET + '  ENGINE=' + ENGINE + '  RUN=' + RUN + '  KIND=' + KIND + '  CATEGORY=' + CATEGORY + '.\\n'`,
    `    + 'Invoke the engine only by its ABSOLUTE path: node ' + ENGINE + ' <cmd>. Write every artifact under RUN. Do not stop early.'`,
    `    + (extra ? '\\n' + extra : '')`,
    `}`,
    ``,
    `log(${JSON.stringify(`ultraeval ${mode} eval for `)} + TARGET)`,
    ``,
    `// Budget discipline (protocol v2): under a harness token target, scale down`,
    `// DELIBERATELY and record every coverage cut \u2014 a silent cut reads as full coverage.`,
    `let LENSES = ['correctness+grounding', 'completeness+coverage', 'ux+meets-expectations']`,
    `let RESEARCH_GROUPED = false`,
    `const CUTS = []`,
    `if (typeof budget !== 'undefined' && budget && budget.total) {`,
    `  const left = budget.remaining()`,
    `  if (left < 600000) { RESEARCH_GROUPED = true; CUTS.push('research: ' + DIMENSIONS.length + ' per-dimension agents -> 1 grouped agent (' + Math.round(left / 1000) + 'k tokens left < 600k)') }`,
    `  if (left < 300000) { LENSES = LENSES.slice(0, 2); CUTS.push('judges: 3 lenses -> 2 (' + Math.round(left / 1000) + 'k tokens left < 300k)') }`,
    `}`,
    `if (CUTS.length) {`,
    `  log('budget: recording ' + CUTS.length + ' coverage cut(s) to ' + RUN + '/runs/budget.md')`,
    `  await agent('Create the file ' + RUN + '/runs/budget.md (mkdir -p its directory) containing a markdown doc titled "# Budget coverage cuts" with one bullet per cut: ' + CUTS.map((c) => '"' + c + '"').join(', ') + '. Write NOTHING else and change no other file.', { label: 'budget-scribe', agentType: 'general-purpose' })`,
    `}`,
    ``,
    `phase('Research')`,
    `if (RESEARCH_GROUPED) {`,
    `  await agent(contract('researcher', 'DIMENSIONS=ALL (budget cut \u2014 see runs/budget.md). Cover EVERY dimension in one pass; write one ' + RUN + '/research/<id>.md per dimension (cited).'), { label: 'research:all', phase: 'Research', agentType: 'general-purpose' })`,
    `} else {`,
    `  await parallel(DIMENSIONS.map((d) => () => agent(contract('researcher', 'DIMENSION=' + d.id + ' (' + d.name + '). Write ' + RUN + '/research/' + d.id + '.md (cited).'), { label: 'research:' + d.id, phase: 'Research', agentType: 'general-purpose' })))`,
    `}`,
    ``,
    `phase('TestPlan')`,
    `await agent(contract('testplan'), { label: 'testplan', phase: 'TestPlan', agentType: 'general-purpose' })`,
    ``
  ];
  const defectStage = [
    `phase('Execute')`,
    `await parallel([`,
    `  () => agent(contract('executor', 'MODE=core \u2014 deterministic engine + gate exercises on genuine AND doctored artifacts.'), { label: 'run-core', phase: 'Execute', agentType: 'general-purpose' }),`,
    `  () => agent(contract('executor', 'MODE=live \u2014 realistic end-to-end run of the target.'), { label: 'run-live', phase: 'Execute', agentType: 'general-purpose' }),`,
    `])`,
    ``,
    `phase('Findings')`,
    `await agent(contract('findings'), { label: 'findings', phase: 'Findings', agentType: 'general-purpose' })`,
    ``
  ];
  const oppStage = [
    `phase('Analyze')`,
    `await agent(contract('analyzer'), { label: 'analyze', phase: 'Analyze', agentType: 'general-purpose' })`,
    ``,
    `phase('Brainstorm')`,
    `await agent(contract('brainstormer'), { label: 'brainstorm', phase: 'Brainstorm', agentType: 'general-purpose' })`,
    ``
  ];
  const tail = [
    `phase('Gate')`,
    `await agent(contract('gate'), { label: 'gate', phase: 'Gate', agentType: 'general-purpose' })`,
    ``,
    `phase('Judge')`,
    `await parallel(LENSES.map((lens, i) => () => agent(contract('judge', 'LENS=' + lens), { label: 'judge' + (i + 1), phase: 'Judge', agentType: 'general-purpose' })))`,
    ``,
    `phase('Results')`,
    `await agent(contract('remediator', CUTS.length ? 'BUDGET CUTS to report in SUMMARY.md (also listed in ' + RUN + '/runs/budget.md): ' + CUTS.join(' | ') : ''), { label: 'results', phase: 'Results', agentType: 'general-purpose' })`,
    ``,
    `// No top-level \`return\` \u2014 that is a parse-time SyntaxError under plain \`node\` (the guard`,
    `// above never gets a chance to run). Mirror rejudge.workflow.mjs: close with a log line.`,
    `log('ultraeval eval complete \u2014 see ' + RUN + '/index.html and ' + RUN + '/SUMMARY.md')`,
    ``
  ];
  return [...head, ...doDefects ? defectStage : [], ...doOpps ? oppStage : [], ...tail].join("\n");
}
var GATE_CHEATSHEET = (engineAbs, run) => [
  `- \`node ${engineAbs} check --run ${run}\` \u2014 structural grounding gate (every finding must resolve to a real file:line in the target, or a run: artifact). Exit 0 = grounded.`,
  `- \`node ${engineAbs} verify --run ${run}\` \u2014 writes VERIFY.todo.json (claim\u2194evidence). Fill each verdict honestly: \`supported\`/\`partial\`/\`refuted\`/\`unsupported\`.`,
  `- \`node ${engineAbs} verify --run ${run} --apply <verdicts.json>\` \u2014 reduces to VERIFY.json.`,
  `- \`node ${engineAbs} check --run ${run} --semantic --require-verify\` \u2014 folds verdicts in; the exit gate.`
].join("\n");
function agentContracts(cfg, runDirAbs, engineAbs) {
  const dims = cfg.dimensions.map((d) => `- **${d.id}** ${d.name} (w=${d.weight}${anchorText(d) ? `, anchored to ${anchorText(d)}` : ""}): ${d.whatPerfectLooksLike}`).join("\n");
  return {
    researcher: `# Contract: researcher

You research the *state of the art for how to evaluate* one DIMENSION of a ${cfg.kind} (category: ${cfg.category}).

Do REAL web research (WebSearch + WebFetch; if not loaded, ToolSearch \`select:WebSearch,WebFetch\`). Find authoritative methodology \u2014 metrics, benchmarks, rubrics, known failure modes \u2014 specific to this dimension and category.

Deliver:
1. Write a cited markdown note at \`${runDirAbs}/research/<DIMENSION>.md\` \u2014 every non-obvious methodological claim cites a fetched URL.
2. End the note with a **scoring rubric** for this dimension: 0\u20135 anchors and how to measure each on THIS target.

Each dimension is anchored to an external referential (see below). Your research MAY refine an anchor with cited justification; it MUST NOT silently drop the referential.

Dimensions in scope:
${dims}
`,
    testplan: `# Contract: testplan

Read \`${cfg.targetAbs}\` (its SKILL.md/README/CLI \`--help\`, or its source) and the research notes under \`${runDirAbs}/research/\`.

Enumerate EVERY functionality worth testing \u2014 modes, subcommands, flags, gates, and the live end-to-end behavior \u2014 mapped to the dimensions. For each: id, what it is, the concrete command or user prompt that tests it, and explicit pass criteria.

The live rows MUST map to the category's normed scenario set (golden path, error path, help contract \u2014 see \`references/live-scenarios.md\` next to the engine; the executor contract embeds this category's block).

Write \`${runDirAbs}/TEST-PLAN.md\` (a reviewable checklist with the rubric embedded). Be exhaustive about the CLI/behavior surface.
`,
    executor: `# Contract: executor
${diffScopeBlock(cfg)}
You produce the raw evidence an eval stands on. Two MODES; do the one named in your prompt.

**MODE=core (deterministic).** Drive the target's own engine/tests and, if the target ships anti-hallucination gates, prove them in BOTH directions: pass on a genuine artifact, fail on a hand-doctored one. Record every command + exit code into \`${runDirAbs}/runs/core.md\`. If the target has a test suite, run it and record the result.

**MODE=live (realistic).** Act as a real user of the target. Follow its own instructions faithfully and produce a real deliverable into \`${runDirAbs}/runs/live-*\`. Write a narrative to \`${runDirAbs}/runs/live.md\` covering what was produced, grounding quality, any hallucination, and each gate's outcome.

${liveScenarioBlock(cfg)}

HARD LIMITS (never block the pipeline):
- **Every Bash step is timeboxed** \u2014 set an explicit \`timeout\` (\u2264 600000 ms). If a step exceeds it, kill it and record "timed out", then continue.
- **Do NOT launch another live/network tool that itself fans out** \u2014 no nested web-research / "deep" / long-crawl runs of the target against a THIRD project. Exercise the target on a small, local, offline input. (A prior run hung ~4h doing exactly this.)
- If a live step is genuinely blocked (missing Docker, no network, rate-limit), degrade to the offline path, record what completed, and move on. Partial evidence is fine; a hang is not.

SAFETY:
- The target's own commands (tests, gates) run with YOUR privileges \u2014 sandbox untrusted targets before executing anything they ship.
- Helper scripts you write under RUN inherit the enclosing repo's package.json module type \u2014 name them \`.mjs\`/\`.cjs\` explicitly so ESM/CJS resolution never surprises you.

Record exact command lines and exit codes verbatim \u2014 later stages cite \`run:runs/core.md#Lnn\` as evidence, so line numbers matter.
`,
    findings: `# Contract: findings
${diffScopeBlock(cfg)}
Consolidate the test-plan results and the run logs into \`${runDirAbs}/findings.json\` following \`${runDirAbs}/findings.schema.json\`.

RULES (the grounding gate will enforce these):
- Every finding MUST carry at least one resolvable \`evidence.ref\`:
  - \`path:line\` or \`path:start-end\` \u2014 a real location IN THE TARGET (\`${cfg.targetAbs}\`).
  - \`run:relpath#Lnn\` \u2014 a line in a log this run produced.
- Do NOT invent line numbers. If you cite \`src/x.ts:42\`, line 42 must exist and support the claim.
- \`severity\`: ${severityLegend()}.
- \`status\`: \`confirmed\` (evidence holds) or \`open\` (needs verification). Never keep a finding you cannot ground \u2014 delete it.

Also draft \`${runDirAbs}/RESULTS.md\` (per-functionality results, every claim citing \`[F#]\`) and \`${runDirAbs}/SUMMARY.md\` (scorecard + headline). Flag any narrative sentence that is not a finding with \`[M]\`.
`,
    gate: `# Contract: gate

Run the target's grounding gate over the eval artifacts and iterate until green:

${GATE_CHEATSHEET(engineAbs, runDirAbs)}

If \`check\` fails, FIX \`findings.json\` (remove/repair ungrounded findings \u2014 do not weaken the gate) and re-run. If a finding is \`refuted\` by verification, set its status to \`dismissed\`. Report the final exit codes of \`check --run ${runDirAbs} --semantic --require-verify\` \u2014 it MUST be 0 before results.
`,
    judge: `# Contract: judge

You are an INDEPENDENT judge. You did not run the eval. Judge through the LENS named in your prompt.

**Step 0 \u2014 CALIBRATION (required).** Read the golden fixture at \`${calibrationFixturePath(engineAbs)}\`. Score its \`artifacts\` 0\u20135 on each of its \`dimensions\` (use each dimension's name, NOT its \`expected\`/\`signal\` fields \u2014 read the artifacts first, then compare). \`passed\` = every one of your scores is within \`tolerance\` of \`expected\`. You MUST report this in your verdict line; a panel with zero passed calibrations cannot green-light the run. Do NOT let the fixture influence how you score the real run.

Read \`${runDirAbs}/\`: research/, TEST-PLAN.md, runs/core.md, runs/live.md, findings.json, and spot-check the artifacts. Score each dimension 0\u20135 against its anchored referential (each dimension's \`anchors\` in \`dimensions.json\` names the standard it operationalizes) with a one-line rationale grounded in a path you actually read. Objective gate results (VERIFY.json, check exit codes) are ground truth \u2014 weight them.

Append your verdict to \`${runDirAbs}/judges.jsonl\` as one JSON line: \`{ "lens": "...", "author": "<your agent/session id>", "dimensionScores": [{"id","score","rationale"}], "overall": 0-100, "meetsExpectations": bool, "topFindings": [], "calibration": { "scores": {"<fixture-dim>": n}, "passed": bool } }\`. \`author\` matters: agreement is only meaningful across INDEPENDENT judges \u2014 a panel whose lines share one author is flagged.
`,
    remediator: `# Contract: remediator

Finalize the eval and generate the AI-exploitable fix docs.

1. Ensure \`${runDirAbs}/RESULTS.md\` and \`SUMMARY.md\` are complete and cite \`[F#]\`; \`score\` computes the weighted verdict and judge agreement from \`judges.jsonl\` \u2014 do not hand-average.
2. Score: \`node ${engineAbs} score --run ${runDirAbs}\` \u2192 \`scorecard.json\` (weighted 0-100 + meets-expectations, from judges.jsonl).
3. Emit the TDD backlog: \`node ${engineAbs} backlog --run ${runDirAbs} --tdd\` \u2192 \`BACKLOG.json\`, \`REMEDIATION.md\`, and one \`fixes/FIX-*.md\` card per confirmed finding/opportunity (RED failing/spec test \u2192 GREEN change \u2192 VERIFY).
4. Render the dashboard: \`node ${engineAbs} render --run ${runDirAbs}\` \u2192 \`index.md\` + \`index.html\` (shows the verdict + opportunities matrix).
5. Re-run \`node ${engineAbs} check --run ${runDirAbs} --semantic\` and confirm exit 0 (backlog integrity is part of the gate).
6. If \`${runDirAbs}/runs/budget.md\` exists (a budgeted run recorded coverage cuts), report EVERY cut in \`SUMMARY.md\` \u2014 \`check\` warns when the summary omits them; a silent cut reads as full coverage.

Report the verdict, the P0/P1 backlog headline, the top opportunities (impact\xD7effort), and the paths a downstream fix agent should consume.
`,
    analyzer: `# Contract: analyzer

Produce deterministic signal for the brainstorm stage.

Run \`node ${engineAbs} analyze --run ${runDirAbs}\` \u2192 writes \`analysis.json\` + \`ANALYSIS.md\` (size/complexity hotspots, import graph + cycles, git churn, test/doc gaps). Then read \`ANALYSIS.md\` and note the 5-8 highest-signal hotspots the brainstorm should anchor on. This stage is deterministic \u2014 do not invent metrics; report what the tool found.
`,
    brainstormer: `# Contract: brainstormer
${diffScopeBlock(cfg)}
Discover grounded improvement leads (both internal health AND product/capability) \u2014 be divergent, then keep the grounded ones.

1. \`node ${engineAbs} brainstorm --run ${runDirAbs}\` \u2192 emits \`BRAINSTORM.todo.md\` (lenses + hotspots).
2. Work every lens against the hotspots in \`ANALYSIS.md\` and the code. Generate MANY candidates, then write \`${runDirAbs}/opportunities.json\`: each \`{ dimension?, impact: high|med|low, effort: S|M|L, title, statement, recommendation, evidence:[{ref}] }\`. Every opportunity MUST anchor to a real \`file:line\` in the target or \`analysis:<file>\` \u2014 no ungrounded "rewrite everything". Rate impact/effort honestly (quick wins = high/S).
3. \`node ${engineAbs} brainstorm --run ${runDirAbs} --rank\` \u2192 folds ranked opportunities into \`findings.json\` as kind:opportunity. The Gate stage then \`check\`s them; drop any that do not resolve.
`
  };
}
function testPlanTemplate(cfg) {
  const dims = cfg.dimensions.map(
    (d) => `### ${d.name} (weight ${d.weight})
> Perfect: ${d.whatPerfectLooksLike}${anchorText(d) ? `
> Anchored to: ${anchorText(d)}` : ""}

- [ ] \u2026
`
  ).join("\n");
  return `# Test plan \u2014 ${cfg.target}

Target: \`${cfg.targetAbs}\` \xB7 kind: ${cfg.kind} \xB7 category: ${cfg.category}

## Rubric & dimensions

${dims}

## Functionalities to test

| id | functionality | how tested (command / prompt) | pass criteria |
|----|---------------|-------------------------------|---------------|
| T1 | \u2026 | \u2026 | \u2026 |

## Gate exercises (anti-hallucination, both directions)

- [ ] genuine artifact \u2192 gate PASS
- [ ] doctored artifact \u2192 gate FAIL
`;
}
function findingsSchema() {
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    type: "object",
    required: ["findings"],
    properties: {
      findings: {
        type: "array",
        items: {
          type: "object",
          required: ["id", "severity", "title", "statement", "evidence", "status"],
          properties: {
            id: { type: "string", pattern: "^F\\d+$" },
            kind: { enum: ["defect", "opportunity"], description: "defect (default) or opportunity \u2014 the gate requires impact+effort for opportunities" },
            dimension: { type: "string" },
            severity: {
              enum: [...VALID_SEVERITIES],
              description: VALID_SEVERITIES.map(
                (s) => `${s} \u2014 ${SEVERITY_DEFS[s].label} (${SEVERITY_DEFS[s].cvssBand}): ${SEVERITY_DEFS[s].meaning}; gate: ${SEVERITY_DEFS[s].gateEffect}`
              ).join(" | ")
            },
            impact: { enum: ["high", "med", "low"], description: "opportunities: value axis" },
            effort: { enum: ["S", "M", "L"], description: "opportunities: cost axis" },
            title: { type: "string" },
            statement: { type: "string" },
            evidence: {
              type: "array",
              minItems: 1,
              items: {
                type: "object",
                required: ["ref"],
                properties: { ref: { type: "string", description: "path:line | path:start-end | run:relpath#Lnn | url:..." }, note: { type: "string" } }
              }
            },
            failureScenario: { type: "string" },
            recommendation: { type: "string" },
            status: { enum: ["open", "confirmed", "dismissed"] }
          },
          allOf: [
            {
              if: { properties: { kind: { const: "opportunity" } }, required: ["kind"] },
              then: { required: ["impact", "effort"] }
            }
          ]
        }
      }
    }
  };
}

// src/plan.ts
function planRun(runDir, engineAbs) {
  const cfg = readJson(join11(runDir, "eval.config.json"));
  const written = [];
  const w = (rel, content) => {
    const p = join11(runDir, rel);
    writeText(p, content);
    written.push(p);
  };
  w("eval.workflow.mjs", workflowScript(cfg, runDir, engineAbs));
  for (const [name, content] of Object.entries(agentContracts(cfg, runDir, engineAbs))) w(`agents/${name}.md`, content);
  w("TEST-PLAN.template.md", testPlanTemplate(cfg));
  w("dimensions.json", `${JSON.stringify(cfg.dimensions, null, 2)}
`);
  w("findings.schema.json", `${JSON.stringify(findingsSchema(), null, 2)}
`);
  return written;
}

// src/fix.ts
import { spawnSync } from "child_process";
import { isAbsolute as isAbsolute2, join as join12, resolve as resolve3 } from "path";
function loadBacklog(runDir) {
  const blPath = join12(runDir, "BACKLOG.json");
  if (!exists(blPath)) throw new Error("no BACKLOG.json \u2014 run `backlog --run <run> --tdd` first, then fix");
  return { cfg: readJson(join12(runDir, "eval.config.json")), backlog: readJson(blPath) };
}
function targetInvariants(targetAbs) {
  const lines = [];
  const pkgPath = join12(targetAbs, "package.json");
  if (exists(pkgPath)) {
    const pkg = readJson(pkgPath);
    if (pkg.scripts?.test) lines.push(`- Full test suite green before committing: run the target's \`test\` script (\`${pkg.scripts.test}\`).`);
    if (pkg.scripts?.build) lines.push(`- The target ships a build step: run its \`build\` script and include the rebuilt artifacts in the commit.`);
  }
  lines.push("- One conventional commit (fix:/feat:/test:) scoped to THIS task only.");
  return lines;
}
function agentContract(t, cfg, runDir, engineAbs) {
  const targetAbs = resolveTargetAbs(cfg.targetAbs, cfg.target, runDir);
  const absTargets = t.targets.map((x) => isAbsolute2(x) ? x : join12(targetAbs, x));
  const redFile = isAbsolute2(t.red.testFile) ? t.red.testFile : join12(targetAbs, t.red.testFile);
  const deps = t.dependsOn.length ? `
Depends on: ${t.dependsOn.join(", ")} \u2014 confirm each is \`status: "done"\` in \`${join12(runDir, "BACKLOG.json")}\` before starting; if not, STOP and report.` : "";
  return `# Fix agent: ${t.id} \u2014 ${t.title}  (${t.priority} \xB7 ${t.kind})

You are an AUTONOMOUS fix agent. Fix exactly ONE task in the target repo, test-first. Do not widen scope; do not stop early.

Target repo (absolute): \`${targetAbs}\`
Eval run (absolute): \`${runDir}\`
Task: ${t.id} (finding ${t.findingId})${deps}

## Why
${t.rationale}

## RED \u2014 write the failing test FIRST
Test file (absolute): \`${redFile}\`
${t.red.description}
Run it and watch it FAIL for the expected reason BEFORE touching any implementation.

## GREEN \u2014 minimal change
${t.green.change}
Touch only: ${absTargets.map((x) => `\`${x}\``).join(", ") || "the relevant module"}

## VERIFY
\`${t.verify.command}\`
The RED test now passes and nothing regresses. Then close the loop:
\`node ${engineAbs} verify-fix --run ${runDir} --task ${t.id}\`
(echoes the exact command + cwd, then replays the verify command timeboxed, checks the RED test file exists, and stamps \`status: "done"\` + \`verifiedAt\` in BACKLOG.json \u2014 exit 1 otherwise).
Note: \`verify.command\` in BACKLOG.json is executable configuration \u2014 it runs verbatim through a shell in the target with your privileges; treat a run directory from an untrusted source like code.

## Invariants (non-negotiable)
- TDD: no implementation before the RED test is seen failing.
- NEVER weaken a gate or test to go green \u2014 no skipped/deleted tests, no loosened assertions, no lowered thresholds.
${targetInvariants(targetAbs).join("\n")}
`;
}
function emitFixAgents(runDir, engineAbs, opts = {}) {
  const { cfg, backlog } = loadBacklog(runDir);
  let tasks = backlog.tasks;
  if (opts.task) {
    const t = tasks.find((x) => x.id === opts.task);
    if (!t) throw new Error(`no such task ${opts.task} in BACKLOG.json (${tasks.length} task(s): ${tasks.map((x) => x.id).join(", ")})`);
    tasks = [t];
  }
  const written = [];
  for (const t of tasks) {
    const p = join12(runDir, "fixes", "agents", `${t.id}.agent.md`);
    writeText(p, agentContract(t, cfg, runDir, engineAbs));
    written.push(p);
  }
  if (opts.workflow) {
    const p = join12(runDir, "fix.workflow.mjs");
    writeText(p, fixWorkflow(tasks, runDir, engineAbs));
    written.push(p);
  }
  return written;
}
function fixWorkflow(tasks, runDir, engineAbs) {
  const meta = {
    name: "ultraeval-fix",
    description: `Dispatch ${tasks.length} fix agent(s) over the TDD backlog, verify-fix after each`,
    phases: [{ title: "Fix" }]
  };
  return [
    `export const meta = ${JSON.stringify(meta)}`,
    ``,
    `const ENGINE = ${JSON.stringify(engineAbs)}`,
    `const RUN = ${JSON.stringify(runDir)}`,
    `const TASKS = ${JSON.stringify(tasks.map((t) => t.id))}`,
    `const ISOLATION = undefined // set to 'worktree' to isolate each fix agent`,
    ``,
    `phase('Fix')`,
    `for (const id of TASKS) {`,
    `  await agent('Read and follow the fix-agent contract at ' + RUN + '/fixes/agents/' + id + '.agent.md VERBATIM.', { label: id, phase: 'Fix', agentType: 'general-purpose', ...(ISOLATION ? { isolation: ISOLATION } : {}) })`,
    `  await agent('Run \`node ' + ENGINE + ' verify-fix --run ' + RUN + ' --task ' + id + '\` and report its exit code and output verbatim.', { label: 'verify:' + id, phase: 'Fix', agentType: 'general-purpose' })`,
    `}`,
    `log('fix loop complete \u2014 ' + TASKS.length + ' task(s) dispatched; BACKLOG.json carries status/verifiedAt')`,
    ``
  ].join("\n");
}
function verifyFix(runDir, taskId, opts = {}) {
  const { cfg, backlog } = loadBacklog(runDir);
  const task = backlog.tasks.find((t) => t.id === taskId);
  if (!task) throw new Error(`no such task ${taskId} in BACKLOG.json`);
  const targetAbs = resolveTargetAbs(cfg.targetAbs, cfg.target, runDir);
  const redFile = isAbsolute2(task.red.testFile) ? task.red.testFile : resolve3(targetAbs, task.red.testFile);
  const redTestExists = exists(redFile);
  console.error(`verify-fix ${taskId}: replaying \`${task.verify.command}\` in ${targetAbs}`);
  const proc = spawnSync(task.verify.command, { shell: true, cwd: targetAbs, encoding: "utf8", timeout: opts.timeoutMs ?? 6e5 });
  const exitCode = proc.status;
  const ok = exitCode === 0 && redTestExists;
  const result = { ok, taskId, exitCode, redTestExists };
  if (!redTestExists) result.reason = `RED test file missing: ${redFile} \u2014 the fix was not test-first`;
  else if (exitCode !== 0) result.reason = `verify command exited ${exitCode ?? "null (timeout/kill)"}: ${task.verify.command}`;
  if (ok) {
    task.status = "done";
    task.verifiedAt = (/* @__PURE__ */ new Date()).toISOString();
    result.verifiedAt = task.verifiedAt;
    writeJson(join12(runDir, "BACKLOG.json"), backlog);
  }
  return result;
}
function formatVerifyFix(r) {
  return r.ok ? `PASS  ${r.taskId} verified \u2014 status: done (${r.verifiedAt})` : `FAIL  ${r.taskId} \u2014 ${r.reason ?? "verification failed"}`;
}

// src/rejudge.ts
import { cpSync, mkdirSync as mkdirSync2 } from "fs";
import { join as join13 } from "path";
var COPY_FILES = ["eval.config.json", "dimensions.json", "findings.json", "RESULTS.md", "SUMMARY.md", "TEST-PLAN.md", "VERIFY.json"];
var COPY_DIRS = ["research", "runs"];
function rejudgeRun(runDir, outDir, engineAbs) {
  if (!exists(join13(runDir, "eval.config.json"))) throw new Error(`refusing to rejudge ${runDir}: not an ultraeval run (no eval.config.json)`);
  const cfg = readJson(join13(runDir, "eval.config.json"));
  mkdirSync2(outDir, { recursive: true });
  const copied = [];
  for (const f of COPY_FILES) {
    if (!exists(join13(runDir, f))) continue;
    cpSync(join13(runDir, f), join13(outDir, f));
    copied.push(f);
  }
  for (const d of COPY_DIRS) {
    if (!exists(join13(runDir, d))) continue;
    cpSync(join13(runDir, d), join13(outDir, d), { recursive: true });
    copied.push(`${d}/`);
  }
  writeText(join13(outDir, "judges.jsonl"), "");
  writeText(join13(outDir, "agents", "judge.md"), agentContracts(cfg, outDir, engineAbs).judge);
  writeText(join13(outDir, "rejudge.workflow.mjs"), rejudgeWorkflow(cfg, outDir, engineAbs, runDir));
  return copied;
}
function rejudgeWorkflow(cfg, outAbs, engineAbs, baseAbs) {
  const meta = {
    name: "ultraeval-rejudge",
    description: `Re-judge ${cfg.targetAbs} from reused artifacts (test-retest verdict stability)`,
    phases: [{ title: "Judge" }, { title: "Score" }]
  };
  return [
    `export const meta = ${JSON.stringify(meta)}`,
    ``,
    `// Constants for THIS rejudge (injected by \`ultraeval rejudge\`).`,
    `const ENGINE = ${JSON.stringify(engineAbs)}`,
    `const RUN = ${JSON.stringify(outAbs)}`,
    `const BASE = ${JSON.stringify(baseAbs)}`,
    `const AGENTS = RUN + '/agents'`,
    ``,
    `function contract(name, extra) {`,
    `  return 'Read and follow the dispatch contract at ' + AGENTS + '/' + name + '.md VERBATIM.\\n'`,
    `    + 'Constants: ENGINE=' + ENGINE + '  RUN=' + RUN + '.\\n'`,
    `    + 'Invoke the engine only by its ABSOLUTE path: node ' + ENGINE + ' <cmd>. Write every artifact under RUN. Do not stop early.'`,
    `    + (extra ? '\\n' + extra : '')`,
    `}`,
    ``,
    `log('ultraeval rejudge (test-retest) for ' + RUN)`,
    ``,
    `phase('Judge')`,
    `const LENSES = ['correctness+grounding', 'completeness+coverage', 'ux+meets-expectations']`,
    `await parallel(LENSES.map((lens, i) => () => agent(contract('judge', 'LENS=' + lens), { label: 'judge' + (i + 1), phase: 'Judge', agentType: 'general-purpose' })))`,
    ``,
    `phase('Score')`,
    `await agent('Run \`node ' + ENGINE + ' score --run ' + RUN + '\` then \`node ' + ENGINE + ' compare --run ' + RUN + ' --base ' + BASE + '\`. Report the verdict, |\u0394overall| vs the base run and both agreement values (COMPARE.md prints a stability line at constant target commit).', { label: 'score', phase: 'Score', agentType: 'general-purpose' })`,
    ``,
    `log('rejudge complete \u2014 see ' + RUN + '/COMPARE.md')`,
    ``
  ].join("\n");
}

// src/render.ts
import { join as join14 } from "path";
function anchorFor(cfg, id) {
  const d = (cfg.dimensions ?? []).find((x) => x.id === id);
  return d?.anchors?.length ? d.anchors.map((a) => `${a.standard} \u2014 ${a.ref}`).join("; ") : "\u2014";
}
var provLine2 = (p) => p ? `engine ${p.engineVersion} \xB7 protocol ${p.protocolVersion} \xB7 rubric ${p.rubricVersion}${p.targetGit ? ` \xB7 target ${p.targetGit.commit.slice(0, 7)}${p.targetGit.dirty ? "*" : ""}` : ""}` : "";
function load2(runDir) {
  const cfg = readJson(join14(runDir, "eval.config.json"));
  const doc = readJson(join14(runDir, "findings.json"));
  const verify = exists(join14(runDir, "VERIFY.json")) ? readJson(join14(runDir, "VERIFY.json")) : null;
  const backlog = exists(join14(runDir, "BACKLOG.json")) ? readJson(join14(runDir, "BACKLOG.json")) : null;
  const scorecard = exists(join14(runDir, "scorecard.json")) ? readJson(join14(runDir, "scorecard.json")) : null;
  return { cfg, doc, verify, backlog, scorecard };
}
function render(runDir, opts = {}) {
  const { cfg, doc, verify, backlog, scorecard } = load2(runDir);
  const out = opts.out ?? runDir;
  const written = [];
  if (opts.md !== false) {
    const p = join14(out, "index.md");
    writeText(p, buildMd(cfg, doc, verify, backlog, scorecard));
    written.push(p);
  }
  if (opts.html !== false) {
    const p = join14(out, "index.html");
    writeText(p, buildHtml(cfg, doc, verify, backlog, scorecard));
    written.push(p);
  }
  return written;
}
function counts(doc) {
  const live = doc.findings.filter((f) => f.status !== "dismissed");
  const defects = live.filter((f) => f.kind !== "opportunity");
  const opps = live.filter((f) => f.kind === "opportunity");
  const by = (s) => defects.filter((f) => f.severity === s).length;
  return { total: defects.length, p0: by("P0"), p1: by("P1"), p2: by("P2"), opps: opps.length };
}
function opportunities(doc) {
  return doc.findings.filter((f) => f.status !== "dismissed" && f.kind === "opportunity").sort((a, b) => opportunityValue(b.impact, b.effort) - opportunityValue(a.impact, a.effort));
}
function buildMd(cfg, doc, verify, backlog, scorecard) {
  const c = counts(doc);
  const rows = doc.findings.filter((f) => f.status !== "dismissed" && f.kind !== "opportunity").map((f) => `| ${f.id} | ${f.severity} | ${f.title.replace(/\|/g, "\\|")} | ${f.status} | ${(f.evidence ?? []).map((e) => `\`${e.ref}\``).join(" ")} |`).join("\n");
  const prov = provLine2(cfg.provenance);
  const parts = [
    `# Evaluation \u2014 ${cfg.target}`,
    ``,
    `> target \`${cfg.targetAbs}\` \xB7 ${cfg.kind} \xB7 ${cfg.category} \xB7 ${c.total} findings (P0 ${c.p0} \xB7 P1 ${c.p1} \xB7 P2 ${c.p2})${c.opps ? ` \xB7 ${c.opps} opportunities` : ""}`,
    ...prov ? [`> ${prov}`] : [],
    ``
  ];
  if (scorecard) {
    parts.push(
      `## Verdict \u2014 ${scorecard.meetsExpectations ? "\u2705 MEETS" : "\u274C BELOW"} expectations \xB7 ${scorecard.overall}/100`,
      ``,
      `_${scorecard.reason} (${scorecard.judges} judge${scorecard.judges === 1 ? "" : "s"})_`,
      ...scorecard.sensitivity ? [
        ``,
        scorecard.sensitivity.robust ? `_Weight sensitivity: verdict robust to \xB10.05 shifts._` : `_Weight sensitivity: verdict flips under a \xB10.05 shift of ${scorecard.sensitivity.flips.join(", ")}._`
      ] : [],
      ``,
      `| dimension | score | weight | anchored to |`,
      `|-----------|-------|--------|-------------|`,
      ...scorecard.dimensions.map((d) => `| ${d.name} | ${d.score.toFixed(1)}/5 | ${d.weight} | ${anchorFor(cfg, d.id)} |`),
      ``
    );
  }
  parts.push(`## Findings`, ``, `| id | sev | title | status | evidence |`, `|----|-----|-------|--------|----------|`, rows || `| \u2014 | \u2014 | none | \u2014 | \u2014 |`);
  const opps = opportunities(doc);
  if (opps.length)
    parts.push(
      ``,
      `## Opportunities (${opps.length}) \u2014 impact \xD7 effort`,
      ``,
      `| id | impact | effort | value | title |`,
      `|----|--------|--------|-------|-------|`,
      ...opps.map(
        (f) => `| ${f.id} | ${f.impact ?? "?"} | ${f.effort ?? "?"} | ${opportunityValue(f.impact, f.effort).toFixed(2)} | ${f.title.replace(/\|/g, "\\|")} |`
      ),
      ``,
      `Quick wins (value \u2265 2): ${opps.filter((f) => opportunityValue(f.impact, f.effort) >= 2).map((f) => f.id).join(", ") || "\u2014"}`
    );
  if (verify)
    parts.push(
      ``,
      `## Verification`,
      ``,
      `${verify.ok ? "\u2705" : "\u274C"} ${verify.adjudicated} adjudicated \xB7 ${verify.supported} supported \xB7 ${verify.refuted} refuted \xB7 ${verify.unsupported} unsupported${verify.failures.length ? ` \xB7 fails: ${verify.failures.join(", ")}` : ""}`
    );
  if (backlog)
    parts.push(
      ``,
      `## Fix backlog (${backlog.tasks.length})`,
      ``,
      backlog.tasks.map((t) => `- **${t.id}** (${t.priority}) ${t.title} \u2192 \`${t.red.testFile}\``).join("\n") || "- none"
    );
  return `${parts.join("\n")}
`;
}
var STYLE = `body{font:15px/1.5 system-ui,sans-serif;max-width:60rem;margin:2rem auto;padding:0 1rem;color:#111}
h1{margin-bottom:.2rem}table{border-collapse:collapse;width:100%;margin:1rem 0}th,td{border:1px solid #ddd;padding:.4rem .6rem;text-align:left;font-size:14px}
.p0{color:#b00}.p1{color:#a60}.p2{color:#555}.meta{color:#666}code{background:#f4f4f4;padding:.05rem .3rem;border-radius:3px}
@media(prefers-color-scheme:dark){body{background:#111;color:#eee}th,td{border-color:#333}code{background:#222}.meta{color:#999}}`;
function buildHtml(cfg, doc, verify, backlog, scorecard) {
  const c = counts(doc);
  const verdict = scorecard ? `<h2>Verdict \u2014 ${scorecard.meetsExpectations ? "\u2705 MEETS" : "\u274C BELOW"} expectations \xB7 ${scorecard.overall}/100</h2><p class="meta">${esc(scorecard.reason)} (${scorecard.judges} judge${scorecard.judges === 1 ? "" : "s"})</p>${scorecard.sensitivity ? `<p class="meta">Weight sensitivity: ${scorecard.sensitivity.robust ? "verdict robust to \xB10.05 shifts" : `verdict flips under a \xB10.05 shift of ${esc(scorecard.sensitivity.flips.join(", "))}`}</p>` : ""}<table><tr><th>dimension</th><th>score</th><th>weight</th><th>anchored to</th></tr>${scorecard.dimensions.map((d) => `<tr><td>${esc(d.name)}</td><td>${d.score.toFixed(1)}/5</td><td>${d.weight}</td><td>${esc(anchorFor(cfg, d.id))}</td></tr>`).join("")}</table>` : "";
  const rows = doc.findings.filter((f) => f.status !== "dismissed" && f.kind !== "opportunity").map(
    (f) => `<tr><td>${f.id}</td><td class="${f.severity.toLowerCase()}">${f.severity}</td><td>${esc(f.title)}</td><td>${f.status}</td><td>${(f.evidence ?? []).map((e) => `<code>${esc(e.ref)}</code>`).join(" ")}</td></tr>`
  ).join("");
  const opps = opportunities(doc);
  const oppsHtml = opps.length ? `<h2>Opportunities (${opps.length}) \u2014 impact \xD7 effort</h2><table><tr><th>id</th><th>impact</th><th>effort</th><th>value</th><th>title</th></tr>${opps.map((f) => `<tr><td>${f.id}</td><td>${f.impact ?? "?"}</td><td>${f.effort ?? "?"}</td><td>${opportunityValue(f.impact, f.effort).toFixed(2)}</td><td>${esc(f.title)}</td></tr>`).join("")}</table>` : "";
  const bl = backlog ? `<h2>Fix backlog (${backlog.tasks.length})</h2><ul>${backlog.tasks.map((t) => `<li><b>${t.id}</b> (${t.priority}) ${esc(t.title)} \u2192 <code>${esc(t.red.testFile)}</code></li>`).join("")}</ul>` : "";
  const vf = verify ? `<h2>Verification</h2><p>${verify.ok ? "\u2705" : "\u274C"} ${verify.adjudicated} adjudicated \xB7 ${verify.supported} supported \xB7 ${verify.refuted} refuted \xB7 ${verify.unsupported} unsupported${verify.failures.length ? ` \xB7 fails: ${esc(verify.failures.join(", "))}` : ""}</p>` : "";
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ultraeval \u2014 ${esc(cfg.target)}</title><style>${STYLE}</style></head><body>
<h1>Evaluation \u2014 ${esc(cfg.target)}</h1>
<p class="meta"><code>${esc(cfg.targetAbs)}</code> \xB7 ${cfg.kind} \xB7 ${esc(cfg.category)} \xB7 ${c.total} findings (P0 ${c.p0} \xB7 P1 ${c.p1} \xB7 P2 ${c.p2})${c.opps ? ` \xB7 ${c.opps} opportunities` : ""}</p>
${provLine2(cfg.provenance) ? `<p class="meta">${esc(provLine2(cfg.provenance))}</p>` : ""}
${verdict}
<h2>Findings</h2><table><tr><th>id</th><th>sev</th><th>title</th><th>status</th><th>evidence</th></tr>${rows}</table>
${oppsHtml}
${vf}${bl}</body></html>
`;
}
function esc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// src/score.ts
import { appendFileSync, mkdirSync as mkdirSync3 } from "fs";
import { dirname as dirname3, join as join15 } from "path";
function readJudges(runDir) {
  const p = join15(runDir, "judges.jsonl");
  if (!exists(p)) return [];
  return readText(p).split("\n").map((l) => l.trim()).filter(Boolean).map((l) => {
    try {
      return JSON.parse(l);
    } catch {
      return null;
    }
  }).filter((x) => x !== null);
}
function computeScore(cfg, judges, doc) {
  const dims = cfg.dimensions ?? [];
  const dimensions = dims.map((d) => {
    const scores = judges.flatMap((j) => (j.dimensionScores ?? []).filter((s) => s.id === d.id).map((s) => s.score)).filter((n) => typeof n === "number");
    const avg = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
    const spread = scores.length > 1 ? Number((Math.max(...scores) - Math.min(...scores)).toFixed(2)) : 0;
    return { id: d.id, name: d.name, weight: d.weight, score: Number(avg.toFixed(2)), spread };
  });
  const totalWeight = dimensions.reduce((a, b) => a + b.weight, 0) || 1;
  const weighted = dimensions.reduce((a, b) => a + b.score / 5 * b.weight, 0) / totalWeight;
  const overall = Math.round(weighted * 100);
  const bar = cfg.meetsBar ?? MEETS_BAR;
  const avgSpread = dimensions.length ? dimensions.reduce((a, b) => a + (b.spread ?? 0), 0) / dimensions.length : 0;
  const agreement = Number((1 - avgSpread / 5).toFixed(2));
  const liveP0 = (doc.findings ?? []).some((f) => f.status !== "dismissed" && f.kind !== "opportunity" && f.severity === "P0");
  const judgeSaysNo = judges.length > 0 && judges.some((j) => j.meetsExpectations === false);
  const calibrated = judges.filter((j) => j.calibration?.passed === true).length;
  const judgesCalibrated = judges.length ? `${calibrated}/${judges.length}` : void 0;
  const calibrationVeto = judges.length > 0 && calibrated === 0;
  const authors = judges.map((j) => j.author).filter((a) => typeof a === "string" && a.length > 0);
  const judgesIndependent = judges.length > 1 && authors.length === judges.length ? new Set(authors).size > 1 : void 0;
  const meetsBase = !liveP0 && !judgeSaysNo && !calibrationVeto;
  const meetsExpectations = meetsBase && overall >= bar;
  const overallWith = (dimId, delta) => {
    const ws = dimensions.map((x) => ({ w: Math.max(0, x.weight + (x.id === dimId ? delta : 0)), s: x.score }));
    const tot = ws.reduce((a, b) => a + b.w, 0) || 1;
    return Math.round(ws.reduce((a, b) => a + b.s / 5 * b.w, 0) / tot * 100);
  };
  const flips = dimensions.filter((d) => [0.05, -0.05].some((delta) => (meetsBase && overallWith(d.id, delta) >= bar) !== meetsExpectations)).map((d) => d.id);
  const sensitivity = { robust: flips.length === 0, flips };
  const reason = liveP0 ? "an unresolved P0 finding caps meets-expectations at false" : judgeSaysNo ? "a judge ruled it does not meet expectations" : calibrationVeto ? "no judge passed calibration \u2014 an uncalibrated panel cannot green-light the verdict" : overall < bar ? `weighted score ${overall} is below the ${bar} bar` : `no P0, judges agree, score ${overall} >= ${bar}`;
  return {
    overall,
    maxScore: 100,
    meetsExpectations,
    bar,
    dimensions,
    judges: judges.length,
    agreement,
    reason,
    sensitivity,
    ...judgesCalibrated ? { judgesCalibrated } : {},
    ...judgesIndependent !== void 0 ? { judgesIndependent } : {}
  };
}
function scoreRun(runDir) {
  const cfg = readJson(join15(runDir, "eval.config.json"));
  const doc = exists(join15(runDir, "findings.json")) ? readJson(join15(runDir, "findings.json")) : { findings: [] };
  const judges = readJudges(runDir);
  if (!judges.length) throw new Error("no judge verdicts in judges.jsonl \u2014 the Judge phase has not run; dispatch judges (agents/judge.md) first");
  const sc = computeScore(cfg, judges, doc);
  if (cfg.provenance) sc.provenance = cfg.provenance;
  sc.scoredAt = (/* @__PURE__ */ new Date()).toISOString();
  writeJson(join15(runDir, "scorecard.json"), sc);
  return sc;
}
function appendHistory(runDir, file) {
  const scPath = join15(runDir, "scorecard.json");
  if (!exists(scPath)) throw new Error("no scorecard.json \u2014 run `score --run <run>` first, then --history");
  const sc = readJson(scPath);
  const doc = exists(join15(runDir, "findings.json")) ? readJson(join15(runDir, "findings.json")) : { findings: [] };
  const live = (doc.findings ?? []).filter((f) => f.status !== "dismissed");
  const commit = sc.provenance?.targetGit?.commit;
  const entry = {
    scoredAt: sc.scoredAt ?? (/* @__PURE__ */ new Date()).toISOString(),
    ...commit ? { commit } : {},
    overall: sc.overall,
    meetsExpectations: sc.meetsExpectations,
    bar: sc.bar,
    agreement: sc.agreement,
    counts: {
      p0: live.filter((f) => f.kind !== "opportunity" && f.severity === "P0").length,
      p1: live.filter((f) => f.kind !== "opportunity" && f.severity === "P1").length,
      p2: live.filter((f) => f.kind !== "opportunity" && f.severity === "P2").length,
      opps: live.filter((f) => f.kind === "opportunity").length
    }
  };
  mkdirSync3(dirname3(file), { recursive: true });
  appendFileSync(file, `${JSON.stringify(entry)}
`);
  return entry;
}
function formatScore(sc) {
  const head = `${sc.meetsExpectations ? "MEETS" : "BELOW"} expectations \u2014 ${sc.overall}/100 (${sc.judges} judge${sc.judges === 1 ? "" : "s"}${sc.judgesCalibrated ? `, ${sc.judgesCalibrated} calibrated` : ""})`;
  const lines = [head, ...sc.dimensions.map((d) => `  ${d.score.toFixed(1)}/5  ${d.name} (w=${d.weight})`), `  -> ${sc.reason}`];
  if (sc.sensitivity) {
    lines.push(
      sc.sensitivity.robust ? "  weights: verdict robust to \xB10.05 shifts" : `  weights: verdict flips under a \xB10.05 shift of ${sc.sensitivity.flips.join(", ")}`
    );
  }
  if (sc.judgesIndependent === false) lines.push("  panel: single-author \u2014 agreement is self-consistency, not independence");
  if (sc.provenance) {
    const p = sc.provenance;
    const sha = p.targetGit ? ` \xB7 target ${p.targetGit.commit.slice(0, 7)}${p.targetGit.dirty ? "*" : ""}` : "";
    lines.push(`  engine ${p.engineVersion} \xB7 protocol ${p.protocolVersion} \xB7 rubric ${p.rubricVersion}${sha}`);
  }
  return lines.join("\n");
}

// src/status.ts
import { join as join16 } from "path";
function statusRun(runDir) {
  const has = (rel) => exists(join16(runDir, rel));
  const judgesPresent = has("judges.jsonl") && readText(join16(runDir, "judges.jsonl")).trim().length > 0;
  const steps = [
    { artifact: "eval.config.json", present: has("eval.config.json"), stage: "init" },
    { artifact: "agents/", present: has("agents"), stage: "plan" },
    { artifact: "eval.workflow.mjs", present: has("eval.workflow.mjs"), stage: "plan" },
    { artifact: "TEST-PLAN.md", present: has("TEST-PLAN.md"), stage: "testplan" },
    { artifact: "findings.json", present: has("findings.json"), stage: "findings" },
    { artifact: "VERIFY.json", present: has("VERIFY.json"), stage: "verify" },
    { artifact: "judges.jsonl", present: judgesPresent, stage: "judge" },
    { artifact: "scorecard.json", present: has("scorecard.json"), stage: "score" },
    { artifact: "BACKLOG.json", present: has("BACKLOG.json"), stage: "backlog" },
    { artifact: "index.html", present: has("index.html"), stage: "render" }
  ];
  return { steps, next: nextHint(steps, runDir) };
}
function nextHint(steps, runDir) {
  const missing = (stage) => steps.some((s) => s.stage === stage && !s.present);
  if (missing("init")) return `init --target <target> --out ${runDir}`;
  if (missing("plan")) return `plan --run ${runDir}`;
  if (missing("testplan") || missing("findings"))
    return `launch the generated workflow \u2014 Workflow({ scriptPath: "${runDir}/eval.workflow.mjs" }) \u2014 or run the stages by hand via agents/*.md`;
  if (missing("verify"))
    return `check --run ${runDir} && verify --run ${runDir} --honeypots 3, fill verdicts, then verify --apply and check --semantic --require-verify`;
  if (missing("judge")) return `dispatch the judge panel (agents/judge.md) to append judges.jsonl`;
  if (missing("score")) return `score --run ${runDir} --history`;
  if (missing("backlog")) return `backlog --run ${runDir} --tdd`;
  if (missing("render")) return `render --run ${runDir} \u2014 then fix --run ${runDir} [--workflow] and verify-fix per task`;
  return `done \u2014 drive remediation: fix --run ${runDir} [--workflow], then verify-fix --run ${runDir} --task FIX-XXX`;
}
function formatStatus(s, runDir) {
  const lines = [`status  ${runDir}`];
  for (const st of s.steps) lines.push(`  ${st.present ? "\u2713" : "\xB7"} ${st.artifact}  (${st.stage})`);
  lines.push(`  next: ${s.next}`);
  return lines.join("\n");
}

// src/cliargs.ts
var VALUE_FLAGS = /* @__PURE__ */ new Set([
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
  "--honeypots",
  "--task"
]);
var OPTIONAL_VALUE_FLAGS = /* @__PURE__ */ new Set(["--history"]);
function parse(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === void 0) continue;
    if (a === "-h") args.help = true;
    else if (a === "-v") args.version = true;
    else if (a.startsWith("--")) {
      if (VALUE_FLAGS.has(a)) args[a.slice(2)] = argv[++i] ?? "";
      else if (OPTIONAL_VALUE_FLAGS.has(a)) {
        const next = argv[i + 1];
        args[a.slice(2)] = next !== void 0 && !next.startsWith("--") ? argv[++i] : "";
      } else args[a.slice(2)] = true;
    } else args._.push(a);
  }
  return args;
}
function num(v) {
  return typeof v === "string" && v !== "" ? Number(v) : void 0;
}
function str(v) {
  return typeof v === "string" ? v : void 0;
}

// src/verify.ts
import { readdirSync as readdirSync4 } from "fs";
import { isAbsolute as isAbsolute3, join as join17, resolve as resolve4 } from "path";
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = a + 1831565813 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
function buildWorklist(runDir, maxVerify = CAPS.maxVerify) {
  const cfg = readJson(join17(runDir, "eval.config.json"));
  const doc = readJson(join17(runDir, "findings.json"));
  const findings = (doc.findings ?? []).filter((f) => f.status !== "dismissed").sort((a, b) => (SEV_ORDER[a.severity] ?? 9) - (SEV_ORDER[b.severity] ?? 9));
  const pairs = [];
  const resolveOpts = { targetAbs: resolveTargetAbs(cfg.targetAbs, cfg.target, runDir), runDir };
  for (const f of findings) {
    for (const e of f.evidence ?? []) {
      if (pairs.length >= maxVerify) break;
      const r = resolveEvidence(e.ref, resolveOpts);
      if (!r.gradeable) continue;
      const digest = r.resolved && r.absPath ? extractContext(r.absPath, r.lineStart, r.lineEnd) : `(unresolved: ${r.reason})`;
      pairs.push({ claimId: f.id, evidenceRef: e.ref, claim: f.statement, digest, verdict: null, note: "" });
    }
  }
  return { run: runDir, pairs };
}
function runVerify(runDir, opts = {}) {
  const full = buildWorklist(runDir, opts.maxVerify);
  let pairs = full.pairs;
  if (opts.shards && opts.shard !== void 0) pairs = pairs.filter((_, i) => i % opts.shards === opts.shard);
  const sh = opts.shards !== void 0 && opts.shard !== void 0;
  let planted;
  if (opts.honeypots && opts.honeypots > 0) {
    const h = plantHoneypots(runDir, pairs, opts.honeypots, opts.shard);
    pairs = h.pairs;
    planted = h.planted;
  }
  const out = { run: runDir, pairs };
  writeJson(join17(runDir, sh ? `VERIFY.todo.${opts.shard}.json` : "VERIFY.todo.json"), out);
  writeText(join17(runDir, sh ? `VERIFY.${opts.shard}.md` : "VERIFY.md"), renderWorklistMd(out));
  if (planted !== void 0) out.planted = planted;
  return out;
}
function plantHoneypots(runDir, pairs, n, shard) {
  if (pairs.length < 2) return { pairs, planted: 0 };
  const cfg = readJson(join17(runDir, "eval.config.json"));
  const doc = readJson(join17(runDir, "findings.json"));
  const seedHex = cfg.provenance?.dimensionsHash ?? "0";
  const rng = mulberry32((Number.parseInt(seedHex.slice(0, 8), 16) || 1) + (shard ?? 0));
  let maxN = 0;
  for (const f of doc.findings ?? []) {
    const m = /^F(\d+)$/.exec(f.id);
    if (m?.[1]) maxN = Math.max(maxN, Number(m[1]));
  }
  const offset = (shard ?? 0) * n;
  const pathOf = (ref) => /:\d/.test(ref) ? ref.slice(0, ref.lastIndexOf(":")) : ref;
  const real = [...pairs];
  const traps = [];
  for (let k = 0; k < n; k++) {
    const a = real[Math.floor(rng() * real.length)];
    const others = real.filter((p) => p.claimId !== a.claimId);
    const elsewhere = others.filter((p) => pathOf(p.evidenceRef) !== pathOf(a.evidenceRef));
    const pool = elsewhere.length ? elsewhere : others;
    if (!pool.length) break;
    const b = pool[Math.floor(rng() * pool.length)];
    traps.push({ claimId: `F${maxN + offset + k + 1}`, evidenceRef: b.evidenceRef, claim: a.claim, digest: b.digest, verdict: null, note: "" });
  }
  const mixed = [...pairs];
  for (const t of traps) mixed.splice(Math.floor(rng() * (mixed.length + 1)), 0, t);
  if (traps.length) {
    const truthName = shard !== void 0 ? `VERIFY.honeypots.${shard}.json` : "VERIFY.honeypots.json";
    writeJson(join17(runDir, truthName), {
      note: "ground truth for planted honeypot pairs \u2014 never paste this file into a skeptic prompt",
      claimIds: traps.map((t) => t.claimId)
    });
  }
  return { pairs: mixed, planted: traps.length };
}
function loadHoneypotIds(runDir) {
  const ids = /* @__PURE__ */ new Set();
  const files = [join17(runDir, "VERIFY.honeypots.json")];
  if (exists(runDir)) {
    for (const e of readdirSync4(runDir)) if (/^VERIFY\.honeypots\.\d+\.json$/.test(e)) files.push(join17(runDir, e));
  }
  for (const f of files) {
    if (!exists(f)) continue;
    for (const id of readJson(f).claimIds ?? []) ids.add(id);
  }
  return ids;
}
function renderWorklistMd(todo) {
  const lines = [
    "# Verification worklist",
    "",
    "For each pair: read the digest, judge whether it SUPPORTS the finding, write a verdict.",
    "Verdicts: `supported` \xB7 `partial` \xB7 `refuted` \xB7 `unsupported`.",
    ""
  ];
  for (const p of todo.pairs) {
    lines.push(`## ${p.claimId} \xB7 ${p.evidenceRef}`);
    lines.push(`**Finding:** ${p.claim}`);
    lines.push("```", p.digest, "```");
    lines.push("**Verdict:** ______  \xB7  **Note:** ______", "");
  }
  return `${lines.join("\n")}
`;
}
function reduceVerdicts(verdicts, findings) {
  const nonDismissed = (findings ?? []).filter((f) => f.status !== "dismissed").map((f) => f.id);
  const clean2 = (verdicts ?? []).filter((v) => v && VALID_VERDICTS.includes(v.verdict));
  const byFinding = /* @__PURE__ */ new Map();
  for (const v of clean2) {
    const arr = byFinding.get(v.claimId) ?? [];
    arr.push(v);
    byFinding.set(v.claimId, arr);
  }
  let supported = 0;
  let partial = 0;
  let refuted = 0;
  let unsupported = 0;
  for (const v of clean2) {
    if (v.verdict === "supported") supported++;
    else if (v.verdict === "partial") partial++;
    else if (v.verdict === "refuted") refuted++;
    else unsupported++;
  }
  const failures = [];
  for (const [fid, vs] of byFinding) {
    const anyRefuted = vs.some((v) => v.verdict === "refuted");
    const anySupport = vs.some((v) => v.verdict === "supported" || v.verdict === "partial");
    if (anyRefuted || !anySupport) failures.push(fid);
  }
  const unadjudicated = nonDismissed.filter((id) => !byFinding.has(id));
  return { ok: failures.length === 0, adjudicated: clean2.length, supported, partial, refuted, unsupported, failures, unadjudicated, verdicts: clean2 };
}
function loadVerdicts(runDir, spec) {
  const files = spec.includes(",") ? spec.split(",").map((s) => s.trim()) : [spec];
  const merged = /* @__PURE__ */ new Map();
  for (const f of files) {
    const p = exists(f) ? f : isAbsolute3(f) ? f : resolve4(runDir, f);
    if (!exists(p)) throw new Error(`verdicts file not found: ${p} \u2014 pass the filled VERIFY.todo.json or a {"pairs":[...]} file`);
    const data = readJson(p);
    const items = Array.isArray(data) ? data : data.pairs ?? [];
    for (const v of items) merged.set(`${v.claimId}\u241F${v.evidenceRef ?? ""}`, v);
  }
  return [...merged.values()];
}
function applyVerdicts(runDir, spec) {
  const doc = readJson(join17(runDir, "findings.json"));
  const all = loadVerdicts(runDir, spec);
  const trapIds = loadHoneypotIds(runDir);
  const result = reduceVerdicts(
    all.filter((v) => !trapIds.has(v.claimId)),
    doc.findings ?? []
  );
  if (trapIds.size) {
    const graded = all.filter((v) => trapIds.has(v.claimId) && VALID_VERDICTS.includes(v.verdict));
    const failed = [...new Set(graded.filter((v) => v.verdict === "supported" || v.verdict === "partial").map((v) => v.claimId))];
    const caught = new Set(graded.filter((v) => v.verdict === "refuted" || v.verdict === "unsupported").map((v) => v.claimId));
    for (const id of failed) caught.delete(id);
    result.honeypots = { planted: trapIds.size, caught: caught.size, failed };
    if (failed.length) result.ok = false;
  }
  writeJson(join17(runDir, "VERIFY.json"), result);
  return result;
}
function formatVerifyReport(r) {
  const head = r.ok ? "PASS" : "FAIL";
  return [
    `${head}  ${r.adjudicated} adjudicated \xB7 ${r.supported} supported \xB7 ${r.partial} partial \xB7 ${r.refuted} refuted \xB7 ${r.unsupported} unsupported`,
    ...r.honeypots ? [`  honeypots: ${r.honeypots.caught}/${r.honeypots.planted} caught`] : [],
    ...(r.honeypots?.failed ?? []).map((f) => `  \u2717 honeypot ${f} graded supported \u2014 the skeptic is rubber-stamping; re-verify with a fresh skeptic`),
    ...r.failures.map((f) => `  \u2717 ${f} not supported by its evidence`),
    ...r.unadjudicated.map((f) => `  ! ${f} still unadjudicated`)
  ].join("\n");
}

// src/cli.ts
var HELP = `ultraeval v${VERSION} \u2014 evaluate a skill or codebase, then generate grounded, AI-exploitable TDD fix docs.

Usage: node <skill-dir>/scripts/ultraeval.mjs <command> [flags]

Commands:
  init     --target <path> --out <run> [--kind skill|codebase] [--category <c>] [--mode audit|improve|deep] [--bar <n>] [--since <ref>]
             Scaffold an eval run: detect the target, write eval.config.json + starter dimensions + provenance.
             --bar calibrates the meets-expectations threshold (default 80); the applied bar is recorded in the scorecard.
             --since <git-ref> diff-scopes the eval (PR gating): contracts target the changed set; check warns on out-of-scope findings.
  plan     --run <run>
             Generate eval.workflow.mjs (a multi-agent Workflow) + agents/*.md contracts + templates.
  analyze  --run <run> [--since <ref>] [--json]   (or --target <dir> --out <dir>)
             Deterministic repo analysis -> analysis.json + ANALYSIS.md (hotspots, deps, churn, test/doc gaps).
  brainstorm --run <run> [--rank [--check]]
             Emit BRAINSTORM.todo.md (divergent lenses); --rank folds opportunities.json into findings.json (--check gates them).
  compare  --run <new> --base <old> [--json] [--gate]
             Diff two eval runs -> COMPARE.md (score delta, resolved/introduced/retitled findings).
             --json prints the result; --gate exits 1 when the score dropped or a new P0 defect appeared.
  check    --run <run> [--semantic] [--require-verify] [--strict] [--min-findings n] [--coverage-min f] [--json]
             Grounding gate: every finding must resolve to a real file:line in the target (or a run: artifact).
             --json prints the CheckResult ({ ok, errors, warnings }) verbatim (exit code unchanged) for CI.
  verify   --run <run> [--apply <verdicts[,v2,\u2026]>] [--max-verify n] [--shards n --shard i] [--honeypots n]
             Adversarial claim<->evidence worklist; --apply reduces verdicts to VERIFY.json.
             --apply <f1,f2,\u2026> merges sharded verdict files (later files win per claim+evidence pair) \u2014 reassembles --shards runs.
             --honeypots plants n trap pairs (ground truth in VERIFY.honeypots.json \u2014 never show it to skeptics);
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
             --history appends a one-line ledger entry (default file: evals/history.jsonl under the cwd).
  rejudge  --run <run> --out <run2>
             Reuse a completed run's artifacts with a FRESH judge panel (test-retest verdict stability).
             Launch <run2>/rejudge.workflow.mjs, then score --run <run2> and compare --run <run2> --base <run>.
  render   --run <run> [--out <dir>] [--no-html] [--no-md] [--sarif]
             Self-contained dashboard (index.html + index.md), including the verdict when scorecard.json exists.
             --sarif also writes eval.sarif (SARIF 2.1.0) for code-scanning ingestion.
  clean    --run <run> [--all]
             Remove derived gate/render artifacts (keeps deliverables); --all removes the whole run.

  help | --help        version | --version

Exit codes: 0 = ok / gate passed \xB7 1 = gate failed (check/verify) \xB7 2 = usage or runtime error.`;
var COMMAND_FLAGS = {
  init: ["target", "out", "kind", "category", "mode", "bar", "since"],
  plan: ["run"],
  analyze: ["run", "since", "json", "target", "out"],
  brainstorm: ["run", "rank", "check"],
  compare: ["run", "base", "json", "gate"],
  check: ["run", "semantic", "require-verify", "strict", "min-findings", "coverage-min", "json"],
  verify: ["run", "apply", "max-verify", "shards", "shard", "honeypots"],
  backlog: ["run", "tdd", "out"],
  fix: ["run", "task", "workflow"],
  "verify-fix": ["run", "task"],
  score: ["run", "json", "history"],
  rejudge: ["run", "out"],
  status: ["run", "json"],
  render: ["run", "out", "no-html", "no-md", "sarif"],
  clean: ["run", "all"]
};
function editDistance(a, b) {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 0; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
  return dp[a.length][b.length];
}
function rejectUnknownFlags(cmd, args) {
  const known = COMMAND_FLAGS[cmd];
  if (!known) return;
  for (const k of Object.keys(args)) {
    if (k === "_" || k === "help" || k === "version" || known.includes(k)) continue;
    const best = [...known].sort((x, y) => editDistance(k, x) - editDistance(k, y))[0];
    const hint = best && editDistance(k, best) <= 3 ? ` (did you mean --${best}?)` : "";
    throw new Error(`unknown flag --${k} for ${cmd}${hint}`);
  }
}
function main() {
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
    rejectUnknownFlags(cmd, args);
    switch (cmd) {
      case "init": {
        const target = str(args.target);
        const out = str(args.out);
        if (!target || !out) throw new Error("init requires --target <path> and --out <run>");
        const { cfg, runDir } = initRun({
          target,
          out,
          kind: str(args.kind),
          category: str(args.category),
          mode: str(args.mode),
          bar: num(args.bar),
          since: str(args.since)
        });
        console.log(`ultraeval init: ${cfg.kind} \xB7 ${cfg.category} \xB7 mode ${cfg.mode} \xB7 ${cfg.dimensions.length} dimensions -> ${runDir}`);
        return;
      }
      case "plan": {
        if (!run) throw new Error("plan requires --run <run>");
        const engine = fileURLToPath(import.meta.url);
        const written = planRun(run, engine);
        console.log(`ultraeval plan: generated
${written.map((w) => `  ${w}`).join("\n")}`);
        console.log(`
Launch the eval: Workflow({ scriptPath: "${run}/eval.workflow.mjs" })  \u2014 or run the stages by hand via agents/*.md`);
        return;
      }
      case "analyze": {
        const since = str(args.since);
        let targetAbs;
        let out;
        if (run) {
          const cfg = readJson(join18(run, "eval.config.json"));
          targetAbs = resolveTargetAbs(cfg.targetAbs, cfg.target, run);
          out = run;
        } else {
          targetAbs = str(args.target);
          out = str(args.out);
        }
        if (!targetAbs || !out) throw new Error("analyze requires --run <run> (or --target <dir> --out <dir>)");
        const onlyFiles = since ? changedFiles(targetAbs, since) : void 0;
        const a = runAnalyze(targetAbs, out, { onlyFiles });
        if (args.json) console.log(JSON.stringify(a, null, 2));
        else
          console.log(
            `ultraeval analyze: ${a.files} files \xB7 ${a.loc} LOC \xB7 ${a.hotspots.length} hotspots \xB7 ${a.deps.edges} edges \xB7 tests ${a.tests.ratio}${since ? ` \xB7 since ${since}` : ""} -> ${out}/analysis.json`
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
            `ultraeval compare: score \u0394 ${r.scoreDelta ?? "n/a"} \xB7 ${r.resolved.length} resolved \xB7 ${r.introduced.length} introduced \xB7 ${r.retitled.length} retitled -> ${run}/COMPARE.md`
          );
        }
        for (const w of r.warnings) console.log(`  ! ${w}`);
        if (args.gate) {
          const fails = gateFailures(r);
          for (const f of fails) console.log(`  \u2717 gate: ${f}`);
          process.exitCode = fails.length ? 1 : 0;
        }
        return;
      }
      case "check": {
        if (!run) throw new Error("check requires --run <run>");
        if (!exists(join18(run, "eval.config.json"))) throw new Error(`no eval.config.json under ${run} \u2014 not an ultraeval run; run \`ultraeval init\` first`);
        const r = checkRun(run, {
          semantic: !!args.semantic,
          requireVerify: !!args["require-verify"],
          strict: !!args.strict,
          minFindings: num(args["min-findings"]),
          coverageMin: num(args["coverage-min"])
        });
        console.log(args.json ? JSON.stringify(r, null, 2) : formatCheckReport(r, run));
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
          const honeypots = num(args.honeypots);
          const todo = runVerify(run, { maxVerify: num(args["max-verify"]), shards, shard, honeypots });
          const todoName = shards !== void 0 && shard !== void 0 ? `VERIFY.todo.${shard}.json` : "VERIFY.todo.json";
          const planted = todo.planted ?? 0;
          const hp = honeypots ? ` (incl. ${planted} honeypot(s))` : "";
          console.log(`ultraeval verify: ${todo.pairs.length} pair(s)${hp} -> ${run}/${todoName} (fill verdicts, then --apply <file>)`);
          if (honeypots && planted < honeypots)
            console.log(
              planted === 0 ? "  ! 0 planted \u2014 run too small for honeypots (need >= 2 gradeable pairs across distinct findings); skeptic-QC will not run" : `  ! only ${planted}/${honeypots} honeypot(s) planted \u2014 cross-pair pool exhausted; skeptic-QC is thinner than requested`
            );
        }
        return;
      }
      case "backlog": {
        if (!run) throw new Error("backlog requires --run <run>");
        const bl = buildBacklog(run, { tdd: !!args.tdd, out: str(args.out) });
        console.log(`ultraeval backlog: ${bl.tasks.length} fix task(s)${args.tdd ? " + TDD cards" : ""} -> ${str(args.out) ?? run}`);
        return;
      }
      case "status": {
        if (!run) throw new Error("status requires --run <run>");
        const s = statusRun(run);
        console.log(args.json ? JSON.stringify(s, null, 2) : formatStatus(s, run));
        return;
      }
      case "score": {
        if (!run) throw new Error("score requires --run <run>");
        const sc = scoreRun(run);
        console.log(args.json ? JSON.stringify(sc, null, 2) : formatScore(sc));
        if (args.history !== void 0) {
          const file = typeof args.history === "string" && args.history !== "" ? args.history : join18(process.cwd(), "evals", "history.jsonl");
          appendHistory(run, file);
          (args.json ? console.error : console.log)(`ultraeval score: history entry appended -> ${file}`);
        }
        return;
      }
      case "fix": {
        if (!run) throw new Error("fix requires --run <run>");
        const engine = fileURLToPath(import.meta.url);
        const written = emitFixAgents(run, engine, { task: str(args.task), workflow: !!args.workflow });
        console.log(`ultraeval fix: ${written.length} file(s) -> ${run}/fixes/agents (dispatch each *.agent.md to an autonomous fix agent)`);
        return;
      }
      case "verify-fix": {
        const task = str(args.task);
        if (!run || !task) throw new Error("verify-fix requires --run <run> and --task FIX-XXX");
        const res = verifyFix(run, task);
        console.log(formatVerifyFix(res));
        process.exitCode = res.ok ? 0 : 1;
        return;
      }
      case "rejudge": {
        const out = str(args.out);
        if (!run || !out) throw new Error("rejudge requires --run <run> and --out <run2>");
        const engine = fileURLToPath(import.meta.url);
        const copied = rejudgeRun(run, out, engine);
        console.log(`ultraeval rejudge: ${copied.length} artifact(s) reused, fresh judges.jsonl -> ${out}`);
        console.log(`  launch ${out}/rejudge.workflow.mjs, then: score --run ${out} && compare --run ${out} --base ${run}`);
        return;
      }
      case "render": {
        if (!run) throw new Error("render requires --run <run>");
        const written = render(run, { out: str(args.out), html: !args["no-html"], md: !args["no-md"] });
        if (args.sarif) written.push(writeSarif(run, str(args.out)));
        console.log(`ultraeval render:
${written.map((w) => `  ${w}`).join("\n")}`);
        return;
      }
      case "clean": {
        if (!run) throw new Error("clean requires --run <run>");
        const removed = clean(run, { all: !!args.all });
        console.log(removed.length ? `ultraeval clean: removed
${removed.map((w) => `  ${w}`).join("\n")}` : "ultraeval clean: nothing to remove");
        return;
      }
      default:
        console.error(`unknown command: ${cmd}

${HELP}`);
        process.exitCode = 2;
    }
  } catch (e) {
    console.error(`ultraeval ${cmd}: ${e.message}`);
    process.exitCode = 2;
  }
}
main();
