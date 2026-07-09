import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BUNDLE = join(ROOT, "scripts", "ultraeval.mjs");
const FIX = join(ROOT, "tests", "fixtures");
const tmps: string[] = [];

function run(args: string[]): { status: number; out: string } {
  try {
    const stdout = execFileSync("node", [BUNDLE, ...args], { encoding: "utf8", cwd: ROOT });
    return { status: 0, out: stdout };
  } catch (e) {
    const err = e as { status?: number; stdout?: string; stderr?: string };
    return { status: err.status ?? 1, out: `${err.stdout ?? ""}${err.stderr ?? ""}` };
  }
}

afterAll(() => {
  for (const t of tmps.splice(0)) rmSync(t, { recursive: true, force: true });
});

describe("e2e — the shipped bundle drives the whole flow", () => {
  it("init + plan generate a launchable workflow + all agent contracts", () => {
    const out = mkdtempSync(join(tmpdir(), "ue-e2e-"));
    tmps.push(out);
    expect(run(["init", "--target", join(FIX, "target-lib"), "--out", out, "--kind", "codebase"]).status).toBe(0);
    expect(existsSync(join(out, "eval.config.json"))).toBe(true);
    expect(run(["plan", "--run", out]).status).toBe(0);
    expect(existsSync(join(out, "eval.workflow.mjs"))).toBe(true);
    for (const a of ["researcher", "testplan", "executor", "findings", "gate", "judge", "remediator"]) {
      expect(existsSync(join(out, "agents", `${a}.md`))).toBe(true);
    }
  });

  it("plan surfaces the normed process: anchors in dimensions.json/contracts, codified severities", () => {
    const out = mkdtempSync(join(tmpdir(), "ue-e2e-norm-"));
    tmps.push(out);
    expect(run(["init", "--target", join(FIX, "target-lib"), "--out", out, "--kind", "codebase"]).status).toBe(0);
    const cfg = JSON.parse(readFileSync(join(out, "eval.config.json"), "utf8"));
    expect(cfg.provenance?.engineVersion).toBeTruthy();
    expect(run(["plan", "--run", out]).status).toBe(0);
    const dims = JSON.parse(readFileSync(join(out, "dimensions.json"), "utf8"));
    expect(JSON.stringify(dims)).toContain("ISO/IEC 25010:2023");
    expect(readFileSync(join(out, "agents", "researcher.md"), "utf8")).toContain("ISO/IEC 25010:2023");
    expect(readFileSync(join(out, "agents", "findings.md"), "utf8")).toContain("breaks trust, correctness, safety");
  });

  it("gate chain + backlog + render on a copied sample run (all exit 0)", () => {
    const dir = mkdtempSync(join(tmpdir(), "ue-run-"));
    tmps.push(dir);
    cpSync(join(FIX, "sample-run"), dir, { recursive: true });
    expect(run(["check", "--run", dir]).status).toBe(0);
    expect(run(["verify", "--run", dir]).status).toBe(0);
    expect(run(["verify", "--run", dir, "--apply", join(dir, "verdicts.json")]).status).toBe(0);
    expect(run(["check", "--run", dir, "--semantic", "--require-verify"]).status).toBe(0);
    expect(run(["backlog", "--run", dir, "--tdd"]).status).toBe(0);
    expect(existsSync(join(dir, "BACKLOG.json"))).toBe(true);
    expect(existsSync(join(dir, "fixes"))).toBe(true);
    expect(run(["render", "--run", dir]).status).toBe(0);
    expect(existsSync(join(dir, "index.html"))).toBe(true);
  });

  it("--version prints the version, not help", () => {
    const r = run(["--version"]);
    expect(r.status).toBe(0);
    expect(r.out).toMatch(/^\d+\.\d+\.\d+/);
    expect(r.out).not.toMatch(/Usage:/);
  });

  it("check fails (exit 1) on a doctored citation", () => {
    const dir = mkdtempSync(join(tmpdir(), "ue-bad-"));
    tmps.push(dir);
    cpSync(join(FIX, "sample-run"), dir, { recursive: true });
    const fp = join(dir, "findings.json");
    const doc = JSON.parse(readFileSync(fp, "utf8"));
    doc.findings[0].evidence[0].ref = "app.js:99999";
    writeFileSync(fp, JSON.stringify(doc));
    expect(run(["check", "--run", dir]).status).toBe(1);
  });
});
