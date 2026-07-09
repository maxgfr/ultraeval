import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { analyzeRepo } from "../src/analyze.js";

const tmps: string[] = [];

function repo(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "ue-an-"));
  tmps.push(root);
  for (const [rel, content] of Object.entries(files)) {
    const p = join(root, rel);
    mkdirSync(join(p, ".."), { recursive: true });
    writeFileSync(p, content);
  }
  return root;
}

afterEach(() => {
  for (const t of tmps.splice(0)) rmSync(t, { recursive: true, force: true });
});

describe("analyze — deterministic repo signal", () => {
  it("counts files/LOC, ranks hotspots, resolves local import edges, counts TODOs", () => {
    const big = `${Array.from({ length: 320 }, (_, i) => `const x${i} = ${i};`).join("\n")}\n// TODO: refactor this\n`;
    const a = analyzeRepo(
      repo({
        "src/big.ts": big,
        "src/small.ts": "import { x0 } from './big.js';\nexport const y = x0;\n",
        "tests/small.test.ts": "import { y } from '../src/small.js';\nit('works', () => {});\n",
      }),
    );
    expect(a.files).toBe(3);
    expect(a.loc).toBeGreaterThan(320);
    expect(a.hotspots[0]?.path).toBe("src/big.ts");
    expect(a.hotspots[0]?.reason).toMatch(/large/);
    expect(a.deps.edges).toBeGreaterThanOrEqual(1); // small.ts -> big.ts
    expect(a.todos).toBe(1);
    expect(a.tests.testFiles).toBe(1);
  });

  it("flags a source file that has no obvious test", () => {
    const a = analyzeRepo(repo({ "src/lonely.ts": "export const z = 1;\n" }));
    expect(a.tests.untested).toContain("src/lonely.ts");
  });

  it("detects an import cycle", () => {
    const a = analyzeRepo(
      repo({
        "src/a.ts": "import { b } from './b.js';\nexport const a = () => b;\n",
        "src/b.ts": "import { a } from './a.js';\nexport const b = () => a;\n",
      }),
    );
    expect(a.deps.cycles.length).toBeGreaterThanOrEqual(1);
  });

  it("reports no churn on a non-git target (does not throw)", () => {
    const a = analyzeRepo(repo({ "src/x.ts": "export const x = 1;\n" }));
    expect(a.hotspots[0]?.churn).toBeUndefined();
  });

  it("does not count an unrelated fixture as the test of a similarly-named source file", () => {
    const a = analyzeRepo(
      repo({
        "evals/run.mjs": "export const r = 1;\n",
        "tests/fixtures/sample-run/app.js": "module.exports = 1;\n",
      }),
    );
    expect(a.tests.untested).toContain("evals/run.mjs");
  });

  it("matches a real test to its source by base name across test-naming conventions", () => {
    const a = analyzeRepo(
      repo({
        "src/foo.ts": "export const f = 1;\n",
        "src/bar.py": "BAR = 1\n",
        "tests/foo.test.ts": "it('x', () => {});\n",
        "tests/test_bar.py": "def test_bar(): pass\n",
      }),
    );
    expect(a.tests.untested).not.toContain("src/foo.ts");
    expect(a.tests.untested).not.toContain("src/bar.py");
  });

  it("credits a source reached through a test file's imports, even when the test is named by behaviour (FIX-007)", () => {
    // A behaviour-named test (parse.test.ts covering cliargs.ts) shares no base
    // name with its subject, yet its import graph reaches it. Exact-base-name
    // matching alone would report the source as a false coverage gap.
    const a = analyzeRepo(
      repo({
        "src/cliargs.ts": "export const parse = () => 1;\n",
        "tests/parse.test.ts": "import { parse } from '../src/cliargs.js';\nit('parses', () => {});\n",
      }),
    );
    expect(a.tests.untested).not.toContain("src/cliargs.ts");
  });

  it("credits a source reached TRANSITIVELY through the test import graph (FIX-007)", () => {
    // integration.test.ts imports the facade, which imports the helper; both
    // sources are exercised even though only the facade is imported directly.
    const a = analyzeRepo(
      repo({
        "src/helper.ts": "export const help = () => 2;\n",
        "src/facade.ts": "import { help } from './helper.js';\nexport const run = () => help();\n",
        "tests/integration.test.ts": "import { run } from '../src/facade.js';\nit('runs', () => {});\n",
      }),
    );
    expect(a.tests.untested).not.toContain("src/facade.ts");
    expect(a.tests.untested).not.toContain("src/helper.ts");
  });

  it("notes when git churn is unavailable so size-only hotspot ranking is explicit", () => {
    const a = analyzeRepo(repo({ "src/x.ts": "export const x = 1;\n" }));
    expect((a.notes ?? []).join(" ")).toMatch(/churn unavailable/);
  });

  it("excludes a generated bundle (large JS, no local imports) from analysis", () => {
    const bundle = `#!/usr/bin/env node\nimport { readFileSync } from "node:fs";\n${Array.from({ length: 450 }, (_, i) => `const g${i} = ${i};`).join("\n")}\n`;
    const a = analyzeRepo(
      repo({
        "scripts/bundle.mjs": bundle,
        "src/real.ts": "import { readFileSync } from 'node:fs';\nexport const r = readFileSync;\n",
      }),
    );
    expect(a.hotspots.some((h) => h.path === "scripts/bundle.mjs")).toBe(false);
    expect(a.files).toBe(1);
  });
});
