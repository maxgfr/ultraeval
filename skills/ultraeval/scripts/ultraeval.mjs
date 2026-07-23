#!/usr/bin/env node

// src/cli.ts
import { realpathSync as realpathSync3 } from "fs";
import { join as join32 } from "path";
import { fileURLToPath as fileURLToPath2, pathToFileURL } from "url";

// src/analyze.ts
import { join as join13 } from "path";

// src/util.ts
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "path";
function exists(p) {
  return existsSync(p);
}
function ensureDir(p) {
  mkdirSync(p, { recursive: true });
}
function readText(p) {
  return readFileSync(p, "utf8");
}
var tmpCounter = 0;
function writeText(p, s) {
  ensureDir(dirname(p));
  const tmp = `${p}.${process.pid}.${tmpCounter++}.tmp`;
  try {
    writeFileSync(tmp, s);
    renameSync(tmp, p);
  } catch (err2) {
    rmSync(tmp, { force: true });
    throw err2;
  }
}
function readJson(p) {
  const raw = readFileSync(p, "utf8");
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error(`${basename(p)} is not valid JSON: ${p}`);
  }
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
  const out2 = [];
  const walk2 = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk2(p);
      else if (e.name.endsWith(".md")) out2.push(p);
    }
  };
  walk2(dir);
  return out2;
}
function resolveTargetAbs(targetAbs, target, runDir) {
  if (targetAbs && existsSync(targetAbs)) return targetAbs;
  return resolve(runDir, target);
}
function readFileCached(absPath, cache) {
  const hit = cache?.get(absPath);
  if (hit) return hit;
  const raw = readFileSync(absPath, "utf8");
  const lines = raw.split("\n");
  const count = raw === "" ? 0 : raw.endsWith("\n") ? lines.length - 1 : lines.length;
  const entry = { count, lines };
  cache?.set(absPath, entry);
  return entry;
}
function parseLineSpec(spec) {
  const m = spec.match(/^(\d+)(?:-(\d+))?$/);
  if (!m) return null;
  const start2 = Number(m[1]);
  const end = m[2] ? Number(m[2]) : start2;
  return { start: start2, end };
}
function lineCount(absPath, cache) {
  return readFileCached(absPath, cache).count;
}
function resolveEvidence(ref, opts) {
  let raw = String(ref ?? "").trim();
  if (raw.startsWith("analysis:")) raw = raw.slice("analysis:".length);
  if (raw.startsWith("url:") || /^https?:\/\//.test(raw)) {
    return { raw, kind: "url", gradeable: false, resolved: false, reason: "external URL (not resolvable offline)" };
  }
  if (raw.startsWith("run:")) {
    const body2 = raw.slice(4);
    const [rel2 = "", anchor] = body2.split("#");
    const absPath2 = resolve(opts.runDir, rel2);
    const relFromRun = relative(opts.runDir, absPath2);
    if (relFromRun.startsWith("..") || isAbsolute(relFromRun)) {
      return { raw, kind: "external", gradeable: false, resolved: false, reason: "path escapes the run directory (not graded)", absPath: absPath2 };
    }
    if (!existsSync(absPath2)) return { raw, kind: "run", gradeable: true, resolved: false, reason: `run artifact not found: ${rel2}`, absPath: absPath2 };
    const line = anchor?.match(/^L(\d+)$/);
    if (line) {
      const n = Number(line[1]);
      const total = lineCount(absPath2, opts.lineCache);
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
    const total = lineCount(absPath, opts.lineCache);
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
function extractContext(absPath, start2, end, pad = 2, cache) {
  if (!existsSync(absPath)) return "";
  const { lines } = readFileCached(absPath, cache);
  if (start2 === void 0) return lines.slice(0, 12).join("\n");
  const from = Math.max(0, start2 - 1 - pad);
  const to = Math.min(lines.length, (end ?? start2) + pad);
  return lines.slice(from, to).map((l, i2) => `${from + i2 + 1}: ${l}`).join("\n");
}
var stripLineSuffix = (s) => /:\d/.test(s) ? s.slice(0, s.lastIndexOf(":")) : s;
function parseEvidenceRef(ref) {
  const kind = ref.startsWith("run:") ? "run" : ref.startsWith("url:") || /^https?:/.test(ref) ? "url" : ref.startsWith("analysis:") ? "analysis" : "path";
  const rawPath = stripLineSuffix(ref);
  return {
    kind,
    gradeable: kind !== "url",
    isTargetRef: kind === "path" || kind === "analysis",
    path: rawPath.replace(/^analysis:/, ""),
    pathWithLine: ref.replace(/^analysis:/, ""),
    rawPath
  };
}
var SEV_ORDER = { P0: 0, P1: 1, P2: 2 };
var titleKey = (title) => title.toLowerCase().trim();
function provLine(p, emptyText = "") {
  return p ? `engine ${p.engineVersion} \xB7 protocol ${p.protocolVersion} \xB7 rubric ${p.rubricVersion}${p.targetGit ? ` \xB7 target ${p.targetGit.commit.slice(0, 7)}${p.targetGit.dirty ? "*" : ""}` : ""}` : emptyText;
}
function categoryKey(category) {
  const cat = (category ?? "").toLowerCase();
  if (/secur|sast|vuln|taint|pentest|appsec/.test(cat)) return "security";
  if (/requirement|\bprd\b|\bsrd\b|\bspec\b|specification/.test(cat)) return "requirements";
  if (/\bm[ée]tier\b|\bbusiness\b|\bdomain\b|\bddd\b/.test(cat)) return "business";
  if (/research|\brag\b|retrieval|search|documentation|\bq&a\b|\bqa\b/.test(cat)) return "research";
  if (/\bweb\b|frontend|browser|website|\bsite\b|web app|webapp/.test(cat)) return "web";
  if (/\bcli\b|command.?line|terminal/.test(cat)) return "cli";
  return null;
}
var escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
var normPath = (p) => p.replace(/\\/g, "/").replace(/^\.\//, "");
function globToRegExp(glob) {
  const g = normPath(glob);
  let re = "";
  for (let i2 = 0; i2 < g.length; i2++) {
    const c2 = g[i2];
    if (c2 === "*") {
      if (g[i2 + 1] === "*") {
        i2++;
        if (g[i2 + 1] === "/") {
          i2++;
          re += "(?:[^/]+/)*";
        } else re += ".*";
      } else re += "[^/]*";
    } else if (c2 === "?") {
      re += "[^/]";
    } else if (c2 === "{") {
      const end = g.indexOf("}", i2);
      if (end === -1) {
        re += "\\{";
      } else {
        re += `(?:${g.slice(i2 + 1, end).split(",").map(escapeRe).join("|")})`;
        i2 = end;
      }
    } else re += escapeRe(c2);
  }
  return new RegExp(`^${re}$`);
}
function inScope(relPath, scope) {
  if (!scope?.length) return true;
  const p = normPath(relPath);
  return scope.some((entry) => {
    const g = normPath(entry).replace(/\/+$/, "");
    if (!/[*?{]/.test(g)) return p === g || p.startsWith(`${g}/`);
    return globToRegExp(g).test(p);
  });
}
function opportunityValue(impact, effort) {
  const i2 = impact === "high" ? 3 : impact === "med" ? 2 : 1;
  const e = effort === "S" ? 1 : effort === "M" ? 2 : 3;
  return i2 / e;
}
function opportunityPriority(impact) {
  return impact === "high" ? "P1" : "P2";
}

// src/vendor/codeindex-engine.mjs
import { spawnSync } from "child_process";
import { readdirSync as readdirSync2, statSync, lstatSync, readFileSync as readFileSync2, realpathSync } from "fs";
import { join as join2, sep, extname } from "path";
import { createHash } from "crypto";
import { readFileSync as readFileSync22, existsSync as existsSync2 } from "fs";
import { dirname as dirname2, join as join22 } from "path";
import { fileURLToPath } from "url";
import { basename as basename2 } from "path";
import { posix } from "path";
import { join as join3 } from "path";
import { posix as posix2 } from "path";
import { join as join4 } from "path";
import { join as join5 } from "path";
import { readFileSync as readFileSync3, writeFileSync as writeFileSync2 } from "fs";
import { join as join6 } from "path";
import { mkdirSync as mkdirSync2, readdirSync as readdirSync22, readFileSync as readFileSync4, rmSync as rmSync2, statSync as statSync2, writeFileSync as writeFileSync22 } from "fs";
import { dirname as dirname22, join as join7 } from "path";
import { existsSync as existsSync22, readdirSync as readdirSync3, statSync as statSync3 } from "fs";
import { join as join8 } from "path";
import { existsSync as existsSync3, readFileSync as readFileSync5 } from "fs";
import { join as join10 } from "path";
import { join as join11 } from "path";
import { createInterface } from "readline";
import { basename as basename22 } from "path";
import { join as join9 } from "path";
import { existsSync as existsSync4, mkdirSync as mkdirSync22, readFileSync as readFileSync6, writeFileSync as writeFileSync3 } from "fs";
import { join as join12, resolve as resolve2 } from "path";
var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
var __export = (target, all) => {
  for (var name2 in all)
    __defProp(target, name2, { get: all[name2], enumerable: true });
};
var ENGINE_VERSION;
var SCHEMA_VERSION;
var EXTRACTOR_VERSION;
var init_types = __esm({
  "src/types.ts"() {
    "use strict";
    ENGINE_VERSION = "2.10.0";
    SCHEMA_VERSION = 4;
    EXTRACTOR_VERSION = 6;
  }
});
function sh(cmd, args2, opts = {}) {
  const res = spawnSync(cmd, args2, {
    cwd: opts.cwd,
    input: opts.input,
    encoding: "utf8",
    timeout: opts.timeoutMs ?? 12e4,
    maxBuffer: 64 * 1024 * 1024,
    env: opts.env ?? process.env
  });
  const missing = !!res.error && res.error.code === "ENOENT";
  return {
    ok: !res.error && res.status === 0,
    status: res.status,
    stdout: res.stdout ?? "",
    stderr: res.stderr ?? (res.error ? String(res.error.message) : ""),
    missing
  };
}
function have(cmd) {
  const cached = whichCache.get(cmd);
  if (cached !== void 0) return cached;
  const probe = sh(process.platform === "win32" ? "where" : "which", [cmd]);
  const found = probe.ok && probe.stdout.trim().length > 0;
  whichCache.set(cmd, found);
  return found;
}
function slugify(input) {
  return input.toLowerCase().replace(/^https?:\/\//, "").replace(/^git@/, "").replace(/\.git$/, "").replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 120);
}
function clip(s, max) {
  if (s.length <= max) return s;
  return s.slice(0, max) + `
\u2026 [truncated ${s.length - max} chars]`;
}
function clipInline(s, max) {
  const flat = s.replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  let cut = flat.slice(0, max).replace(/\s+\S*$/, "");
  if (!cut) cut = flat.slice(0, max);
  if ((cut.match(/`/g)?.length ?? 0) % 2 === 1) cut = cut.replace(/`[^`]*$/, "");
  if (cut.lastIndexOf("[") > cut.lastIndexOf("]")) cut = cut.slice(0, cut.lastIndexOf("["));
  return cut.replace(/\s+$/, "") + "\u2026";
}
function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function foldText(s) {
  return s.normalize("NFKD").replace(/[̀-ͯ]/g, "");
}
function keywords(question) {
  const seen = /* @__PURE__ */ new Set();
  const out2 = [];
  for (const raw of foldText(question).split(/[^A-Za-z0-9_]+/)) {
    if (!raw) continue;
    const lower = raw.toLowerCase();
    if (raw.length < 2) continue;
    if (STOPWORDS.has(lower)) continue;
    if (seen.has(lower)) continue;
    seen.add(lower);
    out2.push(raw);
  }
  return out2;
}
function rankedKeywords(question) {
  const base = keywords(question);
  const score = (raw) => {
    let s = 0;
    if (/\d/.test(raw)) s += 3;
    if (/[A-Z]/.test(raw) && !/^[A-Z0-9]+$/.test(raw)) s += 2;
    if (/_/.test(raw)) s += 2;
    if (raw.length >= 8) s += 1.5;
    else if (raw.length >= 5) s += 0.5;
    return s;
  };
  return base.map((k, i2) => ({ k, s: score(k), i: i2 })).sort((a, b) => b.s - a.s || a.i - b.i).map((x) => x.k);
}
function rrf(lists, keyOf2, k = 60) {
  const score = /* @__PURE__ */ new Map();
  for (const list of lists) {
    list.forEach((item, idx) => {
      const key2 = keyOf2(item);
      score.set(key2, (score.get(key2) ?? 0) + 1 / (k + idx + 1));
    });
  }
  return score;
}
var whichCache;
var STOPWORDS;
var init_util = __esm({
  "src/util.ts"() {
    "use strict";
    whichCache = /* @__PURE__ */ new Map();
    STOPWORDS = /* @__PURE__ */ new Set([
      "the",
      "a",
      "an",
      "is",
      "are",
      "was",
      "were",
      "be",
      "been",
      "being",
      "do",
      "does",
      "did",
      "how",
      "what",
      "why",
      "when",
      "where",
      "which",
      "who",
      "whom",
      "this",
      "that",
      "these",
      "those",
      "of",
      "in",
      "on",
      "to",
      "for",
      "with",
      "and",
      "or",
      "but",
      "if",
      "then",
      "else",
      "than",
      "as",
      "at",
      "by",
      "from",
      "into",
      "about",
      "it",
      "its",
      "i",
      "you",
      "we",
      "they",
      "he",
      "she",
      "there",
      "here",
      "can",
      "could",
      "should",
      "would",
      "will",
      "shall",
      "may",
      "might",
      "must",
      "have",
      "has",
      "had",
      "not",
      "no",
      "yes",
      "so",
      "such",
      "only",
      "any",
      "some",
      "all",
      "get",
      "set",
      "use",
      "used",
      "using",
      "work",
      "works",
      "working",
      "handle",
      "handled",
      "happen",
      "happens",
      "default",
      "value",
      "values",
      "please",
      "explain",
      "tell",
      "me",
      "my",
      "our"
    ]);
  }
});
function patternToRegExpSource(pattern) {
  let re = "";
  for (let i2 = 0; i2 < pattern.length; i2++) {
    const c2 = pattern[i2];
    if (c2 === "\\" && i2 + 1 < pattern.length) {
      re += escapeRegExp(pattern[++i2]);
    } else if (c2 === "*") {
      if (pattern[i2 + 1] === "*") {
        const atStart = i2 === 0 || pattern[i2 - 1] === "/";
        let j = i2;
        while (pattern[j + 1] === "*") j++;
        const next = pattern[j + 1];
        if (atStart && next === "/") {
          i2 = j + 1;
          re += "(?:[^/]+/)*";
        } else if (atStart && next === void 0) {
          i2 = j;
          re += ".*";
        } else {
          i2 = j;
          re += "[^/]*";
        }
      } else {
        re += "[^/]*";
      }
    } else if (c2 === "?") {
      re += "[^/]";
    } else if (c2 === "[") {
      let j = i2 + 1;
      let body2 = "";
      if (pattern[j] === "!") {
        body2 += "^";
        j++;
      }
      if (pattern[j] === "]") {
        body2 += "\\]";
        j++;
      }
      while (j < pattern.length && pattern[j] !== "]") {
        const ch = pattern[j];
        body2 += ch === "\\" || ch === "^" ? "\\" + ch : ch;
        j++;
      }
      if (j < pattern.length && body2 !== "" && body2 !== "^") {
        re += `[${body2}]`;
        i2 = j;
      } else {
        re += "\\[";
      }
    } else {
      re += escapeRegExp(c2);
    }
  }
  return re;
}
function parseGitignore(content, baseRel) {
  const rules = [];
  const prefix = baseRel ? escapeRegExp(baseRel) + "/" : "";
  for (const rawLine of content.split(/\r?\n/)) {
    let line = rawLine.replace(/(?<!\\) +$/, "");
    if (!line || line.startsWith("#")) continue;
    let negated = false;
    if (line.startsWith("!")) {
      negated = true;
      line = line.slice(1);
    }
    let dirOnly = false;
    if (line.endsWith("/")) {
      dirOnly = true;
      line = line.slice(0, -1);
    }
    if (!line) continue;
    const anchored = line.includes("/");
    if (line.startsWith("/")) line = line.slice(1);
    const body2 = patternToRegExpSource(line);
    const source = anchored ? `^${prefix}${body2}$` : `^${prefix}(?:[^/]+/)*${body2}$`;
    try {
      rules.push({ re: new RegExp(source), negated, dirOnly });
    } catch {
    }
  }
  return rules;
}
function isIgnored(rules, rel, isDir) {
  let ignored = false;
  for (const rule of rules) {
    if (rule.dirOnly && !isDir) continue;
    if (rule.re.test(rel)) ignored = !rule.negated;
  }
  return ignored;
}
var init_ignore = __esm({
  "src/ignore.ts"() {
    "use strict";
    init_util();
  }
});
function walk(root, opts = {}) {
  const maxFileBytes = opts.maxFileBytes ?? 1024 * 1024;
  const maxFiles = opts.maxFiles ?? DEFAULT_MAX_FILES;
  const useGitignore = opts.gitignore !== false;
  const out2 = [];
  let capped = false;
  let excluded = 0;
  let rootReal;
  try {
    rootReal = realpathSync(root);
  } catch {
    return { files: out2, capped, excluded };
  }
  const contained = (real) => real === rootReal || real.startsWith(rootReal + sep);
  const stack = [
    { dir: root, rel: "", rules: [] }
  ];
  const seenDirs = /* @__PURE__ */ new Set();
  walking: while (stack.length) {
    const frame = stack.pop();
    let real;
    try {
      real = realpathSync(frame.dir);
    } catch {
      continue;
    }
    if (seenDirs.has(real)) continue;
    seenDirs.add(real);
    if (!contained(real)) continue;
    let entries;
    try {
      entries = readdirSync2(frame.dir).sort();
    } catch {
      continue;
    }
    let rules = frame.rules;
    if (useGitignore && entries.includes(".gitignore")) {
      const parsed = parseGitignore(readText2(join2(frame.dir, ".gitignore")), frame.rel);
      if (parsed.length) rules = [...rules, ...parsed];
    }
    for (const name2 of entries) {
      const abs = join2(frame.dir, name2);
      const rel = frame.rel ? `${frame.rel}/${name2}` : name2;
      let st;
      let isLink;
      try {
        st = statSync(abs);
        isLink = lstatSync(abs).isSymbolicLink();
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        if (IGNORE_DIRS.has(name2)) continue;
        if (isLink) continue;
        if (useGitignore && rules.length && isIgnored(rules, rel, true)) continue;
        stack.push({ dir: abs, rel, rules });
        continue;
      }
      if (!st.isFile()) continue;
      if (st.size > maxFileBytes) {
        excluded++;
        continue;
      }
      if (LOCKFILES.has(name2.toLowerCase())) {
        excluded++;
        continue;
      }
      const ext = extname(name2).toLowerCase();
      if (BINARY_EXT.has(ext)) {
        excluded++;
        continue;
      }
      if (name2.endsWith(".min.js") || name2.endsWith(".min.css")) {
        excluded++;
        continue;
      }
      if (useGitignore && rules.length && isIgnored(rules, rel, false)) {
        excluded++;
        continue;
      }
      if (isLink) {
        try {
          if (!contained(realpathSync(abs))) continue;
        } catch {
          continue;
        }
      }
      if (out2.length >= maxFiles) {
        capped = true;
        break walking;
      }
      out2.push({ rel: rel.split(sep).join("/"), abs, size: st.size, ext, mtimeMs: st.mtimeMs });
    }
  }
  return { files: out2, capped, excluded };
}
function readText2(abs) {
  try {
    const buf = readFileSync2(abs);
    if (buf.length >= 2 && buf[0] === 255 && buf[1] === 254) {
      return buf.subarray(2, 2 + (buf.length - 2 & ~1)).toString("utf16le");
    }
    if (buf.length >= 2 && buf[0] === 254 && buf[1] === 255) {
      const swapped = Buffer.from(buf.subarray(2, 2 + (buf.length - 2 & ~1)));
      swapped.swap16();
      return swapped.toString("utf16le");
    }
    if (buf.length >= 3 && buf[0] === 239 && buf[1] === 187 && buf[2] === 191) return buf.subarray(3).toString("utf8");
    if (buf.includes(0)) return "";
    const text = buf.toString("utf8");
    return text.includes("\uFFFD") ? buf.toString("latin1") : text;
  } catch {
    return "";
  }
}
var IGNORE_DIRS;
var LOCKFILES;
var BINARY_EXT;
var DEFAULT_MAX_FILES;
var init_walk = __esm({
  "src/walk.ts"() {
    "use strict";
    init_ignore();
    IGNORE_DIRS = /* @__PURE__ */ new Set([
      ".git",
      "node_modules",
      ".pnpm",
      "bower_components",
      "vendor",
      "dist",
      "build",
      "out",
      "target",
      ".next",
      ".nuxt",
      ".svelte-kit",
      ".turbo",
      "coverage",
      "__pycache__",
      ".venv",
      "venv",
      ".tox",
      ".mypy_cache",
      ".pytest_cache",
      ".gradle",
      ".idea",
      ".vscode",
      ".cache",
      "tmp",
      ".ultraindex",
      "Pods",
      "DerivedData",
      ".terraform",
      "elm-stuff",
      ".dart_tool"
    ]);
    LOCKFILES = /* @__PURE__ */ new Set([
      "package-lock.json",
      "npm-shrinkwrap.json",
      "yarn.lock",
      "pnpm-lock.yaml",
      "bun.lockb",
      "composer.lock",
      "cargo.lock",
      "poetry.lock",
      "pipfile.lock",
      "gemfile.lock",
      "go.sum",
      "flake.lock",
      "packages.lock.json",
      "podfile.lock",
      "mix.lock"
    ]);
    BINARY_EXT = /* @__PURE__ */ new Set([
      ".png",
      ".jpg",
      ".jpeg",
      ".gif",
      ".webp",
      ".bmp",
      ".ico",
      ".icns",
      ".svg",
      ".pdf",
      ".zip",
      ".gz",
      ".tar",
      ".tgz",
      ".bz2",
      ".xz",
      ".7z",
      ".rar",
      ".jar",
      ".war",
      ".class",
      ".so",
      ".dylib",
      ".dll",
      ".exe",
      ".bin",
      ".o",
      ".a",
      ".wasm",
      ".woff",
      ".woff2",
      ".ttf",
      ".otf",
      ".eot",
      ".mp3",
      ".mp4",
      ".mov",
      ".avi",
      ".webm",
      ".wav",
      ".flac",
      ".ogg",
      ".lock",
      ".min.js",
      ".map"
    ]);
    DEFAULT_MAX_FILES = 2e4;
  }
});
function headCommit(dir) {
  const res = sh("git", ["-C", dir, "rev-parse", "--short", "HEAD"]);
  return res.ok ? res.stdout.trim() : void 0;
}
function isGitWorktree(dir) {
  return sh("git", ["-C", dir, "rev-parse", "--is-inside-work-tree"]).ok;
}
function resolveBaseRef(dir, base) {
  const verify = (ref) => sh("git", [...gitArgs(dir), "rev-parse", "--verify", "--quiet", `${ref}^{commit}`]).ok;
  const mergeBase = (ref) => {
    const mb = sh("git", [...gitArgs(dir), "merge-base", ref, "HEAD"]);
    return mb.ok ? mb.stdout.trim() : void 0;
  };
  if (base) {
    if (!verify(base)) return { error: `base ref "${base}" not found (tried git rev-parse --verify)` };
    const mb = mergeBase(base);
    if (!mb) return { error: `no merge-base between "${base}" and HEAD` };
    return { ref: base, mergeBase: mb };
  }
  const originHead = sh("git", [...gitArgs(dir), "symbolic-ref", "--quiet", "refs/remotes/origin/HEAD"]);
  const candidates = [
    ...originHead.ok ? [originHead.stdout.trim().replace("refs/remotes/", "")] : [],
    "origin/main",
    "origin/master",
    "main",
    "master"
  ];
  for (const c2 of candidates) {
    if (!verify(c2)) continue;
    const mb = mergeBase(c2);
    if (mb) return { ref: c2, mergeBase: mb };
  }
  const head = sh("git", [...gitArgs(dir), "rev-parse", "HEAD"]);
  if (!head.ok) return { error: "cannot resolve HEAD \u2014 empty repository?" };
  return {
    ref: "HEAD",
    mergeBase: head.stdout.trim(),
    note: "base: HEAD (no default branch found \u2014 reviewing uncommitted work)"
  };
}
function diffFiles(dir, spec) {
  const out2 = [];
  const ns = sh("git", [...gitArgs(dir), "diff", "-z", "-M", "--name-status", ...rangeArgs(spec)]);
  if (ns.ok) {
    const toks = ns.stdout.split("\0");
    let i2 = 0;
    while (i2 < toks.length) {
      const st = toks[i2++];
      if (!st) break;
      const code = st[0];
      if (code === "R" || code === "C") {
        const oldPath = toks[i2++];
        const path = toks[i2++];
        if (path) out2.push({ path, status: "renamed", oldPath });
      } else {
        const path = toks[i2++];
        if (!path) break;
        const status = code === "A" ? "added" : code === "D" ? "deleted" : "modified";
        out2.push({ path, status });
      }
    }
  }
  const byPath = new Map(out2.map((f) => [f.path, f]));
  const num2 = sh("git", [...gitArgs(dir), "diff", "-z", "-M", "--numstat", ...rangeArgs(spec)]);
  if (num2.ok) {
    const toks = num2.stdout.split("\0");
    let i2 = 0;
    while (i2 < toks.length) {
      const head = toks[i2++];
      if (!head) break;
      const m = head.match(/^(-|\d+)\t(-|\d+)\t([\s\S]*)$/);
      if (!m) continue;
      let path = m[3];
      if (path === "") {
        i2++;
        path = toks[i2++] ?? "";
      }
      const rec = byPath.get(path);
      if (!rec) continue;
      if (m[1] === "-") rec.binary = true;
      else {
        rec.linesAdded = Number(m[1]);
        rec.linesDeleted = Number(m[2]);
      }
    }
  }
  return out2;
}
function diffHunks(dir, spec) {
  const map = /* @__PURE__ */ new Map();
  const res = sh("git", [...gitArgs(dir), "diff", "-M", "--unified=0", ...rangeArgs(spec)]);
  if (!res.ok) return map;
  let current;
  for (const line of res.stdout.split("\n")) {
    if (line.startsWith("+++ ")) {
      const p = line.slice(4).trim();
      if (p === "/dev/null") {
        current = void 0;
        continue;
      }
      const path = p.startsWith("b/") ? p.slice(2) : p;
      current = map.get(path) ?? [];
      map.set(path, current);
    } else if (current && line.startsWith("@@")) {
      const m = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/);
      if (!m) continue;
      const start2 = Number(m[1]);
      const count = m[2] === void 0 ? 1 : Number(m[2]);
      if (count === 0) current.push({ start: Math.max(start2, 1), end: Math.max(start2, 1), approx: true });
      else current.push({ start: start2, end: start2 + count - 1 });
    }
  }
  return map;
}
function untrackedFiles(dir) {
  const res = sh("git", [...gitArgs(dir), "ls-files", "--others", "--exclude-standard", "-z"]);
  if (!res.ok) return [];
  return res.stdout.split("\0").filter((p) => p.length > 0);
}
function gitChurn(dir, opts = {}) {
  const churn = /* @__PURE__ */ new Map();
  const range = opts.since ? [`${opts.since}..HEAD`] : [];
  const res = sh("git", [...gitArgs(dir), "log", ...range, "--pretty=format:", "--name-only", "-z"]);
  if (!res.ok) return { churn, ok: false };
  for (const tok of res.stdout.split("\0")) {
    const f = tok.replace(/^\n+/, "").trim();
    if (f) churn.set(f, (churn.get(f) ?? 0) + 1);
  }
  return { churn, ok: true };
}
function changedSince(dir, ref) {
  const out2 = /* @__PURE__ */ new Set();
  const diff = sh("git", [...gitArgs(dir), "diff", "-z", "--name-only", ref, "--"]);
  if (diff.ok) {
    for (const p of diff.stdout.split("\0")) if (p) out2.add(p);
  }
  for (const p of untrackedFiles(dir)) out2.add(p);
  return out2;
}
var gitArgs;
var rangeArgs;
var init_git = __esm({
  "src/git.ts"() {
    "use strict";
    init_util();
    gitArgs = (dir) => ["-C", dir, "-c", "core.quotePath=false"];
    rangeArgs = (spec) => spec.staged ? ["--cached"] : [spec.mergeBase];
  }
});
function sha1(s) {
  return createHash("sha1").update(s).digest("hex");
}
function shortHash(s, n = 8) {
  return sha1(s).slice(0, n);
}
var init_hash = __esm({
  "src/hash.ts"() {
    "use strict";
  }
});
function scan(rel, content, lang, rules) {
  const out2 = [];
  const lines = content.split(/\r?\n/);
  for (let i2 = 0; i2 < lines.length; i2++) {
    const line = lines[i2];
    if (!line.trim()) continue;
    for (const rule of rules) {
      const m = rule.re.exec(line);
      if (!m) continue;
      const name2 = m.groups?.name ?? m[1];
      if (!name2) continue;
      const exported = typeof rule.exported === "function" ? rule.exported(m, line) : rule.exported ?? false;
      out2.push({
        name: name2,
        kind: rule.kind,
        file: rel,
        line: i2 + 1,
        signature: line.trim().slice(0, 200),
        exported,
        lang
      });
      break;
    }
  }
  return out2;
}
function extToLang(ext) {
  return EXT_LANG[ext] ?? "other";
}
var EXT_LANG;
var init_common = __esm({
  "src/lang/common.ts"() {
    "use strict";
    EXT_LANG = {
      ".ts": "typescript",
      ".tsx": "typescript",
      ".mts": "typescript",
      ".cts": "typescript",
      ".js": "javascript",
      ".jsx": "javascript",
      ".mjs": "javascript",
      ".cjs": "javascript",
      ".py": "python",
      ".pyi": "python",
      ".go": "go",
      ".rb": "ruby",
      ".rake": "ruby",
      ".java": "java",
      ".rs": "rust",
      ".c": "c",
      ".h": "c",
      ".cc": "cpp",
      ".cpp": "cpp",
      ".cxx": "cpp",
      ".hpp": "cpp",
      ".cs": "csharp",
      ".php": "php",
      ".swift": "swift",
      ".kt": "kotlin",
      ".kts": "kotlin",
      ".scala": "scala",
      ".sc": "scala",
      ".clj": "clojure",
      ".ex": "elixir",
      ".exs": "elixir",
      ".erl": "erlang",
      ".hs": "haskell",
      ".dart": "dart",
      ".lua": "lua",
      ".sh": "shell",
      ".bash": "shell",
      ".zsh": "shell",
      ".ksh": "shell",
      ".fish": "shell",
      ".hh": "cpp",
      ".m": "objective-c",
      ".mm": "objective-c",
      ".sql": "sql",
      ".graphql": "graphql",
      ".gql": "graphql",
      ".proto": "protobuf",
      ".md": "markdown",
      ".mdx": "markdown",
      ".rst": "restructuredtext",
      ".txt": "text",
      ".json": "json",
      ".yaml": "yaml",
      ".yml": "yaml",
      ".toml": "toml",
      ".ini": "ini",
      ".html": "html",
      ".css": "css",
      ".scss": "scss",
      ".vue": "vue",
      ".svelte": "svelte",
      ".astro": "astro"
    };
  }
});
function stemOf(rel) {
  return (rel.split("/").pop() ?? "").replace(/\.[^.]+$/, "");
}
function applyExportLists(content, symbols) {
  const markExported = (name2) => {
    if (!name2 || name2 === "default") return;
    for (const s of symbols) if (s.name === name2) s.exported = true;
  };
  const handleList = (inner, cjs) => {
    for (const raw of inner.split(",")) {
      const part = raw.trim().replace(/^type\s+/, "");
      if (!part) continue;
      const asMatch = /^([\w$]+)\s+as\s+([\w$]+)$/.exec(part);
      if (asMatch) {
        if (asMatch[2] !== "default") markExported(asMatch[1]);
        continue;
      }
      if (cjs) {
        const kv = /^([\w$]+)\s*:\s*([\w$]+)$/.exec(part);
        if (kv) {
          markExported(kv[1]);
          markExported(kv[2]);
          continue;
        }
      }
      markExported(/^([\w$]+)/.exec(part)?.[1]);
    }
  };
  let m;
  EXPORT_LIST_RE.lastIndex = 0;
  while (m = EXPORT_LIST_RE.exec(content)) {
    if (!m[2]) handleList(m[1] ?? "", false);
  }
  CJS_OBJECT_RE.lastIndex = 0;
  while (m = CJS_OBJECT_RE.exec(content)) handleList(m[1] ?? "", true);
  DEFAULT_ID_RE.lastIndex = 0;
  while (m = DEFAULT_ID_RE.exec(content)) markExported(m[2]);
}
var RULES;
var ANON_DEFAULT_RE;
var NAMED_DEFAULT_RE;
var EXPORT_LIST_RE;
var CJS_OBJECT_RE;
var DEFAULT_ID_RE;
var jsTs;
var init_js_ts = __esm({
  "src/lang/js-ts.ts"() {
    "use strict";
    init_common();
    RULES = [
      { re: /^\s*export\s+(?:async\s+)?function\s+(?<name>[\w$]+)/, kind: "function", exported: true },
      { re: /^\s*export\s+default\s+(?:async\s+)?function\s+(?<name>[\w$]+)/, kind: "function", exported: true },
      { re: /^\s*export\s+default\s+(?:abstract\s+)?class\s+(?<name>[\w$]+)/, kind: "class", exported: true },
      { re: /^\s*(?:async\s+)?function\s+(?<name>[\w$]+)/, kind: "function", exported: false },
      { re: /^\s*export\s+(?:abstract\s+)?class\s+(?<name>[\w$]+)/, kind: "class", exported: true },
      { re: /^\s*(?:abstract\s+)?class\s+(?<name>[\w$]+)/, kind: "class", exported: false },
      { re: /^\s*export\s+interface\s+(?<name>[\w$]+)/, kind: "interface", exported: true },
      { re: /^\s*interface\s+(?<name>[\w$]+)/, kind: "interface", exported: false },
      { re: /^\s*export\s+type\s+(?<name>[\w$]+)/, kind: "type", exported: true },
      { re: /^\s*type\s+(?<name>[\w$]+)\s*[=<]/, kind: "type", exported: false },
      { re: /^\s*export\s+enum\s+(?<name>[\w$]+)/, kind: "enum", exported: true },
      { re: /^\s*export\s+const\s+enum\s+(?<name>[\w$]+)/, kind: "enum", exported: true },
      // exported const/let bound to an arrow fn or value
      { re: /^\s*export\s+(?:const|let|var)\s+(?<name>[\w$]+)\s*[:=]/, kind: "const", exported: true },
      // CommonJS named exports: `exports.foo = …`, `module.exports.foo = …`
      { re: /^\s*exports\.(?<name>[\w$]+)\s*=/, kind: "const", exported: true },
      { re: /^\s*module\.exports\.(?<name>[\w$]+)\s*=/, kind: "const", exported: true },
      // top-level const arrow function (not exported)
      { re: /^\s*(?:const|let)\s+(?<name>[\w$]+)\s*=\s*(?:async\s*)?\([^)]*\)\s*(?::[^=]+)?=>/, kind: "const", exported: false },
      // `export default Foo;` — a class/const declared above and exported by reference.
      { re: /^\s*export\s+default\s+(?<name>[A-Za-z_$][\w$]*)\s*;?\s*$/, kind: "default", exported: true }
    ];
    ANON_DEFAULT_RE = /^\s*export\s+default\s+(?:async\s+)?(?:function|class)?\s*(?:\(|\{|extends\b)/;
    NAMED_DEFAULT_RE = /^\s*export\s+default\s+(?:async\s+)?(?:function|class)\s+(?!extends\b)[\w$]+/;
    EXPORT_LIST_RE = /export\s*\{([^}]*)\}\s*(from\b)?/g;
    CJS_OBJECT_RE = /module\.exports\s*=\s*\{([^}]*)\}/g;
    DEFAULT_ID_RE = /(^|\n)\s*export\s+default\s+([A-Za-z_$][\w$]*)\s*;?\s*(?=\n|$)/g;
    jsTs = {
      lang: "javascript/typescript",
      exts: [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"],
      extract(rel, content) {
        const lang = rel.match(/\.(ts|tsx|mts|cts)$/) ? "typescript" : "javascript";
        const symbols = scan(rel, content, lang, RULES);
        const lines = content.split(/\r?\n/);
        for (let i2 = 0; i2 < lines.length; i2++) {
          const line = lines[i2];
          if (ANON_DEFAULT_RE.test(line) && !NAMED_DEFAULT_RE.test(line)) {
            symbols.push({
              name: stemOf(rel),
              kind: "default",
              file: rel,
              line: i2 + 1,
              signature: line.trim().slice(0, 200),
              exported: true,
              lang
            });
            break;
          }
        }
        applyExportLists(content, symbols);
        return symbols;
      }
    };
  }
});
var pub;
var RULES2;
var python;
var init_python = __esm({
  "src/lang/python.ts"() {
    "use strict";
    init_common();
    pub = (name2) => !name2.startsWith("_") || name2.startsWith("__");
    RULES2 = [
      { re: /^(?:async\s+)?def\s+(?<name>[\w]+)\s*\(/, kind: "function", exported: (m) => pub(m.groups.name) },
      { re: /^\s+(?:async\s+)?def\s+(?<name>[\w]+)\s*\(/, kind: "method", exported: (m) => pub(m.groups.name) },
      { re: /^class\s+(?<name>[\w]+)/, kind: "class", exported: (m) => pub(m.groups.name) },
      { re: /^\s+class\s+(?<name>[\w]+)/, kind: "class", exported: (m) => pub(m.groups.name) }
    ];
    python = {
      lang: "python",
      exts: [".py", ".pyi"],
      extract(rel, content) {
        return scan(rel, content, "python", RULES2);
      }
    };
  }
});
var upper;
var RULES3;
var go;
var init_go = __esm({
  "src/lang/go.ts"() {
    "use strict";
    init_common();
    upper = (name2) => /^[A-Z]/.test(name2);
    RULES3 = [
      { re: /^func\s+\([^)]*\)\s+(?<name>[\w]+)\s*\(/, kind: "method", exported: (m) => upper(m.groups.name) },
      { re: /^func\s+(?<name>[\w]+)\s*\(/, kind: "function", exported: (m) => upper(m.groups.name) },
      { re: /^type\s+(?<name>[\w]+)\s+struct\b/, kind: "struct", exported: (m) => upper(m.groups.name) },
      { re: /^type\s+(?<name>[\w]+)\s+interface\b/, kind: "interface", exported: (m) => upper(m.groups.name) },
      { re: /^type\s+(?<name>[\w]+)\s+/, kind: "type", exported: (m) => upper(m.groups.name) }
    ];
    go = {
      lang: "go",
      exts: [".go"],
      extract(rel, content) {
        return scan(rel, content, "go", RULES3);
      }
    };
  }
});
var RULES4;
var ruby;
var init_ruby = __esm({
  "src/lang/ruby.ts"() {
    "use strict";
    init_common();
    RULES4 = [
      { re: /^\s*def\s+(?:self\.)?(?<name>[\w?!=]+)/, kind: "method", exported: true },
      { re: /^\s*class\s+(?<name>[\w:]+)/, kind: "class", exported: true },
      { re: /^\s*module\s+(?<name>[\w:]+)/, kind: "module", exported: true }
    ];
    ruby = {
      lang: "ruby",
      exts: [".rb", ".rake"],
      extract(rel, content) {
        return scan(rel, content, "ruby", RULES4);
      }
    };
  }
});
var RULES5;
var java;
var init_java = __esm({
  "src/lang/java.ts"() {
    "use strict";
    init_common();
    RULES5 = [
      { re: /^\s*(?:public|protected|private)?\s*(?:abstract\s+|final\s+)?class\s+(?<name>[\w]+)/, kind: "class", exported: (_m, l) => /\bpublic\b/.test(l) },
      { re: /^\s*(?:public|protected|private)?\s*interface\s+(?<name>[\w]+)/, kind: "interface", exported: (_m, l) => /\bpublic\b/.test(l) },
      { re: /^\s*(?:public|protected|private)?\s*enum\s+(?<name>[\w]+)/, kind: "enum", exported: (_m, l) => /\bpublic\b/.test(l) },
      { re: /^\s*(?:public|protected|private)\s+(?:static\s+|final\s+|abstract\s+|synchronized\s+)*[\w<>\[\],.?\s]+\s+(?<name>[\w]+)\s*\(/, kind: "method", exported: (_m, l) => /\bpublic\b/.test(l) }
    ];
    java = {
      lang: "java",
      exts: [".java"],
      extract(rel, content) {
        return scan(rel, content, "java", RULES5);
      }
    };
  }
});
var isPub;
var RULES6;
var rust;
var init_rust = __esm({
  "src/lang/rust.ts"() {
    "use strict";
    init_common();
    isPub = (_m, l) => /^\s*pub\b/.test(l);
    RULES6 = [
      { re: /^\s*(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?(?:unsafe\s+)?fn\s+(?<name>[\w]+)/, kind: "function", exported: isPub },
      { re: /^\s*(?:pub(?:\([^)]*\))?\s+)?struct\s+(?<name>[\w]+)/, kind: "struct", exported: isPub },
      { re: /^\s*(?:pub(?:\([^)]*\))?\s+)?enum\s+(?<name>[\w]+)/, kind: "enum", exported: isPub },
      { re: /^\s*(?:pub(?:\([^)]*\))?\s+)?trait\s+(?<name>[\w]+)/, kind: "trait", exported: isPub },
      { re: /^\s*(?:pub(?:\([^)]*\))?\s+)?type\s+(?<name>[\w]+)/, kind: "type", exported: isPub }
    ];
    rust = {
      lang: "rust",
      exts: [".rs"],
      extract(rel, content) {
        return scan(rel, content, "rust", RULES6);
      }
    };
  }
});
var pub2;
var RULES7;
var csharp;
var init_csharp = __esm({
  "src/lang/csharp.ts"() {
    "use strict";
    init_common();
    pub2 = (_m, l) => /\b(public|internal)\b/.test(l);
    RULES7 = [
      { re: /^\s*(?:public|internal|protected|private)?\s*(?:static\s+|sealed\s+|abstract\s+|partial\s+)*(?:class|record)\s+(?<name>\w+)/, kind: "class", exported: pub2 },
      { re: /^\s*(?:public|internal|protected|private)?\s*(?:partial\s+)?interface\s+(?<name>\w+)/, kind: "interface", exported: pub2 },
      { re: /^\s*(?:public|internal|protected|private)?\s*(?:readonly\s+)?(?:ref\s+)?struct\s+(?<name>\w+)/, kind: "struct", exported: pub2 },
      { re: /^\s*(?:public|internal|protected|private)?\s*enum\s+(?<name>\w+)/, kind: "enum", exported: pub2 },
      // method: a visibility modifier, a return type, then `name(`
      { re: /^\s*(?:public|internal|protected|private)\s+(?:static\s+|virtual\s+|override\s+|async\s+|sealed\s+|abstract\s+|new\s+)*[\w<>\[\],.?]+\s+(?<name>\w+)\s*(?:<[^>]*>)?\s*\(/, kind: "method", exported: pub2 }
    ];
    csharp = {
      lang: "csharp",
      exts: [".cs"],
      extract(rel, content) {
        return scan(rel, content, "csharp", RULES7);
      }
    };
  }
});
var RULES8;
var php;
var init_php = __esm({
  "src/lang/php.ts"() {
    "use strict";
    init_common();
    RULES8 = [
      { re: /^\s*(?:abstract\s+|final\s+)*class\s+(?<name>\w+)/, kind: "class", exported: true },
      { re: /^\s*interface\s+(?<name>\w+)/, kind: "interface", exported: true },
      { re: /^\s*trait\s+(?<name>\w+)/, kind: "trait", exported: true },
      { re: /^\s*enum\s+(?<name>\w+)/, kind: "enum", exported: true },
      {
        re: /^\s*(?:public\s+|protected\s+|private\s+|static\s+|abstract\s+|final\s+)*function\s+(?<name>\w+)\s*\(/,
        kind: "function",
        exported: (_m, l) => !/\b(private|protected)\b/.test(l)
      }
    ];
    php = {
      lang: "php",
      exts: [".php"],
      extract(rel, content) {
        return scan(rel, content, "php", RULES8);
      }
    };
  }
});
var vis;
var MODS;
var RULES9;
var swift;
var init_swift = __esm({
  "src/lang/swift.ts"() {
    "use strict";
    init_common();
    vis = (_m, l) => !/\b(private|fileprivate)\b/.test(l);
    MODS = "(?:public\\s+|open\\s+|internal\\s+|private\\s+|fileprivate\\s+)?(?:final\\s+)?";
    RULES9 = [
      { re: new RegExp(`^\\s*${MODS}class\\s+(?<name>\\w+)`), kind: "class", exported: vis },
      { re: new RegExp(`^\\s*${MODS}struct\\s+(?<name>\\w+)`), kind: "struct", exported: vis },
      { re: new RegExp(`^\\s*${MODS}enum\\s+(?<name>\\w+)`), kind: "enum", exported: vis },
      { re: new RegExp(`^\\s*${MODS}protocol\\s+(?<name>\\w+)`), kind: "protocol", exported: vis },
      { re: /^\s*(?:public\s+|open\s+|internal\s+|private\s+|fileprivate\s+)?(?:static\s+|class\s+|final\s+|override\s+|mutating\s+|@\w+\s+)*func\s+(?<name>\w+)/, kind: "function", exported: vis }
    ];
    swift = {
      lang: "swift",
      exts: [".swift"],
      extract(rel, content) {
        return scan(rel, content, "swift", RULES9);
      }
    };
  }
});
var vis2;
var RULES10;
var kotlin;
var init_kotlin = __esm({
  "src/lang/kotlin.ts"() {
    "use strict";
    init_common();
    vis2 = (_m, l) => !/\b(private|internal)\b/.test(l);
    RULES10 = [
      { re: /^\s*(?:public\s+|internal\s+|private\s+|abstract\s+|sealed\s+|open\s+|final\s+|data\s+)*class\s+(?<name>\w+)/, kind: "class", exported: vis2 },
      { re: /^\s*(?:public\s+|internal\s+|private\s+|fun\s+)?interface\s+(?<name>\w+)/, kind: "interface", exported: vis2 },
      { re: /^\s*(?:public\s+|internal\s+|private\s+|companion\s+)?object\s+(?<name>\w+)/, kind: "object", exported: vis2 },
      { re: /^\s*(?:public\s+|internal\s+|private\s+|protected\s+|override\s+|open\s+|abstract\s+|suspend\s+|inline\s+|operator\s+)*fun\s+(?:<[^>]*>\s+)?(?<name>\w+)\s*\(/, kind: "function", exported: vis2 }
    ];
    kotlin = {
      lang: "kotlin",
      exts: [".kt", ".kts"],
      extract(rel, content) {
        return scan(rel, content, "kotlin", RULES10);
      }
    };
  }
});
var NOT_KEYWORD;
var RULES11;
var c;
var init_c = __esm({
  "src/lang/c.ts"() {
    "use strict";
    init_common();
    NOT_KEYWORD = "(?!\\s*(?:if|for|while|switch|return|else|do|sizeof|typedef)\\b)";
    RULES11 = [
      // C++ types
      { re: /^\s*(?:class|struct)\s+(?<name>[A-Za-z_]\w+)\s*(?:[:{]|$)/, kind: "class", exported: true },
      { re: /^\s*namespace\s+(?<name>[A-Za-z_]\w+)/, kind: "namespace", exported: true },
      // typedef struct/enum/union NAME {
      { re: /^\s*(?:typedef\s+)?(?:struct|enum|union)\s+(?<name>[A-Za-z_]\w+)\s*\{/, kind: "struct", exported: true },
      // function definition: <type ...> name(<args>) [const] {?  at column 0-ish
      { re: new RegExp(`^${NOT_KEYWORD}[A-Za-z_][\\w\\s\\*&<>:,]*?\\b(?<name>[A-Za-z_]\\w+)\\s*\\([^;{]*\\)\\s*(?:const)?\\s*\\{?\\s*$`), kind: "function", exported: true }
    ];
    c = {
      lang: "c/cpp",
      exts: [".c", ".h", ".cc", ".cpp", ".cxx", ".hpp", ".hh"],
      extract(rel, content) {
        return scan(rel, content, rel.match(/\.(c|h)$/) ? "c" : "cpp", RULES11);
      }
    };
  }
});
var RULES12;
var lua;
var init_lua = __esm({
  "src/lang/lua.ts"() {
    "use strict";
    init_common();
    RULES12 = [
      { re: /^\s*local\s+function\s+(?<name>[\w.:]+)\s*\(/, kind: "function", exported: false },
      { re: /^\s*function\s+(?<name>[\w.:]+)\s*\(/, kind: "function", exported: true },
      { re: /^\s*(?:local\s+)?(?<name>[\w.]+)\s*=\s*function\s*\(/, kind: "function", exported: true }
    ];
    lua = {
      lang: "lua",
      exts: [".lua"],
      extract(rel, content) {
        return scan(rel, content, "lua", RULES12);
      }
    };
  }
});
var RULES13;
var shell;
var init_shell = __esm({
  "src/lang/shell.ts"() {
    "use strict";
    init_common();
    RULES13 = [
      { re: /^\s*function\s+(?<name>[\w:-]+)\s*(?:\(\))?\s*\{?/, kind: "function", exported: true },
      { re: /^\s*(?<name>[A-Za-z_][\w:-]*)\s*\(\)\s*\{?/, kind: "function", exported: true }
    ];
    shell = {
      lang: "shell",
      exts: [".sh", ".bash", ".zsh", ".ksh"],
      extract(rel, content) {
        return scan(rel, content, "shell", RULES13);
      }
    };
  }
});
var RULES14;
var elixir;
var init_elixir = __esm({
  "src/lang/elixir.ts"() {
    "use strict";
    init_common();
    RULES14 = [
      { re: /^\s*defmodule\s+(?<name>[\w.]+)/, kind: "module", exported: true },
      { re: /^\s*defp\s+(?<name>[\w?!]+)/, kind: "function", exported: false },
      { re: /^\s*def\s+(?<name>[\w?!]+)/, kind: "function", exported: true },
      { re: /^\s*defmacrop?\s+(?<name>[\w?!]+)/, kind: "macro", exported: true }
    ];
    elixir = {
      lang: "elixir",
      exts: [".ex", ".exs"],
      extract(rel, content) {
        return scan(rel, content, "elixir", RULES14);
      }
    };
  }
});
var RULES15;
var scala;
var init_scala = __esm({
  "src/lang/scala.ts"() {
    "use strict";
    init_common();
    RULES15 = [
      { re: /^\s*(?:final\s+|sealed\s+|abstract\s+|implicit\s+)*(?:case\s+)?class\s+(?<name>\w+)/, kind: "class", exported: true },
      { re: /^\s*(?:sealed\s+)?trait\s+(?<name>\w+)/, kind: "trait", exported: true },
      { re: /^\s*(?:case\s+)?object\s+(?<name>\w+)/, kind: "object", exported: true },
      { re: /^\s*(?:override\s+|final\s+|private\s+|protected\s+|implicit\s+)*def\s+(?<name>\w+)/, kind: "def", exported: (_m, l) => !/\b(private|protected)\b/.test(l) }
    ];
    scala = {
      lang: "scala",
      exts: [".scala", ".sc"],
      extract(rel, content) {
        return scan(rel, content, "scala", RULES15);
      }
    };
  }
});
function extractSymbols(rel, ext, content) {
  const extractor = BY_EXT.get(ext);
  if (!extractor) return [];
  try {
    return extractor.extract(rel, content);
  } catch {
    return [];
  }
}
function languageOf(ext) {
  return BY_EXT.get(ext)?.lang ?? extToLang(ext);
}
var EXTRACTORS;
var BY_EXT;
var init_registry = __esm({
  "src/lang/registry.ts"() {
    "use strict";
    init_common();
    init_js_ts();
    init_python();
    init_go();
    init_ruby();
    init_java();
    init_rust();
    init_csharp();
    init_php();
    init_swift();
    init_kotlin();
    init_c();
    init_lua();
    init_shell();
    init_elixir();
    init_scala();
    EXTRACTORS = [
      jsTs,
      python,
      go,
      ruby,
      java,
      rust,
      csharp,
      php,
      swift,
      kotlin,
      c,
      lua,
      shell,
      elixir,
      scala
    ];
    BY_EXT = /* @__PURE__ */ new Map();
    for (const e of EXTRACTORS) for (const ext of e.exts) BY_EXT.set(ext, e);
  }
});
function isDoc(rel, ext) {
  const base = rel.split("/").pop().toLowerCase();
  return DOC_EXT.has(ext) || DOC_BASENAME.test(base) || DOC_DIR.test(rel);
}
function isConfig(rel, ext) {
  const base = rel.split("/").pop().toLowerCase();
  return CONFIG_BASENAME.has(base) || CONFIG_EXT.has(ext);
}
function isCode(ext) {
  return !NON_CODE_LANGS.has(languageOf(ext));
}
function classify(rel, ext) {
  if (isCode(ext)) return "code";
  if (isDoc(rel, ext)) return "doc";
  if (isConfig(rel, ext)) return "config";
  return "other";
}
var DOC_BASENAME;
var DOC_EXT;
var DOC_DIR;
var CONFIG_BASENAME;
var CONFIG_EXT;
var MARKDOWN_EXT;
var NON_CODE_LANGS;
var init_classify = __esm({
  "src/classify.ts"() {
    "use strict";
    init_registry();
    DOC_BASENAME = /^(readme|changelog|contributing|history|news|authors|notice|security|code_of_conduct|faq|getting[-_]?started|usage|guide|tutorial)\b/i;
    DOC_EXT = /* @__PURE__ */ new Set([".md", ".mdx", ".rst", ".adoc", ".txt"]);
    DOC_DIR = /^(docs?|documentation|wiki|guides?|website|site|book)\//i;
    CONFIG_BASENAME = /* @__PURE__ */ new Set([
      "package.json",
      "pnpm-workspace.yaml",
      "tsconfig.json",
      "jsconfig.json",
      "pyproject.toml",
      "setup.py",
      "setup.cfg",
      "requirements.txt",
      "pipfile",
      "go.mod",
      "cargo.toml",
      "gemfile",
      "pom.xml",
      "build.gradle",
      "build.gradle.kts",
      "composer.json",
      "mix.exs",
      "pubspec.yaml",
      "build.sbt",
      "dockerfile",
      "docker-compose.yml",
      "docker-compose.yaml",
      "makefile",
      ".env.example",
      "manifest.json"
    ]);
    CONFIG_EXT = /* @__PURE__ */ new Set([".json", ".yaml", ".yml", ".toml", ".ini", ".cfg"]);
    MARKDOWN_EXT = /* @__PURE__ */ new Set([".md", ".mdx"]);
    NON_CODE_LANGS = /* @__PURE__ */ new Set([
      "markdown",
      "restructuredtext",
      "text",
      "json",
      "yaml",
      "toml",
      "ini",
      "other",
      "html",
      "css",
      "scss"
    ]);
  }
});
function globToRegExp2(glob) {
  let re = "";
  for (let i2 = 0; i2 < glob.length; i2++) {
    const c2 = glob[i2];
    if (c2 === "*") {
      if (glob[i2 + 1] === "*") {
        i2++;
        if (glob[i2 + 1] === "/") {
          i2++;
          re += "(?:.*/)?";
        } else {
          re += ".*";
        }
      } else {
        re += "[^/]*";
      }
    } else if (c2 === "?") {
      re += "[^/]";
    } else {
      re += escapeRegExp(c2);
    }
  }
  return new RegExp(`^${re}$`);
}
function compileGlobs(globs) {
  if (!globs || globs.length === 0) return null;
  const res = globs.map(globToRegExp2);
  return (rel) => res.some((r) => r.test(rel));
}
function compileGlobFilter(globs) {
  if (!globs || globs.length === 0) return null;
  const include = compileGlobs(globs.filter((g) => !g.startsWith("!")));
  const exclude = compileGlobs(globs.filter((g) => g.startsWith("!")).map((g) => g.slice(1)));
  return (rel) => (!include || include(rel)) && !exclude?.(rel);
}
var init_glob = __esm({
  "src/glob.ts"() {
    "use strict";
    init_util();
  }
});
function byStr(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}
function byKey(keyOf2) {
  return (a, b) => byStr(keyOf2(a), keyOf2(b));
}
var init_sort = __esm({
  "src/sort.ts"() {
    "use strict";
  }
});
function stripFences(content) {
  const lines = content.split(/\r?\n/);
  const out2 = [];
  let fence = null;
  for (const line of lines) {
    const m = /^\s*(```+|~~~+)/.exec(line);
    if (fence) {
      if (m && line.trim().startsWith(fence[0][0].repeat(3).slice(0, 3))) fence = null;
      out2.push("");
      continue;
    }
    if (m) {
      fence = m[1];
      out2.push("");
      continue;
    }
    out2.push(line);
  }
  return out2.join("\n");
}
function isExternalTarget(spec) {
  if (!spec) return true;
  if (spec.startsWith("#")) return true;
  if (spec.startsWith("//")) return true;
  return /^[a-z][a-z0-9+.-]*:/i.test(spec);
}
function cleanProse(line) {
  return line.replace(/!\[[^\]]*\]\([^)]*\)/g, "").replace(/`([^`]*)`/g, "$1").replace(/\*\*([^*]+)\*\*/g, "$1").replace(/\*([^*]+)\*/g, "$1").replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/[#>*_~-]+/g, " ").replace(/\s+/g, " ").trim();
}
function hasProse(s) {
  return /[A-Za-zÀ-ɏ]{3,}/.test(s);
}
function isBoilerplate(s) {
  return /^(all notable changes to this project|in the interest of fostering|this project adheres to|we as members and leaders|table of contents)\b/i.test(s);
}
function extractMarkdown(content) {
  let body2 = content;
  let frontTitle;
  const fm = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(body2);
  if (fm) {
    const t = /(^|\n)title:\s*["']?(.+?)["']?\s*(\n|$)/i.exec(fm[1]);
    if (t) frontTitle = t[2].trim();
    body2 = body2.slice(fm[0].length);
  }
  const scan2 = stripFences(body2);
  const lines = scan2.split(/\r?\n/);
  const headings = [];
  let title = frontTitle;
  let summary;
  let summaryClosed = false;
  for (const line of lines) {
    const h = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (h) {
      const text = cleanProse(h[2]);
      headings.push(text);
      if (!title && h[1].length === 1) title = text;
      if (!summary && h[1].length >= 2) summaryClosed = true;
      continue;
    }
    if (!summary && !summaryClosed) {
      const t = line.trim();
      if (t && !/^([-*+]|\d+\.)\s/.test(t) && !t.startsWith("|") && !t.startsWith("<")) {
        const cleaned = cleanProse(t);
        if (cleaned.length >= 8 && hasProse(cleaned) && !cleaned.endsWith(":") && !isBoilerplate(cleaned)) {
          summary = cleaned.slice(0, 200);
        }
      }
    }
  }
  const refs = [];
  const seen = /* @__PURE__ */ new Set();
  const addRef = (raw) => {
    let spec = raw.trim();
    spec = spec.replace(/\s+["'(].*$/, "").trim();
    spec = spec.replace(/^<|>$/g, "");
    if (isExternalTarget(spec)) return;
    if (seen.has(spec)) return;
    seen.add(spec);
    refs.push({ kind: "doc-link", spec });
  };
  const inline = /!?\[[^\]]*\]\(([^)]+)\)/g;
  let m;
  while (m = inline.exec(scan2)) addRef(m[1]);
  const refdef = /^\s*\[[^\]]+\]:\s+(\S+)/gm;
  while (m = refdef.exec(scan2)) addRef(m[1]);
  return { title, summary, headings, refs };
}
var init_markdown = __esm({
  "src/extract/markdown.ts"() {
    "use strict";
  }
});
function assertInternal(x) {
  if (x !== INTERNAL) throw new Error("Illegal constructor");
}
function isPoint(point) {
  return !!point && typeof point.row === "number" && typeof point.column === "number";
}
function setModule(module2) {
  C = module2;
}
function getText(tree, startIndex, endIndex, startPosition) {
  const length = endIndex - startIndex;
  let result = tree.textCallback(startIndex, startPosition);
  if (result) {
    startIndex += result.length;
    while (startIndex < endIndex) {
      const string = tree.textCallback(startIndex, startPosition);
      if (string && string.length > 0) {
        startIndex += string.length;
        result += string;
      } else {
        break;
      }
    }
    if (startIndex > endIndex) {
      result = result.slice(0, length);
    }
  }
  return result ?? "";
}
function unmarshalCaptures(query, tree, address, patternIndex, result) {
  for (let i2 = 0, n = result.length; i2 < n; i2++) {
    const captureIndex = C.getValue(address, "i32");
    address += SIZE_OF_INT;
    const node = unmarshalNode(tree, address);
    address += SIZE_OF_NODE;
    result[i2] = { patternIndex, name: query.captureNames[captureIndex], node };
  }
  return address;
}
function marshalNode(node, index = 0) {
  let address = TRANSFER_BUFFER + index * SIZE_OF_NODE;
  C.setValue(address, node.id, "i32");
  address += SIZE_OF_INT;
  C.setValue(address, node.startIndex, "i32");
  address += SIZE_OF_INT;
  C.setValue(address, node.startPosition.row, "i32");
  address += SIZE_OF_INT;
  C.setValue(address, node.startPosition.column, "i32");
  address += SIZE_OF_INT;
  C.setValue(address, node[0], "i32");
}
function unmarshalNode(tree, address = TRANSFER_BUFFER) {
  const id = C.getValue(address, "i32");
  address += SIZE_OF_INT;
  if (id === 0) return null;
  const index = C.getValue(address, "i32");
  address += SIZE_OF_INT;
  const row = C.getValue(address, "i32");
  address += SIZE_OF_INT;
  const column = C.getValue(address, "i32");
  address += SIZE_OF_INT;
  const other = C.getValue(address, "i32");
  const result = new Node(INTERNAL, {
    id,
    tree,
    startIndex: index,
    startPosition: { row, column },
    other
  });
  return result;
}
function marshalTreeCursor(cursor, address = TRANSFER_BUFFER) {
  C.setValue(address + 0 * SIZE_OF_INT, cursor[0], "i32");
  C.setValue(address + 1 * SIZE_OF_INT, cursor[1], "i32");
  C.setValue(address + 2 * SIZE_OF_INT, cursor[2], "i32");
  C.setValue(address + 3 * SIZE_OF_INT, cursor[3], "i32");
}
function unmarshalTreeCursor(cursor) {
  cursor[0] = C.getValue(TRANSFER_BUFFER + 0 * SIZE_OF_INT, "i32");
  cursor[1] = C.getValue(TRANSFER_BUFFER + 1 * SIZE_OF_INT, "i32");
  cursor[2] = C.getValue(TRANSFER_BUFFER + 2 * SIZE_OF_INT, "i32");
  cursor[3] = C.getValue(TRANSFER_BUFFER + 3 * SIZE_OF_INT, "i32");
}
function marshalPoint(address, point) {
  C.setValue(address, point.row, "i32");
  C.setValue(address + SIZE_OF_INT, point.column, "i32");
}
function unmarshalPoint(address) {
  const result = {
    row: C.getValue(address, "i32") >>> 0,
    column: C.getValue(address + SIZE_OF_INT, "i32") >>> 0
  };
  return result;
}
function marshalRange(address, range) {
  marshalPoint(address, range.startPosition);
  address += SIZE_OF_POINT;
  marshalPoint(address, range.endPosition);
  address += SIZE_OF_POINT;
  C.setValue(address, range.startIndex, "i32");
  address += SIZE_OF_INT;
  C.setValue(address, range.endIndex, "i32");
  address += SIZE_OF_INT;
}
function unmarshalRange(address) {
  const result = {};
  result.startPosition = unmarshalPoint(address);
  address += SIZE_OF_POINT;
  result.endPosition = unmarshalPoint(address);
  address += SIZE_OF_POINT;
  result.startIndex = C.getValue(address, "i32") >>> 0;
  address += SIZE_OF_INT;
  result.endIndex = C.getValue(address, "i32") >>> 0;
  return result;
}
function marshalEdit(edit, address = TRANSFER_BUFFER) {
  marshalPoint(address, edit.startPosition);
  address += SIZE_OF_POINT;
  marshalPoint(address, edit.oldEndPosition);
  address += SIZE_OF_POINT;
  marshalPoint(address, edit.newEndPosition);
  address += SIZE_OF_POINT;
  C.setValue(address, edit.startIndex, "i32");
  address += SIZE_OF_INT;
  C.setValue(address, edit.oldEndIndex, "i32");
  address += SIZE_OF_INT;
  C.setValue(address, edit.newEndIndex, "i32");
  address += SIZE_OF_INT;
}
function unmarshalLanguageMetadata(address) {
  const major_version = C.getValue(address, "i32");
  const minor_version = C.getValue(address += SIZE_OF_INT, "i32");
  const patch_version = C.getValue(address += SIZE_OF_INT, "i32");
  return { major_version, minor_version, patch_version };
}
async function Module2(moduleArg = {}) {
  var moduleRtn;
  var Module = moduleArg;
  var ENVIRONMENT_IS_WEB = typeof window == "object";
  var ENVIRONMENT_IS_WORKER = typeof WorkerGlobalScope != "undefined";
  var ENVIRONMENT_IS_NODE = typeof process == "object" && process.versions?.node && process.type != "renderer";
  if (ENVIRONMENT_IS_NODE) {
    const { createRequire } = await import("module");
    var require = createRequire(import.meta.url);
  }
  Module.currentQueryProgressCallback = null;
  Module.currentProgressCallback = null;
  Module.currentLogCallback = null;
  Module.currentParseCallback = null;
  var arguments_ = [];
  var thisProgram = "./this.program";
  var quit_ = /* @__PURE__ */ __name((status, toThrow) => {
    throw toThrow;
  }, "quit_");
  var _scriptName = import.meta.url;
  var scriptDirectory = "";
  function locateFile(path) {
    if (Module["locateFile"]) {
      return Module["locateFile"](path, scriptDirectory);
    }
    return scriptDirectory + path;
  }
  __name(locateFile, "locateFile");
  var readAsync, readBinary;
  if (ENVIRONMENT_IS_NODE) {
    var fs = require("fs");
    if (_scriptName.startsWith("file:")) {
      scriptDirectory = require("path").dirname(require("url").fileURLToPath(_scriptName)) + "/";
    }
    readBinary = /* @__PURE__ */ __name((filename) => {
      filename = isFileURI(filename) ? new URL(filename) : filename;
      var ret = fs.readFileSync(filename);
      return ret;
    }, "readBinary");
    readAsync = /* @__PURE__ */ __name(async (filename, binary2 = true) => {
      filename = isFileURI(filename) ? new URL(filename) : filename;
      var ret = fs.readFileSync(filename, binary2 ? void 0 : "utf8");
      return ret;
    }, "readAsync");
    if (process.argv.length > 1) {
      thisProgram = process.argv[1].replace(/\\/g, "/");
    }
    arguments_ = process.argv.slice(2);
    quit_ = /* @__PURE__ */ __name((status, toThrow) => {
      process.exitCode = status;
      throw toThrow;
    }, "quit_");
  } else if (ENVIRONMENT_IS_WEB || ENVIRONMENT_IS_WORKER) {
    try {
      scriptDirectory = new URL(".", _scriptName).href;
    } catch {
    }
    {
      if (ENVIRONMENT_IS_WORKER) {
        readBinary = /* @__PURE__ */ __name((url) => {
          var xhr = new XMLHttpRequest();
          xhr.open("GET", url, false);
          xhr.responseType = "arraybuffer";
          xhr.send(null);
          return new Uint8Array(
            /** @type{!ArrayBuffer} */
            xhr.response
          );
        }, "readBinary");
      }
      readAsync = /* @__PURE__ */ __name(async (url) => {
        if (isFileURI(url)) {
          return new Promise((resolve22, reject) => {
            var xhr = new XMLHttpRequest();
            xhr.open("GET", url, true);
            xhr.responseType = "arraybuffer";
            xhr.onload = () => {
              if (xhr.status == 200 || xhr.status == 0 && xhr.response) {
                resolve22(xhr.response);
                return;
              }
              reject(xhr.status);
            };
            xhr.onerror = reject;
            xhr.send(null);
          });
        }
        var response = await fetch(url, {
          credentials: "same-origin"
        });
        if (response.ok) {
          return response.arrayBuffer();
        }
        throw new Error(response.status + " : " + response.url);
      }, "readAsync");
    }
  } else {
  }
  var out = console.log.bind(console);
  var err = console.error.bind(console);
  var dynamicLibraries = [];
  var wasmBinary;
  var ABORT = false;
  var EXITSTATUS;
  var isFileURI = /* @__PURE__ */ __name((filename) => filename.startsWith("file://"), "isFileURI");
  var readyPromiseResolve, readyPromiseReject;
  var wasmMemory;
  var HEAP8, HEAPU8, HEAP16, HEAPU16, HEAP32, HEAPU32, HEAPF32, HEAPF64;
  var HEAP64, HEAPU64;
  var HEAP_DATA_VIEW;
  var runtimeInitialized = false;
  function updateMemoryViews() {
    var b = wasmMemory.buffer;
    Module["HEAP8"] = HEAP8 = new Int8Array(b);
    Module["HEAP16"] = HEAP16 = new Int16Array(b);
    Module["HEAPU8"] = HEAPU8 = new Uint8Array(b);
    Module["HEAPU16"] = HEAPU16 = new Uint16Array(b);
    Module["HEAP32"] = HEAP32 = new Int32Array(b);
    Module["HEAPU32"] = HEAPU32 = new Uint32Array(b);
    Module["HEAPF32"] = HEAPF32 = new Float32Array(b);
    Module["HEAPF64"] = HEAPF64 = new Float64Array(b);
    Module["HEAP64"] = HEAP64 = new BigInt64Array(b);
    Module["HEAPU64"] = HEAPU64 = new BigUint64Array(b);
    Module["HEAP_DATA_VIEW"] = HEAP_DATA_VIEW = new DataView(b);
    LE_HEAP_UPDATE();
  }
  __name(updateMemoryViews, "updateMemoryViews");
  function initMemory() {
    if (Module["wasmMemory"]) {
      wasmMemory = Module["wasmMemory"];
    } else {
      var INITIAL_MEMORY = Module["INITIAL_MEMORY"] || 33554432;
      wasmMemory = new WebAssembly.Memory({
        "initial": INITIAL_MEMORY / 65536,
        // In theory we should not need to emit the maximum if we want "unlimited"
        // or 4GB of memory, but VMs error on that atm, see
        // https://github.com/emscripten-core/emscripten/issues/14130
        // And in the pthreads case we definitely need to emit a maximum. So
        // always emit one.
        "maximum": 32768
      });
    }
    updateMemoryViews();
  }
  __name(initMemory, "initMemory");
  var __RELOC_FUNCS__ = [];
  function preRun() {
    if (Module["preRun"]) {
      if (typeof Module["preRun"] == "function") Module["preRun"] = [Module["preRun"]];
      while (Module["preRun"].length) {
        addOnPreRun(Module["preRun"].shift());
      }
    }
    callRuntimeCallbacks(onPreRuns);
  }
  __name(preRun, "preRun");
  function initRuntime() {
    runtimeInitialized = true;
    callRuntimeCallbacks(__RELOC_FUNCS__);
    wasmExports["__wasm_call_ctors"]();
    callRuntimeCallbacks(onPostCtors);
  }
  __name(initRuntime, "initRuntime");
  function preMain() {
  }
  __name(preMain, "preMain");
  function postRun() {
    if (Module["postRun"]) {
      if (typeof Module["postRun"] == "function") Module["postRun"] = [Module["postRun"]];
      while (Module["postRun"].length) {
        addOnPostRun(Module["postRun"].shift());
      }
    }
    callRuntimeCallbacks(onPostRuns);
  }
  __name(postRun, "postRun");
  function abort(what) {
    Module["onAbort"]?.(what);
    what = "Aborted(" + what + ")";
    err(what);
    ABORT = true;
    what += ". Build with -sASSERTIONS for more info.";
    var e = new WebAssembly.RuntimeError(what);
    readyPromiseReject?.(e);
    throw e;
  }
  __name(abort, "abort");
  var wasmBinaryFile;
  function findWasmBinary() {
    if (Module["locateFile"]) {
      return locateFile("web-tree-sitter.wasm");
    }
    return new URL("web-tree-sitter.wasm", import.meta.url).href;
  }
  __name(findWasmBinary, "findWasmBinary");
  function getBinarySync(file) {
    if (file == wasmBinaryFile && wasmBinary) {
      return new Uint8Array(wasmBinary);
    }
    if (readBinary) {
      return readBinary(file);
    }
    throw "both async and sync fetching of the wasm failed";
  }
  __name(getBinarySync, "getBinarySync");
  async function getWasmBinary(binaryFile) {
    if (!wasmBinary) {
      try {
        var response = await readAsync(binaryFile);
        return new Uint8Array(response);
      } catch {
      }
    }
    return getBinarySync(binaryFile);
  }
  __name(getWasmBinary, "getWasmBinary");
  async function instantiateArrayBuffer(binaryFile, imports) {
    try {
      var binary2 = await getWasmBinary(binaryFile);
      var instance2 = await WebAssembly.instantiate(binary2, imports);
      return instance2;
    } catch (reason) {
      err(`failed to asynchronously prepare wasm: ${reason}`);
      abort(reason);
    }
  }
  __name(instantiateArrayBuffer, "instantiateArrayBuffer");
  async function instantiateAsync(binary2, binaryFile, imports) {
    if (!binary2 && !isFileURI(binaryFile) && !ENVIRONMENT_IS_NODE) {
      try {
        var response = fetch(binaryFile, {
          credentials: "same-origin"
        });
        var instantiationResult = await WebAssembly.instantiateStreaming(response, imports);
        return instantiationResult;
      } catch (reason) {
        err(`wasm streaming compile failed: ${reason}`);
        err("falling back to ArrayBuffer instantiation");
      }
    }
    return instantiateArrayBuffer(binaryFile, imports);
  }
  __name(instantiateAsync, "instantiateAsync");
  function getWasmImports() {
    return {
      "env": wasmImports,
      "wasi_snapshot_preview1": wasmImports,
      "GOT.mem": new Proxy(wasmImports, GOTHandler),
      "GOT.func": new Proxy(wasmImports, GOTHandler)
    };
  }
  __name(getWasmImports, "getWasmImports");
  async function createWasm() {
    function receiveInstance(instance2, module2) {
      wasmExports = instance2.exports;
      wasmExports = relocateExports(wasmExports, 1024);
      var metadata2 = getDylinkMetadata(module2);
      if (metadata2.neededDynlibs) {
        dynamicLibraries = metadata2.neededDynlibs.concat(dynamicLibraries);
      }
      mergeLibSymbols(wasmExports, "main");
      LDSO.init();
      loadDylibs();
      __RELOC_FUNCS__.push(wasmExports["__wasm_apply_data_relocs"]);
      assignWasmExports(wasmExports);
      return wasmExports;
    }
    __name(receiveInstance, "receiveInstance");
    function receiveInstantiationResult(result2) {
      return receiveInstance(result2["instance"], result2["module"]);
    }
    __name(receiveInstantiationResult, "receiveInstantiationResult");
    var info2 = getWasmImports();
    if (Module["instantiateWasm"]) {
      return new Promise((resolve22, reject) => {
        Module["instantiateWasm"](info2, (mod, inst) => {
          resolve22(receiveInstance(mod, inst));
        });
      });
    }
    wasmBinaryFile ??= findWasmBinary();
    var result = await instantiateAsync(wasmBinary, wasmBinaryFile, info2);
    var exports = receiveInstantiationResult(result);
    return exports;
  }
  __name(createWasm, "createWasm");
  class ExitStatus {
    static {
      __name(this, "ExitStatus");
    }
    name = "ExitStatus";
    constructor(status) {
      this.message = `Program terminated with exit(${status})`;
      this.status = status;
    }
  }
  var GOT = {};
  var currentModuleWeakSymbols = /* @__PURE__ */ new Set([]);
  var GOTHandler = {
    get(obj, symName) {
      var rtn = GOT[symName];
      if (!rtn) {
        rtn = GOT[symName] = new WebAssembly.Global({
          "value": "i32",
          "mutable": true
        });
      }
      if (!currentModuleWeakSymbols.has(symName)) {
        rtn.required = true;
      }
      return rtn;
    }
  };
  var LE_ATOMICS_NATIVE_BYTE_ORDER = [];
  var LE_HEAP_LOAD_F32 = /* @__PURE__ */ __name((byteOffset) => HEAP_DATA_VIEW.getFloat32(byteOffset, true), "LE_HEAP_LOAD_F32");
  var LE_HEAP_LOAD_F64 = /* @__PURE__ */ __name((byteOffset) => HEAP_DATA_VIEW.getFloat64(byteOffset, true), "LE_HEAP_LOAD_F64");
  var LE_HEAP_LOAD_I16 = /* @__PURE__ */ __name((byteOffset) => HEAP_DATA_VIEW.getInt16(byteOffset, true), "LE_HEAP_LOAD_I16");
  var LE_HEAP_LOAD_I32 = /* @__PURE__ */ __name((byteOffset) => HEAP_DATA_VIEW.getInt32(byteOffset, true), "LE_HEAP_LOAD_I32");
  var LE_HEAP_LOAD_I64 = /* @__PURE__ */ __name((byteOffset) => HEAP_DATA_VIEW.getBigInt64(byteOffset, true), "LE_HEAP_LOAD_I64");
  var LE_HEAP_LOAD_U32 = /* @__PURE__ */ __name((byteOffset) => HEAP_DATA_VIEW.getUint32(byteOffset, true), "LE_HEAP_LOAD_U32");
  var LE_HEAP_STORE_F32 = /* @__PURE__ */ __name((byteOffset, value) => HEAP_DATA_VIEW.setFloat32(byteOffset, value, true), "LE_HEAP_STORE_F32");
  var LE_HEAP_STORE_F64 = /* @__PURE__ */ __name((byteOffset, value) => HEAP_DATA_VIEW.setFloat64(byteOffset, value, true), "LE_HEAP_STORE_F64");
  var LE_HEAP_STORE_I16 = /* @__PURE__ */ __name((byteOffset, value) => HEAP_DATA_VIEW.setInt16(byteOffset, value, true), "LE_HEAP_STORE_I16");
  var LE_HEAP_STORE_I32 = /* @__PURE__ */ __name((byteOffset, value) => HEAP_DATA_VIEW.setInt32(byteOffset, value, true), "LE_HEAP_STORE_I32");
  var LE_HEAP_STORE_I64 = /* @__PURE__ */ __name((byteOffset, value) => HEAP_DATA_VIEW.setBigInt64(byteOffset, value, true), "LE_HEAP_STORE_I64");
  var LE_HEAP_STORE_U32 = /* @__PURE__ */ __name((byteOffset, value) => HEAP_DATA_VIEW.setUint32(byteOffset, value, true), "LE_HEAP_STORE_U32");
  var callRuntimeCallbacks = /* @__PURE__ */ __name((callbacks) => {
    while (callbacks.length > 0) {
      callbacks.shift()(Module);
    }
  }, "callRuntimeCallbacks");
  var onPostRuns = [];
  var addOnPostRun = /* @__PURE__ */ __name((cb) => onPostRuns.push(cb), "addOnPostRun");
  var onPreRuns = [];
  var addOnPreRun = /* @__PURE__ */ __name((cb) => onPreRuns.push(cb), "addOnPreRun");
  var UTF8Decoder = typeof TextDecoder != "undefined" ? new TextDecoder() : void 0;
  var findStringEnd = /* @__PURE__ */ __name((heapOrArray, idx, maxBytesToRead, ignoreNul) => {
    var maxIdx = idx + maxBytesToRead;
    if (ignoreNul) return maxIdx;
    while (heapOrArray[idx] && !(idx >= maxIdx)) ++idx;
    return idx;
  }, "findStringEnd");
  var UTF8ArrayToString = /* @__PURE__ */ __name((heapOrArray, idx = 0, maxBytesToRead, ignoreNul) => {
    var endPtr = findStringEnd(heapOrArray, idx, maxBytesToRead, ignoreNul);
    if (endPtr - idx > 16 && heapOrArray.buffer && UTF8Decoder) {
      return UTF8Decoder.decode(heapOrArray.subarray(idx, endPtr));
    }
    var str22 = "";
    while (idx < endPtr) {
      var u0 = heapOrArray[idx++];
      if (!(u0 & 128)) {
        str22 += String.fromCharCode(u0);
        continue;
      }
      var u1 = heapOrArray[idx++] & 63;
      if ((u0 & 224) == 192) {
        str22 += String.fromCharCode((u0 & 31) << 6 | u1);
        continue;
      }
      var u2 = heapOrArray[idx++] & 63;
      if ((u0 & 240) == 224) {
        u0 = (u0 & 15) << 12 | u1 << 6 | u2;
      } else {
        u0 = (u0 & 7) << 18 | u1 << 12 | u2 << 6 | heapOrArray[idx++] & 63;
      }
      if (u0 < 65536) {
        str22 += String.fromCharCode(u0);
      } else {
        var ch = u0 - 65536;
        str22 += String.fromCharCode(55296 | ch >> 10, 56320 | ch & 1023);
      }
    }
    return str22;
  }, "UTF8ArrayToString");
  var getDylinkMetadata = /* @__PURE__ */ __name((binary2) => {
    var offset = 0;
    var end = 0;
    function getU8() {
      return binary2[offset++];
    }
    __name(getU8, "getU8");
    function getLEB() {
      var ret = 0;
      var mul = 1;
      while (1) {
        var byte = binary2[offset++];
        ret += (byte & 127) * mul;
        mul *= 128;
        if (!(byte & 128)) break;
      }
      return ret;
    }
    __name(getLEB, "getLEB");
    function getString() {
      var len = getLEB();
      offset += len;
      return UTF8ArrayToString(binary2, offset - len, len);
    }
    __name(getString, "getString");
    function getStringList() {
      var count2 = getLEB();
      var rtn = [];
      while (count2--) rtn.push(getString());
      return rtn;
    }
    __name(getStringList, "getStringList");
    function failIf(condition, message) {
      if (condition) throw new Error(message);
    }
    __name(failIf, "failIf");
    if (binary2 instanceof WebAssembly.Module) {
      var dylinkSection = WebAssembly.Module.customSections(binary2, "dylink.0");
      failIf(dylinkSection.length === 0, "need dylink section");
      binary2 = new Uint8Array(dylinkSection[0]);
      end = binary2.length;
    } else {
      var int32View = new Uint32Array(new Uint8Array(binary2.subarray(0, 24)).buffer);
      var magicNumberFound = int32View[0] == 1836278016 || int32View[0] == 6386541;
      failIf(!magicNumberFound, "need to see wasm magic number");
      failIf(binary2[8] !== 0, "need the dylink section to be first");
      offset = 9;
      var section_size = getLEB();
      end = offset + section_size;
      var name2 = getString();
      failIf(name2 !== "dylink.0");
    }
    var customSection = {
      neededDynlibs: [],
      tlsExports: /* @__PURE__ */ new Set(),
      weakImports: /* @__PURE__ */ new Set(),
      runtimePaths: []
    };
    var WASM_DYLINK_MEM_INFO = 1;
    var WASM_DYLINK_NEEDED = 2;
    var WASM_DYLINK_EXPORT_INFO = 3;
    var WASM_DYLINK_IMPORT_INFO = 4;
    var WASM_DYLINK_RUNTIME_PATH = 5;
    var WASM_SYMBOL_TLS = 256;
    var WASM_SYMBOL_BINDING_MASK = 3;
    var WASM_SYMBOL_BINDING_WEAK = 1;
    while (offset < end) {
      var subsectionType = getU8();
      var subsectionSize = getLEB();
      if (subsectionType === WASM_DYLINK_MEM_INFO) {
        customSection.memorySize = getLEB();
        customSection.memoryAlign = getLEB();
        customSection.tableSize = getLEB();
        customSection.tableAlign = getLEB();
      } else if (subsectionType === WASM_DYLINK_NEEDED) {
        customSection.neededDynlibs = getStringList();
      } else if (subsectionType === WASM_DYLINK_EXPORT_INFO) {
        var count = getLEB();
        while (count--) {
          var symname = getString();
          var flags2 = getLEB();
          if (flags2 & WASM_SYMBOL_TLS) {
            customSection.tlsExports.add(symname);
          }
        }
      } else if (subsectionType === WASM_DYLINK_IMPORT_INFO) {
        var count = getLEB();
        while (count--) {
          var modname = getString();
          var symname = getString();
          var flags2 = getLEB();
          if ((flags2 & WASM_SYMBOL_BINDING_MASK) == WASM_SYMBOL_BINDING_WEAK) {
            customSection.weakImports.add(symname);
          }
        }
      } else if (subsectionType === WASM_DYLINK_RUNTIME_PATH) {
        customSection.runtimePaths = getStringList();
      } else {
        offset += subsectionSize;
      }
    }
    return customSection;
  }, "getDylinkMetadata");
  function getValue(ptr, type = "i8") {
    if (type.endsWith("*")) type = "*";
    switch (type) {
      case "i1":
        return HEAP8[ptr];
      case "i8":
        return HEAP8[ptr];
      case "i16":
        return LE_HEAP_LOAD_I16((ptr >> 1) * 2);
      case "i32":
        return LE_HEAP_LOAD_I32((ptr >> 2) * 4);
      case "i64":
        return LE_HEAP_LOAD_I64((ptr >> 3) * 8);
      case "float":
        return LE_HEAP_LOAD_F32((ptr >> 2) * 4);
      case "double":
        return LE_HEAP_LOAD_F64((ptr >> 3) * 8);
      case "*":
        return LE_HEAP_LOAD_U32((ptr >> 2) * 4);
      default:
        abort(`invalid type for getValue: ${type}`);
    }
  }
  __name(getValue, "getValue");
  var newDSO = /* @__PURE__ */ __name((name2, handle2, syms) => {
    var dso = {
      refcount: Infinity,
      name: name2,
      exports: syms,
      global: true
    };
    LDSO.loadedLibsByName[name2] = dso;
    if (handle2 != void 0) {
      LDSO.loadedLibsByHandle[handle2] = dso;
    }
    return dso;
  }, "newDSO");
  var LDSO = {
    loadedLibsByName: {},
    loadedLibsByHandle: {},
    init() {
      newDSO("__main__", 0, wasmImports);
    }
  };
  var ___heap_base = 78240;
  var alignMemory = /* @__PURE__ */ __name((size, alignment) => Math.ceil(size / alignment) * alignment, "alignMemory");
  var getMemory = /* @__PURE__ */ __name((size) => {
    if (runtimeInitialized) {
      return _calloc(size, 1);
    }
    var ret = ___heap_base;
    var end = ret + alignMemory(size, 16);
    ___heap_base = end;
    GOT["__heap_base"].value = end;
    return ret;
  }, "getMemory");
  var isInternalSym = /* @__PURE__ */ __name((symName) => ["__cpp_exception", "__c_longjmp", "__wasm_apply_data_relocs", "__dso_handle", "__tls_size", "__tls_align", "__set_stack_limits", "_emscripten_tls_init", "__wasm_init_tls", "__wasm_call_ctors", "__start_em_asm", "__stop_em_asm", "__start_em_js", "__stop_em_js"].includes(symName) || symName.startsWith("__em_js__"), "isInternalSym");
  var uleb128EncodeWithLen = /* @__PURE__ */ __name((arr) => {
    const n = arr.length;
    return [n % 128 | 128, n >> 7, ...arr];
  }, "uleb128EncodeWithLen");
  var wasmTypeCodes = {
    "i": 127,
    // i32
    "p": 127,
    // i32
    "j": 126,
    // i64
    "f": 125,
    // f32
    "d": 124,
    // f64
    "e": 111
  };
  var generateTypePack = /* @__PURE__ */ __name((types) => uleb128EncodeWithLen(Array.from(types, (type) => {
    var code = wasmTypeCodes[type];
    return code;
  })), "generateTypePack");
  var convertJsFunctionToWasm = /* @__PURE__ */ __name((func2, sig) => {
    var bytes = Uint8Array.of(
      0,
      97,
      115,
      109,
      // magic ("\0asm")
      1,
      0,
      0,
      0,
      // version: 1
      1,
      ...uleb128EncodeWithLen([
        1,
        // count: 1
        96,
        // param types
        ...generateTypePack(sig.slice(1)),
        // return types (for now only supporting [] if `void` and single [T] otherwise)
        ...generateTypePack(sig[0] === "v" ? "" : sig[0])
      ]),
      // The rest of the module is static
      2,
      7,
      // import section
      // (import "e" "f" (func 0 (type 0)))
      1,
      1,
      101,
      1,
      102,
      0,
      0,
      7,
      5,
      // export section
      // (export "f" (func 0 (type 0)))
      1,
      1,
      102,
      0,
      0
    );
    var module2 = new WebAssembly.Module(bytes);
    var instance2 = new WebAssembly.Instance(module2, {
      "e": {
        "f": func2
      }
    });
    var wrappedFunc = instance2.exports["f"];
    return wrappedFunc;
  }, "convertJsFunctionToWasm");
  var wasmTableMirror = [];
  var wasmTable = new WebAssembly.Table({
    "initial": 31,
    "element": "anyfunc"
  });
  var getWasmTableEntry = /* @__PURE__ */ __name((funcPtr) => {
    var func2 = wasmTableMirror[funcPtr];
    if (!func2) {
      wasmTableMirror[funcPtr] = func2 = wasmTable.get(funcPtr);
    }
    return func2;
  }, "getWasmTableEntry");
  var updateTableMap = /* @__PURE__ */ __name((offset, count) => {
    if (functionsInTableMap) {
      for (var i2 = offset; i2 < offset + count; i2++) {
        var item = getWasmTableEntry(i2);
        if (item) {
          functionsInTableMap.set(item, i2);
        }
      }
    }
  }, "updateTableMap");
  var functionsInTableMap;
  var getFunctionAddress = /* @__PURE__ */ __name((func2) => {
    if (!functionsInTableMap) {
      functionsInTableMap = /* @__PURE__ */ new WeakMap();
      updateTableMap(0, wasmTable.length);
    }
    return functionsInTableMap.get(func2) || 0;
  }, "getFunctionAddress");
  var freeTableIndexes = [];
  var getEmptyTableSlot = /* @__PURE__ */ __name(() => {
    if (freeTableIndexes.length) {
      return freeTableIndexes.pop();
    }
    return wasmTable["grow"](1);
  }, "getEmptyTableSlot");
  var setWasmTableEntry = /* @__PURE__ */ __name((idx, func2) => {
    wasmTable.set(idx, func2);
    wasmTableMirror[idx] = wasmTable.get(idx);
  }, "setWasmTableEntry");
  var addFunction = /* @__PURE__ */ __name((func2, sig) => {
    var rtn = getFunctionAddress(func2);
    if (rtn) {
      return rtn;
    }
    var ret = getEmptyTableSlot();
    try {
      setWasmTableEntry(ret, func2);
    } catch (err2) {
      if (!(err2 instanceof TypeError)) {
        throw err2;
      }
      var wrapped = convertJsFunctionToWasm(func2, sig);
      setWasmTableEntry(ret, wrapped);
    }
    functionsInTableMap.set(func2, ret);
    return ret;
  }, "addFunction");
  var updateGOT = /* @__PURE__ */ __name((exports, replace) => {
    for (var symName in exports) {
      if (isInternalSym(symName)) {
        continue;
      }
      var value = exports[symName];
      GOT[symName] ||= new WebAssembly.Global({
        "value": "i32",
        "mutable": true
      });
      if (replace || GOT[symName].value == 0) {
        if (typeof value == "function") {
          GOT[symName].value = addFunction(value);
        } else if (typeof value == "number") {
          GOT[symName].value = value;
        } else {
          err(`unhandled export type for '${symName}': ${typeof value}`);
        }
      }
    }
  }, "updateGOT");
  var relocateExports = /* @__PURE__ */ __name((exports, memoryBase2, replace) => {
    var relocated = {};
    for (var e in exports) {
      var value = exports[e];
      if (typeof value == "object") {
        value = value.value;
      }
      if (typeof value == "number") {
        value += memoryBase2;
      }
      relocated[e] = value;
    }
    updateGOT(relocated, replace);
    return relocated;
  }, "relocateExports");
  var isSymbolDefined = /* @__PURE__ */ __name((symName) => {
    var existing = wasmImports[symName];
    if (!existing || existing.stub) {
      return false;
    }
    return true;
  }, "isSymbolDefined");
  var dynCall = /* @__PURE__ */ __name((sig, ptr, args2 = [], promising = false) => {
    var func2 = getWasmTableEntry(ptr);
    var rtn = func2(...args2);
    function convert(rtn2) {
      return rtn2;
    }
    __name(convert, "convert");
    return convert(rtn);
  }, "dynCall");
  var stackSave = /* @__PURE__ */ __name(() => _emscripten_stack_get_current(), "stackSave");
  var stackRestore = /* @__PURE__ */ __name((val) => __emscripten_stack_restore(val), "stackRestore");
  var createInvokeFunction = /* @__PURE__ */ __name((sig) => (ptr, ...args2) => {
    var sp = stackSave();
    try {
      return dynCall(sig, ptr, args2);
    } catch (e) {
      stackRestore(sp);
      if (e !== e + 0) throw e;
      _setThrew(1, 0);
      if (sig[0] == "j") return 0n;
    }
  }, "createInvokeFunction");
  var resolveGlobalSymbol = /* @__PURE__ */ __name((symName, direct = false) => {
    var sym;
    if (isSymbolDefined(symName)) {
      sym = wasmImports[symName];
    } else if (symName.startsWith("invoke_")) {
      sym = wasmImports[symName] = createInvokeFunction(symName.split("_")[1]);
    }
    return {
      sym,
      name: symName
    };
  }, "resolveGlobalSymbol");
  var onPostCtors = [];
  var addOnPostCtor = /* @__PURE__ */ __name((cb) => onPostCtors.push(cb), "addOnPostCtor");
  var UTF8ToString = /* @__PURE__ */ __name((ptr, maxBytesToRead, ignoreNul) => ptr ? UTF8ArrayToString(HEAPU8, ptr, maxBytesToRead, ignoreNul) : "", "UTF8ToString");
  var loadWebAssemblyModule = /* @__PURE__ */ __name((binary, flags, libName, localScope, handle) => {
    var metadata = getDylinkMetadata(binary);
    function loadModule() {
      var memAlign = Math.pow(2, metadata.memoryAlign);
      var memoryBase = metadata.memorySize ? alignMemory(getMemory(metadata.memorySize + memAlign), memAlign) : 0;
      var tableBase = metadata.tableSize ? wasmTable.length : 0;
      if (handle) {
        HEAP8[handle + 8] = 1;
        LE_HEAP_STORE_U32((handle + 12 >> 2) * 4, memoryBase);
        LE_HEAP_STORE_I32((handle + 16 >> 2) * 4, metadata.memorySize);
        LE_HEAP_STORE_U32((handle + 20 >> 2) * 4, tableBase);
        LE_HEAP_STORE_I32((handle + 24 >> 2) * 4, metadata.tableSize);
      }
      if (metadata.tableSize) {
        wasmTable.grow(metadata.tableSize);
      }
      var moduleExports;
      function resolveSymbol(sym) {
        var resolved = resolveGlobalSymbol(sym).sym;
        if (!resolved && localScope) {
          resolved = localScope[sym];
        }
        if (!resolved) {
          resolved = moduleExports[sym];
        }
        return resolved;
      }
      __name(resolveSymbol, "resolveSymbol");
      var proxyHandler = {
        get(stubs, prop) {
          switch (prop) {
            case "__memory_base":
              return memoryBase;
            case "__table_base":
              return tableBase;
          }
          if (prop in wasmImports && !wasmImports[prop].stub) {
            var res = wasmImports[prop];
            return res;
          }
          if (!(prop in stubs)) {
            var resolved;
            stubs[prop] = (...args2) => {
              resolved ||= resolveSymbol(prop);
              return resolved(...args2);
            };
          }
          return stubs[prop];
        }
      };
      var proxy = new Proxy({}, proxyHandler);
      currentModuleWeakSymbols = metadata.weakImports;
      var info = {
        "GOT.mem": new Proxy({}, GOTHandler),
        "GOT.func": new Proxy({}, GOTHandler),
        "env": proxy,
        "wasi_snapshot_preview1": proxy
      };
      function postInstantiation(module, instance) {
        updateTableMap(tableBase, metadata.tableSize);
        moduleExports = relocateExports(instance.exports, memoryBase);
        if (!flags.allowUndefined) {
          reportUndefinedSymbols();
        }
        function addEmAsm(addr, body) {
          var args = [];
          var arity = 0;
          for (; arity < 16; arity++) {
            if (body.indexOf("$" + arity) != -1) {
              args.push("$" + arity);
            } else {
              break;
            }
          }
          args = args.join(",");
          var func = `(${args}) => { ${body} };`;
          ASM_CONSTS[start] = eval(func);
        }
        __name(addEmAsm, "addEmAsm");
        if ("__start_em_asm" in moduleExports) {
          var start = moduleExports["__start_em_asm"];
          var stop = moduleExports["__stop_em_asm"];
          while (start < stop) {
            var jsString = UTF8ToString(start);
            addEmAsm(start, jsString);
            start = HEAPU8.indexOf(0, start) + 1;
          }
        }
        function addEmJs(name, cSig, body) {
          var jsArgs = [];
          cSig = cSig.slice(1, -1);
          if (cSig != "void") {
            cSig = cSig.split(",");
            for (var i in cSig) {
              var jsArg = cSig[i].split(" ").pop();
              jsArgs.push(jsArg.replace("*", ""));
            }
          }
          var func = `(${jsArgs}) => ${body};`;
          moduleExports[name] = eval(func);
        }
        __name(addEmJs, "addEmJs");
        for (var name in moduleExports) {
          if (name.startsWith("__em_js__")) {
            var start = moduleExports[name];
            var jsString = UTF8ToString(start);
            var parts = jsString.split("<::>");
            addEmJs(name.replace("__em_js__", ""), parts[0], parts[1]);
            delete moduleExports[name];
          }
        }
        var applyRelocs = moduleExports["__wasm_apply_data_relocs"];
        if (applyRelocs) {
          if (runtimeInitialized) {
            applyRelocs();
          } else {
            __RELOC_FUNCS__.push(applyRelocs);
          }
        }
        var init = moduleExports["__wasm_call_ctors"];
        if (init) {
          if (runtimeInitialized) {
            init();
          } else {
            addOnPostCtor(init);
          }
        }
        return moduleExports;
      }
      __name(postInstantiation, "postInstantiation");
      if (flags.loadAsync) {
        return (async () => {
          var instance2;
          if (binary instanceof WebAssembly.Module) {
            instance2 = new WebAssembly.Instance(binary, info);
          } else {
            ({ module: binary, instance: instance2 } = await WebAssembly.instantiate(binary, info));
          }
          return postInstantiation(binary, instance2);
        })();
      }
      var module = binary instanceof WebAssembly.Module ? binary : new WebAssembly.Module(binary);
      var instance = new WebAssembly.Instance(module, info);
      return postInstantiation(module, instance);
    }
    __name(loadModule, "loadModule");
    flags = {
      ...flags,
      rpath: {
        parentLibPath: libName,
        paths: metadata.runtimePaths
      }
    };
    if (flags.loadAsync) {
      return metadata.neededDynlibs.reduce((chain, dynNeeded) => chain.then(() => loadDynamicLibrary(dynNeeded, flags, localScope)), Promise.resolve()).then(loadModule);
    }
    metadata.neededDynlibs.forEach((needed) => loadDynamicLibrary(needed, flags, localScope));
    return loadModule();
  }, "loadWebAssemblyModule");
  var mergeLibSymbols = /* @__PURE__ */ __name((exports, libName2) => {
    for (var [sym, exp] of Object.entries(exports)) {
      const setImport = /* @__PURE__ */ __name((target) => {
        if (!isSymbolDefined(target)) {
          wasmImports[target] = exp;
        }
      }, "setImport");
      setImport(sym);
      const main_alias = "__main_argc_argv";
      if (sym == "main") {
        setImport(main_alias);
      }
      if (sym == main_alias) {
        setImport("main");
      }
    }
  }, "mergeLibSymbols");
  var asyncLoad = /* @__PURE__ */ __name(async (url) => {
    var arrayBuffer = await readAsync(url);
    return new Uint8Array(arrayBuffer);
  }, "asyncLoad");
  function loadDynamicLibrary(libName2, flags2 = {
    global: true,
    nodelete: true
  }, localScope2, handle2) {
    var dso = LDSO.loadedLibsByName[libName2];
    if (dso) {
      if (!flags2.global) {
        if (localScope2) {
          Object.assign(localScope2, dso.exports);
        }
      } else if (!dso.global) {
        dso.global = true;
        mergeLibSymbols(dso.exports, libName2);
      }
      if (flags2.nodelete && dso.refcount !== Infinity) {
        dso.refcount = Infinity;
      }
      dso.refcount++;
      if (handle2) {
        LDSO.loadedLibsByHandle[handle2] = dso;
      }
      return flags2.loadAsync ? Promise.resolve(true) : true;
    }
    dso = newDSO(libName2, handle2, "loading");
    dso.refcount = flags2.nodelete ? Infinity : 1;
    dso.global = flags2.global;
    function loadLibData() {
      if (handle2) {
        var data = LE_HEAP_LOAD_U32((handle2 + 28 >> 2) * 4);
        var dataSize = LE_HEAP_LOAD_U32((handle2 + 32 >> 2) * 4);
        if (data && dataSize) {
          var libData = HEAP8.slice(data, data + dataSize);
          return flags2.loadAsync ? Promise.resolve(libData) : libData;
        }
      }
      var libFile = locateFile(libName2);
      if (flags2.loadAsync) {
        return asyncLoad(libFile);
      }
      if (!readBinary) {
        throw new Error(`${libFile}: file not found, and synchronous loading of external files is not available`);
      }
      return readBinary(libFile);
    }
    __name(loadLibData, "loadLibData");
    function getExports() {
      if (flags2.loadAsync) {
        return loadLibData().then((libData) => loadWebAssemblyModule(libData, flags2, libName2, localScope2, handle2));
      }
      return loadWebAssemblyModule(loadLibData(), flags2, libName2, localScope2, handle2);
    }
    __name(getExports, "getExports");
    function moduleLoaded(exports) {
      if (dso.global) {
        mergeLibSymbols(exports, libName2);
      } else if (localScope2) {
        Object.assign(localScope2, exports);
      }
      dso.exports = exports;
    }
    __name(moduleLoaded, "moduleLoaded");
    if (flags2.loadAsync) {
      return getExports().then((exports) => {
        moduleLoaded(exports);
        return true;
      });
    }
    moduleLoaded(getExports());
    return true;
  }
  __name(loadDynamicLibrary, "loadDynamicLibrary");
  var reportUndefinedSymbols = /* @__PURE__ */ __name(() => {
    for (var [symName, entry] of Object.entries(GOT)) {
      if (entry.value == 0) {
        var value = resolveGlobalSymbol(symName, true).sym;
        if (!value && !entry.required) {
          continue;
        }
        if (typeof value == "function") {
          entry.value = addFunction(value, value.sig);
        } else if (typeof value == "number") {
          entry.value = value;
        } else {
          throw new Error(`bad export type for '${symName}': ${typeof value}`);
        }
      }
    }
  }, "reportUndefinedSymbols");
  var runDependencies = 0;
  var dependenciesFulfilled = null;
  var removeRunDependency = /* @__PURE__ */ __name((id) => {
    runDependencies--;
    Module["monitorRunDependencies"]?.(runDependencies);
    if (runDependencies == 0) {
      if (dependenciesFulfilled) {
        var callback = dependenciesFulfilled;
        dependenciesFulfilled = null;
        callback();
      }
    }
  }, "removeRunDependency");
  var addRunDependency = /* @__PURE__ */ __name((id) => {
    runDependencies++;
    Module["monitorRunDependencies"]?.(runDependencies);
  }, "addRunDependency");
  var loadDylibs = /* @__PURE__ */ __name(async () => {
    if (!dynamicLibraries.length) {
      reportUndefinedSymbols();
      return;
    }
    addRunDependency("loadDylibs");
    for (var lib of dynamicLibraries) {
      await loadDynamicLibrary(lib, {
        loadAsync: true,
        global: true,
        nodelete: true,
        allowUndefined: true
      });
    }
    reportUndefinedSymbols();
    removeRunDependency("loadDylibs");
  }, "loadDylibs");
  var noExitRuntime = true;
  function setValue(ptr, value, type = "i8") {
    if (type.endsWith("*")) type = "*";
    switch (type) {
      case "i1":
        HEAP8[ptr] = value;
        break;
      case "i8":
        HEAP8[ptr] = value;
        break;
      case "i16":
        LE_HEAP_STORE_I16((ptr >> 1) * 2, value);
        break;
      case "i32":
        LE_HEAP_STORE_I32((ptr >> 2) * 4, value);
        break;
      case "i64":
        LE_HEAP_STORE_I64((ptr >> 3) * 8, BigInt(value));
        break;
      case "float":
        LE_HEAP_STORE_F32((ptr >> 2) * 4, value);
        break;
      case "double":
        LE_HEAP_STORE_F64((ptr >> 3) * 8, value);
        break;
      case "*":
        LE_HEAP_STORE_U32((ptr >> 2) * 4, value);
        break;
      default:
        abort(`invalid type for setValue: ${type}`);
    }
  }
  __name(setValue, "setValue");
  var ___memory_base = new WebAssembly.Global({
    "value": "i32",
    "mutable": false
  }, 1024);
  var ___stack_high = 78240;
  var ___stack_low = 12704;
  var ___stack_pointer = new WebAssembly.Global({
    "value": "i32",
    "mutable": true
  }, 78240);
  var ___table_base = new WebAssembly.Global({
    "value": "i32",
    "mutable": false
  }, 1);
  var __abort_js = /* @__PURE__ */ __name(() => abort(""), "__abort_js");
  __abort_js.sig = "v";
  var getHeapMax = /* @__PURE__ */ __name(() => (
    // Stay one Wasm page short of 4GB: while e.g. Chrome is able to allocate
    // full 4GB Wasm memories, the size will wrap back to 0 bytes in Wasm side
    // for any code that deals with heap sizes, which would require special
    // casing all heap size related code to treat 0 specially.
    2147483648
  ), "getHeapMax");
  var growMemory = /* @__PURE__ */ __name((size) => {
    var oldHeapSize = wasmMemory.buffer.byteLength;
    var pages = (size - oldHeapSize + 65535) / 65536 | 0;
    try {
      wasmMemory.grow(pages);
      updateMemoryViews();
      return 1;
    } catch (e) {
    }
  }, "growMemory");
  var _emscripten_resize_heap = /* @__PURE__ */ __name((requestedSize) => {
    var oldSize = HEAPU8.length;
    requestedSize >>>= 0;
    var maxHeapSize = getHeapMax();
    if (requestedSize > maxHeapSize) {
      return false;
    }
    for (var cutDown = 1; cutDown <= 4; cutDown *= 2) {
      var overGrownHeapSize = oldSize * (1 + 0.2 / cutDown);
      overGrownHeapSize = Math.min(overGrownHeapSize, requestedSize + 100663296);
      var newSize = Math.min(maxHeapSize, alignMemory(Math.max(requestedSize, overGrownHeapSize), 65536));
      var replacement = growMemory(newSize);
      if (replacement) {
        return true;
      }
    }
    return false;
  }, "_emscripten_resize_heap");
  _emscripten_resize_heap.sig = "ip";
  var _fd_close = /* @__PURE__ */ __name((fd) => 52, "_fd_close");
  _fd_close.sig = "ii";
  var INT53_MAX = 9007199254740992;
  var INT53_MIN = -9007199254740992;
  var bigintToI53Checked = /* @__PURE__ */ __name((num2) => num2 < INT53_MIN || num2 > INT53_MAX ? NaN : Number(num2), "bigintToI53Checked");
  function _fd_seek(fd, offset, whence, newOffset) {
    offset = bigintToI53Checked(offset);
    return 70;
  }
  __name(_fd_seek, "_fd_seek");
  _fd_seek.sig = "iijip";
  var printCharBuffers = [null, [], []];
  var printChar = /* @__PURE__ */ __name((stream, curr) => {
    var buffer = printCharBuffers[stream];
    if (curr === 0 || curr === 10) {
      (stream === 1 ? out : err)(UTF8ArrayToString(buffer));
      buffer.length = 0;
    } else {
      buffer.push(curr);
    }
  }, "printChar");
  var _fd_write = /* @__PURE__ */ __name((fd, iov, iovcnt, pnum) => {
    var num2 = 0;
    for (var i2 = 0; i2 < iovcnt; i2++) {
      var ptr = LE_HEAP_LOAD_U32((iov >> 2) * 4);
      var len = LE_HEAP_LOAD_U32((iov + 4 >> 2) * 4);
      iov += 8;
      for (var j = 0; j < len; j++) {
        printChar(fd, HEAPU8[ptr + j]);
      }
      num2 += len;
    }
    LE_HEAP_STORE_U32((pnum >> 2) * 4, num2);
    return 0;
  }, "_fd_write");
  _fd_write.sig = "iippp";
  function _tree_sitter_log_callback(isLexMessage, messageAddress) {
    if (Module.currentLogCallback) {
      const message = UTF8ToString(messageAddress);
      Module.currentLogCallback(message, isLexMessage !== 0);
    }
  }
  __name(_tree_sitter_log_callback, "_tree_sitter_log_callback");
  function _tree_sitter_parse_callback(inputBufferAddress, index, row, column, lengthAddress) {
    const INPUT_BUFFER_SIZE = 10 * 1024;
    const string = Module.currentParseCallback(index, {
      row,
      column
    });
    if (typeof string === "string") {
      setValue(lengthAddress, string.length, "i32");
      stringToUTF16(string, inputBufferAddress, INPUT_BUFFER_SIZE);
    } else {
      setValue(lengthAddress, 0, "i32");
    }
  }
  __name(_tree_sitter_parse_callback, "_tree_sitter_parse_callback");
  function _tree_sitter_progress_callback(currentOffset, hasError) {
    if (Module.currentProgressCallback) {
      return Module.currentProgressCallback({
        currentOffset,
        hasError
      });
    }
    return false;
  }
  __name(_tree_sitter_progress_callback, "_tree_sitter_progress_callback");
  function _tree_sitter_query_progress_callback(currentOffset) {
    if (Module.currentQueryProgressCallback) {
      return Module.currentQueryProgressCallback({
        currentOffset
      });
    }
    return false;
  }
  __name(_tree_sitter_query_progress_callback, "_tree_sitter_query_progress_callback");
  var runtimeKeepaliveCounter = 0;
  var keepRuntimeAlive = /* @__PURE__ */ __name(() => noExitRuntime || runtimeKeepaliveCounter > 0, "keepRuntimeAlive");
  var _proc_exit = /* @__PURE__ */ __name((code) => {
    EXITSTATUS = code;
    if (!keepRuntimeAlive()) {
      Module["onExit"]?.(code);
      ABORT = true;
    }
    quit_(code, new ExitStatus(code));
  }, "_proc_exit");
  _proc_exit.sig = "vi";
  var exitJS = /* @__PURE__ */ __name((status, implicit) => {
    EXITSTATUS = status;
    _proc_exit(status);
  }, "exitJS");
  var handleException = /* @__PURE__ */ __name((e) => {
    if (e instanceof ExitStatus || e == "unwind") {
      return EXITSTATUS;
    }
    quit_(1, e);
  }, "handleException");
  var lengthBytesUTF8 = /* @__PURE__ */ __name((str22) => {
    var len = 0;
    for (var i2 = 0; i2 < str22.length; ++i2) {
      var c2 = str22.charCodeAt(i2);
      if (c2 <= 127) {
        len++;
      } else if (c2 <= 2047) {
        len += 2;
      } else if (c2 >= 55296 && c2 <= 57343) {
        len += 4;
        ++i2;
      } else {
        len += 3;
      }
    }
    return len;
  }, "lengthBytesUTF8");
  var stringToUTF8Array = /* @__PURE__ */ __name((str22, heap, outIdx, maxBytesToWrite) => {
    if (!(maxBytesToWrite > 0)) return 0;
    var startIdx = outIdx;
    var endIdx = outIdx + maxBytesToWrite - 1;
    for (var i2 = 0; i2 < str22.length; ++i2) {
      var u = str22.codePointAt(i2);
      if (u <= 127) {
        if (outIdx >= endIdx) break;
        heap[outIdx++] = u;
      } else if (u <= 2047) {
        if (outIdx + 1 >= endIdx) break;
        heap[outIdx++] = 192 | u >> 6;
        heap[outIdx++] = 128 | u & 63;
      } else if (u <= 65535) {
        if (outIdx + 2 >= endIdx) break;
        heap[outIdx++] = 224 | u >> 12;
        heap[outIdx++] = 128 | u >> 6 & 63;
        heap[outIdx++] = 128 | u & 63;
      } else {
        if (outIdx + 3 >= endIdx) break;
        heap[outIdx++] = 240 | u >> 18;
        heap[outIdx++] = 128 | u >> 12 & 63;
        heap[outIdx++] = 128 | u >> 6 & 63;
        heap[outIdx++] = 128 | u & 63;
        i2++;
      }
    }
    heap[outIdx] = 0;
    return outIdx - startIdx;
  }, "stringToUTF8Array");
  var stringToUTF8 = /* @__PURE__ */ __name((str22, outPtr, maxBytesToWrite) => stringToUTF8Array(str22, HEAPU8, outPtr, maxBytesToWrite), "stringToUTF8");
  var stackAlloc = /* @__PURE__ */ __name((sz) => __emscripten_stack_alloc(sz), "stackAlloc");
  var stringToUTF8OnStack = /* @__PURE__ */ __name((str22) => {
    var size = lengthBytesUTF8(str22) + 1;
    var ret = stackAlloc(size);
    stringToUTF8(str22, ret, size);
    return ret;
  }, "stringToUTF8OnStack");
  var AsciiToString = /* @__PURE__ */ __name((ptr) => {
    var str22 = "";
    while (1) {
      var ch = HEAPU8[ptr++];
      if (!ch) return str22;
      str22 += String.fromCharCode(ch);
    }
  }, "AsciiToString");
  var stringToUTF16 = /* @__PURE__ */ __name((str22, outPtr, maxBytesToWrite) => {
    maxBytesToWrite ??= 2147483647;
    if (maxBytesToWrite < 2) return 0;
    maxBytesToWrite -= 2;
    var startPtr = outPtr;
    var numCharsToWrite = maxBytesToWrite < str22.length * 2 ? maxBytesToWrite / 2 : str22.length;
    for (var i2 = 0; i2 < numCharsToWrite; ++i2) {
      var codeUnit = str22.charCodeAt(i2);
      LE_HEAP_STORE_I16((outPtr >> 1) * 2, codeUnit);
      outPtr += 2;
    }
    LE_HEAP_STORE_I16((outPtr >> 1) * 2, 0);
    return outPtr - startPtr;
  }, "stringToUTF16");
  LE_ATOMICS_NATIVE_BYTE_ORDER = new Int8Array(new Int16Array([1]).buffer)[0] === 1 ? [
    /* little endian */
    ((x) => x),
    ((x) => x),
    void 0,
    ((x) => x)
  ] : [
    /* big endian */
    ((x) => x),
    ((x) => ((x & 65280) << 8 | (x & 255) << 24) >> 16),
    void 0,
    ((x) => x >> 24 & 255 | x >> 8 & 65280 | (x & 65280) << 8 | (x & 255) << 24)
  ];
  function LE_HEAP_UPDATE() {
    HEAPU16.unsigned = ((x) => x & 65535);
    HEAPU32.unsigned = ((x) => x >>> 0);
  }
  __name(LE_HEAP_UPDATE, "LE_HEAP_UPDATE");
  {
    initMemory();
    if (Module["noExitRuntime"]) noExitRuntime = Module["noExitRuntime"];
    if (Module["print"]) out = Module["print"];
    if (Module["printErr"]) err = Module["printErr"];
    if (Module["dynamicLibraries"]) dynamicLibraries = Module["dynamicLibraries"];
    if (Module["wasmBinary"]) wasmBinary = Module["wasmBinary"];
    if (Module["arguments"]) arguments_ = Module["arguments"];
    if (Module["thisProgram"]) thisProgram = Module["thisProgram"];
    if (Module["preInit"]) {
      if (typeof Module["preInit"] == "function") Module["preInit"] = [Module["preInit"]];
      while (Module["preInit"].length > 0) {
        Module["preInit"].shift()();
      }
    }
  }
  Module["setValue"] = setValue;
  Module["getValue"] = getValue;
  Module["UTF8ToString"] = UTF8ToString;
  Module["stringToUTF8"] = stringToUTF8;
  Module["lengthBytesUTF8"] = lengthBytesUTF8;
  Module["AsciiToString"] = AsciiToString;
  Module["stringToUTF16"] = stringToUTF16;
  Module["loadWebAssemblyModule"] = loadWebAssemblyModule;
  Module["LE_HEAP_STORE_I64"] = LE_HEAP_STORE_I64;
  var ASM_CONSTS = {};
  var _malloc, _calloc, _realloc, _free, _ts_range_edit, _memcmp, _ts_language_symbol_count, _ts_language_state_count, _ts_language_abi_version, _ts_language_name, _ts_language_field_count, _ts_language_next_state, _ts_language_symbol_name, _ts_language_symbol_for_name, _strncmp, _ts_language_symbol_type, _ts_language_field_name_for_id, _ts_lookahead_iterator_new, _ts_lookahead_iterator_delete, _ts_lookahead_iterator_reset_state, _ts_lookahead_iterator_reset, _ts_lookahead_iterator_next, _ts_lookahead_iterator_current_symbol, _ts_point_edit, _ts_parser_delete, _ts_parser_reset, _ts_parser_set_language, _ts_parser_set_included_ranges, _ts_query_new, _ts_query_delete, _iswspace, _iswalnum, _ts_query_pattern_count, _ts_query_capture_count, _ts_query_string_count, _ts_query_capture_name_for_id, _ts_query_capture_quantifier_for_id, _ts_query_string_value_for_id, _ts_query_predicates_for_pattern, _ts_query_start_byte_for_pattern, _ts_query_end_byte_for_pattern, _ts_query_is_pattern_rooted, _ts_query_is_pattern_non_local, _ts_query_is_pattern_guaranteed_at_step, _ts_query_disable_capture, _ts_query_disable_pattern, _ts_tree_copy, _ts_tree_delete, _ts_init, _ts_parser_new_wasm, _ts_parser_enable_logger_wasm, _ts_parser_parse_wasm, _ts_parser_included_ranges_wasm, _ts_language_type_is_named_wasm, _ts_language_type_is_visible_wasm, _ts_language_metadata_wasm, _ts_language_supertypes_wasm, _ts_language_subtypes_wasm, _ts_tree_root_node_wasm, _ts_tree_root_node_with_offset_wasm, _ts_tree_edit_wasm, _ts_tree_included_ranges_wasm, _ts_tree_get_changed_ranges_wasm, _ts_tree_cursor_new_wasm, _ts_tree_cursor_copy_wasm, _ts_tree_cursor_delete_wasm, _ts_tree_cursor_reset_wasm, _ts_tree_cursor_reset_to_wasm, _ts_tree_cursor_goto_first_child_wasm, _ts_tree_cursor_goto_last_child_wasm, _ts_tree_cursor_goto_first_child_for_index_wasm, _ts_tree_cursor_goto_first_child_for_position_wasm, _ts_tree_cursor_goto_next_sibling_wasm, _ts_tree_cursor_goto_previous_sibling_wasm, _ts_tree_cursor_goto_descendant_wasm, _ts_tree_cursor_goto_parent_wasm, _ts_tree_cursor_current_node_type_id_wasm, _ts_tree_cursor_current_node_state_id_wasm, _ts_tree_cursor_current_node_is_named_wasm, _ts_tree_cursor_current_node_is_missing_wasm, _ts_tree_cursor_current_node_id_wasm, _ts_tree_cursor_start_position_wasm, _ts_tree_cursor_end_position_wasm, _ts_tree_cursor_start_index_wasm, _ts_tree_cursor_end_index_wasm, _ts_tree_cursor_current_field_id_wasm, _ts_tree_cursor_current_depth_wasm, _ts_tree_cursor_current_descendant_index_wasm, _ts_tree_cursor_current_node_wasm, _ts_node_symbol_wasm, _ts_node_field_name_for_child_wasm, _ts_node_field_name_for_named_child_wasm, _ts_node_children_by_field_id_wasm, _ts_node_first_child_for_byte_wasm, _ts_node_first_named_child_for_byte_wasm, _ts_node_grammar_symbol_wasm, _ts_node_child_count_wasm, _ts_node_named_child_count_wasm, _ts_node_child_wasm, _ts_node_named_child_wasm, _ts_node_child_by_field_id_wasm, _ts_node_next_sibling_wasm, _ts_node_prev_sibling_wasm, _ts_node_next_named_sibling_wasm, _ts_node_prev_named_sibling_wasm, _ts_node_descendant_count_wasm, _ts_node_parent_wasm, _ts_node_child_with_descendant_wasm, _ts_node_descendant_for_index_wasm, _ts_node_named_descendant_for_index_wasm, _ts_node_descendant_for_position_wasm, _ts_node_named_descendant_for_position_wasm, _ts_node_start_point_wasm, _ts_node_end_point_wasm, _ts_node_start_index_wasm, _ts_node_end_index_wasm, _ts_node_to_string_wasm, _ts_node_children_wasm, _ts_node_named_children_wasm, _ts_node_descendants_of_type_wasm, _ts_node_is_named_wasm, _ts_node_has_changes_wasm, _ts_node_has_error_wasm, _ts_node_is_error_wasm, _ts_node_is_missing_wasm, _ts_node_is_extra_wasm, _ts_node_parse_state_wasm, _ts_node_next_parse_state_wasm, _ts_query_matches_wasm, _ts_query_captures_wasm, _memset, _memcpy, _memmove, _iswalpha, _iswblank, _iswdigit, _iswlower, _iswupper, _iswxdigit, _memchr, _strlen, _strcmp, _strncat, _strncpy, _towlower, _towupper, _setThrew, __emscripten_stack_restore, __emscripten_stack_alloc, _emscripten_stack_get_current, ___wasm_apply_data_relocs;
  function assignWasmExports(wasmExports2) {
    Module["_malloc"] = _malloc = wasmExports2["malloc"];
    Module["_calloc"] = _calloc = wasmExports2["calloc"];
    Module["_realloc"] = _realloc = wasmExports2["realloc"];
    Module["_free"] = _free = wasmExports2["free"];
    Module["_ts_range_edit"] = _ts_range_edit = wasmExports2["ts_range_edit"];
    Module["_memcmp"] = _memcmp = wasmExports2["memcmp"];
    Module["_ts_language_symbol_count"] = _ts_language_symbol_count = wasmExports2["ts_language_symbol_count"];
    Module["_ts_language_state_count"] = _ts_language_state_count = wasmExports2["ts_language_state_count"];
    Module["_ts_language_abi_version"] = _ts_language_abi_version = wasmExports2["ts_language_abi_version"];
    Module["_ts_language_name"] = _ts_language_name = wasmExports2["ts_language_name"];
    Module["_ts_language_field_count"] = _ts_language_field_count = wasmExports2["ts_language_field_count"];
    Module["_ts_language_next_state"] = _ts_language_next_state = wasmExports2["ts_language_next_state"];
    Module["_ts_language_symbol_name"] = _ts_language_symbol_name = wasmExports2["ts_language_symbol_name"];
    Module["_ts_language_symbol_for_name"] = _ts_language_symbol_for_name = wasmExports2["ts_language_symbol_for_name"];
    Module["_strncmp"] = _strncmp = wasmExports2["strncmp"];
    Module["_ts_language_symbol_type"] = _ts_language_symbol_type = wasmExports2["ts_language_symbol_type"];
    Module["_ts_language_field_name_for_id"] = _ts_language_field_name_for_id = wasmExports2["ts_language_field_name_for_id"];
    Module["_ts_lookahead_iterator_new"] = _ts_lookahead_iterator_new = wasmExports2["ts_lookahead_iterator_new"];
    Module["_ts_lookahead_iterator_delete"] = _ts_lookahead_iterator_delete = wasmExports2["ts_lookahead_iterator_delete"];
    Module["_ts_lookahead_iterator_reset_state"] = _ts_lookahead_iterator_reset_state = wasmExports2["ts_lookahead_iterator_reset_state"];
    Module["_ts_lookahead_iterator_reset"] = _ts_lookahead_iterator_reset = wasmExports2["ts_lookahead_iterator_reset"];
    Module["_ts_lookahead_iterator_next"] = _ts_lookahead_iterator_next = wasmExports2["ts_lookahead_iterator_next"];
    Module["_ts_lookahead_iterator_current_symbol"] = _ts_lookahead_iterator_current_symbol = wasmExports2["ts_lookahead_iterator_current_symbol"];
    Module["_ts_point_edit"] = _ts_point_edit = wasmExports2["ts_point_edit"];
    Module["_ts_parser_delete"] = _ts_parser_delete = wasmExports2["ts_parser_delete"];
    Module["_ts_parser_reset"] = _ts_parser_reset = wasmExports2["ts_parser_reset"];
    Module["_ts_parser_set_language"] = _ts_parser_set_language = wasmExports2["ts_parser_set_language"];
    Module["_ts_parser_set_included_ranges"] = _ts_parser_set_included_ranges = wasmExports2["ts_parser_set_included_ranges"];
    Module["_ts_query_new"] = _ts_query_new = wasmExports2["ts_query_new"];
    Module["_ts_query_delete"] = _ts_query_delete = wasmExports2["ts_query_delete"];
    Module["_iswspace"] = _iswspace = wasmExports2["iswspace"];
    Module["_iswalnum"] = _iswalnum = wasmExports2["iswalnum"];
    Module["_ts_query_pattern_count"] = _ts_query_pattern_count = wasmExports2["ts_query_pattern_count"];
    Module["_ts_query_capture_count"] = _ts_query_capture_count = wasmExports2["ts_query_capture_count"];
    Module["_ts_query_string_count"] = _ts_query_string_count = wasmExports2["ts_query_string_count"];
    Module["_ts_query_capture_name_for_id"] = _ts_query_capture_name_for_id = wasmExports2["ts_query_capture_name_for_id"];
    Module["_ts_query_capture_quantifier_for_id"] = _ts_query_capture_quantifier_for_id = wasmExports2["ts_query_capture_quantifier_for_id"];
    Module["_ts_query_string_value_for_id"] = _ts_query_string_value_for_id = wasmExports2["ts_query_string_value_for_id"];
    Module["_ts_query_predicates_for_pattern"] = _ts_query_predicates_for_pattern = wasmExports2["ts_query_predicates_for_pattern"];
    Module["_ts_query_start_byte_for_pattern"] = _ts_query_start_byte_for_pattern = wasmExports2["ts_query_start_byte_for_pattern"];
    Module["_ts_query_end_byte_for_pattern"] = _ts_query_end_byte_for_pattern = wasmExports2["ts_query_end_byte_for_pattern"];
    Module["_ts_query_is_pattern_rooted"] = _ts_query_is_pattern_rooted = wasmExports2["ts_query_is_pattern_rooted"];
    Module["_ts_query_is_pattern_non_local"] = _ts_query_is_pattern_non_local = wasmExports2["ts_query_is_pattern_non_local"];
    Module["_ts_query_is_pattern_guaranteed_at_step"] = _ts_query_is_pattern_guaranteed_at_step = wasmExports2["ts_query_is_pattern_guaranteed_at_step"];
    Module["_ts_query_disable_capture"] = _ts_query_disable_capture = wasmExports2["ts_query_disable_capture"];
    Module["_ts_query_disable_pattern"] = _ts_query_disable_pattern = wasmExports2["ts_query_disable_pattern"];
    Module["_ts_tree_copy"] = _ts_tree_copy = wasmExports2["ts_tree_copy"];
    Module["_ts_tree_delete"] = _ts_tree_delete = wasmExports2["ts_tree_delete"];
    Module["_ts_init"] = _ts_init = wasmExports2["ts_init"];
    Module["_ts_parser_new_wasm"] = _ts_parser_new_wasm = wasmExports2["ts_parser_new_wasm"];
    Module["_ts_parser_enable_logger_wasm"] = _ts_parser_enable_logger_wasm = wasmExports2["ts_parser_enable_logger_wasm"];
    Module["_ts_parser_parse_wasm"] = _ts_parser_parse_wasm = wasmExports2["ts_parser_parse_wasm"];
    Module["_ts_parser_included_ranges_wasm"] = _ts_parser_included_ranges_wasm = wasmExports2["ts_parser_included_ranges_wasm"];
    Module["_ts_language_type_is_named_wasm"] = _ts_language_type_is_named_wasm = wasmExports2["ts_language_type_is_named_wasm"];
    Module["_ts_language_type_is_visible_wasm"] = _ts_language_type_is_visible_wasm = wasmExports2["ts_language_type_is_visible_wasm"];
    Module["_ts_language_metadata_wasm"] = _ts_language_metadata_wasm = wasmExports2["ts_language_metadata_wasm"];
    Module["_ts_language_supertypes_wasm"] = _ts_language_supertypes_wasm = wasmExports2["ts_language_supertypes_wasm"];
    Module["_ts_language_subtypes_wasm"] = _ts_language_subtypes_wasm = wasmExports2["ts_language_subtypes_wasm"];
    Module["_ts_tree_root_node_wasm"] = _ts_tree_root_node_wasm = wasmExports2["ts_tree_root_node_wasm"];
    Module["_ts_tree_root_node_with_offset_wasm"] = _ts_tree_root_node_with_offset_wasm = wasmExports2["ts_tree_root_node_with_offset_wasm"];
    Module["_ts_tree_edit_wasm"] = _ts_tree_edit_wasm = wasmExports2["ts_tree_edit_wasm"];
    Module["_ts_tree_included_ranges_wasm"] = _ts_tree_included_ranges_wasm = wasmExports2["ts_tree_included_ranges_wasm"];
    Module["_ts_tree_get_changed_ranges_wasm"] = _ts_tree_get_changed_ranges_wasm = wasmExports2["ts_tree_get_changed_ranges_wasm"];
    Module["_ts_tree_cursor_new_wasm"] = _ts_tree_cursor_new_wasm = wasmExports2["ts_tree_cursor_new_wasm"];
    Module["_ts_tree_cursor_copy_wasm"] = _ts_tree_cursor_copy_wasm = wasmExports2["ts_tree_cursor_copy_wasm"];
    Module["_ts_tree_cursor_delete_wasm"] = _ts_tree_cursor_delete_wasm = wasmExports2["ts_tree_cursor_delete_wasm"];
    Module["_ts_tree_cursor_reset_wasm"] = _ts_tree_cursor_reset_wasm = wasmExports2["ts_tree_cursor_reset_wasm"];
    Module["_ts_tree_cursor_reset_to_wasm"] = _ts_tree_cursor_reset_to_wasm = wasmExports2["ts_tree_cursor_reset_to_wasm"];
    Module["_ts_tree_cursor_goto_first_child_wasm"] = _ts_tree_cursor_goto_first_child_wasm = wasmExports2["ts_tree_cursor_goto_first_child_wasm"];
    Module["_ts_tree_cursor_goto_last_child_wasm"] = _ts_tree_cursor_goto_last_child_wasm = wasmExports2["ts_tree_cursor_goto_last_child_wasm"];
    Module["_ts_tree_cursor_goto_first_child_for_index_wasm"] = _ts_tree_cursor_goto_first_child_for_index_wasm = wasmExports2["ts_tree_cursor_goto_first_child_for_index_wasm"];
    Module["_ts_tree_cursor_goto_first_child_for_position_wasm"] = _ts_tree_cursor_goto_first_child_for_position_wasm = wasmExports2["ts_tree_cursor_goto_first_child_for_position_wasm"];
    Module["_ts_tree_cursor_goto_next_sibling_wasm"] = _ts_tree_cursor_goto_next_sibling_wasm = wasmExports2["ts_tree_cursor_goto_next_sibling_wasm"];
    Module["_ts_tree_cursor_goto_previous_sibling_wasm"] = _ts_tree_cursor_goto_previous_sibling_wasm = wasmExports2["ts_tree_cursor_goto_previous_sibling_wasm"];
    Module["_ts_tree_cursor_goto_descendant_wasm"] = _ts_tree_cursor_goto_descendant_wasm = wasmExports2["ts_tree_cursor_goto_descendant_wasm"];
    Module["_ts_tree_cursor_goto_parent_wasm"] = _ts_tree_cursor_goto_parent_wasm = wasmExports2["ts_tree_cursor_goto_parent_wasm"];
    Module["_ts_tree_cursor_current_node_type_id_wasm"] = _ts_tree_cursor_current_node_type_id_wasm = wasmExports2["ts_tree_cursor_current_node_type_id_wasm"];
    Module["_ts_tree_cursor_current_node_state_id_wasm"] = _ts_tree_cursor_current_node_state_id_wasm = wasmExports2["ts_tree_cursor_current_node_state_id_wasm"];
    Module["_ts_tree_cursor_current_node_is_named_wasm"] = _ts_tree_cursor_current_node_is_named_wasm = wasmExports2["ts_tree_cursor_current_node_is_named_wasm"];
    Module["_ts_tree_cursor_current_node_is_missing_wasm"] = _ts_tree_cursor_current_node_is_missing_wasm = wasmExports2["ts_tree_cursor_current_node_is_missing_wasm"];
    Module["_ts_tree_cursor_current_node_id_wasm"] = _ts_tree_cursor_current_node_id_wasm = wasmExports2["ts_tree_cursor_current_node_id_wasm"];
    Module["_ts_tree_cursor_start_position_wasm"] = _ts_tree_cursor_start_position_wasm = wasmExports2["ts_tree_cursor_start_position_wasm"];
    Module["_ts_tree_cursor_end_position_wasm"] = _ts_tree_cursor_end_position_wasm = wasmExports2["ts_tree_cursor_end_position_wasm"];
    Module["_ts_tree_cursor_start_index_wasm"] = _ts_tree_cursor_start_index_wasm = wasmExports2["ts_tree_cursor_start_index_wasm"];
    Module["_ts_tree_cursor_end_index_wasm"] = _ts_tree_cursor_end_index_wasm = wasmExports2["ts_tree_cursor_end_index_wasm"];
    Module["_ts_tree_cursor_current_field_id_wasm"] = _ts_tree_cursor_current_field_id_wasm = wasmExports2["ts_tree_cursor_current_field_id_wasm"];
    Module["_ts_tree_cursor_current_depth_wasm"] = _ts_tree_cursor_current_depth_wasm = wasmExports2["ts_tree_cursor_current_depth_wasm"];
    Module["_ts_tree_cursor_current_descendant_index_wasm"] = _ts_tree_cursor_current_descendant_index_wasm = wasmExports2["ts_tree_cursor_current_descendant_index_wasm"];
    Module["_ts_tree_cursor_current_node_wasm"] = _ts_tree_cursor_current_node_wasm = wasmExports2["ts_tree_cursor_current_node_wasm"];
    Module["_ts_node_symbol_wasm"] = _ts_node_symbol_wasm = wasmExports2["ts_node_symbol_wasm"];
    Module["_ts_node_field_name_for_child_wasm"] = _ts_node_field_name_for_child_wasm = wasmExports2["ts_node_field_name_for_child_wasm"];
    Module["_ts_node_field_name_for_named_child_wasm"] = _ts_node_field_name_for_named_child_wasm = wasmExports2["ts_node_field_name_for_named_child_wasm"];
    Module["_ts_node_children_by_field_id_wasm"] = _ts_node_children_by_field_id_wasm = wasmExports2["ts_node_children_by_field_id_wasm"];
    Module["_ts_node_first_child_for_byte_wasm"] = _ts_node_first_child_for_byte_wasm = wasmExports2["ts_node_first_child_for_byte_wasm"];
    Module["_ts_node_first_named_child_for_byte_wasm"] = _ts_node_first_named_child_for_byte_wasm = wasmExports2["ts_node_first_named_child_for_byte_wasm"];
    Module["_ts_node_grammar_symbol_wasm"] = _ts_node_grammar_symbol_wasm = wasmExports2["ts_node_grammar_symbol_wasm"];
    Module["_ts_node_child_count_wasm"] = _ts_node_child_count_wasm = wasmExports2["ts_node_child_count_wasm"];
    Module["_ts_node_named_child_count_wasm"] = _ts_node_named_child_count_wasm = wasmExports2["ts_node_named_child_count_wasm"];
    Module["_ts_node_child_wasm"] = _ts_node_child_wasm = wasmExports2["ts_node_child_wasm"];
    Module["_ts_node_named_child_wasm"] = _ts_node_named_child_wasm = wasmExports2["ts_node_named_child_wasm"];
    Module["_ts_node_child_by_field_id_wasm"] = _ts_node_child_by_field_id_wasm = wasmExports2["ts_node_child_by_field_id_wasm"];
    Module["_ts_node_next_sibling_wasm"] = _ts_node_next_sibling_wasm = wasmExports2["ts_node_next_sibling_wasm"];
    Module["_ts_node_prev_sibling_wasm"] = _ts_node_prev_sibling_wasm = wasmExports2["ts_node_prev_sibling_wasm"];
    Module["_ts_node_next_named_sibling_wasm"] = _ts_node_next_named_sibling_wasm = wasmExports2["ts_node_next_named_sibling_wasm"];
    Module["_ts_node_prev_named_sibling_wasm"] = _ts_node_prev_named_sibling_wasm = wasmExports2["ts_node_prev_named_sibling_wasm"];
    Module["_ts_node_descendant_count_wasm"] = _ts_node_descendant_count_wasm = wasmExports2["ts_node_descendant_count_wasm"];
    Module["_ts_node_parent_wasm"] = _ts_node_parent_wasm = wasmExports2["ts_node_parent_wasm"];
    Module["_ts_node_child_with_descendant_wasm"] = _ts_node_child_with_descendant_wasm = wasmExports2["ts_node_child_with_descendant_wasm"];
    Module["_ts_node_descendant_for_index_wasm"] = _ts_node_descendant_for_index_wasm = wasmExports2["ts_node_descendant_for_index_wasm"];
    Module["_ts_node_named_descendant_for_index_wasm"] = _ts_node_named_descendant_for_index_wasm = wasmExports2["ts_node_named_descendant_for_index_wasm"];
    Module["_ts_node_descendant_for_position_wasm"] = _ts_node_descendant_for_position_wasm = wasmExports2["ts_node_descendant_for_position_wasm"];
    Module["_ts_node_named_descendant_for_position_wasm"] = _ts_node_named_descendant_for_position_wasm = wasmExports2["ts_node_named_descendant_for_position_wasm"];
    Module["_ts_node_start_point_wasm"] = _ts_node_start_point_wasm = wasmExports2["ts_node_start_point_wasm"];
    Module["_ts_node_end_point_wasm"] = _ts_node_end_point_wasm = wasmExports2["ts_node_end_point_wasm"];
    Module["_ts_node_start_index_wasm"] = _ts_node_start_index_wasm = wasmExports2["ts_node_start_index_wasm"];
    Module["_ts_node_end_index_wasm"] = _ts_node_end_index_wasm = wasmExports2["ts_node_end_index_wasm"];
    Module["_ts_node_to_string_wasm"] = _ts_node_to_string_wasm = wasmExports2["ts_node_to_string_wasm"];
    Module["_ts_node_children_wasm"] = _ts_node_children_wasm = wasmExports2["ts_node_children_wasm"];
    Module["_ts_node_named_children_wasm"] = _ts_node_named_children_wasm = wasmExports2["ts_node_named_children_wasm"];
    Module["_ts_node_descendants_of_type_wasm"] = _ts_node_descendants_of_type_wasm = wasmExports2["ts_node_descendants_of_type_wasm"];
    Module["_ts_node_is_named_wasm"] = _ts_node_is_named_wasm = wasmExports2["ts_node_is_named_wasm"];
    Module["_ts_node_has_changes_wasm"] = _ts_node_has_changes_wasm = wasmExports2["ts_node_has_changes_wasm"];
    Module["_ts_node_has_error_wasm"] = _ts_node_has_error_wasm = wasmExports2["ts_node_has_error_wasm"];
    Module["_ts_node_is_error_wasm"] = _ts_node_is_error_wasm = wasmExports2["ts_node_is_error_wasm"];
    Module["_ts_node_is_missing_wasm"] = _ts_node_is_missing_wasm = wasmExports2["ts_node_is_missing_wasm"];
    Module["_ts_node_is_extra_wasm"] = _ts_node_is_extra_wasm = wasmExports2["ts_node_is_extra_wasm"];
    Module["_ts_node_parse_state_wasm"] = _ts_node_parse_state_wasm = wasmExports2["ts_node_parse_state_wasm"];
    Module["_ts_node_next_parse_state_wasm"] = _ts_node_next_parse_state_wasm = wasmExports2["ts_node_next_parse_state_wasm"];
    Module["_ts_query_matches_wasm"] = _ts_query_matches_wasm = wasmExports2["ts_query_matches_wasm"];
    Module["_ts_query_captures_wasm"] = _ts_query_captures_wasm = wasmExports2["ts_query_captures_wasm"];
    Module["_memset"] = _memset = wasmExports2["memset"];
    Module["_memcpy"] = _memcpy = wasmExports2["memcpy"];
    Module["_memmove"] = _memmove = wasmExports2["memmove"];
    Module["_iswalpha"] = _iswalpha = wasmExports2["iswalpha"];
    Module["_iswblank"] = _iswblank = wasmExports2["iswblank"];
    Module["_iswdigit"] = _iswdigit = wasmExports2["iswdigit"];
    Module["_iswlower"] = _iswlower = wasmExports2["iswlower"];
    Module["_iswupper"] = _iswupper = wasmExports2["iswupper"];
    Module["_iswxdigit"] = _iswxdigit = wasmExports2["iswxdigit"];
    Module["_memchr"] = _memchr = wasmExports2["memchr"];
    Module["_strlen"] = _strlen = wasmExports2["strlen"];
    Module["_strcmp"] = _strcmp = wasmExports2["strcmp"];
    Module["_strncat"] = _strncat = wasmExports2["strncat"];
    Module["_strncpy"] = _strncpy = wasmExports2["strncpy"];
    Module["_towlower"] = _towlower = wasmExports2["towlower"];
    Module["_towupper"] = _towupper = wasmExports2["towupper"];
    _setThrew = wasmExports2["setThrew"];
    __emscripten_stack_restore = wasmExports2["_emscripten_stack_restore"];
    __emscripten_stack_alloc = wasmExports2["_emscripten_stack_alloc"];
    _emscripten_stack_get_current = wasmExports2["emscripten_stack_get_current"];
    ___wasm_apply_data_relocs = wasmExports2["__wasm_apply_data_relocs"];
  }
  __name(assignWasmExports, "assignWasmExports");
  var wasmImports = {
    /** @export */
    __heap_base: ___heap_base,
    /** @export */
    __indirect_function_table: wasmTable,
    /** @export */
    __memory_base: ___memory_base,
    /** @export */
    __stack_high: ___stack_high,
    /** @export */
    __stack_low: ___stack_low,
    /** @export */
    __stack_pointer: ___stack_pointer,
    /** @export */
    __table_base: ___table_base,
    /** @export */
    _abort_js: __abort_js,
    /** @export */
    emscripten_resize_heap: _emscripten_resize_heap,
    /** @export */
    fd_close: _fd_close,
    /** @export */
    fd_seek: _fd_seek,
    /** @export */
    fd_write: _fd_write,
    /** @export */
    memory: wasmMemory,
    /** @export */
    tree_sitter_log_callback: _tree_sitter_log_callback,
    /** @export */
    tree_sitter_parse_callback: _tree_sitter_parse_callback,
    /** @export */
    tree_sitter_progress_callback: _tree_sitter_progress_callback,
    /** @export */
    tree_sitter_query_progress_callback: _tree_sitter_query_progress_callback
  };
  function callMain(args2 = []) {
    var entryFunction = resolveGlobalSymbol("main").sym;
    if (!entryFunction) return;
    args2.unshift(thisProgram);
    var argc = args2.length;
    var argv = stackAlloc((argc + 1) * 4);
    var argv_ptr = argv;
    args2.forEach((arg) => {
      LE_HEAP_STORE_U32((argv_ptr >> 2) * 4, stringToUTF8OnStack(arg));
      argv_ptr += 4;
    });
    LE_HEAP_STORE_U32((argv_ptr >> 2) * 4, 0);
    try {
      var ret = entryFunction(argc, argv);
      exitJS(
        ret,
        /* implicit = */
        true
      );
      return ret;
    } catch (e) {
      return handleException(e);
    }
  }
  __name(callMain, "callMain");
  function run(args2 = arguments_) {
    if (runDependencies > 0) {
      dependenciesFulfilled = run;
      return;
    }
    preRun();
    if (runDependencies > 0) {
      dependenciesFulfilled = run;
      return;
    }
    function doRun() {
      Module["calledRun"] = true;
      if (ABORT) return;
      initRuntime();
      preMain();
      readyPromiseResolve?.(Module);
      Module["onRuntimeInitialized"]?.();
      var noInitialRun = Module["noInitialRun"] || false;
      if (!noInitialRun) callMain(args2);
      postRun();
    }
    __name(doRun, "doRun");
    if (Module["setStatus"]) {
      Module["setStatus"]("Running...");
      setTimeout(() => {
        setTimeout(() => Module["setStatus"](""), 1);
        doRun();
      }, 1);
    } else {
      doRun();
    }
  }
  __name(run, "run");
  var wasmExports;
  wasmExports = await createWasm();
  run();
  if (runtimeInitialized) {
    moduleRtn = Module;
  } else {
    moduleRtn = new Promise((resolve22, reject) => {
      readyPromiseResolve = resolve22;
      readyPromiseReject = reject;
    });
  }
  return moduleRtn;
}
async function initializeBinding(moduleOptions) {
  return Module3 ??= await web_tree_sitter_default(moduleOptions);
}
function checkModule() {
  return !!Module3;
}
function parseAnyPredicate(steps, index, operator, textPredicates) {
  if (steps.length !== 3) {
    throw new Error(
      `Wrong number of arguments to \`#${operator}\` predicate. Expected 2, got ${steps.length - 1}`
    );
  }
  if (!isCaptureStep(steps[1])) {
    throw new Error(
      `First argument of \`#${operator}\` predicate must be a capture. Got "${steps[1].value}"`
    );
  }
  const isPositive = operator === "eq?" || operator === "any-eq?";
  const matchAll = !operator.startsWith("any-");
  if (isCaptureStep(steps[2])) {
    const captureName1 = steps[1].name;
    const captureName2 = steps[2].name;
    textPredicates[index].push((captures) => {
      const nodes1 = [];
      const nodes2 = [];
      for (const c2 of captures) {
        if (c2.name === captureName1) nodes1.push(c2.node);
        if (c2.name === captureName2) nodes2.push(c2.node);
      }
      const compare = /* @__PURE__ */ __name((n1, n2, positive) => {
        return positive ? n1.text === n2.text : n1.text !== n2.text;
      }, "compare");
      return matchAll ? nodes1.every((n1) => nodes2.some((n2) => compare(n1, n2, isPositive))) : nodes1.some((n1) => nodes2.some((n2) => compare(n1, n2, isPositive)));
    });
  } else {
    const captureName = steps[1].name;
    const stringValue = steps[2].value;
    const matches = /* @__PURE__ */ __name((n) => n.text === stringValue, "matches");
    const doesNotMatch = /* @__PURE__ */ __name((n) => n.text !== stringValue, "doesNotMatch");
    textPredicates[index].push((captures) => {
      const nodes = [];
      for (const c2 of captures) {
        if (c2.name === captureName) nodes.push(c2.node);
      }
      const test = isPositive ? matches : doesNotMatch;
      return matchAll ? nodes.every(test) : nodes.some(test);
    });
  }
}
function parseMatchPredicate(steps, index, operator, textPredicates) {
  if (steps.length !== 3) {
    throw new Error(
      `Wrong number of arguments to \`#${operator}\` predicate. Expected 2, got ${steps.length - 1}.`
    );
  }
  if (steps[1].type !== "capture") {
    throw new Error(
      `First argument of \`#${operator}\` predicate must be a capture. Got "${steps[1].value}".`
    );
  }
  if (steps[2].type !== "string") {
    throw new Error(
      `Second argument of \`#${operator}\` predicate must be a string. Got @${steps[2].name}.`
    );
  }
  const isPositive = operator === "match?" || operator === "any-match?";
  const matchAll = !operator.startsWith("any-");
  const captureName = steps[1].name;
  const regex = new RegExp(steps[2].value);
  textPredicates[index].push((captures) => {
    const nodes = [];
    for (const c2 of captures) {
      if (c2.name === captureName) nodes.push(c2.node.text);
    }
    const test = /* @__PURE__ */ __name((text, positive) => {
      return positive ? regex.test(text) : !regex.test(text);
    }, "test");
    if (nodes.length === 0) return !isPositive;
    return matchAll ? nodes.every((text) => test(text, isPositive)) : nodes.some((text) => test(text, isPositive));
  });
}
function parseAnyOfPredicate(steps, index, operator, textPredicates) {
  if (steps.length < 2) {
    throw new Error(
      `Wrong number of arguments to \`#${operator}\` predicate. Expected at least 1. Got ${steps.length - 1}.`
    );
  }
  if (steps[1].type !== "capture") {
    throw new Error(
      `First argument of \`#${operator}\` predicate must be a capture. Got "${steps[1].value}".`
    );
  }
  const isPositive = operator === "any-of?";
  const captureName = steps[1].name;
  const stringSteps = steps.slice(2);
  if (!stringSteps.every(isStringStep)) {
    throw new Error(
      `Arguments to \`#${operator}\` predicate must be strings.".`
    );
  }
  const values = stringSteps.map((s) => s.value);
  textPredicates[index].push((captures) => {
    const nodes = [];
    for (const c2 of captures) {
      if (c2.name === captureName) nodes.push(c2.node.text);
    }
    if (nodes.length === 0) return !isPositive;
    return nodes.every((text) => values.includes(text)) === isPositive;
  });
}
function parseIsPredicate(steps, index, operator, assertedProperties, refutedProperties) {
  if (steps.length < 2 || steps.length > 3) {
    throw new Error(
      `Wrong number of arguments to \`#${operator}\` predicate. Expected 1 or 2. Got ${steps.length - 1}.`
    );
  }
  if (!steps.every(isStringStep)) {
    throw new Error(
      `Arguments to \`#${operator}\` predicate must be strings.".`
    );
  }
  const properties = operator === "is?" ? assertedProperties : refutedProperties;
  if (!properties[index]) properties[index] = {};
  properties[index][steps[1].value] = steps[2]?.value ?? null;
}
function parseSetDirective(steps, index, setProperties) {
  if (steps.length < 2 || steps.length > 3) {
    throw new Error(`Wrong number of arguments to \`#set!\` predicate. Expected 1 or 2. Got ${steps.length - 1}.`);
  }
  if (!steps.every(isStringStep)) {
    throw new Error(`Arguments to \`#set!\` predicate must be strings.".`);
  }
  if (!setProperties[index]) setProperties[index] = {};
  setProperties[index][steps[1].value] = steps[2]?.value ?? null;
}
function parsePattern(index, stepType, stepValueId, captureNames, stringValues, steps, textPredicates, predicates, setProperties, assertedProperties, refutedProperties) {
  if (stepType === PREDICATE_STEP_TYPE_CAPTURE) {
    const name2 = captureNames[stepValueId];
    steps.push({ type: "capture", name: name2 });
  } else if (stepType === PREDICATE_STEP_TYPE_STRING) {
    steps.push({ type: "string", value: stringValues[stepValueId] });
  } else if (steps.length > 0) {
    if (steps[0].type !== "string") {
      throw new Error("Predicates must begin with a literal value");
    }
    const operator = steps[0].value;
    switch (operator) {
      case "any-not-eq?":
      case "not-eq?":
      case "any-eq?":
      case "eq?":
        parseAnyPredicate(steps, index, operator, textPredicates);
        break;
      case "any-not-match?":
      case "not-match?":
      case "any-match?":
      case "match?":
        parseMatchPredicate(steps, index, operator, textPredicates);
        break;
      case "not-any-of?":
      case "any-of?":
        parseAnyOfPredicate(steps, index, operator, textPredicates);
        break;
      case "is?":
      case "is-not?":
        parseIsPredicate(steps, index, operator, assertedProperties, refutedProperties);
        break;
      case "set!":
        parseSetDirective(steps, index, setProperties);
        break;
      default:
        predicates[index].push({ operator, operands: steps.slice(1) });
    }
    steps.length = 0;
  }
}
var __defProp2;
var __name;
var Edit;
var SIZE_OF_SHORT;
var SIZE_OF_INT;
var SIZE_OF_CURSOR;
var SIZE_OF_NODE;
var SIZE_OF_POINT;
var SIZE_OF_RANGE;
var ZERO_POINT;
var INTERNAL;
var C;
var LookaheadIterator;
var Tree;
var TreeCursor;
var Node;
var LANGUAGE_FUNCTION_REGEX;
var Language;
var web_tree_sitter_default;
var Module3;
var TRANSFER_BUFFER;
var LANGUAGE_VERSION;
var MIN_COMPATIBLE_VERSION;
var Parser;
var PREDICATE_STEP_TYPE_CAPTURE;
var PREDICATE_STEP_TYPE_STRING;
var QUERY_WORD_REGEX;
var CaptureQuantifier;
var isCaptureStep;
var isStringStep;
var QueryErrorKind;
var QueryError;
var Query;
var init_web_tree_sitter = __esm({
  "node_modules/.pnpm/web-tree-sitter@0.26.11/node_modules/web-tree-sitter/web-tree-sitter.js"() {
    "use strict";
    __defProp2 = Object.defineProperty;
    __name = (target, value) => __defProp2(target, "name", { value, configurable: true });
    Edit = class {
      static {
        __name(this, "Edit");
      }
      /** The start position of the change. */
      startPosition;
      /** The end position of the change before the edit. */
      oldEndPosition;
      /** The end position of the change after the edit. */
      newEndPosition;
      /** The start index of the change. */
      startIndex;
      /** The end index of the change before the edit. */
      oldEndIndex;
      /** The end index of the change after the edit. */
      newEndIndex;
      constructor({
        startIndex,
        oldEndIndex,
        newEndIndex,
        startPosition,
        oldEndPosition,
        newEndPosition
      }) {
        this.startIndex = startIndex >>> 0;
        this.oldEndIndex = oldEndIndex >>> 0;
        this.newEndIndex = newEndIndex >>> 0;
        this.startPosition = startPosition;
        this.oldEndPosition = oldEndPosition;
        this.newEndPosition = newEndPosition;
      }
      /**
       * Edit a point and index to keep it in-sync with source code that has been edited.
       *
       * This function updates a single point's byte offset and row/column position
       * based on an edit operation. This is useful for editing points without
       * requiring a tree or node instance.
       */
      editPoint(point, index) {
        let newIndex = index;
        const newPoint = { ...point };
        if (index >= this.oldEndIndex) {
          newIndex = this.newEndIndex + (index - this.oldEndIndex);
          const originalRow = point.row;
          newPoint.row = this.newEndPosition.row + (point.row - this.oldEndPosition.row);
          newPoint.column = originalRow === this.oldEndPosition.row ? this.newEndPosition.column + (point.column - this.oldEndPosition.column) : point.column;
        } else if (index > this.startIndex) {
          newIndex = this.newEndIndex;
          newPoint.row = this.newEndPosition.row;
          newPoint.column = this.newEndPosition.column;
        }
        return { point: newPoint, index: newIndex };
      }
      /**
       * Edit a range to keep it in-sync with source code that has been edited.
       *
       * This function updates a range's start and end positions based on an edit
       * operation. This is useful for editing ranges without requiring a tree
       * or node instance.
       */
      editRange(range) {
        const newRange = {
          startIndex: range.startIndex,
          startPosition: { ...range.startPosition },
          endIndex: range.endIndex,
          endPosition: { ...range.endPosition }
        };
        if (range.endIndex >= this.oldEndIndex) {
          if (range.endIndex !== Number.MAX_SAFE_INTEGER) {
            newRange.endIndex = this.newEndIndex + (range.endIndex - this.oldEndIndex);
            newRange.endPosition = {
              row: this.newEndPosition.row + (range.endPosition.row - this.oldEndPosition.row),
              column: range.endPosition.row === this.oldEndPosition.row ? this.newEndPosition.column + (range.endPosition.column - this.oldEndPosition.column) : range.endPosition.column
            };
            if (newRange.endIndex < this.newEndIndex) {
              newRange.endIndex = Number.MAX_SAFE_INTEGER;
              newRange.endPosition = { row: Number.MAX_SAFE_INTEGER, column: Number.MAX_SAFE_INTEGER };
            }
          }
        } else if (range.endIndex > this.startIndex) {
          newRange.endIndex = this.startIndex;
          newRange.endPosition = { ...this.startPosition };
        }
        if (range.startIndex >= this.oldEndIndex) {
          newRange.startIndex = this.newEndIndex + (range.startIndex - this.oldEndIndex);
          newRange.startPosition = {
            row: this.newEndPosition.row + (range.startPosition.row - this.oldEndPosition.row),
            column: range.startPosition.row === this.oldEndPosition.row ? this.newEndPosition.column + (range.startPosition.column - this.oldEndPosition.column) : range.startPosition.column
          };
          if (newRange.startIndex < this.newEndIndex) {
            newRange.startIndex = Number.MAX_SAFE_INTEGER;
            newRange.startPosition = { row: Number.MAX_SAFE_INTEGER, column: Number.MAX_SAFE_INTEGER };
          }
        } else if (range.startIndex > this.startIndex) {
          newRange.startIndex = this.startIndex;
          newRange.startPosition = { ...this.startPosition };
        }
        return newRange;
      }
    };
    SIZE_OF_SHORT = 2;
    SIZE_OF_INT = 4;
    SIZE_OF_CURSOR = 4 * SIZE_OF_INT;
    SIZE_OF_NODE = 5 * SIZE_OF_INT;
    SIZE_OF_POINT = 2 * SIZE_OF_INT;
    SIZE_OF_RANGE = 2 * SIZE_OF_INT + 2 * SIZE_OF_POINT;
    ZERO_POINT = { row: 0, column: 0 };
    INTERNAL = /* @__PURE__ */ Symbol("INTERNAL");
    __name(assertInternal, "assertInternal");
    __name(isPoint, "isPoint");
    __name(setModule, "setModule");
    LookaheadIterator = class {
      static {
        __name(this, "LookaheadIterator");
      }
      /** @internal */
      [0] = 0;
      // Internal handle for Wasm
      /** @internal */
      language;
      /** @internal */
      constructor(internal, address, language) {
        assertInternal(internal);
        this[0] = address;
        this.language = language;
      }
      /** Get the current symbol of the lookahead iterator. */
      get currentTypeId() {
        return C._ts_lookahead_iterator_current_symbol(this[0]);
      }
      /** Get the current symbol name of the lookahead iterator. */
      get currentType() {
        return this.language.types[this.currentTypeId] || "ERROR";
      }
      /** Delete the lookahead iterator, freeing its resources. */
      delete() {
        C._ts_lookahead_iterator_delete(this[0]);
        this[0] = 0;
      }
      /**
       * Reset the lookahead iterator.
       *
       * This returns `true` if the language was set successfully and `false`
       * otherwise.
       */
      reset(language, stateId) {
        if (C._ts_lookahead_iterator_reset(this[0], language[0], stateId)) {
          this.language = language;
          return true;
        }
        return false;
      }
      /**
       * Reset the lookahead iterator to another state.
       *
       * This returns `true` if the iterator was reset to the given state and
       * `false` otherwise.
       */
      resetState(stateId) {
        return Boolean(C._ts_lookahead_iterator_reset_state(this[0], stateId));
      }
      /**
       * Returns an iterator that iterates over the symbols of the lookahead iterator.
       *
       * The iterator will yield the current symbol name as a string for each step
       * until there are no more symbols to iterate over.
       */
      [Symbol.iterator]() {
        return {
          next: /* @__PURE__ */ __name(() => {
            if (C._ts_lookahead_iterator_next(this[0])) {
              return { done: false, value: this.currentType };
            }
            return { done: true, value: "" };
          }, "next")
        };
      }
    };
    __name(getText, "getText");
    Tree = class _Tree {
      static {
        __name(this, "Tree");
      }
      /** @internal */
      [0] = 0;
      // Internal handle for Wasm
      /** @internal */
      textCallback;
      /** The language that was used to parse the syntax tree. */
      language;
      /** @internal */
      constructor(internal, address, language, textCallback) {
        assertInternal(internal);
        this[0] = address;
        this.language = language;
        this.textCallback = textCallback;
      }
      /** Create a shallow copy of the syntax tree. This is very fast. */
      copy() {
        const address = C._ts_tree_copy(this[0]);
        return new _Tree(INTERNAL, address, this.language, this.textCallback);
      }
      /** Delete the syntax tree, freeing its resources. */
      delete() {
        C._ts_tree_delete(this[0]);
        this[0] = 0;
      }
      /** Get the root node of the syntax tree. */
      get rootNode() {
        C._ts_tree_root_node_wasm(this[0]);
        return unmarshalNode(this);
      }
      /**
       * Get the root node of the syntax tree, but with its position shifted
       * forward by the given offset.
       */
      rootNodeWithOffset(offsetBytes, offsetExtent) {
        const address = TRANSFER_BUFFER + SIZE_OF_NODE;
        C.setValue(address, offsetBytes, "i32");
        marshalPoint(address + SIZE_OF_INT, offsetExtent);
        C._ts_tree_root_node_with_offset_wasm(this[0]);
        return unmarshalNode(this);
      }
      /**
       * Edit the syntax tree to keep it in sync with source code that has been
       * edited.
       *
       * You must describe the edit both in terms of byte offsets and in terms of
       * row/column coordinates.
       */
      edit(edit) {
        marshalEdit(edit);
        C._ts_tree_edit_wasm(this[0]);
      }
      /** Create a new {@link TreeCursor} starting from the root of the tree. */
      walk() {
        return this.rootNode.walk();
      }
      /**
       * Compare this old edited syntax tree to a new syntax tree representing
       * the same document, returning a sequence of ranges whose syntactic
       * structure has changed.
       *
       * For this to work correctly, this syntax tree must have been edited such
       * that its ranges match up to the new tree. Generally, you'll want to
       * call this method right after calling one of the [`Parser::parse`]
       * functions. Call it on the old tree that was passed to parse, and
       * pass the new tree that was returned from `parse`.
       */
      getChangedRanges(other) {
        if (!(other instanceof _Tree)) {
          throw new TypeError("Argument must be a Tree");
        }
        C._ts_tree_get_changed_ranges_wasm(this[0], other[0]);
        const count = C.getValue(TRANSFER_BUFFER, "i32");
        const buffer = C.getValue(TRANSFER_BUFFER + SIZE_OF_INT, "i32");
        const result = new Array(count);
        if (count > 0) {
          let address = buffer;
          for (let i2 = 0; i2 < count; i2++) {
            result[i2] = unmarshalRange(address);
            address += SIZE_OF_RANGE;
          }
          C._free(buffer);
        }
        return result;
      }
      /** Get the included ranges that were used to parse the syntax tree. */
      getIncludedRanges() {
        C._ts_tree_included_ranges_wasm(this[0]);
        const count = C.getValue(TRANSFER_BUFFER, "i32");
        const buffer = C.getValue(TRANSFER_BUFFER + SIZE_OF_INT, "i32");
        const result = new Array(count);
        if (count > 0) {
          let address = buffer;
          for (let i2 = 0; i2 < count; i2++) {
            result[i2] = unmarshalRange(address);
            address += SIZE_OF_RANGE;
          }
          C._free(buffer);
        }
        return result;
      }
    };
    TreeCursor = class _TreeCursor {
      static {
        __name(this, "TreeCursor");
      }
      /** @internal */
      // @ts-expect-error: never read
      [0] = 0;
      // Internal handle for Wasm
      /** @internal */
      // @ts-expect-error: never read
      [1] = 0;
      // Internal handle for Wasm
      /** @internal */
      // @ts-expect-error: never read
      [2] = 0;
      // Internal handle for Wasm
      /** @internal */
      // @ts-expect-error: never read
      [3] = 0;
      // Internal handle for Wasm
      /** @internal */
      tree;
      /** @internal */
      constructor(internal, tree) {
        assertInternal(internal);
        this.tree = tree;
        unmarshalTreeCursor(this);
      }
      /** Creates a deep copy of the tree cursor. This allocates new memory. */
      copy() {
        const copy = new _TreeCursor(INTERNAL, this.tree);
        C._ts_tree_cursor_copy_wasm(this.tree[0]);
        unmarshalTreeCursor(copy);
        return copy;
      }
      /** Delete the tree cursor, freeing its resources. */
      delete() {
        marshalTreeCursor(this);
        C._ts_tree_cursor_delete_wasm(this.tree[0]);
        this[0] = this[1] = this[2] = 0;
      }
      /** Get the tree cursor's current {@link Node}. */
      get currentNode() {
        marshalTreeCursor(this);
        C._ts_tree_cursor_current_node_wasm(this.tree[0]);
        return unmarshalNode(this.tree);
      }
      /**
       * Get the numerical field id of this tree cursor's current node.
       *
       * See also {@link TreeCursor#currentFieldName}.
       */
      get currentFieldId() {
        marshalTreeCursor(this);
        return C._ts_tree_cursor_current_field_id_wasm(this.tree[0]);
      }
      /** Get the field name of this tree cursor's current node. */
      get currentFieldName() {
        return this.tree.language.fields[this.currentFieldId];
      }
      /**
       * Get the depth of the cursor's current node relative to the original
       * node that the cursor was constructed with.
       */
      get currentDepth() {
        marshalTreeCursor(this);
        return C._ts_tree_cursor_current_depth_wasm(this.tree[0]);
      }
      /**
       * Get the index of the cursor's current node out of all of the
       * descendants of the original node that the cursor was constructed with.
       */
      get currentDescendantIndex() {
        marshalTreeCursor(this);
        return C._ts_tree_cursor_current_descendant_index_wasm(this.tree[0]);
      }
      /** Get the type of the cursor's current node. */
      get nodeType() {
        return this.tree.language.types[this.nodeTypeId] || "ERROR";
      }
      /** Get the type id of the cursor's current node. */
      get nodeTypeId() {
        marshalTreeCursor(this);
        return C._ts_tree_cursor_current_node_type_id_wasm(this.tree[0]);
      }
      /** Get the state id of the cursor's current node. */
      get nodeStateId() {
        marshalTreeCursor(this);
        return C._ts_tree_cursor_current_node_state_id_wasm(this.tree[0]);
      }
      /** Get the id of the cursor's current node. */
      get nodeId() {
        marshalTreeCursor(this);
        return C._ts_tree_cursor_current_node_id_wasm(this.tree[0]);
      }
      /**
       * Check if the cursor's current node is *named*.
       *
       * Named nodes correspond to named rules in the grammar, whereas
       * *anonymous* nodes correspond to string literals in the grammar.
       */
      get nodeIsNamed() {
        marshalTreeCursor(this);
        return C._ts_tree_cursor_current_node_is_named_wasm(this.tree[0]) === 1;
      }
      /**
       * Check if the cursor's current node is *missing*.
       *
       * Missing nodes are inserted by the parser in order to recover from
       * certain kinds of syntax errors.
       */
      get nodeIsMissing() {
        marshalTreeCursor(this);
        return C._ts_tree_cursor_current_node_is_missing_wasm(this.tree[0]) === 1;
      }
      /** Get the string content of the cursor's current node. */
      get nodeText() {
        marshalTreeCursor(this);
        const startIndex = C._ts_tree_cursor_start_index_wasm(this.tree[0]);
        const endIndex = C._ts_tree_cursor_end_index_wasm(this.tree[0]);
        C._ts_tree_cursor_start_position_wasm(this.tree[0]);
        const startPosition = unmarshalPoint(TRANSFER_BUFFER);
        return getText(this.tree, startIndex, endIndex, startPosition);
      }
      /** Get the start position of the cursor's current node. */
      get startPosition() {
        marshalTreeCursor(this);
        C._ts_tree_cursor_start_position_wasm(this.tree[0]);
        return unmarshalPoint(TRANSFER_BUFFER);
      }
      /** Get the end position of the cursor's current node. */
      get endPosition() {
        marshalTreeCursor(this);
        C._ts_tree_cursor_end_position_wasm(this.tree[0]);
        return unmarshalPoint(TRANSFER_BUFFER);
      }
      /** Get the start index of the cursor's current node. */
      get startIndex() {
        marshalTreeCursor(this);
        return C._ts_tree_cursor_start_index_wasm(this.tree[0]);
      }
      /** Get the end index of the cursor's current node. */
      get endIndex() {
        marshalTreeCursor(this);
        return C._ts_tree_cursor_end_index_wasm(this.tree[0]);
      }
      /**
       * Move this cursor to the first child of its current node.
       *
       * This returns `true` if the cursor successfully moved, and returns
       * `false` if there were no children.
       */
      gotoFirstChild() {
        marshalTreeCursor(this);
        const result = C._ts_tree_cursor_goto_first_child_wasm(this.tree[0]);
        unmarshalTreeCursor(this);
        return result === 1;
      }
      /**
       * Move this cursor to the last child of its current node.
       *
       * This returns `true` if the cursor successfully moved, and returns
       * `false` if there were no children.
       *
       * Note that this function may be slower than
       * {@link TreeCursor#gotoFirstChild} because it needs to
       * iterate through all the children to compute the child's position.
       */
      gotoLastChild() {
        marshalTreeCursor(this);
        const result = C._ts_tree_cursor_goto_last_child_wasm(this.tree[0]);
        unmarshalTreeCursor(this);
        return result === 1;
      }
      /**
       * Move this cursor to the parent of its current node.
       *
       * This returns `true` if the cursor successfully moved, and returns
       * `false` if there was no parent node (the cursor was already on the
       * root node).
       *
       * Note that the node the cursor was constructed with is considered the root
       * of the cursor, and the cursor cannot walk outside this node.
       */
      gotoParent() {
        marshalTreeCursor(this);
        const result = C._ts_tree_cursor_goto_parent_wasm(this.tree[0]);
        unmarshalTreeCursor(this);
        return result === 1;
      }
      /**
       * Move this cursor to the next sibling of its current node.
       *
       * This returns `true` if the cursor successfully moved, and returns
       * `false` if there was no next sibling node.
       *
       * Note that the node the cursor was constructed with is considered the root
       * of the cursor, and the cursor cannot walk outside this node.
       */
      gotoNextSibling() {
        marshalTreeCursor(this);
        const result = C._ts_tree_cursor_goto_next_sibling_wasm(this.tree[0]);
        unmarshalTreeCursor(this);
        return result === 1;
      }
      /**
       * Move this cursor to the previous sibling of its current node.
       *
       * This returns `true` if the cursor successfully moved, and returns
       * `false` if there was no previous sibling node.
       *
       * Note that this function may be slower than
       * {@link TreeCursor#gotoNextSibling} due to how node
       * positions are stored. In the worst case, this will need to iterate
       * through all the children up to the previous sibling node to recalculate
       * its position. Also note that the node the cursor was constructed with is
       * considered the root of the cursor, and the cursor cannot walk outside this node.
       */
      gotoPreviousSibling() {
        marshalTreeCursor(this);
        const result = C._ts_tree_cursor_goto_previous_sibling_wasm(this.tree[0]);
        unmarshalTreeCursor(this);
        return result === 1;
      }
      /**
       * Move the cursor to the node that is the nth descendant of
       * the original node that the cursor was constructed with, where
       * zero represents the original node itself.
       */
      gotoDescendant(goalDescendantIndex) {
        marshalTreeCursor(this);
        C._ts_tree_cursor_goto_descendant_wasm(this.tree[0], goalDescendantIndex);
        unmarshalTreeCursor(this);
      }
      /**
       * Move this cursor to the first child of its current node that contains or
       * starts after the given byte offset.
       *
       * This returns `true` if the cursor successfully moved to a child node, and returns
       * `false` if no such child was found.
       */
      gotoFirstChildForIndex(goalIndex) {
        marshalTreeCursor(this);
        C.setValue(TRANSFER_BUFFER + SIZE_OF_CURSOR, goalIndex, "i32");
        const result = C._ts_tree_cursor_goto_first_child_for_index_wasm(this.tree[0]);
        unmarshalTreeCursor(this);
        return result === 1;
      }
      /**
       * Move this cursor to the first child of its current node that contains or
       * starts after the given byte offset.
       *
       * This returns the index of the child node if one was found, and returns
       * `null` if no such child was found.
       */
      gotoFirstChildForPosition(goalPosition) {
        marshalTreeCursor(this);
        marshalPoint(TRANSFER_BUFFER + SIZE_OF_CURSOR, goalPosition);
        const result = C._ts_tree_cursor_goto_first_child_for_position_wasm(this.tree[0]);
        unmarshalTreeCursor(this);
        return result === 1;
      }
      /**
       * Re-initialize this tree cursor to start at the original node that the
       * cursor was constructed with.
       */
      reset(node) {
        marshalNode(node);
        marshalTreeCursor(this, TRANSFER_BUFFER + SIZE_OF_NODE);
        C._ts_tree_cursor_reset_wasm(this.tree[0]);
        unmarshalTreeCursor(this);
      }
      /**
       * Re-initialize a tree cursor to the same position as another cursor.
       *
       * Unlike {@link TreeCursor#reset}, this will not lose parent
       * information and allows reusing already created cursors.
       */
      resetTo(cursor) {
        marshalTreeCursor(this, TRANSFER_BUFFER);
        marshalTreeCursor(cursor, TRANSFER_BUFFER + SIZE_OF_CURSOR);
        C._ts_tree_cursor_reset_to_wasm(this.tree[0], cursor.tree[0]);
        unmarshalTreeCursor(this);
      }
    };
    Node = class {
      static {
        __name(this, "Node");
      }
      /** @internal */
      // @ts-expect-error: never read
      [0] = 0;
      // Internal handle for Wasm
      /** @internal */
      _children;
      /** @internal */
      _namedChildren;
      /** @internal */
      constructor(internal, {
        id,
        tree,
        startIndex,
        startPosition,
        other
      }) {
        assertInternal(internal);
        this[0] = other;
        this.id = id;
        this.tree = tree;
        this.startIndex = startIndex;
        this.startPosition = startPosition;
      }
      /**
       * The numeric id for this node that is unique.
       *
       * Within a given syntax tree, no two nodes have the same id. However:
       *
       * * If a new tree is created based on an older tree, and a node from the old tree is reused in
       *   the process, then that node will have the same id in both trees.
       *
       * * A node not marked as having changes does not guarantee it was reused.
       *
       * * If a node is marked as having changed in the old tree, it will not be reused.
       */
      id;
      /** The byte index where this node starts. */
      startIndex;
      /** The position where this node starts. */
      startPosition;
      /** The tree that this node belongs to. */
      tree;
      /** Get this node's type as a numerical id. */
      get typeId() {
        marshalNode(this);
        return C._ts_node_symbol_wasm(this.tree[0]);
      }
      /**
       * Get the node's type as a numerical id as it appears in the grammar,
       * ignoring aliases.
       */
      get grammarId() {
        marshalNode(this);
        return C._ts_node_grammar_symbol_wasm(this.tree[0]);
      }
      /** Get this node's type as a string. */
      get type() {
        return this.tree.language.types[this.typeId] || "ERROR";
      }
      /**
       * Get this node's symbol name as it appears in the grammar, ignoring
       * aliases as a string.
       */
      get grammarType() {
        return this.tree.language.types[this.grammarId] || "ERROR";
      }
      /**
       * Check if this node is *named*.
       *
       * Named nodes correspond to named rules in the grammar, whereas
       * *anonymous* nodes correspond to string literals in the grammar.
       */
      get isNamed() {
        marshalNode(this);
        return C._ts_node_is_named_wasm(this.tree[0]) === 1;
      }
      /**
       * Check if this node is *extra*.
       *
       * Extra nodes represent things like comments, which are not required
       * by the grammar, but can appear anywhere.
       */
      get isExtra() {
        marshalNode(this);
        return C._ts_node_is_extra_wasm(this.tree[0]) === 1;
      }
      /**
       * Check if this node represents a syntax error.
       *
       * Syntax errors represent parts of the code that could not be incorporated
       * into a valid syntax tree.
       */
      get isError() {
        marshalNode(this);
        return C._ts_node_is_error_wasm(this.tree[0]) === 1;
      }
      /**
       * Check if this node is *missing*.
       *
       * Missing nodes are inserted by the parser in order to recover from
       * certain kinds of syntax errors.
       */
      get isMissing() {
        marshalNode(this);
        return C._ts_node_is_missing_wasm(this.tree[0]) === 1;
      }
      /** Check if this node has been edited. */
      get hasChanges() {
        marshalNode(this);
        return C._ts_node_has_changes_wasm(this.tree[0]) === 1;
      }
      /**
       * Check if this node represents a syntax error or contains any syntax
       * errors anywhere within it.
       */
      get hasError() {
        marshalNode(this);
        return C._ts_node_has_error_wasm(this.tree[0]) === 1;
      }
      /** Get the byte index where this node ends. */
      get endIndex() {
        marshalNode(this);
        return C._ts_node_end_index_wasm(this.tree[0]);
      }
      /** Get the position where this node ends. */
      get endPosition() {
        marshalNode(this);
        C._ts_node_end_point_wasm(this.tree[0]);
        return unmarshalPoint(TRANSFER_BUFFER);
      }
      /** Get the string content of this node. */
      get text() {
        return getText(this.tree, this.startIndex, this.endIndex, this.startPosition);
      }
      /** Get this node's parse state. */
      get parseState() {
        marshalNode(this);
        return C._ts_node_parse_state_wasm(this.tree[0]);
      }
      /** Get the parse state after this node. */
      get nextParseState() {
        marshalNode(this);
        return C._ts_node_next_parse_state_wasm(this.tree[0]);
      }
      /** Check if this node is equal to another node. */
      equals(other) {
        return this.tree === other.tree && this.id === other.id;
      }
      /**
       * Get the node's child at the given index, where zero represents the first child.
       *
       * This method is fairly fast, but its cost is technically log(n), so if
       * you might be iterating over a long list of children, you should use
       * {@link Node#children} instead.
       */
      child(index) {
        marshalNode(this);
        C._ts_node_child_wasm(this.tree[0], index);
        return unmarshalNode(this.tree);
      }
      /**
       * Get this node's *named* child at the given index.
       *
       * See also {@link Node#isNamed}.
       * This method is fairly fast, but its cost is technically log(n), so if
       * you might be iterating over a long list of children, you should use
       * {@link Node#namedChildren} instead.
       */
      namedChild(index) {
        marshalNode(this);
        C._ts_node_named_child_wasm(this.tree[0], index);
        return unmarshalNode(this.tree);
      }
      /**
       * Get this node's child with the given numerical field id.
       *
       * See also {@link Node#childForFieldName}. You can
       * convert a field name to an id using {@link Language#fieldIdForName}.
       */
      childForFieldId(fieldId) {
        marshalNode(this);
        C._ts_node_child_by_field_id_wasm(this.tree[0], fieldId);
        return unmarshalNode(this.tree);
      }
      /**
       * Get the first child with the given field name.
       *
       * If multiple children may have the same field name, access them using
       * {@link Node#childrenForFieldName}.
       */
      childForFieldName(fieldName) {
        const fieldId = this.tree.language.fields.indexOf(fieldName);
        if (fieldId !== -1) return this.childForFieldId(fieldId);
        return null;
      }
      /** Get the field name of this node's child at the given index. */
      fieldNameForChild(index) {
        marshalNode(this);
        const address = C._ts_node_field_name_for_child_wasm(this.tree[0], index);
        if (!address) return null;
        return C.AsciiToString(address);
      }
      /** Get the field name of this node's named child at the given index. */
      fieldNameForNamedChild(index) {
        marshalNode(this);
        const address = C._ts_node_field_name_for_named_child_wasm(this.tree[0], index);
        if (!address) return null;
        return C.AsciiToString(address);
      }
      /**
       * Get an array of this node's children with a given field name.
       *
       * See also {@link Node#children}.
       */
      childrenForFieldName(fieldName) {
        const fieldId = this.tree.language.fields.indexOf(fieldName);
        if (fieldId !== -1 && fieldId !== 0) return this.childrenForFieldId(fieldId);
        return [];
      }
      /**
        * Get an array of this node's children with a given field id.
        *
        * See also {@link Node#childrenForFieldName}.
        */
      childrenForFieldId(fieldId) {
        marshalNode(this);
        C._ts_node_children_by_field_id_wasm(this.tree[0], fieldId);
        const count = C.getValue(TRANSFER_BUFFER, "i32");
        const buffer = C.getValue(TRANSFER_BUFFER + SIZE_OF_INT, "i32");
        const result = new Array(count);
        if (count > 0) {
          let address = buffer;
          for (let i2 = 0; i2 < count; i2++) {
            result[i2] = unmarshalNode(this.tree, address);
            address += SIZE_OF_NODE;
          }
          C._free(buffer);
        }
        return result;
      }
      /** Get the node's first child that contains or starts after the given byte offset. */
      firstChildForIndex(index) {
        marshalNode(this);
        const address = TRANSFER_BUFFER + SIZE_OF_NODE;
        C.setValue(address, index, "i32");
        C._ts_node_first_child_for_byte_wasm(this.tree[0]);
        return unmarshalNode(this.tree);
      }
      /** Get the node's first named child that contains or starts after the given byte offset. */
      firstNamedChildForIndex(index) {
        marshalNode(this);
        const address = TRANSFER_BUFFER + SIZE_OF_NODE;
        C.setValue(address, index, "i32");
        C._ts_node_first_named_child_for_byte_wasm(this.tree[0]);
        return unmarshalNode(this.tree);
      }
      /** Get this node's number of children. */
      get childCount() {
        marshalNode(this);
        return C._ts_node_child_count_wasm(this.tree[0]);
      }
      /**
       * Get this node's number of *named* children.
       *
       * See also {@link Node#isNamed}.
       */
      get namedChildCount() {
        marshalNode(this);
        return C._ts_node_named_child_count_wasm(this.tree[0]);
      }
      /** Get this node's first child. */
      get firstChild() {
        return this.child(0);
      }
      /**
       * Get this node's first named child.
       *
       * See also {@link Node#isNamed}.
       */
      get firstNamedChild() {
        return this.namedChild(0);
      }
      /** Get this node's last child. */
      get lastChild() {
        return this.child(this.childCount - 1);
      }
      /**
       * Get this node's last named child.
       *
       * See also {@link Node#isNamed}.
       */
      get lastNamedChild() {
        return this.namedChild(this.namedChildCount - 1);
      }
      /**
       * Iterate over this node's children.
       *
       * If you're walking the tree recursively, you may want to use the
       * {@link TreeCursor} APIs directly instead.
       */
      get children() {
        if (!this._children) {
          marshalNode(this);
          C._ts_node_children_wasm(this.tree[0]);
          const count = C.getValue(TRANSFER_BUFFER, "i32");
          const buffer = C.getValue(TRANSFER_BUFFER + SIZE_OF_INT, "i32");
          this._children = new Array(count);
          if (count > 0) {
            let address = buffer;
            for (let i2 = 0; i2 < count; i2++) {
              this._children[i2] = unmarshalNode(this.tree, address);
              address += SIZE_OF_NODE;
            }
            C._free(buffer);
          }
        }
        return this._children;
      }
      /**
       * Iterate over this node's named children.
       *
       * See also {@link Node#children}.
       */
      get namedChildren() {
        if (!this._namedChildren) {
          marshalNode(this);
          C._ts_node_named_children_wasm(this.tree[0]);
          const count = C.getValue(TRANSFER_BUFFER, "i32");
          const buffer = C.getValue(TRANSFER_BUFFER + SIZE_OF_INT, "i32");
          this._namedChildren = new Array(count);
          if (count > 0) {
            let address = buffer;
            for (let i2 = 0; i2 < count; i2++) {
              this._namedChildren[i2] = unmarshalNode(this.tree, address);
              address += SIZE_OF_NODE;
            }
            C._free(buffer);
          }
        }
        return this._namedChildren;
      }
      /**
       * Get the descendants of this node that are the given type, or in the given types array.
       *
       * The types array should contain node type strings, which can be retrieved from {@link Language#types}.
       *
       * Additionally, a `startPosition` and `endPosition` can be passed in to restrict the search to a byte range.
       */
      descendantsOfType(types, startPosition = ZERO_POINT, endPosition = ZERO_POINT) {
        if (!Array.isArray(types)) types = [types];
        const symbols = [];
        const typesBySymbol = this.tree.language.types;
        for (const node_type of types) {
          if (node_type == "ERROR") {
            symbols.push(65535);
          }
        }
        for (let i2 = 0, n = typesBySymbol.length; i2 < n; i2++) {
          if (types.includes(typesBySymbol[i2])) {
            symbols.push(i2);
          }
        }
        const symbolsAddress = C._malloc(SIZE_OF_INT * symbols.length);
        for (let i2 = 0, n = symbols.length; i2 < n; i2++) {
          C.setValue(symbolsAddress + i2 * SIZE_OF_INT, symbols[i2], "i32");
        }
        marshalNode(this);
        C._ts_node_descendants_of_type_wasm(
          this.tree[0],
          symbolsAddress,
          symbols.length,
          startPosition.row,
          startPosition.column,
          endPosition.row,
          endPosition.column
        );
        const descendantCount = C.getValue(TRANSFER_BUFFER, "i32");
        const descendantAddress = C.getValue(TRANSFER_BUFFER + SIZE_OF_INT, "i32");
        const result = new Array(descendantCount);
        if (descendantCount > 0) {
          let address = descendantAddress;
          for (let i2 = 0; i2 < descendantCount; i2++) {
            result[i2] = unmarshalNode(this.tree, address);
            address += SIZE_OF_NODE;
          }
        }
        C._free(descendantAddress);
        C._free(symbolsAddress);
        return result;
      }
      /** Get this node's next sibling. */
      get nextSibling() {
        marshalNode(this);
        C._ts_node_next_sibling_wasm(this.tree[0]);
        return unmarshalNode(this.tree);
      }
      /** Get this node's previous sibling. */
      get previousSibling() {
        marshalNode(this);
        C._ts_node_prev_sibling_wasm(this.tree[0]);
        return unmarshalNode(this.tree);
      }
      /**
       * Get this node's next *named* sibling.
       *
       * See also {@link Node#isNamed}.
       */
      get nextNamedSibling() {
        marshalNode(this);
        C._ts_node_next_named_sibling_wasm(this.tree[0]);
        return unmarshalNode(this.tree);
      }
      /**
       * Get this node's previous *named* sibling.
       *
       * See also {@link Node#isNamed}.
       */
      get previousNamedSibling() {
        marshalNode(this);
        C._ts_node_prev_named_sibling_wasm(this.tree[0]);
        return unmarshalNode(this.tree);
      }
      /** Get the node's number of descendants, including one for the node itself. */
      get descendantCount() {
        marshalNode(this);
        return C._ts_node_descendant_count_wasm(this.tree[0]);
      }
      /**
       * Get this node's immediate parent.
       * Prefer {@link Node#childWithDescendant} for iterating over this node's ancestors.
       */
      get parent() {
        marshalNode(this);
        C._ts_node_parent_wasm(this.tree[0]);
        return unmarshalNode(this.tree);
      }
      /**
       * Get the node that contains `descendant`.
       *
       * Note that this can return `descendant` itself.
       */
      childWithDescendant(descendant) {
        marshalNode(this);
        marshalNode(descendant, 1);
        C._ts_node_child_with_descendant_wasm(this.tree[0]);
        return unmarshalNode(this.tree);
      }
      /** Get the smallest node within this node that spans the given byte range. */
      descendantForIndex(start2, end = start2) {
        if (typeof start2 !== "number" || typeof end !== "number") {
          throw new Error("Arguments must be numbers");
        }
        marshalNode(this);
        const address = TRANSFER_BUFFER + SIZE_OF_NODE;
        C.setValue(address, start2, "i32");
        C.setValue(address + SIZE_OF_INT, end, "i32");
        C._ts_node_descendant_for_index_wasm(this.tree[0]);
        return unmarshalNode(this.tree);
      }
      /** Get the smallest named node within this node that spans the given byte range. */
      namedDescendantForIndex(start2, end = start2) {
        if (typeof start2 !== "number" || typeof end !== "number") {
          throw new Error("Arguments must be numbers");
        }
        marshalNode(this);
        const address = TRANSFER_BUFFER + SIZE_OF_NODE;
        C.setValue(address, start2, "i32");
        C.setValue(address + SIZE_OF_INT, end, "i32");
        C._ts_node_named_descendant_for_index_wasm(this.tree[0]);
        return unmarshalNode(this.tree);
      }
      /** Get the smallest node within this node that spans the given point range. */
      descendantForPosition(start2, end = start2) {
        if (!isPoint(start2) || !isPoint(end)) {
          throw new Error("Arguments must be {row, column} objects");
        }
        marshalNode(this);
        const address = TRANSFER_BUFFER + SIZE_OF_NODE;
        marshalPoint(address, start2);
        marshalPoint(address + SIZE_OF_POINT, end);
        C._ts_node_descendant_for_position_wasm(this.tree[0]);
        return unmarshalNode(this.tree);
      }
      /** Get the smallest named node within this node that spans the given point range. */
      namedDescendantForPosition(start2, end = start2) {
        if (!isPoint(start2) || !isPoint(end)) {
          throw new Error("Arguments must be {row, column} objects");
        }
        marshalNode(this);
        const address = TRANSFER_BUFFER + SIZE_OF_NODE;
        marshalPoint(address, start2);
        marshalPoint(address + SIZE_OF_POINT, end);
        C._ts_node_named_descendant_for_position_wasm(this.tree[0]);
        return unmarshalNode(this.tree);
      }
      /**
       * Create a new {@link TreeCursor} starting from this node.
       *
       * Note that the given node is considered the root of the cursor,
       * and the cursor cannot walk outside this node.
       */
      walk() {
        marshalNode(this);
        C._ts_tree_cursor_new_wasm(this.tree[0]);
        return new TreeCursor(INTERNAL, this.tree);
      }
      /**
       * Edit this node to keep it in-sync with source code that has been edited.
       *
       * This function is only rarely needed. When you edit a syntax tree with
       * the {@link Tree#edit} method, all of the nodes that you retrieve from
       * the tree afterward will already reflect the edit. You only need to
       * use {@link Node#edit} when you have a specific {@link Node} instance that
       * you want to keep and continue to use after an edit.
       */
      edit(edit) {
        if (this.startIndex >= edit.oldEndIndex) {
          this.startIndex = edit.newEndIndex + (this.startIndex - edit.oldEndIndex);
          let subbedPointRow;
          let subbedPointColumn;
          if (this.startPosition.row > edit.oldEndPosition.row) {
            subbedPointRow = this.startPosition.row - edit.oldEndPosition.row;
            subbedPointColumn = this.startPosition.column;
          } else {
            subbedPointRow = 0;
            subbedPointColumn = this.startPosition.column;
            if (this.startPosition.column >= edit.oldEndPosition.column) {
              subbedPointColumn = this.startPosition.column - edit.oldEndPosition.column;
            }
          }
          if (subbedPointRow > 0) {
            this.startPosition.row += subbedPointRow;
            this.startPosition.column = subbedPointColumn;
          } else {
            this.startPosition.column += subbedPointColumn;
          }
        } else if (this.startIndex > edit.startIndex) {
          this.startIndex = edit.newEndIndex;
          this.startPosition.row = edit.newEndPosition.row;
          this.startPosition.column = edit.newEndPosition.column;
        }
      }
      /** Get the S-expression representation of this node. */
      toString() {
        marshalNode(this);
        const address = C._ts_node_to_string_wasm(this.tree[0]);
        const result = C.AsciiToString(address);
        C._free(address);
        return result;
      }
    };
    __name(unmarshalCaptures, "unmarshalCaptures");
    __name(marshalNode, "marshalNode");
    __name(unmarshalNode, "unmarshalNode");
    __name(marshalTreeCursor, "marshalTreeCursor");
    __name(unmarshalTreeCursor, "unmarshalTreeCursor");
    __name(marshalPoint, "marshalPoint");
    __name(unmarshalPoint, "unmarshalPoint");
    __name(marshalRange, "marshalRange");
    __name(unmarshalRange, "unmarshalRange");
    __name(marshalEdit, "marshalEdit");
    __name(unmarshalLanguageMetadata, "unmarshalLanguageMetadata");
    LANGUAGE_FUNCTION_REGEX = /^tree_sitter_\w+$/;
    Language = class _Language {
      static {
        __name(this, "Language");
      }
      /** @internal */
      [0] = 0;
      // Internal handle for Wasm
      /**
       * A list of all node types in the language. The index of each type in this
       * array is its node type id.
       */
      types;
      /**
       * A list of all field names in the language. The index of each field name in
       * this array is its field id.
       */
      fields;
      /** @internal */
      constructor(internal, address) {
        assertInternal(internal);
        this[0] = address;
        this.types = new Array(C._ts_language_symbol_count(this[0]));
        for (let i2 = 0, n = this.types.length; i2 < n; i2++) {
          if (C._ts_language_symbol_type(this[0], i2) < 2) {
            this.types[i2] = C.UTF8ToString(C._ts_language_symbol_name(this[0], i2));
          }
        }
        this.fields = new Array(C._ts_language_field_count(this[0]) + 1);
        for (let i2 = 0, n = this.fields.length; i2 < n; i2++) {
          const fieldName = C._ts_language_field_name_for_id(this[0], i2);
          if (fieldName !== 0) {
            this.fields[i2] = C.UTF8ToString(fieldName);
          } else {
            this.fields[i2] = null;
          }
        }
      }
      /**
       * Gets the name of the language.
       */
      get name() {
        const ptr = C._ts_language_name(this[0]);
        if (ptr === 0) return null;
        return C.UTF8ToString(ptr);
      }
      /**
       * Gets the ABI version of the language.
       */
      get abiVersion() {
        return C._ts_language_abi_version(this[0]);
      }
      /**
      * Get the metadata for this language. This information is generated by the
      * CLI, and relies on the language author providing the correct metadata in
      * the language's `tree-sitter.json` file.
      */
      get metadata() {
        C._ts_language_metadata_wasm(this[0]);
        const length = C.getValue(TRANSFER_BUFFER, "i32");
        if (length === 0) return null;
        return unmarshalLanguageMetadata(TRANSFER_BUFFER + SIZE_OF_INT);
      }
      /**
       * Gets the number of fields in the language.
       */
      get fieldCount() {
        return this.fields.length - 1;
      }
      /**
       * Gets the number of states in the language.
       */
      get stateCount() {
        return C._ts_language_state_count(this[0]);
      }
      /**
       * Get the field id for a field name.
       */
      fieldIdForName(fieldName) {
        const result = this.fields.indexOf(fieldName);
        return result !== -1 ? result : null;
      }
      /**
       * Get the field name for a field id.
       */
      fieldNameForId(fieldId) {
        return this.fields[fieldId] ?? null;
      }
      /**
       * Get the node type id for a node type name.
       */
      idForNodeType(type, named) {
        const typeLength = C.lengthBytesUTF8(type);
        const typeAddress = C._malloc(typeLength + 1);
        C.stringToUTF8(type, typeAddress, typeLength + 1);
        const result = C._ts_language_symbol_for_name(this[0], typeAddress, typeLength, named ? 1 : 0);
        C._free(typeAddress);
        return result || null;
      }
      /**
       * Gets the number of node types in the language.
       */
      get nodeTypeCount() {
        return C._ts_language_symbol_count(this[0]);
      }
      /**
       * Get the node type name for a node type id.
       */
      nodeTypeForId(typeId) {
        const name2 = C._ts_language_symbol_name(this[0], typeId);
        return name2 ? C.UTF8ToString(name2) : null;
      }
      /**
       * Check if a node type is named.
       *
       * @see {@link https://tree-sitter.github.io/tree-sitter/using-parsers/2-basic-parsing.html#named-vs-anonymous-nodes}
       */
      nodeTypeIsNamed(typeId) {
        return C._ts_language_type_is_named_wasm(this[0], typeId) ? true : false;
      }
      /**
       * Check if a node type is visible.
       */
      nodeTypeIsVisible(typeId) {
        return C._ts_language_type_is_visible_wasm(this[0], typeId) ? true : false;
      }
      /**
       * Get the supertypes ids of this language.
       *
       * @see {@link https://tree-sitter.github.io/tree-sitter/using-parsers/6-static-node-types.html?highlight=supertype#supertype-nodes}
       */
      get supertypes() {
        C._ts_language_supertypes_wasm(this[0]);
        const count = C.getValue(TRANSFER_BUFFER, "i32");
        const buffer = C.getValue(TRANSFER_BUFFER + SIZE_OF_INT, "i32");
        const result = new Array(count);
        if (count > 0) {
          let address = buffer;
          for (let i2 = 0; i2 < count; i2++) {
            result[i2] = C.getValue(address, "i16");
            address += SIZE_OF_SHORT;
          }
        }
        return result;
      }
      /**
       * Get the subtype ids for a given supertype node id.
       */
      subtypes(supertype) {
        C._ts_language_subtypes_wasm(this[0], supertype);
        const count = C.getValue(TRANSFER_BUFFER, "i32");
        const buffer = C.getValue(TRANSFER_BUFFER + SIZE_OF_INT, "i32");
        const result = new Array(count);
        if (count > 0) {
          let address = buffer;
          for (let i2 = 0; i2 < count; i2++) {
            result[i2] = C.getValue(address, "i16");
            address += SIZE_OF_SHORT;
          }
        }
        return result;
      }
      /**
       * Get the next state id for a given state id and node type id.
       */
      nextState(stateId, typeId) {
        return C._ts_language_next_state(this[0], stateId, typeId);
      }
      /**
       * Create a new lookahead iterator for this language and parse state.
       *
       * This returns `null` if state is invalid for this language.
       *
       * Iterating {@link LookaheadIterator} will yield valid symbols in the given
       * parse state. Newly created lookahead iterators will return the `ERROR`
       * symbol from {@link LookaheadIterator#currentType}.
       *
       * Lookahead iterators can be useful for generating suggestions and improving
       * syntax error diagnostics. To get symbols valid in an `ERROR` node, use the
       * lookahead iterator on its first leaf node state. For `MISSING` nodes, a
       * lookahead iterator created on the previous non-extra leaf node may be
       * appropriate.
       */
      lookaheadIterator(stateId) {
        const address = C._ts_lookahead_iterator_new(this[0], stateId);
        if (address) return new LookaheadIterator(INTERNAL, address, this);
        return null;
      }
      /**
       * Load a language from a WebAssembly module.
       * The module can be provided as a path to a file or as a buffer.
       */
      static async load(input) {
        let binary2;
        if (input instanceof Uint8Array) {
          binary2 = input;
        } else if (globalThis.process?.versions.node) {
          const fs2 = await import("fs/promises");
          binary2 = await fs2.readFile(input);
        } else {
          const response = await fetch(input);
          if (!response.ok) {
            const body2 = await response.text();
            throw new Error(`Language.load failed with status ${response.status}.

${body2}`);
          }
          const retryResp = response.clone();
          try {
            binary2 = await WebAssembly.compileStreaming(response);
          } catch (reason) {
            console.error("wasm streaming compile failed:", reason);
            console.error("falling back to ArrayBuffer instantiation");
            binary2 = new Uint8Array(await retryResp.arrayBuffer());
          }
        }
        const mod = await C.loadWebAssemblyModule(binary2, { loadAsync: true });
        const symbolNames = Object.keys(mod);
        const functionName = symbolNames.find((key2) => LANGUAGE_FUNCTION_REGEX.test(key2) && !key2.includes("external_scanner_"));
        if (!functionName) {
          console.log(`Couldn't find language function in Wasm file. Symbols:
${JSON.stringify(symbolNames, null, 2)}`);
          throw new Error("Language.load failed: no language function found in Wasm file");
        }
        const languageAddress = mod[functionName]();
        return new _Language(INTERNAL, languageAddress);
      }
    };
    __name(Module2, "Module");
    web_tree_sitter_default = Module2;
    Module3 = null;
    __name(initializeBinding, "initializeBinding");
    __name(checkModule, "checkModule");
    Parser = class {
      static {
        __name(this, "Parser");
      }
      /** @internal */
      [0] = 0;
      // Internal handle for Wasm
      /** @internal */
      [1] = 0;
      // Internal handle for Wasm
      /** @internal */
      logCallback = null;
      /** The parser's current language. */
      language = null;
      /**
       * This must always be called before creating a Parser.
       *
       * You can optionally pass in options to configure the Wasm module, the most common
       * one being `locateFile` to help the module find the `.wasm` file.
       */
      static async init(moduleOptions) {
        setModule(await initializeBinding(moduleOptions));
        TRANSFER_BUFFER = C._ts_init();
        LANGUAGE_VERSION = C.getValue(TRANSFER_BUFFER, "i32");
        MIN_COMPATIBLE_VERSION = C.getValue(TRANSFER_BUFFER + SIZE_OF_INT, "i32");
      }
      /**
       * Create a new parser.
       */
      constructor() {
        this.initialize();
      }
      /** @internal */
      initialize() {
        if (!checkModule()) {
          throw new Error("cannot construct a Parser before calling `init()`");
        }
        C._ts_parser_new_wasm();
        this[0] = C.getValue(TRANSFER_BUFFER, "i32");
        this[1] = C.getValue(TRANSFER_BUFFER + SIZE_OF_INT, "i32");
      }
      /** Delete the parser, freeing its resources. */
      delete() {
        C._ts_parser_delete(this[0]);
        C._free(this[1]);
        this[0] = 0;
        this[1] = 0;
      }
      /**
       * Set the language that the parser should use for parsing.
       *
       * If the language was not successfully assigned, an error will be thrown.
       * This happens if the language was generated with an incompatible
       * version of the Tree-sitter CLI. Check the language's version using
       * {@link Language#version} and compare it to this library's
       * {@link LANGUAGE_VERSION} and {@link MIN_COMPATIBLE_VERSION} constants.
       */
      setLanguage(language) {
        let address;
        if (!language) {
          address = 0;
          this.language = null;
        } else if (language.constructor === Language) {
          address = language[0];
          const version = C._ts_language_abi_version(address);
          if (version < MIN_COMPATIBLE_VERSION || LANGUAGE_VERSION < version) {
            throw new Error(
              `Incompatible language version ${version}. Compatibility range ${MIN_COMPATIBLE_VERSION} through ${LANGUAGE_VERSION}.`
            );
          }
          this.language = language;
        } else {
          throw new Error("Argument must be a Language");
        }
        C._ts_parser_set_language(this[0], address);
        return this;
      }
      /**
       * Parse a slice of UTF8 text.
       *
       * @param {string | ParseCallback} callback - The UTF8-encoded text to parse or a callback function.
       *
       * @param {Tree | null} [oldTree] - A previous syntax tree parsed from the same document. If the text of the
       *   document has changed since `oldTree` was created, then you must edit `oldTree` to match
       *   the new text using {@link Tree#edit}.
       *
       * @param {ParseOptions} [options] - Options for parsing the text.
       *  This can be used to set the included ranges, or a progress callback.
       *
       * @returns {Tree | null} A {@link Tree} if parsing succeeded, or `null` if:
       *  - The parser has not yet had a language assigned with {@link Parser#setLanguage}.
       *  - The progress callback returned true.
       */
      parse(callback, oldTree, options) {
        if (typeof callback === "string") {
          C.currentParseCallback = (index) => callback.slice(index);
        } else if (typeof callback === "function") {
          C.currentParseCallback = callback;
        } else {
          throw new Error("Argument must be a string or a function");
        }
        if (options?.progressCallback) {
          C.currentProgressCallback = options.progressCallback;
        } else {
          C.currentProgressCallback = null;
        }
        if (this.logCallback) {
          C.currentLogCallback = this.logCallback;
          C._ts_parser_enable_logger_wasm(this[0], 1);
        } else {
          C.currentLogCallback = null;
          C._ts_parser_enable_logger_wasm(this[0], 0);
        }
        let rangeCount = 0;
        let rangeAddress = 0;
        if (options?.includedRanges) {
          rangeCount = options.includedRanges.length;
          rangeAddress = C._calloc(rangeCount, SIZE_OF_RANGE);
          let address = rangeAddress;
          for (let i2 = 0; i2 < rangeCount; i2++) {
            marshalRange(address, options.includedRanges[i2]);
            address += SIZE_OF_RANGE;
          }
        }
        const treeAddress = C._ts_parser_parse_wasm(
          this[0],
          this[1],
          oldTree ? oldTree[0] : 0,
          rangeAddress,
          rangeCount
        );
        if (!treeAddress) {
          C.currentParseCallback = null;
          C.currentLogCallback = null;
          C.currentProgressCallback = null;
          return null;
        }
        if (!this.language) {
          throw new Error("Parser must have a language to parse");
        }
        const result = new Tree(INTERNAL, treeAddress, this.language, C.currentParseCallback);
        C.currentParseCallback = null;
        C.currentLogCallback = null;
        C.currentProgressCallback = null;
        return result;
      }
      /**
       * Instruct the parser to start the next parse from the beginning.
       *
       * If the parser previously failed because of a callback, 
       * then by default, it will resume where it left off on the
       * next call to {@link Parser#parse} or other parsing functions.
       * If you don't want to resume, and instead intend to use this parser to
       * parse some other document, you must call `reset` first.
       */
      reset() {
        C._ts_parser_reset(this[0]);
      }
      /** Get the ranges of text that the parser will include when parsing. */
      getIncludedRanges() {
        C._ts_parser_included_ranges_wasm(this[0]);
        const count = C.getValue(TRANSFER_BUFFER, "i32");
        const buffer = C.getValue(TRANSFER_BUFFER + SIZE_OF_INT, "i32");
        const result = new Array(count);
        if (count > 0) {
          let address = buffer;
          for (let i2 = 0; i2 < count; i2++) {
            result[i2] = unmarshalRange(address);
            address += SIZE_OF_RANGE;
          }
          C._free(buffer);
        }
        return result;
      }
      /** Set the logging callback that a parser should use during parsing. */
      setLogger(callback) {
        if (!callback) {
          this.logCallback = null;
        } else if (typeof callback !== "function") {
          throw new Error("Logger callback must be a function");
        } else {
          this.logCallback = callback;
        }
        return this;
      }
      /** Get the parser's current logger. */
      getLogger() {
        return this.logCallback;
      }
    };
    PREDICATE_STEP_TYPE_CAPTURE = 1;
    PREDICATE_STEP_TYPE_STRING = 2;
    QUERY_WORD_REGEX = /[\w-]+/g;
    CaptureQuantifier = {
      Zero: 0,
      ZeroOrOne: 1,
      ZeroOrMore: 2,
      One: 3,
      OneOrMore: 4
    };
    isCaptureStep = /* @__PURE__ */ __name((step) => step.type === "capture", "isCaptureStep");
    isStringStep = /* @__PURE__ */ __name((step) => step.type === "string", "isStringStep");
    QueryErrorKind = {
      Syntax: 1,
      NodeName: 2,
      FieldName: 3,
      CaptureName: 4,
      PatternStructure: 5
    };
    QueryError = class _QueryError extends Error {
      constructor(kind, info2, index, length) {
        super(_QueryError.formatMessage(kind, info2));
        this.kind = kind;
        this.info = info2;
        this.index = index;
        this.length = length;
        this.name = "QueryError";
      }
      static {
        __name(this, "QueryError");
      }
      /** Formats an error message based on the error kind and info */
      static formatMessage(kind, info2) {
        switch (kind) {
          case QueryErrorKind.NodeName:
            return `Bad node name '${info2.word}'`;
          case QueryErrorKind.FieldName:
            return `Bad field name '${info2.word}'`;
          case QueryErrorKind.CaptureName:
            return `Bad capture name @${info2.word}`;
          case QueryErrorKind.PatternStructure:
            return `Bad pattern structure at offset ${info2.suffix}`;
          case QueryErrorKind.Syntax:
            return `Bad syntax at offset ${info2.suffix}`;
        }
      }
    };
    __name(parseAnyPredicate, "parseAnyPredicate");
    __name(parseMatchPredicate, "parseMatchPredicate");
    __name(parseAnyOfPredicate, "parseAnyOfPredicate");
    __name(parseIsPredicate, "parseIsPredicate");
    __name(parseSetDirective, "parseSetDirective");
    __name(parsePattern, "parsePattern");
    Query = class {
      static {
        __name(this, "Query");
      }
      /** @internal */
      [0] = 0;
      // Internal handle for Wasm
      /** @internal */
      exceededMatchLimit;
      /** @internal */
      textPredicates;
      /** The names of the captures used in the query. */
      captureNames;
      /** The quantifiers of the captures used in the query. */
      captureQuantifiers;
      /**
       * The other user-defined predicates associated with the given index.
       *
       * This includes predicates with operators other than:
       * - `match?`
       * - `eq?` and `not-eq?`
       * - `any-of?` and `not-any-of?`
       * - `is?` and `is-not?`
       * - `set!`
       */
      predicates;
      /** The properties for predicates with the operator `set!`. */
      setProperties;
      /** The properties for predicates with the operator `is?`. */
      assertedProperties;
      /** The properties for predicates with the operator `is-not?`. */
      refutedProperties;
      /** The maximum number of in-progress matches for this cursor. */
      matchLimit;
      /**
       * Create a new query from a string containing one or more S-expression
       * patterns.
       *
       * The query is associated with a particular language, and can only be run
       * on syntax nodes parsed with that language. References to Queries can be
       * shared between multiple threads.
       *
       * @link {@see https://tree-sitter.github.io/tree-sitter/using-parsers/queries}
       */
      constructor(language, source) {
        const sourceLength = C.lengthBytesUTF8(source);
        const sourceAddress = C._malloc(sourceLength + 1);
        C.stringToUTF8(source, sourceAddress, sourceLength + 1);
        const address = C._ts_query_new(
          language[0],
          sourceAddress,
          sourceLength,
          TRANSFER_BUFFER,
          TRANSFER_BUFFER + SIZE_OF_INT
        );
        if (!address) {
          const errorId = C.getValue(TRANSFER_BUFFER + SIZE_OF_INT, "i32");
          const errorByte = C.getValue(TRANSFER_BUFFER, "i32");
          const errorIndex = C.UTF8ToString(sourceAddress, errorByte).length;
          const suffix = source.slice(errorIndex, errorIndex + 100).split("\n")[0];
          const word = suffix.match(QUERY_WORD_REGEX)?.[0] ?? "";
          C._free(sourceAddress);
          switch (errorId) {
            case QueryErrorKind.Syntax:
              throw new QueryError(QueryErrorKind.Syntax, { suffix: `${errorIndex}: '${suffix}'...` }, errorIndex, 0);
            case QueryErrorKind.NodeName:
              throw new QueryError(errorId, { word }, errorIndex, word.length);
            case QueryErrorKind.FieldName:
              throw new QueryError(errorId, { word }, errorIndex, word.length);
            case QueryErrorKind.CaptureName:
              throw new QueryError(errorId, { word }, errorIndex, word.length);
            case QueryErrorKind.PatternStructure:
              throw new QueryError(errorId, { suffix: `${errorIndex}: '${suffix}'...` }, errorIndex, 0);
          }
        }
        const stringCount = C._ts_query_string_count(address);
        const captureCount = C._ts_query_capture_count(address);
        const patternCount = C._ts_query_pattern_count(address);
        const captureNames = new Array(captureCount);
        const captureQuantifiers = new Array(patternCount);
        const stringValues = new Array(stringCount);
        for (let i2 = 0; i2 < captureCount; i2++) {
          const nameAddress = C._ts_query_capture_name_for_id(
            address,
            i2,
            TRANSFER_BUFFER
          );
          const nameLength = C.getValue(TRANSFER_BUFFER, "i32");
          captureNames[i2] = C.UTF8ToString(nameAddress, nameLength);
        }
        for (let i2 = 0; i2 < patternCount; i2++) {
          const captureQuantifiersArray = new Array(captureCount);
          for (let j = 0; j < captureCount; j++) {
            const quantifier = C._ts_query_capture_quantifier_for_id(address, i2, j);
            captureQuantifiersArray[j] = quantifier;
          }
          captureQuantifiers[i2] = captureQuantifiersArray;
        }
        for (let i2 = 0; i2 < stringCount; i2++) {
          const valueAddress = C._ts_query_string_value_for_id(
            address,
            i2,
            TRANSFER_BUFFER
          );
          const nameLength = C.getValue(TRANSFER_BUFFER, "i32");
          stringValues[i2] = C.UTF8ToString(valueAddress, nameLength);
        }
        const setProperties = new Array(patternCount);
        const assertedProperties = new Array(patternCount);
        const refutedProperties = new Array(patternCount);
        const predicates = new Array(patternCount);
        const textPredicates = new Array(patternCount);
        for (let i2 = 0; i2 < patternCount; i2++) {
          const predicatesAddress = C._ts_query_predicates_for_pattern(address, i2, TRANSFER_BUFFER);
          const stepCount = C.getValue(TRANSFER_BUFFER, "i32");
          predicates[i2] = [];
          textPredicates[i2] = [];
          const steps = new Array();
          let stepAddress = predicatesAddress;
          for (let j = 0; j < stepCount; j++) {
            const stepType = C.getValue(stepAddress, "i32");
            stepAddress += SIZE_OF_INT;
            const stepValueId = C.getValue(stepAddress, "i32");
            stepAddress += SIZE_OF_INT;
            parsePattern(
              i2,
              stepType,
              stepValueId,
              captureNames,
              stringValues,
              steps,
              textPredicates,
              predicates,
              setProperties,
              assertedProperties,
              refutedProperties
            );
          }
          Object.freeze(textPredicates[i2]);
          Object.freeze(predicates[i2]);
          Object.freeze(setProperties[i2]);
          Object.freeze(assertedProperties[i2]);
          Object.freeze(refutedProperties[i2]);
        }
        C._free(sourceAddress);
        this[0] = address;
        this.captureNames = captureNames;
        this.captureQuantifiers = captureQuantifiers;
        this.textPredicates = textPredicates;
        this.predicates = predicates;
        this.setProperties = setProperties;
        this.assertedProperties = assertedProperties;
        this.refutedProperties = refutedProperties;
        this.exceededMatchLimit = false;
      }
      /** Delete the query, freeing its resources. */
      delete() {
        C._ts_query_delete(this[0]);
        this[0] = 0;
      }
      /**
       * Iterate over all of the matches in the order that they were found.
       *
       * Each match contains the index of the pattern that matched, and a list of
       * captures. Because multiple patterns can match the same set of nodes,
       * one match may contain captures that appear *before* some of the
       * captures from a previous match.
       *
       * @param {Node} node - The node to execute the query on.
       *
       * @param {QueryOptions} options - Options for query execution.
       */
      matches(node, options = {}) {
        const startPosition = options.startPosition ?? ZERO_POINT;
        const endPosition = options.endPosition ?? ZERO_POINT;
        const startIndex = options.startIndex ?? 0;
        const endIndex = options.endIndex ?? 0;
        const startContainingPosition = options.startContainingPosition ?? ZERO_POINT;
        const endContainingPosition = options.endContainingPosition ?? ZERO_POINT;
        const startContainingIndex = options.startContainingIndex ?? 0;
        const endContainingIndex = options.endContainingIndex ?? 0;
        const matchLimit = options.matchLimit ?? 4294967295;
        const maxStartDepth = options.maxStartDepth ?? 4294967295;
        const progressCallback = options.progressCallback;
        if (typeof matchLimit !== "number") {
          throw new Error("Arguments must be numbers");
        }
        this.matchLimit = matchLimit;
        if (endIndex !== 0 && startIndex > endIndex) {
          throw new Error("`startIndex` cannot be greater than `endIndex`");
        }
        if (endPosition !== ZERO_POINT && (startPosition.row > endPosition.row || startPosition.row === endPosition.row && startPosition.column > endPosition.column)) {
          throw new Error("`startPosition` cannot be greater than `endPosition`");
        }
        if (endContainingIndex !== 0 && startContainingIndex > endContainingIndex) {
          throw new Error("`startContainingIndex` cannot be greater than `endContainingIndex`");
        }
        if (endContainingPosition !== ZERO_POINT && (startContainingPosition.row > endContainingPosition.row || startContainingPosition.row === endContainingPosition.row && startContainingPosition.column > endContainingPosition.column)) {
          throw new Error("`startContainingPosition` cannot be greater than `endContainingPosition`");
        }
        if (progressCallback) {
          C.currentQueryProgressCallback = progressCallback;
        }
        marshalNode(node);
        C._ts_query_matches_wasm(
          this[0],
          node.tree[0],
          startPosition.row,
          startPosition.column,
          endPosition.row,
          endPosition.column,
          startIndex,
          endIndex,
          startContainingPosition.row,
          startContainingPosition.column,
          endContainingPosition.row,
          endContainingPosition.column,
          startContainingIndex,
          endContainingIndex,
          matchLimit,
          maxStartDepth
        );
        const rawCount = C.getValue(TRANSFER_BUFFER, "i32");
        const startAddress = C.getValue(TRANSFER_BUFFER + SIZE_OF_INT, "i32");
        const didExceedMatchLimit = C.getValue(TRANSFER_BUFFER + 2 * SIZE_OF_INT, "i32");
        const result = new Array(rawCount);
        this.exceededMatchLimit = Boolean(didExceedMatchLimit);
        let filteredCount = 0;
        let address = startAddress;
        for (let i2 = 0; i2 < rawCount; i2++) {
          const patternIndex = C.getValue(address, "i32");
          address += SIZE_OF_INT;
          const captureCount = C.getValue(address, "i32");
          address += SIZE_OF_INT;
          const captures = new Array(captureCount);
          address = unmarshalCaptures(this, node.tree, address, patternIndex, captures);
          if (this.textPredicates[patternIndex].every((p) => p(captures))) {
            result[filteredCount] = { patternIndex, captures };
            const setProperties = this.setProperties[patternIndex];
            result[filteredCount].setProperties = setProperties;
            const assertedProperties = this.assertedProperties[patternIndex];
            result[filteredCount].assertedProperties = assertedProperties;
            const refutedProperties = this.refutedProperties[patternIndex];
            result[filteredCount].refutedProperties = refutedProperties;
            filteredCount++;
          }
        }
        result.length = filteredCount;
        C._free(startAddress);
        C.currentQueryProgressCallback = null;
        return result;
      }
      /**
       * Iterate over all of the individual captures in the order that they
       * appear.
       *
       * This is useful if you don't care about which pattern matched, and just
       * want a single, ordered sequence of captures.
       *
       * @param {Node} node - The node to execute the query on.
       *
       * @param {QueryOptions} options - Options for query execution.
       */
      captures(node, options = {}) {
        const startPosition = options.startPosition ?? ZERO_POINT;
        const endPosition = options.endPosition ?? ZERO_POINT;
        const startIndex = options.startIndex ?? 0;
        const endIndex = options.endIndex ?? 0;
        const startContainingPosition = options.startContainingPosition ?? ZERO_POINT;
        const endContainingPosition = options.endContainingPosition ?? ZERO_POINT;
        const startContainingIndex = options.startContainingIndex ?? 0;
        const endContainingIndex = options.endContainingIndex ?? 0;
        const matchLimit = options.matchLimit ?? 4294967295;
        const maxStartDepth = options.maxStartDepth ?? 4294967295;
        const progressCallback = options.progressCallback;
        if (typeof matchLimit !== "number") {
          throw new Error("Arguments must be numbers");
        }
        this.matchLimit = matchLimit;
        if (endIndex !== 0 && startIndex > endIndex) {
          throw new Error("`startIndex` cannot be greater than `endIndex`");
        }
        if (endPosition !== ZERO_POINT && (startPosition.row > endPosition.row || startPosition.row === endPosition.row && startPosition.column > endPosition.column)) {
          throw new Error("`startPosition` cannot be greater than `endPosition`");
        }
        if (endContainingIndex !== 0 && startContainingIndex > endContainingIndex) {
          throw new Error("`startContainingIndex` cannot be greater than `endContainingIndex`");
        }
        if (endContainingPosition !== ZERO_POINT && (startContainingPosition.row > endContainingPosition.row || startContainingPosition.row === endContainingPosition.row && startContainingPosition.column > endContainingPosition.column)) {
          throw new Error("`startContainingPosition` cannot be greater than `endContainingPosition`");
        }
        if (progressCallback) {
          C.currentQueryProgressCallback = progressCallback;
        }
        marshalNode(node);
        C._ts_query_captures_wasm(
          this[0],
          node.tree[0],
          startPosition.row,
          startPosition.column,
          endPosition.row,
          endPosition.column,
          startIndex,
          endIndex,
          startContainingPosition.row,
          startContainingPosition.column,
          endContainingPosition.row,
          endContainingPosition.column,
          startContainingIndex,
          endContainingIndex,
          matchLimit,
          maxStartDepth
        );
        const count = C.getValue(TRANSFER_BUFFER, "i32");
        const startAddress = C.getValue(TRANSFER_BUFFER + SIZE_OF_INT, "i32");
        const didExceedMatchLimit = C.getValue(TRANSFER_BUFFER + 2 * SIZE_OF_INT, "i32");
        const result = new Array();
        this.exceededMatchLimit = Boolean(didExceedMatchLimit);
        const captures = new Array();
        let address = startAddress;
        for (let i2 = 0; i2 < count; i2++) {
          const patternIndex = C.getValue(address, "i32");
          address += SIZE_OF_INT;
          const captureCount = C.getValue(address, "i32");
          address += SIZE_OF_INT;
          const captureIndex = C.getValue(address, "i32");
          address += SIZE_OF_INT;
          captures.length = captureCount;
          address = unmarshalCaptures(this, node.tree, address, patternIndex, captures);
          if (this.textPredicates[patternIndex].every((p) => p(captures))) {
            const capture = captures[captureIndex];
            const setProperties = this.setProperties[patternIndex];
            capture.setProperties = setProperties;
            const assertedProperties = this.assertedProperties[patternIndex];
            capture.assertedProperties = assertedProperties;
            const refutedProperties = this.refutedProperties[patternIndex];
            capture.refutedProperties = refutedProperties;
            result.push(capture);
          }
        }
        C._free(startAddress);
        C.currentQueryProgressCallback = null;
        return result;
      }
      /** Get the predicates for a given pattern. */
      predicatesForPattern(patternIndex) {
        return this.predicates[patternIndex];
      }
      /**
       * Disable a certain capture within a query.
       *
       * This prevents the capture from being returned in matches, and also
       * avoids any resource usage associated with recording the capture.
       */
      disableCapture(captureName) {
        const captureNameLength = C.lengthBytesUTF8(captureName);
        const captureNameAddress = C._malloc(captureNameLength + 1);
        C.stringToUTF8(captureName, captureNameAddress, captureNameLength + 1);
        C._ts_query_disable_capture(this[0], captureNameAddress, captureNameLength);
        C._free(captureNameAddress);
      }
      /**
       * Disable a certain pattern within a query.
       *
       * This prevents the pattern from matching, and also avoids any resource
       * usage associated with the pattern. This throws an error if the pattern
       * index is out of bounds.
       */
      disablePattern(patternIndex) {
        if (patternIndex >= this.predicates.length) {
          throw new Error(
            `Pattern index is ${patternIndex} but the pattern count is ${this.predicates.length}`
          );
        }
        C._ts_query_disable_pattern(this[0], patternIndex);
      }
      /**
       * Check if, on its last execution, this cursor exceeded its maximum number
       * of in-progress matches.
       */
      didExceedMatchLimit() {
        return this.exceededMatchLimit;
      }
      /** Get the byte offset where the given pattern starts in the query's source. */
      startIndexForPattern(patternIndex) {
        if (patternIndex >= this.predicates.length) {
          throw new Error(
            `Pattern index is ${patternIndex} but the pattern count is ${this.predicates.length}`
          );
        }
        return C._ts_query_start_byte_for_pattern(this[0], patternIndex);
      }
      /** Get the byte offset where the given pattern ends in the query's source. */
      endIndexForPattern(patternIndex) {
        if (patternIndex >= this.predicates.length) {
          throw new Error(
            `Pattern index is ${patternIndex} but the pattern count is ${this.predicates.length}`
          );
        }
        return C._ts_query_end_byte_for_pattern(this[0], patternIndex);
      }
      /** Get the number of patterns in the query. */
      patternCount() {
        return C._ts_query_pattern_count(this[0]);
      }
      /** Get the index for a given capture name. */
      captureIndexForName(captureName) {
        return this.captureNames.indexOf(captureName);
      }
      /** Check if a given pattern within a query has a single root node. */
      isPatternRooted(patternIndex) {
        return C._ts_query_is_pattern_rooted(this[0], patternIndex) === 1;
      }
      /** Check if a given pattern within a query has a single root node. */
      isPatternNonLocal(patternIndex) {
        return C._ts_query_is_pattern_non_local(this[0], patternIndex) === 1;
      }
      /**
       * Check if a given step in a query is 'definite'.
       *
       * A query step is 'definite' if its parent pattern will be guaranteed to
       * match successfully once it reaches the step.
       */
      isPatternGuaranteedAtStep(byteIndex) {
        return C._ts_query_is_pattern_guaranteed_at_step(this[0], byteIndex) === 1;
      }
    };
  }
});
function grammarKeyForExt(ext) {
  return EXT_GRAMMAR[ext];
}
function resolveGrammarDir() {
  const env = process.env.CODEINDEX_GRAMMAR_DIR ?? process.env.ULTRAINDEX_GRAMMAR_DIR;
  if (env && existsSync2(env)) return env;
  const here = dirname2(fileURLToPath(import.meta.url));
  const candidates = [
    join22(here, "grammars"),
    // bundle: <...>/scripts/grammars
    join22(here, "..", "..", "scripts", "grammars"),
    // dev: src/ast → <repo>/scripts/grammars
    join22(here, "..", "scripts", "grammars")
  ];
  for (const c2 of candidates) if (existsSync2(c2)) return c2;
  return join22(here, "grammars");
}
async function ensureGrammars(keys) {
  const dir = resolveGrammarDir();
  if (!runtimeReady) {
    const runtime = join22(dir, "web-tree-sitter.wasm");
    if (!existsSync2(runtime)) return;
    await Parser.init({ wasmBinary: readFileSync22(runtime) });
    runtimeReady = true;
    parser = new Parser();
  }
  for (const key2 of new Set(keys)) {
    if (loaded.has(key2) || failed.has(key2)) continue;
    const wasm = join22(dir, `${key2}.wasm`);
    if (!existsSync2(wasm)) {
      failed.add(key2);
      continue;
    }
    try {
      loaded.set(key2, await Language.load(new Uint8Array(readFileSync22(wasm))));
    } catch {
      failed.add(key2);
    }
  }
}
function allGrammarKeys() {
  return [...new Set(Object.values(EXT_GRAMMAR))];
}
function grammarReady(key2) {
  return loaded.has(key2);
}
function parserFor(key2) {
  const lang = loaded.get(key2);
  if (!parser || !lang) return null;
  parser.setLanguage(lang);
  return parser;
}
var EXT_GRAMMAR;
var runtimeReady;
var parser;
var loaded;
var failed;
var init_loader = __esm({
  "src/ast/loader.ts"() {
    "use strict";
    init_web_tree_sitter();
    EXT_GRAMMAR = {
      ".ts": "typescript",
      ".mts": "typescript",
      ".cts": "typescript",
      ".tsx": "tsx",
      ".js": "javascript",
      ".jsx": "javascript",
      ".mjs": "javascript",
      ".cjs": "javascript",
      ".py": "python",
      ".pyi": "python",
      ".go": "go",
      ".rs": "rust",
      ".java": "java",
      ".rb": "ruby",
      ".rake": "ruby",
      ".c": "c",
      ".h": "c",
      ".cc": "cpp",
      ".cpp": "cpp",
      ".cxx": "cpp",
      ".hpp": "cpp",
      ".hh": "cpp",
      ".cs": "c_sharp",
      ".php": "php",
      ".scala": "scala",
      ".sc": "scala",
      ".sh": "bash",
      ".bash": "bash",
      ".lua": "lua"
    };
    runtimeReady = false;
    parser = null;
    loaded = /* @__PURE__ */ new Map();
    failed = /* @__PURE__ */ new Set();
  }
});
function collectRefIdents(root, defNames) {
  const found = /* @__PURE__ */ new Set();
  const visit = (node) => {
    if (node.namedChildCount === 0 && /identifier|constant|(^|_)name$/.test(node.type) && /^[A-Za-z_]\w{4,}$/.test(node.text) && !defNames.has(node.text)) {
      found.add(node.text);
    }
    for (let i2 = 0; i2 < node.namedChildCount; i2++) visit(node.namedChild(i2));
  };
  visit(root);
  return [...found].sort().slice(0, MAX_REF_IDENTS);
}
function firstLine(node) {
  const nl = node.text.indexOf("\n");
  return (nl === -1 ? node.text : node.text.slice(0, nl)).trim().slice(0, 200);
}
function nameOf(node) {
  const named = node.childForFieldName("name");
  if (named?.text) return named.text;
  let decl = node.childForFieldName("declarator");
  while (decl) {
    if (decl.namedChildCount === 0 && /(^|_)identifier$/.test(decl.type)) return decl.text;
    const next = decl.childForFieldName("declarator");
    if (!next || next === decl) break;
    decl = next;
  }
  for (let i2 = 0; i2 < node.namedChildCount; i2++) {
    const c2 = node.namedChild(i2);
    if (/(^|_)(identifier|name|constant)$/.test(c2.type)) return c2.text;
  }
  return void 0;
}
function collectImports(root, spec) {
  if (!spec.imports) return [];
  const out2 = [];
  const seen = /* @__PURE__ */ new Set();
  const add = (s) => {
    const v = s.trim();
    if (v && !seen.has(v)) {
      seen.add(v);
      out2.push({ kind: "import", spec: v });
    }
  };
  const visit = (node) => {
    const how = spec.imports[node.type];
    if (how === "string") {
      const str22 = findFirst(node, (n) => /string/.test(n.type));
      if (str22) add(str22.text.replace(/^['"]|['"]$/g, ""));
    } else if (how === "path") {
      const name2 = node.childForFieldName("name") ?? node.childForFieldName("module_name");
      add((name2 ?? node).text.replace(/^(import|from)\s+/, "").split(/\s+/)[0]);
    }
    for (let i2 = 0; i2 < node.namedChildCount; i2++) visit(node.namedChild(i2));
  };
  visit(root);
  return out2;
}
function findFirst(node, pred) {
  for (let i2 = 0; i2 < node.namedChildCount; i2++) {
    const c2 = node.namedChild(i2);
    if (pred(c2)) return c2;
    const deep = findFirst(c2, pred);
    if (deep) return deep;
  }
  return void 0;
}
function readName(node) {
  if (!node) return void 0;
  if (node.namedChildCount === 0) return IDENT_LEAF.test(node.type) ? node.text : void 0;
  const seg = node.childForFieldName("name") ?? node.childForFieldName("property") ?? node.childForFieldName("attribute") ?? node.childForFieldName("field") ?? // Callee wrappers that point at the real callee via a `function` field:
  // scala's generic_function (`foo[Int](x)`) and a curried/chained
  // call_expression callee (`curried(a)(b)`) — descend to the inner name
  // instead of tripping over type_arguments/arguments as the last child.
  node.childForFieldName("function");
  if (seg) return readName(seg);
  const last = node.namedChild(node.namedChildCount - 1);
  return last && last !== node ? readName(last) : void 0;
}
function readReceiver(node) {
  if (!node || node.namedChildCount === 0) return void 0;
  const obj = node.childForFieldName("object") ?? node.childForFieldName("operand") ?? node.childForFieldName("value") ?? node.childForFieldName("path") ?? node.childForFieldName("expression") ?? node.childForFieldName("argument") ?? node.childForFieldName("receiver") ?? node.childForFieldName("table");
  const name2 = obj ? readName(obj) : void 0;
  return name2 && /^[A-Za-z_]\w*$/.test(name2) ? name2 : void 0;
}
function collectCalls(root, spec) {
  if (!spec.calls) return [];
  const out2 = [];
  const seen = /* @__PURE__ */ new Set();
  const add = (name2, node, receiver) => {
    if (!name2 || name2.length < 2 || !/^[A-Za-z_]\w*$/.test(name2)) return;
    const line = node.startPosition.row + 1;
    const key2 = `${name2} ${line}`;
    if (seen.has(key2)) return;
    seen.add(key2);
    out2.push(receiver ? { name: name2, line, receiver } : { name: name2, line });
  };
  const visit = (node) => {
    const how = spec.calls[node.type];
    if (how === "function") {
      const callee = node.childForFieldName("function") ?? node.childForFieldName("callee") ?? node.childForFieldName("method") ?? node.childForFieldName("name");
      add(readName(callee), node, readReceiver(callee) ?? readReceiver(node));
    } else if (how === "member") {
      add(readName(node.childForFieldName("name")), node, readReceiver(node));
    } else if (how === "constructor") {
      let t = node.childForFieldName("constructor") ?? node.childForFieldName("type") ?? node.childForFieldName("name");
      for (let i2 = 0; !t && i2 < node.namedChildCount; i2++) {
        const c2 = node.namedChild(i2);
        if (IDENT_LEAF.test(c2.type)) t = c2;
      }
      add(readName(t), node, readReceiver(t ?? null));
    }
    for (let i2 = 0; i2 < node.namedChildCount; i2++) visit(node.namedChild(i2));
  };
  visit(root);
  out2.sort((a, b) => byStr(a.name, b.name) || a.line - b.line);
  return out2.slice(0, MAX_CALLS);
}
function collectImportedNames(root, spec) {
  if (!spec.imports?.import_statement) return [];
  const found = /* @__PURE__ */ new Set();
  const visit = (node) => {
    if (node.type === "import_statement") {
      for (let i2 = 0; i2 < node.namedChildCount; i2++) {
        const clause = node.namedChild(i2);
        if (clause.type !== "import_clause") continue;
        for (let j = 0; j < clause.namedChildCount; j++) {
          const named = clause.namedChild(j);
          if (named.type !== "named_imports") continue;
          for (let k = 0; k < named.namedChildCount; k++) {
            const specifier = named.namedChild(k);
            if (specifier.type !== "import_specifier") continue;
            const nm = specifier.childForFieldName("name") ?? specifier.namedChild(0);
            if (nm?.text) found.add(nm.text);
          }
        }
      }
    }
    for (let i2 = 0; i2 < node.namedChildCount; i2++) visit(node.namedChild(i2));
  };
  visit(root);
  return [...found].sort(byStr).slice(0, MAX_IMPORTED_NAMES);
}
function extractAst(rel, ext, content) {
  const key2 = grammarKeyForExt(ext);
  if (!key2 || !grammarReady(key2)) return void 0;
  const spec = SPECS[key2];
  if (!spec) return void 0;
  const parser2 = parserFor(key2);
  if (!parser2) return void 0;
  let tree = null;
  try {
    tree = parser2.parse(content);
    if (!tree) return void 0;
    const symbols = [];
    const root = tree.rootNode;
    const stem = (rel.split("/").pop() ?? "").replace(/\.[^.]+$/, "");
    const exportedNames = /* @__PURE__ */ new Set();
    const walk2 = (node, parent, exported) => {
      const nowExported = exported || node.type === "export_statement";
      if (node.type === "export_statement") {
        for (let i2 = 0; i2 < node.namedChildCount; i2++) {
          const c2 = node.namedChild(i2);
          if (c2.type === "identifier") exportedNames.add(c2.text);
          else if (c2.type === "export_clause") {
            for (let j = 0; j < c2.namedChildCount; j++) {
              const spec2 = c2.namedChild(j);
              const nm = spec2.childForFieldName("name") ?? spec2.namedChild(0);
              if (nm?.text) exportedNames.add(nm.text);
            }
          }
        }
        if (stem && node.children.some((c2) => c2.type === "default")) {
          for (let i2 = 0; i2 < node.namedChildCount; i2++) {
            const c2 = node.namedChild(i2);
            const fnLike = ANON_DEFAULT_FN.has(c2.type);
            const classLike = ANON_DEFAULT_CLASS.has(c2.type);
            if ((fnLike || classLike) && !c2.childForFieldName("name")) {
              symbols.push({
                name: stem,
                kind: classLike ? "class" : "function",
                file: rel,
                line: node.startPosition.row + 1,
                endLine: node.endPosition.row + 1,
                signature: firstLine(node),
                exported: true,
                lang: spec.lang
              });
              break;
            }
          }
        }
      }
      if (spec.assignments && node.type === "expression_statement") {
        const expr = node.namedChild(0);
        if (expr?.type === "assignment_expression") {
          const left = expr.childForFieldName("left");
          const right = expr.childForFieldName("right");
          if (left?.type === "member_expression" && left.text === "module.exports" && right) {
            if (right.type === "object") {
              for (let i2 = 0; i2 < right.namedChildCount; i2++) {
                const p = right.namedChild(i2);
                if (p.type === "shorthand_property_identifier") exportedNames.add(p.text);
                else if (p.type === "pair") {
                  const k = p.childForFieldName("key");
                  const v = p.childForFieldName("value");
                  if (k?.type === "property_identifier") exportedNames.add(k.text);
                  if (v?.type === "identifier") exportedNames.add(v.text);
                }
              }
              return;
            }
            if (right.type === "identifier") {
              exportedNames.add(right.text);
              return;
            }
          }
          const funcy = right && ["function_expression", "function", "generator_function", "arrow_function", "class"].includes(right.type);
          if (left && right && funcy) {
            let name2;
            let exportedAssign = false;
            if (left.type === "member_expression") {
              const prop = left.childForFieldName("property");
              if (prop?.type === "property_identifier") {
                name2 = prop.text;
                const obj = left.text.slice(0, left.text.length - prop.text.length - 1);
                exportedAssign = obj === "exports" || obj === "module.exports";
              }
            } else if (left.type === "identifier") {
              name2 = left.text;
            }
            if (name2) {
              symbols.push({
                name: name2,
                kind: right.type === "class" ? "class" : "function",
                file: rel,
                line: expr.startPosition.row + 1,
                endLine: expr.endPosition.row + 1,
                ...parent ? { parent } : {},
                signature: firstLine(expr),
                exported: nowExported || exportedAssign,
                lang: spec.lang
              });
              return;
            }
          } else if (left?.type === "member_expression" && right) {
            const prop = left.childForFieldName("property");
            if (prop?.type === "property_identifier") {
              const obj = left.text.slice(0, left.text.length - prop.text.length - 1);
              if (obj === "exports" || obj === "module.exports") {
                if (right.type === "identifier") exportedNames.add(right.text);
                if (right.type !== "identifier" || right.text !== prop.text) {
                  symbols.push({
                    name: prop.text,
                    kind: "const",
                    file: rel,
                    line: expr.startPosition.row + 1,
                    endLine: expr.endPosition.row + 1,
                    ...parent ? { parent } : {},
                    signature: firstLine(expr),
                    exported: true,
                    lang: spec.lang
                  });
                }
                return;
              }
            }
          }
        }
      }
      if (spec.assignments && node.type === "assignment_statement") {
        const vars = node.children.find((c2) => c2.type === "variable_list");
        const vals = node.children.find((c2) => c2.type === "expression_list");
        const pairs = Math.min(vars?.namedChildCount ?? 0, vals?.namedChildCount ?? 0);
        for (let i2 = 0; i2 < pairs; i2++) {
          const target = vars.namedChild(i2);
          const value = vals.namedChild(i2);
          if (value.type !== "function_definition" || !/^[\w.:]+$/.test(target.text)) continue;
          symbols.push({
            name: target.text,
            kind: "function",
            file: rel,
            line: node.startPosition.row + 1,
            endLine: node.endPosition.row + 1,
            ...parent ? { parent } : {},
            signature: firstLine(node),
            exported: nowExported || spec.exported(firstLine(node), target.text),
            lang: spec.lang
          });
        }
        return;
      }
      const kind = spec.defs[node.type];
      if (kind) {
        const name2 = nameOf(node);
        if (name2) {
          const line = firstLine(node);
          symbols.push({
            name: name2,
            kind,
            file: rel,
            line: node.startPosition.row + 1,
            endLine: node.endPosition.row + 1,
            ...parent ? { parent } : {},
            signature: line,
            exported: nowExported || spec.exported(line, name2),
            lang: spec.lang
          });
          for (let i2 = 0; i2 < node.namedChildCount; i2++) {
            walkBody(node.namedChild(i2), name2, nowExported);
          }
          return;
        }
      }
      if (spec.containers.has(node.type)) {
        for (let i2 = 0; i2 < node.namedChildCount; i2++) walk2(node.namedChild(i2), parent, nowExported);
      }
    };
    const walkBody = (node, parent, exported) => {
      if (spec.containers.has(node.type)) {
        for (let i2 = 0; i2 < node.namedChildCount; i2++) walk2(node.namedChild(i2), parent, exported);
      }
    };
    walk2(root, void 0, false);
    if (exportedNames.size) {
      for (const s of symbols) if (!s.exported && exportedNames.has(s.name)) s.exported = true;
    }
    const refs = collectImports(root, spec);
    const idents = collectRefIdents(root, new Set(symbols.map((s) => s.name)));
    const calls = collectCalls(root, spec);
    const importedNames = collectImportedNames(root, spec);
    let pkg;
    if (spec.lang === "java") {
      const p = findFirst(root, (n) => n.type === "package_declaration");
      if (p) pkg = p.text.replace(/^package\s+/, "").replace(/;.*$/, "").trim();
    }
    return { symbols, refs, pkg, idents, calls, importedNames };
  } catch {
    return void 0;
  } finally {
    tree?.delete();
  }
}
var MAX_REF_IDENTS;
var MAX_CALLS;
var MAX_IMPORTED_NAMES;
var ANON_DEFAULT_FN;
var ANON_DEFAULT_CLASS;
var byPublicKeyword;
var byNotPrivate;
var byNotLocal;
var byPub;
var byCapital;
var byPyConvention;
var always;
var neverExport;
var TS_SPEC;
var SPECS;
var IDENT_LEAF;
var init_extract = __esm({
  "src/ast/extract.ts"() {
    "use strict";
    init_sort();
    init_loader();
    MAX_REF_IDENTS = 256;
    MAX_CALLS = 512;
    MAX_IMPORTED_NAMES = 256;
    ANON_DEFAULT_FN = /* @__PURE__ */ new Set([
      "function",
      "function_expression",
      "function_declaration",
      "generator_function",
      "generator_function_declaration",
      "arrow_function"
    ]);
    ANON_DEFAULT_CLASS = /* @__PURE__ */ new Set(["class", "class_declaration", "abstract_class_declaration"]);
    byPublicKeyword = (line) => /\b(public|internal)\b/.test(line);
    byNotPrivate = (line) => !/\b(private|protected)\b/.test(line);
    byNotLocal = (line) => !/^local\b/.test(line);
    byPub = (line) => /\bpub\b/.test(line);
    byCapital = (_l, name2) => /^[A-Z]/.test(name2);
    byPyConvention = (_l, name2) => !name2.startsWith("_") || /^__\w+__$/.test(name2);
    always = () => true;
    neverExport = () => false;
    TS_SPEC = {
      lang: "typescript",
      defs: {
        function_declaration: "function",
        generator_function_declaration: "function",
        class_declaration: "class",
        abstract_class_declaration: "class",
        interface_declaration: "interface",
        type_alias_declaration: "type",
        enum_declaration: "enum",
        method_definition: "method",
        variable_declarator: "const"
      },
      containers: /* @__PURE__ */ new Set(["class_body", "export_statement", "program", "lexical_declaration", "variable_declaration"]),
      exported: neverExport,
      // export is tracked structurally via export_statement; see walk
      imports: { import_statement: "string" },
      calls: { call_expression: "function", new_expression: "constructor" },
      assignments: true
    };
    SPECS = {
      typescript: TS_SPEC,
      tsx: { ...TS_SPEC, lang: "typescript" },
      javascript: {
        ...TS_SPEC,
        lang: "javascript",
        defs: {
          function_declaration: "function",
          generator_function_declaration: "function",
          class_declaration: "class",
          method_definition: "method",
          variable_declarator: "const"
        }
      },
      python: {
        lang: "python",
        defs: { function_definition: "function", class_definition: "class" },
        containers: /* @__PURE__ */ new Set(["block", "decorated_definition", "module"]),
        exported: byPyConvention,
        imports: { import_statement: "path", import_from_statement: "path" },
        calls: { call: "function" }
      },
      go: {
        lang: "go",
        defs: {
          function_declaration: "function",
          method_declaration: "method",
          type_spec: "type",
          const_spec: "const",
          var_spec: "var"
        },
        containers: /* @__PURE__ */ new Set(["type_declaration", "const_declaration", "var_declaration", "source_file"]),
        exported: byCapital,
        imports: { import_declaration: "string" },
        calls: { call_expression: "function" }
      },
      ruby: {
        lang: "ruby",
        defs: { method: "def", singleton_method: "def", class: "class", module: "module" },
        containers: /* @__PURE__ */ new Set(["class", "module", "body_statement", "program"]),
        exported: always,
        // Ruby models every invocation — dotted, parenthesized, or bare command form
        // (`puts "x"`) — as a `call` node whose callee is the `method` field.
        calls: { call: "function" }
      },
      java: {
        lang: "java",
        defs: {
          class_declaration: "class",
          interface_declaration: "interface",
          enum_declaration: "enum",
          record_declaration: "record",
          method_declaration: "method",
          constructor_declaration: "constructor"
        },
        containers: /* @__PURE__ */ new Set(["class_body", "interface_body", "enum_body", "program"]),
        exported: byPublicKeyword,
        imports: { import_declaration: "path" },
        calls: { method_invocation: "function", object_creation_expression: "constructor" }
      },
      rust: {
        lang: "rust",
        defs: {
          function_item: "function",
          struct_item: "struct",
          enum_item: "enum",
          trait_item: "trait",
          type_item: "type",
          mod_item: "mod",
          const_item: "const",
          static_item: "static",
          union_item: "union",
          macro_definition: "macro"
        },
        containers: /* @__PURE__ */ new Set(["impl_item", "declaration_list", "source_file"]),
        exported: byPub,
        calls: { call_expression: "function" }
      },
      c_sharp: {
        lang: "csharp",
        defs: {
          class_declaration: "class",
          interface_declaration: "interface",
          struct_declaration: "struct",
          enum_declaration: "enum",
          record_declaration: "record",
          method_declaration: "method",
          constructor_declaration: "constructor",
          property_declaration: "property"
        },
        containers: /* @__PURE__ */ new Set(["namespace_declaration", "declaration_list", "compilation_unit", "file_scoped_namespace_declaration"]),
        exported: byPublicKeyword,
        calls: { invocation_expression: "function", object_creation_expression: "constructor" }
      },
      php: {
        lang: "php",
        defs: {
          function_definition: "function",
          class_declaration: "class",
          interface_declaration: "interface",
          trait_declaration: "trait",
          enum_declaration: "enum",
          method_declaration: "method"
        },
        containers: /* @__PURE__ */ new Set(["declaration_list", "program"]),
        exported: always,
        calls: { function_call_expression: "function", member_call_expression: "member", object_creation_expression: "constructor" }
      },
      c: {
        lang: "c",
        defs: {
          function_definition: "function",
          struct_specifier: "struct",
          enum_specifier: "enum",
          union_specifier: "union",
          type_definition: "type"
        },
        // C has no visibility keyword — headers are the interface, so everything
        // counts as exported (same stance as the regex extractor).
        containers: /* @__PURE__ */ new Set(["translation_unit", "declaration_list", "linkage_specification", "preproc_ifdef", "preproc_if"]),
        exported: always,
        calls: { call_expression: "function" }
      },
      cpp: {
        lang: "cpp",
        defs: {
          function_definition: "function",
          class_specifier: "class",
          struct_specifier: "struct",
          enum_specifier: "enum",
          union_specifier: "union",
          type_definition: "type",
          namespace_definition: "namespace"
        },
        containers: /* @__PURE__ */ new Set([
          "translation_unit",
          "declaration_list",
          "field_declaration_list",
          "template_declaration",
          "linkage_specification",
          "preproc_ifdef",
          "preproc_if"
        ]),
        exported: always,
        calls: { call_expression: "function", new_expression: "constructor" }
      },
      scala: {
        lang: "scala",
        defs: {
          class_definition: "class",
          object_definition: "object",
          trait_definition: "trait",
          enum_definition: "enum",
          function_definition: "def",
          function_declaration: "def",
          val_definition: "val",
          var_definition: "var",
          type_definition: "type",
          given_definition: "given"
        },
        // package_clause carries braced-package bodies (`package com.acme { … }`);
        // template_body is every class/object/trait body.
        containers: /* @__PURE__ */ new Set(["compilation_unit", "package_clause", "template_body"]),
        exported: byNotPrivate,
        // Qualified calls are call_expression → field_expression (value/field);
        // `new Widget(...)` is an instance_expression with a bare type child.
        calls: { call_expression: "function", instance_expression: "constructor" }
      },
      bash: {
        lang: "shell",
        defs: { function_definition: "function" },
        // if/compound bodies carry guarded definitions (`if …; then f() { … }; fi`).
        containers: /* @__PURE__ */ new Set(["program", "if_statement", "compound_statement"]),
        // Shell has no visibility — every function is callable from outside.
        exported: always,
        // Every invocation is a `command` whose `name` field is a command_name
        // wrapping a `word` leaf (hence IDENT_LEAF includes `word`).
        calls: { command: "function" }
      },
      lua: {
        lang: "lua",
        defs: { function_declaration: "function" },
        // variable_declaration wraps `local x = function()` assignment statements.
        containers: /* @__PURE__ */ new Set(["chunk", "variable_declaration"]),
        exported: byNotLocal,
        // function_call's `name` is an identifier, a dot_index_expression
        // (table/field) or a method_index_expression (table/method) — the receiver
        // is the `table` field in both qualified forms.
        calls: { function_call: "function" },
        assignments: true
        // `M.alias = function(z) … end` (assignment_statement shape)
      }
    };
    IDENT_LEAF = /(^|_)(identifier|name|constant|word)$/;
  }
});
function isDirective(line) {
  return DIRECTIVE_RE.test(line.trim());
}
function isBanner(line) {
  return BANNER_RE.test(line.trim());
}
function topDocComment(content) {
  const lines = content.split(/\r?\n/);
  const collected = [];
  let inBlock = null;
  for (let i2 = 0; i2 < Math.min(lines.length, 40); i2++) {
    const raw = lines[i2];
    const line = raw.trim();
    if (inBlock === "c") {
      collected.push(line.replace(/\*+\/\s*$/, "").replace(/^\*+/, "").trim());
      if (line.includes("*/")) inBlock = null;
      continue;
    }
    if (inBlock === "py") {
      if (line.includes('"""') || line.includes("'''")) {
        collected.push(line.replace(/['"]{3}.*$/, "").trim());
        inBlock = null;
      } else collected.push(line);
      continue;
    }
    if (line === "" && collected.length === 0) continue;
    if (line.startsWith("#!")) continue;
    if (line.startsWith("//")) {
      collected.push(line.replace(/^\/+/, "").trim());
      continue;
    }
    if (line.startsWith("#")) {
      collected.push(line.replace(/^#+/, "").trim());
      continue;
    }
    if (line.startsWith("/*")) {
      collected.push(line.replace(/^\/\*+!?/, "").replace(/\*+\/\s*$/, "").trim());
      if (!line.includes("*/")) inBlock = "c";
      continue;
    }
    if (line.startsWith('"""') || line.startsWith("'''")) {
      const rest = line.slice(3);
      if (rest.includes('"""') || rest.includes("'''")) collected.push(rest.replace(/['"]{3}.*$/, "").trim());
      else {
        collected.push(rest.trim());
        inBlock = "py";
      }
      continue;
    }
    break;
  }
  const text = collected.filter((l) => l && !isDirective(l) && !isBanner(l)).join(" ").replace(/\s+/g, " ").trim();
  if (text.length < 8) return void 0;
  const sentence = /^(.*?[.!?])(\s|$)/.exec(text);
  return (sentence ? sentence[1] : text).slice(0, 200);
}
function expandUseGroups(path, out2 = []) {
  if (out2.length >= MAX_USE_EXPANSION) return out2;
  const brace = path.indexOf("{");
  if (brace === -1) {
    const cleaned = path.replace(/\s+as\s+\w+\s*$/, "").replace(/::\s*\*\s*$/, "").replace(/^::/, "").trim();
    if (cleaned) out2.push(cleaned);
    return out2;
  }
  const prefix = path.slice(0, brace);
  let depth = 0;
  let end = -1;
  for (let i2 = brace; i2 < path.length; i2++) {
    if (path[i2] === "{") depth++;
    else if (path[i2] === "}" && --depth === 0) {
      end = i2;
      break;
    }
  }
  if (end === -1) return out2;
  const parts2 = [];
  let cur = "";
  depth = 0;
  for (const ch of path.slice(brace + 1, end)) {
    if (ch === "{") depth++;
    if (ch === "}") depth--;
    if (ch === "," && depth === 0) {
      parts2.push(cur);
      cur = "";
    } else cur += ch;
  }
  parts2.push(cur);
  for (const part of parts2) {
    const t = part.trim();
    if (!t) continue;
    if (t === "self") expandUseGroups(prefix.replace(/::\s*$/, ""), out2);
    else expandUseGroups(prefix + t, out2);
  }
  return out2;
}
function extractImports(ext, content) {
  const specs = /* @__PURE__ */ new Set();
  const lines = content.split(/\r?\n/);
  if (JS_TS.has(ext)) {
    let m;
    const from = /(?:^|[^\w$.])(?:import|export)\b[^'"]*?\bfrom\s*['"]([^'"]+)['"]/g;
    while (m = from.exec(content)) specs.add(m[1]);
    const bare = /(?:^|[\n;])\s*import\s*['"]([^'"]+)['"]/g;
    while (m = bare.exec(content)) specs.add(m[1]);
    const req = /\brequire\(\s*['"]([^'"]+)['"]\s*\)/g;
    while (m = req.exec(content)) specs.add(m[1]);
    const dyn = /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g;
    while (m = dyn.exec(content)) specs.add(m[1]);
  } else if (PY.has(ext)) {
    for (const line of lines) {
      const from = /^\s*from\s+(\.*[\w.]*)\s+import\b/.exec(line);
      if (from) {
        specs.add(from[1]);
        continue;
      }
      const imp = /^\s*import\s+(.+)$/.exec(line);
      if (imp) {
        for (const part of imp[1].split(",")) {
          const name2 = part.trim().split(/\s+as\s+/)[0].trim();
          if (name2 && /^[\w.]+$/.test(name2)) specs.add(name2);
        }
      }
    }
  } else if (ext === ".go") {
    let inBlock = false;
    for (const line of lines) {
      const t = line.trim();
      if (inBlock) {
        if (t === ")") {
          inBlock = false;
          continue;
        }
        const b = /"([^"]+)"/.exec(t);
        if (b) specs.add(b[1]);
        continue;
      }
      if (/^import\s*\($/.test(t)) {
        inBlock = true;
        continue;
      }
      const single = /^import\s+(?:[\w.]+\s+)?"([^"]+)"/.exec(t);
      if (single) specs.add(single[1]);
    }
  } else if (ext === ".rs") {
    let m;
    const modRe = /^\s*(?:pub(?:\([^)]*\))?\s+)?mod\s+([A-Za-z_]\w*)\s*;/gm;
    while (m = modRe.exec(content)) specs.add(`mod ${m[1]}`);
    const useRe = /^\s*(?:pub(?:\([^)]*\))?\s+)?use\s+([^;]+);/gm;
    while (m = useRe.exec(content)) {
      for (const p of expandUseGroups(m[1].trim())) specs.add(p);
    }
  } else if (ext === ".java") {
    let m;
    const imp = /^\s*import\s+(?:static\s+)?([\w.]+(?:\.\*)?)\s*;/gm;
    while (m = imp.exec(content)) specs.add(m[1]);
  } else if (ext === ".rb" || ext === ".rake") {
    let m;
    const rel = /^\s*require_relative\s+['"]([^'"]+)['"]/gm;
    while (m = rel.exec(content)) specs.add(/^\.\.?\//.test(m[1]) ? m[1] : "./" + m[1]);
    const req = /^\s*require\s+['"]([^'"]+)['"]/gm;
    while (m = req.exec(content)) specs.add(m[1]);
  } else if (C_CPP.has(ext)) {
    let m;
    const inc = /^\s*#\s*include\s*"([^"]+)"/gm;
    while (m = inc.exec(content)) specs.add(m[1]);
  } else if (ext === ".php") {
    let m;
    const use = /^\s*use\s+(?:function\s+|const\s+)?\\?([A-Za-z_][\w\\]*)\s*(?:as\s+\w+)?\s*;/gm;
    while (m = use.exec(content)) specs.add(m[1]);
    const inc = /\b(?:require|include)(?:_once)?\s*\(?\s*['"]([^'"]+)['"]/g;
    while (m = inc.exec(content)) specs.add(/^\.\.?\//.test(m[1]) ? m[1] : "./" + m[1]);
  } else if (ext === ".cs") {
    let m;
    const using = /^\s*(?:global\s+)?using\s+(?:static\s+)?([A-Za-z_][\w.]*)\s*;/gm;
    while (m = using.exec(content)) specs.add(m[1]);
  }
  return [...specs].map((spec) => ({ kind: "import", spec }));
}
function extractReexports(rel, content) {
  if (!JS_TS.has(rel.slice(rel.lastIndexOf(".")))) return [];
  const lang = /\.(ts|tsx|mts|cts)$/.test(rel) ? "typescript" : "javascript";
  const out2 = [];
  const seen = /* @__PURE__ */ new Set();
  const lineAt = (idx) => content.slice(0, idx).split(/\r?\n/).length;
  const named = /export\s*\{([\s\S]*?)\}\s*(?:from\s*['"]([^'"]+)['"])?\s*;?/g;
  let m;
  while ((m = named.exec(content)) && out2.length < 60) {
    const from = m[2];
    for (const part of m[1].split(",")) {
      const p = part.trim().replace(/^type\s+/, "");
      const as = /^(\S+)\s+as\s+([A-Za-z_$][\w$]*)$/.exec(p);
      const name2 = as ? as[2] : p;
      if (!/^[A-Za-z_$][\w$]*$/.test(name2) || name2 === "default" || seen.has(name2)) continue;
      seen.add(name2);
      out2.push({
        name: name2,
        kind: "reexport",
        file: rel,
        line: lineAt(m.index),
        signature: from ? `export { ${name2} } from "${from}"` : `export { ${name2} }`,
        exported: true,
        lang
      });
    }
  }
  const star = /export\s*\*\s*(?:as\s+([A-Za-z_$][\w$]*)\s+)?from\s*['"]([^'"]+)['"]/g;
  while ((m = star.exec(content)) && out2.length < 60) {
    const ns = m[1];
    const from = m[2];
    const key2 = "*" + (ns ?? from);
    if (seen.has(key2)) continue;
    seen.add(key2);
    out2.push({
      name: ns ?? `* (${from})`,
      kind: ns ? "reexport" : "reexport-all",
      file: rel,
      line: lineAt(m.index),
      signature: `export * ${ns ? `as ${ns} ` : ""}from "${from}"`,
      exported: true,
      lang
    });
  }
  return out2;
}
function collectCallsRegex(content) {
  const out2 = /* @__PURE__ */ new Map();
  const lines = content.split("\n");
  const CALL_RE = /(?:\bnew\s+)?(?:([A-Za-z_$][\w$]*)\s*\.\s*)?([A-Za-z_$][\w$]*)\s*\(/g;
  for (let i2 = 0; i2 < lines.length && out2.size < 512; i2++) {
    const line = lines[i2];
    const trimmed = line.trimStart();
    if (trimmed.startsWith("//") || trimmed.startsWith("#") || trimmed.startsWith("*")) continue;
    CALL_RE.lastIndex = 0;
    let m;
    while ((m = CALL_RE.exec(line)) !== null && out2.size < 512) {
      const receiver = m[1];
      const name2 = m[2];
      if (name2.length < 2 || CALL_KEYWORDS.has(name2)) continue;
      if (DEF_INTRODUCERS.test(line.slice(0, m.index))) continue;
      const key2 = `${name2} ${i2 + 1}`;
      if (!out2.has(key2)) out2.set(key2, receiver ? { name: name2, line: i2 + 1, receiver } : { name: name2, line: i2 + 1 });
    }
  }
  return [...out2.values()].sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : a.line - b.line);
}
function extractCode(rel, ext, content) {
  const ast = extractAst(rel, ext, content);
  const symbols = (ast ? ast.symbols : extractSymbols(rel, ext, content)).slice(0, 400);
  const known = new Set(symbols.map((s) => s.name));
  const reexports = extractReexports(rel, content).filter((s) => !known.has(s.name));
  return {
    symbols: [...symbols, ...reexports],
    summary: topDocComment(content),
    refs: extractImports(ext, content),
    // pkg anchors namespace→source-root resolution: Java's `package`, C#'s
    // `namespace` (block or file-scoped). Both feed the same resolver pattern.
    pkg: ext === ".java" ? /^\s*package\s+([\w.]+)\s*;/m.exec(content)?.[1] : ext === ".cs" ? /^\s*(?:file-scoped\s+)?namespace\s+([\w.]+)/m.exec(content)?.[1] : void 0,
    idents: ast?.idents,
    // AST call sites when a grammar parsed the file; the conservative regex
    // collector otherwise, so caller indexes exist without the wasm sidecar.
    calls: ast ? ast.calls : collectCallsRegex(content),
    importedNames: ast?.importedNames
  };
}
var JS_TS;
var PY;
var C_CPP;
var DIRECTIVE_RE;
var BANNER_RE;
var MAX_USE_EXPANSION;
var CALL_KEYWORDS;
var DEF_INTRODUCERS;
var init_code = __esm({
  "src/extract/code.ts"() {
    "use strict";
    init_registry();
    init_extract();
    JS_TS = /* @__PURE__ */ new Set([".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"]);
    PY = /* @__PURE__ */ new Set([".py", ".pyi"]);
    C_CPP = /* @__PURE__ */ new Set([".c", ".h", ".cc", ".cpp", ".cxx", ".hpp", ".hh"]);
    DIRECTIVE_RE = /^(eslint\b|eslint-|prettier\b|prettier-|tslint\b|jshint\b|jslint\b|globals?\b|istanbul\b|c8\s|v8\s|@ts-|ts-|@flow\b|@jsx\b|@jsxRuntime\b|@jest-environment\b|@vitest-environment\b|@license\b|@preserve\b|@copyright\b|copyright\b|spdx-|<reference\b|use strict|biome-|deno-lint|noqa\b|type:\s*ignore|pylint:|flake8:|mypy:|coding[:=])/i;
    BANNER_RE = /^((?:mit|isc|bsd|apache|gnu|gpl|mpl|lgpl|agpl)\s+licen[sc]ed?\b|licen[sc]ed\b|(?:released|distributed)\s+under\b|all rights reserved\b|https?:\/\/|www\.)/i;
    MAX_USE_EXPANSION = 16;
    CALL_KEYWORDS = /* @__PURE__ */ new Set([
      "if",
      "else",
      "elif",
      "for",
      "while",
      "do",
      "switch",
      "case",
      "match",
      "when",
      "unless",
      "until",
      "catch",
      "except",
      "return",
      "throw",
      "raise",
      "yield",
      "await",
      "typeof",
      "instanceof",
      "sizeof",
      "delete",
      "void",
      "in",
      "of",
      "not",
      "and",
      "or",
      "assert",
      "defer",
      "select",
      "with",
      "loop"
    ]);
    DEF_INTRODUCERS = /(?:\bfunction|\bdef|\bfunc|\bfun|\bfn|\bclass|\bsub|\bmacro|\bproc)\s*[*]?\s*$/;
  }
});
function countLines(s) {
  if (!s) return 0;
  let n = 1;
  for (let i2 = 0; i2 < s.length; i2++) if (s.charCodeAt(i2) === 10) n++;
  return n;
}
function scanRepo(root, opts = {}) {
  const scoped = opts.scope ? [...opts.include ?? [], `${opts.scope.replace(/\/+$/, "")}/**`] : opts.include;
  const include = compileGlobs(scoped);
  const exclude = compileGlobs(opts.exclude);
  const { files: walked, capped, excluded } = walk(root, {
    maxFileBytes: opts.maxBytes,
    maxFiles: opts.maxFiles,
    gitignore: opts.gitignore
  });
  const outPrefix = opts.out ? opts.out.replace(/\/+$/, "") + "/" : null;
  const files = [];
  const languages = {};
  const docText = /* @__PURE__ */ new Map();
  const mtimes = /* @__PURE__ */ new Map();
  for (const f of walked) {
    if (outPrefix && (f.abs === opts.out || f.abs.startsWith(outPrefix))) continue;
    if (include && !include(f.rel)) continue;
    if (exclude && exclude(f.rel)) continue;
    const kind = classify(f.rel, f.ext);
    const lang = extToLang(f.ext);
    languages[lang] = (languages[lang] ?? 0) + 1;
    mtimes.set(f.rel, f.mtimeMs);
    const cached = opts.cache?.get(f.rel);
    if (kind !== "doc" && !opts.fullHash && cached && cached.size !== void 0 && cached.mtimeMs !== void 0 && cached.size === f.size && cached.mtimeMs === f.mtimeMs) {
      files.push(cached.record);
      continue;
    }
    const content = readText2(f.abs);
    const hash = sha1(content);
    if (cached && cached.hash === hash) {
      files.push(cached.record);
      if (kind === "doc" && content) docText.set(f.rel, content);
      continue;
    }
    const record = {
      rel: f.rel,
      ext: f.ext,
      size: f.size,
      lines: countLines(content),
      hash,
      kind,
      lang,
      headings: [],
      symbols: [],
      refs: []
    };
    if (content) {
      if (kind === "doc" && MARKDOWN_EXT.has(f.ext)) {
        const md = extractMarkdown(content);
        record.title = md.title ?? basename2(f.rel);
        record.summary = md.summary;
        record.headings = md.headings;
        record.refs = md.refs;
      } else if (kind === "doc") {
        record.title = basename2(f.rel);
      } else if (kind === "code") {
        const code = extractCode(f.rel, f.ext, content);
        record.title = basename2(f.rel);
        record.summary = code.summary;
        record.symbols = code.symbols;
        record.refs = code.refs;
        record.pkg = code.pkg;
        record.idents = code.idents;
        record.calls = code.calls;
        record.importedNames = code.importedNames;
      } else {
        record.title = basename2(f.rel);
      }
    } else {
      record.title = basename2(f.rel);
    }
    if (kind === "doc" && content) docText.set(f.rel, content);
    files.push(record);
  }
  files.sort(byKey((f) => f.rel));
  return { root, commit: headCommit(root), files, languages, docText, mtimes, capped, excluded };
}
var init_scan = __esm({
  "src/scan.ts"() {
    "use strict";
    init_walk();
    init_git();
    init_hash();
    init_classify();
    init_registry();
    init_glob();
    init_sort();
    init_markdown();
    init_code();
  }
});
function distToSrcCandidates(target) {
  const segs = norm(target).split("/").filter((s) => s !== ".");
  const out2 = [];
  let i2 = 0;
  while (i2 < segs.length - 1 && BUILD_DIRS.has(segs[i2])) {
    i2++;
    const rest = segs.slice(i2).join("/");
    out2.push("src/" + rest, rest);
  }
  return out2;
}
function norm(p) {
  return posix.normalize(p).replace(/\/$/, "");
}
function firstThat(fileSet, candidates) {
  for (const c2 of candidates) {
    const n = norm(c2);
    if (fileSet.has(n)) return n;
  }
  return void 0;
}
function byLen(a, b) {
  return a.length - b.length || (a < b ? -1 : a > b ? 1 : 0);
}
function tolerantJsonParse(text) {
  let stripped = "";
  let inStr = false;
  for (let i2 = 0; i2 < text.length; i2++) {
    const c2 = text[i2];
    if (inStr) {
      stripped += c2;
      if (c2 === "\\") stripped += text[++i2] ?? "";
      else if (c2 === '"') inStr = false;
      continue;
    }
    if (c2 === '"') {
      inStr = true;
      stripped += c2;
    } else if (c2 === "/" && text[i2 + 1] === "/") {
      while (i2 < text.length && text[i2] !== "\n") i2++;
      stripped += "\n";
    } else if (c2 === "/" && text[i2 + 1] === "*") {
      i2 += 2;
      while (i2 < text.length && !(text[i2] === "*" && text[i2 + 1] === "/")) i2++;
      i2++;
    } else {
      stripped += c2;
    }
  }
  let out2 = "";
  inStr = false;
  for (let i2 = 0; i2 < stripped.length; i2++) {
    const c2 = stripped[i2];
    if (inStr) {
      out2 += c2;
      if (c2 === "\\") out2 += stripped[++i2] ?? "";
      else if (c2 === '"') inStr = false;
      continue;
    }
    if (c2 === '"') {
      inStr = true;
      out2 += c2;
      continue;
    }
    if (c2 === ",") {
      let j = i2 + 1;
      while (j < stripped.length && (stripped[j] === " " || stripped[j] === "	" || stripped[j] === "\n" || stripped[j] === "\r")) j++;
      if (stripped[j] === "}" || stripped[j] === "]") continue;
    }
    out2 += c2;
  }
  try {
    return JSON.parse(out2);
  } catch {
    return void 0;
  }
}
function resolveExtends(fileSet, fromDir, ext) {
  const base = norm(posix.join(fromDir, ext));
  const cands = ext.endsWith(".json") ? [base] : [base + ".json", posix.join(base, "tsconfig.json")];
  for (const c2 of cands) if (fileSet.has(c2)) return c2;
  return void 0;
}
function readTsConfig(root, fileSet, rel, warnings, seen) {
  if (seen.has(rel)) return void 0;
  seen.add(rel);
  const cfg = tolerantJsonParse(readText2(join3(root, rel)));
  if (cfg === void 0) {
    warnings.push(`unparseable ${rel} \u2014 its path aliases were ignored`);
    return void 0;
  }
  const dir = rel.includes("/") ? posix.dirname(rel) : "";
  const eff = { baseUrlDir: "", pathsDir: "" };
  const exts = cfg.extends === void 0 ? [] : Array.isArray(cfg.extends) ? cfg.extends : [cfg.extends];
  for (const ext of exts) {
    if (typeof ext !== "string") continue;
    const baseRel = resolveExtends(fileSet, dir, ext);
    if (!baseRel) {
      if (/^\.\.?\//.test(ext)) warnings.push(`${rel} extends "${ext}" which is missing \u2014 its path aliases were ignored`);
      continue;
    }
    const inherited = readTsConfig(root, fileSet, baseRel, warnings, seen);
    if (inherited?.baseUrl !== void 0) {
      eff.baseUrl = inherited.baseUrl;
      eff.baseUrlDir = inherited.baseUrlDir;
    }
    if (inherited?.paths) {
      eff.paths = inherited.paths;
      eff.pathsDir = inherited.pathsDir;
    }
  }
  const co = cfg.compilerOptions;
  if (co?.baseUrl !== void 0) {
    eff.baseUrl = co.baseUrl;
    eff.baseUrlDir = dir;
  }
  if (co?.paths) {
    eff.paths = co.paths;
    eff.pathsDir = dir;
  }
  return eff;
}
function conditionRank(key2) {
  const i2 = CONDITION_PRIORITY.indexOf(key2);
  if (i2 !== -1) return i2;
  return key2 === "types" ? CONDITION_PRIORITY.length + 1 : CONDITION_PRIORITY.length;
}
function flattenExportTargets(value, out2) {
  if (out2.length >= MAX_EXPORT_TARGETS) return;
  if (typeof value === "string") {
    if (!out2.includes(value)) out2.push(value);
  } else if (Array.isArray(value)) {
    for (const v of value) flattenExportTargets(v, out2);
  } else if (value !== null && typeof value === "object") {
    const keys = Object.keys(value).sort((a, b) => conditionRank(a) - conditionRank(b) || (a < b ? -1 : a > b ? 1 : 0));
    for (const k of keys) flattenExportTargets(value[k], out2);
  }
}
function parseExportEntries(exportsField) {
  if (exportsField === void 0 || exportsField === null) return [];
  const entries = [];
  const push = (key2, value) => {
    const targets = [];
    flattenExportTargets(value, targets);
    if (targets.length) entries.push({ key: key2, star: key2.includes("*"), targets });
  };
  if (typeof exportsField === "string" || Array.isArray(exportsField)) {
    push(".", exportsField);
  } else if (typeof exportsField === "object") {
    const keys = Object.keys(exportsField);
    if (keys.every((k) => k === "." || k.startsWith("./"))) {
      for (const k of keys) push(k, exportsField[k]);
    } else {
      push(".", exportsField);
    }
  }
  entries.sort((a, b) => Number(a.star) - Number(b.star) || b.key.length - a.key.length || (a.key < b.key ? -1 : 1));
  return entries;
}
function parseGoReplaces(text, modDir) {
  const out2 = [];
  const addLine = (line) => {
    const m = /^\s*([^\s=]+)(?:\s+v\S+)?\s*=>\s*(\S+)(?:\s+v\S+)?\s*$/.exec(line);
    if (!m) return;
    const target = m[2];
    if (!/^\.\.?\//.test(target)) return;
    const toDir = norm(posix.join(modDir, target));
    if (toDir.startsWith("..")) return;
    out2.push({ from: m[1], toDir });
  };
  for (const m of text.matchAll(/^[ \t]*replace[ \t]+([^(\r\n][^\r\n]*)$/gm)) addLine(m[1]);
  for (const b of text.matchAll(/^[ \t]*replace[ \t]*\(([\s\S]*?)\)/gm)) {
    for (const line of b[1].split(/\r?\n/)) addLine(line);
  }
  return out2;
}
function buildResolveContext(scan2) {
  const fileSet = new Set(scan2.files.map((f) => f.rel));
  const filesByDir = /* @__PURE__ */ new Map();
  const dirSet = /* @__PURE__ */ new Set();
  for (const f of scan2.files) {
    const dir = f.rel.includes("/") ? posix.dirname(f.rel) : "";
    let list = filesByDir.get(dir);
    if (!list) filesByDir.set(dir, list = []);
    list.push(f.rel);
    let d = dir;
    while (d) {
      if (dirSet.has(d)) break;
      dirSet.add(d);
      d = d.includes("/") ? posix.dirname(d) : "";
    }
  }
  const warnings = [];
  const tsConfigs = [];
  for (const rel of fileSet) {
    const base = rel.slice(rel.lastIndexOf("/") + 1);
    const isRootBase = rel === "tsconfig.base.json";
    if (base !== "tsconfig.json" && base !== "jsconfig.json" && !isRootBase) continue;
    const dir = rel.includes("/") ? posix.dirname(rel) : "";
    const eff = readTsConfig(scan2.root, fileSet, rel, warnings, /* @__PURE__ */ new Set());
    if (!eff?.paths) continue;
    const tsPaths = [];
    for (const [alias, targets] of Object.entries(eff.paths)) {
      if (!Array.isArray(targets)) continue;
      const star = alias.endsWith("*");
      tsPaths.push({ prefix: star ? alias.slice(0, -1) : alias, star, targets });
    }
    if (!tsPaths.length) continue;
    const baseUrl = eff.baseUrl !== void 0 ? norm(posix.join(eff.baseUrlDir, eff.baseUrl)).replace(/^\.$/, "") : eff.pathsDir;
    tsConfigs.push({ dir, baseUrl, paths: tsPaths });
  }
  tsConfigs.sort((a, b) => b.dir.length - a.dir.length);
  const goModules = [];
  for (const rel of fileSet) {
    if (rel !== "go.mod" && !rel.endsWith("/go.mod")) continue;
    const text = readText2(join3(scan2.root, rel));
    const m = /^\s*module\s+(\S+)/m.exec(text);
    if (!m) continue;
    const dir = rel.includes("/") ? posix.dirname(rel) : "";
    goModules.push({ module: m[1], dir, replaces: parseGoReplaces(text, dir) });
  }
  goModules.sort((a, b) => b.dir.length - a.dir.length || (a.dir < b.dir ? -1 : 1));
  const rustCrates = [];
  for (const rel of fileSet) {
    if (rel !== "Cargo.toml" && !rel.endsWith("/Cargo.toml")) continue;
    const text = readText2(join3(scan2.root, rel));
    const m = /\[package\][^[]*?^\s*name\s*=\s*"([^"]+)"/ms.exec(text);
    if (!m) continue;
    const dir = rel.includes("/") ? posix.dirname(rel) : "";
    const srcDir = norm(posix.join(dir, "src")).replace(/^\.$/, "");
    const rootFile = firstThat(fileSet, [posix.join(srcDir, "lib.rs"), posix.join(srcDir, "main.rs")]);
    rustCrates.push({ name: m[1].replace(/-/g, "_"), dir, srcDir, rootFile });
  }
  rustCrates.sort((a, b) => b.dir.length - a.dir.length || (a.dir < b.dir ? -1 : 1));
  const javaRoots = /* @__PURE__ */ new Set();
  for (const f of scan2.files) {
    if (f.ext !== ".java" || !f.pkg) continue;
    const dir = f.rel.includes("/") ? posix.dirname(f.rel) : "";
    const pkgPath = f.pkg.replace(/\./g, "/");
    if (dir === pkgPath) javaRoots.add("");
    else if (dir.endsWith("/" + pkgPath)) javaRoots.add(dir.slice(0, -pkgPath.length - 1));
  }
  const pyRoots = /* @__PURE__ */ new Set([""]);
  for (const rel of fileSet) {
    const base = rel.split("/").pop();
    if (base === "__init__.py" || base === "pyproject.toml" || base === "setup.py") {
      pyRoots.add(rel.includes("/") ? posix.dirname(rel) : "");
    }
  }
  const workspacePackages = [];
  for (const rel of fileSet) {
    if (rel !== "package.json" && !rel.endsWith("/package.json")) continue;
    const pkg = tolerantJsonParse(readText2(join3(scan2.root, rel)));
    if (pkg === void 0) {
      warnings.push(`unparseable ${rel} \u2014 skipped for workspace resolution`);
      continue;
    }
    if (typeof pkg.name !== "string") continue;
    const mainCandidates = [pkg.source, pkg.main, pkg.module, pkg.types].filter(
      (v) => typeof v === "string"
    );
    workspacePackages.push({
      name: pkg.name,
      dir: rel.includes("/") ? posix.dirname(rel) : "",
      exportEntries: parseExportEntries(pkg.exports),
      mainCandidates
    });
  }
  workspacePackages.sort((a, b) => b.name.length - a.name.length);
  const cIncludeRoots = /* @__PURE__ */ new Set([""]);
  for (const d of dirSet) {
    const base = d.slice(d.lastIndexOf("/") + 1);
    if (base === "include" || base === "inc" || base === "src") cIncludeRoots.add(d);
  }
  const rubyLibRoots = /* @__PURE__ */ new Set([""]);
  for (const d of dirSet) if (d.slice(d.lastIndexOf("/") + 1) === "lib") rubyLibRoots.add(d);
  const phpPsr4 = [];
  for (const rel of fileSet) {
    if (rel !== "composer.json" && !rel.endsWith("/composer.json")) continue;
    const composer = tolerantJsonParse(readText2(join3(scan2.root, rel)));
    if (!composer) {
      warnings.push(`unparseable ${rel} \u2014 skipped for PHP PSR-4 resolution`);
      continue;
    }
    const baseDir = rel.includes("/") ? posix.dirname(rel) : "";
    for (const block of [composer.autoload?.["psr-4"], composer["autoload-dev"]?.["psr-4"]]) {
      if (!block) continue;
      for (const [prefix, dirs] of Object.entries(block)) {
        for (const d of Array.isArray(dirs) ? dirs : [dirs]) {
          if (typeof d !== "string") continue;
          phpPsr4.push({ prefix: prefix.replace(/\\+$/, ""), dir: norm(posix.join(baseDir, d)).replace(/^\.$/, "") });
        }
      }
    }
  }
  phpPsr4.sort((a, b) => b.prefix.length - a.prefix.length);
  const csharpNamespaces = /* @__PURE__ */ new Map();
  for (const f of scan2.files) {
    if (f.ext !== ".cs" || !f.pkg) continue;
    let arr = csharpNamespaces.get(f.pkg);
    if (!arr) csharpNamespaces.set(f.pkg, arr = []);
    arr.push(f.rel);
  }
  for (const arr of csharpNamespaces.values()) arr.sort(byStr);
  return {
    fileSet,
    dirSet,
    filesByDir,
    tsConfigs,
    goModules,
    rustCrates,
    javaRoots: [...javaRoots].sort(byLen),
    pyRoots: [...pyRoots],
    workspacePackages,
    cIncludeRoots: [...cIncludeRoots].sort(byLen),
    rubyLibRoots: [...rubyLibRoots].sort(byLen),
    phpPsr4,
    csharpNamespaces,
    warnings
  };
}
function firstExisting(ctx, candidates) {
  for (const c2 of candidates) {
    const n = norm(c2);
    if (n && !n.startsWith("..") && ctx.fileSet.has(n)) return n;
  }
  return void 0;
}
function resolveDocLink(fromRel, spec, ctx) {
  let target = spec.split("#")[0].split("?")[0];
  if (!target) return { kind: "external" };
  if (target.startsWith("//") || /^[a-z][a-z0-9+.-]*:/i.test(target)) return { kind: "external" };
  const base = fromRel.includes("/") ? posix.dirname(fromRel) : "";
  const p = norm(posix.join(base, target));
  if (p.startsWith("..")) return { kind: "dangling", reason: "escapes-repo-root" };
  const hit = firstExisting(ctx, [
    p,
    p + ".md",
    p + ".mdx",
    posix.join(p, "README.md"),
    posix.join(p, "readme.md"),
    posix.join(p, "index.md"),
    posix.join(p, "index.mdx")
  ]);
  if (hit) return { kind: "resolved", target: hit };
  if (ctx.dirSet.has(p)) return { kind: "external" };
  return { kind: "dangling", reason: "missing-target" };
}
function resolveJs(fromRel, spec, ctx) {
  const probe = (p) => firstExisting(ctx, [...JS_EXT_PROBES.map((e) => p + e), ...JS_INDEX.map((i2) => posix.join(p, i2))]);
  const tryResolve = (p) => {
    const hit = probe(p);
    if (hit) return hit;
    const noJs = p.replace(/\.(js|jsx|mjs|cjs)$/, "");
    return noJs !== p ? probe(noJs) : void 0;
  };
  if (spec.startsWith(".")) {
    const base = fromRel.includes("/") ? posix.dirname(fromRel) : "";
    const p = norm(posix.join(base, spec));
    if (p.startsWith("..")) return { kind: "dangling", reason: "escapes-repo-root" };
    const hit = tryResolve(p);
    return hit ? { kind: "resolved", target: hit } : { kind: "dangling", reason: "missing-module" };
  }
  let aliasFallback;
  for (const cfg of ctx.tsConfigs) {
    if (cfg.dir && fromRel !== cfg.dir && !fromRel.startsWith(cfg.dir + "/")) continue;
    let matched = false;
    for (const tp of cfg.paths) {
      if (!(tp.star ? spec.startsWith(tp.prefix) : spec === tp.prefix)) continue;
      matched = true;
      const suffix = tp.star ? spec.slice(tp.prefix.length) : "";
      let targetTreeExists = false;
      for (const t of tp.targets) {
        const resolved = tp.star ? t.replace(/\*/, suffix) : t;
        const p = norm(posix.join(cfg.baseUrl, resolved));
        const hit = tryResolve(p);
        if (hit) return { kind: "resolved", target: hit };
        const tdir = p.includes("/") ? posix.dirname(p) : "";
        if (ctx.dirSet.has(tdir) || ctx.fileSet.has(p)) targetTreeExists = true;
      }
      aliasFallback = targetTreeExists ? { kind: "dangling", reason: "alias-unresolved" } : { kind: "external" };
      break;
    }
    if (matched) break;
  }
  for (const pkg of ctx.workspacePackages) {
    if (spec !== pkg.name && !spec.startsWith(pkg.name + "/")) continue;
    const sub = spec.slice(pkg.name.length).replace(/^\//, "");
    const probeEntry = (entry) => {
      for (const cand of [entry, ...distToSrcCandidates(entry)]) {
        const hit = tryResolve(norm(posix.join(pkg.dir, cand)));
        if (hit) return hit;
      }
      return void 0;
    };
    const subKey = sub ? "./" + sub : ".";
    for (const entry of pkg.exportEntries) {
      let fill;
      if (entry.star) {
        const starAt = entry.key.indexOf("*");
        const pre = entry.key.slice(0, starAt);
        const post = entry.key.slice(starAt + 1);
        if (!subKey.startsWith(pre) || !subKey.endsWith(post) || subKey.length < pre.length + post.length) continue;
        fill = subKey.slice(pre.length, subKey.length - post.length);
      } else if (entry.key !== subKey) continue;
      for (const t of entry.targets) {
        const hit = probeEntry(fill === void 0 ? t : t.replace(/\*/g, fill));
        if (hit) return { kind: "resolved", target: hit };
      }
      break;
    }
    if (!sub) {
      for (const m of pkg.mainCandidates) {
        const hit = probeEntry(m);
        if (hit) return { kind: "resolved", target: hit };
      }
    }
    const bases = sub ? [posix.join(pkg.dir, "src", sub), posix.join(pkg.dir, sub)] : [posix.join(pkg.dir, "src", "index"), posix.join(pkg.dir, "index"), posix.join(pkg.dir, "src")];
    for (const b of bases) {
      const hit = tryResolve(norm(b));
      if (hit) return { kind: "resolved", target: hit };
    }
    return { kind: "external" };
  }
  return aliasFallback ?? { kind: "external" };
}
function resolvePython(fromRel, spec, ctx) {
  const probeModule = (dir, dotted) => {
    const sub = dotted ? dotted.replace(/\./g, "/") : "";
    const base = norm(posix.join(dir, sub));
    return firstExisting(ctx, [base + ".py", base + ".pyi", posix.join(base, "__init__.py")]);
  };
  if (spec.startsWith(".")) {
    const dots = /^\.+/.exec(spec)[0].length;
    const rest = spec.slice(dots);
    const base = fromRel.includes("/") ? posix.dirname(fromRel) : "";
    let dir = base;
    for (let i2 = 1; i2 < dots; i2++) dir = dir.includes("/") ? posix.dirname(dir) : "";
    const hit = rest ? probeModule(dir, rest) : firstExisting(ctx, [posix.join(norm(dir), "__init__.py")]);
    return hit ? { kind: "resolved", target: hit } : { kind: "dangling", reason: "missing-module" };
  }
  for (const root of ctx.pyRoots) {
    const hit = probeModule(root, spec);
    if (hit) return { kind: "resolved", target: hit };
  }
  return { kind: "external" };
}
function resolveGo(fromRel, spec, ctx) {
  if (!ctx.goModules.length) return { kind: "external" };
  const probePkg = (dir) => {
    const d = norm(dir).replace(/^\.$/, "");
    const inDir = (ctx.filesByDir.get(d) ?? []).filter((f) => f.endsWith(".go")).sort();
    return inDir.length ? { kind: "resolved", target: inDir[0] } : { kind: "dangling", reason: "missing-package" };
  };
  const home = ctx.goModules.find((g) => !g.dir || fromRel === g.dir || fromRel.startsWith(g.dir + "/"));
  if (home) {
    for (const r of home.replaces) {
      if (spec !== r.from && !spec.startsWith(r.from + "/")) continue;
      const sub = spec.slice(r.from.length).replace(/^\//, "");
      return probePkg(posix.join(r.toDir, sub));
    }
  }
  const ordered = home ? [home, ...ctx.goModules.filter((g) => g !== home)] : ctx.goModules;
  for (const g of ordered) {
    if (spec !== g.module && !spec.startsWith(g.module + "/")) continue;
    const sub = spec.slice(g.module.length).replace(/^\//, "");
    return probePkg(posix.join(g.dir, sub));
  }
  return { kind: "external" };
}
function resolveRust(fromRel, spec, ctx) {
  if (!ctx.rustCrates.length) return { kind: "external" };
  const probeMod = (dir, name2) => firstExisting(ctx, [posix.join(dir, name2 + ".rs"), posix.join(dir, name2, "mod.rs")]);
  const walkPath = (baseDir2, segs2) => {
    for (let n = segs2.length; n >= 1; n--) {
      const dir = norm(posix.join(baseDir2, ...segs2.slice(0, n - 1)));
      const hit2 = probeMod(dir, segs2[n - 1]);
      if (hit2) return hit2;
    }
    return void 0;
  };
  const fromDir = fromRel.includes("/") ? posix.dirname(fromRel) : "";
  const stem = fromRel.slice(fromRel.lastIndexOf("/") + 1).replace(/\.rs$/, "");
  const isRootish = stem === "mod" || stem === "lib" || stem === "main";
  const childDir = isRootish ? fromDir : posix.join(fromDir, stem);
  if (spec.startsWith("mod ")) {
    const name2 = spec.slice(4);
    const hit2 = probeMod(childDir, name2) ?? (isRootish ? void 0 : probeMod(fromDir, name2));
    return hit2 ? { kind: "resolved", target: hit2 } : { kind: "dangling", reason: "missing-module" };
  }
  const segs = spec.split("::").map((s) => s.trim()).filter(Boolean);
  if (!segs.length) return { kind: "external" };
  const head = segs[0];
  const home = ctx.rustCrates.find((c2) => !c2.dir || fromRel === c2.dir || fromRel.startsWith(c2.dir + "/"));
  let baseDir;
  let rest = [];
  if (head === "crate" && home) {
    baseDir = home.srcDir;
    rest = segs.slice(1);
  } else if (head === "self") {
    baseDir = childDir;
    rest = segs.slice(1);
  } else if (head === "super") {
    let dir = isRootish ? fromDir.includes("/") ? posix.dirname(fromDir) : "" : fromDir;
    let i2 = 1;
    while (i2 < segs.length && segs[i2] === "super") {
      dir = dir.includes("/") ? posix.dirname(dir) : "";
      i2++;
    }
    baseDir = dir;
    rest = segs.slice(i2);
  } else {
    const target = ctx.rustCrates.find((c2) => c2.name === head);
    if (target) {
      const walked = walkPath(target.srcDir, segs.slice(1));
      if (walked) return { kind: "resolved", target: walked };
      if (target.rootFile) return { kind: "resolved", target: target.rootFile };
    }
    return { kind: "external" };
  }
  if (!rest.length) return { kind: "external" };
  const hit = walkPath(baseDir, rest);
  if (hit) return { kind: "resolved", target: hit };
  if (home && baseDir === home.srcDir && home.rootFile) return { kind: "resolved", target: home.rootFile };
  const ownerDir = baseDir.includes("/") ? posix.dirname(baseDir) : "";
  const ownerName = baseDir.slice(baseDir.lastIndexOf("/") + 1);
  const owner = ownerName ? probeMod(ownerDir, ownerName) : void 0;
  if (owner && owner !== fromRel) return { kind: "resolved", target: owner };
  return { kind: "external" };
}
function resolveJava(spec, ctx) {
  if (!ctx.javaRoots.length) return { kind: "external" };
  const probe = (pkgPath) => {
    for (const root of ctx.javaRoots) {
      const p = norm(posix.join(root, pkgPath));
      if (p.endsWith("/*") || p === "*") {
        const dir = p === "*" ? "" : p.slice(0, -2);
        const inDir = (ctx.filesByDir.get(dir) ?? []).filter((f) => f.endsWith(".java")).sort();
        if (inDir.length) return inDir[0];
        continue;
      }
      if (ctx.fileSet.has(p + ".java")) return p + ".java";
    }
    return void 0;
  };
  const path = spec.replace(/\./g, "/");
  let hit = probe(path);
  if (!hit && !spec.endsWith(".*")) {
    const segs = path.split("/");
    for (let n = segs.length - 1; n >= 2 && !hit; n--) {
      hit = probe(segs.slice(0, n).join("/"));
    }
  }
  return hit ? { kind: "resolved", target: hit } : { kind: "external" };
}
function resolveC(fromRel, spec, ctx) {
  const fromDir = fromRel.includes("/") ? posix.dirname(fromRel) : "";
  const hit = firstExisting(ctx, [posix.join(fromDir, spec), ...ctx.cIncludeRoots.map((r) => posix.join(r, spec))]);
  return hit ? { kind: "resolved", target: hit } : { kind: "dangling", reason: "missing-include" };
}
function resolveRuby(fromRel, spec, ctx) {
  if (spec.startsWith(".")) {
    const fromDir = fromRel.includes("/") ? posix.dirname(fromRel) : "";
    const base = norm(posix.join(fromDir, spec));
    const hit = firstExisting(ctx, [base + ".rb", posix.join(base, "index.rb")]);
    return hit ? { kind: "resolved", target: hit } : { kind: "dangling", reason: "missing-module" };
  }
  for (const root of ctx.rubyLibRoots) {
    const hit = firstExisting(ctx, [posix.join(root, spec + ".rb")]);
    if (hit) return { kind: "resolved", target: hit };
  }
  return { kind: "external" };
}
function resolvePhp(fromRel, spec, ctx) {
  if (spec.startsWith(".")) {
    const fromDir = fromRel.includes("/") ? posix.dirname(fromRel) : "";
    const base = norm(posix.join(fromDir, spec));
    const hit = firstExisting(ctx, [base, base + ".php"]);
    return hit ? { kind: "resolved", target: hit } : { kind: "dangling", reason: "missing-module" };
  }
  const ns = spec.replace(/^\\+/, "");
  for (const { prefix, dir } of ctx.phpPsr4) {
    if (prefix && ns !== prefix && !ns.startsWith(prefix + "\\")) continue;
    const rest = prefix ? ns.slice(prefix.length).replace(/^\\+/, "") : ns;
    const hit = firstExisting(ctx, [posix.join(dir, rest.replace(/\\/g, "/")) + ".php"]);
    if (hit) return { kind: "resolved", target: hit };
  }
  return { kind: "external" };
}
function resolveCsharp(spec, ctx) {
  const exact = ctx.csharpNamespaces.get(spec);
  if (exact?.length) return { kind: "resolved", target: exact[0] };
  let best;
  for (const [ns, files] of ctx.csharpNamespaces) {
    if (ns === spec || ns.startsWith(spec + ".")) {
      const f = files[0];
      if (best === void 0 || byStr(f, best) < 0) best = f;
    }
  }
  return best ? { kind: "resolved", target: best } : { kind: "external" };
}
function resolveImport(fromRel, ext, spec, ctx) {
  const dot = spec.lastIndexOf(".");
  if (dot !== -1 && ASSET_EXT.has(spec.slice(dot).toLowerCase().replace(/[?#].*$/, ""))) {
    return { kind: "external" };
  }
  if (JS_TS2.has(ext) || SFC_HTML.has(ext)) return resolveJs(fromRel, spec, ctx);
  if (PY2.has(ext)) return resolvePython(fromRel, spec, ctx);
  if (ext === ".go") return resolveGo(fromRel, spec, ctx);
  if (ext === ".rs") return resolveRust(fromRel, spec, ctx);
  if (ext === ".java") return resolveJava(spec, ctx);
  if (C_CPP2.has(ext)) return resolveC(fromRel, spec, ctx);
  if (ext === ".rb" || ext === ".rake") return resolveRuby(fromRel, spec, ctx);
  if (ext === ".php") return resolvePhp(fromRel, spec, ctx);
  if (ext === ".cs") return resolveCsharp(spec, ctx);
  return { kind: "external" };
}
var ASSET_EXT;
var JS_EXT_PROBES;
var JS_INDEX;
var JS_TS2;
var SFC_HTML;
var PY2;
var C_CPP2;
var BUILD_DIRS;
var CONDITION_PRIORITY;
var MAX_EXPORT_TARGETS;
var init_resolve = __esm({
  "src/resolve.ts"() {
    "use strict";
    init_walk();
    init_sort();
    ASSET_EXT = /* @__PURE__ */ new Set([
      ".svg",
      ".png",
      ".jpg",
      ".jpeg",
      ".gif",
      ".webp",
      ".bmp",
      ".ico",
      ".icns",
      ".pdf",
      ".woff",
      ".woff2",
      ".ttf",
      ".otf",
      ".eot",
      ".mp3",
      ".mp4",
      ".mov",
      ".avi",
      ".webm",
      ".wav",
      ".flac",
      ".ogg",
      ".map"
    ]);
    JS_EXT_PROBES = [
      "",
      ".ts",
      ".tsx",
      ".d.ts",
      ".mts",
      ".cts",
      ".js",
      ".jsx",
      ".mjs",
      ".cjs",
      ".vue",
      ".svelte",
      ".astro",
      ".html",
      ".htm"
    ];
    JS_INDEX = ["index.ts", "index.tsx", "index.js", "index.jsx", "index.mjs", "index.cjs"];
    JS_TS2 = /* @__PURE__ */ new Set([".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"]);
    SFC_HTML = /* @__PURE__ */ new Set([".vue", ".svelte", ".astro", ".html", ".htm"]);
    PY2 = /* @__PURE__ */ new Set([".py", ".pyi"]);
    C_CPP2 = /* @__PURE__ */ new Set([".c", ".h", ".cc", ".cpp", ".cxx", ".hpp", ".hh"]);
    BUILD_DIRS = /* @__PURE__ */ new Set(["dist", "build", "lib", "out", "output", "esm", "cjs", "umd"]);
    CONDITION_PRIORITY = ["source", "ts", "import", "module", "require", "node", "default"];
    MAX_EXPORT_TARGETS = 8;
  }
});
function isTestFile(rel) {
  return TEST_FILE.test(rel.split("/").pop());
}
function dirOf(rel) {
  return rel.includes("/") ? posix2.dirname(rel) : ROOT_PATH;
}
function tierForPath(path) {
  if (path === ROOT_PATH) return 0;
  if (TIER2_ANY.test(path) || TIER2_LEAF.test(path)) return 2;
  if (TIER0.test(path)) return 0;
  return null;
}
function tierOf(path, members) {
  const byPath = tierForPath(path);
  if (byPath !== null) return byPath;
  if (members.every((m) => m.kind === "doc" || m.kind === "config" || isTestFile(m.rel))) return 2;
  return 1;
}
function summaryOf(path, members) {
  const readme = members.find((m) => /^(readme|index)\.(md|mdx)$/i.test(m.rel.split("/").pop()));
  if (readme?.summary) return readme.summary;
  if (readme?.title) return readme.title;
  const withSummary = members.filter((m) => m.summary).sort((a, b) => (b.summary?.length ?? 0) - (a.summary?.length ?? 0));
  if (withSummary[0]?.summary) return withSummary[0].summary;
  const langs = [...new Set(members.map((m) => m.lang))].filter((l) => l !== "other");
  const where = path === ROOT_PATH ? "the repository root" : `\`${path}/\``;
  return `${members.length} file(s) in ${where}${langs.length ? ` (${langs.slice(0, 3).join(", ")})` : ""}.`;
}
function buildModules(scan2) {
  const byDir = /* @__PURE__ */ new Map();
  for (const f of scan2.files) {
    const dir = dirOf(f.rel);
    let list = byDir.get(dir);
    if (!list) byDir.set(dir, list = []);
    list.push(f);
  }
  const dirs = [...byDir.keys()].sort(byStr);
  const baseOf = /* @__PURE__ */ new Map();
  const baseCount = /* @__PURE__ */ new Map();
  for (const dir of dirs) {
    const b = dir === ROOT_PATH ? "root" : slugify(dir);
    baseOf.set(dir, b);
    baseCount.set(b, (baseCount.get(b) ?? 0) + 1);
  }
  const slugForDir = (dir) => {
    const b = baseOf.get(dir);
    return b && baseCount.get(b) === 1 ? b : `${b || "module"}-${sha1(dir).slice(0, 8)}`;
  };
  const modules = [];
  const moduleOf = /* @__PURE__ */ new Map();
  for (const dir of dirs) {
    const members = byDir.get(dir).slice().sort((a, b) => byStr(a.rel, b.rel));
    const slug2 = slugForDir(dir);
    const info2 = {
      slug: slug2,
      path: dir,
      title: dir,
      tier: tierOf(dir, members),
      members: members.map((m) => m.rel),
      summary: summaryOf(dir, members)
    };
    modules.push(info2);
    for (const m of members) moduleOf.set(m.rel, slug2);
  }
  modules.sort((a, b) => byStr(a.slug, b.slug));
  return { modules, moduleOf };
}
var ROOT_PATH;
var TIER0;
var TIER2_ANY;
var TIER2_LEAF;
var TEST_FILE;
var init_modules = __esm({
  "src/modules.ts"() {
    "use strict";
    init_util();
    init_hash();
    init_sort();
    ROOT_PATH = "(root)";
    TIER0 = /(^|\/)(types?|util|utils|lib|libs|common|core|config|configs|constants|shared|helpers|internal)$/i;
    TIER2_ANY = /(^|\/)(tests?|__tests?__|__mocks?__|__snapshots?__|spec|specs|e2e|examples?|example|benchmark|benchmarks|fixtures?|docs?|documentation|\.github)(\/|$)/i;
    TIER2_LEAF = /(^|\/)(scripts?|bin|\.storybook)$/i;
    TEST_FILE = /\.(test|spec|e2e|stories|story)\.[cm]?[jt]sx?$/i;
  }
});
function familyOf(lang) {
  if (lang === "typescript" || lang === "javascript") return "js";
  if (lang === "c" || lang === "cpp") return "c";
  return lang;
}
function sharedSegments(a, b) {
  const as = a.split("/");
  const bs = b.split("/");
  let n = 0;
  while (n < as.length && n < bs.length && as[n] === bs[n]) n++;
  return n;
}
function pickCandidate(callerRel, cands) {
  if (cands.length === 1) return cands[0];
  if (cands.length === 0) return void 0;
  let best;
  let bestScore = -1;
  let tied = false;
  for (const c2 of cands) {
    const s = sharedSegments(callerRel, c2.file);
    if (s > bestScore) {
      bestScore = s;
      best = c2;
      tied = false;
    } else if (s === bestScore) {
      tied = true;
    }
  }
  return tied ? void 0 : best;
}
function resolveCallEdges(scan2, importPairs) {
  const defs = /* @__PURE__ */ new Map();
  const seen = /* @__PURE__ */ new Set();
  for (const f of scan2.files) {
    for (const s of f.symbols) {
      if (!s.exported || REFERENCE_KINDS.has(s.kind)) continue;
      const dedup = `${s.name} ${s.file}`;
      if (seen.has(dedup)) continue;
      seen.add(dedup);
      let arr = defs.get(s.name);
      if (!arr) defs.set(s.name, arr = []);
      arr.push({ file: s.file, lang: s.lang });
    }
  }
  const agg = /* @__PURE__ */ new Map();
  for (const f of scan2.files) {
    if (!f.calls?.length) continue;
    const family = familyOf(f.lang);
    const ownNames = new Set(f.symbols.map((s) => s.name));
    const counts2 = /* @__PURE__ */ new Map();
    for (const c2 of f.calls) counts2.set(c2.name, (counts2.get(c2.name) ?? 0) + 1);
    for (const [name2, count] of counts2) {
      if (ownNames.has(name2)) continue;
      const cands = (defs.get(name2) ?? []).filter((d) => familyOf(d.lang) === family && d.file !== f.rel);
      if (!cands.length) continue;
      const imported = cands.filter((d) => importPairs.has(`${f.rel}|${d.file}`));
      let chosen;
      let confidence;
      if (family === "js") {
        if (!imported.length) continue;
        chosen = pickCandidate(f.rel, imported);
        confidence = "extracted";
      } else if (imported.length) {
        chosen = pickCandidate(f.rel, imported);
        confidence = "extracted";
      } else {
        chosen = pickCandidate(f.rel, cands);
        confidence = "inferred";
      }
      if (!chosen) continue;
      const key2 = `${f.rel}|${chosen.file}`;
      const prev = agg.get(key2);
      if (prev) {
        prev.weight += count;
        if (confidence === "extracted") prev.confidence = "extracted";
      } else {
        agg.set(key2, { from: f.rel, to: chosen.file, weight: count, confidence });
      }
    }
  }
  return [...agg.values()].map((e) => ({ from: e.from, to: e.to, kind: "call", weight: Math.min(e.weight, 5), confidence: e.confidence })).sort((a, b) => byStr(a.from, b.from) || byStr(a.to, b.to));
}
var REFERENCE_KINDS;
var init_calls = __esm({
  "src/calls.ts"() {
    "use strict";
    init_sort();
    REFERENCE_KINDS = /* @__PURE__ */ new Set(["reexport", "reexport-all", "default"]);
  }
});
function isDistinctive(name2) {
  if (name2.length < 5) return false;
  const internalUpper = /[a-z][A-Z]/.test(name2) || /[A-Z]{2}/.test(name2);
  return internalUpper || name2.includes("_") || /\d/.test(name2);
}
function uniqueSymbolDefs(scan2) {
  const byName = /* @__PURE__ */ new Map();
  for (const f of scan2.files) {
    for (const s of f.symbols) {
      if (!s.exported || REFERENCE_KINDS2.has(s.kind) || !isDistinctive(s.name)) continue;
      let set = byName.get(s.name);
      if (!set) byName.set(s.name, set = /* @__PURE__ */ new Set());
      set.add(f.rel);
    }
  }
  const unique = /* @__PURE__ */ new Map();
  for (const [name2, files] of byName) if (files.size === 1) unique.set(name2, [...files][0]);
  return unique;
}
function collect(edges, e) {
  const k = keyOf(e.from, e.to, e.kind);
  const prev = edges.get(k);
  if (prev) {
    prev.weight += e.weight;
    return;
  }
  edges.set(k, { ...e });
}
function buildGraph(scan2, ctx, modules, moduleOf, meta) {
  const fileEdgeMap = /* @__PURE__ */ new Map();
  const importPairs = /* @__PURE__ */ new Set();
  for (const f of scan2.files) {
    for (const ref of f.refs) {
      if (ref.kind === "doc-link") {
        const r = resolveDocLink(f.rel, ref.spec, ctx);
        if (r.kind === "external") continue;
        if (r.kind === "dangling") {
          collect(fileEdgeMap, { from: f.rel, to: ref.spec, kind: "doc-link", weight: 1, dangling: true, reason: r.reason });
        } else if (r.target !== f.rel) {
          collect(fileEdgeMap, { from: f.rel, to: r.target, kind: "doc-link", weight: 1 });
        }
      } else {
        const r = resolveImport(f.rel, f.ext, ref.spec, ctx);
        if (r.kind === "external") continue;
        if (r.kind === "dangling") {
          collect(fileEdgeMap, { from: f.rel, to: ref.spec, kind: "import", weight: 1, dangling: true, reason: r.reason });
        } else if (r.target !== f.rel) {
          collect(fileEdgeMap, { from: f.rel, to: r.target, kind: "import", weight: 1 });
          importPairs.add(`${f.rel}|${r.target}`);
        }
      }
    }
  }
  const callPairs = /* @__PURE__ */ new Set();
  for (const e of resolveCallEdges(scan2, importPairs)) {
    collect(fileEdgeMap, e);
    callPairs.add(`${e.from}|${e.to}`);
  }
  const unique = uniqueSymbolDefs(scan2);
  if (unique.size) {
    for (const f of scan2.files) {
      if (f.kind !== "code" || !f.idents?.length) continue;
      const perTarget = /* @__PURE__ */ new Map();
      for (const id of f.idents) {
        const target = unique.get(id);
        if (!target || target === f.rel) continue;
        perTarget.set(target, (perTarget.get(target) ?? 0) + 1);
      }
      for (const [target, count] of perTarget) {
        const pair = `${f.rel}|${target}`;
        if (importPairs.has(pair) || callPairs.has(pair)) continue;
        collect(fileEdgeMap, { from: f.rel, to: target, kind: "use", weight: Math.min(count, 5) });
      }
    }
  }
  if (unique.size) {
    for (const f of scan2.files) {
      if (f.kind !== "doc") continue;
      const content = scan2.docText.get(f.rel) ?? readText2(join4(scan2.root, f.rel));
      if (!content) continue;
      const tokens = /* @__PURE__ */ new Map();
      for (const tok of content.split(/[^A-Za-z0-9_]+/)) {
        if (unique.has(tok)) tokens.set(tok, (tokens.get(tok) ?? 0) + 1);
      }
      for (const [name2, count] of tokens) {
        const target = unique.get(name2);
        if (target === f.rel) continue;
        collect(fileEdgeMap, { from: f.rel, to: target, kind: "mention", weight: Math.min(count, 5) });
      }
    }
  }
  const fileEdges = [...fileEdgeMap.values()].sort(
    (a, b) => byStr(a.from, b.from) || byStr(a.to, b.to) || byStr(a.kind, b.kind)
  );
  const degIn = /* @__PURE__ */ new Map();
  const degOut = /* @__PURE__ */ new Map();
  const fileSet = new Set(scan2.files.map((f) => f.rel));
  for (const e of fileEdges) {
    if (e.dangling || !fileSet.has(e.to)) continue;
    degOut.set(e.from, (degOut.get(e.from) ?? 0) + 1);
    degIn.set(e.to, (degIn.get(e.to) ?? 0) + 1);
  }
  const KIND_RANK = { import: 5, call: 4, use: 3, "doc-link": 2, mention: 1, contains: 0 };
  const modEdgeMap = /* @__PURE__ */ new Map();
  for (const e of fileEdges) {
    if (e.dangling || !fileSet.has(e.to)) continue;
    const from = moduleOf.get(e.from);
    const to = moduleOf.get(e.to);
    if (!from || !to || from === to) continue;
    const k = `${from}\0${to}`;
    const prev = modEdgeMap.get(k);
    if (prev) {
      prev.weight += e.weight;
      if ((KIND_RANK[e.kind] ?? 0) > (KIND_RANK[prev.kind] ?? 0)) prev.kind = e.kind;
    } else {
      modEdgeMap.set(k, { from, to, kind: e.kind, weight: e.weight });
    }
  }
  const moduleEdges = [...modEdgeMap.values()].sort((a, b) => byStr(a.from, b.from) || byStr(a.to, b.to));
  const modDegIn = /* @__PURE__ */ new Map();
  const modDegOut = /* @__PURE__ */ new Map();
  for (const e of moduleEdges) {
    modDegOut.set(e.from, (modDegOut.get(e.from) ?? 0) + 1);
    modDegIn.set(e.to, (modDegIn.get(e.to) ?? 0) + 1);
  }
  const files = scan2.files.map((f) => ({
    id: f.rel,
    kind: "file",
    rel: f.rel,
    fileKind: f.kind,
    lang: f.lang,
    module: moduleOf.get(f.rel) ?? "root",
    title: f.title,
    summary: f.summary,
    symbols: f.symbols.length,
    lines: f.lines,
    degIn: degIn.get(f.rel) ?? 0,
    degOut: degOut.get(f.rel) ?? 0
  })).sort((a, b) => byStr(a.rel, b.rel));
  const symbolsByModule = /* @__PURE__ */ new Map();
  for (const f of scan2.files) {
    const slug2 = moduleOf.get(f.rel) ?? "root";
    symbolsByModule.set(slug2, (symbolsByModule.get(slug2) ?? 0) + f.symbols.length);
  }
  const moduleNodes = modules.map((m) => ({
    id: m.slug,
    kind: "module",
    slug: m.slug,
    path: m.path,
    title: m.title,
    summary: m.summary,
    tier: m.tier,
    members: m.members,
    symbols: symbolsByModule.get(m.slug) ?? 0,
    degIn: modDegIn.get(m.slug) ?? 0,
    degOut: modDegOut.get(m.slug) ?? 0
  })).sort((a, b) => byStr(a.slug, b.slug));
  return {
    schemaVersion: meta?.schemaVersion ?? SCHEMA_VERSION,
    version: meta?.version ?? ENGINE_VERSION,
    commit: scan2.commit,
    fileCount: scan2.files.length,
    languages: scan2.languages,
    files,
    modules: moduleNodes,
    fileEdges,
    moduleEdges
  };
}
var REFERENCE_KINDS2;
var keyOf;
var init_graph = __esm({
  "src/graph.ts"() {
    "use strict";
    init_types();
    init_resolve();
    init_calls();
    init_walk();
    init_sort();
    REFERENCE_KINDS2 = /* @__PURE__ */ new Set(["reexport", "reexport-all", "default"]);
    keyOf = (from, to, kind) => `${from}\0${to}\0${kind}`;
  }
});
function computeImportPairs(scan2) {
  const ctx = buildResolveContext(scan2);
  const pairs = /* @__PURE__ */ new Set();
  for (const f of scan2.files) {
    for (const ref of f.refs) {
      if (ref.kind !== "import") continue;
      const r = resolveImport(f.rel, f.ext, ref.spec, ctx);
      if (r.kind === "resolved" && r.target !== f.rel) pairs.add(`${f.rel}|${r.target}`);
    }
  }
  return pairs;
}
function buildCallerIndex(scan2, importPairs, opts = {}) {
  const pairs = importPairs ?? computeImportPairs(scan2);
  const recall = opts.recall === true;
  const defs = /* @__PURE__ */ new Map();
  for (const f of scan2.files) {
    const seen = /* @__PURE__ */ new Set();
    for (const s of f.symbols) {
      if (!s.exported || REFERENCE_KINDS3.has(s.kind)) continue;
      if (seen.has(s.name)) continue;
      seen.add(s.name);
      let arr = defs.get(s.name);
      if (!arr) defs.set(s.name, arr = []);
      arr.push(s);
    }
  }
  const localDefs = /* @__PURE__ */ new Map();
  for (const f of scan2.files) {
    const byName = /* @__PURE__ */ new Map();
    for (const s of f.symbols) {
      if (!REFERENCE_KINDS3.has(s.kind) && !byName.has(s.name)) byName.set(s.name, s);
    }
    localDefs.set(f.rel, byName);
  }
  const sites = /* @__PURE__ */ new Map();
  const record = (def, caller) => {
    let entry = sites.get(def.name + "\0" + def.file);
    if (!entry) sites.set(def.name + "\0" + def.file, entry = { def, callers: [] });
    entry.callers.push(caller);
  };
  for (const f of scan2.files) {
    if (!f.calls?.length) continue;
    const family = familyOf(f.lang);
    const own = localDefs.get(f.rel);
    for (const c2 of f.calls) {
      const local = own.get(c2.name);
      if (local) {
        if (local.line !== c2.line)
          record(local, recall ? { file: f.rel, line: c2.line, confidence: "corroborated" } : { file: f.rel, line: c2.line });
        continue;
      }
      const cands = (defs.get(c2.name) ?? []).filter((d) => familyOf(d.lang) === family && d.file !== f.rel).map((d) => ({ file: d.file, lang: d.lang }));
      if (!cands.length) continue;
      const imported = cands.filter((d) => pairs.has(`${f.rel}|${d.file}`));
      const chosen = family === "js" ? imported.length ? pickCandidate(f.rel, imported) : (
        // JS/TS gate: no corroborating import → no binding. Recall mode
        // relaxes this to a unique-repo-wide name match (issue #7).
        recall && cands.length === 1 ? cands[0] : void 0
      ) : imported.length ? pickCandidate(f.rel, imported) : pickCandidate(f.rel, cands);
      if (!chosen) continue;
      const def = defs.get(c2.name).find((d) => d.file === chosen.file);
      record(
        def,
        recall ? { file: f.rel, line: c2.line, confidence: imported.length ? "corroborated" : "unique-name" } : { file: f.rel, line: c2.line }
      );
    }
  }
  const index = /* @__PURE__ */ new Map();
  const keys = [...sites.keys()].sort(byStr);
  for (const key2 of keys) {
    const { def, callers } = sites.get(key2);
    callers.sort((a, b) => byStr(a.file, b.file) || a.line - b.line);
    if (!index.has(def.name)) index.set(def.name, { def, callers });
    else index.set(`${def.name}@${def.file}`, { def, callers });
  }
  return index;
}
function enclosingSymbol(scan2, file, line) {
  const f = scan2.files.find((x) => x.rel === file);
  if (!f?.symbols.length) return void 0;
  let best;
  for (const s of f.symbols) {
    if (REFERENCE_KINDS3.has(s.kind)) continue;
    if (s.line > line) continue;
    if (s.endLine !== void 0 && line > s.endLine) continue;
    if (!best || s.line > best.line || s.line === best.line && (s.endLine ?? Infinity) <= (best.endLine ?? Infinity)) {
      best = s;
    }
  }
  return best;
}
var REFERENCE_KINDS3;
var init_callers = __esm({
  "src/callers.ts"() {
    "use strict";
    init_calls();
    init_resolve();
    init_sort();
    REFERENCE_KINDS3 = /* @__PURE__ */ new Set(["reexport", "reexport-all", "default"]);
  }
});
function symbolsOverview(scan2, rel) {
  const f = scan2.files.find((x) => x.rel === rel);
  if (!f) return [];
  return [...f.symbols].filter((s) => !REFERENCE_KINDS4.has(s.kind)).sort((a, b) => a.line - b.line || byStr(a.name, b.name));
}
function findSymbol(scan2, namePath, opts = {}) {
  const segments = namePath.split("/").filter(Boolean);
  if (!segments.length) return [];
  const leaf = segments[segments.length - 1];
  const parents = segments.slice(0, -1);
  const matchName = (name2, wanted) => opts.substring ? name2.toLowerCase().includes(wanted.toLowerCase()) : name2 === wanted;
  const out2 = [];
  for (const f of scan2.files) {
    for (const s of f.symbols) {
      if (REFERENCE_KINDS4.has(s.kind)) continue;
      if (!matchName(s.name, leaf)) continue;
      if (parents.length) {
        const parent = parents[parents.length - 1];
        if (!s.parent || s.parent !== parent) continue;
      }
      out2.push({ ...s });
    }
  }
  out2.sort(
    (a, b) => Number(b.name === leaf) - Number(a.name === leaf) || byStr(a.file, b.file) || a.line - b.line
  );
  const capped = out2.slice(0, opts.maxResults ?? 50);
  if (opts.includeBody) {
    for (const m of capped) {
      const end = m.endLine ?? m.line;
      const content = readText2(join5(scan2.root, m.file));
      if (!content) continue;
      m.body = content.split("\n").slice(m.line - 1, end).join("\n");
    }
  }
  return capped;
}
function findReferences(scan2, name2) {
  const defs = [];
  for (const f of scan2.files) {
    for (const s of f.symbols) {
      if (s.name === name2 && !REFERENCE_KINDS4.has(s.kind)) defs.push(s);
    }
  }
  defs.sort((a, b) => byStr(a.file, b.file) || a.line - b.line);
  const index = buildCallerIndex(scan2);
  const entry = index.get(name2);
  const callSites = entry ? entry.callers : [];
  const referencingFiles = /* @__PURE__ */ new Set();
  const unique = uniqueSymbolDefs(scan2);
  const defFile = unique.get(name2);
  for (const f of scan2.files) {
    if (f.rel === defFile) continue;
    if (f.kind === "code" && f.idents?.includes(name2)) referencingFiles.add(f.rel);
    else if (f.kind === "doc") {
      const content = scan2.docText.get(f.rel);
      if (content && new RegExp(`\\b${name2.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(content)) {
        referencingFiles.add(f.rel);
      }
    }
  }
  for (const site of callSites) referencingFiles.add(site.file);
  return { defs, callSites, referencingFiles: [...referencingFiles].sort(byStr) };
}
var REFERENCE_KINDS4;
var init_query = __esm({
  "src/query.ts"() {
    "use strict";
    init_walk();
    init_callers();
    init_graph();
    init_sort();
    REFERENCE_KINDS4 = /* @__PURE__ */ new Set(["reexport", "reexport-all", "default"]);
  }
});
function resolveUniqueSymbol(scan2, namePath, file) {
  let matches = findSymbol(scan2, namePath);
  if (file) matches = matches.filter((m) => m.file === file);
  if (matches.length === 1) return matches[0];
  if (matches.length === 0) {
    const near = findSymbol(scan2, namePath, { substring: true, maxResults: 5 }).map((m) => `${m.file}:${m.line} ${m.parent ? m.parent + "/" : ""}${m.name}`).join(", ");
    throw new Error(`no symbol matches "${namePath}"${file ? ` in ${file}` : ""}${near ? ` \u2014 near matches: ${near}` : ""}`);
  }
  const list = matches.map((m) => `${m.file}:${m.line}`).join(", ");
  throw new Error(`"${namePath}" is ambiguous (${matches.length} matches: ${list}) \u2014 qualify with \`file\` or a Parent/name path`);
}
function readLines(abs) {
  return readFileSync3(abs, "utf8").split("\n");
}
function replaceSymbolBody(scan2, namePath, body2, file) {
  const sym = resolveUniqueSymbol(scan2, namePath, file);
  const end = sym.endLine ?? sym.line;
  const abs = join6(scan2.root, sym.file);
  const lines = readLines(abs);
  const newLines = body2.replace(/^\n+|\n+$/g, "").split("\n");
  lines.splice(sym.line - 1, end - sym.line + 1, ...newLines);
  writeFileSync2(abs, lines.join("\n"));
  return { file: sym.file, startLine: sym.line, endLine: sym.line + newLines.length - 1, lines: newLines.length };
}
function insertAt(scan2, sym, body2, index, blankBefore, blankAfter) {
  const abs = join6(scan2.root, sym.file);
  const lines = readLines(abs);
  const minGap = SEPARATED_KINDS.has(sym.kind) ? 1 : 0;
  const newLines = body2.replace(/^\n+|\n+$/g, "").split("\n");
  const block = [];
  if (blankBefore && minGap && lines[index - 1]?.trim() !== "") block.push("");
  block.push(...newLines);
  if (blankAfter && minGap && lines[index]?.trim() !== "") block.push("");
  lines.splice(index, 0, ...block);
  writeFileSync2(abs, lines.join("\n"));
  return { file: sym.file, startLine: index + 1, endLine: index + block.length, lines: block.length };
}
function insertAfterSymbol(scan2, namePath, body2, file) {
  const sym = resolveUniqueSymbol(scan2, namePath, file);
  const end = sym.endLine ?? sym.line;
  return insertAt(scan2, sym, body2, end, true, true);
}
function insertBeforeSymbol(scan2, namePath, body2, file) {
  const sym = resolveUniqueSymbol(scan2, namePath, file);
  return insertAt(scan2, sym, body2, sym.line - 1, true, true);
}
var SEPARATED_KINDS;
var init_edit = __esm({
  "src/edit.ts"() {
    "use strict";
    init_query();
    SEPARATED_KINDS = /* @__PURE__ */ new Set(["function", "method", "class", "interface", "struct", "trait", "enum", "def"]);
  }
});
function sanitize(name2) {
  const clean2 = name2.replace(/^mem:/, "").replace(/\.md$/, "");
  if (!clean2) throw new Error("memory name is empty");
  const segments = clean2.split("/");
  for (const seg of segments) {
    if (!seg || seg === "." || seg === ".." || seg.includes("\\")) {
      throw new Error(`invalid memory name: "${name2}"`);
    }
    if (!/^[\w][\w.-]*$/.test(seg)) throw new Error(`invalid memory name segment: "${seg}"`);
  }
  return clean2;
}
function memoryPath(repo, name2) {
  return join7(repo, ...MEMORY_DIR, `${sanitize(name2)}.md`);
}
function writeMemory(repo, name2, content) {
  const path = memoryPath(repo, name2);
  mkdirSync2(dirname22(path), { recursive: true });
  writeFileSync22(path, content.endsWith("\n") ? content : content + "\n");
  return sanitize(name2);
}
function readMemory(repo, name2) {
  try {
    return readFileSync4(memoryPath(repo, name2), "utf8");
  } catch {
    return void 0;
  }
}
function deleteMemory(repo, name2) {
  const path = memoryPath(repo, name2);
  try {
    statSync2(path);
  } catch {
    return false;
  }
  rmSync2(path);
  return true;
}
function listMemories(repo) {
  const root = join7(repo, ...MEMORY_DIR);
  const out2 = [];
  const walk2 = (dir, prefix) => {
    let entries;
    try {
      entries = readdirSync22(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.isDirectory()) walk2(join7(dir, e.name), prefix ? `${prefix}/${e.name}` : e.name);
      else if (e.name.endsWith(".md")) out2.push(prefix ? `${prefix}/${e.name.slice(0, -3)}` : e.name.slice(0, -3));
    }
  };
  walk2(root, "");
  return out2.sort();
}
var MEMORY_DIR;
var init_memory = __esm({
  "src/memory.ts"() {
    "use strict";
    MEMORY_DIR = [".codeindex", "memories"];
  }
});
function readJson2(path, label, warnings) {
  const raw = readText2(path);
  if (!raw) return void 0;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") return parsed;
    if (label && warnings) warnings.push(`malformed ${label}: not a JSON object`);
    return void 0;
  } catch (e) {
    if (label && warnings) {
      const reason = String(e instanceof Error ? e.message : e).split("\n")[0];
      warnings.push(`malformed ${label}: ${reason}`);
    }
    return void 0;
  }
}
function tomlSectionBody(toml, section) {
  const re = new RegExp(`^\\[${escapeRegExp(section)}\\]\\s*$([\\s\\S]*?)(?=^\\[|$(?![\\s\\S]))`, "m");
  const m = toml.match(re);
  return m ? m[1] : null;
}
function tomlStringArray(body2, key2) {
  const m = body2.match(new RegExp(`${escapeRegExp(key2)}\\s*=\\s*\\[([^\\]]*)\\]`));
  if (!m) return [];
  return m[1].split(/\r?\n/).map((line) => line.replace(/#.*$/, "")).join("\n").split(",").map((s) => s.trim().replace(/^["']|["']$/g, "")).filter(Boolean);
}
function tomlString(body2, key2) {
  return body2?.match(new RegExp(`^\\s*${escapeRegExp(key2)}\\s*=\\s*["']([^"']+)["']`, "m"))?.[1];
}
function wsGlobToRegExp(pat) {
  let re = "";
  for (let i2 = 0; i2 < pat.length; i2++) {
    const c2 = pat[i2];
    if (c2 === "*") {
      if (pat[i2 + 1] === "*") {
        re += ".*";
        i2++;
        if (pat[i2 + 1] === "/") i2++;
      } else {
        re += "[^/]*";
      }
    } else if ("\\^$.|?+()[]{}".includes(c2)) {
      re += "\\" + c2;
    } else {
      re += c2;
    }
  }
  return new RegExp(`^${re}($|/)`);
}
function probeNodePkg(root, dir, kind, warnings) {
  const path = join8(root, dir, "package.json");
  if (!existsSync22(path)) return void 0;
  const manifest = `${dir}/package.json`;
  const pkg = readJson2(path, manifest, warnings);
  const out2 = {
    name: typeof pkg?.name === "string" && pkg.name ? pkg.name : dir,
    dir,
    kind,
    manifest
  };
  if (typeof pkg?.description === "string" && pkg.description) out2.description = pkg.description;
  return out2;
}
function probeCargo(root, dir) {
  const path = join8(root, dir, "Cargo.toml");
  if (!existsSync22(path)) return void 0;
  const body2 = tomlSectionBody(readText2(path), "package");
  const out2 = {
    name: tomlString(body2, "name") ?? dir,
    dir,
    kind: "cargo",
    manifest: `${dir}/Cargo.toml`
  };
  const description = tomlString(body2, "description");
  if (description) out2.description = description;
  return out2;
}
function probeGoMod(root, dir) {
  const path = join8(root, dir, "go.mod");
  if (!existsSync22(path)) return void 0;
  const name2 = readText2(path).match(/^module\s+(\S+)/m)?.[1] ?? dir;
  return { name: name2, dir, kind: "go", manifest: `${dir}/go.mod` };
}
function probeMaven(root, dir) {
  const path = join8(root, dir, "pom.xml");
  if (!existsSync22(path)) return void 0;
  return { name: ownArtifactId(readText2(path)) ?? dir, dir, kind: "maven", manifest: `${dir}/pom.xml` };
}
function probePyproject(root, dir) {
  const path = join8(root, dir, "pyproject.toml");
  if (!existsSync22(path)) return void 0;
  const toml = readText2(path);
  const project = tomlSectionBody(toml, "project");
  const poetry = tomlSectionBody(toml, "tool.poetry");
  const out2 = {
    name: tomlString(project, "name") ?? tomlString(poetry, "name") ?? dir,
    dir,
    kind: "uv",
    manifest: `${dir}/pyproject.toml`
  };
  const description = tomlString(project, "description") ?? tomlString(poetry, "description");
  if (description) out2.description = description;
  return out2;
}
function probeComposer(root, dir, warnings) {
  const path = join8(root, dir, "composer.json");
  if (!existsSync22(path)) return void 0;
  const manifest = `${dir}/composer.json`;
  const pkg = readJson2(path, manifest, warnings);
  const out2 = {
    name: typeof pkg?.name === "string" && pkg.name ? pkg.name : dir,
    dir,
    kind: "composer",
    manifest
  };
  if (typeof pkg?.description === "string" && pkg.description) out2.description = pkg.description;
  return out2;
}
function probeNxProject(root, dir, warnings) {
  const path = join8(root, dir, "project.json");
  if (!existsSync22(path)) return void 0;
  const manifest = `${dir}/project.json`;
  const proj = readJson2(path, manifest, warnings);
  return {
    name: typeof proj?.name === "string" && proj.name ? proj.name : dir,
    dir,
    kind: "nx",
    manifest
  };
}
function probeGradle(root, dir) {
  for (const f of ["build.gradle", "build.gradle.kts"]) {
    if (existsSync22(join8(root, dir, f))) {
      return { name: dir, dir, kind: "gradle", manifest: `${dir}/${f}` };
    }
  }
  return void 0;
}
function packageAt(root, dir, kind, warnings) {
  const node = () => probeNodePkg(root, dir, kind, warnings);
  const cargo = () => probeCargo(root, dir);
  const gomod = () => probeGoMod(root, dir);
  const maven = () => probeMaven(root, dir);
  const py = () => probePyproject(root, dir);
  const composer = () => probeComposer(root, dir, warnings);
  const nx = () => probeNxProject(root, dir, warnings);
  const gradle = () => probeGradle(root, dir);
  const probes = kind === "go" ? [gomod, node, cargo, maven, py, composer, nx] : kind === "uv" ? [py, node, cargo, gomod, maven, composer, nx] : kind === "composer" ? [composer, node, py, cargo, gomod, maven, nx] : kind === "gradle" ? [node, maven, cargo, gomod, py, composer, nx, gradle] : [node, cargo, gomod, maven, py, composer, nx];
  for (const probe of probes) {
    const pkg = probe();
    if (pkg) return pkg;
  }
  return void 0;
}
function ownArtifactId(pom) {
  const stripped = pom.replace(/<parent>[\s\S]*?<\/parent>/g, "").replace(/<dependencies>[\s\S]*?<\/dependencies>/g, "");
  return stripped.match(/<artifactId>\s*([^<]+?)\s*<\/artifactId>/)?.[1];
}
function addPackage(root, dir, found, kind, warnings) {
  const clean2 = dir.replace(/^\.\//, "").replace(/\/+$/, "");
  if (!clean2 || clean2 === "." || found.has(clean2)) return;
  if (clean2.split("/").includes("..")) return;
  const pkg = packageAt(root, clean2, kind, warnings);
  if (pkg) found.set(clean2, pkg);
}
function isDirAt(root, rel) {
  try {
    return statSync3(join8(root, rel)).isDirectory();
  } catch {
    return false;
  }
}
function subdirsOf(root, base) {
  let entries;
  try {
    entries = readdirSync3(base ? join8(root, base) : root, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries.filter((e) => e.isDirectory() && !e.name.startsWith(".") && !WS_SKIP_DIRS.has(e.name)).map((e) => base ? `${base}/${e.name}` : e.name).sort(byStr);
}
function descendantsOf(root, base, depth, out2) {
  if (depth > MAX_RECURSE_DEPTH) return;
  for (const sub of subdirsOf(root, base)) {
    out2.push(sub);
    descendantsOf(root, sub, depth + 1, out2);
  }
}
function expandGlobDirs(root, pat) {
  const segs = pat.split("/").filter((s) => s && s !== ".");
  if (segs.includes("..")) return [];
  let dirs = [""];
  for (const seg of segs) {
    const next = /* @__PURE__ */ new Set();
    if (seg === "**") {
      for (const d of dirs) {
        if (d) next.add(d);
        const desc = [];
        descendantsOf(root, d, 0, desc);
        for (const s of desc) next.add(s);
      }
    } else if (seg.includes("*")) {
      const re = new RegExp(`^${seg.split("*").map(escapeRegExp).join("[^/]*")}$`);
      for (const d of dirs) {
        for (const sub of subdirsOf(root, d)) {
          if (re.test(sub.split("/").pop())) next.add(sub);
        }
      }
    } else {
      for (const d of dirs) {
        const cand = d ? `${d}/${seg}` : seg;
        if (isDirAt(root, cand)) next.add(cand);
      }
    }
    dirs = [...next];
    if (!dirs.length) return [];
  }
  return dirs.filter(Boolean);
}
function expandPattern(root, raw, found, kind, warnings) {
  const pat = raw.replace(/^\.\//, "").replace(/\/+$/, "");
  if (!pat) return;
  if (!pat.includes("*")) {
    addPackage(root, pat, found, kind, warnings);
    return;
  }
  for (const dir of expandGlobDirs(root, pat)) addPackage(root, dir, found, kind, warnings);
}
function npmFamilyPatterns(root, warnings) {
  const positives = [];
  const negations = [];
  const push = (raw, kind) => {
    const t = raw.trim();
    if (!t) return;
    if (t.startsWith("!")) negations.push(t.slice(1));
    else positives.push({ pattern: t, kind });
  };
  const pkg = readJson2(join8(root, "package.json"), "package.json", warnings);
  const ws = pkg?.workspaces;
  if (Array.isArray(ws)) {
    for (const x of ws) if (typeof x === "string") push(x, "npm");
  } else if (ws && typeof ws === "object" && Array.isArray(ws.packages)) {
    for (const x of ws.packages) if (typeof x === "string") push(x, "npm");
  }
  const pnpm = readText2(join8(root, "pnpm-workspace.yaml"));
  let inPackages = false;
  for (const line of pnpm.split(/\r?\n/)) {
    if (/^\S/.test(line)) {
      inPackages = /^packages\s*:/.test(line);
      continue;
    }
    if (!inPackages) continue;
    const m = line.match(/^\s*-\s*['"]?([^'"#]+?)['"]?\s*(?:#.*)?$/);
    if (m) push(m[1].trim(), "pnpm");
  }
  return { positives, negations };
}
function fallbackNpmPatterns(root, warnings) {
  const lerna = readJson2(join8(root, "lerna.json"), "lerna.json", warnings);
  if (lerna && Array.isArray(lerna.packages)) {
    return lerna.packages.filter((x) => typeof x === "string").map((pattern) => ({ pattern, kind: "lerna" }));
  }
  const nx = readJson2(join8(root, "nx.json"), "nx.json", warnings);
  if (nx) {
    const layout = nx.workspaceLayout ?? {};
    const appsDir = typeof layout.appsDir === "string" ? layout.appsDir : "apps";
    const libsDir = typeof layout.libsDir === "string" ? layout.libsDir : "libs";
    return [.../* @__PURE__ */ new Set([appsDir, libsDir])].map((dir) => ({ pattern: `${dir}/*`, kind: "nx" }));
  }
  return [];
}
function detectCargoMembers(root, found, warnings) {
  const toml = readText2(join8(root, "Cargo.toml"));
  if (!toml) return;
  const body2 = tomlSectionBody(toml, "workspace");
  if (!body2) return;
  const members = tomlStringArray(body2, "members");
  if (!members.length) return;
  const excludes = tomlStringArray(body2, "exclude").map(wsGlobToRegExp);
  const candidates = /* @__PURE__ */ new Map();
  for (const pat of members) expandPattern(root, pat, candidates, "cargo", warnings);
  for (const [dir, pkg] of candidates) {
    if (excludes.some((re) => re.test(dir))) continue;
    if (!found.has(dir)) found.set(dir, pkg);
  }
}
function detectGoWork(root, found, warnings) {
  const gowork = readText2(join8(root, "go.work"));
  if (!gowork) return;
  const dirs = [];
  for (const block of gowork.matchAll(/^use\s*\(([\s\S]*?)\)/gm)) {
    for (const line of block[1].split(/\r?\n/)) {
      const t = line.replace(/\/\/.*$/, "").trim();
      if (t) dirs.push(t);
    }
  }
  for (const m of gowork.matchAll(/^use\s+([^\s(]+)/gm)) dirs.push(m[1]);
  for (const dir of dirs) {
    if (dir === "." || dir === "./") continue;
    addPackage(root, dir, found, "go", warnings);
  }
}
function detectMavenModules(root, found, warnings) {
  const pom = readText2(join8(root, "pom.xml"));
  if (!pom) return;
  const modules = pom.match(/<modules>([\s\S]*?)<\/modules>/)?.[1];
  if (!modules) return;
  for (const m of modules.matchAll(/<module>\s*([^<]+?)\s*<\/module>/g)) {
    addPackage(root, m[1], found, "maven", warnings);
  }
}
function detectUvMembers(root, found, warnings) {
  const toml = readText2(join8(root, "pyproject.toml"));
  if (!toml) return;
  const body2 = tomlSectionBody(toml, "tool.uv.workspace");
  if (!body2) return;
  const members = tomlStringArray(body2, "members");
  if (!members.length) return;
  const excludes = tomlStringArray(body2, "exclude").map(wsGlobToRegExp);
  const candidates = /* @__PURE__ */ new Map();
  for (const pat of members) expandPattern(root, pat, candidates, "uv", warnings);
  for (const [dir, pkg] of candidates) {
    if (excludes.some((re) => re.test(dir))) continue;
    if (!found.has(dir)) found.set(dir, pkg);
  }
}
function detectComposerPathRepos(root, found, warnings) {
  const composer = readJson2(join8(root, "composer.json"), "composer.json", warnings);
  const repos = composer?.repositories;
  if (!Array.isArray(repos)) return;
  for (const r of repos) {
    if (!r || typeof r !== "object") continue;
    const { type, url } = r;
    if (type === "path" && typeof url === "string" && url) expandPattern(root, url, found, "composer", warnings);
  }
}
function detectGradleIncludes(root, found, warnings) {
  for (const f of ["settings.gradle", "settings.gradle.kts"]) {
    const text = readText2(join8(root, f));
    if (!text) continue;
    for (const line of text.split(/\r?\n/)) {
      if (!/^\s*include[\s(]/.test(line)) continue;
      for (const m of line.matchAll(/["']([^"']+)["']/g)) {
        const dir = m[1].replace(/^:/, "").replace(/:/g, "/");
        if (dir) addPackage(root, dir, found, "gradle", warnings);
      }
    }
  }
}
function npmEdges(root, pkg, byName, warnings) {
  const manifest = readJson2(join8(root, pkg.dir, "package.json"), `${pkg.dir}/package.json`, warnings);
  if (!manifest) return [];
  const edges = /* @__PURE__ */ new Set();
  for (const field of ["dependencies", "devDependencies", "peerDependencies"]) {
    const deps = manifest[field];
    if (!deps || typeof deps !== "object") continue;
    for (const dep of Object.keys(deps)) {
      if (dep !== pkg.name && byName.has(dep)) edges.add(dep);
    }
  }
  return [...edges];
}
function normalizeDepPath(fromDir, rel) {
  const parts2 = `${fromDir}/${rel}`.split("/");
  const out2 = [];
  for (const p of parts2) {
    if (!p || p === ".") continue;
    if (p === "..") out2.pop();
    else out2.push(p);
  }
  return out2.join("/");
}
function cargoEdges(root, pkg, byName, byDir) {
  const toml = readText2(join8(root, pkg.dir, "Cargo.toml"));
  if (!toml) return [];
  const edges = /* @__PURE__ */ new Set();
  for (const section of ["dependencies", "dev-dependencies", "build-dependencies"]) {
    const body2 = tomlSectionBody(toml, section);
    if (!body2) continue;
    for (const line of body2.split(/\r?\n/)) {
      const kv = line.match(/^\s*([A-Za-z0-9_-]+)\s*=\s*(.+)$/);
      if (!kv) continue;
      const dep = kv[1];
      if (dep !== pkg.name && byName.has(dep)) {
        edges.add(dep);
        continue;
      }
      const pathDep = kv[2].match(/path\s*=\s*["']([^"']+)["']/);
      if (pathDep) {
        const target = byDir.get(normalizeDepPath(pkg.dir, pathDep[1]));
        if (target && target !== pkg.name) edges.add(target);
      }
    }
  }
  return [...edges];
}
function goPkgEdges(root, pkg, byName, byDir) {
  const gomod = readText2(join8(root, pkg.dir, "go.mod"));
  if (!gomod) return [];
  const edges = /* @__PURE__ */ new Set();
  for (const m of gomod.matchAll(/^\s*(?:require\s+)?([^\s/(][^\s]*)\s+v[^\s]+/gm)) {
    const dep = m[1];
    if (dep !== pkg.name && byName.has(dep)) edges.add(dep);
  }
  for (const m of gomod.matchAll(/^\s*(?:replace\s+)?(\S+)(?:\s+\S+)?\s*=>\s*(\.\.?\/\S+)/gm)) {
    const target = byDir.get(normalizeDepPath(pkg.dir, m[2]));
    if (target && target !== pkg.name) edges.add(target);
  }
  return [...edges];
}
function mavenEdges(root, pkg, byName) {
  const pom = readText2(join8(root, pkg.dir, "pom.xml"));
  if (!pom) return [];
  const edges = /* @__PURE__ */ new Set();
  for (const m of pom.replace(/<parent>[\s\S]*?<\/parent>/g, "").matchAll(/<dependency>([\s\S]*?)<\/dependency>/g)) {
    const aid = m[1].match(/<artifactId>\s*([^<]+?)\s*<\/artifactId>/)?.[1];
    if (aid && aid !== pkg.name && byName.has(aid)) edges.add(aid);
  }
  return [...edges];
}
function uvEdges(root, pkg, byName) {
  const toml = readText2(join8(root, pkg.dir, "pyproject.toml"));
  if (!toml) return [];
  const edges = /* @__PURE__ */ new Set();
  const project = tomlSectionBody(toml, "project");
  if (project) {
    for (const dep of tomlStringArray(project, "dependencies")) {
      const name2 = dep.match(/^[A-Za-z0-9_.-]+/)?.[0];
      if (name2 && name2 !== pkg.name && byName.has(name2)) edges.add(name2);
    }
  }
  const sources = tomlSectionBody(toml, "tool.uv.sources");
  if (sources) {
    for (const line of sources.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z0-9_.-]+)\s*=\s*\{[^}]*workspace\s*=\s*true/);
      if (m && m[1] !== pkg.name && byName.has(m[1])) edges.add(m[1]);
    }
  }
  return [...edges];
}
function composerEdges(root, pkg, byName, warnings) {
  const manifest = readJson2(join8(root, pkg.dir, "composer.json"), `${pkg.dir}/composer.json`, warnings);
  if (!manifest) return [];
  const edges = /* @__PURE__ */ new Set();
  for (const field of ["require", "require-dev"]) {
    const deps = manifest[field];
    if (!deps || typeof deps !== "object") continue;
    for (const dep of Object.keys(deps)) {
      if (dep !== pkg.name && byName.has(dep)) edges.add(dep);
    }
  }
  return [...edges];
}
function gradleEdges(root, pkg, byName, byDir) {
  for (const f of ["build.gradle", "build.gradle.kts"]) {
    const text = readText2(join8(root, pkg.dir, f));
    if (!text) continue;
    const edges = /* @__PURE__ */ new Set();
    for (const m of text.matchAll(/project\s*\(\s*["']:?([^"']+)["']\s*\)/g)) {
      const path = m[1].replace(/:/g, "/");
      const target = byDir.get(path) ?? (byName.has(path) ? path : void 0);
      if (target && target !== pkg.name) edges.add(target);
    }
    return [...edges];
  }
  return [];
}
function edgesFor(root, pkg, byName, byDir, warnings) {
  switch (pkg.kind) {
    case "cargo":
      return cargoEdges(root, pkg, byName, byDir);
    case "go":
      return goPkgEdges(root, pkg, byName, byDir);
    case "maven":
      return mavenEdges(root, pkg, byName);
    case "uv":
      return uvEdges(root, pkg, byName);
    case "composer":
      return composerEdges(root, pkg, byName, warnings);
    case "gradle":
      return gradleEdges(root, pkg, byName, byDir);
    default:
      return npmEdges(root, pkg, byName, warnings);
  }
}
function findCycle(packages) {
  const deps = new Map(packages.map((p) => [p.name, [...p.dependsOn ?? []].sort(byStr)]));
  const state = /* @__PURE__ */ new Map();
  const stack = [];
  const visit = (name2) => {
    state.set(name2, "visiting");
    stack.push(name2);
    for (const dep of deps.get(name2) ?? []) {
      if (!deps.has(dep)) continue;
      if (state.get(dep) === "visiting") return [...stack.slice(stack.indexOf(dep)), dep];
      if (!state.has(dep)) {
        const found = visit(dep);
        if (found) return found;
      }
    }
    stack.pop();
    state.set(name2, "done");
    return null;
  };
  for (const name2 of [...deps.keys()].sort(byStr)) {
    if (!state.has(name2)) {
      const found = visit(name2);
      if (found) return found;
    }
  }
  return void 0;
}
function topoOrder(packages) {
  const remaining = new Map(packages.map((p) => [p.name, new Set(p.dependsOn ?? [])]));
  const order = [];
  while (remaining.size > 0) {
    const ready = [...remaining.entries()].filter(([, deps]) => [...deps].every((d) => !remaining.has(d))).map(([name2]) => name2).sort(byStr);
    if (!ready.length) {
      order.push(...[...remaining.keys()].sort(byStr));
      break;
    }
    for (const name2 of ready) {
      order.push(name2);
      remaining.delete(name2);
    }
  }
  return order;
}
function detectWorkspaces(root) {
  const warnings = [];
  const found = /* @__PURE__ */ new Map();
  const { positives, negations } = npmFamilyPatterns(root, warnings);
  const npmPatterns = positives.length ? positives : fallbackNpmPatterns(root, warnings);
  if (npmPatterns.length) {
    const candidates = /* @__PURE__ */ new Map();
    for (const { pattern, kind } of npmPatterns) expandPattern(root, pattern, candidates, kind, warnings);
    const negRes = negations.map(wsGlobToRegExp);
    for (const [dir, pkg] of candidates) {
      if (negRes.some((re) => re.test(dir))) continue;
      found.set(dir, pkg);
    }
  }
  detectCargoMembers(root, found, warnings);
  detectGoWork(root, found, warnings);
  detectMavenModules(root, found, warnings);
  detectUvMembers(root, found, warnings);
  detectComposerPathRepos(root, found, warnings);
  detectGradleIncludes(root, found, warnings);
  const packages = [...found.values()].sort((a, b) => byStr(a.dir, b.dir));
  const byName = new Set(packages.map((p) => p.name));
  const byDir = new Map(packages.map((p) => [p.dir, p.name]));
  for (const pkg of packages) {
    const edges = edgesFor(root, pkg, byName, byDir, warnings);
    if (edges.length) pkg.dependsOn = edges.sort(byStr);
  }
  const byDepth = [...packages].sort((a, b) => b.dir.length - a.dir.length);
  return {
    packages,
    cycle: findCycle(packages),
    topoOrder: topoOrder(packages),
    warnings: [...new Set(warnings)].sort(byStr),
    packageOf: (rel) => byDepth.find((p) => rel === p.dir || rel.startsWith(p.dir + "/"))
  };
}
var WS_SKIP_DIRS;
var MAX_RECURSE_DEPTH;
var init_workspaces = __esm({
  "src/workspaces.ts"() {
    "use strict";
    init_walk();
    init_sort();
    init_util();
    WS_SKIP_DIRS = /* @__PURE__ */ new Set(["node_modules", ".git", "dist", "build", "target", "coverage"]);
    MAX_RECURSE_DEPTH = 4;
  }
});
function pagerankOf(ids, edges, damping = DAMPING) {
  const out2 = /* @__PURE__ */ new Map();
  const n = ids.length;
  if (n === 0) return out2;
  const idx = new Map(ids.map((s, i2) => [s, i2]));
  const adj = Array.from({ length: n }, () => []);
  const outW = new Array(n).fill(0);
  for (const e of edges) {
    if (e.dangling) continue;
    const a = idx.get(e.from);
    const b = idx.get(e.to);
    if (a === void 0 || b === void 0 || a === b) continue;
    adj[a].push([b, e.weight]);
    outW[a] += e.weight;
  }
  let pr = new Array(n).fill(1 / n);
  for (let iter = 0; iter < MAX_ITERS; iter++) {
    let dangling = 0;
    for (let i2 = 0; i2 < n; i2++) if (outW[i2] === 0) dangling += pr[i2];
    const base = (1 - damping) / n + damping * dangling / n;
    const next = new Array(n).fill(base);
    for (let i2 = 0; i2 < n; i2++) {
      if (outW[i2] === 0) continue;
      const share = damping * pr[i2] / outW[i2];
      for (const [j, w] of adj[i2]) next[j] += share * w;
    }
    let delta = 0;
    for (let i2 = 0; i2 < n; i2++) delta += Math.abs(next[i2] - pr[i2]);
    pr = next;
    if (delta < CONVERGENCE) break;
  }
  ids.forEach((s, i2) => out2.set(s, pr[i2]));
  return out2;
}
function betweennessOf(ids, edges) {
  const out2 = /* @__PURE__ */ new Map();
  for (const s of ids) out2.set(s, 0);
  const n = ids.length;
  if (n < 3) return out2;
  const idx = new Map(ids.map((s, i2) => [s, i2]));
  const nbSets = Array.from({ length: n }, () => /* @__PURE__ */ new Set());
  for (const e of edges) {
    if (e.dangling) continue;
    const a = idx.get(e.from);
    const b = idx.get(e.to);
    if (a === void 0 || b === void 0 || a === b) continue;
    nbSets[a].add(b);
    nbSets[b].add(a);
  }
  const adj = nbSets.map((s) => [...s].sort((x, y) => x - y));
  const cb = new Array(n).fill(0);
  for (let s = 0; s < n; s++) {
    const stack = [];
    const pred = Array.from({ length: n }, () => []);
    const sigma = new Array(n).fill(0);
    const dist = new Array(n).fill(-1);
    sigma[s] = 1;
    dist[s] = 0;
    const queue = [s];
    for (let qi = 0; qi < queue.length; qi++) {
      const v = queue[qi];
      stack.push(v);
      for (const w of adj[v]) {
        if (dist[w] < 0) {
          dist[w] = dist[v] + 1;
          queue.push(w);
        }
        if (dist[w] === dist[v] + 1) {
          sigma[w] += sigma[v];
          pred[w].push(v);
        }
      }
    }
    const delta = new Array(n).fill(0);
    for (let si = stack.length - 1; si >= 0; si--) {
      const w = stack[si];
      for (const v of pred[w]) delta[v] += sigma[v] / sigma[w] * (1 + delta[w]);
      if (w !== s) cb[w] += delta[w];
    }
  }
  const norm2 = (n - 1) * (n - 2) / 2;
  ids.forEach((id, i2) => out2.set(id, cb[i2] / 2 / norm2));
  return out2;
}
function applyCentrality(graph) {
  const notes = [];
  const nM = graph.modules.length;
  if (nM > 0) {
    const mIds = graph.modules.map((m) => m.id);
    const mPr = pagerankOf(mIds, graph.moduleEdges);
    for (const m of graph.modules) m.pagerank = Number(((mPr.get(m.id) ?? 0) * nM).toFixed(4));
    if (nM > BETWEENNESS_MAX_NODES) {
      notes.push(`betweenness skipped (${nM} modules > ${BETWEENNESS_MAX_NODES})`);
    } else {
      const bt = betweennessOf(mIds, graph.moduleEdges);
      for (const m of graph.modules) m.betweenness = Number((bt.get(m.id) ?? 0).toFixed(6));
    }
  }
  const nF = graph.files.length;
  if (nF > 0) {
    const fIds = graph.files.map((f) => f.id);
    const fPr = pagerankOf(fIds, graph.fileEdges);
    for (const f of graph.files) f.pagerank = Number(((fPr.get(f.id) ?? 0) * nF).toFixed(4));
  }
  return notes;
}
var DAMPING;
var MAX_ITERS;
var CONVERGENCE;
var BETWEENNESS_MAX_NODES;
var init_centrality = __esm({
  "src/centrality.ts"() {
    "use strict";
    DAMPING = 0.85;
    MAX_ITERS = 100;
    CONVERGENCE = 1e-10;
    BETWEENNESS_MAX_NODES = 3e3;
  }
});
function communityOf(graph, slug2) {
  return graph.modules.find((m) => m.slug === slug2)?.community;
}
function buildAdjacency(slugs, edges) {
  const n = slugs.length;
  const idx = new Map(slugs.map((s, i2) => [s, i2]));
  const adj = Array.from({ length: n }, () => /* @__PURE__ */ new Map());
  for (const e of edges) {
    if (e.dangling) continue;
    const a = idx.get(e.from);
    const b = idx.get(e.to);
    if (a === void 0 || b === void 0 || a === b) continue;
    adj[a].set(b, (adj[a].get(b) ?? 0) + e.weight);
    adj[b].set(a, (adj[b].get(a) ?? 0) + e.weight);
  }
  const k = adj.map((m) => {
    let s = 0;
    for (const w of m.values()) s += w;
    return s;
  });
  const twoM = k.reduce((a, b) => a + b, 0);
  return { n, adj, k, twoM };
}
function canonicalize(comm) {
  const remap = /* @__PURE__ */ new Map();
  const out2 = new Array(comm.length);
  for (let i2 = 0; i2 < comm.length; i2++) {
    let id = remap.get(comm[i2]);
    if (id === void 0) {
      id = remap.size;
      remap.set(comm[i2], id);
    }
    out2[i2] = id;
  }
  return { comm: out2, count: remap.size };
}
function localMove(g) {
  const { n, adj, k, twoM } = g;
  const comm = Array.from({ length: n }, (_, i2) => i2);
  if (twoM === 0) return canonicalize(comm);
  const commTot = k.slice();
  let moved = true;
  let sweeps = 0;
  while (moved && sweeps < MAX_SWEEPS) {
    moved = false;
    sweeps++;
    for (let i2 = 0; i2 < n; i2++) {
      const cOld = comm[i2];
      commTot[cOld] -= k[i2];
      const nb = /* @__PURE__ */ new Map();
      for (const [j, wij] of adj[i2]) {
        if (j === i2) continue;
        const cj = comm[j];
        nb.set(cj, (nb.get(cj) ?? 0) + wij);
      }
      let bestC = cOld;
      let bestScore = (nb.get(cOld) ?? 0) - GAMMA * k[i2] * commTot[cOld] / twoM;
      for (const c2 of [...nb.keys()].sort((a, b) => a - b)) {
        if (c2 === cOld) continue;
        const score = nb.get(c2) - GAMMA * k[i2] * commTot[c2] / twoM;
        if (score > bestScore + EPS) {
          bestScore = score;
          bestC = c2;
        }
      }
      commTot[bestC] += k[i2];
      if (bestC !== cOld) {
        comm[i2] = bestC;
        moved = true;
      }
    }
  }
  return canonicalize(comm);
}
function aggregate(g, comm, count) {
  const adj = Array.from({ length: count }, () => /* @__PURE__ */ new Map());
  for (let i2 = 0; i2 < g.n; i2++) {
    const ci = comm[i2];
    for (const [j, wij] of g.adj[i2]) {
      const cj = comm[j];
      adj[ci].set(cj, (adj[ci].get(cj) ?? 0) + wij);
    }
  }
  const k = adj.map((m) => {
    let s = 0;
    for (const w of m.values()) s += w;
    return s;
  });
  const twoM = k.reduce((a, b) => a + b, 0);
  return { n: count, adj, k, twoM };
}
function louvain(g) {
  if (g.n === 0) return [];
  let level = g;
  const mapping = Array.from({ length: g.n }, (_, i2) => i2);
  for (let pass = 0; pass < MAX_PASSES; pass++) {
    const { comm, count } = localMove(level);
    for (let i2 = 0; i2 < mapping.length; i2++) mapping[i2] = comm[mapping[i2]];
    if (count === level.n) break;
    level = aggregate(level, comm, count);
  }
  return canonicalize(mapping).comm;
}
function groupByLabel(labels) {
  const groups = [];
  for (let i2 = 0; i2 < labels.length; i2++) {
    (groups[labels[i2]] ??= []).push(i2);
  }
  return groups.filter((g) => g && g.length > 0);
}
function louvainInduced(g, members) {
  const m = members.length;
  const local = /* @__PURE__ */ new Map();
  members.forEach((b, li) => local.set(b, li));
  const adj = Array.from({ length: m }, () => /* @__PURE__ */ new Map());
  for (let li = 0; li < m; li++) {
    for (const [nb, w] of g.adj[members[li]]) {
      const lj = local.get(nb);
      if (lj === void 0) continue;
      adj[li].set(lj, w);
    }
  }
  const k = adj.map((mp) => {
    let s = 0;
    for (const w of mp.values()) s += w;
    return s;
  });
  const twoM = k.reduce((a, b) => a + b, 0);
  const labels = louvain({ n: m, adj, k, twoM });
  return groupByLabel(labels).map((grp) => grp.map((li) => members[li]));
}
function splitOversized(groups, g, n) {
  const out2 = [];
  for (const grp of groups) {
    if (grp.length > OVERSIZE_FRACTION * n && grp.length >= OVERSIZE_MIN) {
      const sub = louvainInduced(g, grp);
      if (sub.length > 1) {
        out2.push(...sub);
        continue;
      }
    }
    out2.push(grp);
  }
  return out2;
}
function compareCommunities(a, b) {
  if (a.length !== b.length) return b.length - a.length;
  for (let i2 = 0; i2 < a.length; i2++) {
    const c2 = byStr(a[i2], b[i2]);
    if (c2) return c2;
  }
  return 0;
}
function assignIds(ordered, previous) {
  const n = ordered.length;
  const ids = new Array(n).fill(-1);
  if (!previous || Object.keys(previous).length === 0) {
    for (let i2 = 0; i2 < n; i2++) ids[i2] = i2;
    return ids;
  }
  const prevSets = Object.entries(previous).map(([id, members]) => ({
    id: Number(id),
    set: new Set(members)
  }));
  const pairs = [];
  ordered.forEach((comm, ni) => {
    for (const prev of prevSets) {
      let inter = 0;
      for (const s of comm) if (prev.set.has(s)) inter++;
      if (inter > 0) pairs.push({ ni, prevId: prev.id, inter });
    }
  });
  pairs.sort((a, b) => b.inter - a.inter || a.ni - b.ni || a.prevId - b.prevId);
  const matched = /* @__PURE__ */ new Map();
  const usedPrev = /* @__PURE__ */ new Set();
  for (const p of pairs) {
    if (matched.has(p.ni) || usedPrev.has(p.prevId)) continue;
    matched.set(p.ni, p.prevId);
    usedPrev.add(p.prevId);
  }
  const taken = /* @__PURE__ */ new Set();
  for (let ni = 0; ni < n; ni++) {
    const pid = matched.get(ni);
    if (pid !== void 0 && pid >= 0 && pid < n && !taken.has(pid)) {
      ids[ni] = pid;
      taken.add(pid);
    }
  }
  const free = [];
  for (let id = 0; id < n; id++) if (!taken.has(id)) free.push(id);
  let fi = 0;
  for (let ni = 0; ni < n; ni++) if (ids[ni] === -1) ids[ni] = free[fi++];
  return ids;
}
function detectCommunities(modules, edges, previous) {
  const out2 = /* @__PURE__ */ new Map();
  if (modules.length === 0) return out2;
  const slugs = modules.map((m) => m.slug).sort(byStr);
  const g = buildAdjacency(slugs, edges);
  const labels = louvain(g);
  const split = splitOversized(groupByLabel(labels), g, slugs.length);
  const communities = split.map((grp) => grp.map((i2) => slugs[i2]).sort(byStr));
  communities.sort(compareCommunities);
  const ids = assignIds(communities, previous);
  communities.forEach((comm, ni) => {
    for (const s of comm) out2.set(s, ids[ni]);
  });
  return out2;
}
var GAMMA;
var MAX_SWEEPS;
var MAX_PASSES;
var EPS;
var OVERSIZE_FRACTION;
var OVERSIZE_MIN;
var init_community = __esm({
  "src/community.ts"() {
    "use strict";
    init_sort();
    GAMMA = 1;
    MAX_SWEEPS = 20;
    MAX_PASSES = 10;
    EPS = 1e-12;
    OVERSIZE_FRACTION = 0.25;
    OVERSIZE_MIN = 10;
  }
});
function isTestPath(rel) {
  if (TEST_DIR.test(rel)) return true;
  if (isTestFile(rel)) return true;
  const base = rel.split("/").pop();
  return BASENAME_PATTERNS.some((p) => p.test(base));
}
function computeTestMap(graph) {
  const testFiles = /* @__PURE__ */ new Set();
  const moduleOf = /* @__PURE__ */ new Map();
  for (const f of graph.files) {
    moduleOf.set(f.rel, f.module);
    if (f.fileKind === "code" && isTestPath(f.rel)) testFiles.add(f.rel);
  }
  const byFile = /* @__PURE__ */ new Map();
  const byModule = /* @__PURE__ */ new Map();
  for (const e of graph.fileEdges) {
    if (e.dangling) continue;
    if (e.kind !== "import" && e.kind !== "use" && e.kind !== "call") continue;
    if (!testFiles.has(e.from) || testFiles.has(e.to)) continue;
    let set = byFile.get(e.to);
    if (!set) byFile.set(e.to, set = /* @__PURE__ */ new Set());
    set.add(e.from);
    const slug2 = moduleOf.get(e.to);
    if (slug2 !== void 0) {
      let mset = byModule.get(slug2);
      if (!mset) byModule.set(slug2, mset = /* @__PURE__ */ new Set());
      mset.add(e.from);
    }
  }
  const sortSets = (m) => {
    const out2 = /* @__PURE__ */ new Map();
    for (const key2 of [...m.keys()].sort(byStr)) out2.set(key2, [...m.get(key2)].sort(byStr));
    return out2;
  };
  return { testFiles, testedByFile: sortSets(byFile), testedByModule: sortSets(byModule) };
}
function testsForModule(graph, slug2) {
  const m = graph.modules.find((x) => x.slug === slug2);
  if (m?.testedBy) return m.testedBy;
  return computeTestMap(graph).testedByModule.get(slug2) ?? [];
}
function untestedModules(graph) {
  const tm = computeTestMap(graph);
  const codeMembers = /* @__PURE__ */ new Map();
  for (const f of graph.files) {
    if (f.fileKind !== "code" || tm.testFiles.has(f.rel)) continue;
    codeMembers.set(f.module, (codeMembers.get(f.module) ?? 0) + 1);
  }
  return graph.modules.filter(
    (m) => m.tier <= 1 && m.symbols > 0 && (codeMembers.get(m.slug) ?? 0) > 0 && !tm.testedByModule.has(m.slug)
  );
}
var BASENAME_PATTERNS;
var TEST_DIR;
var init_tests_map = __esm({
  "src/tests-map.ts"() {
    "use strict";
    init_modules();
    init_sort();
    BASENAME_PATTERNS = [
      /^test_.*\.py$/i,
      /_test\.py$/i,
      /_test\.go$/,
      /(Test|Tests|IT)\.java$/,
      /(Test|Tests)\.kt$/,
      /_spec\.rb$/,
      /_test\.rb$/,
      /Test\.php$/,
      /(Test|Tests)\.cs$/,
      /_test\.exs$/
    ];
    TEST_DIR = /(^|\/)(tests?|__tests?__|spec|specs|e2e)(\/|$)/i;
  }
});
function computeSurprises(graph) {
  const commOf = /* @__PURE__ */ new Map();
  const tierOf2 = /* @__PURE__ */ new Map();
  for (const m of graph.modules) {
    if (m.community !== void 0) commOf.set(m.slug, m.community);
    tierOf2.set(m.slug, m.tier);
  }
  const pairCount = /* @__PURE__ */ new Map();
  const pairKey = (a, b) => a < b ? `${a}:${b}` : `${b}:${a}`;
  const candidates = [];
  for (const e of graph.moduleEdges) {
    if (e.dangling) continue;
    const ca = commOf.get(e.from);
    const cb = commOf.get(e.to);
    if (ca === void 0 || cb === void 0 || ca === cb) continue;
    pairCount.set(pairKey(ca, cb), (pairCount.get(pairKey(ca, cb)) ?? 0) + 1);
    if (!DEP_KINDS.has(e.kind)) continue;
    if (tierOf2.get(e.to) === 0) continue;
    candidates.push({ edge: e, comms: [ca, cb] });
  }
  return candidates.filter((c2) => pairCount.get(pairKey(c2.comms[0], c2.comms[1])) <= MAX_PAIR_EDGES).map((c2) => ({
    from: c2.edge.from,
    to: c2.edge.to,
    kind: c2.edge.kind,
    weight: c2.edge.weight,
    communities: c2.comms,
    pairEdges: pairCount.get(pairKey(c2.comms[0], c2.comms[1]))
  })).sort((a, b) => a.pairEdges - b.pairEdges || byStr(a.from, b.from) || byStr(a.to, b.to)).slice(0, SURPRISE_CAP);
}
function isSurprising(graph, from, to) {
  const list = graph.surprises ?? computeSurprises(graph);
  return list.some((s) => s.from === from && s.to === to);
}
var SURPRISE_CAP;
var MAX_PAIR_EDGES;
var DEP_KINDS;
var init_surprise = __esm({
  "src/surprise.ts"() {
    "use strict";
    init_sort();
    SURPRISE_CAP = 24;
    MAX_PAIR_EDGES = 2;
    DEP_KINDS = /* @__PURE__ */ new Set(["import", "call", "use"]);
  }
});
function computeSymbolRefs(scan2) {
  const unique = uniqueSymbolDefs(scan2);
  const refs = /* @__PURE__ */ new Map();
  if (!unique.size) return refs;
  const add = (name2, file) => {
    let set = refs.get(name2);
    if (!set) refs.set(name2, set = /* @__PURE__ */ new Set());
    set.add(file);
  };
  for (const f of scan2.files) {
    if (f.kind === "code" && f.idents) {
      for (const id of f.idents) {
        const target = unique.get(id);
        if (target && target !== f.rel) add(id, f.rel);
      }
    } else if (f.kind === "doc") {
      const content = scan2.docText.get(f.rel);
      if (!content) continue;
      for (const tok of content.split(/[^A-Za-z0-9_]+/)) {
        const target = unique.get(tok);
        if (target && target !== f.rel) add(tok, f.rel);
      }
    }
  }
  return refs;
}
function buildSymbolIndex(scan2, refs = /* @__PURE__ */ new Map()) {
  const defsByName = /* @__PURE__ */ new Map();
  for (const f of scan2.files) {
    for (const s of f.symbols) {
      let arr = defsByName.get(s.name);
      if (!arr) defsByName.set(s.name, arr = []);
      arr.push({
        file: s.file,
        line: s.line,
        ...s.endLine !== void 0 ? { endLine: s.endLine } : {},
        kind: s.kind,
        exported: s.exported,
        lang: s.lang,
        ...s.parent ? { parent: s.parent } : {}
      });
    }
  }
  const defs = {};
  for (const name2 of [...defsByName.keys()].sort(byStr)) {
    defs[name2] = defsByName.get(name2).slice().sort((a, b) => byStr(a.file, b.file) || a.line - b.line || byStr(a.kind, b.kind));
  }
  const refsOut = {};
  for (const name2 of [...refs.keys()].sort(byStr)) {
    const files = [...refs.get(name2)].sort(byStr);
    if (files.length) refsOut[name2] = files;
  }
  return { schemaVersion: SCHEMA_VERSION, defs, refs: refsOut };
}
function renderSymbolsJson(index) {
  return JSON.stringify(index, null, 2) + "\n";
}
var init_symbols_json = __esm({
  "src/render/symbols-json.ts"() {
    "use strict";
    init_types();
    init_sort();
    init_graph();
  }
});
function sortObject(obj) {
  const out2 = {};
  for (const k of Object.keys(obj).sort(byStr)) out2[k] = obj[k];
  return out2;
}
function renderGraphJson(graph) {
  const ordered = { ...graph, languages: sortObject(graph.languages) };
  return JSON.stringify(ordered, null, 2) + "\n";
}
var init_graph_json = __esm({
  "src/render/graph-json.ts"() {
    "use strict";
    init_sort();
  }
});
function buildIndexArtifacts(repo, opts = {}) {
  const scan2 = scanRepo(repo, opts);
  const ctx = buildResolveContext(scan2);
  const { modules, moduleOf } = buildModules(scan2);
  const graph = buildGraph(scan2, ctx, modules, moduleOf, opts.meta);
  const communities = detectCommunities(graph.modules, graph.moduleEdges, opts.previousCommunities);
  for (const m of graph.modules) {
    const id = communities.get(m.slug);
    if (id !== void 0) m.community = id;
  }
  applyCentrality(graph);
  const testMap = computeTestMap(graph);
  for (const f of graph.files) {
    if (testMap.testFiles.has(f.rel)) f.testFile = true;
  }
  for (const m of graph.modules) {
    const t = testMap.testedByModule.get(m.slug);
    if (t?.length) m.testedBy = t;
  }
  const surprises = computeSurprises(graph);
  if (surprises.length) graph.surprises = surprises;
  const symbols = buildSymbolIndex(scan2, computeSymbolRefs(scan2));
  return { scan: scan2, graph, symbols };
}
var init_pipeline = __esm({
  "src/pipeline.ts"() {
    "use strict";
    init_scan();
    init_resolve();
    init_modules();
    init_graph();
    init_community();
    init_centrality();
    init_tests_map();
    init_surprise();
    init_symbols_json();
  }
});
function sortHits(hits) {
  return hits.sort((a, b) => byStr(a.file, b.file) || a.line - b.line);
}
function rgBackend(root, pattern, opts) {
  const args2 = [
    "--no-heading",
    "--line-number",
    "--null",
    // path\0line:text — a `:12:` inside a filename can't corrupt parsing
    "--color=never",
    "--no-messages",
    "--hidden",
    "--no-require-git",
    "--no-ignore-global",
    "--no-ignore-exclude",
    "--no-ignore-parent",
    "--no-ignore-dot",
    "--max-filesize",
    "1M"
  ];
  for (const d of IGNORE_DIRS) args2.push("--glob", `!**/${d}/**`);
  for (const l of LOCKFILES) args2.push("--iglob", `!**/${l}`);
  for (const ext of BINARY_EXT) args2.push("--iglob", `!**/*${ext}`);
  args2.push("--glob", "!*.min.js", "--glob", "!*.min.css");
  if (opts.ignoreCase) args2.push("--ignore-case");
  const user = opts.globs ?? [];
  const anchor = (g) => g.startsWith("/") ? g : `/${g}`;
  for (const g of user.filter((g2) => !g2.startsWith("!"))) args2.push("--glob", anchor(g));
  for (const g of user.filter((g2) => g2.startsWith("!"))) args2.push("--glob", `!${anchor(g.slice(1))}`);
  args2.push("--regexp", pattern, "./");
  const res = sh("rg", args2, { cwd: root });
  if (res.missing || !res.ok && res.status !== 1) return void 0;
  const hits = [];
  for (const line of res.stdout.split("\n")) {
    if (!line) continue;
    const nul = line.indexOf("\0");
    if (nul === -1) continue;
    const file = line.slice(0, nul).replace(/^\.\//, "");
    const rest = line.slice(nul + 1);
    const colon = rest.indexOf(":");
    if (colon === -1) continue;
    hits.push({ file, line: Number(rest.slice(0, colon)), text: rest.slice(colon + 1) });
  }
  return hits;
}
function jsBackend(root, re, opts) {
  const filter = compileGlobFilter(opts.globs?.map((g) => g.replace(/^(!?)\//, "$1")));
  const hits = [];
  for (const f of walk(root).files) {
    if (filter && !filter(f.rel)) continue;
    const content = readText2(f.abs);
    if (!content) continue;
    const lines = content.split("\n");
    for (let i2 = 0; i2 < lines.length; i2++) {
      if (re.test(lines[i2])) hits.push({ file: f.rel, line: i2 + 1, text: lines[i2] });
    }
  }
  return hits;
}
function grepRepo(root, pattern, opts = {}) {
  const re = new RegExp(pattern, opts.ignoreCase ? "i" : "");
  const max = opts.maxHits ?? DEFAULT_MAX_HITS;
  let hits;
  if (!opts.noRipgrep && have("rg")) hits = rgBackend(root, pattern, opts);
  hits ??= jsBackend(root, re, opts);
  return sortHits(hits).slice(0, max);
}
var DEFAULT_MAX_HITS;
var init_grep = __esm({
  "src/grep.ts"() {
    "use strict";
    init_walk();
    init_glob();
    init_util();
    init_sort();
    DEFAULT_MAX_HITS = 200;
  }
});
function subtokens(raw) {
  const folded = foldText(raw).replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2");
  const out2 = [];
  const seen = /* @__PURE__ */ new Set();
  const push = (t) => {
    if (t.length < 2 || seen.has(t)) return;
    seen.add(t);
    out2.push(t);
  };
  if (!/\s/.test(raw.trim())) push(foldText(raw).toLowerCase().replace(/[^a-z0-9_]+/g, ""));
  for (const part of folded.split(/[^A-Za-z0-9]+/)) push(part.toLowerCase());
  return out2;
}
function addTerms(doc, text) {
  for (const t of subtokens(text)) {
    doc.tf.set(t, (doc.tf.get(t) ?? 0) + 1);
    doc.len++;
  }
}
function buildDocs(scan2) {
  const docs = [];
  for (const f of scan2.files) {
    const doc = { file: f.rel, tf: /* @__PURE__ */ new Map(), len: 0, symbols: [] };
    const seenSym = /* @__PURE__ */ new Set();
    for (const s of f.symbols) {
      addTerms(doc, s.name);
      if (!seenSym.has(s.name)) {
        seenSym.add(s.name);
        doc.symbols.push(s.name);
      }
    }
    for (const seg of f.rel.split("/")) addTerms(doc, seg);
    for (const h of f.headings) addTerms(doc, h);
    if (f.summary) addTerms(doc, f.summary);
    docs.push(doc);
  }
  return docs;
}
function charTrigrams(term) {
  const padded = `^^${term}$$`;
  const grams = /* @__PURE__ */ new Set();
  for (let i2 = 0; i2 + 3 <= padded.length; i2++) grams.add(padded.slice(i2, i2 + 3));
  return grams;
}
function diceCoefficient(a, b) {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const g of a) if (b.has(g)) inter++;
  return 2 * inter / (a.size + b.size);
}
function buildTrigramIndex(docs) {
  const index = /* @__PURE__ */ new Map();
  for (const d of docs) {
    for (const term of d.tf.keys()) {
      if (!index.has(term)) index.set(term, charTrigrams(term));
    }
  }
  return index;
}
function searchIndex(scan2, query, opts = {}) {
  const terms = [];
  const seen = /* @__PURE__ */ new Set();
  for (const kw of keywords(query)) {
    for (const t of subtokens(kw)) {
      if (seen.has(t)) continue;
      seen.add(t);
      terms.push(t);
    }
  }
  if (!terms.length) return [];
  const docs = buildDocs(scan2);
  const n = docs.length;
  if (!n) return [];
  let totalLen = 0;
  for (const d of docs) totalLen += d.len;
  const avgLen = totalLen / n || 1;
  const df = /* @__PURE__ */ new Map();
  for (const t of terms) {
    let count = 0;
    for (const d of docs) if (d.tf.has(t)) count++;
    df.set(t, count);
  }
  const fuzzyEnabled = opts.fuzzy ?? true;
  const fuzzyCandidates = /* @__PURE__ */ new Map();
  if (fuzzyEnabled) {
    const unmatched = terms.filter((t) => df.get(t) === 0);
    if (unmatched.length) {
      const trigramIndex = buildTrigramIndex(docs);
      for (const t of unmatched) {
        const grams = charTrigrams(t);
        const candidates = [];
        for (const [vocabTerm, vocabGrams] of trigramIndex) {
          const dice = diceCoefficient(grams, vocabGrams);
          if (dice >= FUZZY_DICE_THRESHOLD) candidates.push({ term: vocabTerm, dice });
        }
        candidates.sort((a, b) => b.dice - a.dice || byStr(a.term, b.term));
        fuzzyCandidates.set(t, candidates.slice(0, FUZZY_CAP));
      }
    }
  }
  const vocabDf = /* @__PURE__ */ new Map();
  const dfOfVocabTerm = (term) => {
    const known = df.get(term) ?? vocabDf.get(term);
    if (known !== void 0) return known;
    let count = 0;
    for (const d of docs) if (d.tf.has(term)) count++;
    vocabDf.set(term, count);
    return count;
  };
  const results = [];
  for (const d of docs) {
    let score = 0;
    const matched = [];
    const symbolTerms = /* @__PURE__ */ new Set();
    const fuzzyHit = /* @__PURE__ */ new Set();
    for (const t of terms) {
      const tf = d.tf.get(t);
      if (tf) {
        matched.push(t);
        symbolTerms.add(t);
        const idf = Math.log(1 + (n - df.get(t) + 0.5) / (df.get(t) + 0.5));
        score += idf * (tf * (K1 + 1)) / (tf + K1 * (1 - B + B * d.len / avgLen));
        continue;
      }
      const candidates = fuzzyCandidates.get(t);
      if (!candidates) continue;
      for (const cand of candidates) {
        const ctf = d.tf.get(cand.term);
        if (!ctf) continue;
        const cdf = dfOfVocabTerm(cand.term);
        const idf = Math.log(1 + (n - cdf + 0.5) / (cdf + 0.5));
        const contribution = idf * (ctf * (K1 + 1)) / (ctf + K1 * (1 - B + B * d.len / avgLen));
        score += contribution * cand.dice;
        symbolTerms.add(cand.term);
        fuzzyHit.add(t);
      }
    }
    if (!matched.length && !fuzzyHit.size) continue;
    const scored = d.symbols.map((name2) => {
      const toks = new Set(subtokens(name2));
      let hits = 0;
      for (const t of symbolTerms) if (toks.has(t)) hits++;
      return { name: name2, hits };
    }).filter((s) => s.hits > 0).sort((a, b) => b.hits - a.hits || byStr(a.name, b.name));
    const result = {
      file: d.file,
      score: Number(score.toFixed(4)),
      matchedTerms: matched.sort(byStr),
      topSymbols: scored.slice(0, TOP_SYMBOLS).map((s) => s.name)
    };
    if (fuzzyHit.size) result.fuzzyTerms = [...fuzzyHit].sort(byStr);
    results.push(result);
  }
  results.sort((a, b) => b.score - a.score || byStr(a.file, b.file));
  return results.slice(0, opts.limit ?? DEFAULT_LIMIT);
}
var K1;
var B;
var DEFAULT_LIMIT;
var TOP_SYMBOLS;
var FUZZY_DICE_THRESHOLD;
var FUZZY_CAP;
var init_bm25 = __esm({
  "src/bm25.ts"() {
    "use strict";
    init_util();
    init_sort();
    K1 = 1.2;
    B = 0.75;
    DEFAULT_LIMIT = 20;
    TOP_SYMBOLS = 5;
    FUZZY_DICE_THRESHOLD = 0.6;
    FUZZY_CAP = 3;
  }
});
function resolveEmbedModelDir(repo) {
  const env = process.env.CODEINDEX_EMBED_DIR;
  const candidates = [];
  if (env) candidates.push(env);
  if (repo) candidates.push(join10(repo, ".codeindex", DEFAULT_EMBED_DIRNAME));
  candidates.push(join10(process.cwd(), ".codeindex", DEFAULT_EMBED_DIRNAME));
  for (const c2 of candidates) {
    if (existsSync3(join10(c2, "model.json"))) return c2;
  }
  return void 0;
}
function hasEmbedModel(repo) {
  return resolveEmbedModelDir(repo) !== void 0;
}
function loadEmbedModel(dir) {
  if (!dir) return void 0;
  const path = join10(dir, "model.json");
  if (!existsSync3(path)) return void 0;
  const raw = JSON.parse(readFileSync5(path, "utf8"));
  const { modelId, dim, vocab, weights } = raw;
  if (typeof modelId !== "string" || !modelId) throw new Error(`embed model: missing modelId in ${path}`);
  if (!Number.isInteger(dim) || dim <= 0) throw new Error(`embed model: bad dim ${dim} in ${path}`);
  if (!Array.isArray(vocab) || !Array.isArray(weights) || vocab.length !== weights.length) {
    throw new Error(`embed model: vocab/weights length mismatch in ${path}`);
  }
  const vocabSize = vocab.length;
  const flat = new Float64Array(vocabSize * dim);
  const vmap = /* @__PURE__ */ new Map();
  for (let i2 = 0; i2 < vocabSize; i2++) {
    const tok = vocab[i2];
    if (typeof tok !== "string") throw new Error(`embed model: non-string vocab entry at ${i2}`);
    if (!vmap.has(tok)) vmap.set(tok, i2);
    const row = weights[i2];
    if (!Array.isArray(row) || row.length !== dim) {
      throw new Error(`embed model: row ${i2} has length ${row?.length}, expected ${dim}`);
    }
    for (let d = 0; d < dim; d++) flat[i2 * dim + d] = Number(row[d]);
  }
  const unk = typeof raw.unk === "string" ? raw.unk : "[UNK]";
  const unkId = vmap.has(unk) ? vmap.get(unk) : -1;
  return { modelId, dim, unk, unkId, vocabSize, vocab: vmap, weights: flat };
}
function resolveEmbedPullUrl() {
  const url = process.env.CODEINDEX_EMBED_URL;
  return url && url.trim() ? url.trim() : void 0;
}
var EMBED_VERSION;
var DEFAULT_EMBED_DIRNAME;
var init_model = __esm({
  "src/embed/model.ts"() {
    "use strict";
    EMBED_VERSION = 1;
    DEFAULT_EMBED_DIRNAME = "models";
  }
});
function basicTokenize(text) {
  const spaced = foldText(text).replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2");
  const out2 = [];
  for (const part of spaced.toLowerCase().split(/[^a-z0-9]+/)) {
    if (part) out2.push(part);
  }
  return out2;
}
function wordpiece(word, model) {
  if (!word) return [];
  const ids = [];
  let start2 = 0;
  const n = word.length;
  while (start2 < n) {
    let end = n;
    let match = -1;
    while (end > start2) {
      const piece = start2 === 0 ? word.slice(start2, end) : "##" + word.slice(start2, end);
      const id = model.vocab.get(piece);
      if (id !== void 0) {
        match = id;
        break;
      }
      end--;
    }
    if (match === -1) return model.unkId >= 0 ? [model.unkId] : [];
    ids.push(match);
    start2 = end;
  }
  return ids;
}
function tokenize(text, model) {
  const ids = [];
  for (const word of basicTokenize(text)) {
    for (const id of wordpiece(word, model)) ids.push(id);
  }
  return ids;
}
function roundHalfToEven(x) {
  const f = Math.floor(x);
  const diff = x - f;
  if (diff < 0.5) return f;
  if (diff > 0.5) return f + 1;
  return f % 2 === 0 ? f : f + 1;
}
function encode(model, text) {
  const { dim, weights } = model;
  const out2 = new Int8Array(dim);
  const ids = tokenize(text, model);
  if (ids.length === 0) return out2;
  const pooled = new Float64Array(dim);
  for (const id of ids) {
    const base = id * dim;
    for (let d = 0; d < dim; d++) pooled[d] += weights[base + d];
  }
  const inv = 1 / ids.length;
  for (let d = 0; d < dim; d++) pooled[d] *= inv;
  let sumsq = 0;
  for (let d = 0; d < dim; d++) sumsq += pooled[d] * pooled[d];
  const norm2 = Math.sqrt(sumsq);
  if (norm2 === 0) return out2;
  for (let d = 0; d < dim; d++) {
    let q = roundHalfToEven(pooled[d] / norm2 * QUANT);
    if (q > QUANT) q = QUANT;
    else if (q < -QUANT) q = -QUANT;
    out2[d] = q;
  }
  return out2;
}
function intDot(a, b) {
  const n = Math.min(a.length, b.length);
  let dot = 0;
  for (let i2 = 0; i2 < n; i2++) dot += a[i2] * b[i2];
  return dot;
}
var QUANT;
var init_encode = __esm({
  "src/embed/encode.ts"() {
    "use strict";
    init_util();
    QUANT = 127;
  }
});
function symbolText(rel, name2, signature, summary) {
  return [name2, signature ?? "", summary ?? "", rel.replace(/\//g, " ")].join("\n");
}
function fileText(rel, title, summary, headings) {
  return [title ?? "", summary ?? "", ...headings, rel.replace(/\//g, " ")].join("\n");
}
function buildEmbeddingIndex(scan2, model) {
  const records = [];
  for (const f of scan2.files) {
    const seen = /* @__PURE__ */ new Set();
    let hadSymbol = false;
    for (const s of f.symbols) {
      if (seen.has(s.name)) continue;
      seen.add(s.name);
      hadSymbol = true;
      records.push({
        file: f.rel,
        symbol: s.name,
        line: s.line,
        vec: encode(model, symbolText(f.rel, s.name, s.signature, f.summary))
      });
    }
    if (!hadSymbol) {
      const text = fileText(f.rel, f.title, f.summary, f.headings);
      if (text.replace(/\s+/g, "")) {
        records.push({ file: f.rel, vec: encode(model, text) });
      }
    }
  }
  return { embedVersion: EMBED_VERSION, modelId: model.modelId, dim: model.dim, records };
}
function serializeEmbeddings(index) {
  const header = JSON.stringify({
    embedVersion: index.embedVersion,
    modelId: index.modelId,
    dim: index.dim,
    count: index.records.length,
    records: index.records.map((r) => ({ file: r.file, symbol: r.symbol ?? "", line: r.line ?? 0 }))
  });
  const headerBuf = Buffer.from(header, "utf8");
  const body2 = Buffer.alloc(index.records.length * index.dim);
  let off = 0;
  for (const r of index.records) {
    for (let d = 0; d < index.dim; d++) body2.writeInt8(r.vec[d] ?? 0, off++);
  }
  const out2 = Buffer.alloc(8 + headerBuf.length + body2.length);
  out2.write(MAGIC, 0, "ascii");
  out2.writeUInt32LE(headerBuf.length, 4);
  headerBuf.copy(out2, 8);
  body2.copy(out2, 8 + headerBuf.length);
  return out2;
}
function deserializeEmbeddings(bytes) {
  const buf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (buf.length < 8 || buf.toString("ascii", 0, 4) !== MAGIC) {
    throw new Error("embeddings.bin: bad magic (not a codeindex embeddings artifact)");
  }
  const headerLen = buf.readUInt32LE(4);
  const header = JSON.parse(buf.toString("utf8", 8, 8 + headerLen));
  const bodyOff = 8 + headerLen;
  const { dim } = header;
  const records = header.records.map((m, i2) => {
    const vec = new Int8Array(dim);
    for (let d = 0; d < dim; d++) vec[d] = buf.readInt8(bodyOff + i2 * dim + d);
    const rec = { file: m.file, vec };
    if (m.symbol) rec.symbol = m.symbol;
    if (m.line) rec.line = m.line;
    return rec;
  });
  return { embedVersion: header.embedVersion, modelId: header.modelId, dim, records };
}
var MAGIC;
var init_embed = __esm({
  "src/embed/index.ts"() {
    "use strict";
    init_encode();
    init_model();
    MAGIC = "CIE1";
  }
});
function searchSemantic(scan2, query, index, opts = {}) {
  const limit = opts.limit ?? DEFAULT_LIMIT2;
  const lexical = searchIndex(scan2, query, { limit: Math.max(limit, 50), fuzzy: opts.fuzzy });
  if (!opts.model || !index || index.records.length === 0) {
    return lexical.slice(0, limit);
  }
  const q = encode(opts.model, query);
  const bestByFile = /* @__PURE__ */ new Map();
  for (const r of index.records) {
    const dot = intDot(q, r.vec);
    const prev = bestByFile.get(r.file);
    if (!prev || dot > prev.score) bestByFile.set(r.file, { score: dot, symbol: r.symbol });
  }
  const semList = [...bestByFile.entries()].filter(([, v]) => v.score > 0).sort((a, b) => b[1].score - a[1].score || byStr(a[0], b[0])).map(([file]) => file);
  const lexList = lexical.map((r) => r.file);
  const fused = rrf([lexList, semList], (f) => f, opts.rrfK ?? RRF_K);
  const lexByFile = new Map(lexical.map((r) => [r.file, r]));
  const results = [...fused.entries()].sort((a, b) => b[1] - a[1] || byStr(a[0], b[0])).map(([file, score]) => {
    const lex = lexByFile.get(file);
    const res = {
      file,
      score: Number(score.toFixed(4)),
      matchedTerms: lex?.matchedTerms ?? [],
      topSymbols: lex?.topSymbols ?? []
    };
    const sem = bestByFile.get(file);
    if (sem?.symbol) res.semanticSymbol = sem.symbol;
    if (lex?.fuzzyTerms) res.fuzzyTerms = lex.fuzzyTerms;
    return res;
  });
  return results.slice(0, limit);
}
var DEFAULT_LIMIT2;
var RRF_K;
var init_search = __esm({
  "src/embed/search.ts"() {
    "use strict";
    init_util();
    init_sort();
    init_bm25();
    init_encode();
    DEFAULT_LIMIT2 = 20;
    RRF_K = 60;
  }
});
function isEntrypointLike(rel) {
  const base = rel.split("/").pop();
  const stem = base.split(".")[0].toLowerCase();
  return ENTRYPOINT_STEMS.has(stem);
}
function toList(v) {
  return Array.isArray(v) ? v : [v];
}
function parseRules(input) {
  const raw = Array.isArray(input) ? input : input?.rules;
  if (!Array.isArray(raw)) throw new Error("rules config must be an array (or an object with a `rules` array)");
  return raw.map((entry, i2) => {
    const at = `rules[${i2}]`;
    if (typeof entry !== "object" || entry === null) throw new Error(`${at}: must be an object`);
    const r = entry;
    if (typeof r.name !== "string" || !r.name) throw new Error(`${at}: \`name\` (non-empty string) is required`);
    if (r.severity !== void 0 && !SEVERITIES.has(r.severity))
      throw new Error(`${at} (${r.name}): \`severity\` must be "error" or "warn"`);
    if (r.comment !== void 0 && typeof r.comment !== "string")
      throw new Error(`${at} (${r.name}): \`comment\` must be a string`);
    if (r.builtin !== void 0) {
      if (!BUILTINS.has(r.builtin))
        throw new Error(`${at} (${r.name}): \`builtin\` must be "cycles" or "orphans"`);
      return { name: r.name, builtin: r.builtin, severity: r.severity, comment: r.comment };
    }
    const glob = (field) => {
      const v = r[field];
      const ok = typeof v === "string" ? v.length > 0 : Array.isArray(v) && v.length > 0 && v.every((g) => typeof g === "string" && g);
      if (!ok) throw new Error(`${at} (${r.name}): \`${field}\` must be a glob or a non-empty array of globs`);
      return v;
    };
    const from = glob("from");
    const to = glob("to");
    if (r.kind !== void 0) {
      const ok = Array.isArray(r.kind) && r.kind.every((k) => EDGE_KINDS.has(k));
      if (!ok) throw new Error(`${at} (${r.name}): \`kind\` must be an array of edge kinds (${[...EDGE_KINDS].join(", ")})`);
    }
    return { name: r.name, from, to, kind: r.kind, severity: r.severity, comment: r.comment };
  });
}
function findImportCycles(graph) {
  const adj = /* @__PURE__ */ new Map();
  for (const e of graph.moduleEdges) {
    if (e.kind !== "import") continue;
    let list = adj.get(e.from);
    if (!list) adj.set(e.from, list = []);
    list.push(e.to);
  }
  for (const list of adj.values()) list.sort(byStr);
  const nodes = [...adj.keys()].sort(byStr);
  const indexOf = /* @__PURE__ */ new Map();
  const low = /* @__PURE__ */ new Map();
  const onStack = /* @__PURE__ */ new Set();
  const stack = [];
  const sccs = [];
  let counter = 0;
  for (const root of nodes) {
    if (indexOf.has(root)) continue;
    const work = [{ node: root, next: 0 }];
    while (work.length) {
      const frame = work[work.length - 1];
      const v = frame.node;
      if (frame.next === 0) {
        indexOf.set(v, counter);
        low.set(v, counter);
        counter++;
        stack.push(v);
        onStack.add(v);
      }
      const targets = adj.get(v) ?? [];
      if (frame.next < targets.length) {
        const w = targets[frame.next];
        frame.next++;
        if (!indexOf.has(w)) work.push({ node: w, next: 0 });
        else if (onStack.has(w)) low.set(v, Math.min(low.get(v), indexOf.get(w)));
      } else {
        if (low.get(v) === indexOf.get(v)) {
          const scc = [];
          for (; ; ) {
            const w = stack.pop();
            onStack.delete(w);
            scc.push(w);
            if (w === v) break;
          }
          if (scc.length > 1) sccs.push(scc);
        }
        work.pop();
        const parent = work[work.length - 1];
        if (parent) low.set(parent.node, Math.min(low.get(parent.node), low.get(v)));
      }
    }
  }
  const cycles = [];
  for (const scc of sccs) {
    const members = new Set(scc);
    const start2 = [...scc].sort(byStr)[0];
    const parent = /* @__PURE__ */ new Map([[start2, null]]);
    const order = [start2];
    for (let i2 = 0; i2 < order.length; i2++) {
      const v = order[i2];
      for (const w of adj.get(v) ?? []) {
        if (!members.has(w) || parent.has(w)) continue;
        parent.set(w, v);
        order.push(w);
      }
    }
    const closer = order.find((v) => (adj.get(v) ?? []).includes(start2) && v !== start2) ?? // Degenerate (shouldn't happen in an SCC): fall back to start itself.
    start2;
    const path = [];
    for (let v = closer; v !== null; v = parent.get(v) ?? null) path.unshift(v);
    path.push(start2);
    cycles.push({ start: start2, path });
  }
  return cycles;
}
function checkRules(graph, rules) {
  const out2 = [];
  const emit2 = (rule, v) => {
    out2.push({
      rule: rule.name,
      ...v,
      severity: rule.severity ?? "error",
      ...rule.comment !== void 0 ? { comment: rule.comment } : {}
    });
  };
  const fileSet = new Set(graph.files.map((f) => f.rel));
  for (const rule of rules) {
    if ("builtin" in rule) {
      if (rule.builtin === "cycles") {
        for (const c2 of findImportCycles(graph)) {
          emit2(rule, { from: c2.start, to: c2.path.join(" -> "), kind: "cycle" });
        }
      } else {
        for (const f of graph.files) {
          if (f.fileKind !== "code" || f.degIn !== 0 || f.degOut !== 0) continue;
          if (isEntrypointLike(f.rel)) continue;
          emit2(rule, { from: f.rel, to: f.rel, kind: "orphan" });
        }
      }
      continue;
    }
    const fromMatch = compileGlobs(toList(rule.from));
    const toMatch = compileGlobs(toList(rule.to));
    if (!fromMatch || !toMatch) continue;
    const kinds = rule.kind?.length ? new Set(rule.kind) : null;
    for (const e of graph.fileEdges) {
      if (e.dangling || !fileSet.has(e.to)) continue;
      if (kinds && !kinds.has(e.kind)) continue;
      if (!fromMatch(e.from) || !toMatch(e.to)) continue;
      emit2(rule, { from: e.from, to: e.to, kind: e.kind });
    }
  }
  out2.sort((a, b) => byStr(a.rule, b.rule) || byStr(a.from, b.from) || byStr(a.to, b.to) || byStr(a.kind, b.kind));
  return out2;
}
var EDGE_KINDS;
var SEVERITIES;
var BUILTINS;
var ENTRYPOINT_STEMS;
var init_rules = __esm({
  "src/rules.ts"() {
    "use strict";
    init_glob();
    init_sort();
    EDGE_KINDS = /* @__PURE__ */ new Set(["contains", "doc-link", "import", "call", "use", "mention"]);
    SEVERITIES = /* @__PURE__ */ new Set(["error", "warn"]);
    BUILTINS = /* @__PURE__ */ new Set(["cycles", "orphans"]);
    ENTRYPOINT_STEMS = /* @__PURE__ */ new Set([
      "index",
      "main",
      "app",
      "application",
      "cli",
      "server",
      "entry",
      "entrypoint",
      "setup",
      "conftest",
      "__init__",
      "__main__",
      "mod",
      "lib"
    ]);
  }
});
function changeCoupling(dir, opts = {}) {
  const maxCommitFiles = opts.maxCommitFiles ?? 30;
  const minTogether = opts.minTogether ?? 3;
  const maxPairs = opts.maxPairs ?? 100;
  const range = opts.since ? [`${opts.since}..HEAD`] : [];
  const res = sh("git", ["-C", dir, "-c", "core.quotePath=false", "log", ...range, "--pretty=format:%x1e", "--name-only"]);
  if (!res.ok) return { ok: false, couplings: [] };
  const totals = /* @__PURE__ */ new Map();
  const pairs = /* @__PURE__ */ new Map();
  for (const block of res.stdout.split("")) {
    const files = block.split("\n").map((l) => l.trim()).filter(Boolean);
    if (!files.length || files.length > maxCommitFiles) continue;
    const unique = [...new Set(files)].sort(byStr);
    for (const f of unique) totals.set(f, (totals.get(f) ?? 0) + 1);
    for (let i2 = 0; i2 < unique.length; i2++) {
      for (let j = i2 + 1; j < unique.length; j++) {
        const key2 = `${unique[i2]}\0${unique[j]}`;
        pairs.set(key2, (pairs.get(key2) ?? 0) + 1);
      }
    }
  }
  const out2 = [];
  for (const [key2, together] of pairs) {
    if (together < minTogether) continue;
    const [a, b] = key2.split("\0");
    const totalA = totals.get(a) ?? together;
    const totalB = totals.get(b) ?? together;
    out2.push({ a, b, together, totalA, totalB, strength: Number((together / Math.min(totalA, totalB)).toFixed(3)) });
  }
  out2.sort((x, y) => y.strength - x.strength || y.together - x.together || byStr(x.a, y.a) || byStr(x.b, y.b));
  return { ok: true, couplings: out2.slice(0, maxPairs) };
}
function rankHotspots(scan2, churn, top = 20) {
  const out2 = scan2.files.filter((f) => f.kind === "code").map((f) => {
    const commits = churn.get(f.rel) ?? 0;
    return { rel: f.rel, lines: f.lines, commits, score: Number((commits * Math.log2(f.lines + 1)).toFixed(2)) };
  });
  out2.sort((a, b) => b.score - a.score || b.lines - a.lines || byStr(a.rel, b.rel));
  return out2.slice(0, top);
}
var init_coupling = __esm({
  "src/coupling.ts"() {
    "use strict";
    init_util();
    init_sort();
  }
});
function renderRepoMap(scan2, graph, opts = {}) {
  const budgetChars = (opts.budgetTokens ?? 1024) * CHARS_PER_TOKEN;
  const maxSymbols = opts.maxSymbolsPerFile ?? 8;
  const ranked = [...graph.files].filter((f) => f.fileKind === "code").sort((a, b) => (b.pagerank ?? 0) - (a.pagerank ?? 0) || b.symbols - a.symbols || byStr(a.rel, b.rel));
  const records = new Map(scan2.files.map((f) => [f.rel, f]));
  const header = `# repo map \u2014 ${graph.fileCount} files
`;
  let out2 = header;
  let files = 0;
  for (const node of ranked) {
    const rec = records.get(node.rel);
    if (!rec) continue;
    const symbols = [...rec.symbols].filter((s) => s.kind !== "reexport" && s.kind !== "reexport-all").sort((a, b) => Number(b.exported) - Number(a.exported) || a.line - b.line).slice(0, maxSymbols);
    let block = `
${node.rel}:
`;
    for (const s of symbols) {
      const sig = (s.signature ?? `${s.kind} ${s.name}`).replace(/\s+/g, " ").trim().slice(0, 120);
      block += `  ${s.line}: ${sig}
`;
    }
    if (out2.length + block.length > budgetChars) break;
    out2 += block;
    files++;
  }
  return `${out2}
(${files} of ${ranked.length} code files shown, ~${Math.ceil(out2.length / CHARS_PER_TOKEN)} tokens)
`;
}
var CHARS_PER_TOKEN;
var init_repomap = __esm({
  "src/repomap.ts"() {
    "use strict";
    init_sort();
    CHARS_PER_TOKEN = 4;
  }
});
function findDeadCode(scan2) {
  const callers = buildCallerIndex(scan2);
  const refs = computeSymbolRefs(scan2);
  const out2 = [];
  const consider = (s) => s.exported && !REFERENCE_KINDS6.has(s.kind) && !isTestPath(s.file) && !ENTRYPOINT_RE.test(s.file);
  for (const f of scan2.files) {
    for (const s of f.symbols) {
      if (!consider(s)) continue;
      const entry = callers.get(s.name) ?? callers.get(`${s.name}@${s.file}`);
      const hasCallers = !!entry && entry.def.file === s.file && entry.callers.length > 0;
      if (hasCallers) continue;
      const referenced = (refs.get(s.name)?.size ?? 0) > 0;
      out2.push({ name: s.name, file: s.file, line: s.line, kind: s.kind, tier: referenced ? "uncalled" : "unreferenced" });
    }
  }
  return out2.sort((a, b) => byStr(a.tier, b.tier) || byStr(a.file, b.file) || a.line - b.line);
}
var REFERENCE_KINDS6;
var ENTRYPOINT_RE;
var init_deadcode = __esm({
  "src/deadcode.ts"() {
    "use strict";
    init_callers();
    init_symbols_json();
    init_tests_map();
    init_sort();
    REFERENCE_KINDS6 = /* @__PURE__ */ new Set(["reexport", "reexport-all", "default"]);
    ENTRYPOINT_RE = /(^|\/)(index|main|cli|app|server|engine)\.[a-z]+$/;
  }
});
function complexityOfSource(source) {
  return 1 + (source.match(BRANCH_RE) ?? []).length;
}
function symbolComplexity(scan2, rel, top = 50) {
  const out2 = [];
  for (const f of scan2.files) {
    if (f.kind !== "code") continue;
    if (rel && f.rel !== rel) continue;
    if (!f.symbols.length) continue;
    const lines = readText2(join11(scan2.root, f.rel)).split("\n");
    for (const s of f.symbols) {
      if (s.kind === "reexport" || s.kind === "reexport-all") continue;
      const end = s.endLine ?? s.line;
      const body2 = lines.slice(s.line - 1, end).join("\n");
      const entry = { file: f.rel, name: s.name, line: s.line, complexity: complexityOfSource(body2) };
      if (s.endLine !== void 0) entry.endLine = s.endLine;
      out2.push(entry);
    }
  }
  out2.sort((a, b) => b.complexity - a.complexity || byStr(a.file, b.file) || a.line - b.line);
  return out2.slice(0, top);
}
function riskHotspots(scan2, churn, top = 20) {
  const out2 = scan2.files.filter((f) => f.kind === "code").map((f) => {
    const complexity = complexityOfSource(readText2(join11(scan2.root, f.rel)));
    const commits = churn.get(f.rel) ?? 0;
    return { file: f.rel, complexity, commits, score: (commits + 1) * complexity };
  });
  out2.sort((a, b) => b.score - a.score || byStr(a.file, b.file));
  return out2.slice(0, top);
}
var BRANCH_RE;
var init_complexity = __esm({
  "src/complexity.ts"() {
    "use strict";
    init_walk();
    init_sort();
    BRANCH_RE = /\b(if|elif|elsif|else\s+if|for|foreach|while|until|unless|case|when|match|catch|rescue|except)\b|&&|\|\||(?<![?:])\?(?![?.:])/g;
  }
});
function renderMermaid(graph, opts = {}) {
  const maxEdges = opts.maxEdges ?? 80;
  let edges = [...graph.moduleEdges].filter((e) => !e.dangling);
  if (opts.module) {
    edges = edges.filter((e) => e.from === opts.module || e.to === opts.module);
  }
  edges.sort((a, b) => b.weight - a.weight || byStr(a.from, b.from) || byStr(a.to, b.to));
  const dropped = Math.max(0, edges.length - maxEdges);
  edges = edges.slice(0, maxEdges);
  const shown = /* @__PURE__ */ new Set();
  for (const e of edges) {
    shown.add(e.from);
    shown.add(e.to);
  }
  if (opts.module) shown.add(opts.module);
  const lines = ["graph LR"];
  for (const m of [...graph.modules].sort((a, b) => byStr(a.slug, b.slug))) {
    if (!shown.has(m.slug)) continue;
    lines.push(`  ${sanitizeId(m.slug)}["${m.slug}${m.tier === 0 ? " (core)" : ""}"]`);
  }
  for (const e of edges) {
    const label = e.kind === "import" ? "" : `|${e.kind}|`;
    lines.push(`  ${sanitizeId(e.from)} -->${label} ${sanitizeId(e.to)}`);
  }
  if (dropped) lines.push(`  %% ${dropped} lighter edges omitted (maxEdges=${maxEdges})`);
  return lines.join("\n") + "\n";
}
var sanitizeId;
var init_viz = __esm({
  "src/viz.ts"() {
    "use strict";
    init_sort();
    sanitizeId = (slug2) => slug2.replace(/[^\w]/g, "_");
  }
});
var mcp_exports = {};
__export(mcp_exports, {
  runMcpServer: () => runMcpServer
});
function str(v) {
  return typeof v === "string" && v ? v : void 0;
}
function strArray(v) {
  return Array.isArray(v) && v.every((x) => typeof x === "string") && v.length ? v : void 0;
}
function callTool(name2, args2) {
  const repo = str(args2.repo);
  if (!repo) throw new Error("`repo` is required (absolute path to the repository root)");
  const scanOpts = { scope: str(args2.scope), include: strArray(args2.include), exclude: strArray(args2.exclude) };
  if (name2 === "scan_summary") {
    const scan2 = scanRepo(repo, scanOpts);
    return JSON.stringify(
      { engineVersion: ENGINE_VERSION, commit: scan2.commit, fileCount: scan2.files.length, languages: scan2.languages, capped: scan2.capped },
      null,
      2
    );
  }
  if (name2 === "graph") {
    return renderGraphJson(buildIndexArtifacts(repo, scanOpts).graph);
  }
  if (name2 === "symbols") {
    const { symbols } = buildIndexArtifacts(repo, scanOpts);
    const lookup = str(args2.name);
    if (lookup) {
      return JSON.stringify({ name: lookup, defs: symbols.defs[lookup] ?? [], refs: symbols.refs[lookup] ?? [] }, null, 2);
    }
    return JSON.stringify(symbols, null, 2);
  }
  if (name2 === "callers") {
    const index = buildCallerIndex(scanRepo(repo, scanOpts));
    const lookup = str(args2.name);
    if (lookup) {
      const entry = index.get(lookup);
      return JSON.stringify(entry ?? { error: `no tracked callers for "${lookup}"` }, null, 2);
    }
    const obj = {};
    for (const [k, v] of index) obj[k] = v;
    return JSON.stringify(obj, null, 2);
  }
  if (name2 === "workspaces") {
    const info2 = detectWorkspaces(repo);
    return JSON.stringify({ packages: info2.packages, cycle: info2.cycle ?? null, topoOrder: info2.topoOrder }, null, 2);
  }
  if (name2 === "churn") {
    const { churn, ok } = gitChurn(repo, { since: str(args2.since) });
    const sorted = {};
    for (const k of [...churn.keys()].sort()) sorted[k] = churn.get(k);
    return JSON.stringify({ ok, churn: sorted }, null, 2);
  }
  if (name2 === "symbols_overview") {
    const file = str(args2.file);
    if (!file) throw new Error("`file` is required");
    return JSON.stringify(symbolsOverview(scanRepo(repo, scanOpts), file), null, 2);
  }
  if (name2 === "find_symbol") {
    const namePath = str(args2.namePath);
    if (!namePath) throw new Error("`namePath` is required");
    const matches = findSymbol(scanRepo(repo, scanOpts), namePath, {
      substring: args2.substring === true,
      includeBody: args2.includeBody === true
    });
    return JSON.stringify(matches, null, 2);
  }
  if (name2 === "find_references") {
    const symName = str(args2.name);
    if (!symName) throw new Error("`name` is required");
    return JSON.stringify(findReferences(scanRepo(repo, scanOpts), symName), null, 2);
  }
  if (name2 === "replace_symbol_body" || name2 === "insert_after_symbol" || name2 === "insert_before_symbol") {
    const namePath = str(args2.namePath);
    const body2 = typeof args2.body === "string" ? args2.body : void 0;
    if (!namePath || body2 === void 0) throw new Error("`namePath` and `body` are required");
    const scan2 = scanRepo(repo, scanOpts);
    const fn = name2 === "replace_symbol_body" ? replaceSymbolBody : name2 === "insert_after_symbol" ? insertAfterSymbol : insertBeforeSymbol;
    return JSON.stringify(fn(scan2, namePath, body2, str(args2.file)), null, 2);
  }
  if (name2 === "write_memory") {
    const memName = str(args2.name);
    const content = typeof args2.content === "string" ? args2.content : void 0;
    if (!memName || content === void 0) throw new Error("`name` and `content` are required");
    return JSON.stringify({ written: writeMemory(repo, memName, content) }, null, 2);
  }
  if (name2 === "read_memory") {
    const memName = str(args2.name);
    if (!memName) throw new Error("`name` is required");
    const content = readMemory(repo, memName);
    if (content === void 0) throw new Error(`no memory named "${memName}" \u2014 see list_memories`);
    return content;
  }
  if (name2 === "list_memories") {
    return JSON.stringify(listMemories(repo), null, 2);
  }
  if (name2 === "delete_memory") {
    const memName = str(args2.name);
    if (!memName) throw new Error("`name` is required");
    return JSON.stringify({ deleted: deleteMemory(repo, memName) }, null, 2);
  }
  if (name2 === "dead_code") {
    return JSON.stringify(findDeadCode(scanRepo(repo, scanOpts)), null, 2);
  }
  if (name2 === "complexity") {
    const scan2 = scanRepo(repo, scanOpts);
    if (args2.risk === true) {
      const { churn, ok } = gitChurn(repo);
      return JSON.stringify({ churnOk: ok, risks: riskHotspots(scan2, churn) }, null, 2);
    }
    return JSON.stringify(symbolComplexity(scan2, str(args2.file)), null, 2);
  }
  if (name2 === "mermaid") {
    const { graph } = buildIndexArtifacts(repo, scanOpts);
    return renderMermaid(graph, { module: str(args2.module) });
  }
  if (name2 === "repo_map") {
    const { scan: scan2, graph } = buildIndexArtifacts(repo, scanOpts);
    return renderRepoMap(scan2, graph, { budgetTokens: typeof args2.budgetTokens === "number" ? args2.budgetTokens : void 0 });
  }
  if (name2 === "hotspots") {
    const scan2 = scanRepo(repo, scanOpts);
    const { churn, ok } = gitChurn(repo, { since: str(args2.since) });
    return JSON.stringify({ churnOk: ok, hotspots: rankHotspots(scan2, churn) }, null, 2);
  }
  if (name2 === "coupling") {
    const { ok, couplings } = changeCoupling(repo, { since: str(args2.since) });
    return JSON.stringify({ ok, couplings }, null, 2);
  }
  if (name2 === "grep") {
    const pattern = str(args2.pattern);
    if (!pattern) throw new Error("`pattern` is required");
    const hits = grepRepo(repo, pattern, {
      globs: strArray(args2.globs),
      ignoreCase: args2.ignoreCase === true,
      maxHits: typeof args2.maxHits === "number" ? args2.maxHits : void 0
    });
    return JSON.stringify(hits, null, 2);
  }
  if (name2 === "search") {
    const query = str(args2.query);
    if (!query) throw new Error("`query` is required");
    const scan2 = scanRepo(repo, scanOpts);
    const limit = typeof args2.limit === "number" ? args2.limit : void 0;
    const fuzzy = typeof args2.fuzzy === "boolean" ? args2.fuzzy : void 0;
    if (args2.semantic === true) {
      const modelDir = resolveEmbedModelDir(repo);
      const model = modelDir ? loadEmbedModel(modelDir) : void 0;
      if (model) {
        const index = buildEmbeddingIndex(scan2, model);
        return JSON.stringify(searchSemantic(scan2, query, index, { model, limit, fuzzy }), null, 2);
      }
    }
    return JSON.stringify(searchIndex(scan2, query, { limit, fuzzy }), null, 2);
  }
  if (name2 === "embed_status") {
    const modelDir = resolveEmbedModelDir(repo);
    const model = modelDir ? loadEmbedModel(modelDir) : void 0;
    return JSON.stringify(
      {
        embedVersion: EMBED_VERSION,
        model: model ? { present: true, dir: modelDir, modelId: model.modelId, dim: model.dim, vocabSize: model.vocabSize } : { present: false },
        endpoint: process.env.CODEINDEX_EMBED_ENDPOINT ?? null
      },
      null,
      2
    );
  }
  if (name2 === "check_rules") {
    const rules = parseRules(args2.rules);
    const { graph } = buildIndexArtifacts(repo, scanOpts);
    return JSON.stringify(checkRules(graph, rules), null, 2);
  }
  throw new Error(`unknown tool: ${name2}`);
}
async function runMcpServer() {
  await ensureGrammars(allGrammarKeys());
  const send = (msg) => {
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...msg }) + "\n");
  };
  const rl = createInterface({ input: process.stdin, terminal: false });
  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let parsed;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      send({ id: null, error: { code: -32700, message: "parse error" } });
      continue;
    }
    const requests = Array.isArray(parsed) ? parsed : [parsed];
    for (const req of requests) handle2(req);
  }
  function handle2(req) {
    if (req.id === void 0 || req.id === null) return;
    try {
      if (req.method === "initialize") {
        send({
          id: req.id,
          result: {
            protocolVersion: "2024-11-05",
            capabilities: { tools: {} },
            serverInfo: { name: "codeindex", version: ENGINE_VERSION }
          }
        });
      } else if (req.method === "ping") {
        send({ id: req.id, result: {} });
      } else if (req.method === "tools/list") {
        send({ id: req.id, result: { tools: TOOLS } });
      } else if (req.method === "tools/call") {
        const params = req.params ?? {};
        const name2 = str(params.name) ?? "";
        const args2 = params.arguments ?? {};
        try {
          const text = callTool(name2, args2);
          send({ id: req.id, result: { content: [{ type: "text", text }] } });
        } catch (e) {
          send({
            id: req.id,
            result: { content: [{ type: "text", text: e instanceof Error ? e.message : String(e) }], isError: true }
          });
        }
      } else {
        send({ id: req.id, error: { code: -32601, message: `method not found: ${req.method}` } });
      }
    } catch (e) {
      send({ id: req.id, error: { code: -32603, message: e instanceof Error ? e.message : String(e) } });
    }
  }
}
var repoProp;
var scopeProps;
var TOOLS;
var init_mcp = __esm({
  "src/mcp.ts"() {
    "use strict";
    init_types();
    init_loader();
    init_pipeline();
    init_graph_json();
    init_scan();
    init_callers();
    init_workspaces();
    init_git();
    init_grep();
    init_coupling();
    init_repomap();
    init_deadcode();
    init_complexity();
    init_viz();
    init_query();
    init_edit();
    init_memory();
    init_bm25();
    init_rules();
    init_model();
    init_embed();
    init_search();
    repoProp = { repo: { type: "string", description: "Absolute path to the repository root" } };
    scopeProps = {
      scope: { type: "string", description: "Restrict to one directory (repo-relative)" },
      include: { type: "array", items: { type: "string" }, description: "Include globs" },
      exclude: { type: "array", items: { type: "string" }, description: "Exclude globs" }
    };
    TOOLS = [
      {
        name: "scan_summary",
        description: "Deterministically scan a repository: file count, per-language file histogram, HEAD commit, and whether the walk was capped. Fast first look at any codebase.",
        inputSchema: { type: "object", properties: { ...repoProp, ...scopeProps }, required: ["repo"] }
      },
      {
        name: "graph",
        description: "Build the full typed cross-file link-graph (import/call/use/doc-link/mention edges, module grouping, PageRank centrality, Louvain communities, tests-map). Returns graph.json. Large on big repos \u2014 prefer scan_summary/symbols/callers for targeted questions.",
        inputSchema: { type: "object", properties: { ...repoProp, ...scopeProps }, required: ["repo"] }
      },
      {
        name: "symbols",
        description: "Where is a symbol defined and which files reference it? Returns the definition sites (file, line, kind, exported) and referencing files. Omit `name` for the full symbol index.",
        inputSchema: {
          type: "object",
          properties: { ...repoProp, name: { type: "string", description: "Symbol name to look up" } },
          required: ["repo"]
        }
      },
      {
        name: "callers",
        description: "Who calls a function? Per-symbol caller index: each defined symbol with the exact (file, line) call sites that bind to it. Omit `name` for the full index.",
        inputSchema: {
          type: "object",
          properties: { ...repoProp, name: { type: "string", description: "Symbol name to look up" } },
          required: ["repo"]
        }
      },
      {
        name: "workspaces",
        description: "Detect monorepo packages (npm/pnpm/yarn/lerna/nx/cargo/go.work/maven) with the workspace dependency graph, one cycle if present, and a topological build order.",
        inputSchema: { type: "object", properties: { ...repoProp }, required: ["repo"] }
      },
      {
        name: "churn",
        description: "Per-file git commit counts (whole history, or since a ref) \u2014 the churn half of hotspot analysis.",
        inputSchema: {
          type: "object",
          properties: { ...repoProp, since: { type: "string", description: "Only count commits after this ref" } },
          required: ["repo"]
        }
      },
      {
        name: "symbols_overview",
        description: "All symbols declared in ONE file (name, kind, line span, exported, parent), in declaration order \u2014 the fastest way to understand a file without reading it.",
        inputSchema: {
          type: "object",
          properties: { ...repoProp, file: { type: "string", description: "Repo-relative file path" } },
          required: ["repo", "file"]
        }
      },
      {
        name: "find_symbol",
        description: "Find symbol declarations by name or name path ('Class/method' matches a method inside Class). Options: substring matching, includeBody to return the declaration's source. Exact-name matches rank first.",
        inputSchema: {
          type: "object",
          properties: {
            ...repoProp,
            namePath: { type: "string", description: "Symbol name or Parent/child path" },
            substring: { type: "boolean" },
            includeBody: { type: "boolean" }
          },
          required: ["repo", "namePath"]
        }
      },
      {
        name: "find_references",
        description: "Who references a symbol? Three labeled tiers: defs (declarations), callSites (line-precise, import-corroborated call bindings), referencingFiles (file-level identifier/doc mentions \u2014 may include homonyms). Confidence decreases across tiers; the labels let you decide what to trust.",
        inputSchema: {
          type: "object",
          properties: { ...repoProp, name: { type: "string", description: "Symbol name" } },
          required: ["repo", "name"]
        }
      },
      {
        name: "repo_map",
        description: "Token-budgeted map of the repository: the highest-PageRank files with their key exported signatures, deterministically rendered to fit `budgetTokens` (default 1024). The densest single read to understand an unfamiliar codebase.",
        inputSchema: {
          type: "object",
          properties: { ...repoProp, budgetTokens: { type: "number", description: "Approximate token budget (default 1024)" } },
          required: ["repo"]
        }
      },
      {
        name: "hotspots",
        description: "Where does work concentrate? Files ranked by git churn \xD7 size (commits \xD7 log2 lines). High-scoring files are where changes and defects cluster.",
        inputSchema: {
          type: "object",
          properties: { ...repoProp, since: { type: "string", description: "Only count commits after this ref" } },
          required: ["repo"]
        }
      },
      {
        name: "coupling",
        description: "Change coupling: pairs of files that repeatedly change in the same commits \u2014 hidden dependencies no import shows. strength 1.0 = every change to one touched the other.",
        inputSchema: {
          type: "object",
          properties: { ...repoProp, since: { type: "string", description: "Only mine commits after this ref" } },
          required: ["repo"]
        }
      },
      {
        name: "replace_symbol_body",
        description: "WRITE: replace a symbol's whole declaration with `body` (verbatim, supply full indentation). The symbol is resolved by name path ('Class/method'); ambiguity errors list the candidates \u2014 qualify with `file`. Line spans come from the AST index.",
        inputSchema: {
          type: "object",
          properties: {
            ...repoProp,
            namePath: { type: "string" },
            body: { type: "string" },
            file: { type: "string", description: "Disambiguate: repo-relative file containing the symbol" }
          },
          required: ["repo", "namePath", "body"]
        }
      },
      {
        name: "insert_after_symbol",
        description: "WRITE: insert `body` after a symbol's declaration (blank-line separation preserved for definition-like kinds). Resolved like replace_symbol_body.",
        inputSchema: {
          type: "object",
          properties: { ...repoProp, namePath: { type: "string" }, body: { type: "string" }, file: { type: "string" } },
          required: ["repo", "namePath", "body"]
        }
      },
      {
        name: "insert_before_symbol",
        description: "WRITE: insert `body` before a symbol's declaration (blank-line separation preserved). Resolved like replace_symbol_body.",
        inputSchema: {
          type: "object",
          properties: { ...repoProp, namePath: { type: "string" }, body: { type: "string" }, file: { type: "string" } },
          required: ["repo", "namePath", "body"]
        }
      },
      {
        name: "write_memory",
        description: "Persist a named markdown note under <repo>/.codeindex/memories/ (names may use topic/name form). Write small, focused notes: project map, build commands, conventions.",
        inputSchema: {
          type: "object",
          properties: { ...repoProp, name: { type: "string" }, content: { type: "string" } },
          required: ["repo", "name", "content"]
        }
      },
      {
        name: "read_memory",
        description: "Read one persisted memory by name.",
        inputSchema: {
          type: "object",
          properties: { ...repoProp, name: { type: "string" } },
          required: ["repo", "name"]
        }
      },
      {
        name: "list_memories",
        description: "List persisted memory names \u2014 load this first, then read individual memories on relevance.",
        inputSchema: { type: "object", properties: { ...repoProp }, required: ["repo"] }
      },
      {
        name: "delete_memory",
        description: "Delete one persisted memory by name.",
        inputSchema: {
          type: "object",
          properties: { ...repoProp, name: { type: "string" } },
          required: ["repo", "name"]
        }
      },
      {
        name: "dead_code",
        description: "Dead-code candidates in two labeled tiers: 'unreferenced' (no call site binds AND nothing references the name) and 'uncalled' (referenced somewhere \u2014 re-export, type position \u2014 but never called). Exported symbols only; test files and entrypoint-looking files excluded as roots.",
        inputSchema: { type: "object", properties: { ...repoProp, ...scopeProps }, required: ["repo"] }
      },
      {
        name: "complexity",
        description: "Cyclomatic-complexity estimates (branch-token counting over AST line spans), most-complex first. Pass `file` for one file's symbols, omit for the repo-wide top. Combine with hotspots: the `risk` field of this tool's sibling ranks complexity \xD7 churn.",
        inputSchema: {
          type: "object",
          properties: { ...repoProp, file: { type: "string" }, risk: { type: "boolean", description: "Return complexity \xD7 git-churn risk ranking instead" } },
          required: ["repo"]
        }
      },
      {
        name: "mermaid",
        description: "Mermaid diagram of the module graph (renders inline in Claude/GitHub \u2014 no graph database). Optionally scoped to one module's neighborhood.",
        inputSchema: {
          type: "object",
          properties: { ...repoProp, module: { type: "string", description: "Module slug to focus on" } },
          required: ["repo"]
        }
      },
      {
        name: "grep",
        description: "Search file contents (ripgrep when available, deterministic JS fallback otherwise). Returns sorted (file, line, text) hits.",
        inputSchema: {
          type: "object",
          properties: {
            ...repoProp,
            pattern: { type: "string", description: "Regular expression to search for" },
            globs: { type: "array", items: { type: "string" }, description: "Restrict to matching paths" },
            ignoreCase: { type: "boolean" },
            maxHits: { type: "number" }
          },
          required: ["repo", "pattern"]
        }
      },
      {
        name: "search",
        description: 'Natural-language-ish lexical search: BM25 ranking (k1=1.2, b=0.75) over symbol names (camelCase/snake_case subtokens), file path segments, markdown headings and summary lines. NOT embeddings by default \u2014 deterministic, diacritic-folded, zero API keys. Answers "where is auth handled?"-style queries with ranked files, matched terms and top symbols. Query terms with zero document frequency get a deterministic trigram-fuzzy fallback (typo-tolerant) unless `fuzzy: false`. Set `semantic: true` to RRF-fuse the deterministic static-embedding tier when a model asset is present (degrades to lexical otherwise \u2014 see embed_status).',
        inputSchema: {
          type: "object",
          properties: {
            ...repoProp,
            ...scopeProps,
            query: { type: "string", description: "Natural-language or identifier query" },
            limit: { type: "number", description: "Max results (default 20)" },
            fuzzy: {
              type: "boolean",
              description: "Trigram fuzzy fallback for query terms with zero document frequency (default true)"
            },
            semantic: {
              type: "boolean",
              description: "RRF-fuse the deterministic static-embedding tier with lexical when a model asset is present (default false; silently lexical-only when no model)"
            }
          },
          required: ["repo", "query"]
        }
      },
      {
        name: "embed_status",
        description: "Report the deterministic static-embedding tier: whether a model asset is resolved (opt-in, never shipped in the package), its modelId/dim, EMBED_VERSION, and any configured HTTP endpoint. Use to check whether `search` with semantic:true will actually fuse embeddings or degrade to lexical.",
        inputSchema: { type: "object", properties: { ...repoProp }, required: ["repo"] }
      },
      {
        name: "check_rules",
        description: 'Validate dependency-cruiser-style architecture rules against the link-graph. Rules (inline JSON array): forbidden edges {name, from, to, kind?, severity?, comment?} with glob paths, plus builtins {name, builtin: "cycles"|"orphans"} (module-level import cycles; edge-less code files). Returns deterministic violations with severity error|warn \u2014 a CI gate.',
        inputSchema: {
          type: "object",
          properties: {
            ...repoProp,
            ...scopeProps,
            rules: { type: "array", description: "Rules array (inline JSON \u2014 see description)" }
          },
          required: ["repo", "rules"]
        }
      }
    ];
  }
});
init_types();
init_walk();
init_scan();
init_glob();
init_ignore();
init_classify();
var CODE_EXTS = /* @__PURE__ */ new Set([
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".vue",
  ".svelte",
  ".astro",
  ".py",
  ".rb",
  ".go",
  ".rs",
  ".java",
  ".kt",
  ".kts",
  ".php",
  ".c",
  ".cc",
  ".cpp",
  ".h",
  ".hpp",
  ".cs",
  ".swift",
  ".scala",
  ".clj",
  ".ex",
  ".exs",
  ".dart",
  ".lua",
  ".sh",
  ".bash",
  ".zig",
  ".elm"
]);
var STYLE_EXTS = /* @__PURE__ */ new Set([".css", ".scss", ".sass", ".less", ".styl", ".pcss"]);
var DOC_EXTS = /* @__PURE__ */ new Set([".md", ".mdx", ".rst", ".adoc", ".txt"]);
var DATA_EXTS = /* @__PURE__ */ new Set([".json", ".yaml", ".yml", ".toml", ".csv", ".xml", ".env"]);
var ASSET_EXTS = /* @__PURE__ */ new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".avif",
  ".ico",
  ".bmp",
  ".tiff",
  ".svg",
  ".pdf",
  ".woff",
  ".woff2",
  ".ttf",
  ".otf",
  ".eot",
  ".mp3",
  ".mp4",
  ".mov",
  ".avi",
  ".webm",
  // Archives / compiled binaries: reconstruct's bundle files these under
  // "asset" (opaque blob shipped with the repo, not code/data) — the engine
  // matches instead of letting them fall through to "other".
  ".zip",
  ".gz",
  ".tar",
  ".rar",
  ".7z",
  ".wasm",
  ".so",
  ".dylib",
  ".dll",
  ".exe",
  ".bin",
  ".class",
  ".jar",
  ".pyc",
  ".node"
]);
var I18N_DIRS = ["locales", "locale", "i18n", "lang", "langs", "translations", "messages"];
var I18N_EXTS = /* @__PURE__ */ new Set([".json", ".yaml", ".yml", ".po", ".properties"]);
var TEST_DIRS = ["__tests__", "test", "tests", "spec", "e2e", "__mocks__"];
var SCHEMA_DIRS = ["migrations", "entities", "models"];
var CONFIG_BASES = /* @__PURE__ */ new Set([
  "package.json",
  "tsconfig.json",
  "dockerfile",
  "makefile",
  "pyproject.toml",
  "cargo.toml",
  "go.mod",
  "requirements.txt",
  "gemfile",
  "composer.json",
  "pubspec.yaml"
]);
function categorize(rel, ext) {
  const lower = rel.toLowerCase();
  const base = basename22(lower);
  const segments = lower.split("/");
  const inDir = (names) => names.some((n) => segments.includes(n));
  if (inDir(I18N_DIRS) && I18N_EXTS.has(ext)) return "i18n";
  if (ext === ".prisma" || ext === ".sql" || ext === ".graphql" || ext === ".gql" || base.startsWith("schema.") || base === "models.py" || inDir(SCHEMA_DIRS)) {
    return "schema";
  }
  if (lower.includes(".test.") || lower.includes(".spec.") || inDir(TEST_DIRS)) return "test";
  if (CONFIG_BASES.has(base) || base.endsWith(".config.js") || base.endsWith(".config.ts") || base.endsWith(".config.mjs") || base.startsWith(".eslintrc") || base.startsWith(".prettierrc") || base.startsWith(".env") || base.startsWith("docker-compose")) {
    return "config";
  }
  if (DOC_EXTS.has(ext)) return "doc";
  if (STYLE_EXTS.has(ext)) return "style";
  if (CODE_EXTS.has(ext)) return "code";
  if (ASSET_EXTS.has(ext)) return "asset";
  if (DATA_EXTS.has(ext)) return "data";
  return "other";
}
init_registry();
init_code();
init_markdown();
init_loader();
init_extract();
init_resolve();
init_modules();
init_graph();
init_calls();
init_callers();
init_query();
init_edit();
init_memory();
init_workspaces();
init_centrality();
init_community();
init_tests_map();
init_surprise();
init_symbols_json();
init_graph_json();
init_types();
init_walk();
init_sort();
var utf8 = new TextEncoder();
function pushVarint(out2, n) {
  if (n < 0) throw new Error(`pushVarint: negative input ${n} is not a valid unsigned varint`);
  while (n > 127) {
    out2.push(n & 127 | 128);
    n = Math.floor(n / 128);
  }
  out2.push(n & 127);
}
function pushTag(out2, field, wire) {
  pushVarint(out2, field * 8 + wire);
}
function pushVarintField(out2, field, n) {
  pushTag(out2, field, 0);
  pushVarint(out2, n);
}
function pushLenDelim(out2, field, payload) {
  pushTag(out2, field, 2);
  pushVarint(out2, payload.length);
  for (let i2 = 0; i2 < payload.length; i2++) out2.push(payload[i2]);
}
function pushString(out2, field, s) {
  pushLenDelim(out2, field, utf8.encode(s));
}
function pushPackedInt32(out2, field, values) {
  const payload = [];
  for (const v of values) pushVarint(payload, v);
  pushLenDelim(out2, field, payload);
}
var F_INDEX_METADATA = 1;
var F_INDEX_DOCUMENTS = 2;
var F_META_TOOL_INFO = 2;
var F_META_PROJECT_ROOT = 3;
var F_META_TEXT_ENCODING = 4;
var F_TOOL_NAME = 1;
var F_TOOL_VERSION = 2;
var F_DOC_RELPATH = 1;
var F_DOC_OCCURRENCES = 2;
var F_DOC_SYMBOLS = 3;
var F_DOC_LANGUAGE = 4;
var F_DOC_POSITION_ENCODING = 6;
var F_OCC_RANGE = 1;
var F_OCC_SYMBOL = 2;
var F_OCC_ROLES = 3;
var F_SI_SYMBOL = 1;
var F_SI_KIND = 5;
var F_SI_DISPLAY_NAME = 6;
var F_SI_ENCLOSING = 8;
var TEXT_ENCODING_UTF8 = 1;
var ROLE_DEFINITION = 1;
var POSITION_ENCODING_UTF16 = 2;
var KIND = {
  function: 17,
  // Function
  method: 26,
  // Method
  class: 7,
  // Class
  interface: 21,
  // Interface
  enum: 11,
  // Enum
  struct: 49,
  // Struct
  trait: 53,
  // Trait
  type: 54,
  // Type
  const: 8,
  // Constant
  var: 61
  // Variable
};
var SYMBOL_PREFIX = "codeindex . . . ";
var SIMPLE_ID = /^[A-Za-z0-9_+\-$]+$/;
function escapeId(name2) {
  return SIMPLE_ID.test(name2) ? name2 : "`" + name2.replace(/`/g, "``") + "`";
}
function fileNamespace(rel) {
  return "`" + rel.replace(/`/g, "``") + "`/";
}
function parentDescriptor(parent) {
  return escapeId(parent) + "#";
}
var TYPE_KINDS = /* @__PURE__ */ new Set(["class", "interface", "enum", "struct", "trait", "type"]);
var METHOD_KINDS = /* @__PURE__ */ new Set(["function", "method", "def"]);
function suffixFor(kind) {
  if (TYPE_KINDS.has(kind)) return "#";
  if (METHOD_KINDS.has(kind)) return "().";
  return ".";
}
function baseSymbol(rel, sym) {
  let s = SYMBOL_PREFIX + fileNamespace(rel);
  if (sym.parent) s += parentDescriptor(sym.parent);
  return s + escapeId(sym.name) + suffixFor(sym.kind);
}
function enclosingSymbolOf(rel, parent) {
  return SYMBOL_PREFIX + fileNamespace(rel) + parentDescriptor(parent);
}
function makeUnique(base, line, used) {
  if (!used.has(base)) {
    used.add(base);
    return base;
  }
  for (let n = 0; ; n++) {
    const disambiguator = n === 0 ? String(line) : `${line}_${n}`;
    const cand = `${base}(${disambiguator})`;
    if (!used.has(cand)) {
      used.add(cand);
      return cand;
    }
  }
}
function familyOf2(lang) {
  if (lang === "typescript" || lang === "javascript") return "js";
  if (lang === "c" || lang === "cpp") return "c";
  return lang;
}
var REFERENCE_KINDS5 = /* @__PURE__ */ new Set(["reexport", "reexport-all", "default"]);
function isIdentByte(code) {
  return code >= 48 && code <= 57 || // 0-9
  code >= 65 && code <= 90 || // A-Z
  code >= 97 && code <= 122 || // a-z
  code === 95 || // _
  code === 36;
}
function findWord(line, name2) {
  if (!name2) return null;
  const wordy = /^[A-Za-z_$][\w$]*$/.test(name2);
  let from = 0;
  for (; ; ) {
    const idx = line.indexOf(name2, from);
    if (idx < 0) return null;
    if (!wordy) return [idx, idx + name2.length];
    const before = idx > 0 ? line.charCodeAt(idx - 1) : -1;
    const afterIdx = idx + name2.length;
    const after = afterIdx < line.length ? line.charCodeAt(afterIdx) : -1;
    if (!isIdentByte(before) && !isIdentByte(after)) return [idx, idx + name2.length];
    from = idx + 1;
  }
}
function renderScip(scan2, opts = {}) {
  const projectRoot = opts.projectRoot ?? "file://" + scan2.root.replace(/\\/g, "/");
  const toolVersion = opts.toolVersion ?? ENGINE_VERSION;
  const docs = scan2.files.filter((f) => f.kind === "code" && f.symbols.length > 0);
  const docDefs = /* @__PURE__ */ new Map();
  const defByName = /* @__PURE__ */ new Map();
  for (const f of docs) {
    const used = /* @__PURE__ */ new Set();
    const entries = [];
    for (const sym of f.symbols) {
      const symbolString = makeUnique(baseSymbol(f.rel, sym), sym.line, used);
      entries.push({ sym, symbolString });
      if (sym.exported && !REFERENCE_KINDS5.has(sym.kind)) {
        let arr = defByName.get(sym.name);
        if (!arr) defByName.set(sym.name, arr = []);
        arr.push({ symbolString, family: familyOf2(sym.lang) });
      }
    }
    docDefs.set(f.rel, entries);
  }
  const resolveRef = (name2, callerFamily) => {
    const cands = defByName.get(name2);
    if (!cands || cands.length !== 1) return void 0;
    const only = cands[0];
    return only.family === callerFamily ? only.symbolString : void 0;
  };
  const documents = [];
  for (const f of docs) {
    const text = readText2(join9(scan2.root, f.rel));
    const lines = text.split("\n").map((l) => l.endsWith("\r") ? l.slice(0, -1) : l);
    const locate = (lineNo, name2) => {
      const line = lines[lineNo - 1];
      if (line === void 0) return [lineNo - 1, 0, 0];
      const r = findWord(line, name2);
      return r ? [lineNo - 1, r[0], r[1]] : [lineNo - 1, 0, line.length];
    };
    const entries = docDefs.get(f.rel);
    const occs = [];
    for (const { sym, symbolString } of entries) {
      occs.push({ range: locate(sym.line, sym.name), symbol: symbolString, roles: ROLE_DEFINITION });
    }
    const callerFamily = familyOf2(f.lang);
    for (const c2 of f.calls ?? []) {
      const target = resolveRef(c2.name, callerFamily);
      if (!target) continue;
      occs.push({ range: locate(c2.line, c2.name), symbol: target, roles: 0 });
    }
    occs.sort(
      (a, b) => a.range[0] - b.range[0] || a.range[1] - b.range[1] || a.range[2] - b.range[2] || a.roles - b.roles || byStr(a.symbol, b.symbol)
    );
    const seenOcc = /* @__PURE__ */ new Set();
    const infos = entries.map(({ sym, symbolString }) => ({
      symbol: symbolString,
      displayName: sym.name,
      kind: KIND[sym.kind],
      enclosing: sym.parent ? enclosingSymbolOf(f.rel, sym.parent) : void 0
    })).sort((a, b) => byStr(a.symbol, b.symbol));
    const doc = [];
    pushString(doc, F_DOC_RELPATH, f.rel);
    for (const o of occs) {
      const key2 = `${o.range.join(",")} ${o.roles} ${o.symbol}`;
      if (seenOcc.has(key2)) continue;
      seenOcc.add(key2);
      const ob = [];
      pushPackedInt32(ob, F_OCC_RANGE, o.range);
      pushString(ob, F_OCC_SYMBOL, o.symbol);
      if (o.roles !== 0) pushVarintField(ob, F_OCC_ROLES, o.roles);
      pushLenDelim(doc, F_DOC_OCCURRENCES, ob);
    }
    for (const si of infos) {
      const sb = [];
      pushString(sb, F_SI_SYMBOL, si.symbol);
      if (si.kind !== void 0) pushVarintField(sb, F_SI_KIND, si.kind);
      pushString(sb, F_SI_DISPLAY_NAME, si.displayName);
      if (si.enclosing) pushString(sb, F_SI_ENCLOSING, si.enclosing);
      pushLenDelim(doc, F_DOC_SYMBOLS, sb);
    }
    pushString(doc, F_DOC_LANGUAGE, f.lang);
    pushVarintField(doc, F_DOC_POSITION_ENCODING, POSITION_ENCODING_UTF16);
    documents.push(doc);
  }
  const toolInfo = [];
  pushString(toolInfo, F_TOOL_NAME, "codeindex");
  pushString(toolInfo, F_TOOL_VERSION, toolVersion);
  const metadata2 = [];
  pushLenDelim(metadata2, F_META_TOOL_INFO, toolInfo);
  pushString(metadata2, F_META_PROJECT_ROOT, projectRoot);
  pushVarintField(metadata2, F_META_TEXT_ENCODING, TEXT_ENCODING_UTF8);
  const index = [];
  pushLenDelim(index, F_INDEX_METADATA, metadata2);
  for (const d of documents) pushLenDelim(index, F_INDEX_DOCUMENTS, d);
  return Uint8Array.from(index);
}
init_pipeline();
init_git();
init_grep();
init_bm25();
init_model();
init_encode();
init_embed();
init_search();
function resolveEmbedEndpoint(opts = {}) {
  const url = opts.url ?? process.env.CODEINDEX_EMBED_ENDPOINT;
  return url && url.trim() ? url.trim() : void 0;
}
async function embedViaEndpoint(texts, opts = {}) {
  const url = resolveEmbedEndpoint(opts);
  if (!url) throw new Error("no embedding endpoint configured (set CODEINDEX_EMBED_ENDPOINT or pass opts.url)");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 3e4);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", ...opts.headers ?? {} },
      body: JSON.stringify({ texts }),
      signal: controller.signal
    });
    if (!res.ok) throw new Error(`embedding endpoint ${url} returned HTTP ${res.status}`);
    const data = await res.json();
    const vectors = data.vectors;
    if (!Array.isArray(vectors) || !vectors.every((v) => Array.isArray(v) && v.every((x) => typeof x === "number"))) {
      throw new Error(`embedding endpoint ${url} returned a malformed { vectors } payload`);
    }
    return vectors;
  } finally {
    clearTimeout(timer);
  }
}
init_rules();
init_coupling();
init_repomap();
init_deadcode();
init_complexity();
init_viz();
init_mcp();
init_hash();
init_sort();
init_util();
init_types();
init_types();
init_loader();
init_pipeline();
init_graph_json();
init_symbols_json();
init_scan();
init_callers();
init_workspaces();
init_git();
init_grep();
init_coupling();
init_repomap();
init_deadcode();
init_complexity();
init_viz();
init_bm25();
init_rules();
init_model();
init_embed();
init_search();
var HELP = `codeindex engine v${ENGINE_VERSION} \u2014 deterministic repo indexing

Usage: engine.mjs <command> [flags]

Commands:
  index       Build graph.json + symbols.json (+ incremental cache.json) into
              --out <dir> in ONE pass \u2014 the fast path for repeated runs
  scan        Scan summary: file count, language histogram, capped flag
  graph       Full link-graph (graph.json bytes) to stdout or --out
  symbols     Symbol index (symbols.json bytes) to stdout or --out
  scip        SCIP code-intelligence index (protobuf bytes) into --out
              (default index.scip; --out - writes to stdout)
  callers     Per-symbol caller index (JSON)
  workspaces  Monorepo packages + dependency graph (JSON)
  churn       Per-file git commit counts (JSON; --since <ref> to bound)
  grep        Search: cli.mjs grep <pattern> --repo <dir> (JSON hits)
  search      Keyless BM25 lexical search over symbol names, path segments,
              markdown headings and summaries: cli.mjs search "<query>" --repo <dir>.
              --semantic fuses in the deterministic static-embedding tier (RRF)
              when a model is present; degrades to lexical (exit 0) when absent
  embed       Deterministic static-embedding tier (opt-in by model asset):
                embed status   Report the resolved model + EMBED_VERSION (JSON)
                embed build    Write embeddings.bin into --out <dir> from the repo
                embed pull     Fetch the model asset into CODEINDEX_EMBED_DIR (or
                               <repo>/.codeindex/models/) \u2014 needs CODEINDEX_EMBED_URL
  rules       Architecture rules (forbidden edges, cycles, orphans) validated
              against the link-graph: --config <codeindex.rules.json>; exits 1
              on any error-severity violation (a CI gate)
  repomap     Token-budgeted map of the highest-PageRank files (--budget-tokens)
  hotspots    Churn \xD7 size ranking of the files where work concentrates (JSON)
  coupling    Change coupling: files that change together (JSON; --since <ref>)
  mcp         Run as an MCP server over stdio (tools: scan_summary, graph,
              symbols, callers, workspaces, churn, grep)
  version     Print the engine version

Flags:
  --repo <dir>        Repo root (default: cwd)
  --out <file>        Write output to a file instead of stdout (\`scip\`: --out -
                      writes the binary index to stdout)
  --project-root <uri> \`scip\`: override Metadata.project_root (default
                      file://<repo>); pin it for a byte-reproducible index
  --include <glob>    Only include matching paths (repeatable)
  --exclude <glob>    Exclude matching paths (repeatable)
  --scope <dir>       Restrict to one directory (sugar for --include '<dir>/**')
  --no-gitignore      Do not honor .gitignore files (default: honored)
  --max-files <n>     Cap walked files (default 20000)
  --max-bytes <n>     Skip files above this size (default 1 MiB)
  --no-ast            Skip tree-sitter grammars even when present (regex tier)
  --config <file>     Rules config for \`rules\` (JSON: [{name, from, to, \u2026}])
  --limit <n>         Max results for \`search\` (default 20)
  --no-fuzzy          \`search\`: disable trigram fuzzy fallback for query terms
                      with zero document frequency (default: enabled)
  --semantic          \`search\`: RRF-fuse the deterministic static-embedding tier
                      with lexical (needs a model asset; lexical-only otherwise)
  --recall            \`callers\`: recall-oriented binding (issue #7) \u2014 relaxes
                      the JS/TS import gate to unique repo-wide names and labels
                      each site corroborated|unique-name
`;
function parseFlags(args2) {
  const flags2 = { repo: process.cwd(), include: [], exclude: [], gitignore: true, noAst: false, fuzzy: true, semantic: false };
  for (let i2 = 0; i2 < args2.length; i2++) {
    const a = args2[i2];
    const next = () => {
      const v = args2[++i2];
      if (v === void 0) throw new Error(`missing value for ${a}`);
      return v;
    };
    const num2 = () => {
      const raw = next();
      const n = Number(raw);
      if (!Number.isFinite(n) || n <= 0) throw new Error(`${a} expects a positive number, got "${raw}"`);
      return n;
    };
    if (a === "--repo") flags2.repo = resolve2(next());
    else if (a === "--out") {
      const v = next();
      flags2.out = v === "-" ? "-" : resolve2(v);
    } else if (a === "--project-root") flags2.projectRoot = next();
    else if (a === "--include") flags2.include.push(next());
    else if (a === "--exclude") flags2.exclude.push(next());
    else if (a === "--scope") flags2.scope = next();
    else if (a === "--no-gitignore") flags2.gitignore = false;
    else if (a === "--max-files") flags2.maxFiles = num2();
    else if (a === "--max-bytes") flags2.maxBytes = num2();
    else if (a === "--ignore-case") flags2.ignoreCase = true;
    else if (a === "--max-hits") flags2.maxHits = num2();
    else if (a === "--budget-tokens") flags2.budgetTokens = num2();
    else if (a === "--no-ast") flags2.noAst = true;
    else if (a === "--since") flags2.since = next();
    else if (a === "--config") flags2.config = resolve2(next());
    else if (a === "--limit") flags2.limit = num2();
    else if (a === "--no-fuzzy") flags2.fuzzy = false;
    else if (a === "--semantic") flags2.semantic = true;
    else if (a === "--recall") flags2.recall = true;
    else if (!a.startsWith("--") && flags2.positional === void 0) flags2.positional = a;
    else throw new Error(`unknown flag: ${a}`);
  }
  return flags2;
}
function emit(content, out2) {
  if (out2) writeFileSync3(out2, content);
  else process.stdout.write(content);
}
function scanOptions(flags2) {
  return {
    include: flags2.include.length ? flags2.include : void 0,
    exclude: flags2.exclude.length ? flags2.exclude : void 0,
    scope: flags2.scope,
    gitignore: flags2.gitignore,
    maxFiles: flags2.maxFiles,
    maxBytes: flags2.maxBytes
  };
}
async function runCli(argv) {
  const [cmd, ...rest] = argv;
  if (!cmd || cmd === "help" || cmd === "--help" || cmd === "-h") {
    process.stdout.write(HELP);
    return;
  }
  if (cmd === "version" || cmd === "--version") {
    process.stdout.write(ENGINE_VERSION + "\n");
    return;
  }
  if (cmd === "mcp") {
    const { runMcpServer: runMcpServer2 } = await Promise.resolve().then(() => (init_mcp(), mcp_exports));
    await runMcpServer2();
    return;
  }
  const flags2 = parseFlags(rest);
  if (!existsSync4(flags2.repo)) throw new Error(`--repo path does not exist: ${flags2.repo}`);
  if (!flags2.noAst) await ensureGrammars(allGrammarKeys());
  if (cmd === "index") {
    if (!flags2.out) throw new Error("index needs --out <dir>");
    const outDir = flags2.out;
    mkdirSync22(outDir, { recursive: true });
    const cachePath = join12(outDir, "cache.json");
    let cache;
    try {
      const parsed = JSON.parse(readFileSync6(cachePath, "utf8"));
      if (parsed.schemaVersion === SCHEMA_VERSION && parsed.extractorVersion === EXTRACTOR_VERSION) {
        cache = new Map(Object.entries(parsed.files));
      }
    } catch {
    }
    const { scan: scan2, graph, symbols } = buildIndexArtifacts(flags2.repo, { ...scanOptions(flags2), cache, out: outDir });
    writeFileSync3(join12(outDir, "graph.json"), renderGraphJson(graph));
    writeFileSync3(join12(outDir, "symbols.json"), renderSymbolsJson(symbols));
    const files = {};
    for (const f of scan2.files) {
      const entry = { hash: f.hash, record: f, size: f.size };
      const mtime = scan2.mtimes.get(f.rel);
      if (mtime !== void 0) entry.mtimeMs = mtime;
      files[f.rel] = entry;
    }
    writeFileSync3(
      cachePath,
      JSON.stringify({ schemaVersion: SCHEMA_VERSION, extractorVersion: EXTRACTOR_VERSION, files }) + "\n"
    );
    let embedNote = "";
    const modelDir = resolveEmbedModelDir(flags2.repo);
    const model = modelDir ? loadEmbedModel(modelDir) : void 0;
    if (model) {
      const index = buildEmbeddingIndex(scan2, model);
      writeFileSync3(join12(outDir, "embeddings.bin"), serializeEmbeddings(index));
      embedNote = ` + embeddings.bin (${index.records.length} records, model ${model.modelId})`;
    }
    process.stderr.write(`codeindex: ${scan2.files.length} files \u2192 ${outDir}/graph.json + symbols.json${embedNote}${scan2.capped ? " (capped)" : ""}
`);
  } else if (cmd === "scan") {
    const { scan: scan2 } = buildIndexArtifacts(flags2.repo, scanOptions(flags2));
    const summary = {
      engineVersion: ENGINE_VERSION,
      commit: scan2.commit,
      fileCount: scan2.files.length,
      languages: scan2.languages,
      capped: scan2.capped
    };
    emit(JSON.stringify(summary, null, 2) + "\n", flags2.out);
  } else if (cmd === "graph") {
    const { graph } = buildIndexArtifacts(flags2.repo, scanOptions(flags2));
    emit(renderGraphJson(graph), flags2.out);
  } else if (cmd === "symbols") {
    const { symbols } = buildIndexArtifacts(flags2.repo, scanOptions(flags2));
    emit(renderSymbolsJson(symbols), flags2.out);
  } else if (cmd === "scip") {
    const scan2 = scanRepo(flags2.repo, scanOptions(flags2));
    const bytes = renderScip(scan2, { projectRoot: flags2.projectRoot });
    const out2 = flags2.out ?? resolve2("index.scip");
    if (out2 === "-") process.stdout.write(Buffer.from(bytes));
    else {
      writeFileSync3(out2, bytes);
      process.stderr.write(`codeindex: SCIP index \u2192 ${out2} (${bytes.length} bytes)
`);
    }
  } else if (cmd === "callers") {
    const scan2 = scanRepo(flags2.repo, scanOptions(flags2));
    const index = buildCallerIndex(scan2, void 0, { recall: flags2.recall });
    const obj = {};
    for (const [name2, entry] of index) obj[name2] = entry;
    emit(JSON.stringify(obj, null, 2) + "\n", flags2.out);
  } else if (cmd === "search") {
    if (!flags2.positional) throw new Error('search needs a query: cli.mjs search "<query>" --repo <dir>');
    const scan2 = scanRepo(flags2.repo, scanOptions(flags2));
    if (flags2.semantic) {
      const modelDir = resolveEmbedModelDir(flags2.repo);
      const model = modelDir ? loadEmbedModel(modelDir) : void 0;
      if (!model) {
        process.stderr.write(
          "codeindex: semantic search unavailable (no embedding model present) \u2014 returning lexical results; run `codeindex embed pull` to enable it\n"
        );
        const results = searchIndex(scan2, flags2.positional, { limit: flags2.limit, fuzzy: flags2.fuzzy });
        emit(JSON.stringify(results, null, 2) + "\n", flags2.out);
      } else {
        const index = buildEmbeddingIndex(scan2, model);
        const results = searchSemantic(scan2, flags2.positional, index, { model, limit: flags2.limit, fuzzy: flags2.fuzzy });
        emit(JSON.stringify(results, null, 2) + "\n", flags2.out);
      }
    } else {
      const results = searchIndex(scan2, flags2.positional, { limit: flags2.limit, fuzzy: flags2.fuzzy });
      emit(JSON.stringify(results, null, 2) + "\n", flags2.out);
    }
  } else if (cmd === "embed") {
    const sub = flags2.positional;
    const modelDir = resolveEmbedModelDir(flags2.repo);
    if (sub === "status") {
      const model = modelDir ? loadEmbedModel(modelDir) : void 0;
      const status = {
        embedVersion: EMBED_VERSION,
        model: model ? { present: true, dir: modelDir, modelId: model.modelId, dim: model.dim, vocabSize: model.vocabSize } : { present: false },
        endpoint: process.env.CODEINDEX_EMBED_ENDPOINT ?? null
      };
      emit(JSON.stringify(status, null, 2) + "\n", flags2.out);
    } else if (sub === "build") {
      if (!flags2.out) throw new Error("embed build needs --out <dir>");
      if (!modelDir) {
        process.stderr.write("codeindex: no embedding model present \u2014 run `codeindex embed pull` first (nothing written)\n");
        process.exitCode = 1;
        return;
      }
      const model = loadEmbedModel(modelDir);
      mkdirSync22(flags2.out, { recursive: true });
      const scan2 = scanRepo(flags2.repo, scanOptions(flags2));
      const index = buildEmbeddingIndex(scan2, model);
      writeFileSync3(join12(flags2.out, "embeddings.bin"), serializeEmbeddings(index));
      process.stderr.write(`codeindex: ${index.records.length} embedding records \u2192 ${flags2.out}/embeddings.bin (model ${model.modelId})
`);
    } else if (sub === "pull") {
      const url = resolveEmbedPullUrl();
      if (!url) {
        process.stderr.write(
          "codeindex: no model URL configured. The official static-embedding asset is not published yet.\nSet CODEINDEX_EMBED_URL to a model.json URL (optionally CODEINDEX_EMBED_DIR as the destination), then re-run `codeindex embed pull`.\n"
        );
        process.exitCode = 1;
        return;
      }
      const destDir = process.env.CODEINDEX_EMBED_DIR ?? join12(flags2.repo, ".codeindex", "models");
      mkdirSync22(destDir, { recursive: true });
      process.stderr.write(`codeindex: fetching model from ${url} \u2192 ${join12(destDir, "model.json")}
`);
      const res = await fetch(url);
      if (!res.ok) {
        process.stderr.write(`codeindex: pull failed \u2014 HTTP ${res.status} from ${url}
`);
        process.exitCode = 1;
        return;
      }
      const body2 = await res.text();
      try {
        JSON.parse(body2);
      } catch {
        process.stderr.write("codeindex: pull failed \u2014 response is not a valid model.json (expected JSON)\n");
        process.exitCode = 1;
        return;
      }
      writeFileSync3(join12(destDir, "model.json"), body2);
      process.stderr.write(`codeindex: model written to ${join12(destDir, "model.json")}
`);
    } else {
      throw new Error("embed needs a subcommand: pull | build | status");
    }
  } else if (cmd === "rules") {
    if (!flags2.config) throw new Error("rules needs --config <codeindex.rules.json>");
    const rules = parseRules(JSON.parse(readFileSync6(flags2.config, "utf8")));
    const { graph } = buildIndexArtifacts(flags2.repo, scanOptions(flags2));
    const violations = checkRules(graph, rules);
    const errors = violations.filter((v) => v.severity === "error").length;
    emit(JSON.stringify({ errors, warnings: violations.length - errors, violations }, null, 2) + "\n", flags2.out);
    if (errors > 0) process.exitCode = 1;
  } else if (cmd === "workspaces") {
    const info2 = detectWorkspaces(flags2.repo);
    emit(
      JSON.stringify(
        { packages: info2.packages, cycle: info2.cycle ?? null, topoOrder: info2.topoOrder },
        null,
        2
      ) + "\n",
      flags2.out
    );
  } else if (cmd === "churn") {
    const { churn, ok } = gitChurn(flags2.repo, { since: flags2.since });
    const sorted = {};
    for (const k of [...churn.keys()].sort()) sorted[k] = churn.get(k);
    emit(JSON.stringify({ ok, churn: sorted }, null, 2) + "\n", flags2.out);
  } else if (cmd === "repomap") {
    const { scan: scan2, graph } = buildIndexArtifacts(flags2.repo, scanOptions(flags2));
    emit(renderRepoMap(scan2, graph, { budgetTokens: flags2.budgetTokens }), flags2.out);
  } else if (cmd === "hotspots") {
    const scan2 = scanRepo(flags2.repo, scanOptions(flags2));
    const { churn, ok } = gitChurn(flags2.repo, { since: flags2.since });
    emit(JSON.stringify({ churnOk: ok, hotspots: rankHotspots(scan2, churn) }, null, 2) + "\n", flags2.out);
  } else if (cmd === "coupling") {
    const { ok, couplings } = changeCoupling(flags2.repo, { since: flags2.since });
    emit(JSON.stringify({ ok, couplings }, null, 2) + "\n", flags2.out);
  } else if (cmd === "deadcode") {
    emit(JSON.stringify(findDeadCode(scanRepo(flags2.repo, scanOptions(flags2))), null, 2) + "\n", flags2.out);
  } else if (cmd === "complexity") {
    const scan2 = scanRepo(flags2.repo, scanOptions(flags2));
    emit(JSON.stringify(symbolComplexity(scan2, flags2.positional), null, 2) + "\n", flags2.out);
  } else if (cmd === "risk") {
    const scan2 = scanRepo(flags2.repo, scanOptions(flags2));
    const { churn, ok } = gitChurn(flags2.repo, { since: flags2.since });
    emit(JSON.stringify({ churnOk: ok, risks: riskHotspots(scan2, churn) }, null, 2) + "\n", flags2.out);
  } else if (cmd === "mermaid") {
    const { graph } = buildIndexArtifacts(flags2.repo, scanOptions(flags2));
    emit(renderMermaid(graph, { module: flags2.positional }), flags2.out);
  } else if (cmd === "grep") {
    if (!flags2.positional) throw new Error("grep needs a pattern: cli.mjs grep <pattern> --repo <dir>");
    const globs = [...flags2.include, ...flags2.exclude.map((g) => `!${g}`)];
    const hits = grepRepo(flags2.repo, flags2.positional, {
      globs: globs.length ? globs : void 0,
      ignoreCase: flags2.ignoreCase,
      maxHits: flags2.maxHits
    });
    emit(JSON.stringify(hits, null, 2) + "\n", flags2.out);
  } else {
    process.stderr.write(`unknown command: ${cmd}

${HELP}`);
    process.exitCode = 2;
  }
}

// src/analyze.ts
var CODE_EXT = /* @__PURE__ */ new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".py", ".go", ".rb", ".php", ".java", ".rs", ".vue", ".svelte"]);
var TEST_RE = /(\.test\.|\.spec\.|_test\.|(^|\/)test_|(^|\/)tests?\/)/;
var LARGE_LOC = 300;
var DEEP_NEST = 7;
function locOf(content) {
  if (!content) return 0;
  const body2 = content.endsWith("\n") ? content.slice(0, -1) : content;
  return body2.split("\n").length;
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
function walkFiles(root) {
  const scan2 = scanRepo(root);
  const ctx = buildResolveContext(scan2);
  const out2 = [];
  for (const rec of scan2.files) {
    if (!CODE_EXT.has(rec.ext)) continue;
    const content = readText2(join13(root, rec.rel));
    const resolved = [];
    for (const ref of rec.refs) {
      if (ref.kind !== "import") continue;
      const r = resolveImport(rec.rel, rec.ext, ref.spec, ctx);
      if (r.kind === "resolved" && r.target !== rec.rel) resolved.push(r.target);
    }
    out2.push({
      rel: rec.rel,
      ext: rec.ext,
      loc: locOf(content),
      isTest: TEST_RE.test(rec.rel),
      resolved,
      todos: (content.match(/\b(TODO|FIXME|HACK|XXX)\b/g) ?? []).length,
      maxIndent: maxIndentOf(content)
    });
  }
  return out2;
}
function findCycles(adj) {
  const cycles = [];
  const color = /* @__PURE__ */ new Map();
  const stack = [];
  const dfs = (u) => {
    color.set(u, 1);
    stack.push(u);
    for (const v of adj.get(u) ?? []) {
      const c2 = color.get(v) ?? 0;
      if (c2 === 0) dfs(v);
      else if (c2 === 1) {
        const i2 = stack.indexOf(v);
        if (i2 >= 0) cycles.push(stack.slice(i2));
      }
    }
    stack.pop();
    color.set(u, 2);
  };
  for (const u of adj.keys()) if ((color.get(u) ?? 0) === 0) dfs(u);
  return cycles;
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
function importReachedByTests(files, adj) {
  const reached = /* @__PURE__ */ new Set();
  const stack = files.filter((f) => f.isTest).map((f) => f.rel);
  const seen = new Set(stack);
  while (stack.length) {
    const cur = stack.pop();
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
function hasTest(f, testSubjects, testedByImport) {
  const base = (f.rel.split("/").pop() ?? "").replace(/\.[^.]+$/, "");
  return !!base && testSubjects.has(base) || testedByImport.has(f.rel);
}
function isGenerated(f, relSet) {
  if (!/\.(js|mjs|cjs)$/.test(f.rel) || f.loc < 400) return false;
  return !f.resolved.some((to) => relSet.has(to));
}
function changedFiles(targetAbs, since) {
  return changedSince(targetAbs, since);
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
    for (const to of f.resolved) {
      if (relSet.has(to) && to !== f.rel) {
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
  const testedByImport = importReachedByTests(files, adj);
  const untested = src.filter((f) => !hasTest(f, testSubjects, testedByImport)).map((f) => f.rel).slice(0, 20);
  if (testFiles > 0 && src.some((f) => !hasTest(f, testSubjects, testedByImport)) && !src.some((f) => testedByImport.has(f.rel)))
    notes.push("test coverage attributed by filename only (no test\u2192source imports resolved) \u2014 the untested list may overstate gaps");
  const languages = {};
  for (const f of files) languages[f.ext] = (languages[f.ext] ?? 0) + 1;
  const docs = ["README.md", "DOCUMENTATION.md", "CONTRIBUTING.md", "docs"].filter((d) => exists(join13(targetAbs, d)));
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
  writeJson(join13(outDir, "analysis.json"), a);
  writeText(join13(outDir, "ANALYSIS.md"), renderAnalysisMd(a));
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

${a.deps.cycles.map((c2) => `- ${c2.join(" \u2192 ")} \u2192 ${c2[0]}`).join("\n")}
` : ""}${a.tests.untested.length ? `## Source files without an obvious test

${a.tests.untested.map((u) => `- \`${u}\``).join("\n")}
` : ""}`;
}

// src/backlog.ts
import { readdirSync as readdirSync4 } from "fs";
import { join as join14, relative as relative2 } from "path";

// src/types.ts
var VERSION = "1.11.0";
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
var PROTOCOL_VERSION = "3";
var RUBRIC_VERSION = "2";
var MEETS_BAR = 80;

// src/backlog.ts
function targetsOf(f) {
  const set = /* @__PURE__ */ new Set();
  for (const e of f.evidence ?? []) {
    const p = parseEvidenceRef(e.ref);
    if (!p.isTargetRef) continue;
    set.add(p.path);
  }
  return [...set];
}
var TEST_PATH_RE = /(\.test\.|\.spec\.|_test\.|(^|\/)test_|(^|\/)tests?\/|(^|\/)__tests__\/)/;
var CONV_SKIP = /* @__PURE__ */ new Set(["node_modules", "dist", "build", "coverage", "out", "vendor", "__pycache__", ".next", ".cache", ".git"]);
function scanTestFiles(targetAbs, limit = 500) {
  const found = [];
  const walk2 = (dir) => {
    if (found.length >= limit) return;
    let entries;
    try {
      entries = readdirSync4(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (found.length >= limit) return;
      const p = join14(dir, e.name);
      if (e.isDirectory()) {
        if (!e.name.startsWith(".") && !CONV_SKIP.has(e.name)) walk2(p);
        continue;
      }
      const rel = relative2(targetAbs, p);
      if (TEST_PATH_RE.test(rel)) found.push(rel);
    }
  };
  walk2(targetAbs);
  return found;
}
function detectTestConvention(targetAbs) {
  const files = scanTestFiles(targetAbs);
  if (!files.length) return { layout: null, suffix: ".test" };
  const spec = files.filter((f) => /\.spec\./.test(f)).length;
  const test = files.filter((f) => /\.test\./.test(f)).length;
  const suffix = spec > test ? ".spec" : ".test";
  const has = (re) => files.some((f) => re.test(f));
  const layout = has(/(^|\/)__tests__\//) ? "__tests__" : has(/^tests\//) ? "tests" : has(/^test\//) ? "test" : "colocated";
  return { layout, suffix };
}
function guessTestFile(targets, f, conv) {
  const src = targets.find((t) => /\.(ts|tsx|js|jsx|mjs|cjs|py|go|rb|java|php|rs)$/.test(t));
  if (!src) return `tests/${slug(f.title)}.test.ts`;
  const dot = src.lastIndexOf(".");
  const ext = src.slice(dot);
  const stem = src.slice(0, dot);
  const dir = src.includes("/") ? src.slice(0, src.lastIndexOf("/")) : "";
  const name2 = stem.split("/").pop() ?? "target";
  if (ext === ".go") return `${stem}_test.go`;
  const inDir = (base2) => dir ? `${dir}/${base2}` : base2;
  if (ext === ".py") {
    if (conv.layout === "colocated") return inDir(`test_${name2}.py`);
    return `${conv.layout && conv.layout !== "__tests__" ? conv.layout : "tests"}/test_${name2}.py`;
  }
  if (ext === ".rs") return `tests/${name2}.rs`;
  const suffix = conv.suffix;
  if (conv.layout === "colocated") return `${stem}${suffix}${ext}`;
  if (conv.layout === "__tests__") return inDir(`__tests__/${name2}${suffix}${ext}`);
  const base = conv.layout ?? "tests";
  return `${base}/${name2}${suffix}${ext}`;
}
function distinctTestPath(rel, disc) {
  if (/\.(test|spec)\./.test(rel)) return rel.replace(/\.(test|spec)\./, `.${disc}.$1.`);
  if (/_test\.[^./]+$/.test(rel)) return rel.replace(/_test\.([^./]+)$/, `.${disc}_test.$1`);
  return rel.replace(/\.([^./]+)$/, `.${disc}.$1`);
}
function freshTestFile(guess, disc, targetAbs) {
  if (!exists(join14(targetAbs, guess))) return guess;
  let candidate = distinctTestPath(guess, disc);
  for (let n = 2; exists(join14(targetAbs, candidate)); n++) candidate = distinctTestPath(guess, `${disc}-${n}`);
  return candidate;
}
function detectVerifyCommand(targetAbs) {
  if (exists(join14(targetAbs, "package.json"))) {
    const pkg = readJson(join14(targetAbs, "package.json"));
    if (pkg.scripts?.test) {
      if (exists(join14(targetAbs, "pnpm-lock.yaml"))) return "pnpm test";
      if (exists(join14(targetAbs, "yarn.lock"))) return "yarn test";
      return "npm test";
    }
  }
  if (exists(join14(targetAbs, "go.mod"))) return "go test ./...";
  if (exists(join14(targetAbs, "Cargo.toml"))) return "cargo test";
  if (exists(join14(targetAbs, "pytest.ini")) || exists(join14(targetAbs, "pyproject.toml"))) return "pytest";
  return null;
}
function buildBacklog(runDir, opts = {}) {
  const cfg = readJson(join14(runDir, "eval.config.json"));
  const findingsPath = join14(runDir, "findings.json");
  if (!exists(findingsPath)) throw new Error("no findings.json \u2014 record findings first (see agents/findings.md), then re-run backlog");
  const doc = readJson(findingsPath);
  const failed2 = /* @__PURE__ */ new Set();
  const vpath = join14(runDir, "VERIFY.json");
  if (exists(vpath)) {
    const v = readJson(vpath);
    for (const id of v.failures ?? []) failed2.add(id);
  }
  const targetAbs = resolveTargetAbs(cfg.targetAbs, cfg.target, runDir);
  const conv = detectTestConvention(targetAbs);
  const verifyCommand = detectVerifyCommand(targetAbs);
  const prio = (f) => f.kind === "opportunity" ? opportunityPriority(f.impact) : f.severity;
  const confirmed = (doc.findings ?? []).filter((f) => f.status !== "dismissed" && !failed2.has(f.id)).sort((a, b) => {
    const pa = SEV_ORDER[prio(a)] ?? 9;
    const pb = SEV_ORDER[prio(b)] ?? 9;
    if (pa !== pb) return pa - pb;
    const va = a.kind === "opportunity" ? opportunityValue(a.impact, a.effort) : 0;
    const vb = b.kind === "opportunity" ? opportunityValue(b.impact, b.effort) : 0;
    return vb - va;
  });
  const tasks = confirmed.map((f, i2) => {
    const targets = targetsOf(f);
    const isOpp = f.kind === "opportunity";
    const id = `FIX-${String(i2 + 1).padStart(3, "0")}`;
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
        expectedNew: !exists(join14(targetAbs, testFile)),
        description: isOpp ? `Write a spec/characterization test that pins the desired behavior: ${f.recommendation || f.statement}` : f.failureScenario ? `Write a failing test that reproduces: ${f.failureScenario}` : `Write a failing test asserting the correct behavior for: ${f.statement}`
      },
      green: {
        change: f.recommendation || (isOpp ? "Implement the improvement so the spec test passes." : "Make the minimal change that turns the RED test green \u2014 without weakening any gate.")
      },
      verify: {
        // Prefer the runner detected from the target's own manifest/lockfile —
        // verify-fix replays this verbatim through a shell, so a hardcoded pnpm
        // string misleads an npm/yarn/bun target. Prose is only a last resort.
        command: verifyCommand ?? (cfg.kind === "skill" ? "pnpm test  # then re-run the target's own check/verify gate" : "run the new test (must pass) + the full suite (nothing regresses)")
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
  const out2 = opts.out ?? runDir;
  const backlog = { target: cfg.targetAbs, generatedFrom: runDir, tasks };
  writeJson(join14(out2, "BACKLOG.json"), backlog);
  writeText(join14(out2, "REMEDIATION.md"), renderRemediation(backlog, cfg));
  if (opts.tdd) {
    const byId = new Map(doc.findings.map((f) => [f.id, f]));
    for (const t of tasks) writeText(join14(out2, "fixes", `${t.id}-${slug(t.title)}.md`), renderFixCard(t, byId.get(t.findingId)));
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
import { join as join15 } from "path";
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
  const cfg = readJson(join15(runDir, "eval.config.json"));
  const analysis = exists(join15(runDir, "analysis.json")) ? readJson(join15(runDir, "analysis.json")) : null;
  writeText(join15(runDir, "BRAINSTORM.todo.md"), renderTodo(cfg, analysis));
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
  const oppsPath = join15(runDir, "opportunities.json");
  if (!exists(oppsPath)) throw new Error("no opportunities.json \u2014 fill the BRAINSTORM.todo.md worklist first");
  const opps = readJson(oppsPath).opportunities ?? [];
  const doc = exists(join15(runDir, "findings.json")) ? readJson(join15(runDir, "findings.json")) : { findings: [] };
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
  writeJson(join15(runDir, "findings.json"), doc);
  return { added, total: doc.findings.length, skipped };
}

// src/check.ts
import { execFileSync as execFileSync3 } from "child_process";
import { join as join19 } from "path";

// src/citations.ts
var TOKEN_RE = /\[([^\]\n]+)\](?!\()/g;
var FINDING_RE = /^F\d+$/;
var MODEL_HINT_RE = /^(M|model-hint)$/i;
function tokensIn(text) {
  const out2 = [];
  for (const m of text.matchAll(TOKEN_RE)) {
    const raw = (m[1] ?? "").trim();
    for (const piece of raw.split(",").map((s) => s.trim()).filter(Boolean)) {
      const isFinding = FINDING_RE.test(piece);
      const isModelHint = MODEL_HINT_RE.test(piece);
      const isEvidence = !isFinding && !isModelHint && (piece.startsWith("run:") || piece.startsWith("url:") || /^[\w./-]+:\d+/.test(piece));
      out2.push({ raw: piece, isFinding, findingId: isFinding ? piece : void 0, isModelHint, isEvidence });
    }
  }
  return out2;
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
  for (let i2 = 0; i2 < lines.length; i2++) {
    const rawLine = lines[i2] ?? "";
    const line = rawLine.trim();
    if (/^(```|~~~)/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    if (line === "" || /^#{1,6}\s/.test(line) || /^([-*_])\1{2,}$/.test(line)) continue;
    let body2 = line;
    if (body2.startsWith(">")) {
      body2 = body2.replace(/^>\s?/, "").trim();
      if (/\[(?:M|model-hint)\]/i.test(body2) || body2.toLowerCase().startsWith("[model-hint]")) continue;
    }
    if (/^\|?[\s:|-]+\|[\s:|-]+$/.test(body2) && body2.includes("-")) continue;
    body2 = body2.replace(/^[-*+]\s+/, "").replace(/^\d+\.\s+/, "");
    if (claimWordCount(body2) < CAPS.minClaimWords) continue;
    units.push({ text: body2, line: i2 + 1 });
  }
  return units;
}
function findingRefs(md) {
  const ids = /* @__PURE__ */ new Set();
  for (const t of tokensIn(md)) if (t.isFinding && t.findingId) ids.add(t.findingId);
  return [...ids];
}

// src/init.ts
import { execFileSync as execFileSync2 } from "child_process";
import { createHash as createHash2 } from "crypto";
import { isAbsolute as isAbsolute2, join as join17, resolve as resolve3 } from "path";

// src/gitignore.ts
import { execFileSync } from "child_process";
import { existsSync as existsSync5, realpathSync as realpathSync2 } from "fs";
import { join as join16, relative as relative3, sep as sep2 } from "path";
function gitRootOf(dir) {
  try {
    const out2 = execFileSync("git", ["-C", dir, "rev-parse", "--show-toplevel"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    return out2 || null;
  } catch {
    return null;
  }
}
var HEADER = "# ultraeval runs";
function ensureGitignored(runDirAbs) {
  const root = gitRootOf(runDirAbs);
  if (!root) return { action: "skipped", reason: "run dir is not inside a git repo" };
  const rel = relative3(realpathSync2(root), realpathSync2(runDirAbs)).split(sep2).join("/");
  if (!rel || rel.startsWith("..")) return { action: "skipped", reason: "run dir is the repo root" };
  const segments = rel.split("/");
  const container = segments.indexOf(".ultraeval");
  const entry = container >= 0 ? `${segments.slice(0, container + 1).join("/")}/` : `${rel}/`;
  if (entry === "evals/") return { action: "skipped", entry, reason: "refusing \u2014 the committed score ledger lives under evals/" };
  const path = join16(root, ".gitignore");
  const existing = existsSync5(path) ? readText(path) : "";
  const bare = entry.replace(/\/$/, "");
  const covered = existing.split(/\r?\n/).map((l) => l.trim()).some((l) => l === entry || l === bare || l === `/${entry}` || l === `/${bare}`);
  if (covered) return { action: "already", path, entry };
  const eol = existing.includes("\r\n") ? "\r\n" : "\n";
  const lines = [];
  if (existing && !existing.endsWith("\n")) lines.push("");
  if (!existing.includes(HEADER)) lines.push(HEADER);
  lines.push(entry);
  try {
    writeText(path, existing + lines.join(eol) + eol);
  } catch (err2) {
    return { action: "skipped", path, entry, reason: `could not write .gitignore: ${err2.message}` };
  }
  return { action: "added", path, entry };
}

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
var BUSINESS_DIMS = [
  {
    id: "business-correctness",
    name: "Business-rule correctness",
    weight: 0.35,
    whatPerfectLooksLike: "every business rule computes the documented outcome on realistic domain inputs; no logic bugs",
    anchors: [iso25010("Functional suitability \u2014 functional correctness")]
  },
  {
    id: "domain-model",
    name: "Domain-model coherence",
    weight: 0.25,
    whatPerfectLooksLike: "entities/terms match the domain language; one concept, one representation; boundaries make sense",
    anchors: [
      iso25010("Functional suitability \u2014 functional appropriateness"),
      informative("Domain-Driven Design (Evans 2003)", "ubiquitous language, bounded contexts")
    ]
  },
  {
    id: "invariants",
    name: "Invariants & consistency",
    weight: 0.15,
    whatPerfectLooksLike: "domain invariants hold on every path; a rule-violating input is rejected with state left consistent",
    anchors: [iso25010("Reliability \u2014 faultlessness"), REQ_29148("verifiable")]
  },
  {
    id: "edge-cases-metier",
    name: "Functional edge cases",
    weight: 0.15,
    whatPerfectLooksLike: "boundary values, empty/overflow cases, and rule interactions are handled, not just the happy path",
    anchors: [iso25010("Functional suitability \u2014 functional completeness")]
  },
  {
    id: "rule-traceability",
    name: "Rule traceability",
    weight: 0.1,
    whatPerfectLooksLike: "each implemented rule traces to a documented business requirement and back",
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
  const key2 = categoryKey(category);
  if (key2 === "security") return SECURITY_DIMS;
  if (key2 === "requirements") return REQUIREMENTS_DIMS;
  if (key2 === "business") return BUSINESS_DIMS;
  if (key2 === "research") return RESEARCH_DIMS;
  const base = kind === "skill" ? SKILL_DIMS : CODEBASE_DIMS;
  if (key2 === "web") return webFlavored(base);
  if (key2 === "cli") return cliFlavored(base);
  return base;
}

// src/init.ts
function normalizeScope(scope) {
  if (!scope) return void 0;
  const clean2 = [];
  for (const raw of scope) {
    const entry = raw.trim();
    if (!entry) continue;
    if (isAbsolute2(entry) || entry.split(/[\\/]/).includes(".."))
      throw new Error(`--scope ${entry}: entries must be target-relative globs (no absolute paths, no ..)`);
    if (!clean2.includes(entry)) clean2.push(entry);
  }
  return clean2.length ? clean2 : void 0;
}
function detectKind(targetAbs) {
  if (exists(join17(targetAbs, "SKILL.md"))) return "skill";
  const skillsDir = join17(targetAbs, "skills");
  if (exists(skillsDir)) {
    for (const md of listMarkdown(skillsDir)) if (md.endsWith("SKILL.md")) return "skill";
  }
  return "codebase";
}
function gitInfo(targetAbs) {
  const git = (args2) => execFileSync2("git", ["-C", targetAbs, ...args2], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
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
var dimensionsHash = (dims) => createHash2("sha256").update(JSON.stringify(dims)).digest("hex").slice(0, 12);
function initRun(opts) {
  const targetAbs = resolve3(process.cwd(), opts.target);
  if (!exists(targetAbs)) throw new Error(`target not found: ${opts.target}`);
  const kind = opts.kind ?? detectKind(targetAbs);
  const category = opts.category ?? (kind === "skill" ? "agent skill" : "software project");
  const mode = opts.mode ?? "audit";
  const dimensions = defaultDimensions(kind, category);
  const scope = normalizeScope(opts.scope);
  const targetGit = gitInfo(targetAbs);
  if (opts.since) {
    try {
      execFileSync2("git", ["-C", targetAbs, "rev-parse", "--verify", `${opts.since}^{commit}`], { stdio: ["ignore", "ignore", "ignore"] });
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
    ...opts.since ? { sinceRef: opts.since } : {},
    ...scope ? { scope } : {},
    ...opts.oneshot ? { profile: "oneshot" } : {}
  };
  const cfg = {
    target: opts.target,
    targetAbs,
    kind,
    category,
    mode,
    dimensions,
    ...scope ? { scope } : {},
    ...opts.oneshot ? { oneshot: true } : {},
    note: "starter dimensions \u2014 the research stage refines them",
    version: VERSION,
    provenance,
    ...opts.bar !== void 0 && Number.isFinite(opts.bar) ? { meetsBar: opts.bar } : {}
  };
  const runDir = resolve3(process.cwd(), opts.out);
  ensureDir(join17(runDir, "runs"));
  ensureDir(join17(runDir, "research"));
  writeJson(join17(runDir, "eval.config.json"), cfg);
  const gitignore = opts.gitignore === false ? void 0 : ensureGitignored(runDir);
  return { cfg, runDir, ...gitignore ? { gitignore } : {} };
}

// src/verify.ts
import { readdirSync as readdirSync5 } from "fs";
import { isAbsolute as isAbsolute3, join as join18, resolve as resolve4 } from "path";
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
  const cfg = readJson(join18(runDir, "eval.config.json"));
  const doc = readJson(join18(runDir, "findings.json"));
  const findings = (doc.findings ?? []).filter((f) => f.status !== "dismissed").sort((a, b) => (SEV_ORDER[a.severity] ?? 9) - (SEV_ORDER[b.severity] ?? 9));
  const pairs = [];
  const resolveOpts = { targetAbs: resolveTargetAbs(cfg.targetAbs, cfg.target, runDir), runDir, lineCache: /* @__PURE__ */ new Map() };
  for (const f of findings) {
    for (const e of f.evidence ?? []) {
      if (pairs.length >= maxVerify) break;
      const r = resolveEvidence(e.ref, resolveOpts);
      if (!r.gradeable) continue;
      const digest = r.resolved && r.absPath ? extractContext(r.absPath, r.lineStart, r.lineEnd, 2, resolveOpts.lineCache) : `(unresolved: ${r.reason})`;
      pairs.push({ claimId: f.id, evidenceRef: e.ref, claim: f.statement, digest, verdict: null, note: "" });
    }
  }
  return { run: runDir, pairs };
}
function runVerify(runDir, opts = {}) {
  const full = buildWorklist(runDir, opts.maxVerify);
  let pairs = full.pairs;
  if (opts.shards && opts.shard !== void 0) pairs = pairs.filter((_, i2) => i2 % opts.shards === opts.shard);
  const sh2 = opts.shards !== void 0 && opts.shard !== void 0;
  let planted;
  if (opts.honeypots && opts.honeypots > 0) {
    const h = plantHoneypots(runDir, pairs, opts.honeypots, opts.shard);
    pairs = h.pairs;
    planted = h.planted;
  }
  const out2 = { run: runDir, pairs };
  writeJson(join18(runDir, sh2 ? `VERIFY.todo.${opts.shard}.json` : "VERIFY.todo.json"), out2);
  writeText(join18(runDir, sh2 ? `VERIFY.${opts.shard}.md` : "VERIFY.md"), renderWorklistMd(out2));
  if (planted !== void 0) out2.planted = planted;
  return out2;
}
function plantHoneypots(runDir, pairs, n, shard) {
  if (pairs.length < 2) return { pairs, planted: 0 };
  const cfg = readJson(join18(runDir, "eval.config.json"));
  const doc = readJson(join18(runDir, "findings.json"));
  const seedHex = cfg.provenance?.dimensionsHash ?? "0";
  const rng = mulberry32((Number.parseInt(seedHex.slice(0, 8), 16) || 1) + (shard ?? 0));
  let maxN = 0;
  for (const f of doc.findings ?? []) {
    const m = /^F(\d+)$/.exec(f.id);
    if (m?.[1]) maxN = Math.max(maxN, Number(m[1]));
  }
  const offset = (shard ?? 0) * n;
  const pathOf = (ref) => parseEvidenceRef(ref).rawPath;
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
    writeJson(join18(runDir, truthName), {
      note: "ground truth for planted honeypot pairs \u2014 never paste this file into a skeptic prompt",
      claimIds: traps.map((t) => t.claimId)
    });
  }
  return { pairs: mixed, planted: traps.length };
}
function loadHoneypotIds(runDir) {
  const ids = /* @__PURE__ */ new Set();
  const files = [join18(runDir, "VERIFY.honeypots.json")];
  if (exists(runDir)) {
    for (const e of readdirSync5(runDir)) if (/^VERIFY\.honeypots\.\d+\.json$/.test(e)) files.push(join18(runDir, e));
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
    const items = Array.isArray(data) ? data : Array.isArray(data.pairs) ? data.pairs : null;
    if (items === null) {
      throw new Error(
        `verdicts file ${p} has no "pairs" array \u2014 pass the filled VERIFY.todo.json shape: {"pairs":[{"claimId":"F1","evidenceRef":"src/app.ts:42","verdict":"supported|partial|refuted|unsupported","note":"\u2026"}]}`
      );
    }
    for (const v of items) merged.set(`${v.claimId}\u241F${v.evidenceRef ?? ""}`, v);
  }
  return [...merged.values()];
}
function applyVerdicts(runDir, spec) {
  const doc = readJson(join18(runDir, "findings.json"));
  const all = loadVerdicts(runDir, spec);
  const trapIds = loadHoneypotIds(runDir);
  const result = reduceVerdicts(
    all.filter((v) => !trapIds.has(v.claimId)),
    doc.findings ?? []
  );
  if (trapIds.size) {
    const graded = all.filter((v) => trapIds.has(v.claimId) && VALID_VERDICTS.includes(v.verdict));
    const failed2 = [...new Set(graded.filter((v) => v.verdict === "supported" || v.verdict === "partial").map((v) => v.claimId))];
    const caught = new Set(graded.filter((v) => v.verdict === "refuted" || v.verdict === "unsupported").map((v) => v.claimId));
    for (const id of failed2) caught.delete(id);
    result.honeypots = { planted: trapIds.size, caught: caught.size, failed: failed2 };
    if (failed2.length) result.ok = false;
  }
  writeJson(join18(runDir, "VERIFY.json"), result);
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

// src/check.ts
var HARD_FILES = ["RESULTS.md"];
var SOFT_FILES = ["SUMMARY.md"];
function checkRun(runDir, opts = {}) {
  const errors = [];
  const warnings = [];
  const cfgPath = join19(runDir, "eval.config.json");
  if (!exists(cfgPath)) {
    errors.push("no eval.config.json \u2014 run `ultraeval init` first");
    return { ok: false, errors, warnings };
  }
  let cfg;
  try {
    cfg = readJson(cfgPath);
  } catch {
    errors.push("eval.config.json is not valid JSON");
    return { ok: false, errors, warnings, usageError: true };
  }
  const findingsPath = join19(runDir, "findings.json");
  if (!exists(findingsPath)) {
    errors.push("no findings.json \u2014 the eval produced no findings record");
    return { ok: false, errors, warnings };
  }
  let doc;
  try {
    doc = readJson(findingsPath);
  } catch {
    errors.push("findings.json is not valid JSON");
    return { ok: false, errors, warnings, usageError: true };
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
  const resolveOpts = { targetAbs: resolveTargetAbs(cfg.targetAbs, cfg.target, runDir), runDir, lineCache: /* @__PURE__ */ new Map() };
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
    const p = join19(runDir, file);
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
  const backlogPath = join19(runDir, "BACKLOG.json");
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
  const verifyPath = join19(runDir, "VERIFY.json");
  if (opts.requireVerify && cfg.oneshot) {
    errors.push(
      `--require-verify: this is a one-shot run \u2014 no verify phase exists; upgrade it (plan --run ${runDir}) and run the verify chain for verified findings`
    );
  } else if (opts.requireVerify) {
    if (!exists(verifyPath)) errors.push("--require-verify: no VERIFY.json \u2014 run `ultraeval verify --apply <verdicts>`");
    else {
      try {
        const v = readJson(verifyPath);
        const reReduced = reduceVerdicts(v.verdicts ?? [], findings);
        if (!v.adjudicated) errors.push("--require-verify: VERIFY.json has no adjudicated verdicts");
        if (v.honeypots?.failed?.length)
          errors.push(
            `--require-verify: ${v.honeypots.failed.length} honeypot(s) graded supported (${v.honeypots.failed.join(", ")}) \u2014 the skeptic rubber-stamped; re-verify with a fresh skeptic`
          );
        const unadjIds = /* @__PURE__ */ new Set([...v.unadjudicated ?? [], ...reReduced.unadjudicated]);
        const pending = [...unadjIds].filter((fid) => {
          const f = findings.find((x) => x.id === fid);
          return f && f.status !== "dismissed";
        });
        if (pending.length) errors.push(`--require-verify: ${pending.length} finding(s) still unadjudicated (${pending.join(", ")}) \u2014 grade every verify pair`);
        let expectedPairs = [];
        try {
          expectedPairs = buildWorklist(runDir).pairs;
        } catch {
          expectedPairs = [];
        }
        const pairKeys = /* @__PURE__ */ new Set();
        const findingLevel = /* @__PURE__ */ new Set();
        for (const vr of v.verdicts ?? []) {
          if (!vr || !VALID_VERDICTS.includes(vr.verdict)) continue;
          if (vr.evidenceRef) pairKeys.add(`${vr.claimId}\u241F${vr.evidenceRef}`);
          else findingLevel.add(vr.claimId);
        }
        const uncovered = expectedPairs.filter((p) => !findingLevel.has(p.claimId) && !pairKeys.has(`${p.claimId}\u241F${p.evidenceRef}`));
        if (uncovered.length) {
          const claims = [...new Set(uncovered.map((p) => p.claimId))];
          errors.push(
            `--require-verify: ${uncovered.length} cited (finding \xD7 evidence) pair(s) have no verdict (${uncovered.slice(0, 6).map((p) => `${p.claimId} @ ${p.evidenceRef}`).join(
              ", "
            )}${uncovered.length > 6 ? ", \u2026" : ""}) \u2014 a per-finding grade cannot stand in for a per-pair one; re-run \`verify\` + \`verify --apply\` so every cited evidence ref is adjudicated (findings: ${claims.join(", ")})`
          );
        }
      } catch {
        errors.push("--require-verify: VERIFY.json is not valid JSON");
      }
    }
  }
  if (opts.semantic) {
    if (!exists(verifyPath)) {
      warnings.push(
        "--semantic: no VERIFY.json \u2014 the verdict/semantic layer was not applied; only file:line grounding was checked (run `ultraeval verify --apply <verdicts>` to adjudicate claims, or --require-verify to gate on it)"
      );
    } else {
      try {
        const v = readJson(verifyPath);
        const reReduced = reduceVerdicts(v.verdicts ?? [], findings);
        const failIds = /* @__PURE__ */ new Set([...v.failures ?? [], ...reReduced.failures]);
        for (const fid of failIds) {
          const f = findings.find((x) => x.id === fid);
          if (f && f.status !== "dismissed")
            errors.push(`--semantic: ${fid} was refuted/unsupported by verification but is still "${f.status}" \u2014 dismiss it or fix the claim`);
        }
        if (!v.verdicts?.length)
          warnings.push(
            "--semantic: VERIFY.json carries no verdict rows \u2014 the trustless re-reduction had nothing to adjudicate; the verdict/semantic layer was not (re)applied to the current findings"
          );
      } catch {
        errors.push("--semantic: VERIFY.json is not valid JSON");
      }
    }
  }
  const sinceRef = cfg.provenance?.sinceRef;
  if (sinceRef) {
    const targetAbs = resolveTargetAbs(cfg.targetAbs, cfg.target, runDir);
    let changed = null;
    try {
      changed = new Set(
        execFileSync3("git", ["-C", targetAbs, "diff", "--name-only", sinceRef], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).split("\n").map((l) => l.trim()).filter(Boolean)
      );
    } catch {
      warnings.push(`diff scope: could not resolve ${sinceRef} in the target \u2014 out-of-scope findings not checked`);
    }
    if (changed) {
      for (const f of findings) {
        if (f.status === "dismissed") continue;
        const files = (f.evidence ?? []).map((e) => parseEvidenceRef(e.ref)).filter((p) => p.isTargetRef).map((p) => p.path);
        if (files.length && !files.some((x) => changed.has(x))) {
          const msg = `${f.id} cites only files unchanged since ${sinceRef} (${files.join(", ")}) \u2014 outside the diff scope of this run`;
          (opts.strictScope ? errors : warnings).push(msg);
        }
      }
    }
  }
  const scope = cfg.scope ?? cfg.provenance?.scope;
  if (scope?.length) {
    for (const f of findings) {
      if (f.status === "dismissed") continue;
      const files = (f.evidence ?? []).map((e) => parseEvidenceRef(e.ref)).filter((p) => p.isTargetRef).map((p) => p.path);
      if (files.length && !files.some((x) => inScope(x, scope))) {
        if (Array.isArray(f.tags) && f.tags.includes("scope-exempt"))
          warnings.push(
            `${f.id} is scope-exempt: cites only files outside the declared scope (${scope.join(", ")}) \u2014 kept as a justified cross-cutting finding`
          );
        else
          errors.push(
            `${f.id} cites only files outside the declared scope (${scope.join(", ")}) \u2014 out of scope for this run; drop it or tag it scope-exempt with a justification`
          );
      }
    }
  }
  for (const f of findings) {
    if (f.status === "dismissed") continue;
    if (f.status === "open") warnings.push(`${f.id} is still "open" \u2014 adjudicate it (confirmed/dismissed) before backlog`);
    if (f.status === "confirmed" && !f.recommendation) warnings.push(`${f.id} is confirmed but has no recommendation \u2014 its backlog card will be vague`);
  }
  if (exists(join19(runDir, "RESULTS.md")) && !exists(join19(runDir, "SUMMARY.md"))) warnings.push("RESULTS.md present but no SUMMARY.md");
  if (exists(join19(runDir, "runs", "budget.md"))) {
    const summaryPath = join19(runDir, "SUMMARY.md");
    if (!exists(summaryPath) || !/budget/i.test(readText(summaryPath)))
      warnings.push("runs/budget.md records coverage cuts but SUMMARY.md does not mention them \u2014 report every cut in the summary");
  }
  if (!cfg.provenance) warnings.push("legacy run (pre-protocol) \u2014 no provenance recorded; re-init to stamp engine/protocol/rubric versions");
  const stampedHash = cfg.provenance?.dimensionsHash;
  if (stampedHash) {
    const currentHash = dimensionsHash(cfg.dimensions ?? []);
    if (currentHash !== stampedHash)
      warnings.push(
        `dimensions changed since init (recorded hash ${stampedHash} \u2192 current ${currentHash}) \u2014 the rubric was refined after init; expected per protocol, recorded here for the audit trail`
      );
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

// src/compare.ts
import { join as join20 } from "path";
function load(dir) {
  const findings = exists(join20(dir, "findings.json")) ? readJson(join20(dir, "findings.json")).findings ?? [] : [];
  const score = exists(join20(dir, "scorecard.json")) ? readJson(join20(dir, "scorecard.json")) : null;
  const cfg = exists(join20(dir, "eval.config.json")) ? readJson(join20(dir, "eval.config.json")) : null;
  return { findings, score, cfg };
}
var key = (f) => `${f.kind ?? "defect"}:${titleKey(f.title)}`;
function targetRefOf(ref) {
  const p = parseEvidenceRef(ref);
  return p.isTargetRef ? p.pathWithLine : null;
}
function fingerprint(f) {
  const refs = [...new Set((f.evidence ?? []).map((e) => targetRefOf(e.ref)).filter((x) => !!x))].sort();
  return refs.length ? `${f.kind ?? "defect"}:${refs.join(",")}` : null;
}
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
    if ((bp.profile ?? "full") !== (cp.profile ?? "full"))
      warnings.push("one-shot vs full-pipeline comparison \u2014 the two runs have different rigor; the delta is indicative only");
    if (JSON.stringify(bp.scope ?? []) !== JSON.stringify(cp.scope ?? []))
      warnings.push(
        `file scopes differ (${(bp.scope ?? []).join(", ") || "unscoped"} \u2192 ${(cp.scope ?? []).join(", ") || "unscoped"}) \u2014 the runs judged different subsets of the target`
      );
  }
  return warnings;
}
function gateFailures(r) {
  const fails = [];
  if (r.warnings.some((w) => w.includes("one-shot vs full-pipeline")))
    fails.push("one-shot vs full-pipeline comparison is not gateable \u2014 rerun both sides at the same rigor");
  if (r.scoreDelta !== null && r.scoreDelta < 0) fails.push(`score dropped by ${-r.scoreDelta}`);
  const p0 = r.introduced.filter((f) => f.kind !== "opportunity" && f.severity === "P0");
  if (p0.length) fails.push(`introduced P0 defect(s): ${p0.map((f) => f.title).join("; ")}`);
  const escalated = r.retitled.filter((p) => p.to.kind !== "opportunity" && p.to.severity === "P0" && p.from.severity !== "P0");
  if (escalated.length) fails.push(`escalated to P0 defect(s): ${escalated.map((p) => `${p.from.severity}\u2192P0 ${p.to.title}`).join("; ")}`);
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

- base: ${provLine(base.cfg?.provenance, "no provenance (legacy run)")}
- current: ${provLine(cur.cfg?.provenance, "no provenance (legacy run)")}

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
  writeText(join20(outDir, "COMPARE.md"), r.md);
  return r;
}

// src/sarif.ts
import { join as join21, relative as relative4, sep as sep3 } from "path";
var LEVEL = { P0: "error", P1: "warning", P2: "note" };
function buildSarif(cfg, doc, runDir) {
  const targetAbs = resolveTargetAbs(cfg.targetAbs, cfg.target, runDir);
  const lineCache = /* @__PURE__ */ new Map();
  const live = (doc.findings ?? []).filter((f) => f.status !== "dismissed");
  const ruleOf = (f) => `ultraeval/${f.dimension ?? f.kind ?? "defect"}`;
  const results = live.map((f) => {
    const locations = (f.evidence ?? []).map((e) => resolveEvidence(e.ref, { targetAbs, runDir, lineCache })).filter((r) => r.resolved && r.kind === "file" && r.absPath).map((r) => ({
      physicalLocation: {
        artifactLocation: {
          uri: relative4(targetAbs, r.absPath).split(sep3).join("/")
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
function writeSarif(runDir, out2) {
  const cfg = readJson(join21(runDir, "eval.config.json"));
  const doc = readJson(join21(runDir, "findings.json"));
  const p = join21(out2 ?? runDir, "eval.sarif");
  writeJson(p, buildSarif(cfg, doc, runDir));
  return p;
}

// src/clean.ts
import { readdirSync as readdirSync6, rmSync as rmSync3 } from "fs";
import { join as join23 } from "path";
var DERIVED = ["VERIFY.todo.json", "VERIFY.md", "VERIFY.json", "VERIFY.honeypots.json", "index.html", "index.md", "eval.sarif"];
function clean(runDir, opts = {}) {
  const removed = [];
  if (exists(runDir) && !exists(join23(runDir, "eval.config.json"))) {
    throw new Error(`refusing to clean ${runDir}: not an ultraeval run (no eval.config.json)`);
  }
  if (opts.all) {
    if (exists(runDir)) {
      rmSync3(runDir, { recursive: true, force: true });
      removed.push(runDir);
    }
    return removed;
  }
  for (const name2 of DERIVED) {
    const p = join23(runDir, name2);
    if (exists(p)) {
      rmSync3(p, { force: true });
      removed.push(p);
    }
  }
  if (exists(runDir)) {
    for (const e of readdirSync6(runDir)) {
      if (/^VERIFY\.(todo\.|honeypots\.)?\d+\.(json|md)$/.test(e)) {
        rmSync3(join23(runDir, e), { force: true });
        removed.push(join23(runDir, e));
      }
    }
  }
  return removed;
}

// src/oneshot.ts
import { join as join25 } from "path";

// src/templates.ts
import { dirname as dirname3, join as join24 } from "path";
function calibrationFixturePath(engineAbs) {
  const candidates = [
    join24(dirname3(engineAbs), "..", "references", "calibration-run.json"),
    join24(dirname3(engineAbs), "..", "skills", "ultraeval", "references", "calibration-run.json")
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
  },
  business: {
    golden: "drive the core business rules end-to-end on realistic domain inputs \u2014 the documented outcomes come out",
    error: "feed a boundary/rule-violating input \u2014 the business rule rejects it and state stays consistent",
    help: "the documented domain behavior (rules, invariants, edge cases) matches what the code actually does",
    artifact: "the exercised rule inputs/outputs transcript under runs/live-* plus the runs/live.md narrative",
    pass: "rules behave per the documented domain semantics; invariants hold on every exercised path"
  }
};
function liveScenarioFor(cfg) {
  const key2 = categoryKey(cfg.category ?? "");
  if (key2 === "security") return LIVE_SCENARIOS.security;
  if (key2 === "requirements") return LIVE_SCENARIOS.requirements;
  if (key2 === "business") return LIVE_SCENARIOS.business;
  if (key2 === "research") return LIVE_SCENARIOS.research;
  if (key2 === "web") return LIVE_SCENARIOS["web app"];
  if (key2 === "cli") return LIVE_SCENARIOS.cli;
  return cfg.kind === "skill" ? LIVE_SCENARIOS["agent skill"] : LIVE_SCENARIOS.library;
}
var diffScopeBlock = (cfg) => cfg.provenance?.sinceRef ? `
**DIFF SCOPE (binding).** This eval is scoped to changes since \`${cfg.provenance.sinceRef}\` (run \`git -C ${cfg.targetAbs} diff --name-only ${cfg.provenance.sinceRef}\` for the changed set). Exercise and report ONLY changed behavior; findings MUST cite changed files (unchanged files are context, not findings \u2014 \`check\` warns on out-of-scope citations, and \`check --strict-scope\` hard-fails them). Finish with \`compare --run <RUN> --base <previous-run> --gate\` semantics in mind: this run gates a delta, not the whole repo.
` : "";
var fileScopeBlock = (cfg) => cfg.scope?.length ? `
**FILE SCOPE (binding).** This eval is scoped to the target-relative globs \`${cfg.scope.join(", ")}\`. Read anything for context, but exercise and report ONLY behavior implemented inside the scope: every finding MUST cite at least one in-scope file. \`check\` hard-fails a finding whose target citations are all out of scope, unless the finding carries the tag \`scope-exempt\` (reserved for a cross-cutting issue that genuinely breaks the in-scope behavior \u2014 justify it in the statement). Infra/config/tooling/tests outside the scope are context, not findings.
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
    ...cfg.scope?.length ? [`const SCOPE = ${JSON.stringify(cfg.scope)}`] : [],
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
    ...cfg.scope?.length ? [`    + '\\nFILE SCOPE (binding): ' + SCOPE.join(', ') + ' \u2014 every finding must cite at least one in-scope file (tag scope-exempt otherwise).'`] : [],
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
var GATE_CHEATSHEET = (engineAbs, run2) => [
  `- \`node ${engineAbs} check --run ${run2}\` \u2014 structural grounding gate (every finding must resolve to a real file:line in the target, or a run: artifact). Exit 0 = grounded.`,
  `- \`node ${engineAbs} verify --run ${run2}\` \u2014 writes VERIFY.todo.json (claim\u2194evidence). Fill each verdict honestly: \`supported\`/\`partial\`/\`refuted\`/\`unsupported\`.`,
  `- \`node ${engineAbs} verify --run ${run2} --apply <verdicts.json>\` \u2014 reduces to VERIFY.json.`,
  `- \`node ${engineAbs} check --run ${run2} --semantic --require-verify\` \u2014 folds verdicts in; the exit gate.`
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
${cfg.scope?.length ? `
File scope: enumerate ONLY functionality implemented inside \`${cfg.scope.join(", ")}\` \u2014 out-of-scope behavior is context, not a test row.
` : ""}
Read \`${cfg.targetAbs}\` (its SKILL.md/README/CLI \`--help\`, or its source) and the research notes under \`${runDirAbs}/research/\`.

Enumerate EVERY functionality worth testing \u2014 modes, subcommands, flags, gates, and the live end-to-end behavior \u2014 mapped to the dimensions. For each: id, what it is, the concrete command or user prompt that tests it, and explicit pass criteria.

The live rows MUST map to the category's normed scenario set (golden path, error path, help contract \u2014 see \`references/live-scenarios.md\` next to the engine; the executor contract embeds this category's block).

Write \`${runDirAbs}/TEST-PLAN.md\` (a reviewable checklist with the rubric embedded). Be exhaustive about the CLI/behavior surface.
`,
    executor: `# Contract: executor
${diffScopeBlock(cfg)}${fileScopeBlock(cfg)}
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
${diffScopeBlock(cfg)}${fileScopeBlock(cfg)}
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
${cfg.scope?.length ? `
This is a file-scoped eval (\`${cfg.scope.join(", ")}\`): score in-scope behavior only \u2014 out-of-scope code never lowers (or raises) a dimension score.
` : ""}
You are an INDEPENDENT judge. You did not run the eval. Judge through the LENS named in your prompt.

**Step 0 \u2014 CALIBRATION (required).** Read the golden fixture at \`${calibrationFixturePath(engineAbs)}\`. Score its \`artifacts\` 0\u20135 on each of its \`dimensions\` (use each dimension's name, NOT its \`expected\`/\`signal\` fields \u2014 read the artifacts first, then compare). \`passed\` = every one of your scores is within \`tolerance\` of \`expected\`. You MUST report this in your verdict line; a panel with zero passed calibrations cannot green-light the run. Do NOT let the fixture influence how you score the real run.

**Step 0b \u2014 CROSS-RUN ANCHOR (when a prior run exists).** If the target's committed ledger \`evals/history.jsonl\` exists (anchored at the target's git root \u2014 \`git -C ${cfg.targetAbs} rev-parse --show-toplevel\`), read its LAST entry and open that prior run's \`scorecard.json\` and \`judges.jsonl\`. That panel is your severity standard: the same defect class in an unchanged area scores the same as it did there \u2014 score deltas must come from changed reality, never from a fresh judge's mood. Re-derive every score yourself (never copy forward); when you deviate from the prior standard on a dimension, say so in that dimension's rationale ("prior run scored N; I score M because <what actually changed>").

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
${diffScopeBlock(cfg)}${fileScopeBlock(cfg)}
Discover grounded improvement leads (both internal health AND product/capability) \u2014 be divergent, then keep the grounded ones.

1. \`node ${engineAbs} brainstorm --run ${runDirAbs}\` \u2192 emits \`BRAINSTORM.todo.md\` (lenses + hotspots).
2. Work every lens against the hotspots in \`ANALYSIS.md\` and the code. Generate MANY candidates, then write \`${runDirAbs}/opportunities.json\`: each \`{ dimension?, impact: high|med|low, effort: S|M|L, title, statement, recommendation, evidence:[{ref}] }\`. Every opportunity MUST anchor to a real \`file:line\` in the target or \`analysis:<file>\` \u2014 no ungrounded "rewrite everything". Rate impact/effort honestly (quick wins = high/S).
3. \`node ${engineAbs} brainstorm --run ${runDirAbs} --rank\` \u2192 folds ranked opportunities into \`findings.json\` as kind:opportunity. The Gate stage then \`check\`s them; drop any that do not resolve.
`
  };
}
function runbookMd(cfg, runDirAbs, engineAbs) {
  const mode = cfg.mode ?? "audit";
  const doDefects = mode !== "improve";
  const doOpps = mode !== "audit";
  const stages = [];
  for (const d of cfg.dimensions)
    stages.push({
      title: `Research \u2014 ${d.id}`,
      contract: "researcher",
      note: `DIMENSION=${d.id} (${d.name}); write ${runDirAbs}/research/${d.id}.md (cited).`
    });
  stages.push({ title: "TestPlan", contract: "testplan", note: `write ${runDirAbs}/TEST-PLAN.md.` });
  if (doDefects) {
    stages.push({
      title: "Execute \u2014 core",
      contract: "executor",
      note: "MODE=core \u2014 deterministic engine + gate exercises on genuine AND doctored artifacts."
    });
    stages.push({ title: "Execute \u2014 live", contract: "executor", note: "MODE=live \u2014 realistic end-to-end run of the target." });
    stages.push({ title: "Findings", contract: "findings", note: `consolidate into ${runDirAbs}/findings.json (+ RESULTS.md, SUMMARY.md).` });
  }
  if (doOpps) {
    stages.push({ title: "Analyze", contract: "analyzer", note: "deterministic analysis.json + ANALYSIS.md." });
    stages.push({ title: "Brainstorm", contract: "brainstormer", note: `grounded opportunities into ${runDirAbs}/opportunities.json.` });
  }
  stages.push({ title: "Gate", contract: "gate", note: "iterate the check/verify chain until green \u2014 the exit gate." });
  for (const [i2, lens] of ["correctness+grounding", "completeness+coverage", "ux+meets-expectations"].entries())
    stages.push({ title: `Judge ${i2 + 1}`, contract: "judge", note: `LENS=${lens}; calibrate first, append your verdict line to judges.jsonl.` });
  stages.push({ title: "Results", contract: "remediator", note: "score + backlog --tdd + render + final check --semantic." });
  const steps = stages.map((s, i2) => `${i2 + 1}. **${s.title}** \u2014 play \`${runDirAbs}/agents/${s.contract}.md\` yourself. ${s.note}`).join("\n");
  return `# ultraeval \u2014 sequential RUNBOOK (eco / no-subagent fallback)

Run: \`${runDirAbs}\` \xB7 Target: \`${cfg.targetAbs}\` \xB7 Engine: \`node ${engineAbs}\` \xB7 mode: ${mode}${cfg.scope?.length ? ` \xB7 scope: \`${cfg.scope.join(", ")}\`` : ""}

Generated by \`ultraeval plan --eco\`. Same stages, same contracts, same gates as the
multi-agent \`eval.workflow.mjs\` \u2014 played sequentially by ONE agent. Correctness-identical;
only wall-clock differs. Fan-out is an optimization, not a requirement.

Every stage: read the named contract under \`${runDirAbs}/agents/\` and execute it VERBATIM,
invoking the engine only by its absolute path (\`node ${engineAbs} <cmd>\`), writing every
artifact under the run dir.

${steps}

**Exit gate**: \`node ${engineAbs} check --run ${runDirAbs} --semantic --require-verify\` must exit 0 before presenting results.
`;
}
function oneshotMd(cfg, runDirAbs, engineAbs) {
  const dims = cfg.dimensions.map((d) => `- **${d.id}** ${d.name} (w=${d.weight}${anchorText(d) ? `, anchored to ${anchorText(d)}` : ""}): ${d.whatPerfectLooksLike}`).join("\n");
  return `# ultraeval \u2014 ONE-SHOT eval contract

Run: \`${runDirAbs}\` \xB7 Target: \`${cfg.targetAbs}\` \xB7 Engine: \`node ${engineAbs}\` \xB7 kind: ${cfg.kind} \xB7 category: ${cfg.category}${cfg.scope?.length ? ` \xB7 scope: \`${cfg.scope.join(", ")}\`` : ""}
${fileScopeBlock(cfg)}
A quick single-pass read by ONE agent \u2014 no subagents, no fan-out, no research stage,
no verify/honeypots, no judge panel. The result is **indicative, not a normed verdict**:
never present it as verified. For the full pipeline, upgrade with \`node ${engineAbs} plan --run ${runDirAbs}\`.

## Dimensions (sketch each 0\u20135 in SUMMARY.md)

${dims}

## The pass (ONE pass, timeboxed \u2014 a stuck step is recorded and skipped, never a hang)

1. **Skim** the target${cfg.scope?.length ? " within the scope" : ""}: README/SKILL.md/docs, entry points, the load-bearing files. Run the cheap obvious probe (test suite entry, \`--help\`, the main flow) when it costs seconds.
2. **Evaluate every dimension together**, collecting concrete defects as you go \u2014 no per-dimension sub-passes.
3. **Write \`${runDirAbs}/findings.json\`** following \`${runDirAbs}/findings.schema.json\` \u2014 the SAME grounding grammar as a full run: every finding cites \`path:line\` in the target (or \`run:relpath#Lnn\`); NEVER invent line numbers. severity: ${severityLegend()}.
4. **Write \`${runDirAbs}/SUMMARY.md\`** \u2014 open with "One-shot eval \u2014 indicative, not a normed verdict.", then a per-dimension sketch (0\u20135 + one line each) citing \`[F#]\`.
5. **Gate (required):** \`node ${engineAbs} check --run ${runDirAbs}\` until exit 0 \u2014 repair or delete ungrounded findings; never weaken the gate.
6. **Optional:** \`node ${engineAbs} backlog --run ${runDirAbs} --tdd\` for TDD fix cards; \`node ${engineAbs} score --run ${runDirAbs}\` after appending ONE self-judge line to \`judges.jsonl\` (set \`author\` to yourself \u2014 the scorecard is flagged non-independent).
`;
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
            tags: {
              type: "array",
              items: { type: "string" },
              description: "scope-exempt \u2014 a justified cross-cutting finding whose citations sit outside the declared file scope"
            },
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

// src/oneshot.ts
function oneshotRun(opts, engineAbs) {
  const { cfg, runDir, gitignore } = initRun({ ...opts, mode: "audit", oneshot: true });
  const written = [join25(runDir, "eval.config.json")];
  const w = (rel, content) => {
    const p = join25(runDir, rel);
    writeText(p, content);
    written.push(p);
  };
  w("ONESHOT.md", oneshotMd(cfg, runDir, engineAbs));
  w("dimensions.json", `${JSON.stringify(cfg.dimensions, null, 2)}
`);
  w("findings.schema.json", `${JSON.stringify(findingsSchema(), null, 2)}
`);
  return { cfg, runDir, written, ...gitignore ? { gitignore } : {} };
}

// src/plan.ts
import { rmSync as rmSync4 } from "fs";
import { join as join26 } from "path";
function planRun(runDir, engineAbs, opts = {}) {
  let cfg = readJson(join26(runDir, "eval.config.json"));
  const written = [];
  const w = (rel, content) => {
    const p = join26(runDir, rel);
    writeText(p, content);
    written.push(p);
  };
  if (cfg.oneshot || cfg.provenance?.profile) {
    rmSync4(join26(runDir, "ONESHOT.md"), { force: true });
    const { oneshot: _oneshot, ...rest } = cfg;
    cfg = rest;
    if (cfg.provenance?.profile) {
      const { profile: _profile, ...prov } = cfg.provenance;
      cfg = { ...cfg, provenance: prov };
    }
    writeJson(join26(runDir, "eval.config.json"), cfg);
    written.push(join26(runDir, "eval.config.json"));
  }
  if (opts.eco === true) {
    rmSync4(join26(runDir, "eval.workflow.mjs"), { force: true });
    w("RUNBOOK.md", runbookMd(cfg, runDir, engineAbs));
  } else {
    rmSync4(join26(runDir, "RUNBOOK.md"), { force: true });
    w("eval.workflow.mjs", workflowScript(cfg, runDir, engineAbs));
  }
  for (const [name2, content] of Object.entries(agentContracts(cfg, runDir, engineAbs))) w(`agents/${name2}.md`, content);
  w("TEST-PLAN.template.md", testPlanTemplate(cfg));
  w("dimensions.json", `${JSON.stringify(cfg.dimensions, null, 2)}
`);
  w("findings.schema.json", `${JSON.stringify(findingsSchema(), null, 2)}
`);
  return written;
}

// src/fix.ts
import { spawnSync as spawnSync2 } from "child_process";
import { isAbsolute as isAbsolute4, join as join27, resolve as resolve5 } from "path";
function loadBacklog(runDir) {
  const blPath = join27(runDir, "BACKLOG.json");
  if (!exists(blPath)) throw new Error("no BACKLOG.json \u2014 run `backlog --run <run> --tdd` first, then fix");
  return { cfg: readJson(join27(runDir, "eval.config.json")), backlog: readJson(blPath) };
}
function targetInvariants(targetAbs) {
  const lines = [];
  const pkgPath = join27(targetAbs, "package.json");
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
  const absTargets = t.targets.map((x) => isAbsolute4(x) ? x : join27(targetAbs, x));
  const redFile = isAbsolute4(t.red.testFile) ? t.red.testFile : join27(targetAbs, t.red.testFile);
  const deps = t.dependsOn.length ? `
Depends on: ${t.dependsOn.join(", ")} \u2014 confirm each is \`status: "done"\` in \`${join27(runDir, "BACKLOG.json")}\` before starting; if not, STOP and report.` : "";
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
(echoes the exact command + cwd, then replays the verify command timeboxed, confirms the RED test was AUTHORED for this task \u2014 the task-specific test file the backlog marked expected-new must now exist \u2014 and stamps \`status: "done"\` + \`verifiedAt\` in BACKLOG.json \u2014 exit 1 otherwise).
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
    const p = join27(runDir, "fixes", "agents", `${t.id}.agent.md`);
    writeText(p, agentContract(t, cfg, runDir, engineAbs));
    written.push(p);
  }
  if (opts.workflow) {
    const p = join27(runDir, "fix.workflow.mjs");
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
    `// Parse-safe guard: under plain \`node\` the Workflow-harness globals are absent.`,
    `if (typeof phase === 'undefined') {`,
    `  console.error('fix.workflow.mjs is a Workflow-harness script, not a plain Node script \u2014 agent()/phase()/log() come from the harness.')`,
    `  console.error('Launch it with: Workflow({ scriptPath: ' + JSON.stringify(RUN + '/fix.workflow.mjs') + ' })')`,
    `  console.error('No Workflow tool? Dispatch a subagent per fix contract under ' + RUN + '/fixes/agents/*.agent.md (see SKILL.md step 6).')`,
    `  process.exit(2)`,
    `}`,
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
  const redFile = isAbsolute4(task.red.testFile) ? task.red.testFile : resolve5(targetAbs, task.red.testFile);
  const redTestExists = exists(redFile);
  const expectedNew = task.red.expectedNew;
  let testFirst = true;
  let testFirstReason;
  if (expectedNew === false) {
    testFirst = false;
    testFirstReason = `RED test file ${redFile} already existed when the backlog was generated \u2014 a pre-existing test is not a failing-test-first authored for ${taskId}; write a new task-specific RED test`;
  } else if (expectedNew === true) {
    if (!redTestExists) {
      testFirst = false;
      testFirstReason = `RED test file missing: ${redFile} \u2014 it was expected to be authored (test-first) for ${taskId} but does not exist; the fix was not test-first`;
    }
  } else {
    testFirst = false;
    testFirstReason = redTestExists ? `RED test file ${redFile} has no recorded pre-existence state (legacy backlog) \u2014 cannot confirm it was authored first for ${taskId}; regenerate the backlog with \`ultraeval backlog\` so verify-fix can gate test-first` : `RED test file missing: ${redFile} \u2014 the fix was not test-first`;
  }
  console.error(`verify-fix ${taskId}: replaying \`${task.verify.command}\` in ${targetAbs}`);
  const proc = spawnSync2(task.verify.command, { shell: true, cwd: targetAbs, encoding: "utf8", timeout: opts.timeoutMs ?? 6e5 });
  const exitCode = proc.status;
  const ok = exitCode === 0 && testFirst;
  const result = { ok, taskId, exitCode, redTestExists };
  if (!testFirst) result.reason = testFirstReason;
  else if (exitCode !== 0) result.reason = `verify command exited ${exitCode ?? "null (timeout/kill)"}: ${task.verify.command}`;
  if (ok) {
    task.status = "done";
    task.verifiedAt = (/* @__PURE__ */ new Date()).toISOString();
    result.verifiedAt = task.verifiedAt;
    writeJson(join27(runDir, "BACKLOG.json"), backlog);
  }
  return result;
}
function formatVerifyFix(r) {
  return r.ok ? `PASS  ${r.taskId} verified \u2014 status: done (${r.verifiedAt})` : `FAIL  ${r.taskId} \u2014 ${r.reason ?? "verification failed"}`;
}

// src/rejudge.ts
import { cpSync, mkdirSync as mkdirSync3 } from "fs";
import { join as join28 } from "path";
var COPY_FILES = ["eval.config.json", "dimensions.json", "findings.json", "RESULTS.md", "SUMMARY.md", "TEST-PLAN.md", "VERIFY.json"];
var COPY_DIRS = ["research", "runs"];
function rejudgeRun(runDir, outDir, engineAbs) {
  if (!exists(join28(runDir, "eval.config.json"))) throw new Error(`refusing to rejudge ${runDir}: not an ultraeval run (no eval.config.json)`);
  const cfg = readJson(join28(runDir, "eval.config.json"));
  mkdirSync3(outDir, { recursive: true });
  const copied = [];
  for (const f of COPY_FILES) {
    if (!exists(join28(runDir, f))) continue;
    cpSync(join28(runDir, f), join28(outDir, f));
    copied.push(f);
  }
  for (const d of COPY_DIRS) {
    if (!exists(join28(runDir, d))) continue;
    cpSync(join28(runDir, d), join28(outDir, d), { recursive: true });
    copied.push(`${d}/`);
  }
  writeText(join28(outDir, "judges.jsonl"), "");
  writeText(join28(outDir, "agents", "judge.md"), agentContracts(cfg, outDir, engineAbs).judge);
  writeText(join28(outDir, "rejudge.workflow.mjs"), rejudgeWorkflow(cfg, outDir, engineAbs, runDir));
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
    `// Parse-safe guard: under plain \`node\` the Workflow-harness globals are absent.`,
    `if (typeof phase === 'undefined') {`,
    `  console.error('rejudge.workflow.mjs is a Workflow-harness script, not a plain Node script \u2014 agent()/phase()/parallel()/log() come from the harness.')`,
    `  console.error('Launch it with: Workflow({ scriptPath: ' + JSON.stringify(RUN + '/rejudge.workflow.mjs') + ' })')`,
    `  console.error('No Workflow tool? Run the stages by hand: dispatch a subagent per contract under ' + AGENTS + '/*.md (see SKILL.md).')`,
    `  process.exit(2)`,
    `}`,
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
import { join as join29 } from "path";
function anchorFor(cfg, id) {
  const d = (cfg.dimensions ?? []).find((x) => x.id === id);
  return d?.anchors?.length ? d.anchors.map((a) => `${a.standard} \u2014 ${a.ref}`).join("; ") : "\u2014";
}
function load2(runDir) {
  const cfg = readJson(join29(runDir, "eval.config.json"));
  const doc = readJson(join29(runDir, "findings.json"));
  const verify = exists(join29(runDir, "VERIFY.json")) ? readJson(join29(runDir, "VERIFY.json")) : null;
  const backlog = exists(join29(runDir, "BACKLOG.json")) ? readJson(join29(runDir, "BACKLOG.json")) : null;
  const scorecard = exists(join29(runDir, "scorecard.json")) ? readJson(join29(runDir, "scorecard.json")) : null;
  return { cfg, doc, verify, backlog, scorecard };
}
function render(runDir, opts = {}) {
  const { cfg, doc, verify, backlog, scorecard } = load2(runDir);
  const out2 = opts.out ?? runDir;
  const written = [];
  if (opts.md !== false) {
    const p = join29(out2, "index.md");
    writeText(p, buildMd(cfg, doc, verify, backlog, scorecard));
    written.push(p);
  }
  if (opts.html !== false) {
    const p = join29(out2, "index.html");
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
  const c2 = counts(doc);
  const rows = doc.findings.filter((f) => f.status !== "dismissed" && f.kind !== "opportunity").map((f) => `| ${f.id} | ${f.severity} | ${f.title.replace(/\|/g, "\\|")} | ${f.status} | ${(f.evidence ?? []).map((e) => `\`${e.ref}\``).join(" ")} |`).join("\n");
  const prov = provLine(cfg.provenance);
  const parts2 = [
    `# Evaluation \u2014 ${cfg.target}`,
    ``,
    `> target \`${cfg.targetAbs}\` \xB7 ${cfg.kind} \xB7 ${cfg.category} \xB7 ${c2.total} findings (P0 ${c2.p0} \xB7 P1 ${c2.p1} \xB7 P2 ${c2.p2})${c2.opps ? ` \xB7 ${c2.opps} opportunities` : ""}`,
    ...prov ? [`> ${prov}`] : [],
    ``
  ];
  if (scorecard) {
    parts2.push(
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
  parts2.push(`## Findings`, ``, `| id | sev | title | status | evidence |`, `|----|-----|-------|--------|----------|`, rows || `| \u2014 | \u2014 | none | \u2014 | \u2014 |`);
  const opps = opportunities(doc);
  if (opps.length)
    parts2.push(
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
    parts2.push(
      ``,
      `## Verification`,
      ``,
      `${verify.ok ? "\u2705" : "\u274C"} ${verify.adjudicated} adjudicated \xB7 ${verify.supported} supported \xB7 ${verify.refuted} refuted \xB7 ${verify.unsupported} unsupported${verify.failures.length ? ` \xB7 fails: ${verify.failures.join(", ")}` : ""}`
    );
  if (backlog)
    parts2.push(
      ``,
      `## Fix backlog (${backlog.tasks.length})`,
      ``,
      backlog.tasks.map((t) => `- **${t.id}** (${t.priority}) ${t.title} \u2192 \`${t.red.testFile}\``).join("\n") || "- none"
    );
  return `${parts2.join("\n")}
`;
}
var STYLE = `body{font:15px/1.5 system-ui,sans-serif;max-width:60rem;margin:2rem auto;padding:0 1rem;color:#111}
h1{margin-bottom:.2rem}table{border-collapse:collapse;width:100%;margin:1rem 0}th,td{border:1px solid #ddd;padding:.4rem .6rem;text-align:left;font-size:14px}
.p0{color:#b00}.p1{color:#a60}.p2{color:#555}.meta{color:#666}code{background:#f4f4f4;padding:.05rem .3rem;border-radius:3px}
@media(prefers-color-scheme:dark){body{background:#111;color:#eee}th,td{border-color:#333}code{background:#222}.meta{color:#999}}`;
function buildHtml(cfg, doc, verify, backlog, scorecard) {
  const c2 = counts(doc);
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
<p class="meta"><code>${esc(cfg.targetAbs)}</code> \xB7 ${cfg.kind} \xB7 ${esc(cfg.category)} \xB7 ${c2.total} findings (P0 ${c2.p0} \xB7 P1 ${c2.p1} \xB7 P2 ${c2.p2})${c2.opps ? ` \xB7 ${c2.opps} opportunities` : ""}</p>
${provLine(cfg.provenance) ? `<p class="meta">${esc(provLine(cfg.provenance))}</p>` : ""}
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
import { execFileSync as execFileSync4 } from "child_process";
import { appendFileSync, mkdirSync as mkdirSync4 } from "fs";
import { dirname as dirname4, join as join30 } from "path";
function readJudges(runDir) {
  const p = join30(runDir, "judges.jsonl");
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
  const agreement = judges.length > 1 ? Number((1 - avgSpread / 5).toFixed(2)) : void 0;
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
    ...agreement !== void 0 ? { agreement } : {},
    reason,
    sensitivity,
    ...judgesCalibrated ? { judgesCalibrated } : {},
    ...judgesIndependent !== void 0 ? { judgesIndependent } : {}
  };
}
function scoreRun(runDir) {
  const cfg = readJson(join30(runDir, "eval.config.json"));
  const doc = exists(join30(runDir, "findings.json")) ? readJson(join30(runDir, "findings.json")) : { findings: [] };
  const judges = readJudges(runDir);
  if (!judges.length) throw new Error("no judge verdicts in judges.jsonl \u2014 the Judge phase has not run; dispatch judges (agents/judge.md) first");
  const sc = computeScore(cfg, judges, doc);
  if (cfg.provenance) sc.provenance = cfg.provenance;
  if (cfg.oneshot) sc.oneshot = true;
  sc.scoredAt = (/* @__PURE__ */ new Date()).toISOString();
  writeJson(join30(runDir, "scorecard.json"), sc);
  return sc;
}
function appendHistory(runDir, file) {
  const scPath = join30(runDir, "scorecard.json");
  if (!exists(scPath)) throw new Error("no scorecard.json \u2014 run `score --run <run>` first, then --history");
  const sc = readJson(scPath);
  const doc = exists(join30(runDir, "findings.json")) ? readJson(join30(runDir, "findings.json")) : { findings: [] };
  const live = (doc.findings ?? []).filter((f) => f.status !== "dismissed");
  const commit = sc.provenance?.targetGit?.commit;
  const protocol = sc.provenance?.protocolVersion;
  const rubric = sc.provenance?.rubricVersion;
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
    },
    ...protocol ? { protocol } : {},
    ...rubric ? { rubric } : {},
    ...sc.oneshot ? { oneshot: true } : {}
  };
  mkdirSync4(dirname4(file), { recursive: true });
  appendFileSync(file, `${JSON.stringify(entry)}
`);
  return entry;
}
function targetGitRoot(dir) {
  try {
    return execFileSync4("git", ["-C", dir, "rev-parse", "--show-toplevel"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim() || null;
  } catch {
    return null;
  }
}
function defaultLedgerPath(runDir) {
  const cfg = readJson(join30(runDir, "eval.config.json"));
  const targetAbs = resolveTargetAbs(cfg.targetAbs, cfg.target, runDir);
  const base = targetGitRoot(targetAbs) ?? process.cwd();
  return join30(base, "evals", "history.jsonl");
}
function readHistory(file) {
  if (!exists(file)) return [];
  return readText(file).split("\n").map((l) => l.trim()).filter(Boolean).map((l) => {
    try {
      return JSON.parse(l);
    } catch {
      return null;
    }
  }).filter((x) => x !== null);
}
function formatHistory(entries, file) {
  const lines = [`history  ${file}  (${entries.length} run${entries.length === 1 ? "" : "s"})`];
  let prev;
  for (const e of entries) {
    const when = (e.scoredAt ?? "").slice(0, 10) || "----------";
    const sha = e.commit ? e.commit.slice(0, 7) : "-------";
    const verdict = e.meetsExpectations ? "MEETS" : "below";
    const delta = prev === void 0 ? "" : ` (${e.overall - prev >= 0 ? "+" : ""}${e.overall - prev})`;
    const c2 = e.counts ?? { p0: 0, p1: 0, p2: 0, opps: 0 };
    const agr = ` \xB7 agr ${e.agreement !== void 0 ? e.agreement : "\u2014"}`;
    lines.push(`  ${when}  ${sha}  ${String(e.overall).padStart(3)}/${e.bar} ${verdict}${delta}  P0/P1/P2 ${c2.p0}/${c2.p1}/${c2.p2} \xB7 opp ${c2.opps}${agr}`);
    prev = e.overall;
  }
  const protocols = new Set(entries.map((e) => e.protocol).filter((v) => !!v));
  const rubrics = new Set(entries.map((e) => e.rubric).filter((v) => !!v));
  if (protocols.size > 1 || rubrics.size > 1)
    lines.push(
      `  ! entries span multiple versions (protocol ${[...protocols].join("/") || "?"}, rubric ${[...rubrics].join("/") || "?"}) \u2014 scores across a version bump are not directly comparable`
    );
  return lines.join("\n");
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
import { join as join31 } from "path";
function statusRun(runDir) {
  const has = (rel) => exists(join31(runDir, rel));
  let oneshot = false;
  try {
    if (has("eval.config.json")) oneshot = readJson(join31(runDir, "eval.config.json")).oneshot === true;
  } catch {
    oneshot = false;
  }
  if (oneshot) {
    const steps2 = [
      { artifact: "eval.config.json", present: has("eval.config.json"), stage: "init" },
      { artifact: "ONESHOT.md", present: has("ONESHOT.md"), stage: "oneshot" },
      { artifact: "findings.json", present: has("findings.json"), stage: "findings" },
      { artifact: "SUMMARY.md", present: has("SUMMARY.md"), stage: "findings" },
      { artifact: "scorecard.json", present: has("scorecard.json"), stage: "score" }
    ];
    return { steps: steps2, next: oneshotNextHint(steps2, runDir) };
  }
  const judgesPresent = has("judges.jsonl") && readText(join31(runDir, "judges.jsonl")).trim().length > 0;
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
function oneshotNextHint(steps, runDir) {
  const missing = (stage) => steps.some((s) => s.stage === stage && !s.present);
  if (missing("oneshot")) return `oneshot --target <target> --out ${runDir} (regenerates ONESHOT.md)`;
  if (missing("findings")) return `follow ${runDir}/ONESHOT.md \u2014 one pass, then check --run ${runDir}`;
  return `check --run ${runDir} until exit 0 \u2014 then optional: score --run ${runDir}, backlog --run ${runDir} --tdd, or plan --run ${runDir} to upgrade to the full pipeline`;
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
var FLAG_SPEC = {
  init: {
    target: "value",
    out: "value",
    kind: "value",
    category: "value",
    mode: "value",
    bar: "value",
    since: "value",
    scope: "value",
    "no-gitignore": "boolean"
  },
  oneshot: { target: "value", out: "value", kind: "value", category: "value", bar: "value", scope: "value", "no-gitignore": "boolean" },
  plan: { run: "value", eco: "boolean" },
  orchestrate: { run: "value", eco: "boolean" },
  // family-wide alias for plan
  analyze: { run: "value", since: "value", json: "boolean", target: "value", out: "value" },
  brainstorm: { run: "value", rank: "boolean", check: "boolean" },
  compare: { run: "value", base: "value", json: "boolean", gate: "boolean" },
  check: {
    run: "value",
    semantic: "boolean",
    "require-verify": "boolean",
    strict: "boolean",
    "strict-scope": "boolean",
    "min-findings": "value",
    "coverage-min": "value",
    json: "boolean"
  },
  verify: { run: "value", apply: "value", "max-verify": "value", shards: "value", shard: "value", honeypots: "value" },
  backlog: { run: "value", tdd: "boolean", out: "value" },
  fix: { run: "value", task: "value", workflow: "boolean" },
  "verify-fix": { run: "value", task: "value" },
  score: { run: "value", json: "boolean", history: "optional-value" },
  history: { run: "value", file: "value", json: "boolean" },
  rejudge: { run: "value", out: "value" },
  status: { run: "value", json: "boolean" },
  render: { run: "value", out: "value", "no-html": "boolean", "no-md": "boolean", sarif: "boolean" },
  clean: { run: "value", all: "boolean" }
};
var flagsOfArity = (arity2) => [
  ...new Set(
    Object.values(FLAG_SPEC).flatMap((flags2) => Object.entries(flags2)).filter(([, a]) => a === arity2).map(([name2]) => `--${name2}`)
  )
];
var VALUE_FLAGS = new Set(flagsOfArity("value"));
var OPTIONAL_VALUE_FLAGS = new Set(flagsOfArity("optional-value"));
var COMMAND_FLAGS = Object.fromEntries(Object.entries(FLAG_SPEC).map(([cmd, flags2]) => [cmd, Object.keys(flags2)]));
function parse(argv) {
  const args2 = { _: [] };
  for (let i2 = 0; i2 < argv.length; i2++) {
    const a = argv[i2];
    if (a === void 0) continue;
    if (a === "-h") args2.help = true;
    else if (a === "-v") args2.version = true;
    else if (a.startsWith("--")) {
      if (VALUE_FLAGS.has(a)) args2[a.slice(2)] = argv[++i2] ?? "";
      else if (OPTIONAL_VALUE_FLAGS.has(a)) {
        const next = argv[i2 + 1];
        args2[a.slice(2)] = next !== void 0 && !next.startsWith("--") ? argv[++i2] : "";
      } else args2[a.slice(2)] = true;
    } else args2._.push(a);
  }
  return args2;
}
function num(v) {
  return typeof v === "string" && v !== "" ? Number(v) : void 0;
}
function str2(v) {
  return typeof v === "string" ? v : void 0;
}

// src/cli.ts
var HELP2 = `ultraeval v${VERSION} \u2014 evaluate a skill or codebase, then generate grounded, AI-exploitable TDD fix docs.

Usage: node <skill-dir>/scripts/ultraeval.mjs <command> [flags]

Commands:
  init     --target <path> --out <run> [--kind skill|codebase] [--category <c>] [--mode audit|improve|deep] [--bar <n>] [--since <ref>]
             [--scope <glob[,glob]>] [--no-gitignore]
             Scaffold an eval run: detect the target, write eval.config.json + starter dimensions + provenance.
             --bar calibrates the meets-expectations threshold (default 80); the applied bar is recorded in the scorecard.
             --since <git-ref> diff-scopes the eval (PR gating): contracts target the changed set; check warns on out-of-scope findings.
             --scope file-scopes the eval to target-relative globs (e.g. a m\xE9tier eval: --category m\xE9tier --scope "src/domain/**");
             check hard-fails findings cited only outside the scope (tag scope-exempt to keep a justified cross-cutting one).
             When the run dir sits inside a git repo, init gitignores it there (idempotent; never evals/ \u2014 the committed
             score ledger lives under evals/history.jsonl); --no-gitignore opts out.
  oneshot  --target <path> --out <run> [--kind skill|codebase] [--category <c>] [--scope <glob[,glob]>] [--bar <n>] [--no-gitignore]
             Single-pass quick eval: init + ONESHOT.md (one agent, one pass, no subagents/verify/judges).
             The structural check gate still applies; the result is indicative, never a normed verdict.
             The full pipeline stays the default \u2014 plan --run <run> upgrades a oneshot run in place.
  plan     --run <run> [--eco]        (alias: orchestrate \u2014 the family verb)
             Generate eval.workflow.mjs (a multi-agent Workflow) + agents/*.md contracts + templates.
             --eco skips the workflow and writes RUNBOOK.md instead \u2014 the sequential low-token
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
             A file-scoped run (init --scope) also fails findings cited only outside the scope (tag scope-exempt to downgrade to a warning).
             --strict-scope hard-fails a diff-scoped (init --since) run whose findings cite only unchanged files.
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
             --history appends a one-line ledger entry; the default file is evals/history.jsonl anchored to the
             TARGET repo's git root (stable across cwds), or under the cwd when the target is not a git repo.
  history  [--run <run>] [--file <f>] [<path>] [--json]
             Read back the score-trend the ledger records: each run's overall vs bar, verdict, \u0394, and finding counts.
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

Exit codes: 0 = ok / gate passed \xB7 1 = gate failed (check/verify) \xB7 2 = usage or runtime error.`;
function editDistance(a, b) {
  const dp = Array.from({ length: a.length + 1 }, (_, i2) => [i2, ...Array(b.length).fill(0)]);
  for (let j = 0; j <= b.length; j++) dp[0][j] = j;
  for (let i2 = 1; i2 <= a.length; i2++)
    for (let j = 1; j <= b.length; j++)
      dp[i2][j] = Math.min(
        dp[i2 - 1][j] + 1,
        dp[i2][j - 1] + 1,
        dp[i2 - 1][j - 1] + (a[i2 - 1] === b[j - 1] ? 0 : 1)
      );
  return dp[a.length][b.length];
}
function rejectUnknownFlags(cmd, args2) {
  const known = COMMAND_FLAGS[cmd];
  if (!known) return;
  for (const k of Object.keys(args2)) {
    if (k === "_" || k === "help" || k === "version" || known.includes(k)) continue;
    const best = [...known].sort((x, y) => editDistance(k, x) - editDistance(k, y))[0];
    const hint = best && editDistance(k, best) <= 3 ? ` (did you mean --${best}?)` : "";
    throw new Error(`unknown flag --${k} for ${cmd}${hint}`);
  }
}
var parseScope = (raw) => raw ? raw.split(",").map((s) => s.trim()) : void 0;
var gitignoreLine = (g) => g.action === "added" ? `gitignore: added "${g.entry}" to ${g.path}` : g.action === "already" ? `gitignore: "${g.entry}" already covered` : `gitignore: skipped \u2014 ${g.reason}`;
function cmdInit(args2) {
  const target = str2(args2.target);
  const out2 = str2(args2.out);
  if (!target || !out2) throw new Error("init requires --target <path> and --out <run>");
  const { cfg, runDir, gitignore } = initRun({
    target,
    out: out2,
    kind: str2(args2.kind),
    category: str2(args2.category),
    mode: str2(args2.mode),
    bar: num(args2.bar),
    since: str2(args2.since),
    scope: parseScope(str2(args2.scope)),
    gitignore: args2["no-gitignore"] !== true
  });
  console.log(
    `ultraeval init: ${cfg.kind} \xB7 ${cfg.category} \xB7 mode ${cfg.mode} \xB7 ${cfg.dimensions.length} dimensions${cfg.scope ? ` \xB7 scope ${cfg.scope.join(",")}` : ""} -> ${runDir}`
  );
  if (gitignore) console.log(gitignoreLine(gitignore));
}
function cmdOneshot(args2) {
  const target = str2(args2.target);
  const out2 = str2(args2.out);
  if (!target || !out2) throw new Error("oneshot requires --target <path> and --out <run>");
  const engine = fileURLToPath2(import.meta.url);
  const { cfg, runDir, gitignore } = oneshotRun(
    {
      target,
      out: out2,
      kind: str2(args2.kind),
      category: str2(args2.category),
      bar: num(args2.bar),
      scope: parseScope(str2(args2.scope)),
      gitignore: args2["no-gitignore"] !== true
    },
    engine
  );
  console.log(
    `ultraeval oneshot: ${cfg.kind} \xB7 ${cfg.category} \xB7 ${cfg.dimensions.length} dimensions${cfg.scope ? ` \xB7 scope ${cfg.scope.join(",")}` : ""} -> ${runDir}`
  );
  if (gitignore) console.log(gitignoreLine(gitignore));
  console.log(`
Single pass: follow ${runDir}/ONESHOT.md, then gate with: check --run ${runDir}`);
  console.log(`Full pipeline instead: plan --run ${runDir} (upgrades this run in place).`);
}
function cmdPlan(args2, cmd) {
  const run2 = str2(args2.run);
  if (!run2) throw new Error(`${cmd} requires --run <run>`);
  const engine = fileURLToPath2(import.meta.url);
  const eco = args2.eco === true;
  const written = planRun(run2, engine, { eco });
  console.log(`ultraeval ${cmd}: generated
${written.map((w) => `  ${w}`).join("\n")}`);
  if (eco) console.log(`
Sequential eco path: follow ${run2}/RUNBOOK.md, playing each agents/*.md contract yourself.`);
  else console.log(`
Launch the eval: Workflow({ scriptPath: "${run2}/eval.workflow.mjs" })  \u2014 or run the stages by hand via agents/*.md`);
}
function cmdAnalyze(args2) {
  const run2 = str2(args2.run);
  const since = str2(args2.since);
  let targetAbs;
  let out2;
  if (run2) {
    const cfg = readJson(join32(run2, "eval.config.json"));
    targetAbs = resolveTargetAbs(cfg.targetAbs, cfg.target, run2);
    out2 = run2;
  } else {
    targetAbs = str2(args2.target);
    out2 = str2(args2.out);
  }
  if (!targetAbs || !out2) throw new Error("analyze requires --run <run> (or --target <dir> --out <dir>)");
  const onlyFiles = since ? changedFiles(targetAbs, since) : void 0;
  const a = runAnalyze(targetAbs, out2, { onlyFiles });
  if (args2.json) console.log(JSON.stringify(a, null, 2));
  else
    console.log(
      `ultraeval analyze: ${a.files} files \xB7 ${a.loc} LOC \xB7 ${a.hotspots.length} hotspots \xB7 ${a.deps.edges} edges \xB7 tests ${a.tests.ratio}${since ? ` \xB7 since ${since}` : ""} -> ${out2}/analysis.json`
    );
}
function cmdBrainstorm(args2) {
  const run2 = str2(args2.run);
  if (!run2) throw new Error("brainstorm requires --run <run>");
  if (args2.rank) {
    const r = rankBrainstorm(run2);
    console.log(`ultraeval brainstorm --rank: +${r.added} opportunities folded into findings.json (${r.total} total)`);
    for (const s of r.skipped) console.log(`  ! skipped${s.title ? ` "${s.title}"` : ""}: ${s.reason}`);
    if (args2.check) {
      const c2 = checkRun(run2);
      console.log(formatCheckReport(c2, run2));
      process.exitCode = c2.ok ? 0 : 1;
    } else {
      console.log("  next: `check --run <run>` to gate them.");
    }
  } else {
    const r = runBrainstorm(run2);
    console.log(`ultraeval brainstorm: ${r.lenses} lenses -> ${run2}/BRAINSTORM.todo.md (fill opportunities.json, then --rank)`);
  }
}
function cmdCompare(args2) {
  const run2 = str2(args2.run);
  if (!run2) throw new Error("compare requires --run <new-run> and --base <old-run>");
  const base = str2(args2.base);
  if (!base) throw new Error("compare requires --base <old-run>");
  const r = runCompare(base, run2, run2);
  if (args2.json) {
    const { md: _md, ...rest } = r;
    console.log(JSON.stringify(rest, null, 2));
  } else {
    console.log(
      `ultraeval compare: score \u0394 ${r.scoreDelta ?? "n/a"} \xB7 ${r.resolved.length} resolved \xB7 ${r.introduced.length} introduced \xB7 ${r.retitled.length} retitled -> ${run2}/COMPARE.md`
    );
  }
  for (const w of r.warnings) console.log(`  ! ${w}`);
  if (args2.gate) {
    const fails = gateFailures(r);
    for (const f of fails) console.log(`  \u2717 gate: ${f}`);
    process.exitCode = fails.length ? 1 : 0;
  }
}
function cmdCheck(args2) {
  const run2 = str2(args2.run);
  if (!run2) throw new Error("check requires --run <run>");
  if (!exists(join32(run2, "eval.config.json"))) throw new Error(`no eval.config.json under ${run2} \u2014 not an ultraeval run; run \`ultraeval init\` first`);
  const r = checkRun(run2, {
    semantic: !!args2.semantic,
    requireVerify: !!args2["require-verify"],
    strict: !!args2.strict,
    strictScope: !!args2["strict-scope"],
    minFindings: num(args2["min-findings"]),
    coverageMin: num(args2["coverage-min"])
  });
  console.log(args2.json ? JSON.stringify(r, null, 2) : formatCheckReport(r, run2));
  process.exitCode = r.usageError ? 2 : r.ok ? 0 : 1;
}
function cmdVerify(args2) {
  const run2 = str2(args2.run);
  if (!run2) throw new Error("verify requires --run <run>");
  const apply = str2(args2.apply);
  if (apply) {
    const res = applyVerdicts(run2, apply);
    console.log(formatVerifyReport(res));
    process.exitCode = res.ok ? 0 : 1;
  } else {
    const shards = num(args2.shards);
    const shard = num(args2.shard);
    const honeypots = num(args2.honeypots);
    const todo = runVerify(run2, { maxVerify: num(args2["max-verify"]), shards, shard, honeypots });
    const todoName = shards !== void 0 && shard !== void 0 ? `VERIFY.todo.${shard}.json` : "VERIFY.todo.json";
    const planted = todo.planted ?? 0;
    const hp = honeypots ? ` (incl. ${planted} honeypot(s))` : "";
    console.log(`ultraeval verify: ${todo.pairs.length} pair(s)${hp} -> ${run2}/${todoName} (fill verdicts, then --apply <file>)`);
    if (honeypots && planted < honeypots)
      console.log(
        planted === 0 ? "  ! 0 planted \u2014 run too small for honeypots (need >= 2 gradeable pairs across distinct findings); skeptic-QC will not run" : `  ! only ${planted}/${honeypots} honeypot(s) planted \u2014 cross-pair pool exhausted; skeptic-QC is thinner than requested`
      );
  }
}
function cmdBacklog(args2) {
  const run2 = str2(args2.run);
  if (!run2) throw new Error("backlog requires --run <run>");
  const bl = buildBacklog(run2, { tdd: !!args2.tdd, out: str2(args2.out) });
  console.log(`ultraeval backlog: ${bl.tasks.length} fix task(s)${args2.tdd ? " + TDD cards" : ""} -> ${str2(args2.out) ?? run2}`);
}
function cmdStatus(args2) {
  const run2 = str2(args2.run);
  if (!run2) throw new Error("status requires --run <run>");
  const s = statusRun(run2);
  console.log(args2.json ? JSON.stringify(s, null, 2) : formatStatus(s, run2));
}
function cmdScore(args2) {
  const run2 = str2(args2.run);
  if (!run2) throw new Error("score requires --run <run>");
  const sc = scoreRun(run2);
  console.log(args2.json ? JSON.stringify(sc, null, 2) : formatScore(sc));
  if (args2.history !== void 0) {
    const file = typeof args2.history === "string" && args2.history !== "" ? args2.history : defaultLedgerPath(run2);
    appendHistory(run2, file);
    (args2.json ? console.error : console.log)(`ultraeval score: history entry appended -> ${file}`);
  }
}
function cmdHistory(args2) {
  const run2 = str2(args2.run);
  const explicit = str2(args2.file) || args2._[1];
  const file = explicit || (run2 ? defaultLedgerPath(run2) : void 0);
  if (!file) throw new Error("history requires a ledger path, --file <f>, or --run <run> (to locate the default ledger)");
  const entries = readHistory(file);
  if (args2.json) {
    console.log(JSON.stringify(entries, null, 2));
    return;
  }
  console.log(
    entries.length ? formatHistory(entries, file) : `ultraeval history: no ledger entries at ${file} \u2014 run \`score --run <run> --history\` to record a trend`
  );
}
function cmdFix(args2) {
  const run2 = str2(args2.run);
  if (!run2) throw new Error("fix requires --run <run>");
  const engine = fileURLToPath2(import.meta.url);
  const written = emitFixAgents(run2, engine, { task: str2(args2.task), workflow: !!args2.workflow });
  console.log(`ultraeval fix: ${written.length} file(s) -> ${run2}/fixes/agents (dispatch each *.agent.md to an autonomous fix agent)`);
}
function cmdVerifyFix(args2) {
  const run2 = str2(args2.run);
  const task = str2(args2.task);
  if (!run2 || !task) throw new Error("verify-fix requires --run <run> and --task FIX-XXX");
  const res = verifyFix(run2, task);
  console.log(formatVerifyFix(res));
  process.exitCode = res.ok ? 0 : 1;
}
function cmdRejudge(args2) {
  const run2 = str2(args2.run);
  const out2 = str2(args2.out);
  if (!run2 || !out2) throw new Error("rejudge requires --run <run> and --out <run2>");
  const engine = fileURLToPath2(import.meta.url);
  const copied = rejudgeRun(run2, out2, engine);
  console.log(`ultraeval rejudge: ${copied.length} artifact(s) reused, fresh judges.jsonl -> ${out2}`);
  console.log(`  launch ${out2}/rejudge.workflow.mjs, then: score --run ${out2} && compare --run ${out2} --base ${run2}`);
}
function cmdRender(args2) {
  const run2 = str2(args2.run);
  if (!run2) throw new Error("render requires --run <run>");
  const written = render(run2, { out: str2(args2.out), html: !args2["no-html"], md: !args2["no-md"] });
  if (args2.sarif) written.push(writeSarif(run2, str2(args2.out)));
  console.log(`ultraeval render:
${written.map((w) => `  ${w}`).join("\n")}`);
}
function cmdClean(args2) {
  const run2 = str2(args2.run);
  if (!run2) throw new Error("clean requires --run <run>");
  const removed = clean(run2, { all: !!args2.all });
  console.log(removed.length ? `ultraeval clean: removed
${removed.map((w) => `  ${w}`).join("\n")}` : "ultraeval clean: nothing to remove");
}
var commandHandlers = {
  init: cmdInit,
  oneshot: cmdOneshot,
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
  clean: cmdClean
};
function main() {
  const args2 = parse(process.argv.slice(2));
  const cmd = args2._[0];
  if (args2.version || cmd === "version") {
    console.log(VERSION);
    return;
  }
  if (args2.help || cmd === "help") {
    console.log(HELP2);
    return;
  }
  if (!cmd) {
    console.error(HELP2);
    process.exitCode = 2;
    return;
  }
  try {
    rejectUnknownFlags(cmd, args2);
    const handler = commandHandlers[cmd];
    if (!handler) {
      console.error(`unknown command: ${cmd}

${HELP2}`);
      process.exitCode = 2;
      return;
    }
    handler(args2, cmd);
  } catch (e) {
    console.error(`ultraeval ${cmd}: ${e.message}`);
    process.exitCode = 2;
  }
}
function isEntrypoint() {
  try {
    return import.meta.url === pathToFileURL(realpathSync3(process.argv[1] ?? "")).href;
  } catch {
    return false;
  }
}
if (isEntrypoint()) main();
export {
  commandHandlers
};
// "Copyright" and "@license" are already caught by DIRECTIVE_RE.
