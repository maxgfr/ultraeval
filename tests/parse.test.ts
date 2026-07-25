import { describe, expect, it } from "vitest";
import { num, parse, str } from "../src/cliargs.js";

// Direct unit tests for the CLI arg parser. parse() carries non-obvious
// semantics (VALUE_FLAGS consuming the next token even when it is another flag,
// OPTIONAL_VALUE_FLAGS' lookahead) that only e2e tests brushed against. These
// pin them so a regression that changes every command at once is caught.

describe("cliargs — parse()", () => {
  it("a VALUE_FLAG consumes the next token as its value", () => {
    const a = parse(["--run", "myrun"]);
    expect(a.run).toBe("myrun");
    expect(a._).toEqual([]);
  });

  it("a VALUE_FLAG consumes the next token EVEN when it is another flag", () => {
    const a = parse(["--target", "--out"]);
    expect(a.target).toBe("--out"); // --out swallowed as --target's value
    expect(a.out).toBeUndefined();
  });

  it("a VALUE_FLAG at the end of argv yields an empty string", () => {
    expect(parse(["--run"]).run).toBe("");
  });

  it("an OPTIONAL_VALUE_FLAG takes a following non-flag value", () => {
    expect(parse(["--history", "ledger.jsonl"]).history).toBe("ledger.jsonl");
  });

  it("an OPTIONAL_VALUE_FLAG alone (end of argv) yields empty string", () => {
    expect(parse(["--history"]).history).toBe("");
  });

  it("an OPTIONAL_VALUE_FLAG followed by another flag does not swallow it (--history --json)", () => {
    const a = parse(["--history", "--json"]);
    expect(a.history).toBe(""); // did NOT consume --json
    expect(a.json).toBe(true); // --json parsed as its own boolean flag
  });

  it("an unlisted --flag is a boolean true", () => {
    expect(parse(["--json"]).json).toBe(true);
  });

  it("collects positionals into _ in order", () => {
    const a = parse(["check", "--run", "r", "extra"]);
    expect(a._).toEqual(["check", "extra"]);
    expect(a.run).toBe("r");
  });

  it("-h and -v map to help/version", () => {
    expect(parse(["-h"]).help).toBe(true);
    expect(parse(["-v"]).version).toBe(true);
  });

  it("does NOT support the --flag=value form (kept as a boolean key)", () => {
    const a = parse(["--run=x"]);
    expect(a["run=x"]).toBe(true);
    expect(a.run).toBeUndefined();
  });

  it("a repeated flag keeps the last value", () => {
    expect(parse(["--run", "a", "--run", "b"]).run).toBe("b");
  });
});

describe("cliargs — num()/str() coercers", () => {
  it("num parses numeric strings and rejects empty/boolean/undefined", () => {
    expect(num("5", "max-verify")).toBe(5);
    expect(num("", "max-verify")).toBeUndefined();
    expect(num(true, "max-verify")).toBeUndefined();
    expect(num(undefined, "max-verify")).toBeUndefined();
  });

  // A non-numeric value used to coerce to NaN and flow into the gates as if it
  // were a real threshold: `NaN ?? default` is NaN (nullish does not catch NaN),
  // and every `x < NaN` / `x >= NaN` comparison is false — so `--coverage-min
  // abc` silently DISABLED the coverage gate and `--max-verify abc` silently
  // disabled the 60-pair cap, both exiting 0. A gate must never be switched off
  // by a typo: reject the value instead.
  it("num REJECTS a non-numeric value instead of yielding NaN", () => {
    expect(() => num("abc", "coverage-min")).toThrow(/--coverage-min/);
    expect(() => num("abc", "coverage-min")).toThrow(/number/);
    expect(() => num("1,5", "max-verify")).toThrow(/--max-verify/);
    expect(() => num("Infinity", "bar")).toThrow(/--bar/);
    expect(() => num("NaN", "shards")).toThrow(/--shards/);
  });

  it("num still accepts the numeric forms real flags use", () => {
    expect(num("0.6", "coverage-min")).toBe(0.6);
    expect(num("0", "min-findings")).toBe(0);
    expect(num("-1", "shard")).toBe(-1);
    expect(num(" 3 ", "shards")).toBe(3);
  });

  it("str passes strings through (including empty) and rejects boolean/undefined", () => {
    expect(str("x")).toBe("x");
    expect(str("")).toBe("");
    expect(str(true)).toBeUndefined();
    expect(str(undefined)).toBeUndefined();
  });
});
