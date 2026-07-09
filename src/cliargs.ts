// Argument parsing for the CLI, split out from cli.ts so it can be unit-tested
// directly (importing cli.ts runs main() and its process side effects).

export interface Args {
  _: string[];
  [k: string]: string | boolean | string[];
}

// SINGLE SOURCE OF TRUTH for the CLI flag surface: every command, its legal
// flags, and each flag's arity. The parser's VALUE_FLAGS/OPTIONAL_VALUE_FLAGS
// (which tokens consume the next arg) AND cli.ts's per-command allow-list
// (COMMAND_FLAGS, used to reject unknown flags) are BOTH derived from this, so
// the two can never drift — a value flag added to a command is automatically
// known to the parser, closing the silent `--flag value` → `{flag:true}` misparse.
export type FlagArity = "boolean" | "value" | "optional-value";
export const FLAG_SPEC: Record<string, Record<string, FlagArity>> = {
  init: { target: "value", out: "value", kind: "value", category: "value", mode: "value", bar: "value", since: "value" },
  plan: { run: "value", eco: "boolean" },
  orchestrate: { run: "value", eco: "boolean" }, // family-wide alias for plan

  analyze: { run: "value", since: "value", json: "boolean", target: "value", out: "value" },
  brainstorm: { run: "value", rank: "boolean", check: "boolean" },
  compare: { run: "value", base: "value", json: "boolean", gate: "boolean" },
  check: {
    run: "value",
    semantic: "boolean",
    "require-verify": "boolean",
    strict: "boolean",
    "strict-scope": "boolean",
    "min-findings": "value",
    "coverage-min": "value",
    json: "boolean",
  },
  verify: { run: "value", apply: "value", "max-verify": "value", shards: "value", shard: "value", honeypots: "value" },
  backlog: { run: "value", tdd: "boolean", out: "value" },
  fix: { run: "value", task: "value", workflow: "boolean" },
  "verify-fix": { run: "value", task: "value" },
  score: { run: "value", json: "boolean", history: "optional-value" },
  history: { run: "value", file: "value", json: "boolean" },
  rejudge: { run: "value", out: "value" },
  status: { run: "value", json: "boolean" },
  render: { run: "value", out: "value", "no-html": "boolean", "no-md": "boolean", sarif: "boolean" },
  clean: { run: "value", all: "boolean" },
};

const flagsOfArity = (arity: FlagArity): string[] => [
  ...new Set(
    Object.values(FLAG_SPEC)
      .flatMap((flags) => Object.entries(flags))
      .filter(([, a]) => a === arity)
      .map(([name]) => `--${name}`),
  ),
];

// Flags that consume the next token as their value (derived from FLAG_SPEC).
export const VALUE_FLAGS = new Set(flagsOfArity("value"));

// Flags whose value is optional: `--history` alone means "use the default file".
export const OPTIONAL_VALUE_FLAGS = new Set(flagsOfArity("optional-value"));

// Known flags per command (derived from FLAG_SPEC). A typo'd gate flag must never
// be silently ignored — `check --require-verfy` weakening the exit gate is exactly
// the failure mode cli.ts's rejectUnknownFlags guards against.
export const COMMAND_FLAGS: Record<string, string[]> = Object.fromEntries(Object.entries(FLAG_SPEC).map(([cmd, flags]) => [cmd, Object.keys(flags)]));

export function parse(argv: string[]): Args {
  const args: Args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === undefined) continue;
    if (a === "-h") args.help = true;
    else if (a === "-v") args.version = true;
    else if (a.startsWith("--")) {
      if (VALUE_FLAGS.has(a)) args[a.slice(2)] = argv[++i] ?? "";
      else if (OPTIONAL_VALUE_FLAGS.has(a)) {
        const next = argv[i + 1];
        args[a.slice(2)] = next !== undefined && !next.startsWith("--") ? (argv[++i] as string) : "";
      } else args[a.slice(2)] = true;
    } else args._.push(a);
  }
  return args;
}

export function num(v: string | boolean | string[] | undefined): number | undefined {
  return typeof v === "string" && v !== "" ? Number(v) : undefined;
}

export function str(v: string | boolean | string[] | undefined): string | undefined {
  return typeof v === "string" ? v : undefined;
}
