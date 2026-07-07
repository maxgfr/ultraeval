import type { Dimension, Kind } from "./types.js";

// Starter evaluation dimensions per target kind. The research stage refines
// these (weights, wording) against real methodology; they are a sane default so
// `plan` can emit a workflow immediately.
export function defaultDimensions(kind: Kind, _category: string): Dimension[] {
  if (kind === "skill") {
    return [
      {
        id: "grounding",
        name: "Correctness & grounding",
        weight: 0.3,
        whatPerfectLooksLike: "Every finding/claim resolves to real source; anti-hallucination gates pass on genuine artifacts AND fail on doctored ones.",
      },
      {
        id: "coverage",
        name: "Functional coverage",
        weight: 0.25,
        whatPerfectLooksLike: "Every mode, command, flag and gate works as documented; no half-implemented surface.",
      },
      {
        id: "ux",
        name: "UX & meets-expectations",
        weight: 0.2,
        whatPerfectLooksLike: "The real deliverable is production-quality, readable, low-friction; failure modes are graceful.",
      },
      {
        id: "safety",
        name: "Safety & robustness",
        weight: 0.15,
        whatPerfectLooksLike: "No destructive defaults, no data loss, graceful degradation when deps/network are absent.",
      },
      {
        id: "docs",
        name: "Docs consistency",
        weight: 0.1,
        whatPerfectLooksLike: "SKILL.md, README, --help and actual behavior agree; documented examples run.",
      },
    ];
  }
  return [
    {
      id: "correctness",
      name: "Correctness",
      weight: 0.3,
      whatPerfectLooksLike: "Behaves correctly on happy paths AND edge cases; no logic bugs on the evaluated surface.",
    },
    {
      id: "tests",
      name: "Test quality",
      weight: 0.2,
      whatPerfectLooksLike: "Meaningful tests cover the behavior and fail when the code is wrong (not just coverage %).",
    },
    { id: "security", name: "Security", weight: 0.2, whatPerfectLooksLike: "No exploitable source→sink flows; inputs validated; secrets and authz handled." },
    {
      id: "maintainability",
      name: "Maintainability",
      weight: 0.2,
      whatPerfectLooksLike: "Clear module boundaries, low duplication, code a newcomer can follow.",
    },
    { id: "performance", name: "Performance", weight: 0.1, whatPerfectLooksLike: "No obvious hot-path waste; scales to realistic inputs." },
  ];
}
