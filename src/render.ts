import { join } from "node:path";
import type { Backlog, EvalConfig, FindingsDoc, Provenance, Scorecard, VerifyResult } from "./types.js";
import { exists, opportunityValue, readJson, writeText } from "./util.js";

// One-line anchor text for a dimension, joined from the config by id (the
// scorecard stays score-focused and does not duplicate anchors).
function anchorFor(cfg: EvalConfig, id: string): string {
  const d = (cfg.dimensions ?? []).find((x) => x.id === id);
  return d?.anchors?.length ? d.anchors.map((a) => `${a.standard} — ${a.ref}`).join("; ") : "—";
}

const provLine = (p?: Provenance): string =>
  p
    ? `engine ${p.engineVersion} · protocol ${p.protocolVersion} · rubric ${p.rubricVersion}${p.targetGit ? ` · target ${p.targetGit.commit.slice(0, 7)}${p.targetGit.dirty ? "*" : ""}` : ""}`
    : "";

export interface RenderOpts {
  out?: string;
  html?: boolean;
  md?: boolean;
}

function load(runDir: string) {
  const cfg = readJson<EvalConfig>(join(runDir, "eval.config.json"));
  const doc = readJson<FindingsDoc>(join(runDir, "findings.json"));
  const verify = exists(join(runDir, "VERIFY.json")) ? readJson<VerifyResult>(join(runDir, "VERIFY.json")) : null;
  const backlog = exists(join(runDir, "BACKLOG.json")) ? readJson<Backlog>(join(runDir, "BACKLOG.json")) : null;
  const scorecard = exists(join(runDir, "scorecard.json")) ? readJson<Scorecard>(join(runDir, "scorecard.json")) : null;
  return { cfg, doc, verify, backlog, scorecard };
}

export function render(runDir: string, opts: RenderOpts = {}): string[] {
  const { cfg, doc, verify, backlog, scorecard } = load(runDir);
  const out = opts.out ?? runDir;
  const written: string[] = [];
  if (opts.md !== false) {
    const p = join(out, "index.md");
    writeText(p, buildMd(cfg, doc, verify, backlog, scorecard));
    written.push(p);
  }
  if (opts.html !== false) {
    const p = join(out, "index.html");
    writeText(p, buildHtml(cfg, doc, verify, backlog, scorecard));
    written.push(p);
  }
  return written;
}

function counts(doc: FindingsDoc) {
  const live = doc.findings.filter((f) => f.status !== "dismissed");
  const defects = live.filter((f) => f.kind !== "opportunity");
  const opps = live.filter((f) => f.kind === "opportunity");
  const by = (s: string) => defects.filter((f) => f.severity === s).length;
  return { total: defects.length, p0: by("P0"), p1: by("P1"), p2: by("P2"), opps: opps.length };
}

function opportunities(doc: FindingsDoc) {
  return doc.findings
    .filter((f) => f.status !== "dismissed" && f.kind === "opportunity")
    .sort((a, b) => opportunityValue(b.impact, b.effort) - opportunityValue(a.impact, a.effort));
}

function buildMd(cfg: EvalConfig, doc: FindingsDoc, verify: VerifyResult | null, backlog: Backlog | null, scorecard: Scorecard | null): string {
  const c = counts(doc);
  const rows = doc.findings
    .filter((f) => f.status !== "dismissed" && f.kind !== "opportunity")
    .map((f) => `| ${f.id} | ${f.severity} | ${f.title.replace(/\|/g, "\\|")} | ${f.status} | ${(f.evidence ?? []).map((e) => `\`${e.ref}\``).join(" ")} |`)
    .join("\n");
  const prov = provLine(cfg.provenance);
  const parts = [
    `# Evaluation — ${cfg.target}`,
    ``,
    `> target \`${cfg.targetAbs}\` · ${cfg.kind} · ${cfg.category} · ${c.total} findings (P0 ${c.p0} · P1 ${c.p1} · P2 ${c.p2})${c.opps ? ` · ${c.opps} opportunities` : ""}`,
    ...(prov ? [`> ${prov}`] : []),
    ``,
  ];
  if (scorecard) {
    parts.push(
      `## Verdict — ${scorecard.meetsExpectations ? "✅ MEETS" : "❌ BELOW"} expectations · ${scorecard.overall}/100`,
      ``,
      `_${scorecard.reason} (${scorecard.judges} judge${scorecard.judges === 1 ? "" : "s"})_`,
      ``,
      `| dimension | score | weight | anchored to |`,
      `|-----------|-------|--------|-------------|`,
      ...scorecard.dimensions.map((d) => `| ${d.name} | ${d.score.toFixed(1)}/5 | ${d.weight} | ${anchorFor(cfg, d.id)} |`),
      ``,
    );
  }
  parts.push(`## Findings`, ``, `| id | sev | title | status | evidence |`, `|----|-----|-------|--------|----------|`, rows || `| — | — | none | — | — |`);
  const opps = opportunities(doc);
  if (opps.length)
    parts.push(
      ``,
      `## Opportunities (${opps.length}) — impact × effort`,
      ``,
      `| id | impact | effort | value | title |`,
      `|----|--------|--------|-------|-------|`,
      ...opps.map(
        (f) => `| ${f.id} | ${f.impact ?? "?"} | ${f.effort ?? "?"} | ${opportunityValue(f.impact, f.effort).toFixed(2)} | ${f.title.replace(/\|/g, "\\|")} |`,
      ),
      ``,
      `Quick wins (value ≥ 2): ${
        opps
          .filter((f) => opportunityValue(f.impact, f.effort) >= 2)
          .map((f) => f.id)
          .join(", ") || "—"
      }`,
    );
  if (verify)
    parts.push(
      ``,
      `## Verification`,
      ``,
      `${verify.ok ? "✅" : "❌"} ${verify.adjudicated} adjudicated · ${verify.supported} supported · ${verify.refuted} refuted · ${verify.unsupported} unsupported${verify.failures.length ? ` · fails: ${verify.failures.join(", ")}` : ""}`,
    );
  if (backlog)
    parts.push(
      ``,
      `## Fix backlog (${backlog.tasks.length})`,
      ``,
      backlog.tasks.map((t) => `- **${t.id}** (${t.priority}) ${t.title} → \`${t.red.testFile}\``).join("\n") || "- none",
    );
  return `${parts.join("\n")}\n`;
}

const STYLE = `body{font:15px/1.5 system-ui,sans-serif;max-width:60rem;margin:2rem auto;padding:0 1rem;color:#111}
h1{margin-bottom:.2rem}table{border-collapse:collapse;width:100%;margin:1rem 0}th,td{border:1px solid #ddd;padding:.4rem .6rem;text-align:left;font-size:14px}
.p0{color:#b00}.p1{color:#a60}.p2{color:#555}.meta{color:#666}code{background:#f4f4f4;padding:.05rem .3rem;border-radius:3px}
@media(prefers-color-scheme:dark){body{background:#111;color:#eee}th,td{border-color:#333}code{background:#222}.meta{color:#999}}`;

function buildHtml(cfg: EvalConfig, doc: FindingsDoc, verify: VerifyResult | null, backlog: Backlog | null, scorecard: Scorecard | null): string {
  const c = counts(doc);
  const verdict = scorecard
    ? `<h2>Verdict — ${scorecard.meetsExpectations ? "✅ MEETS" : "❌ BELOW"} expectations · ${scorecard.overall}/100</h2><p class="meta">${esc(scorecard.reason)} (${scorecard.judges} judge${scorecard.judges === 1 ? "" : "s"})</p><table><tr><th>dimension</th><th>score</th><th>weight</th><th>anchored to</th></tr>${scorecard.dimensions.map((d) => `<tr><td>${esc(d.name)}</td><td>${d.score.toFixed(1)}/5</td><td>${d.weight}</td><td>${esc(anchorFor(cfg, d.id))}</td></tr>`).join("")}</table>`
    : "";
  const rows = doc.findings
    .filter((f) => f.status !== "dismissed" && f.kind !== "opportunity")
    .map(
      (f) =>
        `<tr><td>${f.id}</td><td class="${f.severity.toLowerCase()}">${f.severity}</td><td>${esc(f.title)}</td><td>${f.status}</td><td>${(f.evidence ?? []).map((e) => `<code>${esc(e.ref)}</code>`).join(" ")}</td></tr>`,
    )
    .join("");
  const opps = opportunities(doc);
  const oppsHtml = opps.length
    ? `<h2>Opportunities (${opps.length}) — impact × effort</h2><table><tr><th>id</th><th>impact</th><th>effort</th><th>value</th><th>title</th></tr>${opps.map((f) => `<tr><td>${f.id}</td><td>${f.impact ?? "?"}</td><td>${f.effort ?? "?"}</td><td>${opportunityValue(f.impact, f.effort).toFixed(2)}</td><td>${esc(f.title)}</td></tr>`).join("")}</table>`
    : "";
  const bl = backlog
    ? `<h2>Fix backlog (${backlog.tasks.length})</h2><ul>${backlog.tasks.map((t) => `<li><b>${t.id}</b> (${t.priority}) ${esc(t.title)} → <code>${esc(t.red.testFile)}</code></li>`).join("")}</ul>`
    : "";
  const vf = verify
    ? `<h2>Verification</h2><p>${verify.ok ? "✅" : "❌"} ${verify.adjudicated} adjudicated · ${verify.supported} supported · ${verify.refuted} refuted · ${verify.unsupported} unsupported${verify.failures.length ? ` · fails: ${esc(verify.failures.join(", "))}` : ""}</p>`
    : "";
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ultraeval — ${esc(cfg.target)}</title><style>${STYLE}</style></head><body>
<h1>Evaluation — ${esc(cfg.target)}</h1>
<p class="meta"><code>${esc(cfg.targetAbs)}</code> · ${cfg.kind} · ${esc(cfg.category)} · ${c.total} findings (P0 ${c.p0} · P1 ${c.p1} · P2 ${c.p2})${c.opps ? ` · ${c.opps} opportunities` : ""}</p>
${provLine(cfg.provenance) ? `<p class="meta">${esc(provLine(cfg.provenance))}</p>` : ""}
${verdict}
<h2>Findings</h2><table><tr><th>id</th><th>sev</th><th>title</th><th>status</th><th>evidence</th></tr>${rows}</table>
${oppsHtml}
${vf}${bl}</body></html>
`;
}

function esc(s: string): string {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
