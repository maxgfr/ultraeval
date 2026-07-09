import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { extractUnits, findingRefs, isCited } from "./citations.js";
import { dimensionsHash } from "./init.js";
import { CAPS, VALID_EFFORT, VALID_IMPACT, VALID_SEVERITIES } from "./types.js";
import type { CheckResult, Effort, EvalConfig, FindingsDoc, Impact, Severity, VerifyResult } from "./types.js";
import { exists, parseEvidenceRef, readJson, readText, resolveEvidence, resolveTargetAbs } from "./util.js";

export interface CheckOpts {
  semantic?: boolean;
  requireVerify?: boolean;
  minFindings?: number;
  strict?: boolean;
  coverageMin?: number;
  // Diff-scoped (init --since) runs only WARN on out-of-scope citations by
  // default; --strict-scope promotes that to a gate failure so a PR eval that
  // cites only unchanged files goes red. Opt-in — default behavior is unchanged.
  strictScope?: boolean;
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
    // A malformed core artifact is a usage/runtime error (exit 2), not a gate verdict.
    errors.push("eval.config.json is not valid JSON");
    return { ok: false, errors, warnings, usageError: true };
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
    // A malformed core artifact is a usage/runtime error (exit 2), not a gate verdict.
    errors.push("findings.json is not valid JSON");
    return { ok: false, errors, warnings, usageError: true };
  }
  const findings = Array.isArray(doc.findings) ? doc.findings : [];
  const ids = new Set(findings.map((f) => f.id));

  // 0. Findings-record schema integrity (shape, not grounding).
  const STATUSES = ["open", "confirmed", "dismissed"];
  const seenIds = new Set<string>();
  for (const f of findings) {
    const fid = typeof f.id === "string" ? f.id : "?";
    if (!/^F\d+$/.test(fid)) errors.push(`finding id "${fid}" must match F<number>`);
    else if (seenIds.has(fid)) errors.push(`duplicate finding id ${fid}`);
    seenIds.add(fid);
    if (!VALID_SEVERITIES.includes(f.severity as Severity)) errors.push(`${fid} has invalid severity "${f.severity}" (expected P0|P1|P2)`);
    if (!STATUSES.includes(f.status as string)) errors.push(`${fid} has invalid status "${f.status}" (expected open|confirmed|dismissed)`);
    if (!f.title || !f.statement) errors.push(`${fid} is missing a title or statement`);
    if (!Array.isArray(f.evidence)) errors.push(`${fid} has no evidence array`);
    if (f.kind !== undefined && f.kind !== "defect" && f.kind !== "opportunity")
      errors.push(`${fid} has invalid kind "${f.kind}" (expected defect|opportunity)`);
    if (f.kind === "opportunity") {
      if (!VALID_IMPACT.includes(f.impact as Impact)) errors.push(`${fid} (opportunity) needs impact high|med|low`);
      if (!VALID_EFFORT.includes(f.effort as Effort)) errors.push(`${fid} (opportunity) needs effort S|M|L`);
    }
  }

  if (opts.minFindings && findings.length < opts.minFindings) {
    errors.push(`only ${findings.length} finding(s) recorded; --min-findings ${opts.minFindings} required`);
  }

  // 1. Resolve every non-dismissed finding's evidence against the target/run.
  //    This is the core anti-hallucination guarantee. A run-scoped line cache
  //    reads each cited file once even when many findings cite the same hotspot.
  const resolveOpts = { targetAbs: resolveTargetAbs(cfg.targetAbs, cfg.target, runDir), runDir, lineCache: new Map() };
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
    if (!anyResolved) errors.push(`${f.id} has no resolvable evidence — a finding must point at a real file:line (or run: artifact)`);
    // Evidence-laundering guard: a run log the eval wrote itself cannot be the
    // ONLY grounding — every finding must also anchor to the target.
    else if (!anyTargetAnchored)
      errors.push(`${f.id} is grounded only in the run's own artifacts — cite at least one target file[:line] alongside the run: log`);
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
      const bl = readJson<{ tasks?: { id: string; findingId: string; status?: string }[] }>(backlogPath);
      for (const t of bl.tasks ?? []) {
        const f = findings.find((x) => x.id === t.findingId);
        if (!f) errors.push(`BACKLOG ${t.id} references ${t.findingId} which is not a finding`);
        else if (f.status === "dismissed") errors.push(`BACKLOG ${t.id} references dismissed finding ${t.findingId}`);
        else if (t.status === "done" && f.status === "open")
          warnings.push(`BACKLOG ${t.id} is done but finding ${t.findingId} is still open — adjudicate the finding or reopen the task`);
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
        if (v.honeypots?.failed?.length)
          errors.push(
            `--require-verify: ${v.honeypots.failed.length} honeypot(s) graded supported (${v.honeypots.failed.join(", ")}) — the skeptic rubber-stamped; re-verify with a fresh skeptic`,
          );
        // Partial adjudication is not adjudication: every emitted pair must have
        // a verdict, or the unverified findings would sail through the exit gate.
        const pending = (v.unadjudicated ?? []).filter((fid) => {
          const f = findings.find((x) => x.id === fid);
          return f && f.status !== "dismissed";
        });
        if (pending.length) errors.push(`--require-verify: ${pending.length} finding(s) still unadjudicated (${pending.join(", ")}) — grade every verify pair`);
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

  // 4bis. Diff scope (init --since): a finding citing only files unchanged since
  // the ref is out of scope for a PR-gating run — warn, never fail (guarded git).
  const sinceRef = cfg.provenance?.sinceRef;
  if (sinceRef) {
    const targetAbs = resolveTargetAbs(cfg.targetAbs, cfg.target, runDir);
    let changed: Set<string> | null = null;
    try {
      changed = new Set(
        execFileSync("git", ["-C", targetAbs, "diff", "--name-only", sinceRef], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })
          .split("\n")
          .map((l) => l.trim())
          .filter(Boolean),
      );
    } catch {
      warnings.push(`diff scope: could not resolve ${sinceRef} in the target — out-of-scope findings not checked`);
    }
    if (changed) {
      for (const f of findings) {
        if (f.status === "dismissed") continue;
        const files = (f.evidence ?? [])
          .map((e) => parseEvidenceRef(e.ref))
          .filter((p) => p.isTargetRef) // only target-repo paths — run:/url: refs are out of diff scope
          .map((p) => p.path);
        if (files.length && !files.some((x) => changed.has(x))) {
          const msg = `${f.id} cites only files unchanged since ${sinceRef} (${files.join(", ")}) — outside the diff scope of this run`;
          // --strict-scope hard-fails a PR gate on an out-of-scope finding.
          (opts.strictScope ? errors : warnings).push(msg);
        }
      }
    }
  }

  // 5. Soft guidance — never fails the gate.
  for (const f of findings) {
    if (f.status === "dismissed") continue;
    if (f.status === "open") warnings.push(`${f.id} is still "open" — adjudicate it (confirmed/dismissed) before backlog`);
    if (f.status === "confirmed" && !f.recommendation) warnings.push(`${f.id} is confirmed but has no recommendation — its backlog card will be vague`);
  }
  if (exists(join(runDir, "RESULTS.md")) && !exists(join(runDir, "SUMMARY.md"))) warnings.push("RESULTS.md present but no SUMMARY.md");
  // A budgeted run recorded coverage cuts — the summary must own them.
  if (exists(join(runDir, "runs", "budget.md"))) {
    const summaryPath = join(runDir, "SUMMARY.md");
    if (!exists(summaryPath) || !/budget/i.test(readText(summaryPath)))
      warnings.push("runs/budget.md records coverage cuts but SUMMARY.md does not mention them — report every cut in the summary");
  }
  if (!cfg.provenance) warnings.push("legacy run (pre-protocol) — no provenance recorded; re-init to stamp engine/protocol/rubric versions");
  // The dimensionsHash is stamped at init but was never re-validated by any
  // consumer. Recompute it from the live dimensions; a mismatch means the rubric
  // was refined after init. This is only ever a WARNING — the protocol EXPECTS
  // the research stage to refine dimensions — but it makes that refinement
  // visible in the audit trail. Skipped on a legacy run (no hash recorded).
  const stampedHash = cfg.provenance?.dimensionsHash;
  if (stampedHash) {
    const currentHash = dimensionsHash(cfg.dimensions ?? []);
    if (currentHash !== stampedHash)
      warnings.push(
        `dimensions changed since init (recorded hash ${stampedHash} → current ${currentHash}) — the rubric was refined after init; expected per protocol, recorded here for the audit trail`,
      );
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
