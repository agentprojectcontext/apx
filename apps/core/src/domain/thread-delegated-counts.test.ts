import assert from "node:assert/strict";
import { test } from "node:test";
import { createBus } from "../bus.ts";
import { openDb } from "../db/db.ts";
import { tempDir } from "../testkit/platform.ts";
import { seed } from "./seed.ts";
import { createStore } from "./store.ts";

test("delegated counts and capped previews exclude external sessions and archived chats", async () => {
  const dir = tempDir("apx-delegated-counts-");
  const db = openDb(dir.path);
  const store = createStore(db, createBus());
  seed(store);
  try {
    const project = "p_helpers";
    store.projects.upsert({ id: project, name: "Helpers" });
    const parent = store.threads.create({ kind: "loose", title: "Task work", agent_ids: ["superagent"] });
    const helper = store.threads.create({
      kind: "a2a",
      title: "Helper",
      agent_ids: ["superagent"],
      parent_id: parent.id,
      project_id: project,
    });
    const consult = store.threads.create({
      kind: "agent",
      title: "Consult",
      agent_ids: ["superagent"],
      parent_id: parent.id,
      project_id: project,
    });
    const archived = store.threads.create({
      kind: "a2a",
      title: "Archived helper",
      agent_ids: ["superagent"],
      parent_id: parent.id,
      project_id: project,
    });
    store.threads.arrange(archived.id, { archived: true });
    const code = store.threads.create({
      kind: "code",
      engine: "claude",
      title: "External session",
      agent_ids: ["superagent"],
      parent_id: parent.id,
      project_id: project,
    });
    db.prepare("UPDATE threads SET updated_at = ? WHERE id = ?").run("2099-01-01T00:00:00.000Z", code.id);
    assert.deepEqual(store.threads.delegatedCounts([parent.id]), { [parent.id]: 2 });
    const preview = store.threads.delegatedFrom([parent.id], 1);
    assert.equal(preview.length, 1);
    assert.deepEqual(
      new Set(store.threads.delegatedAcross(project).map((t) => t.id)),
      new Set([helper.id, consult.id]),
    );
    assert.equal(store.threads.delegatedAcross(project, 1).length, 1);
    assert.ok(
      [helper.id, consult.id].includes(preview[0]?.id ?? ""),
      "external sessions cannot consume the preview cap",
    );
    assert.deepEqual(
      new Set(store.threads.delegatedFrom([parent.id], 10).map((t) => t.id)),
      new Set([helper.id, consult.id]),
    );
    assert.ok(
      store.threads.list().some((t) => t.id === code.id),
      "the external session keeps its own list access",
    );
    assert.ok(
      store.threads.descendants(parent.id).some((t) => t.id === code.id),
      "full descendant access remains available",
    );
  } finally {
    db.close();
    await dir.remove();
  }
});
