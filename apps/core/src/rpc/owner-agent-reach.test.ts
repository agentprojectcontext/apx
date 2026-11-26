// What an owner's agent working for the owner reaches through the protocol, and what a turn for someone else does not
// (DECISIONS.md#d-271): reading chats, a task chat's media and making a widget in another project.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { say, scriptedLlm, startCore } from "../engine/testkit.ts";
import { createLog } from "../log.ts";
import { saveUpload } from "../services/uploads.ts";
import type { CallContext } from "./context.ts";

let env: Awaited<ReturnType<typeof startCore>>;
let builder = "";
let acme = "";
let northwind = "";
before(async () => {
  env = await startCore({ llm: scriptedLlm(() => say("ok")) });
  acme = (await env.client.call("projects.create", { name: "Acme" })).project.id;
  northwind = (await env.client.call("projects.create", { name: "Northwind" })).project.id;
  builder = (await env.client.call("agents.create", { project_id: acme, slug: "builder", name: "Builder" })).id;
});
after(async () => {
  await env.core.close();
  await env.cleanup();
});

/** A live turn of the builder's in an Acme chat, as its tool calls reach the core; `extra` makes it someone else's. */
function caller(
  extra: Partial<CallContext> = {},
  chat: Partial<Parameters<typeof env.core.store.threads.create>[0]> = {},
) {
  const store = env.core.store;
  const t = store.threads.create({
    ...{ kind: "loose", title: "Acme work", agent_ids: [builder], project_id: acme },
    ...chat,
  });
  const run = store.runs.create({
    thread_id: t.id,
    agent_id: builder,
    trigger: "user",
    input: { text: "Look", origin: { kind: "user" } },
    deadline_at: new Date(Date.now() + 60_000).toISOString(),
  });
  store.runs.setState(run, "working");
  const ctx: CallContext = {
    role: "operator",
    actor: "agent",
    transport: "internal",
    session: undefined,
    log: createLog("test", true),
    agent: { id: builder, thread_id: t.id, run_id: run.id },
    ...extra,
  };
  return { thread: t.id, ctx };
}

const channel = {
  id: "ch_test",
  conversation: "alex",
  person_id: "per_alex",
  name: "Alex",
  role: "contact" as const,
};
const failure = (r: { ok: boolean; error?: { message: string } }) => (r.ok ? "" : (r.error?.message ?? ""));
const northwindChat = (title: string) =>
  env.core.store.threads.create({ kind: "loose", title, agent_ids: ["superagent"], project_id: northwind });

test("threads.get: the owner's agent reads the owner's chat in another project, a turn for a contact does not", async () => {
  const other = northwindChat("Northwind plans");
  const own = caller();
  const read = await env.core.dispatch("threads.get", { thread: other.id }, own.ctx);
  assert.ok(read.ok, failure(read));

  const person = env.core.store.persons.create({ name: "Alex Acme", role: "contact" });
  const forContact = caller(
    {},
    {
      kind: "channel",
      title: "Alex",
      channel: { id: "ch_test", conversation: "alex", person_id: person.id },
    },
  );
  assert.match(failure(await env.core.dispatch("threads.get", { thread: other.id }, forContact.ctx)), /not found/);
  const viaChannel = caller({ channel });
  assert.match(failure(await env.core.dispatch("threads.get", { thread: other.id }, viaChannel.ctx)), /not found/);
});

test("threads.list: a project being moved stays hidden from the owner's agents elsewhere, not from its own", async () => {
  const hidden = northwindChat("Northwind move");
  env.core.store.projectProtection.protect("move_list", northwind);
  try {
    const own = caller();
    const listed = await env.core.dispatch("threads.list", {}, own.ctx);
    assert.ok(listed.ok, failure(listed));
    const ids = (listed.ok ? (listed.result as { threads: Array<{ id: string }> }).threads : []).map((t) => t.id);
    assert.ok(!ids.includes(hidden.id));
    assert.ok(ids.includes(own.thread), "its own chat stays listed");
  } finally {
    env.core.store.projectProtection.restore("move_list");
  }
});

test("media of another project's task chat is not reached by a call made on a contact's behalf", async () => {
  const store = env.core.store;
  const taskChat = northwindChat("Northwind task");
  store.tasks.create({ title: "Ship", project_id: northwind, status: "open", thread_id: taskChat.id, by: "owner" });
  const file = saveUpload(env.home, store, {
    name: "notes.txt",
    mime: "text/plain",
    bytes: Buffer.from("plan"),
    thread: taskChat.id,
  }).id;
  const own = caller();
  const read = await env.core.dispatch("media.get", { id: file }, own.ctx);
  assert.ok(read.ok, failure(read));
  const viaChannel = caller({ channel });
  assert.match(
    failure(await env.core.dispatch("media.get", { id: file }, viaChannel.ctx)),
    /only on its own project's tasks/,
  );
});

test("surfaces.show: the owner's agent makes a widget in another project; outsiders and moved projects are refused", async () => {
  const html = "<p>Pipeline</p>";
  const own = caller();
  const made = await env.core.dispatch(
    "surfaces.show",
    { name: "pipeline", title: "Pipeline", html, project: northwind },
    own.ctx,
    "show-1",
  );
  assert.ok(made.ok, failure(made));
  const surface = made.ok ? (made.result as { project_id?: string; thread_id?: string }) : {};
  assert.equal(surface.project_id, northwind);
  assert.equal(surface.thread_id, undefined, "not tied to a chat of another project");

  const viaChannel = caller({ channel });
  const outsider = await env.core.dispatch(
    "surfaces.show",
    { name: "pipeline", title: "Pipeline", html, project: northwind },
    viaChannel.ctx,
    "show-2",
  );
  assert.match(failure(outsider), /is not in project/);

  env.core.store.projectProtection.protect("move_widgets", northwind);
  try {
    const moving = await env.core.dispatch(
      "surfaces.show",
      { name: "pipeline", title: "Pipeline", html, project: northwind },
      own.ctx,
      "show-3",
    );
    assert.match(failure(moving), /being moved/);
  } finally {
    env.core.store.projectProtection.restore("move_widgets");
  }
});

test("a helper started from a contact's chat keeps the contact's walls", async () => {
  const store = env.core.store;
  const other = northwindChat("Northwind numbers");
  const person = store.persons.create({ name: "Sam Northwind", role: "contact" });
  const contactChat = store.threads.create({
    kind: "channel",
    title: "Sam",
    agent_ids: [builder],
    project_id: acme,
    channel: { id: "ch_test", conversation: "sam", person_id: person.id },
  });
  const helper = caller({}, { kind: "a2a", title: "Builder → Builder", parent_id: contactChat.id });
  assert.match(failure(await env.core.dispatch("threads.get", { thread: other.id }, helper.ctx)), /not found/);
  const widget = await env.core.dispatch(
    "surfaces.show",
    { name: "numbers", title: "Numbers", html: "<p>1</p>", project: northwind },
    helper.ctx,
    "show-helper",
  );
  assert.match(failure(widget), /is not in project/);
});
