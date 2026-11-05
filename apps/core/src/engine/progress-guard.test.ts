// Agents that keep asking helpers on a task without finishing a step of its plan pause, and the owner is told; a step
// done starts the count over (DECISIONS.md#d-188).
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { waitFor } from "../testkit/platform.ts";
import { stuckTrip } from "./breaker.ts";
import { STUCK_LIMITS } from "./limits.ts";
import { callTool, say, scriptedLlm, startCore } from "./testkit.ts";

const refusals: string[] = [];
const llm = scriptedLlm((req, { system, said, afterTool }) => {
  if (system.startsWith("You are Checker")) return say("Checked again: nothing new.");
  const last = String(req.messages.at(-1)?.content ?? "");
  if (afterTool && last.startsWith("refused")) {
    refusals.push(last);
    return say("Paused: I will tell the owner.");
  }
  const twice = /comment twice on (task_\w+)/.exec(said);
  if (twice && system.startsWith("You are Vera")) {
    const tools = req.messages.filter((m) => m.role === "tool").length;
    if (tools < 2) return callTool(`c${tools}`, "task_comment", { task: twice[1], text: `Note ${tools + 1}` });
    return say(last.slice(0, 200));
  }
  // Vera checks the same thing over and over, never marking a step done.
  if (system.startsWith("You are Vera") && said.includes("Polish the pointer")) {
    const asked = req.messages.filter((m) => m.role === "tool").length;
    return callTool(`d${asked}`, "delegate", {
      worker: { name: "Checker", instructions: "Check the pointer code and report." },
      task: `Check the pointer again (${asked + 1})`,
    });
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

test("helpers asked again and again with no step done pause the task, and the owner hears it once", async () => {
  const store = env.core.store;
  const task = await env.client.call("tasks.create", {
    title: "Polish the pointer",
    goal: "The pointer moves smoothly",
    description: "Polish the pointer.",
    assignee: "vera",
  });
  await waitFor(() => refusals.length > 0, "the delegation past the limit is refused", { ms: 20_000 });
  assert.match(refusals[0] ?? "", /without finishing a step of its plan/);
  const work = store.threads.byTask(task.id)[0];
  assert.ok(work);
  // It paused at the limit: no helper started past it.
  // The same helper goes on in one session (D-190): its turns, not its sessions, are what count.
  const helperRuns = store.threads.children(work.id).flatMap((id) => store.runs.list(id));
  assert.equal(helperRuns.length, STUCK_LIMITS.runs);
  const trip = stuckTrip(store, work.id);
  assert.equal(trip?.by, "runs");
  // The owner sees why in the chat, with the way to go on, and once in the tray.
  const notice = store.messages
    .list(work.id, 100)
    .flatMap((m) => m.parts)
    .find((p) => p.type === "notice" && p.code === "breaker.held");
  assert.equal(notice?.type === "notice" && notice.vars?.variant, "progressRuns");
  assert.equal(notice?.type === "notice" && notice.vars?.stuck, "Polish the pointer");
  const told = () =>
    store.notifications.list({ unreadOnly: false, limit: 200 }).filter((n) => n.ref === `stuck:${task.id}`);
  assert.equal(told().length, 1);
  await env.settle(work.id);
  assert.equal(told().length, 1, "told once for this stretch");
});

test("a step newly done starts the count over; rewriting the same plan does not", async () => {
  const store = env.core.store;
  const task = store.tasks.list({ state: "open", limit: 50 }).find((t) => t.title === "Polish the pointer");
  assert.ok(task);
  const work = store.threads.byTask(task.id)[0]?.id ?? "";
  await env.client.call("tasks.update", { task: task.id, plan: "- [ ] Read the code\n- [ ] Smooth it" });
  assert.ok(stuckTrip(store, work), "a plan with nothing done is no progress");
  await env.client.call("tasks.update", { task: task.id, plan: "- [x] Read the code\n- [~] Smooth it" });
  assert.equal(stuckTrip(store, work), undefined);
});

test("an agent comments on a task once a turn; the rest goes in its answer", async () => {
  const task = await env.client.call("tasks.create", { title: "Pick the palette", description: "Choose colors." });
  const chat = await env.client.call("threads.create", { kind: "loose", agent_id: "vera" });
  await env.client.call("threads.send", { thread: chat.id, text: `comment twice on ${task.id}` });
  const { messages } = await env.settle(chat.id);
  const notes = env.core.store.messages
    .list(task.thread_id, 50)
    .map((m) => m.parts.map((p) => (p.type === "text" ? p.text : "")).join(""));
  assert.deepEqual(
    notes.filter((n) => n.startsWith("Note")),
    ["Note 1"],
  );
  assert.match(JSON.stringify(messages.at(-1)?.parts), /already commented on this task in this turn/);
});
