import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildSarif } from "../src/sarif.js";
import type { EvalConfig, FindingsDoc } from "../src/types.js";

const tmps: string[] = [];

afterEach(() => {
  for (const t of tmps.splice(0)) rmSync(t, { recursive: true, force: true });
});

function scaffold(): { cfg: EvalConfig; doc: FindingsDoc; runDir: string } {
  const root = mkdtempSync(join(tmpdir(), "ue-sarif-"));
  tmps.push(root);
  const target = join(root, "target");
  mkdirSync(join(target, "src"), { recursive: true });
  writeFileSync(join(target, "src", "app.js"), "l1\nl2\nl3\n");
  const runDir = join(root, "run");
  mkdirSync(runDir, { recursive: true });
  const cfg: EvalConfig = {
    target: "target",
    targetAbs: target,
    kind: "codebase",
    category: "library",
    dimensions: [{ id: "security", name: "Security", weight: 1, whatPerfectLooksLike: "x" }],
    version: "1.4.0",
  };
  const doc: FindingsDoc = {
    findings: [
      {
        id: "F1",
        dimension: "security",
        severity: "P0",
        title: "SQL injection",
        statement: "req.query.id flows into SQL",
        evidence: [{ ref: "src/app.js:2" }, { ref: "run:runs/core.md#L1" }],
        status: "confirmed",
      },
      { id: "F2", severity: "P2", title: "nit", statement: "polish", evidence: [{ ref: "src/app.js" }], status: "confirmed" },
      { id: "F3", severity: "P1", title: "gone", statement: "dismissed", evidence: [{ ref: "src/app.js:1" }], status: "dismissed" },
    ],
  };
  return { cfg, doc, runDir };
}

describe("sarif — standard interchange export", () => {
  it("emits a SARIF 2.1.0 log with one result per live finding", () => {
    const { cfg, doc, runDir } = scaffold();
    const sarif = buildSarif(cfg, doc, runDir);
    expect(sarif.version).toBe("2.1.0");
    expect(String(sarif.$schema)).toMatch(/sarif/i);
    expect(sarif.runs[0]?.tool.driver.name).toBe("ultraeval");
    expect(sarif.runs[0]?.results.length).toBe(2); // dismissed excluded
  });

  it("maps severity to SARIF level and evidence to physical locations", () => {
    const { cfg, doc, runDir } = scaffold();
    const results = buildSarif(cfg, doc, runDir).runs[0]?.results ?? [];
    const r1 = results[0];
    const r2 = results[1];
    expect(r1?.level).toBe("error"); // P0
    expect(r2?.level).toBe("note"); // P2
    expect(r1?.locations?.[0]?.physicalLocation.artifactLocation.uri).toBe("src/app.js");
    expect(r1?.locations?.[0]?.physicalLocation.region?.startLine).toBe(2);
    expect(r1?.ruleId).toBe("ultraeval/security");
    expect(r1?.properties.findingId).toBe("F1");
  });
});
