import { execFileSync } from "node:child_process";
import { type Dirent, readdirSync, readFileSync } from "node:fs";
import { extname, join, relative } from "node:path";
import type { Analysis, Hotspot } from "./types.js";
import { exists, writeJson, writeText } from "./util.js";

// Deterministic, zero-dep, offline repo analysis. Produces objective signal the
// brainstorm/opportunity stages ground improvement leads in.

const SKIP_DIRS = new Set(["node_modules", "dist", "build", "coverage", "out", "vendor", "__pycache__", ".next", ".cache"]);
const CODE_EXT = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".py", ".go", ".rb", ".php", ".java", ".rs", ".vue", ".svelte"]);
const TEST_RE = /(\.test\.|\.spec\.|_test\.|(^|\/)test_|(^|\/)tests?\/)/;
const LARGE_LOC = 300;
const DEEP_NEST = 7;

interface FileInfo {
  rel: string;
  ext: string;
  loc: number;
  isTest: boolean;
  imports: string[];
  todos: number;
  maxIndent: number;
}

function locOf(content: string): number {
  if (!content) return 0;
  const body = content.endsWith("\n") ? content.slice(0, -1) : content;
  return body.split("\n").length;
}

function maxIndentOf(content: string): number {
  let max = 0;
  for (const l of content.split("\n")) {
    if (!l.trim()) continue;
    const ws = (l.match(/^[ \t]*/)?.[0] ?? "").replace(/\t/g, "  ").length;
    max = Math.max(max, Math.floor(ws / 2));
  }
  return max;
}

function importsOf(content: string, ext: string): string[] {
  const out: string[] = [];
  if (ext === ".py") {
    for (const m of content.matchAll(/^\s*(?:from\s+(\S+)\s+import|import\s+(\S+))/gm)) out.push((m[1] ?? m[2] ?? "").split(".")[0] ?? "");
    return out;
  }
  // JS/TS/others: import ... from "X", require("X"), import("X")
  for (const m of content.matchAll(/(?:from\s+|require\(\s*|import\(\s*)['"]([^'"]+)['"]/g)) out.push(m[1] ?? "");
  return out;
}

function walkFiles(root: string): FileInfo[] {
  const out: FileInfo[] = [];
  const walk = (dir: string) => {
    let entries: Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = join(dir, e.name);
      if (e.isDirectory()) {
        if (!e.name.startsWith(".") && !SKIP_DIRS.has(e.name)) walk(p);
        continue;
      }
      const ext = extname(e.name);
      if (!CODE_EXT.has(ext)) continue;
      let content = "";
      try {
        content = readFileSync(p, "utf8");
      } catch {
        continue;
      }
      const rel = relative(root, p);
      out.push({
        rel,
        ext,
        loc: locOf(content),
        isTest: TEST_RE.test(rel),
        imports: importsOf(content, ext),
        todos: (content.match(/\b(TODO|FIXME|HACK|XXX)\b/g) ?? []).length,
        maxIndent: maxIndentOf(content),
      });
    }
  };
  walk(root);
  return out;
}

function resolveImport(imp: string, fromRel: string, relSet: Set<string>): string | null {
  if (!imp.startsWith(".")) return null;
  const dir = fromRel.includes("/") ? fromRel.slice(0, fromRel.lastIndexOf("/")) : "";
  const base = join(dir, imp);
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
    `${base}/index.js`,
  ];
  for (const c of cands) if (relSet.has(c)) return c;
  return null;
}

function findCycles(adj: Map<string, Set<string>>): string[][] {
  const cycles: string[][] = [];
  const color = new Map<string, number>(); // 0 white, 1 grey, 2 black
  const stack: string[] = [];
  const dfs = (u: string) => {
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

function gitChurn(root: string): { churn: Map<string, number>; ok: boolean } {
  const m = new Map<string, number>();
  try {
    const out = execFileSync("git", ["-C", root, "log", "--pretty=format:", "--name-only"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      maxBuffer: 32 * 1024 * 1024,
    });
    for (const line of out.split("\n")) {
      const f = line.trim();
      if (f) m.set(f, (m.get(f) ?? 0) + 1);
    }
    return { churn: m, ok: true };
  } catch {
    // not a git repo, or git unavailable — degrade loudly, not silently
    return { churn: m, ok: false };
  }
}

// The base name a test file is "about": foo.test.ts / foo.spec.ts / foo_test.go
// -> foo, test_foo.py -> foo. A plain fixture file keeps its own name, so it can
// no longer claim to test an unrelated source that shares a substring.
function testSubject(rel: string): string {
  const base = (rel.split("/").pop() ?? "").replace(/\.[^.]+$/, "");
  return base
    .replace(/\.(test|spec)$/, "")
    .replace(/_test$/, "")
    .replace(/^test_/, "");
}

function buildTestSubjects(files: FileInfo[]): Set<string> {
  const set = new Set<string>();
  for (const t of files) if (t.isTest) set.add(testSubject(t.rel));
  return set;
}

// Sources a test file's import graph REACHES (transitively) — a behaviour-named
// or integration test (parse.test.ts covering cliargs.ts) credits its subjects
// even though it shares no base name with them.
function importReachedByTests(files: FileInfo[], adj: Map<string, Set<string>>): Set<string> {
  const reached = new Set<string>();
  const stack = files.filter((f) => f.isTest).map((f) => f.rel);
  const seen = new Set<string>(stack);
  while (stack.length) {
    const cur = stack.pop() as string;
    for (const to of adj.get(cur) ?? []) {
      reached.add(to);
      if (!seen.has(to)) {
        seen.add(to);
        stack.push(to);
      }
    }
  }
  return reached;
}

function hasTest(f: FileInfo, testSubjects: Set<string>, testedByImport: Set<string>): boolean {
  const base = (f.rel.split("/").pop() ?? "").replace(/\.[^.]+$/, "");
  return (!!base && testSubjects.has(base)) || testedByImport.has(f.rel);
}

// A generated bundle is a large JS file with zero resolvable local imports — a
// bundler inlines every sibling, so it imports only builtins. Ranking it (and its
// byte-identical mirror) as a hotspot would point improvement leads at build output.
function isGenerated(f: FileInfo, relSet: Set<string>): boolean {
  if (!/\.(js|mjs|cjs)$/.test(f.rel) || f.loc < 400) return false;
  return f.imports.every((imp) => resolveImport(imp, f.rel, relSet) === null);
}

// Files changed since a git ref (+ untracked) — for `analyze --since <ref>`.
export function changedFiles(targetAbs: string, since: string): Set<string> {
  const set = new Set<string>();
  const gitList = (args: string[]) => {
    try {
      return execFileSync("git", ["-C", targetAbs, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    } catch {
      return "";
    }
  };
  for (const line of `${gitList(["diff", "--name-only", since, "--"])}\n${gitList(["ls-files", "--others", "--exclude-standard"])}`.split("\n")) {
    const f = line.trim();
    if (f) set.add(f);
  }
  return set;
}

export interface AnalyzeOpts {
  onlyFiles?: Set<string>;
}

export function analyzeRepo(targetAbs: string, opts: AnalyzeOpts = {}): Analysis {
  const all = walkFiles(targetAbs);
  const fullSet = new Set(all.map((f) => f.rel));
  let files = all.filter((f) => !isGenerated(f, fullSet));
  if (opts.onlyFiles) files = files.filter((f) => opts.onlyFiles?.has(f.rel));
  const relSet = new Set(files.map((f) => f.rel));
  const { churn, ok: churnOk } = gitChurn(targetAbs);
  const notes: string[] = [];
  if (!churnOk) notes.push("git churn unavailable (not a git repo, or git missing) — hotspots are ranked by size only");

  let edges = 0;
  const adj = new Map<string, Set<string>>();
  for (const f of files) {
    for (const imp of f.imports) {
      const to = resolveImport(imp, f.rel, relSet);
      if (to && to !== f.rel) {
        edges++;
        const set = adj.get(f.rel) ?? new Set<string>();
        set.add(to);
        adj.set(f.rel, set);
      }
    }
  }
  const cycles = findCycles(adj).slice(0, 5);

  const score = (f: FileInfo) => f.loc + (churn.get(f.rel) ?? 0) * 20;
  const hotspots: Hotspot[] = [...files]
    .sort((a, b) => score(b) - score(a))
    .slice(0, 12)
    .map((f) => {
      const ch = churn.get(f.rel);
      const reasons: string[] = [`${f.loc} LOC`];
      if (f.loc >= LARGE_LOC) reasons[0] = `large: ${f.loc} LOC`;
      if (ch && ch >= 10) reasons.push(`${ch} commits (churn)`);
      if (f.maxIndent >= DEEP_NEST) reasons.push(`nesting depth ${f.maxIndent}`);
      return { path: f.rel, loc: f.loc, churn: ch, reason: reasons.join(", ") };
    });

  const src = files.filter((f) => !f.isTest);
  const testFiles = files.filter((f) => f.isTest).length;
  const testSubjects = buildTestSubjects(files);
  const testedByImport = importReachedByTests(files, adj);
  const untested = src
    .filter((f) => !hasTest(f, testSubjects, testedByImport))
    .map((f) => f.rel)
    .slice(0, 20);
  // Caveat the ratio when NO test→source import resolved (pure filename matching):
  // the untested list may then overstate gaps for behaviour-named/integration tests.
  if (testFiles > 0 && src.some((f) => !hasTest(f, testSubjects, testedByImport)) && !src.some((f) => testedByImport.has(f.rel)))
    notes.push("test coverage attributed by filename only (no test→source imports resolved) — the untested list may overstate gaps");
  const languages: Record<string, number> = {};
  for (const f of files) languages[f.ext] = (languages[f.ext] ?? 0) + 1;
  const docs = ["README.md", "DOCUMENTATION.md", "CONTRIBUTING.md", "docs"].filter((d) => exists(join(targetAbs, d)));

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
    notes,
  };
}

export function runAnalyze(targetDir: string, outDir: string, opts: AnalyzeOpts = {}): Analysis {
  const a = analyzeRepo(targetDir, opts);
  writeJson(join(outDir, "analysis.json"), a);
  writeText(join(outDir, "ANALYSIS.md"), renderAnalysisMd(a));
  return a;
}

function renderAnalysisMd(a: Analysis): string {
  const langs = Object.entries(a.languages)
    .sort((x, y) => y[1] - x[1])
    .map(([e, n]) => `${e} ${n}`)
    .join(" · ");
  return `# Analysis — ${a.target}

${(a.notes ?? []).map((n) => `> ⚠ ${n}\n`).join("")}${a.files} files · ${a.loc} LOC · ${langs}
deps: ${a.deps.edges} local import edges${a.deps.cycles.length ? `, ${a.deps.cycles.length} cycle(s)` : ""} · tests: ${a.tests.testFiles}/${a.tests.sourceFiles} (ratio ${a.tests.ratio}) · TODO/FIXME: ${a.todos} · docs: ${a.docs.join(", ") || "none"}

## Hotspots (size + churn)

| file | LOC | churn | note |
|------|-----|-------|------|
${a.hotspots.map((h) => `| \`${h.path}\` | ${h.loc} | ${h.churn ?? "—"} | ${h.reason} |`).join("\n")}

${a.deps.cycles.length ? `## Import cycles\n\n${a.deps.cycles.map((c) => `- ${c.join(" → ")} → ${c[0]}`).join("\n")}\n` : ""}${a.tests.untested.length ? `## Source files without an obvious test\n\n${a.tests.untested.map((u) => `- \`${u}\``).join("\n")}\n` : ""}`;
}
