import { describe, expect, it } from "vitest";
import { defaultDimensions } from "../src/rubrics.js";
import { agentContracts } from "../src/templates.js";
import type { EvalConfig, Kind } from "../src/types.js";
import { categoryKey } from "../src/util.js";

// FIX-011: the category→rubric matcher (defaultDimensions) and the
// category→live-scenario matcher (liveScenarioFor, via agentContracts) shared a
// hand-mirrored 5-regex ladder. These pin the CURRENT observable output of BOTH
// consumers for a representative category in each bucket, so extracting the
// shared categoryKey() helper stays behavior-preserving.

const cfg = (kind: Kind, category: string): EvalConfig =>
  ({
    target: "t",
    targetAbs: "/t",
    kind,
    category,
    mode: "deep",
    dimensions: [{ id: "correctness", name: "Correctness", weight: 1, whatPerfectLooksLike: "x" }],
    version: "1.0.0",
  }) as EvalConfig;

const ids = (kind: Kind, category: string) => defaultDimensions(kind, category).map((d) => d.id);
const executor = (kind: Kind, category: string) => agentContracts(cfg(kind, category), "/run", "/engine.mjs").executor as string;

// The distinctive golden-path line embedded per scenario bucket.
const GOLDEN = {
  security: "scan a small labelled vulnerable fixture",
  requirements: "render/validate the spec suite",
  research: "ask a question answerable from a small local corpus",
  web: "boot the app locally and drive the primary user journey",
  cli: "run the README's first documented command sequence",
  skill: "follow SKILL.md's quickstart",
  library: "import the package and run the README quickstart snippet",
};

describe("category buckets — defaultDimensions (rubric) output is pinned", () => {
  it("security", () => {
    expect(ids("codebase", "security tool")).toEqual(["precision", "recall", "false-positive-rate", "reachability", "maintainability"]);
  });
  it("requirements", () => {
    expect(ids("skill", "PRD / requirements generator")).toEqual(["completeness", "consistency", "verifiable-acceptance", "traceability"]);
  });
  it("research", () => {
    expect(ids("skill", "research / RAG tool")).toEqual(["faithfulness", "retrieval", "coverage", "hallucination"]);
  });
  it("web (codebase base + accessibility/auth)", () => {
    expect(ids("codebase", "web app")).toEqual(["correctness", "tests", "security", "maintainability", "performance", "accessibility", "auth"]);
  });
  it("web (skill base + accessibility/auth)", () => {
    expect(ids("skill", "web app")).toEqual(["grounding", "coverage", "ux", "safety", "docs", "accessibility", "auth"]);
  });
  it("cli (codebase base + ergonomics)", () => {
    expect(ids("codebase", "CLI tool")).toEqual(["correctness", "tests", "security", "maintainability", "performance", "ergonomics"]);
  });
  it("none → codebase base", () => {
    expect(ids("codebase", "library")).toEqual(["correctness", "tests", "security", "maintainability", "performance"]);
  });
  it("none → skill base", () => {
    expect(ids("skill", "agent skill")).toEqual(["grounding", "coverage", "ux", "safety", "docs"]);
  });
});

describe("category buckets — live-scenario (executor contract) output is pinned", () => {
  it("security", () => expect(executor("codebase", "security tool")).toContain(GOLDEN.security));
  it("requirements", () => expect(executor("skill", "PRD / requirements generator")).toContain(GOLDEN.requirements));
  it("research", () => expect(executor("skill", "research / RAG tool")).toContain(GOLDEN.research));
  it("web", () => expect(executor("codebase", "web app")).toContain(GOLDEN.web));
  it("cli", () => expect(executor("codebase", "CLI tool")).toContain(GOLDEN.cli));
  it("none + skill kind → agent-skill scenario", () => expect(executor("skill", "agent skill")).toContain(GOLDEN.skill));
  it("none + codebase kind → library scenario", () => expect(executor("codebase", "library")).toContain(GOLDEN.library));
});

describe("categoryKey — the shared matcher", () => {
  it("maps representative categories to their bucket", () => {
    expect(categoryKey("security tool")).toBe("security");
    expect(categoryKey("SAST scanner")).toBe("security");
    expect(categoryKey("PRD / requirements generator")).toBe("requirements");
    expect(categoryKey("research / RAG tool")).toBe("research");
    expect(categoryKey("web app")).toBe("web");
    expect(categoryKey("CLI tool")).toBe("cli");
  });
  it("returns null for a category matching no specialization", () => {
    expect(categoryKey("library")).toBeNull();
    expect(categoryKey("agent skill")).toBeNull();
    expect(categoryKey("")).toBeNull();
  });
  it("preserves precedence: research is tested before web (e.g. 'web search' → research)", () => {
    expect(categoryKey("web search")).toBe("research");
  });
});

describe("both consumers are driven by the same categoryKey (no drift)", () => {
  const SCEN: Record<string, string> = {
    security: GOLDEN.security,
    requirements: GOLDEN.requirements,
    research: GOLDEN.research,
    web: GOLDEN.web,
    cli: GOLDEN.cli,
  };
  const DIMS: Record<string, string[]> = {
    security: ["precision", "recall", "false-positive-rate", "reachability", "maintainability"],
    requirements: ["completeness", "consistency", "verifiable-acceptance", "traceability"],
    research: ["faithfulness", "retrieval", "coverage", "hallucination"],
    web: ["correctness", "tests", "security", "maintainability", "performance", "accessibility", "auth"],
    cli: ["correctness", "tests", "security", "maintainability", "performance", "ergonomics"],
  };
  for (const c of ["security tool", "PRD / requirements generator", "research / RAG tool", "web app", "CLI tool"]) {
    it(`"${c}" resolves to one shared bucket in both the rubric and the scenario`, () => {
      const key = categoryKey(c) as string;
      expect(ids("codebase", c)).toEqual(DIMS[key]);
      expect(executor("codebase", c)).toContain(SCEN[key] as string);
    });
  }
  it("an unmatched category falls back to the kind base in both", () => {
    expect(categoryKey("some random project")).toBeNull();
    expect(ids("codebase", "some random project")).toEqual(["correctness", "tests", "security", "maintainability", "performance"]);
    expect(executor("codebase", "some random project")).toContain(GOLDEN.library);
  });
});
