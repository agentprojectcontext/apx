// A restart in the middle of work: what was admitted runs, what was cut is closed honestly, and a delegation's
// result still reaches the agent that asked for it.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { ChatItem } from "../providers/types.ts";
import { say, scriptedLlm, startCore, texts } from "./testkit.ts";

const llm = scriptedLlm((_req, { system, said }) => {
  if (system.startsWith("You are Scout")) return say("Scout's findings.");
  if (said.includes("<delegation_result")) return say("Scout came back after the restart.");
  return say("Answered after the restart.");
});

test("a restart closes a cut turn (effect unknown for a started tool), runs queued work and wakes the caller", async () => {
  // ── before the "crash": state written directly, as a killed process would leave it ──
  const first = await startCore({ llm });
  const { store } = first.core;
  const roby = store.agents.get("roby");
  assert.ok(roby);
  const deadline = new Date(Date.now() + 60_000).toISOString();

  // 1. A turn that died while a browser click was in flight.
  const cut = store.threads.create({ kind: "loose", title: "cut", agent_ids: ["roby"] });
  let run = store.runs.create({
    thread_id: cut.id,
    agent_id: "roby",
    trigger: "user",
    input: { origin: { kind: "user" }, text: "click it" },
    deadline_at: deadline,
  });
  run = store.runs.setState(run, "working");
  const msg = store.messages.add({
    thread_id: cut.id,
    author: { kind: "agent", id: "roby" },
    run_id: run.id,
    parts: [{ type: "tool", call_id: "k1", tool: "browser_click", title: "Clicked e3", status: "running" }],
  });
  run = store.runs.patch(run, { message_id: msg.id });
  store.modelLog.append(cut.id, run.id, [
    { role: "user", content: "click it" },
    {
      role: "assistant",
      content: null,
      tool_calls: [
        { id: "k1", type: "function", function: { name: "browser_click", arguments: "{}" } },
        { id: "k2", type: "function", function: { name: "browser_snapshot", arguments: "{}" } },
      ],
    },
  ] satisfies ChatItem[]);
  store.runs.beginStep(run.id, { call_id: "k1", tool: "browser_click", args: {}, effect: "external" });

  // 2. A message admitted but never started.
  const queued = store.threads.create({ kind: "loose", title: "queued", agent_ids: ["roby"] });
  store.messages.add({
    thread_id: queued.id,
    author: { kind: "user" },
    parts: [{ type: "text", text: "are you there?" }],
  });
  store.runs.create({
    thread_id: queued.id,
    agent_id: "roby",
    trigger: "user",
    input: { origin: { kind: "user" }, text: "are you there?" },
    deadline_at: deadline,
  });

  // 3. A delegation whose caller already moved on: the child never started.
  const parentThread = store.threads.create({ kind: "loose", title: "parent", agent_ids: ["roby"] });
  let parent = store.runs.create({
    thread_id: parentThread.id,
    agent_id: "roby",
    trigger: "user",
    input: { origin: { kind: "user" }, text: "ask scout" },
    deadline_at: deadline,
  });
  parent = store.runs.setState(store.runs.setState(parent, "working"), "completed");
  const sub = store.threads.create({
    kind: "a2a",
    title: "Roby → Scout",
    agent_ids: ["scout", "roby"],
    parent_id: parentThread.id,
  });
  store.runs.create({
    thread_id: sub.id,
    agent_id: "scout",
    trigger: "a2a",
    input: {
      origin: { kind: "agent", id: "roby", name: "Roby", thread_id: parentThread.id, run_id: parent.id },
      text: "look this up",
    },
    parent_run_id: parent.id,
    depth: 1,
    deadline_at: deadline,
  });

  // The process "dies": the engine never ran these, nothing in memory knows about them.
  await first.core.close();

  // ── after the restart ──
  const second = await startCore({ llm, home: first.home });
  try {
    const cutNow = await second.client.call("threads.get", { thread: cut.id });
    assert.equal(cutNow.runs[0]?.state, "failed");
    assert.equal(cutNow.runs[0]?.error, "interrupted by a restart");
    const parts = cutNow.messages.at(-1)?.parts ?? [];
    assert.ok(
      parts.some((p) => p.type === "tool" && p.status === "error" && p.detail === "interrupted by a restart"),
      "no spinner left",
    );
    assert.ok(parts.some((p) => p.type === "notice" && p.code === "run.interrupted"));
    // The model will see the click as "effect unknown" and the snapshot that never started as "not run".
    const log = second.core.store.modelLog.forRun(run.id) as ChatItem[];
    const result = (id: string) => log.find((m) => m.role === "tool" && m.tool_call_id === id)?.content;
    assert.match(String(result("k1")), /^effect UNKNOWN: browser_click/);
    assert.equal(result("k2"), "not run: the turn was interrupted");
    assert.equal(second.core.store.runs.steps(run.id)[0]?.state, "unknown");

    const queuedNow = await second.settle(queued.id);
    assert.equal(queuedNow.runs[0]?.state, "completed");
    assert.deepEqual(texts(queuedNow.messages).at(-1), "Answered after the restart.");

    const subNow = await second.settle(sub.id);
    assert.equal(subNow.runs[0]?.state, "completed");
    const parentNow = await second.settle(parentThread.id);
    const woken = parentNow.runs.find((r) => r.trigger === "a2a_result");
    assert.equal(woken?.state, "completed");
    assert.ok(texts(parentNow.messages).includes("Scout came back after the restart."));
  } finally {
    await second.core.close();
    second.cleanup();
  }
});
