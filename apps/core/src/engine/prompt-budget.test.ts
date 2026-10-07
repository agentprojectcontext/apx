import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { say, scriptedLlm, startCore } from "./testkit.ts";

/**
 * What a fresh install's secretary sends on every model call, in characters (about four to a token). A change that
 * needs more raises these here and in rules/PROMPT_SIZE.md, with the reason in its commit.
 */
const BUDGET = { system: 6_500, tools: 28_000 };

const llm = scriptedLlm(() => say("ok"));
let env: Awaited<ReturnType<typeof startCore>>;
before(async () => {
  env = await startCore({ llm });
});
after(async () => {
  await env.core.close();
  env.cleanup();
});

test("a default turn's system prompt and tools stay within the prompt budget", async () => {
  const t = await env.client.call("threads.create", { kind: "loose", agent_id: "roby" });
  await env.client.call("threads.send", { thread: t.id, text: "hola" });
  await env.settle(t.id);
  const call = llm.calls.at(-1);
  const system = String(call?.messages[0]?.content ?? "").length;
  const tools = JSON.stringify(call?.tools ?? []).length;
  assert.ok(system <= BUDGET.system, `system prompt: ${system} chars, budget ${BUDGET.system} (rules/PROMPT_SIZE.md)`);
  assert.ok(tools <= BUDGET.tools, `tools: ${tools} chars, budget ${BUDGET.tools} (rules/PROMPT_SIZE.md)`);
});
