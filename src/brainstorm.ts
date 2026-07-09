import { join } from "node:path";
import type { Analysis, EvalConfig, FindingsDoc, Opportunity } from "./types.js";
import { VALID_EFFORT, VALID_IMPACT } from "./types.js";
import { exists, opportunityPriority, opportunityValue, readJson, titleKey, writeJson, writeText } from "./util.js";

// Divergent → convergent, grounded. Phase A emits a structured worklist across
// lenses (internal health + product); the AI fills opportunities.json; Phase B
// (--rank) dedups, ranks by value, and folds them into findings.json as
// kind:"opportunity" so the grounding gate and backlog apply.

const LENSES: { id: string; group: "internal" | "product"; q: string }[] = [
  { id: "simplify", group: "internal", q: "What could be simpler or removed — dead code, duplication, over-abstraction?" },
  { id: "performance", group: "internal", q: "What does needless work on a hot path or at scale?" },
  { id: "security", group: "internal", q: "What untrusted input reaches a sink unvalidated; what secret/authz risk?" },
  { id: "testability", group: "internal", q: "What is untested or hard to test; what characterization test is missing?" },
  { id: "dx", group: "internal", q: "What confuses a contributor — an error message, flag, default, or unclear name?" },
  { id: "architecture", group: "internal", q: "What boundary is muddy; which hotspot module does too much and should split?" },
  { id: "feature-gap", group: "product", q: "What capability would a user reasonably expect that is missing?" },
  { id: "new-mode", group: "product", q: "What new command/flag/mode would multiply the tool's value?" },
  { id: "adjacent", group: "product", q: "What adjacent use-case is one small step away?" },
];

export function runBrainstorm(runDir: string): { lenses: number } {
  const cfg = readJson<EvalConfig>(join(runDir, "eval.config.json"));
  const analysis = exists(join(runDir, "analysis.json")) ? readJson<Analysis>(join(runDir, "analysis.json")) : null;
  writeText(join(runDir, "BRAINSTORM.todo.md"), renderTodo(cfg, analysis));
  return { lenses: LENSES.length };
}

function renderTodo(cfg: EvalConfig, a: Analysis | null): string {
  const hot =
    a?.hotspots
      .slice(0, 8)
      .map((h) => `- \`${h.path}\` (${h.reason})`)
      .join("\n") || "- (run `analyze` first for hotspots)";
  const dims = (cfg.dimensions ?? []).map((d) => `- ${d.id}: ${d.name}`).join("\n");
  const internal = LENSES.filter((l) => l.group === "internal");
  const product = LENSES.filter((l) => l.group === "product");
  const lensBlock = (ls: typeof LENSES) => ls.map((l) => `- **${l.id}** — ${l.q}`).join("\n");
  return `# Brainstorm worklist — ${cfg.target}

Generate MANY candidate improvement leads (be divergent), then keep the grounded ones. Target: \`${cfg.targetAbs}\`.

## Hotspots to anchor on
${hot}

## Dimensions
${dims}

## Lenses — internal health
${lensBlock(internal)}

## Lenses — product / capability
${lensBlock(product)}

## Output: write \`opportunities.json\`

\`{ "opportunities": [ { "dimension"?, "impact": "high|med|low", "effort": "S|M|L", "title", "statement", "recommendation", "evidence": [ { "ref": "src/x.ts:42" | "analysis:src/x.ts" } ] } ] }\`

Rules (the gate enforces them after \`brainstorm --rank\`):
- Every opportunity MUST cite a resolvable anchor — a real \`file:line\` in the target, or \`analysis:<file>\` for a metric-driven one. No ungrounded "rewrite everything".
- Rate impact (value) and effort (cost) honestly; quick wins are high-impact + low-effort.
- Then run \`brainstorm --rank\` to fold them into findings.json (ranked by impact/effort) and \`check\` to gate them.
`;
}

export interface RankResult {
  added: number;
  total: number;
  skipped: { title?: string; reason: string }[]; // account for every entry not folded
}

export function rankBrainstorm(runDir: string): RankResult {
  const oppsPath = join(runDir, "opportunities.json");
  if (!exists(oppsPath)) throw new Error("no opportunities.json — fill the BRAINSTORM.todo.md worklist first");
  const opps = readJson<{ opportunities?: Opportunity[] }>(oppsPath).opportunities ?? [];
  const doc: FindingsDoc = exists(join(runDir, "findings.json")) ? readJson<FindingsDoc>(join(runDir, "findings.json")) : { findings: [] };

  let maxN = 0;
  for (const f of doc.findings) {
    const m = /^F(\d+)$/.exec(f.id);
    if (m?.[1]) maxN = Math.max(maxN, Number(m[1]));
  }
  const seen = new Set(doc.findings.filter((f) => f.kind === "opportunity").map((f) => titleKey(f.title)));

  const ranked = [...opps].sort((x, y) => opportunityValue(y.impact, y.effort) - opportunityValue(x.impact, x.effort));
  let added = 0;
  const skipped: RankResult["skipped"] = [];
  for (const o of ranked) {
    if (!o?.title) {
      skipped.push({ reason: "missing title" });
      continue;
    }
    if (seen.has(titleKey(o.title))) {
      skipped.push({ title: o.title, reason: "duplicate title (already folded or present)" });
      continue;
    }
    if (!VALID_IMPACT.includes(o.impact) || !VALID_EFFORT.includes(o.effort)) {
      skipped.push({ title: o.title, reason: `invalid impact/effort "${o.impact}/${o.effort}" (expected high|med|low / S|M|L)` });
      continue;
    }
    seen.add(titleKey(o.title));
    maxN++;
    doc.findings.push({
      id: `F${maxN}`,
      kind: "opportunity",
      dimension: o.dimension,
      severity: opportunityPriority(o.impact),
      impact: o.impact,
      effort: o.effort,
      title: o.title,
      statement: o.statement,
      evidence: o.evidence ?? [],
      recommendation: o.recommendation,
      // Folded, not adjudicated: verify/adjudication decides confirmed|dismissed,
      // and check's still-open warning keeps the gap visible until then.
      status: "open",
    });
    added++;
  }
  writeJson(join(runDir, "findings.json"), doc);
  return { added, total: doc.findings.length, skipped };
}
