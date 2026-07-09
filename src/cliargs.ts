// Argument parsing for the CLI, split out from cli.ts so it can be unit-tested
// directly (importing cli.ts runs main() and its process side effects).

export interface Args {
  _: string[];
  [k: string]: string | boolean | string[];
}

// Flags that consume the next token as their value.
export const VALUE_FLAGS = new Set([
  "--target",
  "--out",
  "--run",
  "--kind",
  "--category",
  "--mode",
  "--since",
  "--base",
  "--apply",
  "--min-findings",
  "--coverage-min",
  "--max-verify",
  "--shards",
  "--shard",
  "--bar",
  "--honeypots",
  "--task",
]);

// Flags whose value is optional: `--history` alone means "use the default file".
export const OPTIONAL_VALUE_FLAGS = new Set(["--history"]);

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
