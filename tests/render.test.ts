import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { render } from "../src/render.js";

const tmps: string[] = [];

const prov = {
  engineVersion: "1.4.0",
  protocolVersion: "1",
  rubricVersion: "1",
  createdAt: "2026-01-01T00:00:00.000Z",
  mode: "deep",
  kind: "skill",
  category: "agent skill",
  dimensionsHash: "abc123def456",
  targetGit: { commit: "b".repeat(40), dirty: true },
};

function scaffold({ withProvenance = true, withAnchors = true } = {}): string {
  const run = mkdtempSync(join(tmpdir(), "ue-render-"));
  tmps.push(run);
  const dim = {
    id: "grounding",
    name: "Correctness & grounding",
    weight: 0.3,
    whatPerfectLooksLike: "x",
    ...(withAnchors ? { anchors: [{ standard: "ISO/IEC 25059:2023", ref: "functional correctness <for AI>" }] } : {}),
  };
  writeFileSync(
    join(run, "eval.config.json"),
    JSON.stringify({
      target: "t",
      targetAbs: "/t",
      kind: "skill",
      category: "agent skill",
      dimensions: [dim],
      version: "1.4.0",
      ...(withProvenance ? { provenance: prov } : {}),
    }),
  );
  writeFileSync(
    join(run, "findings.json"),
    JSON.stringify({ findings: [{ id: "F1", severity: "P1", title: "a <bad> thing", statement: "s", evidence: [{ ref: "a.js:1" }], status: "confirmed" }] }),
  );
  writeFileSync(
    join(run, "scorecard.json"),
    JSON.stringify({
      overall: 90,
      maxScore: 100,
      meetsExpectations: true,
      dimensions: [{ id: "grounding", name: "Correctness & grounding", weight: 0.3, score: 4.5 }],
      judges: 3,
      reason: "ok",
      ...(withProvenance ? { provenance: prov, scoredAt: "2026-01-02T00:00:00.000Z" } : {}),
    }),
  );
  return run;
}

afterEach(() => {
  for (const t of tmps.splice(0)) rmSync(t, { recursive: true, force: true });
});

describe("render — anchors & provenance surfacing", () => {
  it("index.md shows each dimension's standards anchor next to its score", () => {
    const run = scaffold();
    render(run);
    const md = readFileSync(join(run, "index.md"), "utf8");
    expect(md).toContain("ISO/IEC 25059:2023");
    expect(md).toMatch(/anchored/i);
  });

  it("index.md shows the run provenance (engine/protocol/rubric/target)", () => {
    const run = scaffold();
    render(run);
    const md = readFileSync(join(run, "index.md"), "utf8");
    expect(md).toMatch(/engine 1\.4\.0 · protocol 1 · rubric 1 · target bbbbbbb\*/);
  });

  it("index.html escapes anchor text and shows provenance", () => {
    const run = scaffold();
    render(run);
    const html = readFileSync(join(run, "index.html"), "utf8");
    expect(html).toContain("functional correctness &lt;for AI&gt;");
    expect(html).toMatch(/engine 1\.4\.0/);
  });

  it("a legacy run without anchors or provenance still renders both outputs", () => {
    const run = scaffold({ withProvenance: false, withAnchors: false });
    const written = render(run);
    expect(written.length).toBe(2);
    const md = readFileSync(join(run, "index.md"), "utf8");
    expect(md).toContain("Correctness & grounding");
    expect(md).not.toMatch(/engine .* · protocol/);
  });
});
