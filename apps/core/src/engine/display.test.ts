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

test("model report provenance is persisted, upgraded without a model change and kept below owner messages", async () => {
  const { t, store, display } = await answerIn();
  display.setModel("claude/reported");
  assert.equal(store.messages.get(display.message.id)?.model_reported, undefined);
  display.setModel("claude/reported", true);
  assert.equal(store.messages.get(display.message.id)?.model_reported, true);
  display.finalText("First response");
  const first = display.message.id;
  store.messages.add({ thread_id: t, author: { kind: "user" }, parts: [{ type: "text", text: "continue" }] });
  const next = display.below();
  assert.equal(store.messages.get(next.id)?.model_reported, true);
  display.setModel("claude/next", true);
  display.finalText("Next response");
  assert.equal(store.messages.get(first)?.model, "claude/reported");
  assert.equal(store.messages.get(first)?.model_reported, true);
  assert.equal(store.messages.get(next.id)?.model, "claude/next");
  display.setModel("claude/requested");
  assert.equal(store.messages.get(next.id)?.model_reported, undefined);
});

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

const plan = (state: "doing" | "done"): Part => ({ type: "plan", steps: [{ step: "Check prices", state }] });

test("a plan marked again leaves its place and goes under what was written since", async () => {
  const { store, display } = await answerIn();
  display.upsert((p) => p.type === "plan", plan("doing"), { last: true });
  display.finalText("Looking now.");
  display.upsert((p) => p.type === "subthread", card("working"));
  display.upsert((p) => p.type === "plan", plan("done"), { last: true });
  display.text("All checked.");
  display.close();
  assert.deepEqual(store.messages.get(display.message.id)?.parts, [
    { type: "text", text: "Looking now." },
    card("working"),
    plan("done"),
    { type: "text", text: "All checked." },
  ]);
});

test("a plan marked below the owner's words leaves the message above them", async () => {
  const { t, store, display } = await answerIn();
  display.upsert((p) => p.type === "plan", plan("doing"), { last: true });
  const above = display.message.id;
  store.messages.add({ thread_id: t, author: { kind: "user" }, parts: [{ type: "text", text: "also check stock" }] });
  display.below();
  display.finalText("On it.");
  display.upsert((p) => p.type === "plan", plan("done"), { last: true });
  assert.equal(store.messages.get(above), undefined);
  assert.deepEqual(store.messages.get(display.message.id)?.parts, [{ type: "text", text: "On it." }, plan("done")]);
});
