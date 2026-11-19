import assert from "node:assert/strict";
import { test } from "node:test";
import { createBus } from "../bus.ts";
import { openDb } from "../db/db.ts";
import { tempDir } from "../testkit/platform.ts";
import { decodeMigrationBackup, encodeMigrationBackup } from "./agent-migration-codec.ts";
import { canReadChat } from "./chat-access.ts";
import { qb, type Sql, sql } from "./sql.ts";
import { createStore, type Store } from "./store.ts";

function seedAgents(store: Store, q: Sql, root: string) {
  for (const id of ["acme", "northwind"]) store.projects.upsert({ id, name: id, path: root, present: true });
  for (const id of ["researcher", "editor"]) {
    store.agents.upsert({
      id,
      name: id,
      kind: "agent",
      role: "Research",
      project_id: "acme",
      browser_profile: "isolated",
      prompt: "Check evidence",
    });
    q.run(qb.updateTable("agents").set({ slug: id }).where("id", "=", id));
  }
}

test("private recovery journal preserves SQLite blobs without interpreting note text", () => {
  const value = { embedding: new Uint8Array([0, 255, 3, 8]), text: '{"migration_bytes":"Zm9v"}' };
  assert.deepEqual(decodeMigrationBackup(encodeMigrationBackup(value)), value);
});

test("inventory includes completed shared work and descendants without absorbing the caller's chat", async () => {
  const dir = tempDir("apx-migration-inventory-");
  const db = openDb(dir.path);
  const store = createStore(db, createBus());
  const q = sql(db);
  try {
    seedAgents(store, q, dir.path);
    const caller = store.threads.create({
      kind: "agent",
      title: "Other work",
      project_id: "acme",
      agent_ids: ["editor"],
    });
    const taskChat = store.threads.create({
      kind: "agent",
      title: "Shared work",
      project_id: "acme",
      agent_ids: ["editor"],
    });
    const task = store.tasks.create({
      title: "Check a report",
      status: "doing",
      project_id: "acme",
      assignee: "editor",
      thread_id: taskChat.id,
      by: "owner",
    });
    store.tasks.change(task.id, { state: "done" }, "owner");
    const own = store.threads.create({
      kind: "agent",
      title: "Research",
      project_id: "acme",
      agent_ids: ["researcher"],
      parent_id: caller.id,
      task_id: task.id,
    });
    const unrelatedTaskChat = store.threads.create({
      kind: "task",
      title: "Remaining task",
      project_id: "acme",
      agent_ids: ["editor"],
    });
    const remaining = store.tasks.create({
      title: "Keep in source",
      status: "doing",
      project_id: "acme",
      parent_id: task.id,
      thread_id: unrelatedTaskChat.id,
      assignee: "editor",
      by: "owner",
    });
    const child = store.threads.create({
      kind: "agent",
      title: "Consult",
      project_id: "acme",
      agent_ids: ["editor"],
      parent_id: own.id,
    });
    const before = store.agentMigration.inventory("researcher", "northwind");
    assert.deepEqual(before.tasks, [task.id]);
    assert.deepEqual(before.detached_tasks, [remaining.id]);
    assert.deepEqual(before.shared_tasks, [task.id]);
    assert.deepEqual(new Set(before.threads), new Set([taskChat.id, own.id, child.id]));
    assert.ok(!before.threads.includes(caller.id));
    assert.deepEqual(before.blockers, []);
    assert.doesNotMatch(JSON.stringify(before), /Check evidence|Check a report|Other work/);
    store.tasks.change(task.id, { title: "Changed report" }, "owner");
    assert.notEqual(store.agentMigration.inventory("researcher", "northwind").revision, before.revision);
    assert.equal(store.tasks.get(task.id)?.project_id, "acme", "preview never moves data");
    assert.throws(() => store.agentMigration.commit(before), /inventory changed/);
    const personal = store.memories.add({
      scope: "agent",
      agent_id: "researcher",
      project_id: "acme",
      text: "Check citations",
      source: "owner",
      thread_id: own.id,
    });
    const unrelated = store.memories.add({
      scope: "project",
      project_id: "acme",
      text: "Other work guidelines",
      source: "owner",
      thread_id: caller.id,
    });
    const formerlyGlobal = store.memories.add({
      scope: "global",
      text: "Report-specific reading checklist",
      source: "owner",
      thread_id: own.id,
    });
    const snapshot = store.agentMigration.inventory("researcher", "northwind");
    const moved = store.agentMigration.commit(snapshot);
    assert.equal(moved.inventory.revision, snapshot.revision);
    assert.equal(store.agents.get("researcher")?.id, "researcher");
    assert.equal(store.agents.get("researcher")?.project_id, "northwind");
    assert.equal(store.agents.get("editor")?.project_id, "acme");
    assert.equal(store.tasks.get(task.id)?.project_id, "northwind");
    assert.equal(store.tasks.get(task.id)?.state, "done");
    assert.equal(store.tasks.get(task.id)?.assignee, undefined);
    assert.equal(store.tasks.get(remaining.id)?.project_id, "acme");
    assert.equal(store.tasks.get(remaining.id)?.parent_id, undefined);
    assert.equal(store.threads.get(unrelatedTaskChat.id)?.project_id, "acme");
    assert.deepEqual(store.threads.get(child.id)?.agent_ids, ["researcher"]);
    const editor = store.agents.get("editor");
    const movedChat = store.threads.get(child.id);
    assert.ok(editor && movedChat);
    assert.equal(canReadChat(store, editor, movedChat), false, "former collaborators cannot read the migrated chat");
    assert.equal(store.agents.get("researcher")?.prompt, "Check evidence");
    assert.equal(store.threads.get(caller.id)?.project_id, "acme");
    assert.equal(store.threads.get(own.id)?.parent_id, undefined);
    assert.equal(store.memories.get(personal.id)?.project_id, "northwind");
    assert.equal(store.memories.get(formerlyGlobal.id)?.scope, "project");
    assert.equal(store.memories.get(formerlyGlobal.id)?.project_id, "northwind");
    assert.equal(store.memories.get(unrelated.id)?.project_id, "acme");
    assert.ok(q.one(qb.selectFrom("meta").select("key").where("key", "=", `agent-migration:${moved.id}`)));
    assert.equal(store.tasks.events(task.id).at(-1)?.by, "owner");
    assert.deepEqual(store.agentMigration.restore(moved.id), { id: moved.id, restored: true });
    assert.equal(store.agents.get("researcher")?.project_id, "acme");
    assert.equal(store.tasks.get(task.id)?.assignee, "editor");
    assert.equal(store.tasks.get(remaining.id)?.parent_id, task.id);
    assert.equal(store.tasks.get(task.id)?.state, "done");
    assert.equal(store.memories.get(personal.id)?.project_id, "acme");
    assert.equal(store.memories.get(formerlyGlobal.id)?.scope, "global");
    assert.deepEqual(store.threads.get(child.id)?.agent_ids, ["editor"]);
    assert.deepEqual(store.agentMigration.restore(moved.id), { id: moved.id, restored: true });
    const external = store.threads.create({
      kind: "agent",
      title: "Unrelated cross-project participation",
      agent_ids: ["researcher"],
    });
    const next = store.agentMigration.inventory("researcher", "northwind");
    assert.ok(next.detached_threads.includes(external.id));
    assert.ok(!next.threads.includes(external.id));
    const again = store.agentMigration.commit(next);
    assert.deepEqual(store.threads.get(external.id)?.agent_ids, []);
    assert.equal(store.threads.get(external.id)?.project_id, undefined);
    const relocated = store.agents.get("researcher");
    const detached = store.threads.get(external.id);
    assert.ok(relocated && detached);
    assert.equal(canReadChat(store, relocated, detached), false);
    store.tasks.change(task.id, { title: "New work" }, "owner");
    assert.throws(() => store.agentMigration.restore(again.id), /Work changed/);
    assert.equal(store.tasks.get(task.id)?.title, "New work");
  } finally {
    db.close();
    await dir.remove();
  }
});
