import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ensureGitignored } from "../src/gitignore.js";
import { initRun } from "../src/init.js";

const tmps: string[] = [];

function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), "ue-gitignore-"));
  tmps.push(d);
  return d;
}

function gitRepo(): string {
  const d = tmp();
  execFileSync("git", ["init", "-q"], { cwd: d });
  return d;
}

afterEach(() => {
  for (const t of tmps.splice(0)) rmSync(t, { recursive: true, force: true });
});

const gi = (repo: string) => readFileSync(join(repo, ".gitignore"), "utf8");

describe("ensureGitignored — run-dir gitignore protection", () => {
  it("appends the relative run-dir path (with trailing slash) to the repo's .gitignore", () => {
    const repo = gitRepo();
    const runDir = join(repo, "eval-run");
    mkdirSync(runDir, { recursive: true });
    const res = ensureGitignored(runDir);
    expect(res.action).toBe("added");
    expect(gi(repo)).toContain("eval-run/");
  });

  it("collapses a .ultraeval container to one entry covering all runs", () => {
    const repo = gitRepo();
    const runDir = join(repo, ".ultraeval", "run-2026-01");
    mkdirSync(runDir, { recursive: true });
    const res = ensureGitignored(runDir);
    expect(res.action).toBe("added");
    expect(res.entry).toBe(".ultraeval/");
    expect(gi(repo)).toContain(".ultraeval/");
    expect(gi(repo)).not.toContain("run-2026-01");
  });

  it("creates .gitignore when absent, with a header comment", () => {
    const repo = gitRepo();
    const runDir = join(repo, ".ultraeval", "r");
    mkdirSync(runDir, { recursive: true });
    ensureGitignored(runDir);
    expect(gi(repo)).toContain("# ultraeval runs");
  });

  it("is idempotent — a second call reports 'already' and appends nothing", () => {
    const repo = gitRepo();
    const runDir = join(repo, ".ultraeval", "r");
    mkdirSync(runDir, { recursive: true });
    ensureGitignored(runDir);
    const before = gi(repo);
    const res = ensureGitignored(runDir);
    expect(res.action).toBe("already");
    expect(gi(repo)).toBe(before);
  });

  it("treats an existing entry without the trailing slash (or with a leading /) as covered", () => {
    const repo = gitRepo();
    const runDir = join(repo, ".ultraeval", "r");
    mkdirSync(runDir, { recursive: true });
    writeFileSync(join(repo, ".gitignore"), "node_modules/\n.ultraeval\n");
    expect(ensureGitignored(runDir).action).toBe("already");
    writeFileSync(join(repo, ".gitignore"), "/.ultraeval/\n");
    expect(ensureGitignored(runDir).action).toBe("already");
  });

  it("preserves CRLF line endings of an existing .gitignore", () => {
    const repo = gitRepo();
    const runDir = join(repo, ".ultraeval", "r");
    mkdirSync(runDir, { recursive: true });
    writeFileSync(join(repo, ".gitignore"), "node_modules/\r\n");
    ensureGitignored(runDir);
    expect(gi(repo)).toContain(".ultraeval/\r\n");
  });

  it("no-ops when the run dir is not inside any git repo", () => {
    const runDir = join(tmp(), "run");
    mkdirSync(runDir, { recursive: true });
    const res = ensureGitignored(runDir);
    expect(res.action).toBe("skipped");
    expect(res.reason).toMatch(/git/);
  });

  it("refuses to ignore evals/ — the committed score ledger lives there", () => {
    const repo = gitRepo();
    const runDir = join(repo, "evals");
    mkdirSync(runDir, { recursive: true });
    const res = ensureGitignored(runDir);
    expect(res.action).toBe("skipped");
    expect(existsSync(join(repo, ".gitignore"))).toBe(false);
  });
});

describe("init — auto-gitignore of the run dir", () => {
  it("init gitignores a run dir inside the target git repo by default", () => {
    const target = gitRepo();
    const out = join(target, ".ultraeval", "r1");
    const res = initRun({ target, out });
    expect(res.gitignore?.action).toBe("added");
    expect(gi(target)).toContain(".ultraeval/");
  });

  it("gitignore: false opts out and leaves the repo untouched", () => {
    const target = gitRepo();
    const out = join(target, ".ultraeval", "r1");
    const res = initRun({ target, out, gitignore: false });
    expect(res.gitignore).toBeUndefined();
    expect(existsSync(join(target, ".gitignore"))).toBe(false);
  });

  it("a run dir outside any git repo is skipped without error", () => {
    const res = initRun({ target: gitRepo(), out: tmp() });
    expect(res.gitignore?.action).toBe("skipped");
  });
});
