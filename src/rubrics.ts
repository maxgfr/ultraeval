import type { Dimension, Kind } from "./types.js";

// Starter evaluation dimensions. `defaultDimensions` picks a set from the target
// KIND, then specializes by CATEGORY using the tweaks documented in
// references/rubric-library.md. The research stage refines weights/anchors; the
// score command normalizes by total weight, so sets need not sum to exactly 1.

const SKILL_DIMS: Dimension[] = [
  {
    id: "grounding",
    name: "Correctness & grounding",
    weight: 0.3,
    whatPerfectLooksLike: "every claim resolves to real source; gates pass on genuine AND fail on doctored artifacts",
  },
  { id: "coverage", name: "Functional coverage", weight: 0.25, whatPerfectLooksLike: "every mode/command/flag/gate works as documented" },
  { id: "ux", name: "UX & meets-expectations", weight: 0.2, whatPerfectLooksLike: "the real deliverable is production-quality, low-friction" },
  { id: "safety", name: "Safety & robustness", weight: 0.15, whatPerfectLooksLike: "no destructive defaults; graceful degradation without deps/network" },
  { id: "docs", name: "Docs consistency", weight: 0.1, whatPerfectLooksLike: "SKILL.md, README, --help, and behavior agree; examples run" },
];

const CODEBASE_DIMS: Dimension[] = [
  { id: "correctness", name: "Correctness", weight: 0.3, whatPerfectLooksLike: "correct on happy AND edge paths; no logic bugs" },
  { id: "tests", name: "Test quality", weight: 0.2, whatPerfectLooksLike: "tests fail when the code is wrong (not just coverage %)" },
  { id: "security", name: "Security", weight: 0.2, whatPerfectLooksLike: "no exploitable source->sink flows; inputs validated" },
  { id: "maintainability", name: "Maintainability", weight: 0.2, whatPerfectLooksLike: "clear boundaries, low duplication" },
  { id: "performance", name: "Performance", weight: 0.1, whatPerfectLooksLike: "no hot-path waste; scales to realistic inputs" },
];

const SECURITY_DIMS: Dimension[] = [
  { id: "precision", name: "Precision", weight: 0.25, whatPerfectLooksLike: "reported findings are real exploitable issues, not false positives" },
  { id: "recall", name: "Recall", weight: 0.25, whatPerfectLooksLike: "known vulnerabilities in a labelled corpus are all found" },
  { id: "false-positive-rate", name: "False-positive rate", weight: 0.2, whatPerfectLooksLike: "sanitized/safe code is never flagged" },
  { id: "reachability", name: "Reachability", weight: 0.15, whatPerfectLooksLike: "flagged sinks are actually reachable from untrusted input" },
  { id: "maintainability", name: "Maintainability", weight: 0.15, whatPerfectLooksLike: "clear rules, easy to extend" },
];

const REQUIREMENTS_DIMS: Dimension[] = [
  { id: "completeness", name: "Completeness", weight: 0.3, whatPerfectLooksLike: "every needed requirement is present; no gaps (ISO/IEC/IEEE 29148)" },
  { id: "consistency", name: "Consistency", weight: 0.25, whatPerfectLooksLike: "no contradictions across requirements/sections" },
  {
    id: "verifiable-acceptance",
    name: "Verifiable acceptance",
    weight: 0.25,
    whatPerfectLooksLike: "every requirement has testable Given/When/Then acceptance criteria",
  },
  { id: "traceability", name: "Traceability", weight: 0.2, whatPerfectLooksLike: "requirements trace to scope/build tasks and back" },
];

const RESEARCH_DIMS: Dimension[] = [
  { id: "faithfulness", name: "Faithfulness", weight: 0.35, whatPerfectLooksLike: "every claim is attributable to a fetched source" },
  { id: "retrieval", name: "Retrieval", weight: 0.25, whatPerfectLooksLike: "high recall@k and MRR for the needed evidence" },
  { id: "coverage", name: "Coverage", weight: 0.2, whatPerfectLooksLike: "the question is answered completely, not partially" },
  { id: "hallucination", name: "Hallucination control", weight: 0.2, whatPerfectLooksLike: "no ungrounded or fabricated statements survive the gate" },
];

const webFlavored = (base: Dimension[]): Dimension[] => [
  ...base,
  { id: "accessibility", name: "Accessibility (WCAG 2.2 AA)", weight: 0.15, whatPerfectLooksLike: "no blocking a11y violations" },
  { id: "auth", name: "AuthN / AuthZ", weight: 0.2, whatPerfectLooksLike: "sessions and authorization are correct; no IDOR" },
];

const cliFlavored = (base: Dimension[]): Dimension[] => [
  ...base,
  { id: "ergonomics", name: "Ergonomics", weight: 0.15, whatPerfectLooksLike: "clear --help, actionable errors, consistent exit codes" },
];

export function defaultDimensions(kind: Kind, category = ""): Dimension[] {
  const cat = category.toLowerCase();
  if (/secur|sast|vuln|taint|pentest|appsec/.test(cat)) return SECURITY_DIMS;
  if (/requirement|\bprd\b|\bsrd\b|\bspec\b|specification/.test(cat)) return REQUIREMENTS_DIMS;
  if (/research|\brag\b|retrieval|search|documentation|\bq&a\b|\bqa\b/.test(cat)) return RESEARCH_DIMS;
  const base = kind === "skill" ? SKILL_DIMS : CODEBASE_DIMS;
  if (/\bweb\b|frontend|browser|website|\bsite\b|web app|webapp/.test(cat)) return webFlavored(base);
  if (/\bcli\b|command.?line|terminal/.test(cat)) return cliFlavored(base);
  return base;
}
