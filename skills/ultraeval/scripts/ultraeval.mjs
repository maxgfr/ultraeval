#!/usr/bin/env node

// src/cli.ts
import { fileURLToPath } from "url";

// src/backlog.ts
import { join as join2 } from "path";

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
  const raw = String(ref ?? "").trim();
  if (raw.startsWith("url:") || /^https?:\/\//.test(raw)) {
    return { raw, kind: "url", gradeable: false, resolved: false, reason: "external URL (not resolvable offline)" };
  }
  if (raw.startsWith("run:")) {
    const body = raw.slice(4);
    const [rel2 = "", anchor] = body.split("#");
    const absPath2 = resolve(opts.runDir, rel2);
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

// src/backlog.ts
var SEV_ORDER = { P0: 0, P1: 1, P2: 2 };
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
function buildBacklog(runDir, opts = {}) {
  const cfg = readJson(join2(runDir, "eval.config.json"));
  const doc = readJson(join2(runDir, "findings.json"));
  const failed = /* @__PURE__ */ new Set();
  const vpath = join2(runDir, "VERIFY.json");
  if (exists(vpath)) {
    const v = readJson(vpath);
    for (const id of v.failures ?? []) failed.add(id);
  }
  const confirmed = (doc.findings ?? []).filter((f) => f.status !== "dismissed" && !failed.has(f.id)).sort((a, b) => (SEV_ORDER[a.severity] ?? 9) - (SEV_ORDER[b.severity] ?? 9));
  const tasks = confirmed.map((f, i) => {
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
        description: f.failureScenario ? `Write a failing test that reproduces: ${f.failureScenario}` : `Write a failing test asserting the correct behavior for: ${f.statement}`
      },
      green: { change: f.recommendation || "Make the minimal change that turns the RED test green \u2014 without weakening any gate." },
      verify: {
        command: cfg.kind === "skill" ? "pnpm test  # then re-run the target's own check/verify gate" : "run the new test (must pass) + the full suite (nothing regresses)"
      },
      dependsOn: []
    };
  });
  const out = opts.out ?? runDir;
  const backlog = { target: cfg.targetAbs, generatedFrom: runDir, tasks };
  writeJson(join2(out, "BACKLOG.json"), backlog);
  writeText(join2(out, "REMEDIATION.md"), renderRemediation(backlog, cfg));
  if (opts.tdd) {
    const byId = new Map(doc.findings.map((f) => [f.id, f]));
    for (const t of tasks) writeText(join2(out, "fixes", `${t.id}-${slug(t.title)}.md`), renderFixCard(t, byId.get(t.findingId)));
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
${section("P0", "P0 \u2014 trust / correctness / data-loss")}${section("P1", "P1 \u2014 fidelity / coverage")}${section("P2", "P2 \u2014 polish / ergonomics")}`;
}
function renderFixCard(t, f) {
  const evidence = (f?.evidence ?? []).map((e) => `\`${e.ref}\``).join(", ") || "\u2014";
  return `# ${t.id} \u2014 ${t.title}  (${t.priority})

**Finding ${t.findingId}:** ${f?.statement ?? t.rationale}
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

// src/check.ts
import { join as join3 } from "path";

// src/types.ts
var VERSION = "0.0.0";
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
  const cfgPath = join3(runDir, "eval.config.json");
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
  const findingsPath = join3(runDir, "findings.json");
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
  if (opts.minFindings && findings.length < opts.minFindings) {
    errors.push(`only ${findings.length} finding(s) recorded; --min-findings ${opts.minFindings} required`);
  }
  const resolveOpts = { targetAbs: resolveTargetAbs(cfg.targetAbs, cfg.target, runDir), runDir };
  for (const f of findings) {
    if (f.status === "dismissed") continue;
    const ev = Array.isArray(f.evidence) ? f.evidence : [];
    let anyResolved = false;
    for (const e of ev) {
      const r = resolveEvidence(e.ref, resolveOpts);
      if (r.gradeable && !r.resolved) errors.push(`${f.id} cites ${e.ref}: ${r.reason}`);
      if (r.resolved) anyResolved = true;
    }
    if (!anyResolved) errors.push(`${f.id} has no resolvable evidence \u2014 a finding must point at a real file:line (or run: artifact)`);
  }
  const coverageMin = opts.strict ? CAPS.coverageStrict : opts.coverageMin ?? CAPS.coverageMin;
  for (const file of [...HARD_FILES, ...SOFT_FILES]) {
    const p = join3(runDir, file);
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
  const backlogPath = join3(runDir, "BACKLOG.json");
  if (exists(backlogPath)) {
    try {
      const bl = readJson(backlogPath);
      for (const t of bl.tasks ?? []) {
        const f = findings.find((x) => x.id === t.findingId);
        if (!f) errors.push(`BACKLOG ${t.id} references ${t.findingId} which is not a finding`);
        else if (f.status === "dismissed") errors.push(`BACKLOG ${t.id} references dismissed finding ${t.findingId}`);
      }
    } catch {
      errors.push("BACKLOG.json is not valid JSON");
    }
  }
  const verifyPath = join3(runDir, "VERIFY.json");
  if (opts.requireVerify) {
    if (!exists(verifyPath)) errors.push("--require-verify: no VERIFY.json \u2014 run `ultraeval verify --apply <verdicts>`");
    else {
      try {
        const v = readJson(verifyPath);
        if (!v.adjudicated) errors.push("--require-verify: VERIFY.json has no adjudicated verdicts");
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
  return { ok: errors.length === 0, errors, warnings };
}
function formatCheckReport(r, runDir) {
  const lines = [r.ok ? `PASS  ${runDir}` : `FAIL  ${runDir}`];
  for (const e of r.errors) lines.push(`  \u2717 ${e}`);
  for (const w of r.warnings) lines.push(`  ! ${w}`);
  if (r.ok && !r.warnings.length) lines.push("  every finding is grounded in the target.");
  return lines.join("\n");
}

// src/clean.ts
import { readdirSync as readdirSync2, rmSync } from "fs";
import { join as join4 } from "path";
var DERIVED = ["VERIFY.todo.json", "VERIFY.md", "VERIFY.json", "index.html", "index.md", "BACKLOG.json", "REMEDIATION.md"];
function clean(runDir, opts = {}) {
  const removed = [];
  if (opts.all) {
    if (exists(runDir)) {
      rmSync(runDir, { recursive: true, force: true });
      removed.push(runDir);
    }
    return removed;
  }
  for (const name of DERIVED) {
    const p = join4(runDir, name);
    if (exists(p)) {
      rmSync(p, { force: true });
      removed.push(p);
    }
  }
  if (exists(runDir)) {
    for (const e of readdirSync2(runDir)) {
      if (/^VERIFY\.(todo\.)?\d+\.(json|md)$/.test(e)) {
        rmSync(join4(runDir, e), { force: true });
        removed.push(join4(runDir, e));
      }
    }
  }
  const fixes = join4(runDir, "fixes");
  if (exists(fixes)) {
    rmSync(fixes, { recursive: true, force: true });
    removed.push(fixes);
  }
  return removed;
}

// src/init.ts
import { join as join5, resolve as resolve2 } from "path";

// src/rubrics.ts
function defaultDimensions(kind, _category) {
  if (kind === "skill") {
    return [
      {
        id: "grounding",
        name: "Correctness & grounding",
        weight: 0.3,
        whatPerfectLooksLike: "Every finding/claim resolves to real source; anti-hallucination gates pass on genuine artifacts AND fail on doctored ones."
      },
      {
        id: "coverage",
        name: "Functional coverage",
        weight: 0.25,
        whatPerfectLooksLike: "Every mode, command, flag and gate works as documented; no half-implemented surface."
      },
      {
        id: "ux",
        name: "UX & meets-expectations",
        weight: 0.2,
        whatPerfectLooksLike: "The real deliverable is production-quality, readable, low-friction; failure modes are graceful."
      },
      {
        id: "safety",
        name: "Safety & robustness",
        weight: 0.15,
        whatPerfectLooksLike: "No destructive defaults, no data loss, graceful degradation when deps/network are absent."
      },
      {
        id: "docs",
        name: "Docs consistency",
        weight: 0.1,
        whatPerfectLooksLike: "SKILL.md, README, --help and actual behavior agree; documented examples run."
      }
    ];
  }
  return [
    {
      id: "correctness",
      name: "Correctness",
      weight: 0.3,
      whatPerfectLooksLike: "Behaves correctly on happy paths AND edge cases; no logic bugs on the evaluated surface."
    },
    {
      id: "tests",
      name: "Test quality",
      weight: 0.2,
      whatPerfectLooksLike: "Meaningful tests cover the behavior and fail when the code is wrong (not just coverage %)."
    },
    { id: "security", name: "Security", weight: 0.2, whatPerfectLooksLike: "No exploitable source\u2192sink flows; inputs validated; secrets and authz handled." },
    {
      id: "maintainability",
      name: "Maintainability",
      weight: 0.2,
      whatPerfectLooksLike: "Clear module boundaries, low duplication, code a newcomer can follow."
    },
    { id: "performance", name: "Performance", weight: 0.1, whatPerfectLooksLike: "No obvious hot-path waste; scales to realistic inputs." }
  ];
}

// src/init.ts
function detectKind(targetAbs) {
  if (exists(join5(targetAbs, "SKILL.md"))) return "skill";
  const skillsDir = join5(targetAbs, "skills");
  if (exists(skillsDir)) {
    for (const md of listMarkdown(skillsDir)) if (md.endsWith("SKILL.md")) return "skill";
  }
  return "codebase";
}
function initRun(opts) {
  const targetAbs = resolve2(process.cwd(), opts.target);
  if (!exists(targetAbs)) throw new Error(`target not found: ${opts.target}`);
  const kind = opts.kind ?? detectKind(targetAbs);
  const category = opts.category ?? (kind === "skill" ? "agent skill" : "software project");
  const cfg = {
    target: opts.target,
    targetAbs,
    kind,
    category,
    dimensions: defaultDimensions(kind, category),
    note: "starter dimensions \u2014 the research stage refines them",
    version: VERSION
  };
  const runDir = resolve2(process.cwd(), opts.out);
  ensureDir(join5(runDir, "runs"));
  ensureDir(join5(runDir, "research"));
  writeJson(join5(runDir, "eval.config.json"), cfg);
  return { cfg, runDir };
}

// src/plan.ts
import { join as join6 } from "path";

// src/templates.ts
function workflowScript(cfg, runDirAbs, engineAbs) {
  const meta = {
    name: `ultraeval-${cfg.kind}`,
    description: `Evaluate ${cfg.targetAbs} across ${cfg.dimensions.length} dimensions, ground every finding, then emit a TDD fix backlog`
  };
  return [
    `export const meta = { name: ${JSON.stringify(meta.name)}, description: ${JSON.stringify(meta.description)}, phases: [{ title: 'Research' }, { title: 'TestPlan' }, { title: 'Execute' }, { title: 'Findings' }, { title: 'Gate' }, { title: 'Judge' }, { title: 'Results' }] }`,
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
    `// Each subagent is handed the absolute path to its dispatch contract plus the`,
    `// run constants \u2014 a subagent has its own cwd and sees none of this file.`,
    `function contract(name, extra) {`,
    `  return 'Read and follow the dispatch contract at ' + AGENTS + '/' + name + '.md VERBATIM.\\n'`,
    `    + 'Constants: TARGET=' + TARGET + '  ENGINE=' + ENGINE + '  RUN=' + RUN + '  KIND=' + KIND + '  CATEGORY=' + CATEGORY + '.\\n'`,
    `    + 'Invoke the engine only by its ABSOLUTE path: node ' + ENGINE + ' <cmd>. Write every artifact under RUN. Do not stop early.'`,
    `    + (extra ? '\\n' + extra : '')`,
    `}`,
    ``,
    `log('ultraeval: research -> test-plan -> execute+gates -> judge -> findings -> backlog for ' + TARGET)`,
    ``,
    `phase('Research')`,
    `await parallel(DIMENSIONS.map((d) => () => agent(contract('researcher', 'DIMENSION=' + d.id + ' (' + d.name + '). Write ' + RUN + '/research/' + d.id + '.md (cited).'), { label: 'research:' + d.id, phase: 'Research', agentType: 'general-purpose' })))`,
    ``,
    `phase('TestPlan')`,
    `await agent(contract('testplan'), { label: 'testplan', phase: 'TestPlan', agentType: 'general-purpose' })`,
    ``,
    `phase('Execute')`,
    `await parallel([`,
    `  () => agent(contract('executor', 'MODE=core \u2014 deterministic engine + gate exercises on genuine AND doctored artifacts.'), { label: 'run-core', phase: 'Execute', agentType: 'general-purpose' }),`,
    `  () => agent(contract('executor', 'MODE=live \u2014 realistic end-to-end run of the target.'), { label: 'run-live', phase: 'Execute', agentType: 'general-purpose' }),`,
    `])`,
    ``,
    `phase('Findings')`,
    `await agent(contract('findings'), { label: 'findings', phase: 'Findings', agentType: 'general-purpose' })`,
    ``,
    `phase('Gate')`,
    `await agent(contract('gate'), { label: 'gate', phase: 'Gate', agentType: 'general-purpose' })`,
    ``,
    `phase('Judge')`,
    `const LENSES = ['correctness+grounding', 'completeness+coverage', 'ux+meets-expectations']`,
    `await parallel(LENSES.map((lens, i) => () => agent(contract('judge', 'LENS=' + lens), { label: 'judge' + (i + 1), phase: 'Judge', agentType: 'general-purpose' })))`,
    ``,
    `phase('Results')`,
    `await agent(contract('remediator'), { label: 'results', phase: 'Results', agentType: 'general-purpose' })`,
    ``,
    `return { target: TARGET, run: RUN }`,
    ``
  ].join("\n");
}
var GATE_CHEATSHEET = (engineAbs, run) => [
  `- \`node ${engineAbs} check --run ${run}\` \u2014 structural grounding gate (every finding must resolve to a real file:line in the target, or a run: artifact). Exit 0 = grounded.`,
  `- \`node ${engineAbs} verify --run ${run}\` \u2014 writes VERIFY.todo.json (claim\u2194evidence). Fill each verdict honestly: \`supported\`/\`partial\`/\`refuted\`/\`unsupported\`.`,
  `- \`node ${engineAbs} verify --run ${run} --apply <verdicts.json>\` \u2014 reduces to VERIFY.json.`,
  `- \`node ${engineAbs} check --run ${run} --semantic --require-verify\` \u2014 folds verdicts in; the exit gate.`
].join("\n");
function agentContracts(cfg, runDirAbs, engineAbs) {
  const dims = cfg.dimensions.map((d) => `- **${d.id}** ${d.name} (w=${d.weight}): ${d.whatPerfectLooksLike}`).join("\n");
  return {
    researcher: `# Contract: researcher

You research the *state of the art for how to evaluate* one DIMENSION of a ${cfg.kind} (category: ${cfg.category}).

Do REAL web research (WebSearch + WebFetch; if not loaded, ToolSearch \`select:WebSearch,WebFetch\`). Find authoritative methodology \u2014 metrics, benchmarks, rubrics, known failure modes \u2014 specific to this dimension and category.

Deliver:
1. Write a cited markdown note at \`${runDirAbs}/research/<DIMENSION>.md\` \u2014 every non-obvious methodological claim cites a fetched URL.
2. End the note with a **scoring rubric** for this dimension: 0\u20135 anchors and how to measure each on THIS target.

Dimensions in scope:
${dims}
`,
    testplan: `# Contract: testplan

Read \`${cfg.targetAbs}\` (its SKILL.md/README/CLI \`--help\`, or its source) and the research notes under \`${runDirAbs}/research/\`.

Enumerate EVERY functionality worth testing \u2014 modes, subcommands, flags, gates, and the live end-to-end behavior \u2014 mapped to the dimensions. For each: id, what it is, the concrete command or user prompt that tests it, and explicit pass criteria.

Write \`${runDirAbs}/TEST-PLAN.md\` (a reviewable checklist with the rubric embedded). Be exhaustive about the CLI/behavior surface.
`,
    executor: `# Contract: executor

You produce the raw evidence an eval stands on. Two MODES; do the one named in your prompt.

**MODE=core (deterministic).** Drive the target's own engine/tests and, if the target ships anti-hallucination gates, prove them in BOTH directions: pass on a genuine artifact, fail on a hand-doctored one. Record every command + exit code into \`${runDirAbs}/runs/core.md\`. If the target has a test suite, run it and record the result.

**MODE=live (realistic).** Act as a real user of the target. Follow its own instructions faithfully and produce a real deliverable into \`${runDirAbs}/runs/live-*\`. Use live network/Docker where the target needs it; timebox heavy steps (Bash timeout up to 600000 ms) and degrade gracefully. Write a narrative to \`${runDirAbs}/runs/live.md\` covering what was produced, grounding quality, any hallucination, and each gate's outcome.

Record exact command lines and exit codes verbatim \u2014 later stages cite \`run:runs/core.md#Lnn\` as evidence, so line numbers matter.
`,
    findings: `# Contract: findings

Consolidate the test-plan results and the run logs into \`${runDirAbs}/findings.json\` following \`${runDirAbs}/findings.schema.json\`.

RULES (the grounding gate will enforce these):
- Every finding MUST carry at least one resolvable \`evidence.ref\`:
  - \`path:line\` or \`path:start-end\` \u2014 a real location IN THE TARGET (\`${cfg.targetAbs}\`).
  - \`run:relpath#Lnn\` \u2014 a line in a log this run produced.
- Do NOT invent line numbers. If you cite \`src/x.ts:42\`, line 42 must exist and support the claim.
- \`severity\`: P0 (trust/correctness/data-loss), P1 (fidelity/coverage cap), P2 (polish).
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

Read \`${runDirAbs}/\`: research/, TEST-PLAN.md, runs/core.md, runs/live.md, findings.json, and spot-check the artifacts. Score each dimension 0\u20135 with a one-line rationale grounded in a path you actually read. Objective gate results (VERIFY.json, check exit codes) are ground truth \u2014 weight them.

Append your verdict to \`${runDirAbs}/judges.jsonl\` as one JSON line: \`{ "lens": "...", "dimensionScores": [{"id","score","rationale"}], "overall": 0-100, "meetsExpectations": bool, "topFindings": [] }\`.
`,
    remediator: `# Contract: remediator

Finalize the eval and generate the AI-exploitable fix docs.

1. Ensure \`${runDirAbs}/RESULTS.md\` and \`SUMMARY.md\` are complete and cite \`[F#]\`; fold in the judges' scores from \`judges.jsonl\` (average the overalls).
2. Emit the TDD backlog: \`node ${engineAbs} backlog --run ${runDirAbs} --tdd\` \u2192 writes \`BACKLOG.json\`, \`REMEDIATION.md\`, and one \`fixes/FIX-*.md\` card per confirmed finding (RED failing-test-first \u2192 GREEN change \u2192 VERIFY).
3. Render the dashboard: \`node ${engineAbs} render --run ${runDirAbs}\` \u2192 \`index.md\` + \`index.html\`.
4. Re-run \`node ${engineAbs} check --run ${runDirAbs} --semantic\` and confirm exit 0 (backlog integrity is part of the gate).

Report the scorecard, the P0/P1 backlog headline, and the paths a downstream fix agent should consume.
`
  };
}
function testPlanTemplate(cfg) {
  const dims = cfg.dimensions.map((d) => `### ${d.name} (weight ${d.weight})
> Perfect: ${d.whatPerfectLooksLike}

- [ ] \u2026
`).join("\n");
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
    $schema: "informal",
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
            dimension: { type: "string" },
            severity: { enum: ["P0", "P1", "P2"] },
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
          }
        }
      }
    }
  };
}

// src/plan.ts
function planRun(runDir, engineAbs) {
  const cfg = readJson(join6(runDir, "eval.config.json"));
  const written = [];
  const w = (rel, content) => {
    const p = join6(runDir, rel);
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

// src/render.ts
import { join as join7 } from "path";
function load(runDir) {
  const cfg = readJson(join7(runDir, "eval.config.json"));
  const doc = readJson(join7(runDir, "findings.json"));
  const verify = exists(join7(runDir, "VERIFY.json")) ? readJson(join7(runDir, "VERIFY.json")) : null;
  const backlog = exists(join7(runDir, "BACKLOG.json")) ? readJson(join7(runDir, "BACKLOG.json")) : null;
  return { cfg, doc, verify, backlog };
}
function render(runDir, opts = {}) {
  const { cfg, doc, verify, backlog } = load(runDir);
  const out = opts.out ?? runDir;
  const written = [];
  if (opts.md !== false) {
    const p = join7(out, "index.md");
    writeText(p, buildMd(cfg, doc, verify, backlog));
    written.push(p);
  }
  if (opts.html !== false) {
    const p = join7(out, "index.html");
    writeText(p, buildHtml(cfg, doc, verify, backlog));
    written.push(p);
  }
  return written;
}
function counts(doc) {
  const live = doc.findings.filter((f) => f.status !== "dismissed");
  const by = (s) => live.filter((f) => f.severity === s).length;
  return { total: live.length, p0: by("P0"), p1: by("P1"), p2: by("P2") };
}
function buildMd(cfg, doc, verify, backlog) {
  const c = counts(doc);
  const rows = doc.findings.filter((f) => f.status !== "dismissed").map((f) => `| ${f.id} | ${f.severity} | ${f.title.replace(/\|/g, "\\|")} | ${f.status} | ${(f.evidence ?? []).map((e) => `\`${e.ref}\``).join(" ")} |`).join("\n");
  const parts = [
    `# Evaluation \u2014 ${cfg.target}`,
    ``,
    `> target \`${cfg.targetAbs}\` \xB7 ${cfg.kind} \xB7 ${cfg.category} \xB7 ${c.total} findings (P0 ${c.p0} \xB7 P1 ${c.p1} \xB7 P2 ${c.p2})`,
    ``,
    `## Findings`,
    ``,
    `| id | sev | title | status | evidence |`,
    `|----|-----|-------|--------|----------|`,
    rows || `| \u2014 | \u2014 | none | \u2014 | \u2014 |`
  ];
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
function buildHtml(cfg, doc, verify, backlog) {
  const c = counts(doc);
  const rows = doc.findings.filter((f) => f.status !== "dismissed").map(
    (f) => `<tr><td>${f.id}</td><td class="${f.severity.toLowerCase()}">${f.severity}</td><td>${esc(f.title)}</td><td>${f.status}</td><td>${(f.evidence ?? []).map((e) => `<code>${esc(e.ref)}</code>`).join(" ")}</td></tr>`
  ).join("");
  const bl = backlog ? `<h2>Fix backlog (${backlog.tasks.length})</h2><ul>${backlog.tasks.map((t) => `<li><b>${t.id}</b> (${t.priority}) ${esc(t.title)} \u2192 <code>${esc(t.red.testFile)}</code></li>`).join("")}</ul>` : "";
  const vf = verify ? `<h2>Verification</h2><p>${verify.ok ? "\u2705" : "\u274C"} ${verify.adjudicated} adjudicated \xB7 ${verify.supported} supported \xB7 ${verify.refuted} refuted \xB7 ${verify.unsupported} unsupported${verify.failures.length ? ` \xB7 fails: ${esc(verify.failures.join(", "))}` : ""}</p>` : "";
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ultraeval \u2014 ${esc(cfg.target)}</title><style>${STYLE}</style></head><body>
<h1>Evaluation \u2014 ${esc(cfg.target)}</h1>
<p class="meta"><code>${esc(cfg.targetAbs)}</code> \xB7 ${cfg.kind} \xB7 ${esc(cfg.category)} \xB7 ${c.total} findings (P0 ${c.p0} \xB7 P1 ${c.p1} \xB7 P2 ${c.p2})</p>
<h2>Findings</h2><table><tr><th>id</th><th>sev</th><th>title</th><th>status</th><th>evidence</th></tr>${rows}</table>
${vf}${bl}</body></html>
`;
}
function esc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// src/verify.ts
import { isAbsolute as isAbsolute2, join as join8, resolve as resolve3 } from "path";
var SEV_ORDER2 = { P0: 0, P1: 1, P2: 2 };
function buildWorklist(runDir, maxVerify = CAPS.maxVerify) {
  const cfg = readJson(join8(runDir, "eval.config.json"));
  const doc = readJson(join8(runDir, "findings.json"));
  const findings = (doc.findings ?? []).filter((f) => f.status !== "dismissed").sort((a, b) => (SEV_ORDER2[a.severity] ?? 9) - (SEV_ORDER2[b.severity] ?? 9));
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
  const out = { run: runDir, pairs };
  const sh = opts.shards !== void 0 && opts.shard !== void 0;
  writeJson(join8(runDir, sh ? `VERIFY.todo.${opts.shard}.json` : "VERIFY.todo.json"), out);
  writeText(join8(runDir, sh ? `VERIFY.${opts.shard}.md` : "VERIFY.md"), renderWorklistMd(out));
  return out;
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
    const p = exists(f) ? f : isAbsolute2(f) ? f : resolve3(runDir, f);
    const data = readJson(p);
    const items = Array.isArray(data) ? data : data.pairs ?? [];
    for (const v of items) merged.set(`${v.claimId}\u241F${v.evidenceRef ?? ""}`, v);
  }
  return [...merged.values()];
}
function applyVerdicts(runDir, spec) {
  const doc = readJson(join8(runDir, "findings.json"));
  const result = reduceVerdicts(loadVerdicts(runDir, spec), doc.findings ?? []);
  writeJson(join8(runDir, "VERIFY.json"), result);
  return result;
}
function formatVerifyReport(r) {
  const head = r.ok ? "PASS" : "FAIL";
  return [
    `${head}  ${r.adjudicated} adjudicated \xB7 ${r.supported} supported \xB7 ${r.partial} partial \xB7 ${r.refuted} refuted \xB7 ${r.unsupported} unsupported`,
    ...r.failures.map((f) => `  \u2717 ${f} not supported by its evidence`),
    ...r.unadjudicated.map((f) => `  ! ${f} still unadjudicated`)
  ].join("\n");
}

// src/cli.ts
var HELP = `ultraeval v${VERSION} \u2014 evaluate a skill or codebase, then generate grounded, AI-exploitable TDD fix docs.

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
var VALUE_FLAGS = /* @__PURE__ */ new Set([
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
  "--shard"
]);
function parse(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === void 0) continue;
    if (a === "-h") args.help = true;
    else if (a === "-v") args.version = true;
    else if (a.startsWith("--")) {
      if (VALUE_FLAGS.has(a)) args[a.slice(2)] = argv[++i] ?? "";
      else args[a.slice(2)] = true;
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
function main() {
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
        const { cfg, runDir } = initRun({ target, out, kind: str(args.kind), category: str(args.category) });
        console.log(`ultraeval init: ${cfg.kind} \xB7 ${cfg.category} \xB7 ${cfg.dimensions.length} dimensions -> ${runDir}`);
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
      case "check": {
        if (!run) throw new Error("check requires --run <run>");
        const r = checkRun(run, {
          semantic: !!args.semantic,
          requireVerify: !!args["require-verify"],
          strict: !!args.strict,
          minFindings: num(args["min-findings"]),
          coverageMin: num(args["coverage-min"])
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
