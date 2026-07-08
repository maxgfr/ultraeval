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
});
