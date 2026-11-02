// An agent asks a teammate on its task by @mentioning it in a comment: the teammate answers in a consult shown on the
// task, and the answer comes back to the asker's chat for the task, which goes on. The answer asks no one further.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { waitFor } from "../testkit/platform.ts";
import { callTool, say, scriptedLlm, startCore } from "./testkit.ts";

let releaseScout: (() => void) | undefined;

const taskId = (text: string) => /task_[0-9a-f]+/.exec(text)?.[0] ?? "";

const llm = scriptedLlm(async (req, { system, said, afterTool }) => {
  const id = taskId(JSON.stringify(req.messages));
  if (system.startsWith("You are Vera") && said.includes("Check the totals") && !afterTool)
    return callTool("c1", "task_comment", { task: id, text: "@scout do the totals include taxes?" });
  if (system.startsWith("You are Vera") && said.startsWith("Recount") && !afterTool)
    return callTool("c5", "task_comment", {
      // Vera's earlier chats name other tasks: this one is found by its title.
      task: env.core.store.tasks.list({ limit: 50 }).find((t) => t.title === "Recount")?.id,
      text: "@scout make it a task for Roby to recount them.",
    });
  if (system.startsWith("You are Vera") && said.includes("Cross-check the ledger") && !afterTool)
    return callTool("c6", "task_comment", {
      task: env.core.store.tasks.list({ limit: 50 }).find((t) => t.title === "Ledger check")?.id,
      text: "@scout is the ledger balanced?",
    });
  if (system.startsWith("You are Vera") && said.includes("Scout answered your question"))
    return say("Thanks, going on.");
  if (system.startsWith("You are Scout") && said.includes("include taxes") && !afterTool)
    return callTool("c2", "task_comment", { task: id, text: "@vera they do, see the invoice." });
  if (system.includes("main secretary") && said.includes("Tell Scout") && !afterTool)
    return callTool("c3", "task_comment", { task: id, text: "@scout keep the animation first" });
  if (system.includes("main secretary") && said.includes("Scout answered your question"))
    return say("Go on with that, Scout.");
  if (system.startsWith("You are Scout") && said.includes("make it a task") && !afterTool)
    return callTool("c4", "task_create", {
      goal: "Done as asked",
      title: "Recount the totals",
      description: "Recount the monthly totals.",
      assignee: "superagent",
    });
  if (system.startsWith("You are Scout") && said.includes("animation first")) return say("Noted: animation first.");
  if (system.startsWith("You are Scout") && said.includes("hold the answer") && !afterTool) {
    await new Promise<void>((r) => (releaseScout = r));
    return say("Held, then answered.");
  }
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
  // Parts APX goes on with on its own (engine/task-continue.ts) are not turns anyone asked for.
  assert.equal(store.runs.list(chat()?.id ?? "").filter((r) => r.input?.origin.kind !== "task_continue").length, 2);
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
  const chat = () => store.threads.byTask(task.id).find((t) => t.agent_ids[0] === "superagent");
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

test("a teammate an agent asked on a task starts no task work: the agent that asked assigns it", async () => {
  const store = env.core.store;
  const task = await env.client.call("tasks.create", {
    title: "Recount",
    description: "Recount the monthly report.",
    assignee: "vera",
  });
  await waitFor(() => store.threads.sessions(task.thread_id).length > 0, "a consult on the task");
  const [consult] = store.threads.sessions(task.thread_id);
  await env.settle(consult?.id ?? "");
  const refused = store.messages
    .list(consult?.id ?? "", 50)
    .map((m) => JSON.stringify(m.parts))
    .find((t) => t.includes("you are answering"));
  assert.match(refused ?? "", /answering Vera/, "the refusal names the agent that asked, which assigns it");
  assert.ok(
    !store.tasks.list({ limit: 500 }).some((t) => t.title === "Recount the totals"),
    "no task handed out from the answer",
  );
});

const consultsOf = (threadId: string) =>
  env.core.store.threads.sessions(threadId).filter((t) => env.core.store.threads.context(t.id).consult);
const cardsOf = async (threadId: string) =>
  (await env.client.call("threads.get", { thread: threadId })).messages.flatMap((m) =>
    m.parts.filter((p) => p.type === "subthread").map((p) => ({ id: m.id, part: p })),
  );

test("the owner's second @mention of the same teammate on a task continues the first consult, with its context", async () => {
  const store = env.core.store;
  const task = await env.client.call("tasks.create", { title: "Invoice audit", description: "Audit the invoices." });
  await env.client.call("tasks.comment", { task: task.id, text: "@scout is the first invoice paid?" });
  const [first] = consultsOf(task.thread_id);
  assert.ok(first);
  await env.settle(first.id);
  await env.client.call("tasks.comment", { task: task.id, text: "@scout and the second one?" });
  await waitFor(() => store.runs.list(first.id).length === 2, "the second ask runs in the same consult");
  await env.settle(first.id);
  assert.deepEqual(
    consultsOf(task.thread_id).map((t) => t.id),
    [first.id],
    "one sub-thread with the teammate, two runs",
  );
  const second = llm.calls.findLast((c) => String(c.messages.at(-1)?.content).includes("and the second one?"));
  assert.ok(JSON.stringify(second?.messages).includes("is the first invoice paid?"), "scout sees its earlier exchange");
  assert.ok(JSON.stringify(second?.messages).includes("the totals include taxes"), "and its own earlier answer");
  // The task shows a card for each ask, and the latest one is what the consult fills in.
  const cards = await cardsOf(task.thread_id);
  assert.equal(cards.length, 2);
  assert.ok(cards.every((c) => c.part.type === "subthread" && c.part.thread_id === first.id));
  assert.ok(cards.every((c) => c.part.type === "subthread" && c.part.state === "completed"));
  assert.equal(store.threads.context(first.id).consult?.card, cards[1]?.id);
});

test("a consult still working is left alone: a new @mention opens another, and a different asker never joins one", async () => {
  const store = env.core.store;
  const task = await env.client.call("tasks.create", { title: "Parallel asks", description: "Several questions." });
  try {
    await env.client.call("tasks.comment", { task: task.id, text: "@scout hold the answer for now" });
    await waitFor(() => Boolean(releaseScout), "scout is held at work");
    await env.client.call("tasks.comment", { task: task.id, text: "@scout and meanwhile this" });
    await waitFor(() => consultsOf(task.thread_id).length === 2, "a second consult while the first works");
  } finally {
    releaseScout?.();
  }
  for (const c of consultsOf(task.thread_id)) await env.settle(c.id);
  // Both are free now: the next ask goes on in the latest one. An agent's ask is another asker's: its own consult.
  const before = consultsOf(task.thread_id).length;
  const asked = await env.client.call("tasks.comment", { task: task.id, text: "@scout one more" });
  assert.equal(asked.runs.length, 1);
  assert.equal(consultsOf(task.thread_id).length, before, "still two sub-threads");
  const vera = await env.client.call("tasks.create", {
    title: "Ledger check",
    description: "Cross-check the ledger.",
    assignee: "vera",
  });
  await waitFor(() => consultsOf(vera.thread_id).length > 0, "vera's consult");
  const [byVera] = consultsOf(vera.thread_id);
  await env.settle(byVera?.id ?? "");
  await env.client.call("tasks.comment", { task: vera.id, text: "@scout and the owner's question" });
  await waitFor(() => consultsOf(vera.thread_id).length === 2, "the owner's ask opens its own consult");
  assert.equal(store.runs.list(byVera?.id ?? "").length, 1, "Vera's consult was not reused for the owner");
});
