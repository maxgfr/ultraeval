import { TOOLS, WRITE_TOOLS } from "./tools.js";

// The workflows, as MCP prompts.
//
// Tools are the half of this skill a client can discover on its own. The other
// half is what its SKILL.md states plainly: a tiny deterministic engine
// scaffolds the run and reduces what you write — the research, the findings and
// the judgement are the model's. `score` is a pure reduction of judge lines, so
// a run with nothing recorded scores nothing, and a client handed only the
// tools produces an empty scorecard it then reports as a grade.
//
// Each prompt says three things, in this order: the contract, the exact tool
// sequence, and what the gate does on failure.

export interface PromptArgument {
  name: string;
  description: string;
  required?: boolean;
}

export interface PromptDecl {
  name: string;
  title?: string;
  description: string;
  arguments: PromptArgument[];
}

export interface PromptMessage {
  role: "user" | "assistant";
  content: { type: "text"; text: string };
}

export interface PromptResult {
  description: string;
  messages: PromptMessage[];
}

export class PromptError extends Error {}

const runArg: PromptArgument = { name: "run", description: "The evaluation run directory.", required: true };

export const PROMPTS: PromptDecl[] = [
  {
    name: "evaluate_skill",
    title: "Evaluate a skill or codebase, end to end",
    description:
      "The full evaluation workflow: survey the target, research each dimension against the real thing, write findings that cite file:line, verify them " +
      "adversarially, and only then score.",
    arguments: [runArg],
  },
  {
    name: "write_findings",
    title: "Research one dimension into findings",
    description:
      "The research workflow for a single dimension: test the target's actual behaviour rather than reading its documentation, and write findings someone " +
      "could act on without trusting you.",
    arguments: [runArg, { name: "dimension", description: "The dimension to research.", required: false }],
  },
  {
    name: "judge_dimension",
    title: "Judge a dimension on its evidence",
    description:
      "The judging workflow: grade a dimension against what the findings actually establish — including the honeypots, which exist to catch a panel that " +
      "graded without reading.",
    arguments: [runArg, { name: "dimension", description: "The dimension to judge.", required: false }],
  },
];

export function getPrompt(name: string, args: Record<string, unknown> = {}): PromptResult {
  const decl = PROMPTS.find((p) => p.name === name);
  if (!decl) throw new PromptError(`unknown prompt: ${name || "(none given)"}`);

  for (const arg of decl.arguments) {
    if (arg.required && !str(args[arg.name])) throw new PromptError(`\`${arg.name}\` is required for prompt "${name}"`);
  }

  const text = name === "evaluate_skill" ? evaluateSkill(args) : name === "write_findings" ? writeFindings(args) : judgeDimension(args);
  return { description: decl.description, messages: [{ role: "user", content: { type: "text", text } }] };
}

// The rule every workflow here rests on. Stated once, quoted into each prompt,
// so the two can never drift apart.
const CORE_RULE = `The engine scaffolds the run and reduces what you write; the research, the findings and the judgement are yours. ultraeval_score is a pure reduction of the judgements RECORDED in the run — with none recorded it scores nothing, and that is a fact about the run rather than a passing grade. Every finding cites a file:line that resolves.`;

const GATE = `\`ultraeval_check\` returning \`ok: false\` is a VERDICT, not a tool failure. A finding citing a line that does not exist is an invented finding, and that is exactly what the gate exists to catch. Fix it or drop it, and check again.`;

function evaluateSkill(args: Record<string, unknown>): string {
  const run = str(args.run)!;

  return `Evaluate the target of the run at \`${run}\`.

${CORE_RULE}

**Sequence:**

1. \`ultraeval_status\` — where the run got to and what is still empty.
2. \`ultraeval_analyze\` — hotspots, churn, dependency and test gaps. This is where to LOOK, not what to conclude.
3. Per dimension: research it against the real target, then write findings that cite file:line. \`ultraeval_read\` opens the target's own code.
4. \`ultraeval_check\` — prove every citation resolves before spending anything on verification.
5. \`ultraeval_verify\` with \`honeypots\` — adjudicate each finding adversarially. The traps catch an adjudication done without reading.
6. \`ultraeval_score\`, then \`ultraeval_backlog\` with \`tdd: true\` to turn what survived into work someone can pick up.

**Evaluate the target, not its documentation.** A README claiming a behaviour is evidence about the README. Run the thing, read the code that implements the claim, and cite that.

**A finding is not an opinion.** It names what is wrong, where, and what it costs — and someone who disagrees with you can check it. "Could be better organised" is not a finding; "these three modules each re-implement the retry policy, at [a.ts:40], [b.ts:88], [c.ts:12], so a fix has to land in three places" is.

${GATE}`;
}

function writeFindings(args: Record<string, unknown>): string {
  const run = str(args.run)!;
  const dimension = str(args.dimension);

  return `Research ${dimension ? `the \`${dimension}\` dimension` : "the next unresearched dimension"} of the run at \`${run}\`.

${CORE_RULE}

**Sequence:**

1. \`ultraeval_status\` to see which dimensions still have nothing${dimension ? "" : ", and take the first"}.
2. \`ultraeval_analyze\` if you have not yet — it points at the files worth opening.
3. \`ultraeval_read\` the target's real code. Test the behaviour where you can: the claim you are checking is about what it DOES.
4. Write the findings, each citing a file:line.
5. \`ultraeval_check\`.

**Look for what is actually wrong, not what differs from a template.** A missing file is only a finding if its absence costs something you can name. Conversely, the worst problems rarely look like violations: the interface that cannot express a real case, the invariant nothing enforces, the error path nobody has run.

**Report what you could NOT determine.** A dimension you could not evaluate is a real result, and saying so is what stops a thin evaluation from reading like a clean one.

${GATE}`;
}

function judgeDimension(args: Record<string, unknown>): string {
  const run = str(args.run)!;
  const dimension = str(args.dimension);

  return `Judge ${dimension ? `the \`${dimension}\` dimension` : "each dimension"} of the run at \`${run}\`.

${CORE_RULE}

**Sequence:**

1. \`ultraeval_read\` the findings for the dimension, and the code each one cites. Judge the evidence, not the summary.
2. \`ultraeval_verify\` — adjudicate each finding: does its evidence carry it?
3. Record the judgement, then \`ultraeval_score\` to reduce them.
4. \`ultraeval_compare\` against a baseline run when one exists — a score without a trend is hard to act on.

**The honeypots are the point.** \`ultraeval_verify\` can plant trap pairs, and grading one 'supported' fails the fold. If you find yourself agreeing with every finding, that is the signal to slow down — the traps exist because rubber-stamping is the default failure of a judge panel, not a rare one.

**Grade what the evidence establishes.** A finding whose citation resolves but whose claim the code does not support is refuted, however reasonable it sounds. And a dimension with two real findings is not automatically worse than one with nine shallow ones — say what you weighted and why.

${GATE}`;
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() !== "" ? v : undefined;
}

// Every tool a prompt tells the model to call must actually be declared —
// otherwise a prompt survives a tool rename as a set of instructions that
// cannot be followed. Exported so the test can assert it.
const DECLARED = new Set([...TOOLS, ...WRITE_TOOLS].map((t) => t.name));

export function toolNamesReferencedBy(text: string): string[] {
  const found = new Set<string>();
  for (const m of text.matchAll(/ultraeval_[a-z_]+/g)) if (DECLARED.has(m[0])) found.add(m[0]);
  return [...found].sort();
}

export function unknownToolNamesIn(text: string): string[] {
  const bad = new Set<string>();
  for (const m of text.matchAll(/ultraeval_[a-z_]+/g)) if (!DECLARED.has(m[0])) bad.add(m[0]);
  return [...bad].sort();
}
