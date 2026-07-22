import { describe, expect, it } from "vitest";
import { defaultDimensions } from "../src/rubrics.js";

const ids = (kind: "skill" | "codebase", category: string) => defaultDimensions(kind, category).map((d) => d.id);

describe("rubrics — category-aware dimensions", () => {
  it("security category yields precision/recall/false-positive-rate", () => {
    const got = ids("codebase", "security tool");
    expect(got).toContain("precision");
    expect(got).toContain("recall");
    expect(got).toContain("false-positive-rate");
  });

  it("web category adds accessibility + auth to the base", () => {
    const got = ids("codebase", "web app");
    expect(got).toContain("accessibility");
    expect(got).toContain("auth");
  });

  it("research/RAG category yields faithfulness + retrieval", () => {
    const got = ids("skill", "research / RAG tool");
    expect(got).toContain("faithfulness");
    expect(got).toContain("retrieval");
  });

  it("requirements category yields traceability", () => {
    expect(ids("skill", "PRD / requirements generator")).toContain("traceability");
  });

  it("falls back to the kind base for a generic category", () => {
    expect(ids("skill", "agent skill")).toContain("grounding");
    expect(ids("codebase", "library")).toContain("correctness");
  });

  it("business/métier category yields business-logic dimensions only (no generic axes)", () => {
    const got = ids("codebase", "métier");
    expect(got).toContain("business-correctness");
    expect(got).toContain("domain-model");
    expect(got).toContain("invariants");
    expect(got).not.toContain("security");
    expect(got).not.toContain("performance");
    expect(got).not.toContain("accessibility");
    expect(got).not.toContain("docs");
  });

  it("business dimension weights sum to 1", () => {
    const total = defaultDimensions("codebase", "business logic").reduce((s, d) => s + d.weight, 0);
    expect(total).toBeCloseTo(1.0, 10);
  });
});

describe("rubrics — standards anchors", () => {
  const sets: [string, ReturnType<typeof defaultDimensions>][] = [
    ["skill base", defaultDimensions("skill", "agent skill")],
    ["codebase base", defaultDimensions("codebase", "library")],
    ["security", defaultDimensions("codebase", "security tool")],
    ["requirements", defaultDimensions("skill", "PRD / requirements generator")],
    ["research", defaultDimensions("skill", "research / RAG tool")],
    ["web", defaultDimensions("codebase", "web app")],
    ["cli", defaultDimensions("codebase", "CLI tool")],
    ["business", defaultDimensions("codebase", "métier")],
  ];

  it("every starter dimension carries at least one machine-readable anchor", () => {
    for (const [name, dims] of sets) {
      for (const d of dims) {
        expect(d.anchors?.length, `${name}:${d.id} has no anchors`).toBeGreaterThan(0);
        for (const a of d.anchors ?? []) {
          expect(a.standard, `${name}:${d.id}`).toBeTruthy();
          expect(a.ref, `${name}:${d.id}`).toBeTruthy();
        }
      }
    }
  });

  const anchorsOf = (dims: ReturnType<typeof defaultDimensions>) => dims.map((d) => JSON.stringify(d.anchors ?? []));

  it("codebase dimensions anchor to ISO/IEC 25010", () => {
    for (const a of anchorsOf(defaultDimensions("codebase", "library"))) expect(a).toMatch(/25010/);
  });

  it("skill dimensions anchor to ISO/IEC 25010 or 25059", () => {
    for (const a of anchorsOf(defaultDimensions("skill", "agent skill"))) expect(a).toMatch(/25010|25059/);
  });

  it("requirements dimensions anchor to ISO/IEC/IEEE 29148", () => {
    for (const a of anchorsOf(defaultDimensions("skill", "PRD / requirements generator"))) expect(a).toMatch(/29148/);
  });

  it("security dimensions anchor to a labelled corpus methodology", () => {
    expect(anchorsOf(defaultDimensions("codebase", "security tool")).join(" ")).toMatch(/OWASP|Juliet|SAMATE/);
  });

  it("web accessibility anchors to WCAG 2.2", () => {
    const a11y = defaultDimensions("codebase", "web app").find((d) => d.id === "accessibility");
    expect(JSON.stringify(a11y?.anchors ?? [])).toMatch(/WCAG 2\.2/);
  });

  it("business dimensions anchor to ISO/IEC 25010 functional suitability and ISO/IEC/IEEE 29148", () => {
    const all = anchorsOf(defaultDimensions("codebase", "métier")).join(" ");
    expect(all).toMatch(/25010/);
    expect(all).toMatch(/29148/);
  });
});
