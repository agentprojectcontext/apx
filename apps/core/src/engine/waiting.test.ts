// The owner's words written while their agent works: sent (the turn takes them at its next step), "send now" (the
// step in progress stops and the turn takes them at once), and in line (they wait for the turn to end, and can be
// edited, moved or removed until it starts). See DECISIONS.md#d-186.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { Message } from "@apx/protocol";
import { z } from "zod";
import { tempDir, waitFor } from "../testkit/platform.ts";
import { defineTool } from "../tools/types.ts";
import { callTool, say, scriptedLlm, startCore } from "./testkit.ts";

/** Holds until a test lets it go or the step is cut short; never decided by time. */
const gates: Array<() => void> = [];
const release = () => {
  for (const go of gates.splice(0)) go();
};
const hold = defineTool({
  name: "hold",
  description: "test tool that waits until released",
  args: z.object({}),
  effect: "none",
  confirm: "never",
  deadlineMs: 60_000,
  title: () => "Holding",
  run: (_args, ctx) =>
    new Promise<string>((resolve, reject) => {
      gates.push(() => resolve("held"));
      ctx.signal.addEventListener("abort", () => reject(ctx.signal.reason), { once: true });
    }),
});

const OWNER_ADDS = "[The owner adds";
const llm = scriptedLlm(async (req, { said, afterTool }) => {
  const steer = req.messages.findLast((m) => m.role === "user" && String(m.content).startsWith(OWNER_ADDS));
  if (steer && said.startsWith(OWNER_ADDS)) return say(`Took: ${String(steer.content).split("\n")[1]}`);
  if (afterTool) return say("Finished.");
  if (said.includes("work")) return callTool(`h${req.messages.length}`, "hold", {});
  // A model call that only ends when it is stopped.
  if (said.includes("think"))
    return new Promise<never>((_, reject) => {
      req.signal?.addEventListener("abort", () => reject(req.signal?.reason), { once: true });
    });
  return say(`Plain: ${said}`);
});

let env: Awaited<ReturnType<typeof startCore>>;
before(async () => {
  env = await startCore({ llm, extraTools: [hold] });
});
after(async () => {
  release();
  await env.core.close();
  await env.cleanup();
});

const said = (m: Message) =>
  m.parts.flatMap((p) => (p.type === "text" ? [p.text] : p.type === "tool" ? [`[${p.tool}]`] : [])).join(" ");
const transcript = (messages: Message[]) => messages.map((m) => `${m.author.kind}: ${said(m)}`);

async function working(text: string): Promise<{ thread: string; run: string }> {
  const thread = (await env.client.call("threads.create", { kind: "loose", agent_id: "superagent", title: text })).id;
  const sent = await env.client.call("threads.send", { thread, text });
  await waitFor(async () => {
    const r = await env.client.call("runs.get", { run: sent.run.id });
    const steps = env.core.store.runs.steps(sent.run.id);
    return r.state === "working" && r.harness === "native" && (text.includes("think") || steps.length > 0);
  }, "the turn at work");
  return { thread, run: sent.run.id };
}

const message = (id: string) => env.core.store.messages.get(id);

test("a message put in line waits for the turn to end, then runs below its answer", async () => {
  const { thread } = await working("work on it");
  const q = await env.client.call("threads.send", { thread, text: "then this", mode: "queue" });
  assert.deepEqual(message(q.message.id)?.waiting, { until: "turn", run: q.run.id });
  release();
  const { messages, runs } = await env.settle(thread);
  assert.equal(runs.length, 2);
  assert.equal(message(q.message.id)?.waiting, undefined);
  assert.deepEqual(transcript(messages), [
    "user: work on it",
    "agent: [hold] Finished.",
    "user: then this",
    "agent: Plain: then this",
  ]);
});

test("messages in line are edited, moved and removed before they start, and refused once started", async () => {
  const { thread } = await working("work first");
  const send = (text: string) => env.client.call("threads.send", { thread, text, mode: "queue" });
  const a = await send("alpha");
  const b = await send("bravo");
  const c = await send("charlie");
  await env.client.call("runs.update_queued", { run: a.run.id, text: "alpha two" });
  const moved = await env.client.call("runs.reorder", { thread, runs: [c.run.id, a.run.id, b.run.id] });
  assert.deepEqual(
    moved.messages.map((m) => said(m)),
    ["charlie", "alpha two", "bravo"],
  );
  // Every message in line, each once: a partial order is a stale view.
  await assert.rejects(env.client.call("runs.reorder", { thread, runs: [a.run.id, c.run.id] }), /changed/);
  await env.client.call("runs.remove_queued", { run: b.run.id });
  assert.equal(message(b.message.id), undefined);
  assert.equal(env.core.store.runs.get(b.run.id)?.state, "canceled");
  release();
  const { messages } = await env.settle(thread);
  assert.deepEqual(transcript(messages), [
    "user: work first",
    "agent: [hold] Finished.",
    "user: charlie",
    "agent: Plain: charlie",
    "user: alpha two",
    "agent: Plain: alpha two",
  ]);
  await assert.rejects(env.client.call("runs.update_queued", { run: a.run.id, text: "late" }), /already started/);
  await assert.rejects(env.client.call("runs.remove_queued", { run: a.run.id }), /already started/);
});

test("sent while the agent works, the turn takes it at its next step; send now cuts that step short", async () => {
  const { thread, run } = await working("work long");
  const s = await env.client.call("threads.send", { thread, text: "use metric units", mode: "steer" });
  assert.equal(s.steered, true);
  assert.deepEqual(message(s.message.id)?.waiting, { until: "step" });
  // The tool would hold for good: only the owner's "send now" ends this step.
  assert.deepEqual(await env.client.call("runs.send_now", { message: s.message.id }), { now: true });
  const { messages, runs } = await env.settle(thread);
  assert.equal(runs.length, 1);
  assert.equal(runs[0]?.id, run);
  assert.equal(runs[0]?.state, "completed");
  assert.equal(message(s.message.id)?.waiting, undefined);
  assert.deepEqual(transcript(messages), [
    "user: work long",
    "agent: [hold]",
    "user: use metric units",
    "agent: Took: use metric units",
  ]);
  await assert.rejects(env.client.call("runs.send_now", { message: s.message.id }), /already took/);
  gates.splice(0);
});

test("a message the agent has not read yet is taken back: out of its turn or the line, and out of the chat", async () => {
  const { thread, run } = await working("work quietly");
  const s = await env.client.call("threads.send", { thread, text: "never mind", mode: "steer" });
  const q = await env.client.call("threads.send", { thread, text: "nor this", mode: "queue" });
  assert.deepEqual(await env.client.call("runs.unsend", { message: s.message.id }), { removed: true });
  await env.client.call("runs.unsend", { message: q.message.id });
  assert.equal(message(s.message.id), undefined);
  assert.equal(env.core.store.runs.get(q.run.id)?.state, "canceled");
  await assert.rejects(env.client.call("runs.unsend", { message: s.message.id }), /not found/);
  release();
  const { messages, runs } = await env.settle(thread);
  assert.deepEqual(
    runs.filter((r) => r.state !== "canceled").map((r) => r.id),
    [run],
  );
  assert.deepEqual(transcript(messages), ["user: work quietly", "agent: [hold] Finished."]);
});

test("a message the agent already read is not taken back", async () => {
  const { thread } = await working("work then read");
  const s = await env.client.call("threads.send", { thread, text: "read me", mode: "steer" });
  await env.client.call("runs.send_now", { message: s.message.id });
  await env.settle(thread);
  await assert.rejects(env.client.call("runs.unsend", { message: s.message.id }), /already took/);
  gates.splice(0);
});

test("send now stops a model call in progress, and the turn goes on with the owner's words", async () => {
  const { thread, run } = await working("think hard");
  const s = await env.client.call("threads.send", { thread, text: "short answer", mode: "steer" });
  await env.client.call("runs.send_now", { message: s.message.id });
  const { messages, runs } = await env.settle(thread);
  assert.deepEqual(
    runs.map((r) => [r.id, r.state]),
    [[run, "completed"]],
  );
  assert.deepEqual(transcript(messages), ["user: think hard", "user: short answer", "agent: Took: short answer"]);
});

test("send now on a message in line takes it into the running turn", async () => {
  const { thread, run } = await working("work again");
  const q = await env.client.call("threads.send", { thread, text: "this instead", mode: "queue" });
  assert.deepEqual(await env.client.call("runs.send_now", { message: q.message.id }), { now: true });
  const { messages, runs } = await env.settle(thread);
  assert.equal(runs.find((r) => r.id === run)?.state, "completed");
  assert.equal(runs.find((r) => r.id === q.run.id)?.state, "canceled");
  assert.deepEqual(transcript(messages), [
    "user: work again",
    "agent: [hold]",
    "user: this instead",
    "agent: Took: this instead",
  ]);
  gates.splice(0);
});

test("stop cancels what is in line, and its messages no longer wait", async () => {
  const { thread } = await working("work then stop");
  const q = await env.client.call("threads.send", { thread, text: "never mind", mode: "queue" });
  await env.client.call("threads.cancel", { thread });
  await env.settle(thread);
  assert.equal(env.core.store.runs.get(q.run.id)?.state, "canceled");
  assert.equal(message(q.message.id)?.waiting, undefined);
  gates.splice(0);
});

test("what waits survives a restart: the line and the order it runs in", async () => {
  const home = tempDir("apx-waiting-");
  const first = await startCore({ llm, extraTools: [hold], home: home.path });
  const t = (await first.client.call("threads.create", { kind: "loose", agent_id: "superagent" })).id;
  const w = await first.client.call("threads.send", { thread: t, text: "work before restart" });
  await waitFor(() => first.core.store.runs.steps(w.run.id).length > 0, "the turn at work");
  const a = await first.client.call("threads.send", { thread: t, text: "first in line", mode: "queue" });
  const b = await first.client.call("threads.send", { thread: t, text: "second in line", mode: "queue" });
  await first.client.call("runs.reorder", { thread: t, runs: [b.run.id, a.run.id] });
  await first.core.close();
  gates.splice(0);

  const after = scriptedLlm((_req, { said: s }) => say(`Plain: ${s.split("\n").at(-1)}`));
  const second = await startCore({ llm: after, home: home.path });
  try {
    const { messages } = await second.settle(t);
    const owner = messages.filter((m) => m.author.kind === "user").map(said);
    assert.deepEqual(owner.slice(-2), ["second in line", "first in line"]);
    assert.ok(messages.every((m) => !m.waiting));
  } finally {
    await second.core.close();
    await second.cleanup();
  }
});
