import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { waitFor } from "../testkit/platform.ts";
import { callTool, say, scriptedLlm, startCore } from "./testkit.ts";

// Vera plans and closes with no task_update: her plan moves the card to doing, her close finishes the step she was on.
const taskOf = (s: string) => /(task_\w+)/.exec(s)?.[1] ?? "";
const llm = scriptedLlm(async (req, { system }) => {
  if (!system.startsWith("You are Vera")) return say("ok");
  const all = JSON.stringify(req.messages);
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
