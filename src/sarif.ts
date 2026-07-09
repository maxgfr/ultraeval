import { join, relative, sep } from "node:path";
import type { EvalConfig, FindingsDoc, Severity } from "./types.js";
import { type LineCache, readJson, resolveEvidence, resolveTargetAbs, writeJson } from "./util.js";

// SARIF 2.1.0 (OASIS) export — lets GitHub code scanning and other standard
// tooling ingest an eval run directly. Levels map from the codified severities
// (protocol.md): P0 Critical -> error, P1 Major -> warning, P2 Minor -> note.

const LEVEL: Record<Severity, "error" | "warning" | "note"> = { P0: "error", P1: "warning", P2: "note" };

interface SarifLocation {
  physicalLocation: {
    artifactLocation: { uri: string };
    region?: { startLine: number; endLine?: number };
  };
}

export interface SarifResult {
  ruleId: string;
  level: "error" | "warning" | "note";
  message: { text: string };
  locations?: SarifLocation[];
  properties: Record<string, string>;
}

export interface SarifLog {
  $schema: string;
  version: "2.1.0";
  runs: {
    tool: { driver: { name: string; version: string; informationUri: string; rules: { id: string }[] } };
    results: SarifResult[];
  }[];
}

export function buildSarif(cfg: EvalConfig, doc: FindingsDoc, runDir: string): SarifLog {
  const targetAbs = resolveTargetAbs(cfg.targetAbs, cfg.target, runDir);
  // One run-scoped read cache shared across every evidence resolution, so a file
  // cited by K findings is read+split once — matching check.ts / verify.ts.
  const lineCache: LineCache = new Map();
  const live = (doc.findings ?? []).filter((f) => f.status !== "dismissed");
  const ruleOf = (f: (typeof live)[number]) => `ultraeval/${f.dimension ?? f.kind ?? "defect"}`;
  const results: SarifResult[] = live.map((f) => {
    const locations: SarifLocation[] = (f.evidence ?? [])
      .map((e) => resolveEvidence(e.ref, { targetAbs, runDir, lineCache }))
      .filter((r) => r.resolved && r.kind === "file" && r.absPath)
      .map((r) => ({
        physicalLocation: {
          artifactLocation: {
            uri: relative(targetAbs, r.absPath as string)
              .split(sep)
              .join("/"),
          },
          ...(r.lineStart ? { region: { startLine: r.lineStart, ...(r.lineEnd && r.lineEnd !== r.lineStart ? { endLine: r.lineEnd } : {}) } } : {}),
        },
      }));
    return {
      ruleId: ruleOf(f),
      level: LEVEL[f.severity] ?? "warning",
      message: { text: `${f.title} — ${f.statement}` },
      ...(locations.length ? { locations } : {}),
      properties: {
        findingId: f.id,
        severity: f.severity,
        status: f.status,
        ...(f.kind ? { kind: f.kind } : {}),
        ...(f.impact ? { impact: f.impact } : {}),
        ...(f.effort ? { effort: f.effort } : {}),
      },
    };
  });
  return {
    $schema: "https://docs.oasis-open.org/sarif/sarif/v2.1.0/errata01/os/schemas/sarif-schema-2.1.0.json",
    version: "2.1.0",
    runs: [
      {
        tool: {
          driver: {
            name: "ultraeval",
            version: cfg.version,
            informationUri: "https://github.com/maxgfr/ultraeval",
            rules: [...new Set(results.map((r) => r.ruleId))].map((id) => ({ id })),
          },
        },
        results,
      },
    ],
  };
}

export function writeSarif(runDir: string, out?: string): string {
  const cfg = readJson<EvalConfig>(join(runDir, "eval.config.json"));
  const doc = readJson<FindingsDoc>(join(runDir, "findings.json"));
  const p = join(out ?? runDir, "eval.sarif");
  writeJson(p, buildSarif(cfg, doc, runDir));
  return p;
}
