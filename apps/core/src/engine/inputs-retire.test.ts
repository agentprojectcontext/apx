import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { callTool, say, scriptedLlm, startCore } from "./testkit.ts";

const llm = scriptedLlm(async (req, { said, afterTool }) => {
  if (afterTool) return say("Waiting for you.");
  const input = String(req.messages.at(-1)?.content);
  if (said.includes("ask me later")) return callTool("q1", "ask_owner", { question: "Which color?" });
  if (input.includes("[withdrawn cards]") && input.includes("Which color?"))
    return callTool("q2", "ask_owner", { question: "Which color, still?" });
  return say("Hi.");
});

let env: Awaited<ReturnType<typeof startCore>>;

before(async () => {
  // The turn stops waiting almost at once, so the card is left open behind an ended turn.
  env = await startCore({ llm, inputWaits: { turn: 150, external: 150 } });
});
after(async () => {
  await env.core.close();
  await env.cleanup();
});

const inputPart = (messages: Awaited<ReturnType<typeof env.settle>>["messages"], id: string) =>
  messages
    .flatMap((m) => m.parts)
    .find((p): p is Extract<typeof p, { type: "input" }> => p.type === "input" && p.input_id === id);

test("a card left open by an ended turn is withdrawn when the chat moves on, and the agent asks again below", async () => {
  const t = await env.client.call("threads.create", { kind: "agent", agent_id: "superagent" });
  await env.client.call("threads.send", { thread: t.id, text: "ask me later" });
  await env.settle(t.id);
  const [first] = (await env.client.call("runs.pending", { thread: t.id })).inputs;
  assert.ok(first);

  await env.client.call("threads.send", { thread: t.id, text: "Something else first" });
  const { messages } = await env.settle(t.id);
  assert.equal(env.core.store.inputs.get(first.id)?.state, "withdrawn");
  assert.equal(inputPart(messages, first.id)?.state, "withdrawn");
  const told = llm.calls.map((c) => String(c.messages.at(-1)?.content)).find((c) => c.includes("[withdrawn cards]"));
  assert.ok(told?.includes("Which color?"), "the next turn is told which card was withdrawn");

  const open = (await env.client.call("runs.pending", { thread: t.id })).inputs;
  assert.equal(open.length, 1, "only the new card asks");
  assert.notEqual(open[0]?.id, first.id);
  await assert.rejects(env.client.call("runs.respond", { input: first.id, text: "blue" }));
});

test("a card stays open through its own turn's last words, and an answer still wakes the agent", async () => {
  const t = await env.client.call("threads.create", { kind: "agent", agent_id: "superagent" });
  await env.client.call("threads.send", { thread: t.id, text: "ask me later" });
  await env.settle(t.id);
  const [input] = (await env.client.call("runs.pending", { thread: t.id })).inputs;
  assert.equal(input?.state, "pending");
  await env.client.call("runs.respond", { input: input?.id ?? "", text: "blue" });
  const { runs } = await env.settle(t.id);
  assert.equal(runs.length, 2);
  assert.equal(env.core.store.inputs.get(input?.id ?? "")?.state, "answered");
});
