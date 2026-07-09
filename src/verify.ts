import { isAbsolute, join, resolve } from "node:path";
import { CAPS, VALID_VERDICTS } from "./types.js";
import type { EvalConfig, Finding, FindingsDoc, Verdict, VerdictItem, VerdictsFile, VerifyPair, VerifyResult, VerifyTodo } from "./types.js";
import { exists, extractContext, readJson, resolveEvidence, resolveTargetAbs, SEV_ORDER, writeJson, writeText } from "./util.js";

export interface VerifyOpts {
  maxVerify?: number;
  shards?: number;
  shard?: number;
}

// Phase A — build the claim<->evidence worklist a skeptic fills in.
export function buildWorklist(runDir: string, maxVerify: number = CAPS.maxVerify): VerifyTodo {
  const cfg = readJson<EvalConfig>(join(runDir, "eval.config.json"));
  const doc = readJson<FindingsDoc>(join(runDir, "findings.json"));
  const findings = (doc.findings ?? []).filter((f) => f.status !== "dismissed").sort((a, b) => (SEV_ORDER[a.severity] ?? 9) - (SEV_ORDER[b.severity] ?? 9));
  const pairs: VerifyPair[] = [];
  const resolveOpts = { targetAbs: resolveTargetAbs(cfg.targetAbs, cfg.target, runDir), runDir };
  for (const f of findings) {
    for (const e of f.evidence ?? []) {
      if (pairs.length >= maxVerify) break;
      const r = resolveEvidence(e.ref, resolveOpts);
      if (!r.gradeable) continue; // url/external refs are not adversarially graded offline
      const digest = r.resolved && r.absPath ? extractContext(r.absPath, r.lineStart, r.lineEnd) : `(unresolved: ${r.reason})`;
      pairs.push({ claimId: f.id, evidenceRef: e.ref, claim: f.statement, digest, verdict: null, note: "" });
    }
  }
  return { run: runDir, pairs };
}

export function runVerify(runDir: string, opts: VerifyOpts = {}): VerifyTodo {
  const full = buildWorklist(runDir, opts.maxVerify);
  let pairs = full.pairs;
  if (opts.shards && opts.shard !== undefined) pairs = pairs.filter((_, i) => i % (opts.shards as number) === opts.shard);
  const out: VerifyTodo = { run: runDir, pairs };
  const sh = opts.shards !== undefined && opts.shard !== undefined;
  writeJson(join(runDir, sh ? `VERIFY.todo.${opts.shard}.json` : "VERIFY.todo.json"), out);
  writeText(join(runDir, sh ? `VERIFY.${opts.shard}.md` : "VERIFY.md"), renderWorklistMd(out));
  return out;
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
    const data = readJson<VerdictsFile | VerdictItem[]>(p);
    const items = Array.isArray(data) ? data : (data.pairs ?? []);
    for (const v of items) merged.set(`${v.claimId}␟${v.evidenceRef ?? ""}`, v);
  }
  return [...merged.values()];
}

export function applyVerdicts(runDir: string, spec: string): VerifyResult {
  const doc = readJson<FindingsDoc>(join(runDir, "findings.json"));
  const result = reduceVerdicts(loadVerdicts(runDir, spec), doc.findings ?? []);
  writeJson(join(runDir, "VERIFY.json"), result);
  return result;
}

export function formatVerifyReport(r: VerifyResult): string {
  const head = r.ok ? "PASS" : "FAIL";
  return [
    `${head}  ${r.adjudicated} adjudicated · ${r.supported} supported · ${r.partial} partial · ${r.refuted} refuted · ${r.unsupported} unsupported`,
    ...r.failures.map((f) => `  ✗ ${f} not supported by its evidence`),
    ...r.unadjudicated.map((f) => `  ! ${f} still unadjudicated`),
  ].join("\n");
}
