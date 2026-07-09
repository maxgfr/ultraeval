import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildBacklog } from "../src/backlog.js";

const tmps: string[] = [];

function scaffold(findings: unknown[], verify?: unknown): string {
  const root = mkdtempSync(join(tmpdir(), "ue-bl-"));
  tmps.push(root);
  const target = join(root, "target");
  mkdirSync(target, { recursive: true });
  writeFileSync(join(target, "app.js"), "a\nb\nc\nd\ne\n");
  const run = join(root, "run");
  mkdirSync(run, { recursive: true });
  writeFileSync(
    join(run, "eval.config.json"),
    JSON.stringify({ target: "target", targetAbs: target, kind: "codebase", category: "library", dimensions: [], version: "0.0.0" }),
  );
  writeFileSync(join(run, "findings.json"), JSON.stringify({ findings }));
  if (verify) writeFileSync(join(run, "VERIFY.json"), JSON.stringify(verify));
  return run;
}

// A target scaffold with an arbitrary file layout + a single confirmed finding
// citing `evidenceRef` — used to probe guessTestFile's convention detection.
function scaffoldWith(files: Record<string, string>, evidenceRef: string): string {
  const root = mkdtempSync(join(tmpdir(), "ue-bl-"));
  tmps.push(root);
  const target = join(root, "target");
  mkdirSync(target, { recursive: true });
  for (const [rel, content] of Object.entries(files)) {
    const p = join(target, rel);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, content);
  }
  const run = join(root, "run");
  mkdirSync(run, { recursive: true });
  writeFileSync(
    join(run, "eval.config.json"),
    JSON.stringify({ target: "target", targetAbs: target, kind: "codebase", category: "library", dimensions: [], version: "0.0.0" }),
  );
  writeFileSync(
    join(run, "findings.json"),
    JSON.stringify({
      findings: [{ id: "F1", severity: "P1", title: "t", statement: "s", evidence: [{ ref: evidenceRef }], status: "confirmed", recommendation: "fix" }],
    }),
  );
  return run;
}

afterEach(() => {
  for (const t of tmps.splice(0)) rmSync(t, { recursive: true, force: true });
});

const mk = (id: string, sev: string, status: string) => ({
  id,
  severity: sev,
  title: `${id} thing`,
  statement: `does ${id}`,
  evidence: [{ ref: "app.js:2" }],
  status,
  recommendation: "fix it",
});

describe("backlog — TDD fix cards", () => {
  it("errors actionably when findings.json is missing (pipeline run out of order)", () => {
    const root = mkdtempSync(join(tmpdir(), "ue-bl-"));
    tmps.push(root);
    const run = join(root, "run");
    mkdirSync(run, { recursive: true });
    writeFileSync(
      join(run, "eval.config.json"),
      JSON.stringify({ target: "t", targetAbs: root, kind: "codebase", category: "library", dimensions: [], version: "0.0.0" }),
    );
    expect(() => buildBacklog(run)).toThrow(/no findings\.json — record findings first/);
  });

  it("codebase tasks get a runnable verify command when the target manifest declares one", () => {
    const run = scaffold([mk("F1", "P1", "confirmed")]);
    const cfg = JSON.parse(readFileSync(join(run, "eval.config.json"), "utf8"));
    writeFileSync(join(cfg.targetAbs, "package.json"), JSON.stringify({ name: "t", scripts: { test: "vitest run" } }));
    const bl = buildBacklog(run);
    expect(bl.tasks[0]?.verify.command).toBe("npm test");
  });

  it("codebase tasks keep the prose fallback when no test entrypoint is detectable", () => {
    const bl = buildBacklog(scaffold([mk("F1", "P1", "confirmed")]));
    expect(bl.tasks[0]?.verify.command).toMatch(/run the new test/);
  });

  it("skill tasks get the DETECTED runner (npm/yarn/pnpm per lockfile), not a hardcoded pnpm string", () => {
    const run = scaffold([mk("F1", "P1", "confirmed")]);
    const cfgPath = join(run, "eval.config.json");
    const cfg = JSON.parse(readFileSync(cfgPath, "utf8"));
    cfg.kind = "skill";
    writeFileSync(cfgPath, JSON.stringify(cfg));
    writeFileSync(join(cfg.targetAbs, "package.json"), JSON.stringify({ name: "t", scripts: { test: "vitest run" } })); // no lockfile -> npm
    const bl = buildBacklog(run);
    expect(bl.tasks[0]?.verify.command).toBe("npm test"); // NOT "pnpm test  # ..."
  });

  it("skill tasks keep the pnpm prose fallback only when no manifest is detectable", () => {
    const run = scaffold([mk("F1", "P1", "confirmed")]); // scaffold target has no package.json
    const cfgPath = join(run, "eval.config.json");
    const cfg = JSON.parse(readFileSync(cfgPath, "utf8"));
    cfg.kind = "skill";
    writeFileSync(cfgPath, JSON.stringify(cfg));
    const bl = buildBacklog(run);
    expect(bl.tasks[0]?.verify.command).toMatch(/pnpm test/);
  });

  it("derives a dependsOn chain when tasks share a target file", () => {
    const bl = buildBacklog(scaffold([mk("F1", "P0", "confirmed"), mk("F2", "P1", "confirmed"), mk("F3", "P2", "confirmed")]));
    expect(bl.tasks[0]?.dependsOn).toEqual([]);
    expect(bl.tasks[1]?.dependsOn).toEqual(["FIX-001"]);
    expect(bl.tasks[2]?.dependsOn).toEqual(["FIX-002"]);
  });

  it("keeps tasks on disjoint files independent", () => {
    const a = { ...mk("F1", "P0", "confirmed"), evidence: [{ ref: "app.js:2" }] };
    const b = { ...mk("F2", "P1", "confirmed"), evidence: [{ ref: "lib.js:1" }] };
    const bl = buildBacklog(scaffold([a, b]));
    expect(bl.tasks.every((t) => t.dependsOn.length === 0)).toBe(true);
  });

  it("dependsOn only ever points at earlier tasks (no cycle possible)", () => {
    const a = { ...mk("F1", "P0", "confirmed"), evidence: [{ ref: "app.js:2" }] };
    const b = { ...mk("F2", "P1", "confirmed"), evidence: [{ ref: "app.js:3" }, { ref: "lib.js:1" }] };
    const c = { ...mk("F3", "P2", "confirmed"), evidence: [{ ref: "lib.js:2" }] };
    const bl = buildBacklog(scaffold([a, b, c]));
    const index = new Map(bl.tasks.map((t, i) => [t.id, i]));
    for (const [i, t] of bl.tasks.entries()) {
      for (const dep of t.dependsOn) expect(index.get(dep)).toBeLessThan(i);
    }
    expect(bl.tasks[1]?.dependsOn).toEqual(["FIX-001"]); // shares app.js with FIX-001
    expect(bl.tasks[2]?.dependsOn).toEqual(["FIX-002"]); // shares lib.js with FIX-002
  });

  it("includes only confirmed findings, sorted by priority", () => {
    const run = scaffold([mk("F1", "P1", "confirmed"), mk("F2", "P0", "confirmed"), mk("F3", "P2", "dismissed")]);
    const bl = buildBacklog(run, { tdd: true });
    expect(bl.tasks.map((t) => t.findingId)).toEqual(["F2", "F1"]); // P0 before P1; F3 dismissed excluded
    expect(existsSync(join(run, "fixes"))).toBe(true);
    expect(existsSync(join(run, "REMEDIATION.md"))).toBe(true);
  });

  it("excludes findings that verification refuted", () => {
    const run = scaffold([mk("F1", "P0", "confirmed"), mk("F2", "P1", "confirmed")], { ok: false, failures: ["F2"], adjudicated: 2, verdicts: [] });
    expect(buildBacklog(run, {}).tasks.map((t) => t.findingId)).toEqual(["F1"]);
  });

  it("each task carries a RED failing-test-first card and a GREEN change", () => {
    const bl = buildBacklog(scaffold([mk("F1", "P0", "confirmed")]), {});
    expect(bl.tasks[0]?.red.testFile).toMatch(/test/);
    expect(bl.tasks[0]?.green.change).toBe("fix it");
  });

  it("targets exclude run:/url: refs and strip the analysis: prefix (FIX-012)", () => {
    const f = {
      ...mk("F1", "P1", "confirmed"),
      evidence: [{ ref: "analysis:app.js:2" }, { ref: "src/lib.ts:4" }, { ref: "run:runs/core.md#L1" }, { ref: "url:https://x.example" }],
    };
    const bl = buildBacklog(scaffold([f]));
    const targets = bl.tasks[0]?.targets ?? [];
    expect(targets).toContain("app.js"); // analysis: prefix stripped (the fix)
    expect(targets).toContain("src/lib.ts");
    expect(targets.some((t) => t.startsWith("analysis:"))).toBe(false);
    expect(targets.some((t) => t.startsWith("run:") || t.startsWith("url:"))).toBe(false);
  });

  it("places the RED test under tests/ when the target keeps its tests there (FIX-020)", () => {
    const run = scaffoldWith({ "app.js": "x\n", "tests/app.test.js": "t\n" }, "app.js:1");
    const testFile = buildBacklog(run).tasks[0]?.red.testFile ?? "";
    expect(testFile.startsWith("tests/")).toBe(true);
    expect(testFile).toMatch(/\.test\.js$/);
  });

  it("emits a colocated *.spec path when the target uses colocated spec tests (FIX-020)", () => {
    const run = scaffoldWith({ "src/foo.ts": "x\n", "src/foo.spec.ts": "t\n", "src/bar.ts": "y\n" }, "src/bar.ts:1");
    expect(buildBacklog(run).tasks[0]?.red.testFile).toBe("src/bar.spec.ts");
  });

  it("emits an __tests__ path when the target colocates tests under __tests__ (FIX-020)", () => {
    const run = scaffoldWith({ "src/foo.ts": "x\n", "src/__tests__/foo.test.ts": "t\n", "src/bar.ts": "y\n" }, "src/bar.ts:1");
    expect(buildBacklog(run).tasks[0]?.red.testFile).toBe("src/__tests__/bar.test.ts");
  });

  it("falls back to tests/<name>.test.<ext> for an unknown/empty layout (FIX-020)", () => {
    const run = scaffoldWith({ "app.js": "x\n" }, "app.js:1");
    expect(buildBacklog(run).tasks[0]?.red.testFile).toBe("tests/app.test.js");
  });

  it("labels an opportunity task and bands it by impact (high -> P1)", () => {
    const opp = {
      id: "F1",
      kind: "opportunity",
      severity: "P2",
      impact: "high",
      effort: "S",
      title: "quick win",
      statement: "s",
      evidence: [{ ref: "app.js:2" }],
      status: "confirmed",
      recommendation: "do X",
    };
    const bl = buildBacklog(scaffold([opp]), { tdd: true });
    expect(bl.tasks[0]?.kind).toBe("opportunity");
    expect(bl.tasks[0]?.priority).toBe("P1");
  });
});
