// A restart in the middle of work: what was admitted runs, what was cut is closed honestly and picked back up once,
// and a delegation's result still reaches the agent that asked for it.
import assert from "node:assert/strict";
import { test } from "node:test";
import { z } from "zod";
import type { ChatItem } from "../providers/types.ts";
import { defineTool } from "../tools/types.ts";
import { RESUME_NOTE, recoverInterrupted } from "./recovery.ts";
import { callTool, say, scriptedLlm, startCore, texts } from "./testkit.ts";

const llm = scriptedLlm((_req, { system, said }) => {
  if (system.startsWith("You are Scout")) return say("Scout's findings.");
  if (said.includes("<delegation_result")) return say("Scout came back after the restart.");
  return say("Answered after the restart.");
});

test("recovery preserves delegation dependencies when SQL returns interrupted children before their caller", async () => {
  const env = await startCore({ llm });
  const { store } = env.core;
  const interrupted = store.runs.interrupted;
  try {
    const thread = store.threads.create({ kind: "loose", title: "Parent", agent_ids: ["roby"] });
    const parent = store.runs.setState(
      store.runs.create({
        thread_id: thread.id,
        agent_id: "roby",
        trigger: "user",
        input: { origin: { kind: "user" }, text: "Ask Scout" },
        deadline_at: "2099-01-01T00:00:00Z",
      }),
      "working",
    );
    const sub = store.threads.create({
      kind: "a2a",
      title: "Child",
      agent_ids: ["roby", "scout"],
      parent_id: thread.id,
    });
    const child = store.runs.setState(
      store.runs.create({
        thread_id: sub.id,
        agent_id: "scout",
        trigger: "a2a",
        parent_run_id: parent.id,
        input: {
          origin: { kind: "agent", id: "roby", name: "Roby", thread_id: thread.id, run_id: parent.id },
          text: "Look this up",
        },
        deadline_at: "2099-01-01T00:00:00Z",
      }),
      "working",
    );
    // Query order is unspecified. Keep all recovery writes real while exercising child-first delivery.
    store.runs.interrupted = () => [child, parent];
    const recovered = recoverInterrupted(store);
    assert.deepEqual(
      recovered.map((r) => [r.run.id, r.resume]),
      [
        [child.id, true],
        [parent.id, true],
      ],
    );
    assert.match(JSON.stringify(store.modelLog.forRun(parent.id)), /Scout.*still going/);
    assert.equal(store.runs.get(child.id)?.state, "failed");
    assert.equal(store.runs.get(parent.id)?.state, "failed");
  } finally {
    store.runs.interrupted = interrupted;
    await env.core.close();
    await env.cleanup();
  }
});

test("a restart closes a cut turn (effect unknown for a started tool), resumes it, runs queued work and wakes the caller", async () => {
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
    const cutNow = await second.settle(cut.id);
    const old = cutNow.runs.find((r) => r.id === run.id);
    assert.equal(old?.state, "failed");
    assert.equal(old?.error, "interrupted by a restart");
    const parts = cutNow.messages.find((m) => m.id === msg.id)?.parts ?? [];
    assert.ok(
      parts.some((p) => p.type === "tool" && p.status === "error" && p.detail === "interrupted by a restart"),
      "no spinner left",
    );
    assert.ok(parts.some((p) => p.type === "notice" && p.code === "run.resumed"));
    // Picked back up once: the same input, told why it stopped instead of reading the owner's message twice.
    const again = cutNow.runs.find((r) => r.id !== run.id);
    assert.equal(again?.state, "completed");
    assert.equal(second.core.store.runs.get(again?.id ?? "")?.input?.resume_of, run.id);
    assert.deepEqual(texts(cutNow.messages).at(-1), "Answered after the restart.");
    const resumedLog = JSON.stringify(second.core.store.modelLog.forRun(again?.id ?? ""));
    assert.ok(resumedLog.includes(RESUME_NOTE));
    assert.ok(!resumedLog.includes("click it"));
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
    await second.cleanup();
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
      await first.cleanup();
    }
  });
}

test("a turn that was already resumed is not resumed again after another restart", async () => {
  const first = await startCore({ llm });
  const { store } = first.core;
  const t = store.threads.create({ kind: "loose", title: "twice", agent_ids: ["roby"] });
  let run = store.runs.create({
    thread_id: t.id,
    agent_id: "roby",
    trigger: "user",
    input: { origin: { kind: "user" }, text: "do it", resume_of: "run_earlier" },
    deadline_at: new Date(Date.now() + 60_000).toISOString(),
  });
  run = store.runs.setState(run, "working");
  await first.core.close();
  const second = await startCore({ llm, home: first.home });
  try {
    const now = await second.client.call("threads.get", { thread: t.id });
    assert.equal(now.runs.length, 1);
    assert.equal(now.runs[0]?.state, "failed");
    assert.equal(now.runs[0]?.error, "interrupted by a restart");
  } finally {
    await second.core.close();
    await second.cleanup();
  }
});

test("shutting APX down mid-delegation resumes both turns on boot, and the caller does not ask again", async () => {
  let restarted = false;
  let scoutStarted: () => void = () => {};
  const scoutWorking = new Promise<void>((resolve) => {
    scoutStarted = resolve;
  });
  const model = scriptedLlm(async (req, { system, said, afterTool }) => {
    if (system.startsWith("You are Scout")) {
      if (restarted) return say("Scout's report.");
      scoutStarted();
      // Works until APX stops it.
      return new Promise((_resolve, reject) => {
        req.signal.addEventListener("abort", () => reject(req.signal.reason));
      });
    }
    if (said.includes("<delegation_result")) return say("Scout reported back.");
    if (said.includes("APX restarted")) return say("Still waiting on Scout.");
    if (!afterTool) return callTool("d1", "delegate", { agent: "scout", task: "Look this up", wait_s: 60 });
    return say("Sent.");
  });
  const first = await startCore({ llm: model });
  let second: Awaited<ReturnType<typeof startCore>> | undefined;
  try {
    const parent = await first.client.call("threads.create", { kind: "loose", agent_id: "roby" });
    await first.client.call("threads.send", { thread: parent.id, text: "Ask Scout" });
    await scoutWorking;
    const sub = first.core.store.threads.list({ include_subthreads: true }).find((t) => t.parent_id === parent.id);
    assert.ok(sub);
    await first.core.close();
    restarted = true;
    second = await startCore({ llm: model, home: first.home });
    const s = second;

    // Neither turn failed on the way down: the boot closed both and ran them again.
    const oldestFirst = <T extends { started_at: string }>(rs: T[]) =>
      [...rs].sort((a, b) => a.started_at.localeCompare(b.started_at));
    const subNow = await s.settle(sub.id);
    assert.deepEqual(
      oldestFirst(subNow.runs).map((r) => [r.state, r.error ?? null]),
      [
        ["failed", "interrupted by a restart"],
        ["completed", null],
      ],
    );
    let parentNow = await s.settle(parent.id);
    for (let i = 0; i < 200 && !parentNow.runs.some((r) => r.trigger === "a2a_result" && r.ended_at); i++) {
      await new Promise((r) => setTimeout(r, 25));
      parentNow = await s.settle(parent.id);
    }
    const parentRuns = oldestFirst(parentNow.runs);
    assert.deepEqual(
      parentRuns.map((r) => [r.trigger, r.state]),
      [
        ["user", "failed"],
        ["user", "completed"],
        ["a2a_result", "completed"],
      ],
    );
    assert.ok(texts(parentNow.messages).includes("Scout reported back."));
    // The caller was told its delegation is still going, and Scout was asked once.
    const resumed = parentRuns[1];
    assert.match(JSON.stringify(s.core.store.modelLog.list(parent.id)), /still going/);
    assert.equal(s.core.store.runs.get(resumed?.id ?? "")?.tool_calls ?? 0, 0);
    assert.equal(subNow.runs.length, 2);
    const cards = parentNow.messages.flatMap((m) => m.parts).filter((p) => p.type === "subthread");
    assert.equal(cards.at(-1)?.state, "completed");
    assert.equal(cards.at(-1)?.summary, "Scout's report.");
  } finally {
    if (second) await second.core.close();
    else await first.core.close();
    await first.cleanup();
  }
});
