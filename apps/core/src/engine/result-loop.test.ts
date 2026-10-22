// A delegated result always closes its loop: the caller reads it framed (Claude Code and Codex sessions too), learns
// when it did not go well, gets a second try when it says nothing, and the owner hears when it still says nothing.
// A task whose work stopped with nobody on it is asked once to go on, then the owner hears of it.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import type { Part } from "@apx/protocol";
import type { Harness, TurnIO } from "../harness/index.ts";
import { realpath } from "../paths.ts";
import { outcomeOf } from "./run-outcome.ts";
import { reviveStalled, STALL_AFTER_MS } from "./task-stall.ts";
import { callTool, say, scriptedLlm, startCore } from "./testkit.ts";

const mute = { name: "Mute", instructions: "Say nothing." };
const echo = { name: "Echo", instructions: "Answer with the marker." };
const slow = { name: "Slow", instructions: "Take a moment, then answer." };
/** Long enough that a caller with wait_s 0 has moved on: the result comes back as a new turn. */
const pause = () => new Promise((r) => setTimeout(r, 300));

const llm = scriptedLlm(async (_req, { system, said, afterTool }) => {
  if (system.startsWith("You are Mute")) return say("");
  if (system.startsWith("You are Echo")) return pause().then(() => say("echo-drop: the report"));
  if (system.startsWith("You are Slow")) return pause().then(() => say("All found."));
  // The caller drops Echo's result every time: it writes nothing and runs no tool.
  if (said.includes("echo-drop")) return say("");
  if (said.includes("<delegation_result")) return say("Noted.");
  if (said.includes("ask mute") && !afterTool) return callTool("m1", "delegate", { worker: mute, task: "do it" });
  if (said.includes("ask echo") && !afterTool)
    return callTool("e1", "delegate", { worker: echo, task: "report back", wait_s: 0 });
  return say(afterTool ? "Done." : "Hello.");
});

/** What a Claude Code session was given, turn by turn. */
const inputs: string[] = [];
const claude: Harness = {
  id: "claude",
  async run(io: TurnIO) {
    const text = String(io.input.content);
    inputs.push(text);
    if (text.includes("delegate please"))
      await io.execute(`${io.run.id}-d`, "delegate", { worker: slow, task: "find it", wait_s: 0 });
    return { text: text.includes("<delegation_result") ? "Got the result." : "On it.", model: "claude/model" };
  },
};

let env: Awaited<ReturnType<typeof startCore>>;
before(async () => {
  env = await startCore({ llm, harnesses: { claude }, unseenAfterMs: 30 });
});
after(async () => {
  await env.core.close();
  env.cleanup();
});

const until = async (check: () => boolean, what: string, ms = 8000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (check()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`never: ${what}`);
};

test("a Claude Code session reads a delegate's late result framed, with what to do with it", async () => {
  const repo = realpath(fs.mkdtempSync(path.join(os.tmpdir(), "apx-loop-")));
  const project = (await env.client.call("projects.register", { path: repo, init: true })).project.id;
  const t = await env.client.call("threads.create", {
    kind: "code",
    agent_id: "roby",
    project_id: project,
    engine: "claude",
  });
  await env.client.call("threads.send", { thread: t.id, text: "delegate please" });
  await until(() => inputs.some((i) => i.includes("<delegation_result")), "the result reached the session");
  const framed = inputs.find((i) => i.includes("<delegation_result")) ?? "";
  assert.match(framed, /All found\./);
  assert.match(framed, /This is the result of a task you delegated earlier\. Tell the owner what matters/);
  // The owner's own words still reach the session as they are.
  assert.equal(inputs[0], "delegate please");
});

test("a delegate that ends without an answer is a warning on its card and in its caller's reply", async () => {
  const t = await env.client.call("threads.create", { kind: "loose", agent_id: "roby", title: "mute" });
  await env.client.call("threads.send", { thread: t.id, text: "ask mute" });
  const got = await env.settle(t.id);
  const card = got.messages
    .flatMap((m) => m.parts)
    .find((p): p is Extract<Part, { type: "subthread" }> => p.type === "subthread");
  assert.equal(card?.state, "completed");
  assert.equal(card?.issue, "no_answer");
  const reply = String(
    llm.calls.flatMap((c) => c.messages).find((m) => m.role === "tool" && m.tool_call_id === "m1")?.content,
  );
  assert.match(reply, /APX marks this result as a warning: it ended without an answer/);
  assert.match(reply, /never report it as done/);
});

test("a result turn that says nothing is tried once more, then the owner's tray says so as a warning", async () => {
  const t = await env.client.call("threads.create", { kind: "loose", agent_id: "roby", title: "echo" });
  await env.client.call("threads.send", { thread: t.id, text: "ask echo" });
  const results = () =>
    env.core.store.runs.list(t.id).filter((r) => r.input?.origin.kind === "delegation_result" && r.ended_at);
  await until(() => results().length === 2, "the dropped result was tried twice");
  await env.settle(t.id);
  const [second, first] = results();
  assert.equal(second?.input?.retry_of, first?.id);
  assert.equal(results().length, 2, "a retry is never retried again");
  // The chat's one unread notice (its earlier turn's) now says the result was dropped.
  const notice = () =>
    env.core.store.notifications.list({ unreadOnly: true, limit: 50 }).filter((n) => n.thread_id === t.id);
  await until(() => notice()[0]?.level === "warn", "the owner was told, as a warning");
  assert.equal(notice().length, 1);
  assert.match(notice()[0]?.body ?? "", /Echo/);
});

test("how a run went: failed is an error; no answer or a failed action is a warning", () => {
  assert.equal(outcomeOf({ state: "failed", error: "boom" }, false).level, "error");
  assert.deepEqual(outcomeOf({ state: "completed" }, true, ["shell ok ×3"]), { level: "ok" });
  const failed = outcomeOf({ state: "completed" }, true, ["shell ok", "browser_type error"]);
  assert.equal(failed.level === "warn" && failed.issue, "actions_failed");
  const silent = outcomeOf({ state: "completed" }, false);
  assert.equal(silent.level === "warn" && silent.issue, "no_answer");
});

/** A task in progress for `agent`, with one finished turn in its work chat. */
function workedTask(status = "doing", agent = "vera") {
  const store = env.core.store;
  const task = store.tasks.create({
    title: `Stalled migration ${status}`,
    description: "Move the data.",
    assignee: agent,
    priority: "normal",
    status,
    thread_id: store.threads.create({ kind: "task", title: "Stalled migration", agent_ids: [agent] }).id,
    by: "owner",
  });
  const chat = store.threads.create({ kind: "loose", title: task.title, agent_ids: [agent], task_id: task.id });
  finished(chat.id, agent, "user");
  return { task, chat };
}

function finished(threadId: string, agent: string, trigger: "user" | "system") {
  const store = env.core.store;
  const run = store.runs.create({
    thread_id: threadId,
    agent_id: agent,
    trigger,
    input: { origin: { kind: "user" }, text: "Work on this task." },
    deadline_at: new Date(Date.now() + 60_000).toISOString(),
  });
  return store.runs.setState(run, "completed");
}

/** Admits like the engine would, and the revived turn ends at once without closing the task. */
const revives: Array<{ trigger: string; origin: { kind: string } }> = [];
const admit = ((a: { thread_id: string; agent_id: string; trigger: string; origin: { kind: string } }) => {
  revives.push(a);
  return finished(a.thread_id, a.agent_id, "system");
}) as unknown as Parameters<typeof reviveStalled>[1];
const at = (ms: number) => new Date(Date.now() + ms);

test("a task whose work stopped is asked once to go on, then the owner hears it stopped again", () => {
  const store = env.core.store;
  const { task, chat } = workedTask();
  revives.length = 0;
  assert.deepEqual(reviveStalled(store, admit, at(STALL_AFTER_MS / 2)), { revived: 0, told: 0 }, "not yet");
  assert.deepEqual(reviveStalled(store, admit, at(STALL_AFTER_MS + 60_000)), { revived: 1, told: 0 });
  // APX's ask is not the owner writing: no new budget window, nothing the breaker holds released.
  assert.equal(revives[0]?.trigger, "system");
  assert.equal(revives[0]?.origin.kind, "stalled_task");
  assert.ok(
    store.messages.list(chat.id).some((m) => m.parts.some((p) => p.type === "notice" && p.code === "task.stalled")),
    "the chat says why its agent woke up",
  );

  // Waiting for the owner is a known state, not a stall.
  store.tasks.change(task.id, { awaits_owner: true }, "owner");
  assert.deepEqual(reviveStalled(store, admit, at(2 * STALL_AFTER_MS)), { revived: 0, told: 0 });
  store.tasks.change(task.id, { awaits_owner: false }, "owner");
  assert.deepEqual(reviveStalled(store, admit, at(2 * STALL_AFTER_MS)), { revived: 0, told: 1 });
  assert.deepEqual(reviveStalled(store, admit, at(3 * STALL_AFTER_MS)), { revived: 0, told: 0 }, "told once");
  assert.deepEqual(reviveStalled(store, admit, at(20 * 3600_000)), { revived: 0, told: 0 }, "never revived again");
  assert.equal(revives.length, 1);
  const notice = store.notifications.list({ unreadOnly: false, limit: 50 }).find((n) => n.ref === task.id);
  assert.equal(notice?.level, "warn");
  assert.equal(notice?.thread_id, chat.id);

  // Once the owner writes there again, a new stop may be revived again.
  store.threads.mergeContext(chat.id, { stall: { revived_at: new Date(Date.now() - 1000).toISOString() } });
  finished(chat.id, "vera", "user");
  assert.deepEqual(reviveStalled(store, admit, at(STALL_AFTER_MS + 60_000)).revived, 1);
});

test("tasks not in progress, or with a missing agent, are never revived", () => {
  const store = env.core.store;
  const skipped = [...["backlog", "todo", "review"].map((status) => workedTask(status)), workedTask("doing", "ghost")];
  revives.length = 0;
  reviveStalled(store, admit, at(STALL_AFTER_MS + 60_000));
  const chats = new Set(skipped.map((s) => s.chat.id));
  assert.ok(!revives.some((r) => chats.has((r as unknown as { thread_id: string }).thread_id)));
  const refs = new Set(skipped.map((s) => s.task.id));
  assert.ok(!store.notifications.list({ unreadOnly: false, limit: 100 }).some((n) => n.ref && refs.has(n.ref)));
});
