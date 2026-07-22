import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { oneshotRun } from "../src/oneshot.js";
import { planRun } from "../src/plan.js";
import type { EvalConfig } from "../src/types.js";
import { readJson } from "../src/util.js";

const tmps: string[] = [];

function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), "ue-oneshot-"));
  tmps.push(d);
  return d;
}

afterEach(() => {
  for (const t of tmps.splice(0)) rmSync(t, { recursive: true, force: true });
});

describe("oneshot — single-pass quick eval", () => {
  it("scaffolds ONESHOT.md + dimensions + schema and stamps the oneshot profile", () => {
    const { cfg, runDir } = oneshotRun({ target: tmp(), out: tmp() }, "/engine.mjs");
    expect(cfg.oneshot).toBe(true);
    expect(cfg.provenance?.profile).toBe("oneshot");
    expect(cfg.mode).toBe("audit");
    expect(existsSync(join(runDir, "ONESHOT.md"))).toBe(true);
    expect(existsSync(join(runDir, "dimensions.json"))).toBe(true);
    expect(existsSync(join(runDir, "findings.schema.json"))).toBe(true);
    expect(existsSync(join(runDir, "eval.workflow.mjs"))).toBe(false);
    expect(readJson<EvalConfig>(join(runDir, "eval.config.json")).oneshot).toBe(true);
  });

  it("ONESHOT.md is a self-contained one-pass contract: gate required, verify out of contract", () => {
    const { runDir } = oneshotRun({ target: tmp(), out: tmp() }, "/engine.mjs");
    const md = readFileSync(join(runDir, "ONESHOT.md"), "utf8");
    expect(md).toMatch(/ONE pass/i);
    expect(md).toContain("/engine.mjs check --run");
    expect(md).toContain("findings.json");
    expect(md).toMatch(/indicative|not.*normed/i); // never presented as a verified verdict
    expect(md).toMatch(/no subagents|no fan-out/i);
    expect(md).toMatch(/plan --run/); // the upgrade path to the full pipeline
  });

  it("category and scope flow into the config and the contract (métier one-shot)", () => {
    const { cfg, runDir } = oneshotRun({ target: tmp(), out: tmp(), category: "métier", scope: ["src/domain/**"] }, "/engine.mjs");
    expect(cfg.dimensions.map((d) => d.id)).toContain("business-correctness");
    expect(cfg.scope).toEqual(["src/domain/**"]);
    expect(readFileSync(join(runDir, "ONESHOT.md"), "utf8")).toContain("src/domain/**");
  });

  it("auto-gitignores the run dir like init does", () => {
    const target = tmp();
    execFileSync("git", ["init", "-q"], { cwd: target });
    const res = oneshotRun({ target, out: join(target, ".ultraeval", "quick") }, "/engine.mjs");
    expect(res.gitignore?.action).toBe("added");
    expect(readFileSync(join(target, ".gitignore"), "utf8")).toContain(".ultraeval/");
  });

  it("plan --run upgrades a oneshot run to the full pipeline (removes ONESHOT.md, clears the profile)", () => {
    const { runDir } = oneshotRun({ target: tmp(), out: tmp() }, "/engine.mjs");
    planRun(runDir, "/engine.mjs");
    expect(existsSync(join(runDir, "ONESHOT.md"))).toBe(false);
    expect(existsSync(join(runDir, "eval.workflow.mjs"))).toBe(true);
    const cfg = readJson<EvalConfig>(join(runDir, "eval.config.json"));
    expect(cfg.oneshot).toBeUndefined();
    expect(cfg.provenance?.profile).toBeUndefined();
  });
});
