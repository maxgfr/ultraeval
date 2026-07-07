import { CAPS } from "./types.js";

// A bracket token that is NOT a markdown link (`[x](...)` is excluded by the
// negative lookahead). Matches [F1], [M], [src/a.ts:10], [run:core.md#L4], ...
const TOKEN_RE = /\[([^\]\n]+)\](?!\()/g;

const FINDING_RE = /^F\d+$/;
const MODEL_HINT_RE = /^(M|model-hint)$/i;

export interface Token {
  raw: string; // inner text, e.g. "F1" or "src/a.ts:10"
  isFinding: boolean;
  findingId?: string; // "F1"
  isModelHint: boolean;
  isEvidence: boolean; // looks like a resolvable evidence ref (path:line / run: / url:)
}

export function tokensIn(text: string): Token[] {
  const out: Token[] = [];
  for (const m of text.matchAll(TOKEN_RE)) {
    const raw = (m[1] ?? "").trim();
    // A bracket may hold several comma-joined ids: [F1, F2]
    for (const piece of raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)) {
      const isFinding = FINDING_RE.test(piece);
      const isModelHint = MODEL_HINT_RE.test(piece);
      const isEvidence = !isFinding && !isModelHint && (piece.startsWith("run:") || piece.startsWith("url:") || /^[\w./-]+:\d+/.test(piece));
      out.push({ raw: piece, isFinding, findingId: isFinding ? piece : undefined, isModelHint, isEvidence });
    }
  }
  return out;
}

// A claim is "grounded" if it carries a finding ref, an inline evidence ref, or
// an explicit model-hint flag.
export function isCited(text: string): boolean {
  return tokensIn(text).some((t) => t.isFinding || t.isEvidence || t.isModelHint);
}

// Number of substantive words in a line, ignoring citation tokens, URLs and
// punctuation — used to decide whether a line is a factual claim worth gating.
export function claimWordCount(text: string): number {
  const stripped = text
    .replace(TOKEN_RE, " ")
    .replace(/\bhttps?:\/\/\S+/g, " ")
    .replace(/[#*_>`|—–-]+/g, " ");
  const words = stripped.split(/\s+/).filter((w) => /[a-zA-Z0-9]/.test(w));
  return words.length;
}

export interface Unit {
  text: string;
  line: number;
}

// Split a markdown report into claim units, excluding code fences and
// `> [model-hint]` blockquote regions. Table data rows and list items each
// become their own unit so a fabricated row can't inherit a neighbour's cite.
export function extractUnits(md: string): Unit[] {
  const lines = md.split("\n");
  const units: Unit[] = [];
  let inFence = false;
  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i] ?? "";
    const line = rawLine.trim();
    if (/^(```|~~~)/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    if (line === "" || /^#{1,6}\s/.test(line) || /^([-*_])\1{2,}$/.test(line)) continue;
    // Skip a model-hint blockquote line; keep other blockquotes as claims (de-quoted).
    let body = line;
    if (body.startsWith(">")) {
      body = body.replace(/^>\s?/, "").trim();
      if (/\[(?:M|model-hint)\]/i.test(body) || body.toLowerCase().startsWith("[model-hint]")) continue;
    }
    // Table separator row (|---|---|)
    if (/^\|?[\s:|-]+\|[\s:|-]+$/.test(body) && body.includes("-")) continue;
    // List marker / table cell content are kept as the unit text.
    body = body.replace(/^[-*+]\s+/, "").replace(/^\d+\.\s+/, "");
    if (claimWordCount(body) < CAPS.minClaimWords) continue;
    units.push({ text: body, line: i + 1 });
  }
  return units;
}

// (used by check) all finding ids referenced by [F#] tokens across a doc
export function findingRefs(md: string): string[] {
  const ids = new Set<string>();
  for (const t of tokensIn(md)) if (t.isFinding && t.findingId) ids.add(t.findingId);
  return [...ids];
}
