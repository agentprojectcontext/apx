import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { settingsCore } from "./settings.test-support.ts";

let h: Awaited<ReturnType<typeof settingsCore>>;
before(async () => {
  h = await settingsCore();
  for (const slug of ["acme-writer", "acme-reader", "acme-helper"])
    await h.env.client.call("agents.create", { slug, name: `Acme ${slug.slice(5)}`, prompt: "Work." });
  await h.env.client.call("agents.archive", { agent: "acme-reader" });
  await h.env.client.call("agents.archive", { agent: "acme-helper" });
});
after(async () => {
  await h.env.core.close();
  await h.env.cleanup();
});

const archived = async () => (await h.env.client.call("agents.archived", {})).agents.map((a) => a.id);

test("agents: an archived agent comes back once the owner approves, and a declined delete keeps it", async () => {
  assert.match((await h.ask({ method: "agents.archived" })).answer, /- Acme reader \[acme-reader\]/);
  const back = await h.ask({ method: "agents.restore", params: { agent: "acme-reader" } }, "approve");
  assert.equal(back.detail, "Bring back the archived agent Acme reader");
  assert.ok(!(await archived()).includes("acme-reader"));
  const gone = await h.ask({ method: "agents.delete", params: { agent: "acme-helper" } }, "deny");
  assert.equal(gone.detail, "Delete for good the archived agent Acme helper and its notes");
  assert.ok((await archived()).includes("acme-helper"));
});

test("agents: one agent's own limits wait for the owner", async () => {
  const limits = { method: "agents.set_agent_limits", params: { agent: "acme-writer", limits: { runs: 5 } } };
  const { detail } = await h.ask(limits, "approve");
  assert.match(detail, /^Change how far Acme writer may go on its own\nlimits\.runs: \(none\) → 5$/);
  assert.deepEqual((await h.env.client.call("agents.limits", {})).agents["acme-writer"], { runs: 5 });
  await h.ask({ ...limits, params: { agent: "acme-writer", limits: null } }, "deny");
  assert.deepEqual((await h.env.client.call("agents.limits", {})).agents["acme-writer"], { runs: 5 });
});

test("routines: deleting one waits for the owner", async () => {
  const set = (name: string) =>
    h.env.client.call("routines.set", {
      name,
      agent: "roby",
      schedule: { kind: "every", minutes: 60 },
      prompt: "Sum up.",
    });
  const kept = await set("Acme brief");
  const dropped = await set("Acme digest");
  const ids = async () => (await h.env.client.call("routines.list", {})).routines.map((r) => r.id);
  await h.ask({ method: "routines.remove", params: { routine: kept.id } }, "deny");
  const { detail } = await h.ask({ method: "routines.remove", params: { routine: dropped.id } }, "approve");
  assert.equal(detail, "Delete the routine Acme digest");
  assert.deepEqual(await ids(), [kept.id]);
});

test("agent profiles: one runs once the owner approves, a declined switch keeps it", async () => {
  assert.match((await h.ask({ method: "profiles.list" })).answer, /- focus: Focus coach/);
  const { detail } = await h.ask({ method: "profiles.set", params: { id: "focus" } }, "approve");
  assert.match(detail, /^Run the agent profile Focus coach\nid: \(none\) → "focus"/);
  const active = async () => (await h.env.client.call("profiles.list", {})).active.id;
  assert.equal(await active(), "focus");
  await h.ask({ method: "profiles.set", params: { id: null } }, "deny");
  assert.equal(await active(), "focus");
  assert.match((await h.ask({ method: "profiles.list" })).answer, /- focus: Focus coach, running with/);
});

test("tasks: deleting one for good waits for the owner", async () => {
  const one = await h.env.client.call("tasks.create", { title: "Acme launch" });
  const two = await h.env.client.call("tasks.create", { title: "Northwind follow-up" });
  await h.ask({ method: "tasks.delete", params: { task: one.id } }, "deny");
  const { detail } = await h.ask({ method: "tasks.delete", params: { task: two.id } }, "approve");
  assert.equal(detail, 'Delete for good the task "Northwind follow-up"');
  const left = (await h.env.client.call("tasks.list", {})).tasks.map((t) => t.id);
  assert.ok(left.includes(one.id) && !left.includes(two.id));
});

test("chats: renamed once the owner approves; how one writes stays theirs", async () => {
  const chat = await h.env.client.call("threads.create", { kind: "loose", agent_id: "roby", title: "Acme plans" });
  const rename = { method: "threads.update", params: { thread: chat.id, title: "Acme launch plans" } };
  const { detail } = await h.ask(rename, "approve");
  assert.equal(detail, 'Change the chat "Acme plans"\ntitle: "Acme plans" → "Acme launch plans"');
  assert.equal((await h.env.client.call("threads.get", { thread: chat.id })).thread.title, "Acme launch plans");
  await h.ask({ method: "threads.update", params: { thread: chat.id, pinned: true } }, "deny");
  assert.ok(!(await h.env.client.call("threads.get", { thread: chat.id })).thread.pinned);
  const write = { method: "threads.update", params: { thread: chat.id, write: "auto" } };
  assert.match((await h.ask(write)).answer, /write stays the owner's/);
});

test("imported sessions: a chat brought from a coding app is handed to another agent once the owner approves", async () => {
  const chat = await h.env.client.call("threads.create", { kind: "loose", agent_id: "roby", title: "Acme refactor" });
  h.env.core.store.threads.mergeContext(chat.id, { imported: { engine: "claude", session: "acme-session-1" } });
  const adopt = { method: "sessions.adopt", params: { thread: chat.id, agent: "acme-writer" } };
  await h.ask(adopt, "deny");
  const agents = async () => (await h.env.client.call("threads.get", { thread: chat.id })).thread.agent_ids;
  assert.deepEqual(await agents(), ["roby"]);
  const { detail } = await h.ask(adopt, "approve");
  assert.equal(detail, 'Hand the chat "Acme refactor" to Acme writer');
  assert.deepEqual(await agents(), ["acme-writer"]);
});
