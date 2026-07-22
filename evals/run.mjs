#!/usr/bin/env node
// Zero-dep eval harness: drive the SHIPPED bundle through a RED/GREEN gate probe
// (a doctored artifact must fail, a genuine one must pass — proven end-to-end,
// not just in unit tests) plus a backlog probe. Mirrors ultrasearch/evals.
// Runs offline. `pnpm run eval`. Exit non-zero on any probe failure (gates CI).
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BUNDLE = join(ROOT, "scripts", "ultraeval.mjs");
const SAMPLE = join(ROOT, "tests", "fixtures", "sample-run");

let failures = 0;
const pass = (m) => console.log(`  ok   ${m}`);
const fail = (m) => {
  failures++;
  console.log(`  FAIL ${m}`);
};
const run = (args, cwd) => spawnSync("node", [BUNDLE, ...args], { encoding: "utf8", cwd: cwd ?? ROOT });

if (!existsSync(BUNDLE)) {
  console.error("bundle missing — run `pnpm run build` first");
  process.exit(1);
}

function writeProbeVerdicts(dir, verdict) {
  const todo = JSON.parse(readFileSync(join(dir, "VERIFY.todo.json"), "utf8"));
  const pairs = todo.pairs.map((p) => ({ claimId: p.claimId, evidenceRef: p.evidenceRef, verdict, note: "eval probe" }));
  writeFileSync(join(dir, "verdicts.probe.json"), JSON.stringify({ pairs }));
}

// The core RED/GREEN gate probe.
function gateProbe() {
  const dir = mkdtempSync(join(tmpdir(), "ue-eval-"));
  try {
    cpSync(SAMPLE, dir, { recursive: true });

    if (run(["check", "--run", dir]).status !== 0) return fail("[gate] genuine findings failed check");
    pass("[gate] genuine findings pass check (exit 0)");

    // RED (structural): doctor a citation to a non-existent line.
    const fp = join(dir, "findings.json");
    const doc = JSON.parse(readFileSync(fp, "utf8"));
    const original = doc.findings[0].evidence[0].ref;
    doc.findings[0].evidence[0].ref = "app.js:99999";
    writeFileSync(fp, JSON.stringify(doc));
    if (run(["check", "--run", dir]).status === 0) return fail("[gate] doctored line slipped through check");
    pass("[gate] doctored citation fails check (exit 1)");
    doc.findings[0].evidence[0].ref = original;
    writeFileSync(fp, JSON.stringify(doc));

    // --require-verify must fire before adjudication.
    if (run(["check", "--run", dir, "--semantic", "--require-verify"]).status === 0) return fail("[gate] --require-verify passed with no VERIFY.json");
    pass("[gate] --require-verify fails without VERIFY.json");

    run(["verify", "--run", dir]); // build the worklist

    // RED (semantic): a refuted verdict must fail both apply and check --semantic.
    writeProbeVerdicts(dir, "refuted");
    const redApply = run(["verify", "--run", dir, "--apply", join(dir, "verdicts.probe.json")]);
    const redCheck = run(["check", "--run", dir, "--semantic"]);
    if (redApply.status === 0 || redCheck.status === 0) return fail("[gate] a refuted finding slipped the semantic gate");
    pass("[gate] RED refuted verdict fails verify + check --semantic");

    // GREEN (semantic): a supported+adjudicated verdict must pass.
    writeProbeVerdicts(dir, "supported");
    const greenApply = run(["verify", "--run", dir, "--apply", join(dir, "verdicts.probe.json")]);
    const greenCheck = run(["check", "--run", dir, "--semantic", "--require-verify"]);
    if (greenApply.status !== 0 || greenCheck.status !== 0) return fail("[gate] a supported+adjudicated finding was rejected");
    pass("[gate] GREEN supported verdict passes verify + check --semantic --require-verify");
  } catch (e) {
    fail(`[gate] ${e.message}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// The backlog probe — confirmed findings become TDD cards.
function backlogProbe() {
  const dir = mkdtempSync(join(tmpdir(), "ue-eval-bl-"));
  try {
    cpSync(SAMPLE, dir, { recursive: true });
    if (run(["backlog", "--run", dir, "--tdd"]).status !== 0) return fail("[backlog] command failed");
    if (!existsSync(join(dir, "BACKLOG.json"))) return fail("[backlog] no BACKLOG.json");
    const bl = JSON.parse(readFileSync(join(dir, "BACKLOG.json"), "utf8"));
    if (bl.tasks.length !== 2) return fail(`[backlog] expected 2 tasks, got ${bl.tasks.length}`);
    if (!existsSync(join(dir, "fixes"))) return fail("[backlog] no fixes/ cards");
    pass("[backlog] emits BACKLOG.json + TDD cards from confirmed findings");
  } catch (e) {
    fail(`[backlog] ${e.message}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// A malformed findings record must fail the gate on shape, not just grounding.
function schemaProbe() {
  const dir = mkdtempSync(join(tmpdir(), "ue-eval-schema-"));
  try {
    cpSync(SAMPLE, dir, { recursive: true });
    const fp = join(dir, "findings.json");
    const doc = JSON.parse(readFileSync(fp, "utf8"));
    doc.findings[0].severity = "critical"; // not P0/P1/P2
    writeFileSync(fp, JSON.stringify(doc));
    if (run(["check", "--run", dir]).status === 0) return fail("[schema] an invalid severity slipped through check");
    pass("[schema] check rejects an invalid severity (exit 1)");
  } catch (e) {
    fail(`[schema] ${e.message}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// score reduces judges + dimensions to a scorecard; a live P0 caps meets-expectations.
function scoreProbe() {
  const dir = mkdtempSync(join(tmpdir(), "ue-eval-score-"));
  try {
    cpSync(SAMPLE, dir, { recursive: true });
    writeFileSync(
      join(dir, "judges.jsonl"),
      [
        JSON.stringify({ lens: "a", dimensionScores: [{ id: "security", score: 4 }, { id: "correctness", score: 5 }], meetsExpectations: false }),
        JSON.stringify({ lens: "b", dimensionScores: [{ id: "security", score: 3 }, { id: "correctness", score: 5 }], meetsExpectations: false }),
      ].join("\n"),
    );
    if (run(["score", "--run", dir]).status !== 0) return fail("[score] score command failed");
    if (!existsSync(join(dir, "scorecard.json"))) return fail("[score] no scorecard.json written");
    const sc = JSON.parse(readFileSync(join(dir, "scorecard.json"), "utf8"));
    if (typeof sc.overall !== "number") return fail("[score] scorecard has no numeric overall");
    if (sc.meetsExpectations !== false) return fail("[score] sample-run has a live P0 — meets-expectations must be false");
    pass(`[score] scorecard overall=${sc.overall}/100, meets-expectations=false (P0 present)`);
  } catch (e) {
    fail(`[score] ${e.message}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// analyze produces objective repo signal.
function analyzeProbe() {
  const dir = mkdtempSync(join(tmpdir(), "ue-eval-an-"));
  try {
    cpSync(SAMPLE, dir, { recursive: true });
    if (run(["analyze", "--run", dir]).status !== 0) return fail("[analyze] command failed");
    if (!existsSync(join(dir, "analysis.json"))) return fail("[analyze] no analysis.json written");
    const a = JSON.parse(readFileSync(join(dir, "analysis.json"), "utf8"));
    if (!(a.files >= 1) || !(a.loc > 0)) return fail("[analyze] empty analysis");
    pass(`[analyze] analysis.json: ${a.files} files, ${a.loc} LOC, ${a.hotspots.length} hotspots`);
  } catch (e) {
    fail(`[analyze] ${e.message}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// a grounded opportunity (impact+effort, real anchor) passes; missing impact fails.
function opportunityProbe() {
  const dir = mkdtempSync(join(tmpdir(), "ue-eval-opp-"));
  try {
    cpSync(SAMPLE, dir, { recursive: true });
    const fp = join(dir, "findings.json");
    const doc = JSON.parse(readFileSync(fp, "utf8"));
    doc.findings.push({ id: "F9", kind: "opportunity", severity: "P2", impact: "high", effort: "S", title: "characterize the /safe route", statement: "add a spec test for the sanitized route", evidence: [{ ref: "app.js:4" }], recommendation: "add a test", status: "confirmed" });
    writeFileSync(fp, JSON.stringify(doc));
    if (run(["check", "--run", dir]).status !== 0) return fail("[opportunity] a grounded opportunity was rejected");
    pass("[opportunity] grounded opportunity (impact+effort, real anchor) passes check");
    doc.findings[doc.findings.length - 1].impact = undefined;
    writeFileSync(fp, JSON.stringify(doc));
    if (run(["check", "--run", dir]).status === 0) return fail("[opportunity] an opportunity without impact slipped through");
    pass("[opportunity] opportunity missing impact fails check (exit 1)");
  } catch (e) {
    fail(`[opportunity] ${e.message}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// a run: ref escaping the run dir must never count as grounding (laundering/traversal guard).
function containmentProbe() {
  const dir = mkdtempSync(join(tmpdir(), "ue-eval-esc-"));
  try {
    cpSync(SAMPLE, dir, { recursive: true });
    writeFileSync(join(dir, "..", "ue-eval-outside.txt"), "outside\n");
    const fp = join(dir, "findings.json");
    const doc = JSON.parse(readFileSync(fp, "utf8"));
    doc.findings[0].evidence = [{ ref: "run:../ue-eval-outside.txt" }];
    writeFileSync(fp, JSON.stringify(doc));
    if (run(["check", "--run", dir]).status === 0) return fail("[containment] a run:-escape ref slipped through check");
    pass("[containment] run: ref escaping the run dir fails check (exit 1)");
  } catch (e) {
    fail(`[containment] ${e.message}`);
  } finally {
    rmSync(join(dir, "..", "ue-eval-outside.txt"), { force: true });
    rmSync(dir, { recursive: true, force: true });
  }
}

// Honeypot probe — a complacent skeptic must be caught (RED), an honest one passes (GREEN).
function honeypotProbe() {
  const dir = mkdtempSync(join(tmpdir(), "ue-eval-hp-"));
  try {
    cpSync(SAMPLE, dir, { recursive: true });
    if (run(["verify", "--run", dir, "--honeypots", "2"]).status !== 0) return fail("[honeypot] verify --honeypots failed");
    if (!existsSync(join(dir, "VERIFY.honeypots.json"))) return fail("[honeypot] no ground-truth file written");
    const todo = JSON.parse(readFileSync(join(dir, "VERIFY.todo.json"), "utf8"));
    const truth = new Set(JSON.parse(readFileSync(join(dir, "VERIFY.honeypots.json"), "utf8")).claimIds);
    if (!truth.size) return fail("[honeypot] ground truth lists no planted traps");

    // RED: complacent skeptic grades everything supported → apply and the exit gate must fail.
    writeProbeVerdicts(dir, "supported");
    if (run(["verify", "--run", dir, "--apply", join(dir, "verdicts.probe.json")]).status === 0) return fail("[honeypot] a complacent skeptic slipped through --apply");
    if (run(["check", "--run", dir, "--semantic", "--require-verify"]).status === 0) return fail("[honeypot] check --require-verify passed despite failed honeypots");
    pass("[honeypot] RED complacent skeptic (all supported) is caught by apply + check");

    // GREEN: honest skeptic supports real pairs, rejects the traps.
    const pairs = todo.pairs.map((p) => ({ claimId: p.claimId, evidenceRef: p.evidenceRef, verdict: truth.has(p.claimId) ? "unsupported" : "supported", note: "eval probe" }));
    writeFileSync(join(dir, "verdicts.probe.json"), JSON.stringify({ pairs }));
    if (run(["verify", "--run", dir, "--apply", join(dir, "verdicts.probe.json")]).status !== 0) return fail("[honeypot] an honest skeptic was rejected");
    if (run(["check", "--run", dir, "--semantic", "--require-verify"]).status !== 0) return fail("[honeypot] gate stayed red after an honest re-verification");
    pass("[honeypot] GREEN honest skeptic (traps rejected) passes apply + check");
  } catch (e) {
    fail(`[honeypot] ${e.message}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// clean --all must refuse a directory that is not an ultraeval run.
function cleanGuardProbe() {
  const dir = mkdtempSync(join(tmpdir(), "ue-eval-clean-"));
  try {
    writeFileSync(join(dir, "precious.txt"), "do not delete\n");
    if (run(["clean", "--run", dir, "--all"]).status === 0) return fail("[clean] --all deleted a non-run directory");
    if (!existsSync(join(dir, "precious.txt"))) return fail("[clean] refusal still removed files");
    pass("[clean] --all refuses a non-run directory (guard holds)");
  } catch (e) {
    fail(`[clean] ${e.message}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// File-scope gate (init --scope), proven RED/GREEN end-to-end: an out-of-scope
// citation fails check; scope-exempt downgrades it; an in-scope one passes.
function scopeProbe() {
  const dir = mkdtempSync(join(tmpdir(), "ue-eval-scope-"));
  try {
    const target = join(dir, "target");
    mkdirSync(join(target, "src", "domain"), { recursive: true });
    mkdirSync(join(target, "tools"), { recursive: true });
    writeFileSync(join(target, "src", "domain", "rules.js"), "r1\nr2\n");
    writeFileSync(join(target, "tools", "helper.js"), "h1\n");
    const runDir = join(dir, "run");
    const init = run(["init", "--target", target, "--out", runDir, "--category", "métier", "--scope", "src/domain/**", "--no-gitignore"]);
    if (init.status !== 0) return fail(`[scope] init --scope failed: ${init.stderr}`);
    const cfg = JSON.parse(readFileSync(join(runDir, "eval.config.json"), "utf8"));
    if (!Array.isArray(cfg.scope) || cfg.scope[0] !== "src/domain/**") return fail("[scope] scope not stamped into eval.config.json");
    pass("[scope] init --scope stamps the globs into the config");

    const finding = (ref, extra = {}) => ({ findings: [{ id: "F1", severity: "P1", title: "t", statement: "s", evidence: [{ ref }], status: "confirmed", ...extra }] });
    writeFileSync(join(runDir, "findings.json"), JSON.stringify(finding("tools/helper.js:1")));
    if (run(["check", "--run", runDir]).status === 0) return fail("[scope] an out-of-scope citation slipped through check");
    pass("[scope] out-of-scope citation fails check (exit 1)");

    writeFileSync(join(runDir, "findings.json"), JSON.stringify(finding("tools/helper.js:1", { tags: ["scope-exempt"] })));
    const exempt = run(["check", "--run", runDir]);
    if (exempt.status !== 0) return fail("[scope] a scope-exempt finding still failed check");
    if (!/scope-exempt/.test(exempt.stdout + exempt.stderr)) return fail("[scope] the scope-exempt downgrade is silent");
    pass("[scope] scope-exempt downgrades to a visible warning (exit 0)");

    writeFileSync(join(runDir, "findings.json"), JSON.stringify(finding("src/domain/rules.js:2")));
    if (run(["check", "--run", runDir]).status !== 0) return fail("[scope] an in-scope citation failed check");
    pass("[scope] in-scope citation passes check (exit 0)");
  } catch (e) {
    fail(`[scope] ${e.message}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// One-shot profile: the scaffold carries the profile, the structural gate stays
// mandatory, and --require-verify refuses explicitly (no verify phase exists).
function oneshotProbe() {
  const dir = mkdtempSync(join(tmpdir(), "ue-eval-oneshot-"));
  try {
    const runDir = join(dir, "run");
    const target = join(ROOT, "tests", "fixtures", "target-lib");
    const os = run(["oneshot", "--target", target, "--out", runDir, "--category", "library", "--no-gitignore"]);
    if (os.status !== 0) return fail(`[oneshot] scaffold failed: ${os.stderr}`);
    if (!existsSync(join(runDir, "ONESHOT.md"))) return fail("[oneshot] no ONESHOT.md written");
    const cfg = JSON.parse(readFileSync(join(runDir, "eval.config.json"), "utf8"));
    if (cfg.oneshot !== true || cfg.provenance?.profile !== "oneshot") return fail("[oneshot] profile not stamped into the config");
    pass("[oneshot] scaffold writes ONESHOT.md + oneshot profile");

    const bare = run(["check", "--run", runDir]);
    if (bare.status !== 1) return fail(`[oneshot] check before findings should gate-fail (exit 1), got ${bare.status}`);
    pass("[oneshot] structural check still gates a oneshot run (exit 1 before findings)");

    writeFileSync(
      join(runDir, "findings.json"),
      JSON.stringify({ findings: [{ id: "F1", severity: "P2", title: "t", statement: "s", evidence: [{ ref: "src/retry.js:1" }], status: "confirmed" }] }),
    );
    if (run(["check", "--run", runDir]).status !== 0) return fail("[oneshot] a grounded finding failed the structural gate");
    pass("[oneshot] grounded finding passes the structural gate (exit 0)");

    const rv = run(["check", "--run", runDir, "--require-verify"]);
    if (rv.status === 0) return fail("[oneshot] --require-verify passed on a one-shot run");
    if (!/one-shot/.test(rv.stdout + rv.stderr)) return fail("[oneshot] --require-verify refusal does not name the one-shot profile");
    pass("[oneshot] --require-verify refuses explicitly (upgrade path named)");
  } catch (e) {
    fail(`[oneshot] ${e.message}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

console.log("ultraeval evals — gate + backlog + schema + score + analyze + opportunity + containment + honeypot + clean + scope + oneshot\n");
gateProbe();
backlogProbe();
schemaProbe();
scoreProbe();
analyzeProbe();
opportunityProbe();
containmentProbe();
honeypotProbe();
cleanGuardProbe();
scopeProbe();
oneshotProbe();
if (failures) {
  console.error(`\n${failures} probe(s) failed`);
  process.exit(1);
}
console.log("\nall probes passed");
