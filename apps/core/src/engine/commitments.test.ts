import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, before, test } from "node:test";
import { ApxError } from "@apx/protocol/client";
import { callTool, say, scriptedLlm, startCore } from "./testkit.ts";

let settling = "";
const llm = scriptedLlm((_req, { said, afterTool }) => {
  if (afterTool) return say("Noted.");
  if (said.includes("I sent it, it was kept"))
    return callTool("s1", "commitment_settle", { task: settling, outcome: "kept" });
  if (said.includes("Ana owes me the contract"))
    return callTool("c1", "task_create", {
      title: "Signed contract",
      person: "ana",
      owed_by: "person",
      due_at: "2026-10-08",
    });
  return say("ok");
});

let clock = new Date(2026, 9, 1, 12, 0);
let env: Awaited<ReturnType<typeof startCore>>;
const tray = () => env.client.call("notifications.list", {});

before(async () => {
  env = await startCore({ llm, clock: () => clock });
  await env.client.call("contacts.set", { name: "Ana", role: "contact" });
});
after(async () => {
  await env.core.close();
  await env.cleanup();
});

test("a commitment names the person and who owes it, and is reminded once on its day", async () => {
  const t = await env.client.call("tasks.create", {
    title: "Send the invoice",
    person: "Ana",
    due_at: "2026-10-04",
  });
  assert.equal(t.person_name, "Ana");
  assert.equal(t.owed_by, "owner", "the owner's promise by default");
  assert.equal(t.due_at, new Date(2026, 9, 4, 9).toISOString(), "a bare day is 09:00 that day");
  const { tasks } = await env.client.call("tasks.list", { commitments: true });
  assert.deepEqual(
    tasks.map((x) => x.title),
    ["Send the invoice"],
  );

  env.core.scheduler.tick();
  assert.equal((await tray()).unread, 0, "not due yet");
  clock = new Date(2026, 9, 4, 10, 0);
  env.core.scheduler.tick();
  env.core.scheduler.tick();
  const due = (await tray()).notifications.filter((n) => n.kind === "due");
  assert.equal(due.length, 1, "reminded once");
  assert.match(due[0]?.body ?? "", /Se lo debés a Ana/);

  // A later date: the reminder goes away and comes back on the new day.
  await env.client.call("tasks.update", { task: t.id, due_at: "2026-10-06" });
  assert.equal((await tray()).unread, 0);
  env.core.scheduler.tick();
  assert.equal((await tray()).unread, 0);
  clock = new Date(2026, 9, 6, 9, 30);
  env.core.scheduler.tick();
  assert.equal((await tray()).unread, 1);
  // Sending the same date again does not remind twice.
  await env.client.call("notifications.read", {});
  await env.client.call("tasks.update", { task: t.id, due_at: "2026-10-06" });
  env.core.scheduler.tick();
  assert.equal((await tray()).unread, 0);
  await env.client.call("tasks.close", { task: t.id, state: "done" });
  assert.equal((await tray()).unread, 0, "done closes the reminder");
});

test("an agent records what a contact owes the owner", async () => {
  const th = await env.client.call("threads.create", { kind: "loose", agent_id: "roby" });
  await env.client.call("threads.send", { thread: th.id, text: "Ana owes me the contract by the 8th" });
  await env.settle(th.id);
  const { tasks } = await env.client.call("tasks.list", { commitments: true });
  const c = tasks.find((x) => x.title === "Signed contract");
  assert.equal(c?.person_name, "Ana");
  assert.equal(c?.owed_by, "person");
  assert.equal(c?.created_by, "roby");
});

test("unknown people, the owner and bad dates are refused", async () => {
  const refused = (p: Promise<unknown>, re: RegExp) =>
    assert.rejects(p, (e: unknown) => e instanceof ApxError && re.test(e.message));
  await refused(env.client.call("tasks.create", { title: "x", person: "Nobody" }), /contacts first/);
  const owner = env.core.store.persons.owner();
  await refused(env.client.call("tasks.create", { title: "x", person: owner.id }), /not with the owner/);
  await refused(env.client.call("tasks.create", { title: "x", due_at: "someday" }), /not a date/);
  await refused(env.client.call("tasks.create", { title: "x", due_at: "2026-02-31" }), /not a date/);
  await refused(env.client.call("tasks.create", { title: "x", due_at: "05/10/2026" }), /not a date/);
  await refused(env.client.call("tasks.create", { title: "x", due_at: "0202-10-05" }), /not a date/);
  await env.client.call("contacts.set", { name: "Ana", role: "contact" });
  await refused(env.client.call("tasks.create", { title: "x", person: "ana" }), /2 contacts are called/);
});

test("removing a person turns their commitments into plain tasks, never an id", async () => {
  const p = await env.client.call("contacts.set", { name: "Temp", role: "contact" });
  const t = await env.client.call("tasks.create", { title: "Get the keys", person: p.id, owed_by: "person" });
  assert.equal(t.person_name, "Temp");
  await env.client.call("contacts.remove", { id: p.id });
  const { task } = await env.client.call("tasks.get", { task: t.id });
  assert.equal(task.person_id, undefined);
  assert.equal(task.person_name, undefined);
});

test("a task keeps its kind, priority and tags; with a person it is a commitment", async () => {
  const t = await env.client.call("tasks.create", {
    title: "Buy bread",
    kind: "errand",
    priority: "high",
    tags: ["home", "Home", " shop "],
  });
  assert.equal(t.kind, "errand");
  assert.equal(t.priority, "high");
  assert.deepEqual(t.tags, ["Home", "shop"], "no repeats in any case, trimmed");
  const plain = await env.client.call("tasks.create", { title: "Plain" });
  assert.equal(plain.kind, "task");
  assert.equal(plain.priority, "normal");
  const ula = await env.client.call("contacts.set", { name: "Ula", role: "contact" });
  const promised = await env.client.call("tasks.update", { task: plain.id, person: ula.id });
  assert.equal(promised.kind, "commitment");
  const retagged = await env.client.call("tasks.update", { task: t.id, tags: [], priority: "low" });
  assert.deepEqual(retagged.tags, []);
  assert.equal(retagged.priority, "low");
});

test("a task's own reminder time comes before its due date", async () => {
  clock = new Date(2026, 9, 10, 8, 0);
  const t = await env.client.call("tasks.create", {
    title: "Call the bank",
    due_at: "2026-10-12",
    remind_at: "2026-10-11T18:00",
  });
  env.core.scheduler.tick();
  assert.equal((await tray()).notifications.filter((n) => n.kind === "due" && n.ref === t.id).length, 0);
  clock = new Date(2026, 9, 11, 18, 5);
  env.core.scheduler.tick();
  assert.equal((await tray()).notifications.filter((n) => n.kind === "due" && n.ref === t.id).length, 1);
  // Reminded once: its due date does not remind again.
  clock = new Date(2026, 9, 12, 10, 0);
  env.core.scheduler.tick();
  assert.equal((await tray()).notifications.filter((n) => n.kind === "due" && n.ref === t.id).length, 1);
  await env.client.call("tasks.close", { task: t.id, state: "done" });
});

test("moving a task to another project moves its conversation and lets go of an agent from elsewhere", async () => {
  const dir = fs.mkdtempSync(path.join(env.home, "proj-"));
  fs.writeFileSync(`${dir}/AGENTS.md`, "# Acme\n");
  const { project: p } = await env.client.call("projects.register", { path: dir });
  const a = await env.client.call("agents.create", { name: "Helper", slug: "helper", project_id: p.id });
  const t = await env.client.call("tasks.create", { title: "Ship it", project: p.id, assignee: a.id });
  const moved = await env.client.call("tasks.update", { task: t.id, project: null });
  assert.equal(moved.project_id, undefined);
  assert.equal(moved.assignee, undefined, "a project agent cannot work on a global task");
  const { thread } = await env.client.call("threads.get", { thread: t.thread_id });
  assert.equal(thread.project_id, undefined, "its conversation went with it");
  await assert.rejects(env.client.call("tasks.update", { task: t.id, project: "p_missing" }), /not found/);
});

test("a commitment ends kept, missed or dropped; renegotiated it stays open with the new date", async () => {
  const t = await env.client.call("tasks.create", { title: "Send the deck", person: "Ula", due_at: "2026-10-03" });
  const moved = await env.client.call("tasks.settle", {
    task: t.id,
    outcome: "renegotiated",
    due_at: "2026-10-10",
    note: "Ana agreed",
  });
  assert.equal(moved.state, "open");
  assert.equal(moved.due_at, new Date(2026, 9, 10, 9).toISOString());
  assert.equal(moved.renegotiated, 1);
  const missed = await env.client.call("tasks.settle", { task: t.id, outcome: "missed" });
  assert.deepEqual([missed.state, missed.outcome], ["dropped", "missed"]);
  await assert.rejects(
    env.client.call("tasks.settle", { task: t.id, outcome: "renegotiated", due_at: "2026-10-12" }),
    /reopen it first/,
  );
  const reopened = await env.client.call("tasks.close", { task: t.id, state: "open" });
  assert.equal(reopened.outcome, undefined, "open again, it has no outcome");
  const ops = (await env.client.call("tasks.get", { task: t.id })).events.map((e) => e.op);
  assert.deepEqual(ops.slice(-3), ["renegotiate", "drop", "reopen"]);

  const plain = await env.client.call("tasks.create", { title: "Water the plants" });
  await assert.rejects(env.client.call("tasks.settle", { task: plain.id, outcome: "kept" }), /only a commitment/);
  await assert.rejects(env.client.call("tasks.settle", { task: t.id, outcome: "renegotiated" }), /new date/);
});

test("the agent records what the owner says of a commitment", async () => {
  const t = await env.client.call("tasks.create", { title: "Call back Ula", person: "Ula", due_at: "2026-10-02" });
  settling = t.id;
  const thread = await env.client.call("threads.create", { kind: "loose", agent_id: "roby" });
  await env.client.call("threads.send", { thread: thread.id, text: "I sent it, it was kept" });
  await env.settle(thread.id);
  const after = (await env.client.call("tasks.get", { task: t.id })).task;
  assert.deepEqual([after.state, after.outcome], ["done", "kept"]);
});
