import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { waitFor } from "../testkit/platform.ts";
import { callTool, say, scriptedLlm, startCore } from "./testkit.ts";

// Vera plans and closes with no task_update: her plan moves the card to doing, her close finishes the step she was on.
const taskOf = (s: string) => /(task_\w+)/.exec(s)?.[1] ?? "";
const firstInputs: string[] = [];
const llm = scriptedLlm(async (req, { system }) => {
  if (!system.startsWith("You are Vera")) return say("ok");
  const all = JSON.stringify(req.messages);
  if (!req.messages.some((m) => m.role === "tool")) firstInputs.push(all);
  const task = taskOf(/Task (task_\w+)/.exec(all)?.[0] ?? all);
  const tools = req.messages.filter((m) => m.role === "tool").length;
  if (tools === 0) return callTool("p", "plan", { steps: "- [x] Read it\n- [~] Write the answer\n- [ ] Extra polish" });
  if (tools === 1) return callTool("c", "task_close", { task, state: "done", note: "answer written and read back" });
  return say("Done.");
});

let env: Awaited<ReturnType<typeof startCore>>;
before(async () => {
  env = await startCore({ llm });
});
after(async () => {
  await env.core.close();
  await env.cleanup();
});

test("an agent's first plan moves its task to doing, and closing it done finishes the step it was on", async () => {
  const task = await env.client.call("tasks.create", {
    title: "Answer the brief",
    description: "Write a short answer.",
    assignee: "vera",
  });
  assert.equal(task.status, "backlog");
  await waitFor(() => env.core.store.tasks.get(task.id)?.state === "done", "closed");
  const done = env.core.store.tasks.get(task.id);
  assert.equal(done?.status, "doing");
  assert.equal(done?.plan, "- [x] Read it\n- [x] Write the answer\n- [ ] Extra polish");
});

test("a plan the owner writes, or one on a task already past doing, leaves its column alone", async () => {
  const task = await env.client.call("tasks.create", { title: "Owner notes", status: "todo" });
  const updated = await env.client.call("tasks.update", { task: task.id, plan: "- [~] Think" });
  assert.equal(updated.status, "todo");
});

test("a task's chat gets global notes only when they share words with the task", async () => {
  await env.client.call("memory.add", {
    text: "The owner practices golf swings with a left-handed coach.",
    scope: "global",
  });
  await env.client.call("memory.add", {
    text: "Cart discount codes are always uppercase, like SAVE10.",
    scope: "global",
  });
  const task = await env.client.call("tasks.create", {
    title: "Cart discount codes",
    description: "Add discount codes to the cart.",
    assignee: "vera",
  });
  await waitFor(() => env.core.store.tasks.get(task.id)?.state === "done", "closed");
  const first = firstInputs.find((x) => x.includes(task.id)) ?? "";
  assert.match(first, /always uppercase/, "a global note about the task's subject");
  assert.doesNotMatch(first, /golf swings/, "no unrelated standing global note");
});
