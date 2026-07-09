import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveEvidence } from "../src/util.js";

const tmps: string[] = [];

afterEach(() => {
  for (const t of tmps.splice(0)) rmSync(t, { recursive: true, force: true });
});

function scaffold(): { targetAbs: string; runDir: string; outside: string } {
  const root = mkdtempSync(join(tmpdir(), "ue-util-"));
  tmps.push(root);
  const targetAbs = join(root, "target");
  const runDir = join(root, "run", "dir");
  mkdirSync(targetAbs, { recursive: true });
  mkdirSync(join(runDir, "runs"), { recursive: true });
  writeFileSync(join(runDir, "runs", "core.md"), "l1\nl2\nl3\n");
  const outside = join(root, "outside.txt");
  writeFileSync(outside, "secret\n");
  return { targetAbs, runDir, outside };
}

describe("resolveEvidence — run: containment guard", () => {
  it("a run: ref that escapes the run directory is never graded, even if the file exists", () => {
    const { targetAbs, runDir } = scaffold();
    const r = resolveEvidence("run:../../outside.txt", { targetAbs, runDir });
    expect(r.resolved).toBe(false);
    expect(r.gradeable).toBe(false);
    expect(r.reason).toMatch(/escapes the run directory/);
  });

  it("an absolute run: ref is also rejected", () => {
    const { targetAbs, runDir, outside } = scaffold();
    const r = resolveEvidence(`run:${outside}`, { targetAbs, runDir });
    expect(r.resolved).toBe(false);
    expect(r.gradeable).toBe(false);
  });

  it("a genuine run: ref inside the run dir still resolves with line ranges", () => {
    const { targetAbs, runDir } = scaffold();
    expect(resolveEvidence("run:runs/core.md#L2", { targetAbs, runDir }).resolved).toBe(true);
    expect(resolveEvidence("run:runs/core.md#L9", { targetAbs, runDir }).resolved).toBe(false);
  });
});
