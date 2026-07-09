import { describe, expect, it } from "vitest";
import { defaultDimensions } from "../src/rubrics.js";
import { agentContracts, findingsSchema } from "../src/templates.js";
import type { EvalConfig } from "../src/types.js";
import { SEVERITY_DEFS, VALID_SEVERITIES } from "../src/types.js";

const cfg: EvalConfig = {
  target: "t",
  targetAbs: "/t",
  kind: "skill",
  category: "agent skill",
  dimensions: defaultDimensions("skill", "agent skill"),
  version: "0.0.0",
};

describe("SEVERITY_DEFS — codified severity referential", () => {
  it("defines every valid severity with label, CVSS band, meaning and gate effect", () => {
    expect(Object.keys(SEVERITY_DEFS).sort()).toEqual([...VALID_SEVERITIES].sort());
    for (const sev of VALID_SEVERITIES) {
      const d = SEVERITY_DEFS[sev];
      expect(d.label, sev).toBeTruthy();
      expect(d.cvssBand, sev).toBeTruthy();
      expect(d.meaning, sev).toBeTruthy();
      expect(d.gateEffect, sev).toBeTruthy();
    }
  });

  it("P0's gate effect states the meets-expectations cap the engine enforces", () => {
    expect(SEVERITY_DEFS.P0.gateEffect).toMatch(/meets-expectations/);
  });

  it("findings.schema.json derives its severity definitions from SEVERITY_DEFS", () => {
    // biome-ignore lint/suspicious/noExplicitAny: walking the informal schema
    const severity = (findingsSchema() as any).properties.findings.items.properties.severity;
    expect(severity.enum).toEqual([...VALID_SEVERITIES]);
    for (const sev of VALID_SEVERITIES) expect(severity.description).toContain(SEVERITY_DEFS[sev].meaning);
  });

  it("the generated findings contract embeds the codified definitions, not ad-hoc prose", () => {
    const text = agentContracts(cfg, "/run", "/engine").findings;
    for (const sev of VALID_SEVERITIES) expect(text).toContain(SEVERITY_DEFS[sev].meaning);
  });
});

describe("findings.schema.json — a real JSON Schema", () => {
  it("declares draft 2020-12 and covers the opportunity fields the gate enforces", () => {
    // biome-ignore lint/suspicious/noExplicitAny: walking the schema
    const schema = findingsSchema() as any;
    expect(schema.$schema).toBe("https://json-schema.org/draft/2020-12/schema");
    const props = schema.properties.findings.items.properties;
    expect(props.kind.enum).toEqual(["defect", "opportunity"]);
    expect(props.impact.enum).toEqual(["high", "med", "low"]);
    expect(props.effort.enum).toEqual(["S", "M", "L"]);
  });

  it("validates the shipped sample fixture, and requires impact/effort for opportunities", async () => {
    const { Ajv2020 } = await import("ajv/dist/2020.js");
    const ajv = new Ajv2020({ strict: false });
    const validate = ajv.compile(findingsSchema() as object);
    const { readFileSync } = await import("node:fs");
    const { join, dirname } = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const fixture = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "fixtures", "sample-run", "findings.json"), "utf8"));
    expect(validate(fixture), JSON.stringify(validate.errors)).toBe(true);
    const badOpp = {
      findings: [{ id: "F1", kind: "opportunity", severity: "P2", title: "x", statement: "y", evidence: [{ ref: "a:1" }], status: "confirmed" }],
    };
    expect(validate(badOpp)).toBe(false);
  });
});

describe("generated contracts — anchored referentials", () => {
  it("the researcher contract lists each dimension with its standards anchor", () => {
    const text = agentContracts(cfg, "/run", "/engine").researcher;
    expect(text).toMatch(/ISO\/IEC/);
  });

  it("the judge contract instructs scoring against the anchored referential", () => {
    expect(agentContracts(cfg, "/run", "/engine").judge).toMatch(/anchored referential/);
  });
});
