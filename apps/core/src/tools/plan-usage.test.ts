import assert from "node:assert/strict";
import { test } from "node:test";
import type { EngineUsageReport } from "@apx/protocol";
import { callTool, say, scriptedLlm, startCore } from "../engine/testkit.ts";
import { planUsageTools } from "./plan-usage.ts";
import type { ToolContext } from "./types.ts";

const report: EngineUsageReport = {
  checked_at: "2026-10-01T12:00:00.000Z",
  engines: [
    {
      id: "claude",
      label: "Claude",
      cli_installed: true,
      available: true,
      status: "ok",
      source: "claude_cli",
      windows: [
        { id: "primary", used_percent: 0, window_minutes: 300 },
        { id: "secondary", used_percent: 90, window_minutes: 10080, resets_at: "2026-10-02T12:00:00.000Z" },
      ],
    },
    {
      id: "codex",
      label: "Codex",
      cli_installed: true,
      available: false,
      status: "unavailable",
      source: "codex_app_server",
      windows: [],
      reason: "not_available",
    },
    {
      id: "acp:cursor",
      label: "Cursor",
      cli_installed: true,
      available: false,
      status: "unavailable",
      source: "none",
      windows: [],
      reason: "unsupported",
    },
  ],
};

async function read(query?: string) {
  const tool = planUsageTools(() => true)[0];
  assert.ok(tool);
  const calls: string[] = [];
  const ctx = {
    call: async (method: string, params: unknown) => {
      calls.push(method);
      assert.deepEqual(params, {});
      return report;
    },
  } as unknown as ToolContext;
  const text = await tool.run(query ? { query } : {}, ctx);
  assert.deepEqual(calls, ["engines.usage"]);
  assert.match(text, /trust="untrusted"/);
  return JSON.parse(text.split("\n")[1] ?? "") as EngineUsageReport & { matched?: boolean; note: string };
}

test("all accounts retain zero, weekly quota, reset, unavailable and unsupported without estimating", async () => {
  const result = await read();
  assert.deepEqual(result.engines, report.engines);
  assert.equal(result.checked_at, report.checked_at);
  assert.match(result.note, /not chat tokens/);
  assert.match(result.note, /up to 60 seconds/);
});

test("filters span accounts independently of the current model and unknown is not zero", async () => {
  for (const [query, id] of [
    ["CLAUDE", "claude"],
    ["Claude Auto", "claude"],
    ["ChatGPT", "codex"],
    ["OpenAI", "codex"],
    ["Cursor", "acp:cursor"],
    ["acp:cursor", "acp:cursor"],
  ]) {
    const result = await read(query);
    assert.deepEqual(
      result.engines.map((engine) => engine.id),
      [id],
    );
    assert.equal(result.matched, true);
  }
  const missing = await read("unknown-plan");
  assert.equal(missing.matched, false);
  assert.deepEqual(missing.engines, []);
  assert.match(missing.note, /does not mean zero usage/);
});

test("tool is read-only, bounded and rejects empty or excessive filters", () => {
  const tool = planUsageTools(() => true)[0];
  assert.ok(tool);
  assert.equal(tool.effect, "none");
  assert.equal(tool.confirm({}), "never");
  assert.equal(tool.parse({ query: " " }).ok, false);
  assert.equal(tool.parse({ query: "x".repeat(101) }).ok, false);
  assert.deepEqual(tool.parse({ query: " Claude " }), { ok: true, args: { query: "Claude" } });
});

test("reader failures remain errors rather than synthetic zero quotas", async () => {
  const tool = planUsageTools(() => true)[0];
  assert.ok(tool);
  const ctx = {
    call: async () => {
      throw new Error("quota check failed");
    },
  } as unknown as ToolContext;
  await assert.rejects(tool.run({}, ctx), /quota check failed/);
});

test("agent can discover and execute plan_usage through the real tool executor and router", async () => {
  const llm = scriptedLlm((req, { afterTool }) => {
    if (afterTool) return say(String(req.messages.at(-1)?.content));
    assert.ok(req.tools.some((tool) => tool.function.name === "plan_usage"));
    return callTool("quota", "plan_usage", { query: "unknown-plan" });
  });
  const env = await startCore({ llm });
  try {
    await env.client.call("engines.set_usage", { engine: "acp:cursor", enabled: true });
    const thread = await env.client.call("threads.create", { kind: "loose", agent_id: "superagent" });
    await env.client.call("threads.send", { thread: thread.id, text: "Check my unknown-plan usage" });
    const { messages } = await env.settle(thread.id);
    const text = messages.at(-1)?.parts.find((part) => part.type === "text")?.text ?? "";
    assert.match(text, /"matched":false/);
    assert.match(text, /does not mean zero usage/);
    assert.equal(env.core.store.settings.read("engine_usage").codex, undefined);
  } finally {
    await env.core.close();
    await env.cleanup();
  }
});
