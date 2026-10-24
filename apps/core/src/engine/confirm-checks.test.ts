import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { callTool, say, scriptedLlm, startCore } from "./testkit.ts";

// The model says which tool to call as `tool {json args}`; after the tool it repeats the result it got.
const llm = scriptedLlm((req, { said, afterTool }) => {
  if (afterTool) return say(String(req.messages.at(-1)?.content));
  const at = said.indexOf(" ");
  return callTool("c1", said.slice(0, at), JSON.parse(said.slice(at + 1)) as object);
});
let env: Awaited<ReturnType<typeof startCore>>;
before(async () => {
  env = await startCore({ llm });
  await env.client.call("agents.create", { slug: "clerk", name: "Clerk" });
  // An agent that asks before every change: each task call would wait for the owner.
  await env.client.call("agents.update", { agent: "clerk", autonomy: "manual" });
});
after(async () => {
  await env.core.close();
  await env.cleanup();
});

/** Has the clerk make one call; denies the confirmation if one comes. What the model got back, and whether it asked. */
async function call(tool: string, args: object): Promise<{ asked: boolean; result: string }> {
  const t = await env.client.call("threads.create", { kind: "loose", agent_id: "clerk", title: "Board" });
  await env.client.call("threads.send", { thread: t.id, text: `${tool} ${JSON.stringify(args)}` });
  let asked = false;
  for (let i = 0; i < 100; i++) {
    const { inputs } = await env.client.call("runs.pending", { thread: t.id });
    const input = inputs[0];
    if (input) {
      asked = true;
      await env.client.call("runs.respond", { input: input.id, decision: "deny" });
      break;
    }
    const { runs } = await env.client.call("threads.get", { thread: t.id });
    if (runs.length && runs.every((r) => r.ended_at)) break;
    await new Promise((r) => setTimeout(r, 20));
  }
  await env.settle(t.id);
  const tools = llm.calls.at(-1)?.messages.filter((m) => m.role === "tool") ?? [];
  return { asked, result: String(tools.at(-1)?.content) };
}

test("a task change that could only fail is never put to the owner; the model learns which argument is wrong", async () => {
  const unknown = await call("task_update", { task: "t_missing", status: "doing" });
  assert.equal(unknown.asked, false);
  assert.match(unknown.result, /^not run, nothing was asked of the owner: not_found: task t_missing not found/);

  const task = await env.client.call("tasks.create", { title: "Draft the plan" });
  const column = await call("task_update", { task: task.id, status: "someday" });
  assert.equal(column.asked, false);
  assert.match(column.result, /status: no column "someday" \(columns: backlog, todo, doing, review\)/);

  const assignee = await call("task_create", { title: "Review the plan", assignee: "nobody" });
  assert.equal(assignee.asked, false);
  assert.match(assignee.result, /assignee: agent nobody not found/);

  assert.equal((await env.client.call("tasks.get", { task: task.id })).task.status, "backlog", "nothing changed");
});

test("a task change that can run still waits for the owner", async () => {
  const task = await env.client.call("tasks.create", { title: "Book the room" });
  const valid = await call("task_update", { task: task.id, status: "doing" });
  assert.equal(valid.asked, true);
  assert.match(valid.result, /not run: the owner declined/);
});
