import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { Provenance } from "../src/types.js";
import { provLine, readText, resolveEvidence, SEV_ORDER, titleKey, writeText } from "../src/util.js";

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

describe("shared ranking/identity helpers", () => {
  it("SEV_ORDER ranks P0 before P1 before P2 and titleKey normalizes titles", () => {
    expect(SEV_ORDER.P0).toBe(0);
    expect(SEV_ORDER.P1).toBe(1);
    expect(SEV_ORDER.P2).toBe(2);
    expect(titleKey("  Quick Win ")).toBe("quick win");
  });
});

describe("writeText — atomic write", () => {
  function scratch(): string {
    const d = mkdtempSync(join(tmpdir(), "ue-write-"));
    tmps.push(d);
    return d;
  }

  it("creates missing parent directories and writes content", () => {
    const p = join(scratch(), "nested", "deep", "out.txt");
    writeText(p, "hello world");
    expect(readText(p)).toBe("hello world");
  });

  it("writes an empty file faithfully when content is ''", () => {
    const p = join(scratch(), "empty.jsonl");
    writeText(p, "");
    expect(readText(p)).toBe("");
  });

  it("overwrites an existing file with the new content", () => {
    const p = join(scratch(), "out.txt");
    writeText(p, "first");
    writeText(p, "second");
    expect(readText(p)).toBe("second");
  });

  it("leaves no .tmp staging files behind after a successful write", () => {
    const dir = scratch();
    const p = join(dir, "out.txt");
    writeText(p, "content");
    expect(readdirSync(dir).filter((f) => f.endsWith(".tmp"))).toEqual([]);
  });

  it("cleans up the temp file and never partially writes the target when the rename fails", () => {
    const dir = scratch();
    // A directory target makes the final renameSync(tempFile, target) fail, so
    // the destination is never touched — the atomicity guarantee. No partial
    // .tmp staging file may linger afterwards.
    const target = join(dir, "iamdir");
    mkdirSync(target);
    expect(() => writeText(target, "x")).toThrow();
    expect(existsSync(target)).toBe(true);
    expect(readdirSync(dir).filter((f) => f.endsWith(".tmp"))).toEqual([]);
  });
});

describe("provLine — shared provenance one-liner (compare + render)", () => {
  const prov = (over: Partial<Provenance> = {}): Provenance =>
    ({
      engineVersion: "1.0.0",
      protocolVersion: "1",
      rubricVersion: "1",
      createdAt: "2026-01-01T00:00:00.000Z",
      mode: "audit",
      kind: "codebase",
      category: "library",
      dimensionsHash: "aaaaaaaaaaaa",
      targetGit: { commit: "a".repeat(40), dirty: false },
      ...over,
    }) as Provenance;

  it("renders engine/protocol/rubric + short target SHA", () => {
    expect(provLine(prov())).toBe("engine 1.0.0 · protocol 1 · rubric 1 · target aaaaaaa");
  });

  it("appends a dirty star when the target tree is dirty", () => {
    expect(provLine(prov({ targetGit: { commit: "a".repeat(40), dirty: true } }))).toBe("engine 1.0.0 · protocol 1 · rubric 1 · target aaaaaaa*");
  });

  it("omits the target segment when there is no targetGit", () => {
    expect(provLine(prov({ targetGit: undefined }))).toBe("engine 1.0.0 · protocol 1 · rubric 1");
  });

  it("render's fallback (default emptyText) is the empty string", () => {
    expect(provLine(undefined)).toBe("");
  });

  it("compare's fallback labels a legacy run", () => {
    expect(provLine(undefined, "no provenance (legacy run)")).toBe("no provenance (legacy run)");
  });
});

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
