// An agent asks a teammate on its task by @mentioning it in a comment: the teammate answers in a consult shown on the
// task, and the answer comes back to the asker's chat for the task, which goes on. The answer asks no one further.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { callTool, say, scriptedLlm, startCore } from "./testkit.ts";

const taskId = (text: string) => /task_[0-9a-f]+/.exec(text)?.[0] ?? "";

const llm = scriptedLlm((req, { system, said, afterTool }) => {
  const id = taskId(JSON.stringify(req.messages));
  if (system.startsWith("You are Vera") && said.includes("Check the totals") && !afterTool)
    return callTool("c1", "task_comment", { task: id, text: "@scout do the totals include taxes?" });
  if (system.startsWith("You are Vera") && said.includes("Scout answered your question"))
    return say("Thanks, going on.");
  if (system.startsWith("You are Scout") && said.includes("include taxes") && !afterTool)
    return callTool("c2", "task_comment", { task: id, text: "@vera they do, see the invoice." });
  if (system.startsWith("You are Scout")) return say("Yes: the totals include taxes.");
  return say(afterTool ? "Asked." : "On it.");
});

let env: Awaited<ReturnType<typeof startCore>>;
before(async () => {
  env = await startCore({ llm });
});
after(async () => {
  await env.core.close();
  env.cleanup();
});

const until = async (check: () => boolean, what: string, ms = 5000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (check()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`never: ${what}`);
};

test("an agent's @mention on its task asks that teammate, and the answer comes back to its chat for the task", async () => {
  const store = env.core.store;
  const task = await env.client.call("tasks.create", {
    title: "Totals report",
    description: "Check the totals of the monthly report.",
    assignee: "vera",
  });
  const chat = () => store.threads.byTask(task.id).find((t) => t.agent_ids[0] === "vera");
  await until(() => Boolean(chat()), "vera's chat for the task");
  const [consult] = await (async () => {
    await until(() => store.threads.sessions(task.thread_id).length > 0, "a consult on the task");
    return store.threads.sessions(task.thread_id);
  })();
  assert.equal(consult?.agent_ids[0], "scout");
  assert.deepEqual(store.threads.context(consult?.id ?? "").consult?.asker, { agent: "vera", thread: chat()?.id });
  const asked = store.runs.list(consult?.id ?? "")[0];
  assert.equal(asked?.trigger, "a2a", "an agent asked, not the owner: no new budget window");
  await env.settle(consult?.id ?? "");
  await until(
    () => store.runs.list(chat()?.id ?? "").some((r) => r.trigger === "a2a" && r.state === "completed"),
    "vera hears the answer",
  );
  const heard = store.messages
    .list(chat()?.id ?? "", 50)
    .find((m) => JSON.stringify(m.parts).includes("Scout answered your question"));
  assert.deepEqual(heard?.author, { kind: "agent", id: "scout" });
  assert.match(JSON.stringify(heard?.parts), /include taxes/);
  // Scout's own @vera from inside the consult asked no one: still the one consult, and Vera's chat had two turns.
  assert.equal(store.threads.sessions(task.thread_id).length, 1);
  assert.equal(store.runs.list(chat()?.id ?? "").length, 2);
  const card = (await env.client.call("threads.get", { thread: task.thread_id })).messages
    .flatMap((m) => m.parts)
    .find((p) => p.type === "subthread");
  assert.equal(card?.type === "subthread" && card.asked_by, "vera");
});
