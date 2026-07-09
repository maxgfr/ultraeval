// The version the engine/bundle reports; kept in lockstep with package.json and
// SKILL.md by scripts/sync-version.mjs during a semantic-release.
export const VERSION = "1.3.0";

// ---- caps / knobs --------------------------------------------------------
export const CAPS = {
  maxVerify: 60, // claim<->evidence pairs a single verify worklist emits
  minClaimWords: 6, // a report line shorter than this is not treated as a factual claim
  coverageMin: 0.6, // default fraction of report claim-units that must carry a citation
  coverageStrict: 1.0, // --strict raises coverage to this
} as const;

export type Kind = "skill" | "codebase";
export type Severity = "P0" | "P1" | "P2";
export type Status = "open" | "confirmed" | "dismissed";
export type Verdict = "supported" | "partial" | "refuted" | "unsupported";

export const VALID_VERDICTS: readonly Verdict[] = ["supported", "partial", "refuted", "unsupported"];
export const VALID_SEVERITIES: readonly Severity[] = ["P0", "P1", "P2"];

// The single normative source for what P0/P1/P2 mean (normative text:
// references/protocol.md). Band language aligns with CVSS v4.0 qualitative
// ratings; the membership test is degradation of a scored dimension.
// templates.ts (contracts + findings.schema.json) and backlog.ts derive their
// prose from here so auditors and subagents share one definition.
export interface SeverityDef {
  label: string;
  cvssBand: string;
  meaning: string;
  gateEffect: string;
}
export const SEVERITY_DEFS: Record<Severity, SeverityDef> = {
  P0: {
    label: "Critical",
    cvssBand: "Critical/High",
    meaning: "breaks trust, correctness, safety, or data integrity of the primary deliverable; the documented main path fails",
    gateEffect: "caps meets-expectations at false while unresolved",
  },
  P1: {
    label: "Major",
    cvssBand: "Medium",
    meaning: "materially degrades a scored dimension (fidelity, coverage, robustness); a workaround or secondary path exists",
    gateEffect: "weighs on the dimension score and leads the backlog after P0",
  },
  P2: {
    label: "Minor",
    cvssBand: "Low",
    meaning: "polish, consistency, or documentation drift; no scored dimension materially degraded",
    gateEffect: "informs the backlog tail; never blocks the verdict",
  },
};

// A finding is a DEFECT (something wrong) or an OPPORTUNITY (a grounded improvement lead).
export type FindingKind = "defect" | "opportunity";
export type Impact = "high" | "med" | "low";
export type Effort = "S" | "M" | "L";
export const VALID_IMPACT: readonly Impact[] = ["high", "med", "low"];
export const VALID_EFFORT: readonly Effort[] = ["S", "M", "L"];

// audit = defects only (default) · improve = opportunities · deep = both
export type Mode = "audit" | "improve" | "deep";
export const VALID_MODES: readonly Mode[] = ["audit", "improve", "deep"];

// A machine-readable link from a dimension to the clause of an external
// referential it operationalizes (ISO/IEC 25010, WCAG, OWASP Benchmark, ...).
// `note` flags informative or interpretive mappings; the rationale for each
// mapping lives in references/rubric-library.md.
export interface DimensionAnchor {
  standard: string; // e.g. "ISO/IEC 25010:2023"
  ref: string; // e.g. "Maintainability — testability"
  note?: string;
}

// A scored evaluation axis. The engine ships starter dimensions per category;
// the research stage refines them (it may refine anchors, never silently drop them).
export interface Dimension {
  id: string;
  name: string;
  weight: number;
  whatPerfectLooksLike: string;
  anchors?: DimensionAnchor[];
}

export interface EvalConfig {
  target: string; // as the user gave it (may be relative)
  targetAbs: string; // resolved absolute path to the evaluated repo/dir
  kind: Kind;
  category: string;
  mode?: Mode; // audit (default) | improve | deep
  dimensions: Dimension[];
  note?: string;
  version: string;
}

// Where a finding is grounded. Grammar of `ref` (see references/gate-contract.md):
//   "path:line" | "path:start-end"  -> a location in the TARGET repo (resolved + range-checked)
//   "run:relpath" | "run:relpath#Lnn" -> a file the eval run itself produced (a log/artifact)
//   "url:https://..."                -> an external page (recorded, not resolvable offline)
export interface Evidence {
  ref: string;
  note?: string;
}

export interface Finding {
  id: string; // F1, F2, ... (opportunities too — one id space)
  kind?: FindingKind; // "defect" (default) or "opportunity"
  dimension?: string;
  severity: Severity;
  impact?: Impact; // opportunities: value axis (required for kind=opportunity)
  effort?: Effort; // opportunities: cost axis (required for kind=opportunity)
  title: string;
  statement: string;
  evidence: Evidence[];
  failureScenario?: string;
  recommendation?: string;
  status: Status;
}

export interface FindingsDoc {
  findings: Finding[];
}

// An improvement lead authored by the brainstorm stage (before `--rank` turns it
// into a kind:"opportunity" Finding with an id).
export interface Opportunity {
  dimension?: string;
  impact: Impact;
  effort: Effort;
  title: string;
  statement: string;
  evidence: Evidence[];
  recommendation?: string;
}

// ---- deterministic analysis (the `analyze` command) ----------------------
export interface Hotspot {
  path: string;
  loc: number;
  churn?: number; // commits touching this file (git churn)
  reason: string;
}
export interface Analysis {
  target: string;
  files: number;
  loc: number;
  languages: Record<string, number>; // ext -> file count
  hotspots: Hotspot[];
  deps: { edges: number; cycles: string[][] };
  tests: { sourceFiles: number; testFiles: number; ratio: number; untested: string[] };
  todos: number; // TODO/FIXME/HACK/XXX markers
  docs: string[]; // README/DOCUMENTATION/… present at root
}

// ---- verify worklist -----------------------------------------------------
export interface VerifyPair {
  claimId: string; // finding id
  evidenceRef: string;
  claim: string;
  digest: string; // the extracted source/log context the skeptic judges against
  verdict: Verdict | null;
  note: string;
}
export interface VerifyTodo {
  run: string;
  pairs: VerifyPair[];
}
export interface VerdictItem {
  claimId: string;
  evidenceRef?: string;
  verdict: Verdict;
  note?: string;
}
export interface VerdictsFile {
  pairs?: VerdictItem[];
}
export interface VerifyResult {
  ok: boolean;
  adjudicated: number;
  supported: number;
  partial: number;
  refuted: number;
  unsupported: number;
  failures: string[]; // finding ids whose evidence does not hold up
  unadjudicated: string[]; // finding ids with pairs still lacking a verdict
  verdicts: VerdictItem[];
}

// ---- backlog / TDD fix cards --------------------------------------------
export interface FixTask {
  id: string; // FIX-001
  findingId: string;
  kind: FindingKind; // defect | opportunity
  priority: Severity;
  title: string;
  rationale: string;
  targets: string[]; // files the fix touches (from the finding evidence)
  red: { testFile: string; description: string }; // the failing test to write FIRST
  green: { change: string }; // the minimal change to make it pass
  verify: { command: string }; // how to confirm green
  dependsOn: string[];
}
export interface Backlog {
  target: string;
  generatedFrom: string;
  tasks: FixTask[];
}

export interface CheckResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
}

// ---- scoring -------------------------------------------------------------
// One line of judges.jsonl, written by each judge subagent.
export interface JudgeLine {
  lens?: string;
  dimensionScores?: { id: string; score: number; rationale?: string }[];
  overall?: number;
  meetsExpectations?: boolean;
  topFindings?: string[];
}

export interface Scorecard {
  overall: number; // 0-100 weighted
  maxScore: number; // 100
  meetsExpectations: boolean;
  dimensions: { id: string; name: string; weight: number; score: number }[]; // 0-5 avg across judges
  judges: number;
  reason: string;
}

// meets-expectations bar: below this weighted score it is false regardless of votes
export const MEETS_BAR = 80;
