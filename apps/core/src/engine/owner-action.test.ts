import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { Message } from "@apx/protocol";
import { callTool, say, scriptedLlm, startCore } from "./testkit.ts";

// An action card: the agent puts one concrete action to the owner, who accepts or declines it (DECISIONS.md#d-142).
const ACTION = "Publish reel 58 on Saturday 24 at 18:00 and move the two Saturday posts to Monday 26";

const llm = scriptedLlm((_req, { said, afterTool }) => {
  if (afterTool) return say("Turn done.");
  if (said.includes("propose it")) return callTool("a1", "ask_owner", { action: ACTION });
  if (said.includes("propose with options"))
    return callTool("a2", "ask_owner", { action: ACTION, options: ["Yes", "No"] });
  if (said.startsWith("withdraw:")) return callTool("w1", "ask_owner", { withdraw: said.slice("withdraw:".length) });
  return say("ok");
});

let live: Awaited<ReturnType<typeof startCore>>;
let late: Awaited<ReturnType<typeof startCore>>;

before(async () => {
  live = await startCore({ llm });
  // Here the turn stops waiting almost at once, so the answer arrives after it.
  late = await startCore({ llm, inputWaits: { turn: 150, external: 150 } });
});
after(async () => {
  for (const env of [live, late]) {
    await env.core.close();
    await env.cleanup();
  }
});

const inputParts = (messages: Message[]) =>
  messages.flatMap((m) => m.parts.flatMap((p) => (p.type === "input" ? [p] : [])));
const lastToolResult = () => String(llm.calls.at(-1)?.messages.at(-1)?.content);

async function pendingOf(env: typeof live, thread: string) {
  for (let i = 0; i < 200; i++) {
    const [input] = (await env.client.call("runs.pending", { thread })).inputs;
    if (input) return input;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error("no card");
}

test("an action card shows the action with no tool, and accepting it tells the agent to do it", async () => {
  const t = await live.client.call("threads.create", { kind: "agent", agent_id: "roby" });
  await live.client.call("threads.send", { thread: t.id, text: "propose it" });
  const input = await pendingOf(live, t.id);
  assert.equal(input.kind, "confirm");
  assert.equal(input.prompt, ACTION);
  assert.equal(input.tool, undefined);
  assert.equal(input.approval_scopes, undefined);

  await live.client.call("runs.respond", { input: input.id, decision: "approve" });
  const { messages } = await live.settle(t.id);
  assert.match(lastToolResult(), /The owner accepted this action: do it now/);
  const [part] = inputParts(messages);
  assert.equal(part?.state, "approved");
  assert.equal(part?.tool, undefined);
});

test("declining an action card tells the agent not to do it, with the owner's note", async () => {
  const t = await live.client.call("threads.create", { kind: "agent", agent_id: "roby" });
  await live.client.call("threads.send", { thread: t.id, text: "propose it" });
  const input = await pendingOf(live, t.id);
  await live.client.call("runs.respond", { input: input.id, decision: "deny", text: "Keep Saturday as it is" });
  await live.settle(t.id);
  assert.match(lastToolResult(), /The owner declined this action: do not do it\. Their note: Keep Saturday as it is/);
});

test("an action takes no question or options: refused before the owner sees anything", async () => {
  const t = await live.client.call("threads.create", { kind: "agent", agent_id: "roby" });
  await live.client.call("threads.send", { thread: t.id, text: "propose with options" });
  const { messages } = await live.settle(t.id);
  assert.match(lastToolResult(), /invalid arguments for ask_owner: action: an action takes no question or options/);
  assert.deepEqual(inputParts(messages), []);
});

test("an action card accepted after the turn ended wakes the agent to do it", async () => {
  const t = await late.client.call("threads.create", { kind: "agent", agent_id: "roby" });
  await late.client.call("threads.send", { thread: t.id, text: "propose it" });
  await late.settle(t.id);
  assert.match(lastToolResult(), /The card stays open in the chat .*do not do the action/s);
  const [input] = (await late.client.call("runs.pending", { thread: t.id })).inputs;
  assert.ok(input);

  await late.client.call("runs.respond", { input: input.id, decision: "approve" });
  const { runs } = await late.settle(t.id);
  assert.equal(runs.length, 2);
  const woke = String(
    llm.calls
      .findLast((c) => c.messages.some((m) => String(m.content).includes("accepted the action you proposed")))
      ?.messages.at(-1)?.content,
  );
  assert.match(woke, new RegExp(`accepted the action you proposed: "${ACTION}"\\. Do it now`));
});

test("an agent takes back its own open action card", async () => {
  const t = await late.client.call("threads.create", { kind: "agent", agent_id: "roby" });
  await late.client.call("threads.send", { thread: t.id, text: "propose it" });
  await late.settle(t.id);
  const [input] = (await late.client.call("runs.pending", { thread: t.id })).inputs;
  assert.ok(input);
  await late.client.call("threads.send", { thread: t.id, text: `withdraw:${input.id}` });
  await late.settle(t.id);
  assert.match(lastToolResult(), /withdrawn; the owner is not asked again/);
  assert.deepEqual((await late.client.call("runs.pending", { thread: t.id })).inputs, []);
});
