import { readdirSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { CAPS, VALID_VERDICTS } from "./types.js";
import type { EvalConfig, Finding, FindingsDoc, Verdict, VerdictItem, VerdictsFile, VerifyPair, VerifyResult, VerifyTodo } from "./types.js";
import { exists, extractContext, parseEvidenceRef, readJson, resolveEvidence, resolveTargetAbs, SEV_ORDER, writeJson, writeText } from "./util.js";

export interface VerifyOpts {
  maxVerify?: number;
  shards?: number;
  shard?: number;
  honeypots?: number;
}

// Deterministic PRNG — honeypot planting must reproduce byte-identically from
// the run's provenance (no Math.random: a re-run is a re-audit, not a reshuffle).
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Phase A — build the claim<->evidence worklist a skeptic fills in.
export function buildWorklist(runDir: string, maxVerify: number = CAPS.maxVerify): VerifyTodo {
  const cfg = readJson<EvalConfig>(join(runDir, "eval.config.json"));
  const doc = readJson<FindingsDoc>(join(runDir, "findings.json"));
  const findings = (doc.findings ?? []).filter((f) => f.status !== "dismissed").sort((a, b) => (SEV_ORDER[a.severity] ?? 9) - (SEV_ORDER[b.severity] ?? 9));
  const pairs: VerifyPair[] = [];
  // One run-scoped read cache shared by resolveEvidence (range-check) and
  // extractContext (digest) so each cited file is read once per worklist build.
  const resolveOpts = { targetAbs: resolveTargetAbs(cfg.targetAbs, cfg.target, runDir), runDir, lineCache: new Map() };
  for (const f of findings) {
    for (const e of f.evidence ?? []) {
      if (pairs.length >= maxVerify) break;
      const r = resolveEvidence(e.ref, resolveOpts);
      if (!r.gradeable) continue; // url/external refs are not adversarially graded offline
      const digest = r.resolved && r.absPath ? extractContext(r.absPath, r.lineStart, r.lineEnd, 2, resolveOpts.lineCache) : `(unresolved: ${r.reason})`;
      pairs.push({ claimId: f.id, evidenceRef: e.ref, claim: f.statement, digest, verdict: null, note: "" });
    }
  }
  return { run: runDir, pairs };
}

export function runVerify(runDir: string, opts: VerifyOpts = {}): VerifyTodo {
  const full = buildWorklist(runDir, opts.maxVerify);
  let pairs = full.pairs;
  if (opts.shards && opts.shard !== undefined) pairs = pairs.filter((_, i) => i % (opts.shards as number) === opts.shard);
  const sh = opts.shards !== undefined && opts.shard !== undefined;
  let planted: number | undefined;
  if (opts.honeypots && opts.honeypots > 0) {
    const h = plantHoneypots(runDir, pairs, opts.honeypots, opts.shard);
    pairs = h.pairs;
    planted = h.planted; // may be < requested (or 0) when the run is too small to cross-pair
  }
  const out: VerifyTodo = { run: runDir, pairs };
  writeJson(join(runDir, sh ? `VERIFY.todo.${opts.shard}.json` : "VERIFY.todo.json"), out);
  writeText(join(runDir, sh ? `VERIFY.${opts.shard}.md` : "VERIFY.md"), renderWorklistMd(out));
  // Surface the honeypot count to the caller AFTER writing — the on-disk
  // worklist stays a clean { run, pairs } the skeptic fills in.
  if (planted !== undefined) out.planted = planted;
  return out;
}

// Fabricate N trap pairs — one finding's claim glued to ANOTHER finding's
// evidence digest (preferring a different file). The correct verdict is always
// unsupported/refuted; a skeptic who grades one `supported` is rubber-stamping.
// Ground truth goes to VERIFY.honeypots(.<shard>).json — NEVER into a prompt.
function plantHoneypots(runDir: string, pairs: VerifyPair[], n: number, shard?: number): { pairs: VerifyPair[]; planted: number } {
  if (pairs.length < 2) return { pairs, planted: 0 }; // nothing to cross-pair against
  const cfg = readJson<EvalConfig>(join(runDir, "eval.config.json"));
  const doc = readJson<FindingsDoc>(join(runDir, "findings.json"));
  const seedHex = cfg.provenance?.dimensionsHash ?? "0";
  const rng = mulberry32((Number.parseInt(seedHex.slice(0, 8), 16) || 1) + (shard ?? 0));
  let maxN = 0;
  for (const f of doc.findings ?? []) {
    const m = /^F(\d+)$/.exec(f.id);
    if (m?.[1]) maxN = Math.max(maxN, Number(m[1]));
  }
  const offset = (shard ?? 0) * n;
  // Whole-ref path key (scheme intact, :line stripped) — two pairs share a file
  // when these match; a trap prefers a different file. See parseEvidenceRef.
  const pathOf = (ref: string) => parseEvidenceRef(ref).rawPath;
  const real = [...pairs];
  const traps: VerifyPair[] = [];
  for (let k = 0; k < n; k++) {
    const a = real[Math.floor(rng() * real.length)] as VerifyPair;
    // Cross-finding ONLY: a trap must never borrow the claim's own sibling
    // evidence (a multi-file finding's other ref genuinely supports the claim).
    const others = real.filter((p) => p.claimId !== a.claimId);
    const elsewhere = others.filter((p) => pathOf(p.evidenceRef) !== pathOf(a.evidenceRef));
    const pool = elsewhere.length ? elsewhere : others;
    if (!pool.length) break;
    const b = pool[Math.floor(rng() * pool.length)] as VerifyPair;
    traps.push({ claimId: `F${maxN + offset + k + 1}`, evidenceRef: b.evidenceRef, claim: a.claim, digest: b.digest, verdict: null, note: "" });
  }
  const mixed = [...pairs];
  for (const t of traps) mixed.splice(Math.floor(rng() * (mixed.length + 1)), 0, t);
  // Only stamp ground truth when traps were actually planted — an empty file
  // would masquerade as skeptic-QC coverage that never ran.
  if (traps.length) {
    const truthName = shard !== undefined ? `VERIFY.honeypots.${shard}.json` : "VERIFY.honeypots.json";
    writeJson(join(runDir, truthName), {
      note: "ground truth for planted honeypot pairs — never paste this file into a skeptic prompt",
      claimIds: traps.map((t) => t.claimId),
    });
  }
  return { pairs: mixed, planted: traps.length };
}

// Union of the unsharded + sharded ground-truth files.
function loadHoneypotIds(runDir: string): Set<string> {
  const ids = new Set<string>();
  const files = [join(runDir, "VERIFY.honeypots.json")];
  if (exists(runDir)) for (const e of readdirSync(runDir)) if (/^VERIFY\.honeypots\.\d+\.json$/.test(e)) files.push(join(runDir, e));
  for (const f of files) {
    if (!exists(f)) continue;
    for (const id of readJson<{ claimIds?: string[] }>(f).claimIds ?? []) ids.add(id);
  }
  return ids;
}

function renderWorklistMd(todo: VerifyTodo): string {
  const lines = [
    "# Verification worklist",
    "",
    "For each pair: read the digest, judge whether it SUPPORTS the finding, write a verdict.",
    "Verdicts: `supported` · `partial` · `refuted` · `unsupported`.",
    "",
  ];
  for (const p of todo.pairs) {
    lines.push(`## ${p.claimId} · ${p.evidenceRef}`);
    lines.push(`**Finding:** ${p.claim}`);
    lines.push("```", p.digest, "```");
    lines.push("**Verdict:** ______  ·  **Note:** ______", "");
  }
  return `${lines.join("\n")}\n`;
}

// Phase B — reduce filled verdicts to a pass/fail ledger.
export function reduceVerdicts(verdicts: VerdictItem[], findings: Finding[]): VerifyResult {
  const nonDismissed = (findings ?? []).filter((f) => f.status !== "dismissed").map((f) => f.id);
  const clean = (verdicts ?? []).filter((v) => v && VALID_VERDICTS.includes(v.verdict as Verdict));
  const byFinding = new Map<string, VerdictItem[]>();
  for (const v of clean) {
    const arr = byFinding.get(v.claimId) ?? [];
    arr.push(v);
    byFinding.set(v.claimId, arr);
  }
  let supported = 0;
  let partial = 0;
  let refuted = 0;
  let unsupported = 0;
  for (const v of clean) {
    if (v.verdict === "supported") supported++;
    else if (v.verdict === "partial") partial++;
    else if (v.verdict === "refuted") refuted++;
    else unsupported++;
  }
  const failures: string[] = [];
  for (const [fid, vs] of byFinding) {
    const anyRefuted = vs.some((v) => v.verdict === "refuted");
    const anySupport = vs.some((v) => v.verdict === "supported" || v.verdict === "partial");
    if (anyRefuted || !anySupport) failures.push(fid);
  }
  const unadjudicated = nonDismissed.filter((id) => !byFinding.has(id));
  return { ok: failures.length === 0, adjudicated: clean.length, supported, partial, refuted, unsupported, failures, unadjudicated, verdicts: clean };
}

function loadVerdicts(runDir: string, spec: string): VerdictItem[] {
  const files = spec.includes(",") ? spec.split(",").map((s) => s.trim()) : [spec];
  const merged = new Map<string, VerdictItem>();
  for (const f of files) {
    // Resolve as given (cwd) first, else relative to the run dir — so `--apply
    // verdicts.json` works whether the file sits in cwd or inside the run.
    const p = exists(f) ? f : isAbsolute(f) ? f : resolve(runDir, f);
    if (!exists(p)) throw new Error(`verdicts file not found: ${p} — pass the filled VERIFY.todo.json or a {"pairs":[...]} file`);
    const data = readJson<VerdictsFile | VerdictItem[]>(p);
    const items = Array.isArray(data) ? data : (data.pairs ?? []);
    for (const v of items) merged.set(`${v.claimId}␟${v.evidenceRef ?? ""}`, v);
  }
  return [...merged.values()];
}

export function applyVerdicts(runDir: string, spec: string): VerifyResult {
  const doc = readJson<FindingsDoc>(join(runDir, "findings.json"));
  const all = loadVerdicts(runDir, spec);
  const trapIds = loadHoneypotIds(runDir);
  // Honeypot verdicts never reach the findings ledger — they grade the skeptic.
  const result = reduceVerdicts(
    all.filter((v) => !trapIds.has(v.claimId)),
    doc.findings ?? [],
  );
  if (trapIds.size) {
    const graded = all.filter((v) => trapIds.has(v.claimId) && VALID_VERDICTS.includes(v.verdict as Verdict));
    const failed = [...new Set(graded.filter((v) => v.verdict === "supported" || v.verdict === "partial").map((v) => v.claimId))];
    const caught = new Set(graded.filter((v) => v.verdict === "refuted" || v.verdict === "unsupported").map((v) => v.claimId));
    for (const id of failed) caught.delete(id); // any supported grade on a trap is a failure
    result.honeypots = { planted: trapIds.size, caught: caught.size, failed };
    if (failed.length) result.ok = false;
  }
  writeJson(join(runDir, "VERIFY.json"), result);
  return result;
}

export function formatVerifyReport(r: VerifyResult): string {
  const head = r.ok ? "PASS" : "FAIL";
  return [
    `${head}  ${r.adjudicated} adjudicated · ${r.supported} supported · ${r.partial} partial · ${r.refuted} refuted · ${r.unsupported} unsupported`,
    ...(r.honeypots ? [`  honeypots: ${r.honeypots.caught}/${r.honeypots.planted} caught`] : []),
    ...(r.honeypots?.failed ?? []).map((f) => `  ✗ honeypot ${f} graded supported — the skeptic is rubber-stamping; re-verify with a fresh skeptic`),
    ...r.failures.map((f) => `  ✗ ${f} not supported by its evidence`),
    ...r.unadjudicated.map((f) => `  ! ${f} still unadjudicated`),
  ].join("\n");
}
