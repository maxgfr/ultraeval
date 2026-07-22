import type { Dimension, DimensionAnchor, Kind } from "./types.js";
import { categoryKey } from "./util.js";

// Starter evaluation dimensions. `defaultDimensions` picks a set from the target
// KIND, then specializes by CATEGORY using the tweaks documented in
// references/rubric-library.md. The research stage refines weights/anchors; the
// score command normalizes by total weight, so sets need not sum to exactly 1.
//
// Every dimension carries machine-readable `anchors` tracing it to the clause of
// an external referential it operationalizes (rationale per mapping in
// references/rubric-library.md; normative rules in references/protocol.md).

const iso25010 = (ref: string, note?: string): DimensionAnchor => ({ standard: "ISO/IEC 25010:2023", ref, ...(note ? { note } : {}) });
const iso25059 = (ref: string): DimensionAnchor => ({ standard: "ISO/IEC 25059:2023", ref });
const informative = (standard: string, ref: string): DimensionAnchor => ({ standard, ref, note: "informative" });

const SKILL_DIMS: Dimension[] = [
  {
    id: "grounding",
    name: "Correctness & grounding",
    weight: 0.3,
    whatPerfectLooksLike: "every claim resolves to real source; gates pass on genuine AND fail on doctored artifacts",
    anchors: [iso25059("functional correctness for AI systems"), informative("RAGAS", "faithfulness / attributable-to-source")],
  },
  {
    id: "coverage",
    name: "Functional coverage",
    weight: 0.25,
    whatPerfectLooksLike: "every mode/command/flag/gate works as documented",
    anchors: [iso25010("Functional suitability — functional completeness")],
  },
  {
    id: "ux",
    name: "UX & meets-expectations",
    weight: 0.2,
    whatPerfectLooksLike: "the real deliverable is production-quality, low-friction",
    anchors: [iso25010("Interaction capability — operability, user engagement")],
  },
  {
    id: "safety",
    name: "Safety & robustness",
    weight: 0.15,
    whatPerfectLooksLike: "no destructive defaults; graceful degradation without deps/network",
    anchors: [iso25010("Safety — fail safe, operational constraint"), informative("NIST AI RMF 1.0", "Safe characteristic")],
  },
  {
    id: "docs",
    name: "Docs consistency",
    weight: 0.1,
    whatPerfectLooksLike: "SKILL.md, README, --help, and behavior agree; examples run",
    anchors: [iso25010("Interaction capability — user assistance"), informative("ISO/IEC/IEEE 26514:2022", "user documentation design")],
  },
];

const CODEBASE_DIMS: Dimension[] = [
  {
    id: "correctness",
    name: "Correctness",
    weight: 0.3,
    whatPerfectLooksLike: "correct on happy AND edge paths; no logic bugs",
    anchors: [iso25010("Functional suitability — functional correctness"), iso25010("Reliability — faultlessness")],
  },
  {
    id: "tests",
    name: "Test quality",
    weight: 0.2,
    whatPerfectLooksLike: "tests fail when the code is wrong (not just coverage %)",
    anchors: [iso25010("Maintainability — testability")],
  },
  {
    id: "security",
    name: "Security",
    weight: 0.2,
    whatPerfectLooksLike: "no exploitable source->sink flows; inputs validated",
    anchors: [iso25010("Security — confidentiality, integrity, resistance"), informative("OWASP Top 10 (2021)", "categories A01–A10")],
  },
  {
    id: "maintainability",
    name: "Maintainability",
    weight: 0.2,
    whatPerfectLooksLike: "clear boundaries, low duplication",
    anchors: [iso25010("Maintainability — modularity, analysability, modifiability")],
  },
  {
    id: "performance",
    name: "Performance",
    weight: 0.1,
    whatPerfectLooksLike: "no hot-path waste; scales to realistic inputs",
    anchors: [iso25010("Performance efficiency — time behaviour, resource utilization, capacity")],
  },
];

const SECURITY_DIMS: Dimension[] = [
  {
    id: "precision",
    name: "Precision",
    weight: 0.25,
    whatPerfectLooksLike: "reported findings are real exploitable issues, not false positives",
    anchors: [{ standard: "OWASP Benchmark", ref: "true-positive rate vs labelled corpus" }],
  },
  {
    id: "recall",
    name: "Recall",
    weight: 0.25,
    whatPerfectLooksLike: "known vulnerabilities in a labelled corpus are all found",
    anchors: [{ standard: "OWASP Benchmark", ref: "recall vs labelled corpus" }, informative("NIST SAMATE / Juliet", "labelled vulnerability test suites")],
  },
  {
    id: "false-positive-rate",
    name: "False-positive rate",
    weight: 0.2,
    whatPerfectLooksLike: "sanitized/safe code is never flagged",
    anchors: [{ standard: "OWASP Benchmark", ref: "false-positive rate on safe variants" }],
  },
  {
    id: "reachability",
    name: "Reachability",
    weight: 0.15,
    whatPerfectLooksLike: "flagged sinks are actually reachable from untrusted input",
    anchors: [{ standard: "CVSS v4.0", ref: "exploitability metrics (attack vector, complexity)", note: "interpretive" }],
  },
  {
    id: "maintainability",
    name: "Maintainability",
    weight: 0.15,
    whatPerfectLooksLike: "clear rules, easy to extend",
    anchors: [iso25010("Maintainability — modifiability")],
  },
];

const REQ_29148 = (characteristic: string): DimensionAnchor => ({
  standard: "ISO/IEC/IEEE 29148:2018",
  ref: `requirement characteristic — ${characteristic}`,
});

const REQUIREMENTS_DIMS: Dimension[] = [
  {
    id: "completeness",
    name: "Completeness",
    weight: 0.3,
    whatPerfectLooksLike: "every needed requirement is present; no gaps (ISO/IEC/IEEE 29148)",
    anchors: [REQ_29148("complete")],
  },
  {
    id: "consistency",
    name: "Consistency",
    weight: 0.25,
    whatPerfectLooksLike: "no contradictions across requirements/sections",
    anchors: [REQ_29148("consistent")],
  },
  {
    id: "verifiable-acceptance",
    name: "Verifiable acceptance",
    weight: 0.25,
    whatPerfectLooksLike: "every requirement has testable Given/When/Then acceptance criteria",
    anchors: [REQ_29148("verifiable")],
  },
  {
    id: "traceability",
    name: "Traceability",
    weight: 0.2,
    whatPerfectLooksLike: "requirements trace to scope/build tasks and back",
    anchors: [REQ_29148("traceable")],
  },
];

// Business/domain ("métier") evals judge ONLY the business logic — no generic
// security/perf/docs axes. Pairs with the `scope` config (init --scope) that
// narrows the eval to the domain code itself.
const BUSINESS_DIMS: Dimension[] = [
  {
    id: "business-correctness",
    name: "Business-rule correctness",
    weight: 0.35,
    whatPerfectLooksLike: "every business rule computes the documented outcome on realistic domain inputs; no logic bugs",
    anchors: [iso25010("Functional suitability — functional correctness")],
  },
  {
    id: "domain-model",
    name: "Domain-model coherence",
    weight: 0.25,
    whatPerfectLooksLike: "entities/terms match the domain language; one concept, one representation; boundaries make sense",
    anchors: [
      iso25010("Functional suitability — functional appropriateness"),
      informative("Domain-Driven Design (Evans 2003)", "ubiquitous language, bounded contexts"),
    ],
  },
  {
    id: "invariants",
    name: "Invariants & consistency",
    weight: 0.15,
    whatPerfectLooksLike: "domain invariants hold on every path; a rule-violating input is rejected with state left consistent",
    anchors: [iso25010("Reliability — faultlessness"), REQ_29148("verifiable")],
  },
  {
    id: "edge-cases-metier",
    name: "Functional edge cases",
    weight: 0.15,
    whatPerfectLooksLike: "boundary values, empty/overflow cases, and rule interactions are handled, not just the happy path",
    anchors: [iso25010("Functional suitability — functional completeness")],
  },
  {
    id: "rule-traceability",
    name: "Rule traceability",
    weight: 0.1,
    whatPerfectLooksLike: "each implemented rule traces to a documented business requirement and back",
    anchors: [REQ_29148("traceable")],
  },
];

const RESEARCH_DIMS: Dimension[] = [
  {
    id: "faithfulness",
    name: "Faithfulness",
    weight: 0.35,
    whatPerfectLooksLike: "every claim is attributable to a fetched source",
    anchors: [{ standard: "RAGAS", ref: "faithfulness" }, informative("AIS", "attributable to identified sources")],
  },
  {
    id: "retrieval",
    name: "Retrieval",
    weight: 0.25,
    whatPerfectLooksLike: "high recall@k and MRR for the needed evidence",
    anchors: [{ standard: "IR evaluation (TREC)", ref: "recall@k, MRR" }],
  },
  {
    id: "coverage",
    name: "Coverage",
    weight: 0.2,
    whatPerfectLooksLike: "the question is answered completely, not partially",
    anchors: [iso25010("Functional suitability — functional completeness")],
  },
  {
    id: "hallucination",
    name: "Hallucination control",
    weight: 0.2,
    whatPerfectLooksLike: "no ungrounded or fabricated statements survive the gate",
    anchors: [{ standard: "RAGAS", ref: "answer attribution / hallucination rate" }],
  },
];

const webFlavored = (base: Dimension[]): Dimension[] => [
  ...base,
  {
    id: "accessibility",
    name: "Accessibility (WCAG 2.2 AA)",
    weight: 0.15,
    whatPerfectLooksLike: "no blocking a11y violations",
    anchors: [{ standard: "WCAG 2.2", ref: "conformance level AA", note: "lineage ISO/IEC 40500" }],
  },
  {
    id: "auth",
    name: "AuthN / AuthZ",
    weight: 0.2,
    whatPerfectLooksLike: "sessions and authorization are correct; no IDOR",
    anchors: [iso25010("Security — authenticity, accountability"), informative("OWASP ASVS 4.0", "V2 authentication, V4 access control")],
  },
];

const cliFlavored = (base: Dimension[]): Dimension[] => [
  ...base,
  {
    id: "ergonomics",
    name: "Ergonomics",
    weight: 0.15,
    whatPerfectLooksLike: "clear --help, actionable errors, consistent exit codes",
    anchors: [iso25010("Interaction capability — operability, user error protection")],
  },
];

export function defaultDimensions(kind: Kind, category = ""): Dimension[] {
  const key = categoryKey(category);
  if (key === "security") return SECURITY_DIMS;
  if (key === "requirements") return REQUIREMENTS_DIMS;
  if (key === "business") return BUSINESS_DIMS;
  if (key === "research") return RESEARCH_DIMS;
  const base = kind === "skill" ? SKILL_DIMS : CODEBASE_DIMS;
  if (key === "web") return webFlavored(base);
  if (key === "cli") return cliFlavored(base);
  return base;
}
