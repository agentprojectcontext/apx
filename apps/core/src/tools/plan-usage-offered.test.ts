import assert from "node:assert/strict";
import { test } from "node:test";
import { say, scriptedLlm, startCore } from "../engine/testkit.ts";

test("plan usage is offered only with enabled checks, including linked defaults but respecting opt-outs", async () => {
  const llm = scriptedLlm(() => say("ok"));
  const env = await startCore({ llm });
  const offered = async () => {
    const thread = await env.client.call("threads.create", { kind: "loose", agent_id: "superagent" });
    await env.client.call("threads.send", { thread: thread.id, text: "hello" });
    await env.settle(thread.id);
    return llm.calls.at(-1)?.tools.some((tool) => tool.function.name === "plan_usage");
  };
  try {
    assert.equal(await offered(), false);
    await env.client.call("engines.set_usage", { engine: "claude", enabled: true });
    assert.equal(await offered(), true);
    await env.client.call("engines.set_usage", { engine: "claude", enabled: false });
    assert.equal(await offered(), false);
    env.core.secrets.set("chatgpt_login", "test-link-metadata");
    assert.equal(await offered(), true);
    await env.client.call("engines.set_usage", { engine: "codex", enabled: false });
    assert.equal(await offered(), false);
    env.core.secrets.set("chatgpt_login", null);
    assert.equal(await offered(), false);
  } finally {
    await env.core.close();
    await env.cleanup();
  }
});
