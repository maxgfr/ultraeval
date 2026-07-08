import { join } from "node:path";
import type { Analysis, EvalConfig, FindingsDoc, Opportunity } from "./types.js";
import { exists, opportunityPriority, opportunityValue, readJson, writeJson, writeText } from "./util.js";

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

export function rankBrainstorm(runDir: string): { added: number; total: number } {
  const oppsPath = join(runDir, "opportunities.json");
  if (!exists(oppsPath)) throw new Error("no opportunities.json — fill the BRAINSTORM.todo.md worklist first");
  const opps = readJson<{ opportunities?: Opportunity[] }>(oppsPath).opportunities ?? [];
  const doc: FindingsDoc = exists(join(runDir, "findings.json")) ? readJson<FindingsDoc>(join(runDir, "findings.json")) : { findings: [] };

  let maxN = 0;
  for (const f of doc.findings) {
    const m = /^F(\d+)$/.exec(f.id);
    if (m?.[1]) maxN = Math.max(maxN, Number(m[1]));
  }
  const key = (o: { title: string }) => o.title.toLowerCase().trim();
  const seen = new Set(doc.findings.filter((f) => f.kind === "opportunity").map((f) => key(f)));

  const ranked = [...opps].sort((x, y) => opportunityValue(y.impact, y.effort) - opportunityValue(x.impact, x.effort));
  let added = 0;
  for (const o of ranked) {
    if (!o?.title || seen.has(key(o))) continue;
    seen.add(key(o));
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
      status: "confirmed",
    });
    added++;
  }
  writeJson(join(runDir, "findings.json"), doc);
  return { added, total: doc.findings.length };
}
