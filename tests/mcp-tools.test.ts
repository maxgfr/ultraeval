import { describe, it, expect } from "vitest";
import { TOOLS, WRITE_TOOLS, TOOL_META, annotationsFor, toolsFor } from "../src/mcp/tools.js";
import { validateArgs } from "../src/mcp/protocol.js";
import { FLAG_SPEC } from "../src/cliargs.js";

const ALL = [...TOOLS, ...WRITE_TOOLS];

describe("tool declarations", () => {
  it("names every tool consistently and uniquely", () => {
    const names = ALL.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
    for (const n of names) expect(n).toMatch(/^ultraeval_[a-z_]+$/);
  });

  it("declares a well-formed object schema whose required properties exist", () => {
    for (const t of ALL) {
      expect(t.inputSchema.type, t.name).toBe("object");
      expect(Array.isArray(t.inputSchema.required), t.name).toBe(true);
      for (const r of t.inputSchema.required) {
        expect(Object.keys(t.inputSchema.properties), `${t.name}.required lists "${r}"`).toContain(r);
      }
      for (const [key, spec] of Object.entries(t.inputSchema.properties)) {
        expect(spec.description, `${t.name}.${key} has no description`).toBeTruthy();
      }
    }
  });

  it("gives every tool a description that says what it is for", () => {
    for (const t of ALL) {
      expect(t.description.length, t.name).toBeGreaterThan(80);
      expect(t.title, t.name).toBeTruthy();
    }
  });

  it("says out loud that score reduces what YOU wrote", () => {
    // Without this, an empty scorecard reads as a passing grade.
    const score = TOOLS.find((t) => t.name === "ultraeval_score")!;
    expect(score.description).toMatch(/pure reduction/);
    expect(score.description).toMatch(/scores nothing/);
  });

  it("explains what honeypots are for on the tool that plants them", () => {
    const verify = TOOLS.find((t) => t.name === "ultraeval_verify")!;
    expect(verify.description).toMatch(/HONEYPOTS/);
    expect(verify.description).toMatch(/rubber-stamped/);
  });

  it("warns that verify_fix executes the target's own code", () => {
    // The only tool in the family that runs someone else's commands.
    const vf = WRITE_TOOLS.find((t) => t.name === "ultraeval_verify_fix")!;
    expect(vf.description).toMatch(/EXECUTES CODE/);
    expect(vf.description).toMatch(/only point it at a target you trust/);
  });

  it("declares an outputSchema only where the result shape is small and stable", () => {
    expect(ALL.filter((t) => t.outputSchema).map((t) => t.name)).toEqual(["ultraeval_read"]);
  });
});

describe("annotations", () => {
  const EXPECTED: Record<string, { readOnlyHint: boolean; openWorldHint: boolean; destructiveHint?: boolean; idempotentHint?: boolean }> = {
    ultraeval_status: { readOnlyHint: true, openWorldHint: false },
    ultraeval_analyze: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    ultraeval_check: { readOnlyHint: true, openWorldHint: false },
    ultraeval_verify: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    ultraeval_backlog: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    ultraeval_score: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    ultraeval_compare: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    ultraeval_history: { readOnlyHint: true, openWorldHint: false },
    ultraeval_read: { readOnlyHint: true, openWorldHint: false },
    ultraeval_init: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    ultraeval_render: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    ultraeval_verify_fix: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    ultraeval_clean: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
  };

  it("annotates every declared tool, and only declared tools", () => {
    expect(Object.keys(TOOL_META).sort()).toEqual(ALL.map((t) => t.name).sort());
    expect(Object.keys(EXPECTED).sort()).toEqual(ALL.map((t) => t.name).sort());
  });

  it("matches the expected hint matrix", () => {
    for (const [name, want] of Object.entries(EXPECTED)) expect(annotationsFor(name), name).toEqual(want);
  });

  it("marks exactly one tool destructive, and it is the one that deletes", () => {
    expect(ALL.filter((t) => TOOL_META[t.name]!.destructive).map((t) => t.name)).toEqual(["ultraeval_clean"]);
  });

  it("marks exactly the tool that runs someone else's code as open-world", () => {
    expect(ALL.filter((t) => TOOL_META[t.name]!.openWorld).map((t) => t.name)).toEqual(["ultraeval_verify_fix"]);
  });
});

describe("toolsFor", () => {
  it("hides the write tools unless the server was started with --allow-write", () => {
    const readOnly = toolsFor("2025-06-18").map((t) => t.name);
    for (const w of ["ultraeval_init", "ultraeval_render", "ultraeval_verify_fix", "ultraeval_clean"]) expect(readOnly).not.toContain(w);
    expect(toolsFor("2025-06-18", { allowWrite: true }).map((t) => t.name)).toContain("ultraeval_init");
  });

  it("gates rich fields and annotations on the negotiated protocol version", () => {
    const old = toolsFor("2024-11-05").find((t) => t.name === "ultraeval_read")!;
    expect(old.annotations).toBeUndefined();
    expect(old.title).toBeUndefined();

    const now = toolsFor("2025-06-18").find((t) => t.name === "ultraeval_read")!;
    expect(now.annotations).toBeTruthy();
    expect(now.outputSchema).toBeTruthy();
  });

  it("makes `run` optional with a default — but never for the destructive tool", () => {
    const withDefault = toolsFor("2025-06-18", { defaultRun: "/srv/run", allowWrite: true });
    for (const t of withDefault) {
      if (t.name === "ultraeval_clean") continue;
      if (!t.inputSchema.properties.run) continue;
      expect(t.inputSchema.required, t.name).not.toContain("run");
    }
    // A delete never inherits a run the caller didn't name.
    expect(withDefault.find((t) => t.name === "ultraeval_clean")!.inputSchema.required).toContain("run");
  });
});

describe("the CLI knows about the mcp command", () => {
  it("registers its flags in the same allow-list every other command uses", () => {
    // Without this the parser rejects --transport before the server ever starts.
    expect(FLAG_SPEC.mcp).toBeTruthy();
    for (const f of ["transport", "port", "bind", "allow-origin", "max-response-bytes"]) {
      expect(FLAG_SPEC.mcp![f], `--${f}`).toBe("value");
    }
    for (const f of ["allow-write", "allow-remote"]) {
      expect(FLAG_SPEC.mcp![f], `--${f}`).toBe("boolean");
    }
  });
});

describe("declared schemas accept what the handlers expect", () => {
  it("validates a representative call per tool", () => {
    const sample: Record<string, Record<string, unknown>> = {
      ultraeval_status: { run: "/r" },
      ultraeval_analyze: { run: "/r", since: "main", scope: ["src/**"] },
      ultraeval_check: { run: "/r", semantic: true, min_findings: 3 },
      ultraeval_verify: { run: "/r", max_verify: 20, shards: 2, shard: 0, honeypots: 2 },
      ultraeval_backlog: { run: "/r", tdd: true },
      ultraeval_score: { run: "/r" },
      ultraeval_compare: { run: "/r", base: "/b" },
      ultraeval_history: { run: "/r" },
      ultraeval_read: { run: "/r", path: "findings.json", start_line: 1, end_line: 20 },
      ultraeval_init: { target: "/t", out: "/r", kind: "codebase", mode: "audit" },
      ultraeval_render: { run: "/r", sarif: true },
      ultraeval_verify_fix: { run: "/r", task: "FIX-003", timeout_ms: 60000 },
      ultraeval_clean: { run: "/r", all: true },
    };
    for (const t of ALL) expect(validateArgs(t.inputSchema, sample[t.name]!), t.name).toBeUndefined();
  });

  it("rejects a missing required argument and an out-of-enum value", () => {
    const compare = TOOLS.find((t) => t.name === "ultraeval_compare")!;
    expect(validateArgs(compare.inputSchema, { run: "/r" })).toMatch(/`base` is required/);
    const init = WRITE_TOOLS.find((t) => t.name === "ultraeval_init")!;
    expect(validateArgs(init.inputSchema, { target: "/t", out: "/r", kind: "plugin" })).toMatch(/kind/);
  });
});
