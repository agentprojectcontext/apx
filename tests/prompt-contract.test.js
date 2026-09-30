// The prompt a turn is built from, after the rewrite that followed the
// 2026-09-29 incidents: a post published that the rules said to schedule, an
// MCP the model "forgot" it could use, and a delegation contradicted seconds
// later in the same turn.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const { needsExecutionContract, buildExecutionContractBlock, loadDefaultSystemPrompt } = await import("#core/agent/prompt-builder.js");
const { createDelegationGuard } = await import("#core/agent/loop/delegation-guard.js");
const { createToolSession, buildLazyToolsBlock } = await import("#core/agent/tools/registry.js");

test("the execution contract goes to non-Claude models only", () => {
  for (const id of ["chatgpt-codex:gpt-6.1-sol@medium", "openai:gpt-5.2", "zen:big-pickle", "gemini:gemini-3.5-flash", "ollama:qwen3:8b", "mock:gpt"]) {
    assert.ok(needsExecutionContract(id), id);
  }
  for (const id of ["anthropic:claude-opus-5-5", "claude-subscription:claude-sonnet-5-5", "openrouter:anthropic/claude-sonnet-5-5", "mock", "mock:router", ""]) {
    assert.ok(!needsExecutionContract(id), id);
  }
  const block = buildExecutionContractBlock("openai:gpt-5.2");
  assert.match(block, /# Execution contract/);
  assert.match(block, /"publicá" in a project whose rules say posts are scheduled means schedule/);
  assert.match(block, /One plan per job/);
  assert.match(block, /answer from the tool calls in this conversation/);
});

test("the loop appends the contract per call, for the model actually answering", async () => {
  const { runAgent } = await import("#core/agent/run-agent.js");
  const cfg = { super_agent: { enabled: true, model: "mock:gpt", permission_mode: "total", model_fallback: { enabled: false } }, engines: {} };
  const gpt = await runAgent({ globalConfig: cfg, system: "sys", prompt: "[mock:system]", toolSchemas: [], makeToolHandlers: () => ({}), maxIters: 1 });
  assert.match(gpt.text, /# Execution contract/);
  const plain = await runAgent({ globalConfig: { ...cfg, super_agent: { ...cfg.super_agent, model: "mock:router" } }, system: "sys", prompt: "[mock:system]", toolSchemas: [], makeToolHandlers: () => ({}), maxIters: 1 });
  assert.doesNotMatch(plain.text, /# Execution contract/);
});

test("base prompt: folder rules, look-before-answering and one order per job", () => {
  const base = loadDefaultSystemPrompt();
  assert.match(base, /# Rules live next to the work/);
  assert.match(base, /folder_rules/);
  assert.match(base, /Look before you answer/);
  assert.match(base, /One instruction per piece of work/);
  assert.match(base, /# Who does the work/);
  assert.doesNotMatch(base, /if the user asks for project-scoped work without naming one, ask which one/,
    "asking which project is the last resort, not the first move");
});

test("a second, different order to the same agent in one turn is held back", () => {
  const guard = createDelegationGuard();
  assert.equal(guard.check("send_to_agent", { to: "editor", message: "schedule it, do NOT publish" }), null);
  guard.record("send_to_agent", { to: "editor", message: "schedule it, do NOT publish" });
  const held = guard.check("call_agent", { agent: "Editor", prompt: "publish it NOW" });
  assert.match(held.error, /already_delegated/);
  assert.match(held.previous_instruction, /do NOT publish/);
  assert.equal(guard.check("call_agent", { agent: "editor", prompt: "correction: also add the first comment", followup: true }), null);
  assert.equal(guard.check("send_to_agent", { to: "writer", message: "draft it" }), null, "another agent is another job");
});

test("the loop refuses the unmarked second order and records nothing for it", async () => {
  const { runAgent } = await import("#core/agent/run-agent.js");
  const session = createToolSession("web");
  session.delegations = new Map([["editor", "schedule it, do NOT publish"]]);
  const sent = [];
  const args = JSON.stringify({ to: "editor", message: "publish it NOW" });
  const r = await runAgent({
    globalConfig: { super_agent: { enabled: true, model: "mock:test", permission_mode: "total", model_fallback: { enabled: false } }, engines: {} },
    system: "sys",
    prompt: `[mock:tool:send_to_agent] [mock:args:${args}] dale`,
    toolSchemas: session.initialSchemas,
    makeToolHandlers: () => ({ send_to_agent: async (a) => { sent.push(a); return { ok: true }; } }),
    toolHandlerCtx: { toolSession: session, globalConfig: {}, projects: { list: () => [] } },
    maxIters: 2,
  });
  assert.equal(sent.length, 0, "nothing reached the other agent");
  assert.match(r.trace.find((t) => t.tool === "send_to_agent").result.error, /already_delegated/);
});

test("lazy-tools block is in the prompt's language and says to activate, not give up", () => {
  const block = buildLazyToolsBlock(createToolSession("telegram"));
  assert.match(block, /# More tools \(activated on demand\)/);
  assert.match(block, /instead of\s+saying you cannot/);
  assert.doesNotMatch(block, /Tenés|Activalas/);
});

test("the MCP rule in the base prompt names tools a lightweight channel has", () => {
  const base = fs.readFileSync(new URL("../src/core/agent/prompts/core/agent-base.md", import.meta.url), "utf8");
  const tg = new Set(createToolSession("telegram").initialSchemas.map((s) => s.function?.name || s.name));
  for (const t of ["list_mcp_tools", "call_mcp"]) {
    assert.match(base, new RegExp(t));
    assert.ok(tg.has(t), `${t} is loaded on telegram`);
  }
});
