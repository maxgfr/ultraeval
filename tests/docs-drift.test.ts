import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { defaultDimensions } from "../src/rubrics.js";
import { LIVE_SCENARIOS } from "../src/templates.js";
import { SEVERITY_DEFS, VALID_SEVERITIES } from "../src/types.js";

// The references are meant to be NORMATIVE — protocol.md literally says the
// severity table and SEVERITY_DEFS "MUST stay in sync". That was prose, so
// three doc<->code duplications drifted unnoticed. These tests make the
// normativity executable: change one side without the other and the build
// fails. A reference nobody enforces is decoration.

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SKILL_DIR = join(ROOT, "skills", "ultraeval");
const REFS = join(SKILL_DIR, "references");
const BUNDLE = join(ROOT, "scripts", "ultraeval.mjs");

const ref = (name: string): string => readFileSync(join(REFS, name), "utf8");

/** Rows of the first markdown table that follows `heading`, split into trimmed cells. */
function tableUnder(md: string, heading: string): string[][] {
  const start = md.indexOf(heading);
  if (start < 0) throw new Error(`heading not found: ${heading}`);
  const rows: string[][] = [];
  for (const line of md.slice(start).split("\n").slice(1)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("|")) {
      if (rows.length) break; // table ended
      continue; // prose between the heading and the table
    }
    const cells = trimmed
      .split("|")
      .slice(1, -1)
      .map((c) => c.trim());
    if (cells.every((c) => /^:?-+:?$/.test(c))) continue; // separator row
    rows.push(cells);
  }
  return rows.slice(1); // drop the header row
}

describe("docs drift — rubric-library.md vs src/rubrics.ts", () => {
  // heading -> the defaultDimensions() call the table claims to document
  const SETS: [string, "skill" | "codebase", string][] = [
    ["## Agent skill (kind = skill)", "skill", ""],
    ["## Codebase / library (kind = codebase)", "codebase", ""],
    ["## Security / SAST", "codebase", "security"],
    ["## Requirements / PRD / SRD", "codebase", "requirements"],
    ['## Business / domain — "métier"', "codebase", "métier"],
    ["## Research / RAG / doc tool", "codebase", "research"],
  ];

  for (const [heading, kind, category] of SETS) {
    it(`${heading.replace("## ", "")} documents the shipped ids and weights`, () => {
      const dims = defaultDimensions(kind, category);
      const rows = tableUnder(ref("rubric-library.md"), heading);
      expect(rows.map((r) => r[0])).toEqual(dims.map((d) => d.id));
      // the doc writes weights as .30, the engine as 0.3
      expect(rows.map((r) => Number(r[2]))).toEqual(dims.map((d) => d.weight));
    });
  }

  it("the flavour categories document exactly the dimensions they append to the base", () => {
    const base = defaultDimensions("codebase", "").map((d) => d.id);
    for (const [heading, category] of [
      ["**Web / frontend** — base **+**:", "web app"],
      ["**CLI** — base **+**:", "CLI"],
    ] as const) {
      const added = defaultDimensions("codebase", category).filter((d) => !base.includes(d.id));
      const rows = tableUnder(ref("rubric-library.md"), heading);
      expect(rows.map((r) => r[0])).toEqual(added.map((d) => d.id));
      expect(rows.map((r) => Number(r[2]))).toEqual(added.map((d) => d.weight));
    }
  });

  it("every documented dimension names at least one referential", () => {
    const md = ref("rubric-library.md");
    for (const [heading, kind, category] of SETS) {
      for (const row of tableUnder(md, heading)) {
        expect(row[3], `${category || kind} / ${row[0]} has an empty anchor cell`).toBeTruthy();
      }
    }
  });
});

describe("docs drift — live-scenarios.md vs templates.ts LIVE_SCENARIOS", () => {
  // "## Security / SAST" -> "security", "## Business / métier" -> "business"
  const keyOf = (heading: string): string =>
    heading
      .replace(/^##\s+/, "")
      .split(" / ")[0]
      ?.trim()
      .toLowerCase() ?? "";
  const headings = ref("live-scenarios.md")
    .split("\n")
    .filter((l) => l.startsWith("## "));

  it("documents exactly the categories the executor contract can embed", () => {
    expect(headings.map(keyOf).sort()).toEqual(Object.keys(LIVE_SCENARIOS).sort());
  });

  it("every category block defines all five normed fields", () => {
    const md = ref("live-scenarios.md");
    const blocks = md.split(/^## /m).slice(1);
    for (const block of blocks) {
      const name = block.split("\n")[0];
      for (const label of ["Golden path", "Error path", "Help contract", "Expected artifact", "Pass criteria"]) {
        expect(block, `${name} is missing "${label}"`).toContain(`**${label}**`);
      }
    }
  });
});

describe("docs drift — protocol.md severity table vs SEVERITY_DEFS", () => {
  it("documents every severity with the codified label and CVSS band", () => {
    const rows = tableUnder(ref("protocol.md"), "## Severities (normative definitions)");
    expect(rows.map((r) => r[0])).toEqual([...VALID_SEVERITIES]);
    for (const row of rows) {
      const def = SEVERITY_DEFS[row[0] as keyof typeof SEVERITY_DEFS];
      expect(row[1]).toBe(def.label);
      expect(row[2]).toBe(def.cvssBand);
    }
  });
});

describe("docs drift — the engine surface is documented in the skill", () => {
  // What a subagent can actually reach: SKILL.md + everything under references/.
  // DOCUMENTATION.md and README.md do NOT ship in the installed bundle, so a
  // flag documented only there is invisible to the agent that needs it.
  const shipped = [
    readFileSync(join(SKILL_DIR, "SKILL.md"), "utf8"),
    ...readdirSync(REFS)
      .filter((f) => f.endsWith(".md"))
      .map((f) => ref(f)),
  ].join("\n");

  const help = execFileSync("node", [BUNDLE, "--help"], { encoding: "utf8" });

  // Meta flags every CLI has; documenting them would be noise.
  const EXEMPT = new Set(["--help", "--version"]);

  it("every command the engine advertises appears in the skill docs", () => {
    const commands = help
      .split("\n")
      .map((l) => /^ {2}([a-z][a-z-]+) {2,}--/.exec(l)?.[1])
      .filter((c): c is string => Boolean(c));
    expect(commands.length).toBeGreaterThan(10); // the extractor still works
    const missing = commands.filter((c) => !shipped.includes(c));
    expect(missing, `commands in --help but not in SKILL.md/references: ${missing.join(", ")}`).toEqual([]);
  });

  it("every flag the engine advertises appears in the skill docs", () => {
    const flags = [...new Set(help.match(/--[a-z][a-z0-9-]*/g) ?? [])].filter((f) => !EXEMPT.has(f));
    expect(flags.length).toBeGreaterThan(20); // the extractor still works
    const missing = flags.filter((f) => !shipped.includes(f));
    expect(missing, `flags in --help but not in SKILL.md/references: ${missing.join(", ")}`).toEqual([]);
  });
});
