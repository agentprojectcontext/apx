import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { say, scriptedLlm, startCore } from "./testkit.ts";

const llm = scriptedLlm(() => say("ok"));
let env: Awaited<ReturnType<typeof startCore>>;

before(async () => {
  env = await startCore({ llm });
});
after(async () => {
  await env.core.close();
  await env.cleanup();
});

/** The owner's message as the model got it this turn, context header included. */
async function turn(thread: string, text: string): Promise<string> {
  await env.client.call("threads.send", { thread, text });
  await env.settle(thread);
  const call = llm.calls.at(-1);
  return String(call?.messages.findLast((m) => m.role === "user")?.content ?? "");
}

const MEANWHILE = /\[sent to the owner since your last turn here/;

test("the owner's next turn in Home knows what APX sent them meanwhile, once", async () => {
  assert.doesNotMatch(await turn("home", "hola"), MEANWHILE);
  const store = env.core.store;
  store.nudges.add({
    kind: "routine:Watch",
    text: "Northwind is waiting for your hooks.",
    state: "sent",
    exempt: false,
  });
  store.nudges.add({ kind: "routine:Other", text: "Dropped news.", state: "dropped", exempt: false });
  const input = await turn("home", "dale");
  assert.match(input, MEANWHILE);
  assert.match(input, /<sent_to_owner what="Watch"[^>]*>[\s\S]*Northwind is waiting for your hooks\./);
  assert.doesNotMatch(input, /Dropped news/, "only what reached the owner");
  // Already seen: the next turn does not get it again.
  assert.doesNotMatch(await turn("home", "y?"), MEANWHILE);
});

test("another chat does not get the owner's channel news", async () => {
  const thread = await env.client.call("threads.create", { kind: "loose", agent_id: "roby", title: "Side" });
  env.core.store.nudges.add({ kind: "routine:Watch", text: "More news.", state: "sent", exempt: false });
  assert.doesNotMatch(await turn(thread.id, "hola"), MEANWHILE);
});
