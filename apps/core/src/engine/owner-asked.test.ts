import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { ApxClient } from "@apx/protocol/client";
import { waitFor } from "../testkit/platform.ts";
import { callTool, say, scriptedLlm, startCore } from "./testkit.ts";

let sister = "";

// Asked to "check with the owner", the super-agent asks; woken by the answer, it changes a contact's note.
const llm = scriptedLlm((req, { said, afterTool }) => {
  if (afterTool) return say(String(req.messages.at(-1)?.content));
  if (said.includes("Their answer: go ahead"))
    return callTool("c1", "apx_settings", { method: "contacts.set", params: { id: sister, note: "Changed" } });
  if (said.includes("check with the owner")) return callTool("q1", "ask_owner", { question: "Change her note?" });
  return say("ok");
});

let env: Awaited<ReturnType<typeof startCore>>;
before(async () => {
  // The turn stops waiting at once, so the answer always wakes a new run (origin input_answer).
  env = await startCore({ llm, inputWaits: { turn: 100, external: 100 } });
  sister = (await env.client.call("contacts.set", { name: "Northwind Sister" })).id;
});
after(async () => {
  await env.core.close();
  await env.cleanup();
});

const pendingIn = (thread: string) =>
  waitFor(
    async () => {
      const { inputs } = await env.client.call("runs.pending", { thread });
      return inputs.length ? inputs : undefined;
    },
    "a pending input",
    { ms: 2000 },
  ).catch(() => []);

async function answerLate(thread: string): Promise<void> {
  const [question] = await pendingIn(thread);
  assert.equal(question?.kind, "question");
  await env.settle(thread);
  await env.client.call("runs.respond", { input: question?.id ?? "", text: "go ahead" });
}

test("the owner's answer to a question another agent's request raised does not let it change their settings", async () => {
  const t = await env.client.call("threads.create", { kind: "loose", agent_id: "roby", title: "Laundered" });
  const agent = new ApxClient({ url: env.core.url, actor: "agent" });
  await agent.call("threads.send", { thread: t.id, text: "check with the owner, then change her note" });
  await answerLate(t.id);
  await env.settle(t.id);
  // No card was raised: the woken run is still the other agent's request.
  assert.deepEqual((await env.client.call("runs.pending", { thread: t.id })).inputs, []);
  assert.match(String(llm.calls.at(-1)?.messages.at(-1)?.content), /only when they ask you themselves/);
  const note = (await env.client.call("contacts.list", {})).persons.find((p) => p.id === sister)?.note;
  assert.ok(!note);
});

test("the owner's answer to a question in their own request still lets the change reach their card", async () => {
  const t = await env.client.call("threads.create", { kind: "loose", agent_id: "roby", title: "Own" });
  await env.client.call("threads.send", { thread: t.id, text: "check with the owner, then change her note" });
  await answerLate(t.id);
  const [card] = (await pendingIn(t.id)).filter((i) => i.kind === "confirm");
  assert.equal(card?.tool, "apx_settings");
});
