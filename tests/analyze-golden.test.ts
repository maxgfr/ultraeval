import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { analyzeRepo } from "../src/analyze.js";

// GOLDEN: the full Analysis shape on purpose-built fixtures, snapshotted BEFORE
// the codeindex-engine migration. Any diff after the migration must be
// adjudicated (better ignore rules / richer resolution = accept + document in
// the commit body; anything else = investigate) — never rubber-stamped.

const tmps: string[] = [];

function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), "ue-golden-"));
  tmps.push(d);
  return d;
}

afterEach(() => {
  for (const t of tmps.splice(0)) rmSync(t, { recursive: true, force: true });
});

function write(root: string, files: Record<string, string>): void {
  for (const [rel, content] of Object.entries(files)) {
    const p = join(root, rel);
    mkdirSync(join(p, ".."), { recursive: true });
    writeFileSync(p, content);
  }
}

// The synthetic repo exercises every analysis dimension: a hotspot-sized file,
// an import cycle, a test importing a source, a TODO, deep nesting, a python
// pair, a gitignored file, and a generated-looking bundle.
function fixtureFiles(): Record<string, string> {
  const big = `${Array.from({ length: 320 }, (_, i) => `export const x${i} = ${i};`).join("\n")}\n// TODO: split this\n`;
  return {
    ".gitignore": "generated-dir/\n*.tmp.ts\n",
    "src/big.ts": big,
    "src/a.ts": "import { b } from './b.js';\nexport const a = b + 1;\n",
    "src/b.ts": "import { a } from './a.js';\nexport const b = 1;\n",
    "src/deep.ts": `export function f(){\n${"  if (true) {\n".repeat(8)}  return 1;\n${"  }\n".repeat(8)}}\n`,
    "src/util.py": "def helper():\n    return 1\n",
    "src/app.py": "from util import helper\n\ndef run():\n    return helper()\n",
    "src/skipme.tmp.ts": "export const ignored = 1;\n",
    "generated-dir/out.ts": "export const alsoIgnored = 1;\n",
    "tests/a.test.ts": "import { a } from '../src/a.js';\nexport const t = a;\n",
    "README.md": "# fixture\n",
  };
}

function normalize(a: ReturnType<typeof analyzeRepo>): Record<string, unknown> {
  return { ...a, target: "<target>" };
}

describe("analysis golden", () => {
  it("no-git fixture: full Analysis snapshot (churn degraded loudly)", () => {
    const root = tmp();
    write(root, fixtureFiles());
    expect(normalize(analyzeRepo(root))).toMatchSnapshot();
  });

  it("scripted-git fixture: churn feeds hotspots deterministically", () => {
    const root = tmp();
    write(root, fixtureFiles());
    const git = (...args: string[]) =>
      execFileSync("git", ["-C", root, ...args], {
        stdio: "ignore",
        env: {
          ...process.env,
          GIT_AUTHOR_NAME: "g",
          GIT_AUTHOR_EMAIL: "g@g",
          GIT_COMMITTER_NAME: "g",
          GIT_COMMITTER_EMAIL: "g@g",
          GIT_AUTHOR_DATE: "2026-01-01T00:00:00Z",
          GIT_COMMITTER_DATE: "2026-01-01T00:00:00Z",
        },
      });
    git("init", "-q");
    git("add", "-A");
    git("commit", "-qm", "one");
    // Touch src/a.ts twelve times so churn crosses the >=10 reason threshold.
    for (let i = 0; i < 12; i++) {
      writeFileSync(join(root, "src/a.ts"), `import { b } from './b.js';\nexport const a = b + ${i};\n`);
      git("add", "-A");
      git("commit", "-qm", `edit ${i}`);
    }
    expect(normalize(analyzeRepo(root))).toMatchSnapshot();
  });
});
