import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
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

/** A Claude Code or Codex session of the owner's, in a fresh project folder. */
async function session(engine: "claude" | "codex") {
  const repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "apx2-harness-")));
  const project = (await env.client.call("projects.register", { path: repo, init: true })).project.id;
  return env.client.call("threads.create", { kind: "code", agent_id: "roby", project_id: project, engine });
}

test("a Claude Code session runs there, with APX tools, cards, usage and its own session kept", async () => {
  const t0 = await session("claude");
  await env.client.call("threads.send", { thread: t0.id, text: "hello" });
  const t = await env.settle(t0.id);
  const answer = t.messages.at(-1);
  assert.equal(answer?.model, "claude/model");
  assert.ok(answer?.parts.some((p) => p.type === "tool" && p.tool === "show_widget" && p.status === "ok"));
  assert.ok(answer?.parts.some((p) => p.type === "text" && p.text === "widget ok=true"));
  assert.equal(t.runs[0]?.harness, "claude");
  assert.deepEqual(t.runs[0]?.usage, { input: 10, output: 5 });
  assert.match(seen.at(-1)?.io.system ?? "", /running inside APX/);
  await env.client.call("threads.send", { thread: t0.id, text: "again" });
  await env.settle(t0.id);
  assert.equal(seen.at(-1)?.io.sessionId, "sess-1");
  // Its tool calls left step records like the native loop's.
  assert.equal(env.core.store.runs.steps(t.runs[0]?.id ?? "")[0]?.tool, "show_widget");
});

test("a CLI is never an agent's model, the router or the install default; one saved by an older APX is skipped", async () => {
  for (const bad of ["claude", "codex/gpt-x"]) {
    const asRouter = await env.client
      .call("models.set_config", { router: { rules: [], chain: [bad] } })
      .catch((e: unknown) => e);
    assert.ok(asRouter instanceof ApxError && /own sessions/.test(asRouter.message), bad);
    const asDefault = await env.client
      .call("models.set_config", { default: { model: bad, router: false } })
      .catch((e: unknown) => e);
    assert.ok(asDefault instanceof ApxError && asDefault.code === "bad_request", bad);
    const asAgent = await env.client
      .call("agents.update", { agent: "roby", model_choice: { model: bad, router: false } })
      .catch((e: unknown) => e);
    assert.ok(asAgent instanceof ApxError && asAgent.code === "bad_request", bad);
    const inChat = await env.client
      .call("threads.model", { thread: "home", model_choice: { model: bad, router: false } })
      .catch((e: unknown) => e);
    assert.ok(inChat instanceof ApxError && inChat.code === "bad_request", bad);
  }
  // As an older APX saved them: the router and the default name CLIs; the turn runs on the model API behind them.
  env.core.store.settings.write("model_default", { model: "claude", router: true });
  env.core.store.settings.write("model_router", {
    rules: [{ when: {}, model: "codex" }],
    chain: ["codex", "fake/fake-1"],
  });
  const config = await env.client.call("models.config", {});
  assert.deepEqual(config, { default: { router: true }, router: { rules: [], chain: ["fake/fake-1"] } });
  const { engines } = await env.client.call("engines.status", {});
  assert.equal(engines.find((e) => e.default)?.id, "native");
  const before_ = seen.length;
  await env.client.call("threads.send", { thread: "home", text: "who answers?" });
  const t = await env.settle("home");
  assert.equal(seen.length, before_, "no CLI ran");
  assert.equal(texts(t.messages).at(-1), "native answer");
  assert.equal(t.runs[0]?.harness, "native");
});

test("an engine session runs its own CLI only: another engine's model is refused there", async () => {
  const t = await session("claude");
  for (const other of ["fake/fake-1", "codex"]) {
    const err = await env.client
      .call("threads.model", { thread: t.id, model_choice: { model: other, router: false } })
      .catch((e: unknown) => e);
    assert.ok(err instanceof ApxError && err.code === "bad_request", other);
  }
  await env.client.call("threads.model", { thread: t.id, model_choice: { model: "claude/opus", router: false } });
  const before_ = seen.length;
  await env.client.call("threads.send", { thread: t.id, text: "hello" });
  const done = await env.settle(t.id);
  assert.equal(seen.length, before_ + 1);
  assert.deepEqual(seen.at(-1)?.io.models, ["claude/opus"]);
  assert.equal(seen.at(-1)?.io.input.content, "hello", "the owner's words as they are");
  assert.equal(done.runs[0]?.harness, "claude");
});

test("a CLI that fails in its session fails the turn: no other engine answers for it", async () => {
  const t = await session("codex");
  await env.client.call("threads.send", { thread: t.id, text: "hello" });
  const done = await env.settle(t.id);
  assert.equal(done.runs[0]?.state, "failed");
  assert.equal(done.runs[0]?.harness, "codex");
  assert.ok(!texts(done.messages).includes("native answer"));
});

test("a model ref nothing can run is refused when it is set", async () => {
  for (const bad of ["fake", "nope/x"]) {
    const err = await env.client
      .call("models.set_config", { router: { rules: [], chain: [bad] } })
      .catch((e: unknown) => e);
    assert.ok(err instanceof ApxError && err.code === "bad_request", bad);
  }
  const err = await env.client
    .call("agents.update", { agent: "roby", model_choice: { model: "nope/x", router: false } })
    .catch((e: unknown) => e);
  assert.ok(err instanceof ApxError && err.code === "bad_request");
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

test("Claude Code gets each tool's real schema: arrays stay arrays, limits stay limits", async () => {
  const { zodShape } = await import("./claude.ts");
  const { ownerTools } = await import("../tools/owner.ts");
  const { toSpec } = await import("../tools/types.ts");
  const ask = ownerTools(env.core.store).find((t) => t.name === "ask_owner");
  assert.ok(ask);
  const { z } = await import("zod");
  const schema = z.object(zodShape(toSpec(ask).function.parameters));
  assert.ok(schema.safeParse({ question: "Which?", options: ["red", "blue"] }).success);
  assert.ok(!schema.safeParse({ question: "Which?", options: "red, blue" }).success);
  assert.ok(!schema.safeParse({ question: "" }).success);
});
