import { ANNOTATIONS_SINCE, RICH_TOOLS_SINCE, type JsonSchema, type JsonSchemaProp, type ProtocolVersion } from "./protocol.js";

// What the server advertises. Pure data — nothing here imports the evaluation
// pipeline, so the declarations can be asserted in a test without running one.
// handlers.ts is where these names become work.

export interface ToolDecl {
  name: string;
  description: string;
  inputSchema: JsonSchema;
  title?: string;
  outputSchema?: JsonSchema;
  annotations?: Record<string, boolean>;
}

const runProp: JsonSchemaProp = { type: "string", description: "The evaluation run directory." };

// The line the whole skill turns on, from its own SKILL.md: a tiny engine
// scaffolds the run, and the research, judgement and writing are the model's.
// A client that misses it treats an empty scorecard as a passing grade.
const JUDGMENT_NOTE = "The engine scaffolds the run and reduces what you write; the research, the findings and the judgement are yours.";

export const TOOLS: ToolDecl[] = [
  {
    name: "ultraeval_status",
    title: "Where the run got to, and the next command",
    description:
      "Read the run's pipeline state: which stages have output, which are still empty, and the exact next step. Start here on any run you did not just " +
      "create — an evaluation has many stages and this is the cheapest way to find where one stopped.",
    inputSchema: { type: "object", properties: { run: runProp }, required: ["run"] },
  },
  {
    name: "ultraeval_analyze",
    title: "Map the target before judging it",
    description:
      "Deterministic survey of the target: hotspots, dependencies, churn, test and documentation gaps. This is context for the evaluation, not a verdict — " +
      "it tells you where to look, and every finding still has to be earned by reading the code.",
    inputSchema: {
      type: "object",
      properties: {
        run: runProp,
        since: { type: "string", description: "Diff-scope the analysis to changes since this git ref." },
        scope: { type: "array", items: { type: "string" }, description: "Target-relative globs to scope the analysis to." },
      },
      required: ["run"],
    },
  },
  {
    name: "ultraeval_check",
    title: "The anti-hallucination gate",
    description:
      "Prove every finding resolves to a real file:line inside the target. A finding citing a line that does not exist is an invented finding, and this is " +
      "what catches it. A result with ok:false is a real verdict, not a tool failure. " +
      JUDGMENT_NOTE,
    inputSchema: {
      type: "object",
      properties: {
        run: runProp,
        semantic: { type: "boolean", description: "Also fold in the recorded verify verdicts." },
        require_verify: { type: "boolean", description: "Fail when no verdicts have been recorded yet." },
        strict: { type: "boolean", description: "Fail on any finding that is not fully grounded." },
        min_findings: { type: "number", description: "Fail when the run holds fewer findings than this." },
      },
      required: ["run"],
    },
  },
  {
    name: "ultraeval_verify",
    title: "Build an adversarial verify worklist",
    description:
      "Emit a finding-by-evidence worklist for skeptics to adjudicate. Supports sharding, so several skeptics can work in parallel, and HONEYPOTS — " +
      "planted trap pairs whose 'supported' verdict fails the fold, which is how you find out the adjudication was rubber-stamped.",
    inputSchema: {
      type: "object",
      properties: {
        run: runProp,
        max_verify: { type: "number", description: "Cap on the number of pairs emitted (default 60)." },
        shards: { type: "number", description: "Split the worklist into this many shards." },
        shard: { type: "number", description: "Which shard to emit, 0-based." },
        honeypots: { type: "number", description: "How many trap pairs to plant. A trap graded 'supported' fails the fold." },
      },
      required: ["run"],
    },
  },
  {
    name: "ultraeval_backlog",
    title: "Turn findings into a TDD fix backlog",
    description:
      "Convert verified findings into fix cards a developer or agent can pick up: what is wrong, the failing test to write first, and what proves it fixed. " +
      "Run it after the citations pass — a backlog built on ungrounded findings is a list of invented work.",
    inputSchema: {
      type: "object",
      properties: { run: runProp, tdd: { type: "boolean", description: "Emit test-first cards (red → green → refactor)." } },
      required: ["run"],
    },
  },
  {
    name: "ultraeval_score",
    title: "Reduce the judgements into a scorecard",
    description:
      "Compute the run's 0-100 score and its meets-expectations verdict from the recorded judge lines. It is a pure reduction OF WHAT YOU WROTE — with no " +
      "judgements recorded it scores nothing, which is a fact about the run and not a passing grade.",
    inputSchema: { type: "object", properties: { run: runProp }, required: ["run"] },
  },
  {
    name: "ultraeval_compare",
    title: "Compare two runs, and gate on a regression",
    description:
      "Diff a new run against a baseline: score movement, findings resolved, findings introduced. Use it to gate a PR — a drop in score or a new P0 is a " +
      "regression, and this is what names it.",
    inputSchema: {
      type: "object",
      properties: { run: runProp, base: { type: "string", description: "The baseline run directory to compare against." } },
      required: ["run", "base"],
    },
  },
  {
    name: "ultraeval_history",
    title: "The score trend over time",
    description: "Read back the committed score history for a target — how the evaluation has moved across runs. Writes nothing.",
    inputSchema: { type: "object", properties: { run: runProp }, required: ["run"] },
  },
  {
    name: "ultraeval_read",
    title: "Read a file from the run or the target",
    description:
      "Read a file, or a line range of one, from the run directory or the target being evaluated. Use it to read the real code behind a finding before " +
      "judging it. Reads are confined to those two roots; anything else is your own file tool's job.",
    inputSchema: {
      type: "object",
      properties: {
        run: runProp,
        path: { type: "string", description: "Path relative to the run, or an absolute path inside the run or the target." },
        start_line: { type: "number", description: "First line to return, 1-based (default 1)." },
        end_line: { type: "number", description: "Last line to return, inclusive (default: end of file, capped)." },
      },
      required: ["run", "path"],
    },
    outputSchema: {
      type: "object",
      properties: {
        path: { type: "string" },
        start_line: { type: "number" },
        end_line: { type: "number" },
        total_lines: { type: "number" },
        truncated: { type: "boolean" },
        content: { type: "string" },
      },
      required: ["path", "start_line", "end_line", "total_lines", "truncated", "content"],
    },
  },
];

// Registered only when the server is started with --allow-write. `init` and
// `render` write into the user's filesystem; `clean` removes from it; and
// `verify_fix` EXECUTES the target's own commands.
export const WRITE_TOOLS: ToolDecl[] = [
  {
    name: "ultraeval_init",
    title: "Scaffold an evaluation run",
    description:
      "WRITES TO DISK: create the run directory, detect whether the target is a skill or a codebase, and stamp the dimensions the evaluation will be graded " +
      "on. Gitignores the run dir in the repo that holds it. " +
      JUDGMENT_NOTE,
    inputSchema: {
      type: "object",
      properties: {
        target: { type: "string", description: "Absolute path to the skill or codebase to evaluate." },
        out: { type: "string", description: "Absolute path for the run directory." },
        kind: { type: "string", enum: ["skill", "codebase"], description: "Override the detected kind." },
        mode: { type: "string", enum: ["audit", "improve", "deep"], description: "How deep to go. Default: audit." },
        bar: { type: "number", description: "The category-calibrated meets-expectations bar." },
        since: { type: "string", description: "Diff-scope the eval to changes since this git ref." },
        scope: { type: "array", items: { type: "string" }, description: "Target-relative globs to scope the eval to." },
      },
      required: ["target", "out"],
    },
  },
  {
    name: "ultraeval_render",
    title: "Render the evaluation report",
    description: "WRITES TO DISK: render the run to index.html, index.md and a SARIF file a code-scanning tool can ingest.",
    inputSchema: {
      type: "object",
      properties: { run: runProp, sarif: { type: "boolean", description: "Also emit eval.sarif (SARIF 2.1.0)." } },
      required: ["run"],
    },
  },
  {
    name: "ultraeval_verify_fix",
    title: "Replay a fix task's verification",
    description:
      "EXECUTES CODE: runs the verification command a fix card declares — the target's own tests — and stamps the task done when it passes. It runs whatever " +
      "that repository's test command is, so only point it at a target you trust. Timeboxed at ten minutes.",
    inputSchema: {
      type: "object",
      properties: {
        run: runProp,
        task: { type: "string", description: "The fix task id (e.g. FIX-003)." },
        timeout_ms: { type: "number", description: "Cap the run (default 600000)." },
      },
      required: ["run", "task"],
    },
  },
  {
    name: "ultraeval_clean",
    title: "Delete derived artifacts",
    description:
      "DESTRUCTIVE: removes the run's derived artifacts. With all:true it removes everything, including worklists you have not yet folded back in. There is " +
      "no undo.",
    inputSchema: {
      type: "object",
      properties: { run: runProp, all: { type: "boolean", description: "Remove everything, not just the derived artifacts." } },
      required: ["run"],
    },
  },
];

// Behavioural hints clients use to decide what needs a confirmation prompt.
//
// The read-only line is drawn at the USER'S filesystem. Note verify_fix: it is
// the only tool in the family that EXECUTES the target's code, which is why it
// is open-world as well as a write.
export const TOOL_META: Record<string, { write?: boolean; destructive?: boolean; idempotent?: boolean; openWorld?: boolean }> = {
  ultraeval_status: { openWorld: false },
  ultraeval_analyze: { write: true, destructive: false, idempotent: true, openWorld: false },
  ultraeval_check: { openWorld: false },
  ultraeval_verify: { write: true, destructive: false, idempotent: true, openWorld: false },
  ultraeval_backlog: { write: true, destructive: false, idempotent: true, openWorld: false },
  ultraeval_score: { write: true, destructive: false, idempotent: true, openWorld: false },
  ultraeval_compare: { write: true, destructive: false, idempotent: true, openWorld: false },
  ultraeval_history: { openWorld: false },
  ultraeval_read: { openWorld: false },
  ultraeval_init: { write: true, destructive: false, idempotent: true, openWorld: false },
  ultraeval_render: { write: true, destructive: false, idempotent: true, openWorld: false },
  // Runs the target's own test command in a subprocess.
  ultraeval_verify_fix: { write: true, destructive: false, idempotent: false, openWorld: true },
  ultraeval_clean: { write: true, destructive: true, idempotent: true, openWorld: false },
};

export function annotationsFor(name: string): Record<string, boolean> | undefined {
  const meta = TOOL_META[name];
  if (!meta) return undefined;
  return {
    readOnlyHint: !meta.write,
    ...(meta.write ? { destructiveHint: meta.destructive === true, idempotentHint: meta.idempotent === true } : {}),
    openWorldHint: meta.openWorld === true,
  };
}

export interface ToolsForOptions {
  defaultRun?: string;
  allowWrite?: boolean;
}

// The tool list as one client should see it: gated on what the server was
// started with, and on how new the negotiated protocol is.
export function toolsFor(protocolVersion: ProtocolVersion, opts: ToolsForOptions = {}): ToolDecl[] {
  const base = opts.allowWrite ? [...TOOLS, ...WRITE_TOOLS] : TOOLS;
  const withAnnotations = protocolVersion >= ANNOTATIONS_SINCE;
  const withRich = protocolVersion >= RICH_TOOLS_SINCE;

  return base.map((t) => {
    const decl: ToolDecl = {
      name: t.name,
      description: t.description,
      // A destructive delete never inherits a run the caller didn't name.
      inputSchema: t.name === "ultraeval_clean" ? t.inputSchema : applyDefaultRun(t.inputSchema, opts.defaultRun),
    };
    if (withRich && t.title) decl.title = t.title;
    if (withRich && t.outputSchema) decl.outputSchema = t.outputSchema;
    if (withAnnotations) {
      const a = annotationsFor(t.name);
      if (a) decl.annotations = a;
    }
    return decl;
  });
}

// With a server-level default run, `run` stops being required and its
// description names the default — so a client working one evaluation can call
// every tool with no run argument at all.
function applyDefaultRun(schema: JsonSchema, defaultRun?: string): JsonSchema {
  const existing = schema.properties.run;
  if (!defaultRun || !existing) return schema;
  return {
    type: "object",
    properties: {
      ...schema.properties,
      run: { ...existing, description: `${existing.description} Optional — defaults to ${defaultRun}.` },
    },
    required: schema.required.filter((r) => r !== "run"),
  };
}
