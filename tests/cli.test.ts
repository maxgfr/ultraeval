import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

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
