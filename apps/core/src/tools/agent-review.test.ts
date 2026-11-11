import assert from "node:assert/strict";
import { test } from "node:test";
import { callTool, inputsOrEnd, say, scriptedLlm, startCore } from "../engine/testkit.ts";

test("super-agent can read pending reviews and the legacy guide, and checked review writes retain owner approval", async () => {
  let revision = "";
  const llm = scriptedLlm((req, { said, afterTool }) => {
    if (afterTool) return say(String(req.messages.at(-1)?.content));
    if (said === "load old guide") return callTool("old", "load_skill", { name: "apx-agent-prompts" });
    if (said === "pending reviews") return callTool("list", "agent_set", { review: true });
    if (said === "apply proposal")
      return callTool("apply", "agent_set", { agent: "reviewer", prompt: "Reviewed role", if_revision: revision });
    return callTool("ack", "agent_set", { agent: "reviewer", review: true, if_revision: revision });
  });
  const env = await startCore({ llm });
  try {
    await env.client.call("agents.create", { slug: "reviewer", name: "Reviewer", prompt: "Original role" });
    const thread = await env.client.call("threads.create", { kind: "loose", agent_id: "superagent" });
    const ask = async (text: string) => env.client.call("threads.send", { thread: thread.id, text });
    await ask("pending reviews");
    await env.settle(thread.id);
    assert.match(String(llm.calls.at(-1)?.messages.at(-1)?.content), /reviewer/);
    await ask("load old guide");
    await env.settle(thread.id);
    assert.match(String(llm.calls.at(-1)?.messages.at(-1)?.content), /name: apx-agents/);
    revision = (await env.client.call("agents.get", { agent: "reviewer" })).revision;
    await ask("apply proposal");
    const denied = await inputsOrEnd(env.client, thread.id);
    assert.equal(denied[0]?.tool, "agent_set");
    assert.equal((await env.client.call("agents.get", { agent: "reviewer" })).prompt, "Original role");
    await env.client.call("runs.respond", { input: denied[0]?.id ?? "", decision: "deny" });
    await env.settle(thread.id);
    assert.equal((await env.client.call("agents.get", { agent: "reviewer" })).prompt, "Original role");
    await ask("apply proposal");
    const approved = await inputsOrEnd(env.client, thread.id);
    await env.client.call("runs.respond", { input: approved[0]?.id ?? "", decision: "approve" });
    await env.settle(thread.id);
    assert.equal((await env.client.call("agents.get", { agent: "reviewer" })).prompt, "Reviewed role");
    assert.equal((await env.client.call("agents.review_queue", {})).agents.length, 0);
    await env.client.call("agents.update", { agent: "reviewer", prompt: "A later change" });
    revision = (await env.client.call("agents.get", { agent: "reviewer" })).revision;
    await ask("mark reviewed");
    const ack = await inputsOrEnd(env.client, thread.id);
    assert.equal(ack[0]?.tool, "agent_set");
    await env.client.call("runs.respond", { input: ack[0]?.id ?? "", decision: "approve" });
    await env.settle(thread.id);
    assert.equal((await env.client.call("agents.review_queue", {})).agents.length, 0);
  } finally {
    await env.core.close();
    await env.cleanup();
  }
});
