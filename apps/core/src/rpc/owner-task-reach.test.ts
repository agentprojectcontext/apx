// The owner's own agents work on any project's tasks and say where; outsiders (an outside app's session, a contact's
// chat) and a project being moved stay fenced (DECISIONS.md#d-271).
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { Task } from "@apx/protocol";
import { say, scriptedLlm, startCore } from "../engine/testkit.ts";
import { createLog } from "../log.ts";
import type { CallContext } from "./context.ts";

const llm = scriptedLlm(() => say("ok"));
let env: Awaited<ReturnType<typeof startCore>>;
const ACME = "acme";
const NORTHWIND = "northwind";
before(async () => {
  env = await startCore({ llm });
  for (const id of [ACME, NORTHWIND]) env.core.store.projects.upsert({ id, name: id === ACME ? "Acme" : "Northwind" });
  for (const [id, project] of [
    ["acme-dev", ACME],
    ["northwind-dev", NORTHWIND],
  ] as const)
    env.core.store.agents.upsertApc({
      id,
      name: id,
      project_id: project,
      slug: id,
      role: "Engineering",
      prompt: "",
      extra: {},
    });
});
after(async () => {
  await env.core.close();
  await env.cleanup();
});

const as = (agent: string, thread: string, extra: Partial<CallContext> = {}): CallContext => ({
  transport: "internal",
  role: "operator",
  actor: "agent",
  session: undefined,
  log: createLog("test", true),
  agent: { id: agent, thread_id: thread, run_id: "test" },
  ...extra,
});
let n = 0;
const call = (method: string, params: object, ctx: CallContext) =>
  env.core.dispatch(method as "tasks.get", params as never, ctx, `owner-reach-${++n}`);
const chat = (project?: string, kind: "loose" | "a2a" = "loose", agents = ["acme-dev"]) =>
  env.core.store.threads.create({ kind, title: "Work", agent_ids: agents, project_id: project });
/** A chat an outside app opened: its agent works for that app, not for the owner. */
const appChat = () => {
  const t = chat(ACME);
  env.core.store.threads.mergeContext(t.id, { client: "external" });
  return t;
};
/** A contact's chat on a channel. */
const contactChat = () => {
  const person = env.core.store.persons.create({ name: "Acme Buyer", role: "contact" });
  return env.core.store.threads.create({
    kind: "channel",
    title: person.name,
    agent_ids: ["acme-dev"],
    project_id: ACME,
    channel: { id: "test", conversation: person.id, person_id: person.id },
  });
};

test("the owner's agent reads, lists, creates, moves and comments on another project's tasks", async () => {
  const theirs = await env.client.call("tasks.create", { title: "Northwind invoice", project: NORTHWIND });
  const here = chat(ACME);
  const ctx = as("acme-dev", here.id);

  const got = await call("tasks.get", { task: theirs.id }, ctx);
  assert.equal(got.ok, true);

  const listed = await call("tasks.list", { project: NORTHWIND, limit: 50 }, ctx);
  assert.ok(listed.ok);
  const ids = (listed.result as { tasks: Task[] }).tasks.map((t) => t.id);
  assert.ok(ids.includes(theirs.id));

  const made = await call("tasks.create", { title: "Northwind follow-up", project: NORTHWIND }, ctx);
  assert.ok(made.ok, JSON.stringify(made));
  assert.equal((made.result as Task).project_id, NORTHWIND);
  // Without a project it stays where the chat is.
  const local = await call("tasks.create", { title: "Acme note" }, ctx);
  assert.ok(local.ok);
  const note = local.result as Task;
  assert.equal(note.project_id, ACME);

  const moved = await call("tasks.update", { task: note.id, project: NORTHWIND }, ctx);
  assert.ok(moved.ok, JSON.stringify(moved));
  assert.equal(env.core.store.tasks.get(note.id)?.project_id, NORTHWIND);

  const said = await call("tasks.comment", { task: theirs.id, text: "@owner is the invoice due this month?" }, ctx);
  assert.ok(said.ok, JSON.stringify(said));
});

test("an assignee of another project is a data rule, and the refusal says how to reach them", async () => {
  const ctx = as("acme-dev", chat(ACME).id);
  const r = await call(
    "tasks.create",
    { title: "Fix the northwind build", description: "Fix it.", assignee: "northwind-dev" },
    ctx,
  );
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.error.message, /works in another project.*northwind.*project.*delegate/);
  // The owner reads the project's name, never its id or an agent's next call.
  const mine = await env.client.call("tasks.create", { title: "Plain", project: ACME });
  const owner = await env.client.call("tasks.update", { task: mine.id, assignee: "northwind-dev" }).then(
    () => "",
    (e: Error) => e.message,
  );
  assert.match(owner, /works in another project/);
  assert.doesNotMatch(owner, /id |delegate/);
});

test("kept rules: only the owner accepts a proposal, and an agent cannot lift a subtask higher up", async () => {
  const proposal = await env.client.call("tasks.create", { title: "Proposed", project: NORTHWIND, propose: true });
  const ctx = as("acme-dev", chat(ACME).id);
  const accepted = await call("tasks.update", { task: proposal.id, proposed: false }, ctx);
  assert.equal(accepted.ok, false);
  if (!accepted.ok) assert.match(accepted.error.message, /only the owner accepts/);
  const parent = await env.client.call("tasks.create", { title: "Parent", project: NORTHWIND });
  const child = await env.client.call("tasks.create", { title: "Child", project: NORTHWIND, parent: parent.id });
  const lifted = await call("tasks.update", { task: child.id, parent: null }, ctx);
  assert.equal(lifted.ok, false);
  if (!lifted.ok) assert.match(lifted.error.message, /cannot move a task higher up/);
});

test("an outside app's session and a contact's chat stay in their own project", async () => {
  const theirs = await env.client.call("tasks.create", { title: "Northwind secret", project: NORTHWIND });
  const own = await env.client.call("tasks.create", { title: "Acme own", project: ACME });
  for (const thread of [appChat(), contactChat()]) {
    const ctx = as("acme-dev", thread.id);
    const got = await call("tasks.get", { task: theirs.id }, ctx);
    assert.equal(got.ok, false);
    if (!got.ok) assert.match(got.error.message, /task unavailable/);
    const listed = await call("tasks.list", { project: NORTHWIND, limit: 200 }, ctx);
    assert.ok(listed.ok);
    const ids = (listed.result as { tasks: Task[] }).tasks.map((t) => t.id);
    assert.ok(!ids.includes(theirs.id));
    const made = await call("tasks.create", { title: "Escape", project: NORTHWIND }, ctx);
    assert.equal(made.ok, false);
    if (!made.ok) assert.match(made.error.message, /creates tasks only in its own project/);
    const moved = await call("tasks.update", { task: own.id, project: NORTHWIND }, ctx);
    assert.equal(moved.ok, false);
    const said = await call("tasks.comment", { task: theirs.id, text: "hello" }, ctx);
    assert.equal(said.ok, false);
  }
  assert.equal(env.core.store.tasks.get(own.id)?.project_id, ACME);
});

test("an outside app calling with its token keeps its own filters", async () => {
  const theirs = await env.client.call("tasks.create", { title: "Northwind app", project: NORTHWIND });
  const ctx = as("acme-dev", chat(ACME).id, { client: { id: "app", name: "App", scopes: [] } });
  const got = await call("tasks.get", { task: theirs.id }, ctx);
  assert.equal(got.ok, false);
});

test("a project being moved stays out of reach of the owner's agents too", async () => {
  const theirs = await env.client.call("tasks.create", { title: "Moving work", project: NORTHWIND });
  env.core.store.projectProtection.protect("mig_test", NORTHWIND);
  try {
    const ctx = as("acme-dev", chat(ACME).id);
    assert.equal((await call("tasks.get", { task: theirs.id }, ctx)).ok, false);
    const listed = await call("tasks.list", { project: NORTHWIND, limit: 10 }, ctx);
    assert.equal(listed.ok, false);
    const made = await call("tasks.create", { title: "Into the move", project: NORTHWIND }, ctx);
    assert.equal(made.ok, false);
    if (!made.ok) assert.match(made.error.message, /being moved/);
  } finally {
    env.core.store.projectProtection.restore("mig_test");
  }
});

test("an owner's agent answering a teammate may open the work it finds; a contact's helper may not", async () => {
  const helper = chat(ACME, "a2a", ["acme-dev", "superagent"]);
  const opened = await call(
    "tasks.create",
    { title: "Opened by a helper", goal: "Done", description: "Fix the login form.", assignee: "acme-dev" },
    as("acme-dev", helper.id),
  );
  assert.ok(opened.ok, JSON.stringify(opened));
  const outside = chat(ACME, "a2a", ["acme-dev", "superagent"]);
  env.core.store.threads.mergeContext(outside.id, { client: "external" });
  const refused = await call(
    "tasks.create",
    { title: "Opened for an app", goal: "Done", description: "Fix the login form.", assignee: "acme-dev" },
    as("acme-dev", outside.id),
  );
  assert.equal(refused.ok, false);
  if (!refused.ok) assert.match(refused.error.message, /start no task work/);
});
