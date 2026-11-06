// A task's comments are read by people: agents post when the plan is done or to ask someone, helpers answer whoever
// asked them, whoever works a task asks for help only at the end, and the super-agent can clean what piled up before
// (DECISIONS.md#d-202).
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { AssistantItem } from "../providers/types.ts";
import { waitFor } from "../testkit/platform.ts";
import { callTool, say, scriptedLlm, startCore } from "./testkit.ts";

/** What each tool call answered, by the marker of the case that made it. */
const results = new Map<string, string[]>();
const taskOf = (text: string) => /Task (task_\w+):/.exec(text)?.[1] ?? "";
const CASES = ["NOTE-CASE", "HELPER-CASE", "MIDPLAN-CASE", "DONE-CASE", "BLANKS-CASE", "TIDY-CASE"];

const llm = scriptedLlm((req, { system, said, afterTool }) => {
  const all = JSON.stringify(req.messages);
  const tools = req.messages.filter((m) => m.role === "tool").length;
  // The case this turn works on: its task's own description (other tasks may show up in its context).
  const latest = req.messages.findLast((m) => m.role === "user" && /Task task_\w+:/.test(String(m.content)));
  const described = env?.core.store.tasks.get(taskOf(String(latest?.content ?? "")))?.description ?? said;
  const marker = CASES.find((c) => described.includes(c)) ?? "";
  if (afterTool) results.set(marker, [...(results.get(marker) ?? []), String(req.messages.at(-1)?.content)]);
  const task = taskOf(String(latest?.content ?? ""));
  if (system.startsWith("You are Scout")) {
    if (!afterTool) return callTool("s0", "task_comment", { task, text: "Blocked: the hinge is loose." });
    return say("The hinge on the back door is loose.");
  }
  if (system.startsWith("You are Vera")) {
    if (marker === "NOTE-CASE") {
      if (tools === 0) return callTool("n0", "task_comment", { task, text: "Step one done: half counted." });
      if (tools === 1)
        return callTool("n1", "task_comment", {
          task,
          text: "@owner should I count the back room too, or only the shop floor?",
        });
      return say("Asked the owner.");
    }
    if (marker === "HELPER-CASE") {
      if (tools === 0) return callTool("h0", "plan", { steps: "- [x] Fix the doors\n- [~] Review with Scout" });
      if (tools === 1) return callTool("h1", "delegate", { agent: "scout", task: "Review the doors." });
      return say("Reviewed.");
    }
    if (marker === "MIDPLAN-CASE") {
      if (tools === 0) return callTool("m0", "plan", { steps: "- [~] Paint the hall\n- [ ] Review it" });
      if (tools === 1) return callTool("m1", "delegate", { agent: "scout", task: "Which paint is best?" });
      return say("Painting.");
    }
    if (marker === "DONE-CASE") {
      if (tools === 0) return callTool("d0", "plan", { steps: "- [x] Sweep\n- [x] Check the floor" });
      if (tools === 1) return callTool("d1", "task_comment", { task, text: "Swept and checked: the floor is clean." });
      return say("Done.");
    }
    if (marker === "BLANKS-CASE") {
      if (tools === 0) {
        // Text, then three tool calls, then the question: the posted answer keeps one blank line between them.
        const message: AssistantItem = {
          role: "assistant",
          content: "Checked the stock.",
          tool_calls: ["b0", "b1", "b2"].map((id) => ({
            id,
            type: "function" as const,
            function: { name: "task_get", arguments: JSON.stringify({ task }) },
          })),
        };
        return { message };
      }
      return say("@owner Should I order A4 or Letter paper for the office?");
    }
  }
  if (said.includes("TIDY-CASE")) {
    if (!afterTool) return callTool("t0", "task_tidy", {});
    if (tools === 1) return callTool("t1", "task_tidy", { task: /(task_\w+) ·/.exec(all)?.[1] ?? "" });
    return say("Listed.");
  }
  return say("ok");
});

let env: Awaited<ReturnType<typeof startCore>>;
before(async () => {
  env = await startCore({ llm });
});
after(async () => {
  await env.core.close();
  await env.cleanup();
});

const agentComments = (thread: string) =>
  env.core.store.messages
    .list(thread, 100)
    .filter((m) => m.author.kind === "agent")
    .map((m) => m.parts.flatMap((p) => (p.type === "text" ? [p.text] : [])).join(""))
    .filter(Boolean);

async function work(title: string, marker: string) {
  const task = await env.client.call("tasks.create", {
    title,
    goal: `${title}, as asked`,
    description: `${title}. ${marker}`,
    assignee: "vera",
  });
  await waitFor(() => env.core.store.threads.byTask(task.id).length > 0, "its work chat");
  const [chat] = env.core.store.threads.byTask(task.id);
  await env.settle(chat?.id ?? "");
  return { task, chat: chat?.id ?? "" };
}

test("a progress note is not posted on a turn APX started; a question for the owner is", async () => {
  const { task } = await work("Count the shelves", "NOTE-CASE");
  assert.deepEqual(agentComments(task.thread_id), ["@owner should I count the back room too, or only the shop floor?"]);
  assert.match(results.get("NOTE-CASE")?.[0] ?? "", /not posted: progress goes in your plan/);
});

test("a helper answers whoever asked it instead of commenting on the task", async () => {
  const { task, chat } = await work("Fix the doors", "HELPER-CASE");
  await waitFor(() => (results.get("HELPER-CASE") ?? []).some((r) => r.includes("goes back to them")), "refused");
  const [sub] = env.core.store.threads.sessions(chat);
  assert.ok(sub, "Scout was asked, once the rest of the plan was done");
  await env.settle(sub.id);
  assert.deepEqual(agentComments(task.thread_id), [], "nothing of the helper's on the task");
});

test("whoever works a task is not given helpers mid-plan", async () => {
  const { chat } = await work("Paint the hall", "MIDPLAN-CASE");
  assert.match(String(results.get("MIDPLAN-CASE")), /not asked: you do this task.s work yourself/);
  assert.deepEqual(env.core.store.threads.sessions(chat), [], "no session opened");
});

test("a plan done is worth one comment", async () => {
  const { task } = await work("Sweep the floor", "DONE-CASE");
  assert.deepEqual(agentComments(task.thread_id), ["Swept and checked: the floor is clean."]);
});

test("an answer posted on the task has no run of blank lines where its tool calls were", async () => {
  const { task } = await work("Order paper", "BLANKS-CASE");
  assert.deepEqual(agentComments(task.thread_id), [
    "Checked the stock.\n\n@owner Should I order A4 or Letter paper for the office?",
  ]);
});

test("the super-agent finds tasks that piled up comments, and tidy keeps the owner's words", async () => {
  const store = env.core.store;
  const task = await env.client.call("tasks.create", { title: "Old noisy task", goal: "Kept short" });
  const notes = Array.from({ length: 16 }, (_, i) =>
    store.messages.add({
      thread_id: task.thread_id,
      author: { kind: "agent", id: "vera" },
      parts: [{ type: "text", text: `Progress ${i + 1}: still going.` }],
    }),
  );
  const owner = (await env.client.call("tasks.comment", { task: task.id, text: "Keep this in mind." })).message;

  const t = await env.client.call("threads.create", { kind: "loose", agent_id: "superagent" });
  await env.client.call("threads.send", { thread: t.id, text: "TIDY-CASE" });
  await env.settle(t.id);
  const [found, read] = results.get("TIDY-CASE") ?? [];
  assert.match(found ?? "", new RegExp(`${task.id} · 16 agent messages · Old noisy task`));
  assert.match(read ?? "", new RegExp(`${notes[0]?.id} · Vera · .* · Progress 1: still going\\.`));

  const r = await env.client.call("tasks.tidy", {
    task: task.id,
    remove: [...notes.map((n) => n.id), owner.id],
    summary: "Sixteen progress notes: still going, nothing decided.",
  });
  assert.equal(r.removed, 16);
  assert.deepEqual(r.kept, [owner.id], "the owner's words stay");
  const left = store.messages.list(task.thread_id, 100).map((m) => m.id);
  assert.ok(left.includes(owner.id));
  assert.ok(!notes.some((n) => left.includes(n.id)));
  assert.deepEqual(agentComments(task.thread_id), [], "the summary is the owner's here: they called it");
  assert.equal(store.tasks.noisy(15).includes(task.id), false, "no longer offered for cleaning");
});
