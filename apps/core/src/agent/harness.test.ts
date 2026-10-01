import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { ApxClient, ApxError } from "@apx/protocol/client";
import { createCore } from "../server.ts";
import type { ExternalTurn } from "./harness.ts";
import type { Llm } from "./provider.ts";

const seen: Array<{ harness: string; turn: ExternalTurn }> = [];
const neverNative: Llm = {
  label: "unused",
  complete: async () => {
    throw new Error("native loop must not run for an external agent");
  },
};

let core: Awaited<ReturnType<typeof createCore>>;
let client: ApxClient;
const home = fs.mkdtempSync(path.join(os.tmpdir(), "apx2-harness-"));

before(async () => {
  core = await createCore(
    { host: "127.0.0.1", port: 0, home, token: undefined },
    {
      quiet: true,
      llm: neverNative,
      external: async (harness, turn) => {
        seen.push({ harness, turn });
        turn.onText("pensando…");
        const r = await turn.runTool("show_widget", {
          name: "desde-claude",
          title: "Desde Claude",
          html: "<i>hola</i>",
        });
        return {
          text: `widget ok=${r.ok}`,
          model: `${harness}-model`,
          sessionId: `sess-${seen.length}`,
          usage: { input: 10, output: 5 },
        };
      },
    },
  );
  client = new ApxClient({ url: core.url });
});
after(async () => {
  await core.close();
  fs.rmSync(home, { recursive: true, force: true });
});

async function settle(thread: string) {
  for (let i = 0; i < 100; i++) {
    const t = await client.call("threads.get", { thread });
    if (t.runs.length && t.runs.every((r) => r.ended_at)) return t;
    await new Promise((r) => setTimeout(r, 30));
  }
  throw new Error("never settled");
}

test("an agent set to an external harness runs there, with APX tools, cards, usage and its session kept", async () => {
  await client.call("agents.update", { agent: "roby", harness: "claude" });
  await client.call("threads.send", { thread: "home", text: "hola" });
  const t = await settle("home");
  const answer = t.messages.at(-1);
  assert.equal(answer?.model, "claude-model");
  assert.ok(answer?.parts.some((p) => p.type === "tool" && p.tool === "show_widget" && p.status === "ok"));
  assert.ok(answer?.parts.some((p) => p.type === "text" && p.text === "widget ok=true"));
  assert.deepEqual(t.runs[0]?.usage, { input: 10, output: 5 });
  // The system prompt is APX's, and the second turn resumes the harness's own session.
  assert.match(seen[0]?.turn.system ?? "", /^Sos Roby/);
  await client.call("threads.send", { thread: "home", text: "otra" });
  await settle("home");
  assert.equal(seen[1]?.turn.sessionId, "sess-1");
});

test("the install default decides for agents without their own harness", async () => {
  await client.call("agents.update", { agent: "roby", harness: null });
  const { engines } = await client.call("engines.set_default", { engine: "codex" });
  assert.equal(engines.find((e) => e.default)?.id, "codex");
  await client.call("threads.send", { thread: "home", text: "y ahora" });
  await settle("home");
  assert.equal(seen.at(-1)?.harness, "codex");
});

test("harness tool gates refuse unknown tokens", async () => {
  const err = await client.call("harness.tools", { token: "x".repeat(48) }).catch((e: unknown) => e);
  assert.ok(err instanceof ApxError);
  assert.equal(err.code, "unauthorized");
});

test("the per-run MCP proxy (used by Codex) lists and calls that run's tools through the core", async () => {
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
  const { StdioClientTransport } = await import("@modelcontextprotocol/sdk/client/stdio.js");
  const calls: Array<[string, Record<string, unknown>]> = [];
  const token = core.gates.open({
    tools: [
      {
        type: "function",
        function: { name: "ping", description: "test", parameters: { type: "object", properties: {} } },
      },
    ],
    runTool: async (name, args) => {
      calls.push([name, args]);
      return { ok: true, text: "pong" };
    },
  });
  const terminal = path.resolve(import.meta.dirname, "../../../terminal/src/main.ts");
  const mcp = new Client({ name: "test", version: "0" });
  await mcp.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [terminal, "mcp", "--run", token],
      env: { ...process.env, APX_URL: core.url } as Record<string, string>,
    }),
  );
  const { tools } = await mcp.listTools();
  assert.deepEqual(
    tools.map((t) => t.name),
    ["ping"],
  );
  const r = await mcp.callTool({ name: "ping", arguments: { x: 1 } });
  assert.deepEqual(r.content, [{ type: "text", text: "pong" }]);
  assert.deepEqual(calls, [["ping", { x: 1 }]]);
  core.gates.close(token);
  const gone = await mcp.callTool({ name: "ping", arguments: {} });
  assert.equal(gone.isError, true);
  await mcp.close();
});
