// An agent asks a teammate on its task by @mentioning it in a comment: the teammate answers in a consult shown on the
// task, and the answer comes back to the asker's chat for the task, which goes on. The answer asks no one further.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { waitFor } from "../testkit/platform.ts";
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
  if (system.includes("main secretary") && said.includes("Tell Scout") && !afterTool)
    return callTool("c3", "task_comment", { task: id, text: "@scout keep the animation first" });
  if (system.includes("main secretary") && said.includes("Scout answered your question"))
    return say("Go on with that, Scout.");
  if (system.startsWith("You are Scout") && said.includes("animation first")) return say("Noted: animation first.");
  if (system.startsWith("You are Scout")) return say("Yes: the totals include taxes.");
  return say(afterTool ? "Asked." : "On it.");
});

let env: Awaited<ReturnType<typeof startCore>>;
before(async () => {
  env = await startCore({ llm });
});
after(async () => {
  await env.core.close();
  await env.cleanup();
});

test("an agent's @mention on its task asks that teammate, and the answer comes back to its chat for the task", async () => {
  const store = env.core.store;
  const task = await env.client.call("tasks.create", {
    title: "Totals report",
    description: "Check the totals of the monthly report.",
    assignee: "vera",
  });
  const chat = () => store.threads.byTask(task.id).find((t) => t.agent_ids[0] === "vera");
  await waitFor(() => Boolean(chat()), "vera's chat for the task");
  const [consult] = await (async () => {
    await waitFor(() => store.threads.sessions(task.thread_id).length > 0, "a consult on the task");
    return store.threads.sessions(task.thread_id);
  })();
  assert.equal(consult?.agent_ids[0], "scout");
  assert.deepEqual(store.threads.context(consult?.id ?? "").consult?.asker, { agent: "vera", thread: chat()?.id });
  const asked = store.runs.list(consult?.id ?? "")[0];
  assert.equal(asked?.trigger, "a2a", "an agent asked, not the owner: no new budget window");
  await env.settle(consult?.id ?? "");
  await waitFor(
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

test("the answer to a question asked from the owner's chat goes to the asker's chat for the task, not the owner's", async () => {
  const store = env.core.store;
  const task = await env.client.call("tasks.create", { title: "Acme reel", description: "A short reel about Acme." });
  await env.client.call("threads.send", { thread: "home", text: `Tell Scout on ${task.id}: animation first.` });
  await waitFor(() => store.threads.sessions(task.thread_id).some((t) => t.agent_ids[0] === "scout"), "the consult");
  const chat = () => store.threads.byTask(task.id).find((t) => t.agent_ids[0] === "roby");
  await waitFor(
    () => store.runs.list(chat()?.id ?? "").some((r) => r.trigger === "a2a" && r.state === "completed"),
    "the secretary hears the answer in its chat for the task",
  );
  await env.settle("home");
  // The owner's chat (mirrored to their channels) holds only their words and the answer to them.
  const home = store.messages.list("home", 50).map((m) => JSON.stringify(m.parts));
  assert.ok(!home.some((t) => t.includes("Scout answered your question")), "no teammate's answer in the owner's chat");
  assert.ok(!home.some((t) => t.includes("Go on with that, Scout")), "no words for the teammate in the owner's chat");
  assert.ok(
    store.runs.list("home").every((r) => r.trigger !== "a2a"),
    "no teammate wakes the owner's chat",
  );
  const heard = store.messages
    .list(chat()?.id ?? "", 50)
    .find((m) => JSON.stringify(m.parts).includes("Scout answered your question"));
  assert.match(JSON.stringify(heard?.parts), /animation first/);
});
