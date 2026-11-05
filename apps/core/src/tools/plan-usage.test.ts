import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import type { EngineUsageReport } from "@apx/protocol";
import { callTool, say, scriptedLlm, startCore } from "../engine/testkit.ts";
import { planUsage, USAGE } from "./plan-usage.ts";
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
  const calls: string[] = [];
  const call = (async (method: string, params: unknown) => {
    calls.push(method);
    assert.deepEqual(params, { all: true });
    return report;
  }) as unknown as ToolContext["call"];
  const text = await planUsage(query, call);
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

test("the read asks nobody, is bounded and rejects empty or excessive filters", () => {
  const own = USAGE["engines.usage"]?.own;
  assert.ok(own);
  assert.equal(own.reads, true);
  assert.equal(own.confirm, "never");
  assert.equal(own.args.safeParse({ query: " " }).success, false);
  assert.equal(own.args.safeParse({ query: "x".repeat(101) }).success, false);
  assert.deepEqual(own.args.parse({ query: " Claude " }), { query: "Claude" });
});

test("reader failures remain errors rather than synthetic zero quotas", async () => {
  const call = (async () => {
    throw new Error("quota check failed");
  }) as unknown as ToolContext["call"];
  await assert.rejects(planUsage(undefined, call), /quota check failed/);
});

test("the super-agent reads plan usage through apx_settings and the router, without changing what the top bar shows", async () => {
  const llm = scriptedLlm((req, { afterTool }) => {
    if (afterTool) return say(String(req.messages.at(-1)?.content));
    return callTool("quota", "apx_settings", { method: "engines.usage", params: { query: "unknown-plan" } });
  });
  // Only node on PATH: the read probes every engine it detects, and this machine's own CLIs must not answer.
  const oldPath = process.env.PATH;
  process.env.PATH = path.dirname(process.execPath);
  const env = await startCore({ llm });
  try {
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
    process.env.PATH = oldPath;
  }
});
