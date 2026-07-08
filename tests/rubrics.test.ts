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
});
