import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { ApxError } from "@apx/protocol/client";
import { callTool, say, scriptedLlm, startCore } from "./testkit.ts";

const llm = scriptedLlm((_req, { said, afterTool }) => {
  if (afterTool) return say("Noted.");
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
  env.cleanup();
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
});
