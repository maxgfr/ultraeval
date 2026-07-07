import { join } from "node:path";
import { extractUnits, findingRefs, isCited } from "./citations.js";
import { CAPS } from "./types.js";
import type { CheckResult, EvalConfig, FindingsDoc, VerifyResult } from "./types.js";
import { exists, readJson, readText, resolveEvidence, resolveTargetAbs } from "./util.js";

export interface CheckOpts {
  semantic?: boolean;
  requireVerify?: boolean;
  minFindings?: number;
  strict?: boolean;
  coverageMin?: number;
}

// RESULTS.md is hard-checked (every substantive claim must cite); SUMMARY.md is
// lenient (a dangling [F#] still fails, but coverage is not gated).
const HARD_FILES = ["RESULTS.md"];
const SOFT_FILES = ["SUMMARY.md"];

export function checkRun(runDir: string, opts: CheckOpts = {}): CheckResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const cfgPath = join(runDir, "eval.config.json");
  if (!exists(cfgPath)) {
    errors.push("no eval.config.json — run `ultraeval init` first");
    return { ok: false, errors, warnings };
  }
  let cfg: EvalConfig;
  try {
    cfg = readJson<EvalConfig>(cfgPath);
  } catch {
    errors.push("eval.config.json is not valid JSON");
    return { ok: false, errors, warnings };
  }

  const findingsPath = join(runDir, "findings.json");
  if (!exists(findingsPath)) {
    errors.push("no findings.json — the eval produced no findings record");
    return { ok: false, errors, warnings };
  }
  let doc: FindingsDoc;
  try {
    doc = readJson<FindingsDoc>(findingsPath);
  } catch {
    errors.push("findings.json is not valid JSON");
    return { ok: false, errors, warnings };
  }
  const findings = Array.isArray(doc.findings) ? doc.findings : [];
  const ids = new Set(findings.map((f) => f.id));

  if (opts.minFindings && findings.length < opts.minFindings) {
    errors.push(`only ${findings.length} finding(s) recorded; --min-findings ${opts.minFindings} required`);
  }

  // 1. Resolve every non-dismissed finding's evidence against the target/run.
  //    This is the core anti-hallucination guarantee.
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
    if (!anyResolved) errors.push(`${f.id} has no resolvable evidence — a finding must point at a real file:line (or run: artifact)`);
  }

  // 2. Report files: a dangling [F#] always fails; coverage gates the HARD file.
  const coverageMin = opts.strict ? CAPS.coverageStrict : (opts.coverageMin ?? CAPS.coverageMin);
  for (const file of [...HARD_FILES, ...SOFT_FILES]) {
    const p = join(runDir, file);
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
            `${file} citation coverage ${(ratio * 100).toFixed(0)}% < ${(coverageMin * 100).toFixed(0)}% — cite findings [F#]/[file:line] or flag narrative with [M]`,
          );
      }
    }
  }

  // 3. Backlog integrity: every task must reference a live (non-dismissed) finding.
  const backlogPath = join(runDir, "BACKLOG.json");
  if (exists(backlogPath)) {
    try {
      const bl = readJson<{ tasks?: { id: string; findingId: string }[] }>(backlogPath);
      for (const t of bl.tasks ?? []) {
        const f = findings.find((x) => x.id === t.findingId);
        if (!f) errors.push(`BACKLOG ${t.id} references ${t.findingId} which is not a finding`);
        else if (f.status === "dismissed") errors.push(`BACKLOG ${t.id} references dismissed finding ${t.findingId}`);
      }
    } catch {
      errors.push("BACKLOG.json is not valid JSON");
    }
  }

  // 4. Semantic fold (opt-in). Additive — can only ADD failures.
  const verifyPath = join(runDir, "VERIFY.json");
  if (opts.requireVerify) {
    if (!exists(verifyPath)) errors.push("--require-verify: no VERIFY.json — run `ultraeval verify --apply <verdicts>`");
    else {
      try {
        const v = readJson<VerifyResult>(verifyPath);
        if (!v.adjudicated) errors.push("--require-verify: VERIFY.json has no adjudicated verdicts");
      } catch {
        errors.push("--require-verify: VERIFY.json is not valid JSON");
      }
    }
  }
  if (opts.semantic && exists(verifyPath)) {
    try {
      const v = readJson<VerifyResult>(verifyPath);
      for (const fid of v.failures ?? []) {
        const f = findings.find((x) => x.id === fid);
        if (f && f.status !== "dismissed")
          errors.push(`--semantic: ${fid} was refuted/unsupported by verification but is still "${f.status}" — dismiss it or fix the claim`);
      }
    } catch {
      errors.push("--semantic: VERIFY.json is not valid JSON");
    }
  }

  return { ok: errors.length === 0, errors, warnings };
}

export function formatCheckReport(r: CheckResult, runDir: string): string {
  const lines = [r.ok ? `PASS  ${runDir}` : `FAIL  ${runDir}`];
  for (const e of r.errors) lines.push(`  ✗ ${e}`);
  for (const w of r.warnings) lines.push(`  ! ${w}`);
  if (r.ok && !r.warnings.length) lines.push("  every finding is grounded in the target.");
  return lines.join("\n");
}
