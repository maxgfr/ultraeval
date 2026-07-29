import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, type JsonRpcMessage } from "../src/mcp/server.js";
import { callTool, ToolError } from "../src/mcp/handlers.js";

// The handlers driven through the JSON-RPC core, in-process, against a real
// scaffolded run over a real (tiny) target. Nothing here mocks the engine, and
// nothing runs the target's code — verify_fix is the only tool that would, and
// it is not exercised.

let TARGET: string;
let RUN: string;
const temps: string[] = [];

beforeAll(async () => {
  const base = mkdtempSync(join(tmpdir(), "ue-mcp-"));
  temps.push(base);
  TARGET = join(base, "target");
  RUN = join(base, "run");
  mkdirSync(join(TARGET, "src"), { recursive: true });
  writeFileSync(join(TARGET, "package.json"), JSON.stringify({ name: "target", version: "1.0.0" }));
  writeFileSync(join(TARGET, "src", "index.js"), "function add(a, b) { return a + b; }\nmodule.exports = { add };\n");
  // Going through callTool proves the allowWrite gate lets a write tool through.
  await callTool("ultraeval_init", { target: TARGET, out: RUN }, { allowWrite: true });
}, 120_000);

afterAll(() => {
  for (const d of temps) rmSync(d, { recursive: true, force: true });
});

const server = createServer();

async function rpc(msg: Omit<JsonRpcMessage, "jsonrpc">): Promise<JsonRpcMessage | undefined> {
  let out: JsonRpcMessage | undefined;
  await server.handle({ jsonrpc: "2.0", ...msg }, (m) => {
    out = m;
  });
  return out;
}

async function call(name: string, args: Record<string, unknown>): Promise<JsonRpcMessage> {
  return (await rpc({ id: 1, method: "tools/call", params: { name, arguments: args } }))!;
}

async function ok(name: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const res = await call(name, args);
  const result = res.result as { content: { text: string }[]; isError?: boolean } | undefined;
  expect(res.error, `unexpected JSON-RPC error: ${JSON.stringify(res.error)}`).toBeUndefined();
  expect(result?.isError, `unexpected isError: ${result?.content?.[0]?.text}`).toBeFalsy();
  return JSON.parse(result!.content[0]!.text);
}

async function errorText(name: string, args: Record<string, unknown>): Promise<string> {
  const res = await call(name, args);
  const result = res.result as { content: { text: string }[]; isError?: boolean } | undefined;
  expect(result?.isError, "expected an isError tool result").toBe(true);
  return result!.content[0]!.text;
}

describe("lifecycle methods", () => {
  it("negotiates a protocol version and advertises all three primitives", async () => {
    const res = await rpc({ id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } });
    const r = res!.result as { serverInfo: { name: string }; capabilities: unknown };
    expect(r.serverInfo.name).toBe("ultraeval");
    expect(r.capabilities).toEqual({
      tools: { listChanged: false },
      resources: { subscribe: false, listChanged: false },
      prompts: { listChanged: false },
    });
  });

  it("rejects an unknown method, an unknown tool and bad arguments as protocol errors", async () => {
    expect((await rpc({ id: 1, method: "resources/subscribe" }))!.error).toMatchObject({ code: -32601 });
    expect((await call("ultraeval_nope", {})).error).toMatchObject({ code: -32602 });
    expect((await call("ultraeval_compare", { run: RUN })).error).toMatchObject({ code: -32602 });
  });
});

describe("init and status", () => {
  it("scaffolded a run and detected the target kind", async () => {
    const res = await ok("ultraeval_status", { run: RUN });
    expect(res.run).toBe(RUN);
  });

  it("says the engine only scaffolded, and an empty run is not a grade", async () => {
    // The single most important instruction this server gives.
    const res = await callTool("ultraeval_init", { target: TARGET, out: join(RUN, "..", "run2") }, { allowWrite: true });
    const payload = JSON.parse(res.text);
    temps.push(String(payload.run));
    expect(String(payload.next)).toMatch(/scaffolded the run and nothing more/);
    expect(String(payload.next)).toMatch(/not a grade/);
  });
});

describe("the citation gate", () => {
  it("returns a verdict on a run with no findings yet", async () => {
    const res = await ok("ultraeval_check", { run: RUN });
    expect(res.ok).toBeTypeOf("boolean");
  });
});

describe("score", () => {
  it("reports an unscoreable run as an actionable tool error, not a crash", async () => {
    // The library throws plain Errors carrying actionable prose, and cli.ts
    // turns exactly those into its exit-2 bucket. Surfacing one as an internal
    // error would tell the model the server broke instead of that the Judge
    // phase has not run.
    const msg = await errorText("ultraeval_score", { run: RUN });
    expect(msg).toMatch(/judge/i);
  });
});

describe("analyze", () => {
  it("surveys the target and says the survey is not a verdict", async () => {
    const res = await ok("ultraeval_analyze", { run: RUN });
    expect(res.target).toBe(TARGET);
    expect(String(res.next)).toMatch(/where to LOOK/);
  });
});

describe("read", () => {
  it("reads from the run", async () => {
    const res = await ok("ultraeval_read", { run: RUN, path: "eval.config.json", start_line: 1, end_line: 3 });
    expect(res.start_line).toBe(1);
    expect(String(res.content).split("\n").length).toBeLessThanOrEqual(3);
  });

  it("reads the target's own code too, resolved from the run's config", async () => {
    const res = await ok("ultraeval_read", { run: RUN, path: join(TARGET, "src/index.js") });
    expect(String(res.content)).toContain("function add");
  });

  it("refuses a path outside the run and its target", async () => {
    // Containment is the whole point: this server can be reached over HTTP.
    expect(await errorText("ultraeval_read", { run: RUN, path: "/etc/passwd" })).toMatch(/outside the run and its target/);
  });
});

describe("guardrails", () => {
  it("refuses the write tools unless the server allows writes", async () => {
    await expect(callTool("ultraeval_init", { target: TARGET, out: "/tmp/nope" })).rejects.toThrow(ToolError);
    await expect(callTool("ultraeval_clean", { run: RUN })).rejects.toThrow(/--allow-write/);
  });

  it("names the missing STEP when there is no run", async () => {
    const bare = mkdtempSync(join(tmpdir(), "ue-bare-"));
    temps.push(bare);
    const msg = await errorText("ultraeval_status", { run: bare });
    expect(msg).toMatch(/no evaluation run/);
    expect(msg).toMatch(/ultraeval_init/);
  });

  it("requires absolute paths", async () => {
    expect(await errorText("ultraeval_status", { run: "relative" })).toMatch(/must be an absolute path/);
    await expect(callTool("ultraeval_init", { target: "rel", out: "/r" }, { allowWrite: true })).rejects.toThrow(/must be an absolute path/);
  });

  it("rejects a shard outside its shard count", async () => {
    expect(await errorText("ultraeval_verify", { run: RUN, shards: 2, shard: 5 })).toMatch(/`shard` must be between 0 and 1/);
  });

  it("refuses to analyze an empty diff rather than silently analyzing everything", async () => {
    // A "scoped" run that quietly widened to the whole target is a false
    // coverage claim.
    expect(await errorText("ultraeval_analyze", { run: RUN, since: "HEAD" })).toMatch(/no files changed|not a git|fatal/i);
  });

  it("uses the server's default run when the caller omits one", async () => {
    const withDefault = createServer({ defaultRun: RUN });
    let out: JsonRpcMessage | undefined;
    await withDefault.handle({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "ultraeval_status", arguments: {} } }, (m) => {
      out = m;
    });
    const result = out!.result as { content: { text: string }[]; isError?: boolean };
    expect(result.isError).toBeFalsy();
    expect(JSON.parse(result.content[0]!.text).run).toBe(RUN);
  });
});
