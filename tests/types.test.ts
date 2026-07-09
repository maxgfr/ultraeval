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

describe("generated contracts — anchored referentials", () => {
  it("the researcher contract lists each dimension with its standards anchor", () => {
    const text = agentContracts(cfg, "/run", "/engine").researcher;
    expect(text).toMatch(/ISO\/IEC/);
  });

  it("the judge contract instructs scoring against the anchored referential", () => {
    expect(agentContracts(cfg, "/run", "/engine").judge).toMatch(/anchored referential/);
  });
});
