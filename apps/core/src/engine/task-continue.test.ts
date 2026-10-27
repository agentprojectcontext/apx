import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { waitFor } from "../testkit/platform.ts";
import { callTool, say, scriptedLlm, startCore } from "./testkit.ts";

// Vera works her tasks: "Ship in parts" needs two turns and closes in the second; "Spin" only looks things up.
const taskOf = (s: string) => /(task_\w+)/.exec(s)?.[1] ?? "";
const llm = scriptedLlm((req, { system, said, afterTool }) => {
  if (!system.startsWith("You are Vera")) return say("ok");
  const all = JSON.stringify(req.messages);
  const task = taskOf(/Task (task_\w+)/.exec(all)?.[0] ?? all);
  if (all.includes("Close it bare")) {
    if (!afterTool) return callTool("bare", "task_close", { task, state: "done" });
    return say(String(req.messages.at(-1)?.content));
  }
  if (all.includes("Spin around")) return afterTool ? say("Still looking.") : callTool("look", "task_list", {});
  if (said.includes("Part 2 of at most")) {
    if (!afterTool) return callTool("close", "task_close", { task, state: "done", note: "both halves shipped" });
    return say("Done.");
  }
  if (!afterTool) return callTool("half", "task_comment", { task, text: "First half shipped." });
  return say("First half done, I'll continue.");
});

let env: Awaited<ReturnType<typeof startCore>>;
before(async () => {
  env = await startCore({ llm });
});
after(async () => {
  await env.core.close();
  await env.cleanup();
});

const turnsOn = (taskId: string) =>
  env.core.store.threads
    .byTask(taskId)
    .flatMap((t) => env.core.store.runs.list(t.id, 20))
    .filter((r) => r.agent_id === "vera")
    .reverse();

test("a task turn that ends with the task in progress goes on at once until the agent closes it", async () => {
  const task = await env.client.call("tasks.create", {
    title: "Ship in parts",
    description: "Ship both halves.",
    assignee: "vera",
  });
  await waitFor(() => env.core.store.tasks.get(task.id)?.state === "done", "closed in its second part");
  const runs = turnsOn(task.id);
  assert.deepEqual(
    runs.map((r) => r.input?.origin.kind),
    [runs[0]?.input?.origin.kind, "task_continue"],
  );
  const cont = runs[1]?.input?.origin;
  assert.equal(cont?.kind === "task_continue" ? `${cont.part}/${cont.of}` : "", "2/9");
});

test("a part that gets nowhere is not followed by another: the stall watch has it", async () => {
  const task = await env.client.call("tasks.create", {
    title: "Spin around",
    description: "Look things up forever.",
    assignee: "vera",
  });
  await waitFor(() => turnsOn(task.id).length >= 2 && turnsOn(task.id).every((r) => r.ended_at), "two parts");
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(turnsOn(task.id).length, 2, "the second part only looked things up, so no third");
  assert.equal(env.core.store.tasks.get(task.id)?.state, "open");
});

test("the agent that did the work closes it as done only saying what it verified", async () => {
  const task = await env.client.call("tasks.create", {
    title: "Close it bare",
    description: "Close it without a word.",
    assignee: "vera",
  });
  await waitFor(() => turnsOn(task.id)[0]?.ended_at !== undefined, "the turn ends");
  // The script answers with what the refusal said.
  const said = env.core.store.threads
    .byTask(task.id)
    .flatMap((t) => env.core.store.messages.list(t.id, 20))
    .flatMap((m) => m.parts.map((p) => (p.type === "text" ? p.text : "")))
    .join("\n");
  assert.match(said, /note: say in a line what you verified/);
  assert.equal(env.core.store.tasks.get(task.id)?.state, "open");
});
