import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { clean } from "../src/clean.js";

const tmps: string[] = [];

function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), "ue-clean-"));
  tmps.push(d);
  return d;
}

function runDir(): string {
  const d = tmp();
  writeFileSync(join(d, "eval.config.json"), JSON.stringify({ target: "t", targetAbs: "/t", kind: "codebase", category: "c", dimensions: [], version: "0" }));
  writeFileSync(join(d, "findings.json"), JSON.stringify({ findings: [] }));
  writeFileSync(join(d, "VERIFY.json"), "{}");
  writeFileSync(join(d, "index.html"), "<html></html>");
  mkdirSync(join(d, "fixes"));
  writeFileSync(join(d, "fixes", "FIX-001-x.md"), "# card");
  return d;
}

afterEach(() => {
  for (const t of tmps.splice(0)) rmSync(t, { recursive: true, force: true });
});

describe("clean — run-guard against deleting arbitrary directories", () => {
  it("--all refuses a directory that is not an ultraeval run and leaves it intact", () => {
    const d = tmp();
    writeFileSync(join(d, "precious.txt"), "do not delete");
    expect(() => clean(d, { all: true })).toThrow(/not an ultraeval run/);
    expect(existsSync(join(d, "precious.txt"))).toBe(true);
  });

  it("default clean also refuses a non-run directory", () => {
    const d = tmp();
    mkdirSync(join(d, "fixes"));
    writeFileSync(join(d, "fixes", "precious.md"), "not a card");
    expect(() => clean(d)).toThrow(/not an ultraeval run/);
    expect(existsSync(join(d, "fixes", "precious.md"))).toBe(true);
  });

  it("--all removes a genuine run dir", () => {
    const d = runDir();
    const removed = clean(d, { all: true });
    expect(removed).toContain(d);
    expect(existsSync(d)).toBe(false);
  });

  it("removes the render-produced eval.sarif like the other derived artifacts", () => {
    const d = runDir();
    writeFileSync(join(d, "eval.sarif"), "{}");
    clean(d);
    expect(existsSync(join(d, "eval.sarif"))).toBe(false);
  });

  it("default clean removes derived artifacts and keeps the deliverables", () => {
    const d = runDir();
    clean(d);
    expect(existsSync(join(d, "VERIFY.json"))).toBe(false);
    expect(existsSync(join(d, "index.html"))).toBe(false);
    expect(existsSync(join(d, "fixes"))).toBe(false);
    expect(existsSync(join(d, "eval.config.json"))).toBe(true);
    expect(existsSync(join(d, "findings.json"))).toBe(true);
  });
});
