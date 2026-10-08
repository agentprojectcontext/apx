import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { callTool, say, scriptedLlm, startCore } from "../engine/testkit.ts";

const llm = scriptedLlm((req, { said, afterTool }) => {
  if (afterTool) return say(String(req.messages.at(-1)?.content));
  return callTool("list", "task_list", JSON.parse(said) as object);
});
let env: Awaited<ReturnType<typeof startCore>>;
before(async () => {
  env = await startCore({ llm });
});
after(async () => {
  await env.core.close();
  env.cleanup();
});

async function list(args: object): Promise<string> {
  const thread = await env.client.call("threads.create", { kind: "loose", agent_id: "roby", title: "Board" });
  await env.client.call("threads.send", { thread: thread.id, text: JSON.stringify(args) });
  await env.settle(thread.id);
  return String(llm.calls.at(-1)?.messages.at(-1)?.content);
}

test("an empty filtered task list says what it asked for and what is still open", async () => {
  assert.match(await list({}), /no tasks \(open\)\. columns:/);
  const first = await env.client.call("tasks.create", { title: "Draft the plan" });
  await env.client.call("tasks.update", { task: first.id, status: "doing" });
  await env.client.call("tasks.create", { title: "Review the plan" });
  const mine = await list({ mine: true });
  assert.match(mine, /no tasks \(open, assigned to you\)/);
  assert.match(mine, /The board has 2 open \((1 doing, 1 backlog|1 backlog, 1 doing)\)/);
  assert.match(await list({ state: "done" }), /no tasks \(done\)\. The board has 2 open/);
  assert.match(await list({}), /Draft the plan[\s\S]*Review the plan|Review the plan[\s\S]*Draft the plan/);
});
