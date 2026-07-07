// The version the engine/bundle reports; kept in lockstep with package.json and
// SKILL.md by scripts/sync-version.mjs during a semantic-release.
export const VERSION = "1.0.0";

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

// A scored evaluation axis. The engine ships starter dimensions per category;
// the research stage refines them.
export interface Dimension {
  id: string;
  name: string;
  weight: number;
  whatPerfectLooksLike: string;
}

export interface EvalConfig {
  target: string; // as the user gave it (may be relative)
  targetAbs: string; // resolved absolute path to the evaluated repo/dir
  kind: Kind;
  category: string;
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
  id: string; // F1, F2, ...
  dimension?: string;
  severity: Severity;
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
