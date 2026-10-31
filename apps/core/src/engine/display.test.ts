import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { Part } from "@apx/protocol";
import { openDisplay } from "./display.ts";
import { say, scriptedLlm, startCore } from "./testkit.ts";

let env: Awaited<ReturnType<typeof startCore>>;
before(async () => {
  env = await startCore({ llm: scriptedLlm(() => say("ok")) });
});
after(async () => {
  await env.core.close();
  await env.cleanup();
});

const card = (state: "working" | "completed"): Part => ({
  type: "subthread",
  thread_id: "thr_sub",
  agent_id: "superagent",
  title: "Scout",
  state,
});

async function answerIn() {
  const t = (await env.client.call("threads.create", { kind: "loose", agent_id: "superagent", title: "display" })).id;
  const { store } = env.core;
  const display = openDisplay(
    store,
    store.messages.add({ thread_id: t, author: { kind: "agent", id: "superagent" }, parts: [], run_id: "run_x" }),
  );
  return { t, store, display };
}

test("after the owner's words, a card shown above them still changes in place", async () => {
  const { t, store, display } = await answerIn();
  display.upsert((p) => p.type === "subthread", card("working"));
  const above = display.message.id;
  store.messages.add({ thread_id: t, author: { kind: "user" }, parts: [{ type: "text", text: "also check prices" }] });
  const below = display.below();
  display.finalText("Checked.");
  assert.ok(display.find((p) => p.type === "subthread"));
  display.upsert((p) => p.type === "subthread", card("completed"));
  const [first, , last] = store.messages.list(t);
  assert.equal(first?.id, above);
  assert.deepEqual(first?.parts, [card("completed")]);
  assert.equal(last?.id, below.id);
  assert.deepEqual(last?.parts, [{ type: "text", text: "Checked." }]);
  assert.deepEqual(
    store.messages.ofRun(t, "run_x").map((m) => m.id),
    [above, below.id],
  );
});

test("an answer with nothing in it yet leaves no empty message above the owner's words", async () => {
  const { t, store, display } = await answerIn();
  store.messages.add({ thread_id: t, author: { kind: "user" }, parts: [{ type: "text", text: "wait" }] });
  display.below();
  display.finalText("Waiting.");
  assert.deepEqual(
    store.messages.list(t).map((m) => m.author.kind),
    ["user", "agent"],
  );
});
