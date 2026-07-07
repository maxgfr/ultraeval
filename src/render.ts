import { join } from "node:path";
import type { Backlog, EvalConfig, FindingsDoc, VerifyResult } from "./types.js";
import { exists, readJson, writeText } from "./util.js";

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
  return { cfg, doc, verify, backlog };
}

export function render(runDir: string, opts: RenderOpts = {}): string[] {
  const { cfg, doc, verify, backlog } = load(runDir);
  const out = opts.out ?? runDir;
  const written: string[] = [];
  if (opts.md !== false) {
    const p = join(out, "index.md");
    writeText(p, buildMd(cfg, doc, verify, backlog));
    written.push(p);
  }
  if (opts.html !== false) {
    const p = join(out, "index.html");
    writeText(p, buildHtml(cfg, doc, verify, backlog));
    written.push(p);
  }
  return written;
}

function counts(doc: FindingsDoc) {
  const live = doc.findings.filter((f) => f.status !== "dismissed");
  const by = (s: string) => live.filter((f) => f.severity === s).length;
  return { total: live.length, p0: by("P0"), p1: by("P1"), p2: by("P2") };
}

function buildMd(cfg: EvalConfig, doc: FindingsDoc, verify: VerifyResult | null, backlog: Backlog | null): string {
  const c = counts(doc);
  const rows = doc.findings
    .filter((f) => f.status !== "dismissed")
    .map((f) => `| ${f.id} | ${f.severity} | ${f.title.replace(/\|/g, "\\|")} | ${f.status} | ${(f.evidence ?? []).map((e) => `\`${e.ref}\``).join(" ")} |`)
    .join("\n");
  const parts = [
    `# Evaluation — ${cfg.target}`,
    ``,
    `> target \`${cfg.targetAbs}\` · ${cfg.kind} · ${cfg.category} · ${c.total} findings (P0 ${c.p0} · P1 ${c.p1} · P2 ${c.p2})`,
    ``,
    `## Findings`,
    ``,
    `| id | sev | title | status | evidence |`,
    `|----|-----|-------|--------|----------|`,
    rows || `| — | — | none | — | — |`,
  ];
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

function buildHtml(cfg: EvalConfig, doc: FindingsDoc, verify: VerifyResult | null, backlog: Backlog | null): string {
  const c = counts(doc);
  const rows = doc.findings
    .filter((f) => f.status !== "dismissed")
    .map(
      (f) =>
        `<tr><td>${f.id}</td><td class="${f.severity.toLowerCase()}">${f.severity}</td><td>${esc(f.title)}</td><td>${f.status}</td><td>${(f.evidence ?? []).map((e) => `<code>${esc(e.ref)}</code>`).join(" ")}</td></tr>`,
    )
    .join("");
  const bl = backlog
    ? `<h2>Fix backlog (${backlog.tasks.length})</h2><ul>${backlog.tasks.map((t) => `<li><b>${t.id}</b> (${t.priority}) ${esc(t.title)} → <code>${esc(t.red.testFile)}</code></li>`).join("")}</ul>`
    : "";
  const vf = verify
    ? `<h2>Verification</h2><p>${verify.ok ? "✅" : "❌"} ${verify.adjudicated} adjudicated · ${verify.supported} supported · ${verify.refuted} refuted · ${verify.unsupported} unsupported${verify.failures.length ? ` · fails: ${esc(verify.failures.join(", "))}` : ""}</p>`
    : "";
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ultraeval — ${esc(cfg.target)}</title><style>${STYLE}</style></head><body>
<h1>Evaluation — ${esc(cfg.target)}</h1>
<p class="meta"><code>${esc(cfg.targetAbs)}</code> · ${cfg.kind} · ${esc(cfg.category)} · ${c.total} findings (P0 ${c.p0} · P1 ${c.p1} · P2 ${c.p2})</p>
<h2>Findings</h2><table><tr><th>id</th><th>sev</th><th>title</th><th>status</th><th>evidence</th></tr>${rows}</table>
${vf}${bl}</body></html>
`;
}

function esc(s: string): string {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
