// A restart in the middle of work: what was admitted runs, what was cut is closed honestly, and a delegation's
// result still reaches the agent that asked for it.
import assert from "node:assert/strict";
import { test } from "node:test";
import { z } from "zod";
import type { ChatItem } from "../providers/types.ts";
import { defineTool } from "../tools/types.ts";
import { callTool, say, scriptedLlm, startCore, texts } from "./testkit.ts";

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

for (const kind of ["question", "confirm"] as const) {
  test(`a delegated ${kind} answered after restart returns only the final report to its caller`, async () => {
    let writes = 0;
    const publish = defineTool({
      name: "publish_report",
      description: "Publish a test report",
      args: z.object({}),
      effect: "external",
      confirm: "always",
      deadlineMs: 5000,
      title: () => "Published report",
      async run() {
        writes++;
        return "Internal tool output marker.";
      },
    });
    const model = scriptedLlm((_req, { system, said, afterTool }) => {
      if (system.startsWith("You are Scout")) {
        if (afterTool || said.includes("Their answer:")) return say("Final report: task complete.");
        if (said.includes("it will run without asking")) return callTool("approved", "publish_report", {});
        const call = callTool(
          "pending",
          kind === "question" ? "ask_owner" : "publish_report",
          kind === "question" ? { question: "Which report?" } : {},
        );
        return { message: { ...call.message, content: "Internal progress marker." } };
      }
      if (said.includes("<delegation_result")) return say(`Received: ${said}`);
      if (!afterTool) return callTool("delegate", "delegate", { agent: "scout", task: "Prepare report", wait_s: 0 });
      return say("Task sent.");
    });
    const first = await startCore({ llm: model, extraTools: [publish] });
    let second: Awaited<ReturnType<typeof startCore>> | undefined;
    try {
      const parent = await first.client.call("threads.create", { kind: "loose", agent_id: "roby" });
      await first.client.call("threads.send", { thread: parent.id, text: "Prepare report" });
      let pending: Awaited<ReturnType<typeof first.client.call<"runs.pending">>>["inputs"] = [];
      for (let i = 0; i < 200 && !pending.length; i++) {
        pending = (await first.client.call("runs.pending", {})).inputs;
        if (!pending.length) await new Promise((resolve) => setTimeout(resolve, 20));
      }
      const input = pending[0];
      assert.ok(input);
      assert.equal(input.kind, kind);
      await first.settle(parent.id);
      const original = first.core.store.runs.get(input.run_id);
      assert.ok(original?.parent_run_id);
      await first.core.close();
      second = await startCore({ llm: model, home: first.home, extraTools: [publish] });
      await second.client.call("runs.respond", {
        input: input.id,
        ...(kind === "question" ? { text: "Final report" } : { decision: "approve" as const }),
      });
      await second.settle(input.thread_id);
      const resumed = second.core.store.runs.list(input.thread_id).find((r) => r.state === "completed");
      assert.equal(resumed?.parent_run_id, original.parent_run_id);
      assert.equal(resumed?.depth, original.depth);
      const received = await second.settle(parent.id);
      const result = received.runs.find((r) => {
        const origin = second?.core.store.runs.get(r.id)?.input?.origin;
        return origin?.kind === "delegation_result" && origin.run_id === resumed?.id;
      });
      assert.equal(result?.state, "completed");
      const cards = received.messages.flatMap((m) => m.parts).filter((p) => p.type === "subthread");
      assert.equal(cards.at(-1)?.state, "completed");
      assert.equal(cards.at(-1)?.summary, "Final report: task complete.");
      const log = second.core.store.modelLog.forRun(result?.id ?? "");
      assert.match(JSON.stringify(log), /Final report: task complete/);
      assert.doesNotMatch(JSON.stringify(log), /Internal progress marker|Internal tool output marker/);
      assert.equal(writes, kind === "confirm" ? 1 : 0);
    } finally {
      if (second) await second.core.close();
      else await first.core.close();
      first.cleanup();
    }
  });
}
