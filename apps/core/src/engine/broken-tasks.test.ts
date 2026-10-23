// The daily watch reads, with no model, the tasks set up so they cannot move, and its agent hears only about those.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { watchSignals } from "../domain/signals.ts";
import { say, scriptedLlm, startCore } from "./testkit.ts";

let env: Awaited<ReturnType<typeof startCore>>;
before(async () => {
  env = await startCore({ llm: scriptedLlm(() => say("ok")) });
});
after(async () => {
  await env.core.close();
  env.cleanup();
});

/** A task straight in the store, as an import or an older version may have left it. */
function task(title: string, fields: { assignee?: string; status?: string; description?: string; parent?: string }) {
  const store = env.core.store;
  return store.tasks.create({
    title,
    description: fields.description,
    assignee: fields.assignee,
    status: fields.status ?? "todo",
    parent_id: fields.parent,
    thread_id: store.threads.create({ kind: "task", title, agent_ids: ["roby"] }).id,
    by: "owner",
  });
}

const broken = (now = new Date()) =>
  new Map(
    watchSignals(env.core.store, { now })
      .filter((s) => s.kind === "broken_task")
      .map((s) => [s.subject.split(": ").at(-1), s]),
  );

test("tasks that cannot move are signals, each said plainly; healthy ones are not", async () => {
  const store = env.core.store;
  task("Ghost work", { assignee: "gone-agent", description: "Do it." });
  task("Empty brief", { assignee: "vera" });
  task("Orphan in progress", { status: "doing", description: "Do it." });
  const parent = task("Old parent", { description: "Done already." });
  store.tasks.change(parent.id, { state: "done" }, "owner");
  task("Left behind", { parent: parent.id, description: "A part of it." });
  const late = task("Late start", { assignee: "vera", description: "Begin it." });
  store.tasks.change(late.id, { start_at: new Date(Date.now() - 2 * 3600_000).toISOString() }, "owner");
  task("Healthy", { description: "Nothing wrong here." });

  const found = broken();
  assert.equal(found.get("Ghost work")?.severity, "high");
  assert.match(found.get("Ghost work")?.subject ?? "", /agent that no longer exists/);
  assert.match(found.get("Empty brief")?.subject ?? "", /no description, so it never starts/);
  assert.match(found.get("Orphan in progress")?.subject ?? "", /In progress with nobody on it/);
  assert.match(found.get("Left behind")?.subject ?? "", /under a task already closed/);
  assert.match(found.get("Late start")?.subject ?? "", /passed and it never began/);
  assert.equal(found.has("Healthy"), false);
  assert.equal(found.has("Old parent"), false, "a closed task is no signal");
});

test("a task in progress whose chat went quiet for days is a signal; one waiting on the owner is not", async () => {
  const store = env.core.store;
  const t = task("Quiet migration", { assignee: "vera", status: "doing", description: "Move the data." });
  const chat = store.threads.create({ kind: "loose", title: t.title, agent_ids: ["vera"], task_id: t.id });
  const run = store.runs.create({
    thread_id: chat.id,
    agent_id: "vera",
    trigger: "user",
    input: { origin: { kind: "user" }, text: "Work on this task." },
    deadline_at: new Date(Date.now() + 60_000).toISOString(),
  });
  store.runs.setState(run, "completed");
  const inThreeDays = new Date(Date.now() + 3 * 24 * 3600_000);
  assert.match(broken(inThreeDays).get("Quiet migration")?.subject ?? "", /nothing has run on it for 3 days/);
  store.tasks.change(t.id, { awaits_owner: true }, "owner");
  assert.equal(broken(inThreeDays).has("Quiet migration"), false);
});
