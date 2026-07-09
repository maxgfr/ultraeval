import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { initRun } from "../src/init.js";
import { PROTOCOL_VERSION, RUBRIC_VERSION, VERSION } from "../src/types.js";

const tmps: string[] = [];

function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), "ue-init-"));
  tmps.push(d);
  return d;
}

afterEach(() => {
  for (const t of tmps.splice(0)) rmSync(t, { recursive: true, force: true });
});

describe("init — run provenance", () => {
  it("records engine/protocol/rubric versions, timestamp, mode/kind/category and a dimensions hash", () => {
    const { cfg } = initRun({ target: tmp(), out: tmp(), kind: "codebase", category: "library", mode: "deep" });
    const p = cfg.provenance;
    expect(p?.engineVersion).toBe(VERSION);
    expect(p?.protocolVersion).toBe(PROTOCOL_VERSION);
    expect(p?.rubricVersion).toBe(RUBRIC_VERSION);
    expect(Number.isNaN(Date.parse(p?.createdAt ?? ""))).toBe(false);
    expect(p?.mode).toBe("deep");
    expect(p?.kind).toBe("codebase");
    expect(p?.category).toBe("library");
    expect(p?.dimensionsHash).toMatch(/^[0-9a-f]{12}$/);
  });

  it("captures the target git commit and dirty flag when the target is a git repo", () => {
    const target = tmp();
    execFileSync("git", ["init", "-q"], { cwd: target });
    execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "init"], { cwd: target });
    const { cfg } = initRun({ target, out: tmp() });
    expect(cfg.provenance?.targetGit?.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(typeof cfg.provenance?.targetGit?.dirty).toBe("boolean");
  });

  it("omits targetGit for a non-git target and still writes full provenance", () => {
    const out = tmp();
    const { cfg, runDir } = initRun({ target: tmp(), out });
    expect(cfg.provenance).toBeDefined();
    expect(cfg.provenance?.targetGit).toBeUndefined();
    expect(existsSync(join(runDir, "eval.config.json"))).toBe(true);
  });
});
