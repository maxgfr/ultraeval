import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { commandHandlers } from "../src/cli.js";
import { COMMAND_FLAGS, FLAG_SPEC, OPTIONAL_VALUE_FLAGS, VALUE_FLAGS } from "../src/cliargs.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BUNDLE = join(ROOT, "scripts", "ultraeval.mjs");
const FIX = join(ROOT, "tests", "fixtures");
const tmps: string[] = [];

function run(args: string[]): { status: number; out: string } {
  try {
    return { status: 0, out: execFileSync("node", [BUNDLE, ...args], { encoding: "utf8", cwd: ROOT }) };
  } catch (e) {
    const err = e as { status?: number; stdout?: string; stderr?: string };
    return { status: err.status ?? 1, out: `${err.stdout ?? ""}${err.stderr ?? ""}` };
  }
}

function sampleRun(): string {
  const dir = mkdtempSync(join(tmpdir(), "ue-cli-"));
  tmps.push(dir);
  cpSync(join(FIX, "sample-run"), dir, { recursive: true });
  return dir;
}

afterAll(() => {
  for (const t of tmps.splice(0)) rmSync(t, { recursive: true, force: true });
});

describe("cli — unknown flags are rejected, never silently ignored", () => {
  it("a misspelled gate flag exits 2 with a did-you-mean hint", () => {
    const r = run(["check", "--run", sampleRun(), "--semantic", "--require-verfy"]);
    expect(r.status).toBe(2);
    expect(r.out).toMatch(/unknown flag --require-verfy/);
    expect(r.out).toMatch(/--require-verify/);
  });

  it("an unknown flag with no close match still names the command", () => {
    const r = run(["score", "--run", sampleRun(), "--frobnicate"]);
    expect(r.status).toBe(2);
    expect(r.out).toMatch(/unknown flag --frobnicate for score/);
  });

  it("every documented flag still passes (no false rejection)", () => {
    const dir = sampleRun();
    expect(run(["check", "--run", dir, "--semantic", "--strict", "--min-findings", "1"]).status).not.toBe(2);
    expect(run(["verify", "--run", dir, "--max-verify", "10", "--honeypots", "1"]).status).toBe(0);
  });
});

describe("cli — verify --honeypots reports the actually-planted count, not the requested one", () => {
  it("prints the planted count when planting succeeds", () => {
    const r = run(["verify", "--run", sampleRun(), "--honeypots", "2"]);
    expect(r.status).toBe(0);
    expect(r.out).toMatch(/incl\. 2 honeypot\(s\)/);
  });

  it("warns and reports 0 planted when the run is too small to plant traps", () => {
    const dir = sampleRun();
    const fp = join(dir, "findings.json");
    const doc = JSON.parse(readFileSync(fp, "utf8"));
    doc.findings = [doc.findings[0]];
    doc.findings[0].evidence = [{ ref: "app.js:3" }]; // one gradeable pair -> cannot cross-pair
    writeFileSync(fp, JSON.stringify(doc));
    const r = run(["verify", "--run", dir, "--honeypots", "2"]);
    expect(r.status).toBe(0);
    expect(r.out).not.toMatch(/incl\. 2 honeypot/); // must not claim 2 were planted
    expect(r.out).toMatch(/0 planted|too small/i);
  });
});

describe("cli — a malformed core artifact is a usage error, not a gate verdict (FIX-013)", () => {
  it("check on an unparseable findings.json exits 2 (usage/runtime), not 1 (gate failed)", () => {
    const dir = mkdtempSync(join(tmpdir(), "ue-badjson-"));
    tmps.push(dir);
    writeFileSync(
      join(dir, "eval.config.json"),
      JSON.stringify({ target: "t", targetAbs: "/t", kind: "codebase", category: "library", dimensions: [], version: "0" }),
    );
    writeFileSync(join(dir, "findings.json"), "{ not valid json ]");
    const r = run(["check", "--run", dir]);
    expect(r.status).toBe(2); // malformed artifact = runtime error, not a gate verdict
    expect(r.out).toMatch(/not valid JSON/i);
  });

  it("check on an unparseable eval.config.json exits 2 (usage/runtime)", () => {
    const dir = mkdtempSync(join(tmpdir(), "ue-badcfg-"));
    tmps.push(dir);
    writeFileSync(join(dir, "eval.config.json"), "{ broken ]");
    const r = run(["check", "--run", dir]);
    expect(r.status).toBe(2);
    expect(r.out).toMatch(/not valid JSON/i);
  });
});

describe("cli — a malformed config in a non-check loader names the file (FIX-014)", () => {
  it("score on an unparseable eval.config.json names the file, not raw JSON.parse text", () => {
    const dir = mkdtempSync(join(tmpdir(), "ue-badcfg2-"));
    tmps.push(dir);
    writeFileSync(join(dir, "eval.config.json"), "{ broken ]");
    const r = run(["score", "--run", dir]);
    expect(r.status).toBe(2); // usage/runtime error
    expect(r.out).toMatch(/eval\.config\.json is not valid JSON/i); // names the offending file
    expect(r.out).not.toMatch(/Expected property name|position \d+/); // not the raw V8 parser text
  });
});

describe("cli — check --json emits the machine-readable CheckResult for CI", () => {
  it("prints parseable JSON on a passing check and keeps exit 0", () => {
    const r = run(["check", "--run", sampleRun(), "--json"]);
    expect(r.status).toBe(0);
    const c = JSON.parse(r.out);
    expect(c.ok).toBe(true);
    expect(Array.isArray(c.errors)).toBe(true);
    expect(Array.isArray(c.warnings)).toBe(true);
  });

  it("prints parseable JSON on a failing check and keeps exit 1", () => {
    const dir = sampleRun();
    const fp = join(dir, "findings.json");
    const doc = JSON.parse(readFileSync(fp, "utf8"));
    doc.findings[0].evidence[0].ref = "app.js:99999";
    writeFileSync(fp, JSON.stringify(doc));
    const r = run(["check", "--run", dir, "--json"]);
    expect(r.status).toBe(1);
    const c = JSON.parse(r.out);
    expect(c.ok).toBe(false);
    expect(c.errors.length).toBeGreaterThan(0);
  });
});

describe("cli — verify --apply surfaces a friendly error for a missing verdicts file", () => {
  it("names the missing path + next step, exits 2, and never leaks raw ENOENT jargon", () => {
    const r = run(["verify", "--run", sampleRun(), "--apply", "/nope/verdicts.json"]);
    expect(r.status).toBe(2);
    expect(r.out).toMatch(/verdicts file not found/);
    expect(r.out).toMatch(/VERIFY\.todo\.json/);
    expect(r.out).not.toMatch(/ENOENT/);
  });
});

describe("cli — score --history anchors the default ledger to the target repo, not the cwd (FIX-015)", () => {
  it("writes the ledger under the target's git root regardless of the invoking cwd", () => {
    // A git-repo target is the stable anchor for the trend the ledger preserves.
    const target = mkdtempSync(join(tmpdir(), "ue-tgt-"));
    tmps.push(target);
    execFileSync("git", ["init", "-q"], { cwd: target });
    const runDir = mkdtempSync(join(tmpdir(), "ue-run-"));
    tmps.push(runDir);
    writeFileSync(
      join(runDir, "eval.config.json"),
      JSON.stringify({
        target,
        targetAbs: target,
        kind: "codebase",
        category: "library",
        dimensions: [{ id: "security", name: "Security", weight: 1, whatPerfectLooksLike: "x" }],
        version: "0.0.0",
      }),
    );
    writeFileSync(join(runDir, "judges.jsonl"), '{"dimensionScores":[{"id":"security","score":5}],"meetsExpectations":true,"calibration":{"passed":true}}\n');
    // Invoke from a THIRD, unrelated cwd — the ledger must NOT follow it.
    const cwd = mkdtempSync(join(tmpdir(), "ue-cwd-"));
    tmps.push(cwd);
    const out = execFileSync("node", [BUNDLE, "score", "--run", runDir, "--history"], { encoding: "utf8", cwd });
    expect(existsSync(join(target, "evals", "history.jsonl"))).toBe(true); // target-anchored
    expect(existsSync(join(cwd, "evals", "history.jsonl"))).toBe(false); // NOT fragmented under the cwd
    expect(out).toMatch(/history entry appended ->.*evals\/history\.jsonl/); // resolved path is printed
  });
});

describe("cli — history reads back the score-trend ledger (FIX-022)", () => {
  function ledgerFile(entries: unknown[]): string {
    const dir = mkdtempSync(join(tmpdir(), "ue-histcmd-"));
    tmps.push(dir);
    const file = join(dir, "history.jsonl");
    writeFileSync(file, entries.map((e) => JSON.stringify(e)).join("\n"));
    return file;
  }

  it("prints a compact trend with per-run overall and delta, exit 0", () => {
    const file = ledgerFile([
      {
        scoredAt: "2026-01-01T00:00:00.000Z",
        commit: "a".repeat(40),
        overall: 58,
        meetsExpectations: false,
        bar: 80,
        counts: { p0: 1, p1: 2, p2: 3, opps: 0 },
      },
      { scoredAt: "2026-01-02T00:00:00.000Z", commit: "b".repeat(40), overall: 81, meetsExpectations: true, bar: 80, counts: { p0: 0, p1: 1, p2: 2, opps: 1 } },
    ]);
    const r = run(["history", "--file", file]);
    expect(r.status).toBe(0);
    expect(r.out).toMatch(/58/);
    expect(r.out).toMatch(/81/);
    expect(r.out).toMatch(/\+23/);
  });

  it("--json emits the raw ledger array", () => {
    const file = ledgerFile([
      { scoredAt: "2026-01-01T00:00:00.000Z", overall: 70, meetsExpectations: false, bar: 80, counts: { p0: 0, p1: 0, p2: 0, opps: 0 } },
    ]);
    const r = run(["history", "--file", file, "--json"]);
    expect(r.status).toBe(0);
    const arr = JSON.parse(r.out);
    expect(Array.isArray(arr)).toBe(true);
    expect(arr[0].overall).toBe(70);
  });

  it("a missing/empty ledger prints a friendly message and exits 0 (not a crash)", () => {
    const r = run(["history", "--file", join(tmpdir(), `ue-absent-${Date.now()}.jsonl`)]);
    expect(r.status).toBe(0);
    expect(r.out).toMatch(/no ledger|no history|score --run/i);
  });
});

describe("cli — main() dispatches through a command-handler table (FIX-010)", () => {
  it("exposes one handler per dispatched command, keyed by command name", () => {
    // main() is a thin router: every command in FLAG_SPEC has a handler in the
    // table, and the table has no handler for a command the parser cannot dispatch.
    expect(typeof commandHandlers).toBe("object");
    for (const cmd of Object.keys(FLAG_SPEC)) {
      expect(typeof commandHandlers[cmd], `handler for ${cmd}`).toBe("function");
    }
    expect(Object.keys(commandHandlers).sort()).toEqual(Object.keys(FLAG_SPEC).sort());
  });

  it("importing the CLI module does not execute main() (no process side effects)", () => {
    // The module is import-safe: exercised implicitly by importing commandHandlers
    // above without the test runner's argv being parsed/dispatched.
    expect(process.exitCode === undefined || process.exitCode === 0).toBe(true);
  });
});

describe("cli — flag registries cannot drift (FIX-006)", () => {
  it("VALUE_FLAGS is exactly the set of value-arity flags declared in FLAG_SPEC (parser cannot lag the allow-list)", () => {
    const specValue = new Set(
      Object.values(FLAG_SPEC)
        .flatMap((flags) => Object.entries(flags))
        .filter(([, arity]) => arity === "value")
        .map(([name]) => `--${name}`),
    );
    expect([...VALUE_FLAGS].sort()).toEqual([...specValue].sort());
  });

  it("OPTIONAL_VALUE_FLAGS is exactly the optional-value flags declared in FLAG_SPEC", () => {
    const specOptional = new Set(
      Object.values(FLAG_SPEC)
        .flatMap((flags) => Object.entries(flags))
        .filter(([, arity]) => arity === "optional-value")
        .map(([name]) => `--${name}`),
    );
    expect([...OPTIONAL_VALUE_FLAGS].sort()).toEqual([...specOptional].sort());
  });

  it("COMMAND_FLAGS lists exactly FLAG_SPEC's per-command flag names", () => {
    for (const [cmd, flags] of Object.entries(FLAG_SPEC)) {
      expect(COMMAND_FLAGS[cmd]?.slice().sort()).toEqual(Object.keys(flags).sort());
    }
    expect(Object.keys(COMMAND_FLAGS).sort()).toEqual(Object.keys(FLAG_SPEC).sort());
  });

  it("every value-taking command flag is registered as value-consuming in the parser (no silent boolean misparse)", () => {
    // The exact drift the finding warns about: a value flag in a command's
    // allow-list but absent from VALUE_FLAGS → parse() would treat `--flag value`
    // as `{flag:true}` and push `value` into positionals with no error.
    for (const flags of Object.values(FLAG_SPEC)) {
      for (const [name, arity] of Object.entries(flags)) {
        if (arity === "value") expect(VALUE_FLAGS.has(`--${name}`)).toBe(true);
        if (arity === "optional-value") expect(OPTIONAL_VALUE_FLAGS.has(`--${name}`)).toBe(true);
      }
    }
  });

  it("every VALUE_FLAGS / OPTIONAL_VALUE_FLAGS member is used by at least one command (no orphan parser flag)", () => {
    const known = new Set(Object.values(COMMAND_FLAGS).flat());
    for (const vf of [...VALUE_FLAGS, ...OPTIONAL_VALUE_FLAGS]) {
      expect(known.has(vf.replace(/^--/, ""))).toBe(true);
    }
  });
});

describe("cli — status names the pipeline state and the next command", () => {
  it("prints the artifact checklist and a next: hint", () => {
    const r = run(["status", "--run", sampleRun()]);
    expect(r.status).toBe(0);
    expect(r.out).toMatch(/eval\.config\.json/);
    expect(r.out).toMatch(/findings\.json/);
    expect(r.out).toMatch(/next:/);
  });

  it("--json emits the machine-readable shape", () => {
    const r = run(["status", "--run", sampleRun(), "--json"]);
    expect(r.status).toBe(0);
    const s = JSON.parse(r.out);
    expect(Array.isArray(s.steps)).toBe(true);
    expect(typeof s.next).toBe("string");
  });
});
