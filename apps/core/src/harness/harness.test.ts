import assert from "node:assert/strict";
import path from "node:path";
import { after, before, test } from "node:test";
import { ApxError } from "@apx/protocol/client";
import { say, scriptedLlm, startCore, texts } from "../engine/testkit.ts";
import type { Harness, TurnIO } from "./index.ts";

const seen: Array<{ harness: string; io: TurnIO }> = [];
const fake = (id: "claude" | "codex"): Harness => ({
  id,
  async run(io) {
    seen.push({ harness: id, io });
    io.onText("thinking…");
    const r = await io.execute(`${io.run.id}-x1`, "show_widget", {
      name: "from-claude",
      title: "From Claude",
      html: "<i>hi</i>",
    });
    return {
      text: `widget ok=${r.ok}`,
      model: `${id}/model`,
      sessionId: `sess-${seen.length}`,
      usage: { input: 10, output: 5 },
    };
  },
});
const broken: Harness = {
  id: "codex",
  run: async () => {
    throw new Error("usage limit reached");
  },
};
const native = scriptedLlm(() => say("native answer"));

let env: Awaited<ReturnType<typeof startCore>>;
before(async () => {
  env = await startCore({ llm: native, harnesses: { claude: fake("claude"), codex: broken } });
});
after(async () => {
  await env.core.close();
  env.cleanup();
});

test("an agent on an external harness runs there, with APX tools, cards, usage and its own session kept", async () => {
  await env.client.call("agents.update", { agent: "roby", harness: "claude" });
  await env.client.call("threads.send", { thread: "home", text: "hello" });
  const t = await env.settle("home");
  const answer = t.messages.at(-1);
  assert.equal(answer?.model, "claude/model");
  assert.ok(answer?.parts.some((p) => p.type === "tool" && p.tool === "show_widget" && p.status === "ok"));
  assert.ok(answer?.parts.some((p) => p.type === "text" && p.text === "widget ok=true"));
  assert.equal(t.runs[0]?.harness, "claude");
  assert.deepEqual(t.runs[0]?.usage, { input: 10, output: 5 });
  assert.match(seen[0]?.io.system ?? "", /^You are Roby/);
  await env.client.call("threads.send", { thread: "home", text: "again" });
  await env.settle("home");
  assert.equal(seen[1]?.io.sessionId, "sess-1");
  // Its tool calls left step records like the native loop's.
  assert.equal(env.core.store.runs.steps(t.runs[0]?.id ?? "")[0]?.tool, "show_widget");
});

test("a harness that fails before any tool hands the turn to the router's next engine, with a visible notice", async () => {
  await env.client.call("models.set_config", { router: { rules: [], chain: ["fake/fake-1"] } });
  await env.client.call("agents.update", { agent: "roby", model_choice: { model: "codex", router: true } });
  await env.client.call("threads.send", { thread: "home", text: "and now" });
  const t = await env.settle("home");
  const parts = t.messages.at(-1)?.parts ?? [];
  assert.ok(parts.some((p) => p.type === "notice" && p.code === "engine.fallback" && /usage limit/.test(p.text)));
  assert.deepEqual(texts(t.messages).at(-1), "native answer");
  assert.equal(t.runs[0]?.harness, "native");
});

test("the install default decides for agents without their own harness", async () => {
  await env.client.call("agents.update", { agent: "roby", harness: null });
  const { engines } = await env.client.call("engines.set_default", { engine: "claude" });
  assert.equal(engines.find((e) => e.default)?.id, "claude");
  const before_ = seen.length;
  await env.client.call("threads.send", { thread: "home", text: "who answers?" });
  await env.settle("home");
  assert.equal(seen.length, before_ + 1);
});

test("harness tool gates refuse unknown tokens", async () => {
  const err = await env.client.call("harness.tools", { token: "x".repeat(48) }).catch((e: unknown) => e);
  assert.ok(err instanceof ApxError);
  assert.equal(err.code, "unauthorized");
});

test("the per-run MCP proxy (used by Codex) lists and calls that run's tools through the core", async () => {
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
  const { StdioClientTransport } = await import("@modelcontextprotocol/sdk/client/stdio.js");
  const calls: Array<[string, Record<string, unknown>]> = [];
  const token = env.core.harnesses.openGate({
    run: { id: "run_test" } as TurnIO["run"],
    tools: [
      {
        type: "function",
        function: { name: "ping", description: "test", parameters: { type: "object", properties: {} } },
      },
    ],
    execute: async (_id, name, args) => {
      calls.push([name, args]);
      return { ok: true, text: "pong" };
    },
  });
  const terminal = path.resolve(import.meta.dirname, "../../../terminal/src/main.ts");
  const mcp = new Client({ name: "test", version: "0" });
  await mcp.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [terminal, "mcp", "--run"],
      env: { ...process.env, APX_URL: env.core.url, APX_RUN_TOKEN: token } as Record<string, string>,
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
  env.core.harnesses.closeGate(token);
  const gone = await mcp.callTool({ name: "ping", arguments: {} });
  assert.equal(gone.isError, true);
  await mcp.close();
});
