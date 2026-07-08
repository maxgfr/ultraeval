#!/usr/bin/env node
// Zero-dep eval harness: drive the SHIPPED bundle through a RED/GREEN gate probe
// (a doctored artifact must fail, a genuine one must pass — proven end-to-end,
// not just in unit tests) plus a backlog probe. Mirrors ultrasearch/evals.
// Runs offline. `pnpm run eval`. Exit non-zero on any probe failure (gates CI).
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

console.log("ultraeval evals — RED/GREEN gate probe + backlog + schema + score\n");
gateProbe();
backlogProbe();
schemaProbe();
scoreProbe();
if (failures) {
  console.error(`\n${failures} probe(s) failed`);
  process.exit(1);
}
console.log("\nall probes passed");
