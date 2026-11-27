import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { waitFor } from "../testkit/platform.ts";
import { keepWhilePaused } from "./breaker.ts";
import { callTool, say, scriptedLlm, startCore } from "./testkit.ts";

// Two background commands: the first one's end is an unattended turn that reaches the limit, so the second ends while
// agents are paused. Going on, the agent gets the second one's output like a delegation's or a task's result.
const llm = scriptedLlm((req, { said, afterTool }) => {
  const log = req.messages.map((m) => String(m.content)).join("\n");
  if (said.includes("two commands please")) {
    if (!afterTool) return callTool("j1", "shell", { command: "sleep 0.3 && echo first-done", background: true });
    if (!log.includes("second-done") && req.messages.filter((m) => m.role === "tool").length < 2)
      return callTool("j2", "shell", { command: "sleep 1.2 && echo second-done", background: true });
    return say("Both started");
  }
  if (log.includes("ended while agents were paused") && log.includes("second-done")) return say("Went on: second-done");
  return say("Saw an end");
});

let env: Awaited<ReturnType<typeof startCore>>;
before(async () => {
  env = await startCore({ llm });
});
after(async () => {
  await env.core.close();
  await env.cleanup();
});

test("a background command that ends while agents are paused is kept, and going on gives its agent the output", async () => {
  await env.client.call("agents.set_limits", { runs: 1, tokens: 0 });
  const chat = await env.client.call("threads.create", { kind: "loose", agent_id: "superagent", title: "Builds" });
  await env.client.call("threads.send", { thread: chat.id, text: "two commands please" });
  const notice = await waitFor(async () => {
    const { messages } = await env.client.call("threads.get", { thread: chat.id });
    return messages.flatMap((m) => m.parts).find((p) => p.type === "notice" && p.code === "breaker.paused");
  }, "paused notice");
  assert.ok(notice);
  assert.equal(env.core.store.threads.context(chat.id).kept, "superagent", "the chat keeps the result for its agent");

  // More results in the same pause update that one notice and bring it to the end, instead of stacking new ones.
  keepWhilePaused(env.core.store, { thread_id: chat.id, agent_id: "superagent", who: "Third", note: "third-done" });
  const { messages } = await env.client.call("threads.get", { thread: chat.id });
  const paused = messages.filter((m) => m.parts.some((p) => p.type === "notice" && p.code === "breaker.paused"));
  assert.equal(paused.length, 1, "one pause, one notice");
  const part = paused[0]?.parts.find((p) => p.type === "notice");
  assert.equal(part?.type === "notice" ? part.vars?.who : undefined, "Third", "it names the latest result");
  assert.equal(messages.at(-1)?.id, paused[0]?.id, "it sits at the end of the chat");

  const { started } = await env.client.call("threads.go_on", { thread: chat.id, mode: "release" });
  assert.equal(started, 1);
  await waitFor(async () => {
    const { messages } = await env.client.call("threads.get", { thread: chat.id });
    return messages.some((m) => m.parts.some((p) => p.type === "text" && p.text === "Went on: second-done"));
  }, "the agent went on with the output");
});
