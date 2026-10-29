import assert from "node:assert/strict";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import type { FlowGraph } from "../../../../packages/protocol/src/flow-graph.ts";
import { openDb } from "../db/db.ts";
import { MIGRATIONS } from "../db/migrations.ts";
import { tempDir } from "../testkit/platform.ts";
import { validateFlowGraph } from "./flow-graph-validate.ts";
import { FlowGraphConflict, flowGraphsRepo } from "./flow-graphs.ts";
import { flowsRepo, saveFlow } from "./flows.ts";

const authorizeGraph = (value: FlowGraph) => assert.deepEqual(validateFlowGraph(value), []);

const graph: FlowGraph = {
  schemaVersion: 2,
  nodes: [
    { id: "start", kind: "webhook", label: "Webhook" },
    { id: "save", kind: "table_write", label: "Save", key: "latest", value: { kind: "event", path: [] } },
  ],
  edges: [{ source: "start", target: "save" }],
  layout: [],
};
const definition = {
  id: "f",
  projectId: "p",
  name: "Inbox",
  enabled: false,
  predicates: [],
  tableKey: "latest",
  action: { kind: "agent" as const, agent: "worker", prompt: "Process" },
};
const seed = (db: DatabaseSync) => {
  db.prepare("INSERT INTO projects(id,name,created_at) VALUES ('p','Project','now')").run();
  saveFlow(db, definition);
};

test("publishing needs the exact draft and revision, keeps revisions immutable and leaves no draft behind", async () => {
  const temp = tempDir();
  const db = openDb(temp.path);
  try {
    seed(db);
    const repo = flowGraphsRepo(db);
    assert.throws(() => repo.publish("f", 1, null, authorizeGraph), FlowGraphConflict);
    assert.equal(repo.saveDraft("f", null, graph).draftVersion, 1);
    assert.throws(() => repo.saveDraft("f", null, graph), /draft changed/);
    const before = repo.get("f");
    assert.throws(() => repo.publish("f", 2, null, authorizeGraph), FlowGraphConflict);
    assert.throws(() => repo.publish("f", 1, 1, authorizeGraph), FlowGraphConflict);
    assert.throws(
      () =>
        repo.publish("f", 1, null, () => {
          throw new Error("binding refused");
        }),
      /binding refused/,
    );
    assert.deepEqual(repo.get("f"), before);
    const published = repo.publish("f", 1, null, authorizeGraph);
    assert.equal(published.publishedRevision, 1);
    assert.deepEqual(published.published, graph);
    assert.equal(published.draft, null);
    assert.equal(published.draftVersion, 2);
    const first = db.prepare("SELECT graph,created_at FROM flow_graph_revisions WHERE revision=1").get();
    // Saving the same drawing keeps no second copy; another drawing is a draft until it is published.
    assert.equal(repo.saveDraft("f", 2, graph).draft, null);
    const moved = { ...graph, layout: [{ node: "start", x: 10, y: 20 }] };
    const edited = repo.saveDraft("f", 3, moved);
    assert.deepEqual(edited.draft, moved);
    assert.equal(repo.publish("f", 4, 1, authorizeGraph).publishedRevision, 2);
    assert.deepEqual(
      { ...db.prepare("SELECT graph,created_at FROM flow_graph_revisions WHERE revision=1").get() },
      {
        ...first,
      },
    );
    assert.equal(db.prepare("SELECT count(*) AS n FROM flow_events").get()?.n, 0);
    assert.equal(db.prepare("SELECT count(*) AS n FROM flow_graph_nodes").get()?.n, 0);
    // A published Flow keeps its old definition as history: only its name and switch change.
    saveFlow(db, { ...definition, name: "Renamed", enabled: true });
    assert.throws(() => saveFlow(db, { ...definition, tableKey: "other" }), /legacy definition/);
    assert.throws(
      () =>
        repo.saveDraft("f", 5, {
          ...graph,
          nodes: [{ id: "start", kind: "webhook", label: "Bearer apx_test_secret_123456789012345678901234567890" }],
        }),
      /credentials/,
    );
  } finally {
    db.close();
    await temp.remove();
  }
});

function seedStoredRevision(db: DatabaseSync, revision: number) {
  db.prepare("INSERT INTO flow_graph_revisions(flow_id,revision,graph,created_at) VALUES ('f',?,?,'old')").run(
    revision,
    JSON.stringify(graph),
  );
  db.prepare("UPDATE flow_graph_drafts SET published_revision=? WHERE flow_id='f'").run(revision);
}

test("admission pins the revision, payload and deadline atomically with the dedup", async () => {
  const temp = tempDir();
  let db = openDb(temp.path);
  try {
    seed(db);
    let repo = flowGraphsRepo(db);
    repo.saveDraft("f", null, graph);
    seedStoredRevision(db, 1);
    db.prepare("UPDATE flows SET enabled=1 WHERE id='f'").run();
    const now = new Date("2026-01-01T00:00:00Z");
    assert.deepEqual(repo.admit("f", "empty", {}, now, authorizeGraph), { state: "ignored", revision: 1 });
    assert.equal(db.prepare("SELECT count(*) AS n FROM flow_graph_nodes").get()?.n, 0);
    db.prepare("DELETE FROM flow_events").run();
    assert.throws(
      () =>
        repo.admit("f", "denied", { text: "work" }, now, () => {
          throw new Error("Action authorization revoked");
        }),
      /authorization revoked/,
    );
    assert.equal(db.prepare("SELECT count(*) AS n FROM flow_events").get()?.n, 0);
    db.exec(
      "CREATE TRIGGER reject_checkpoint BEFORE INSERT ON flow_graph_nodes WHEN NEW.node_id='save' BEGIN SELECT RAISE(ABORT,'checkpoint rejected'); END",
    );
    assert.throws(() => repo.admit("f", "one", { text: "first" }, now, authorizeGraph), /checkpoint rejected/);
    assert.equal(db.prepare("SELECT count(*) AS n FROM flow_events").get()?.n, 0);
    assert.equal(db.prepare("SELECT count(*) AS n FROM flow_graph_events").get()?.n, 0);
    db.exec("DROP TRIGGER reject_checkpoint");
    assert.deepEqual(repo.admit("f", "one", { text: "first", password: "sensitive" }, now, authorizeGraph), {
      state: "pending",
      revision: 1,
    });
    assert.equal(db.prepare("SELECT count(*) AS n FROM flow_graph_nodes").get()?.n, 2);
    assert.deepEqual(flowsRepo(db).pending(), []);
    assert.throws(() => flowsRepo(db).admissionInput("f", "one"), /no longer pending/);
    assert.equal(flowsRepo(db).events("f", 10)[0]?.state, "pending");
    assert.equal(db.prepare("SELECT executor FROM flow_events WHERE event_id='one'").get()?.executor, "graph-v2");
    db.prepare("UPDATE flow_events SET state='failed' WHERE event_id='one'").run();
    assert.deepEqual(flowsRepo(db).retry("f", "one"), { queued: false });
    db.prepare("UPDATE flow_events SET state='pending' WHERE event_id='one'").run();
    db.prepare("UPDATE flows SET enabled=0 WHERE id='f'").run();
    repo.saveDraft("f", 1, { ...graph, layout: [{ node: "start", x: 3, y: 4 }] });
    seedStoredRevision(db, 2);
    assert.throws(() => repo.discardDraft("f", 2), /Published/);
    assert.throws(() => saveFlow(db, { ...definition, enabled: true, tableKey: "other" }), /legacy definition/);
    db.close();
    db = openDb(temp.path);
    repo = flowGraphsRepo(db);
    db.prepare("UPDATE flows SET enabled=1 WHERE id='f'").run();
    assert.deepEqual(repo.admit("f", "one", { text: "replacement" }, now, authorizeGraph), { state: "duplicate" });
    const accepted = db.prepare("SELECT * FROM flow_graph_events WHERE event_id='one'").get();
    assert.equal(accepted?.revision, 1);
    assert.equal(accepted?.deadline_at, "2026-01-01T00:10:00.000Z");
    assert.equal(JSON.parse(String(accepted?.payload)).text, "first");
    assert.ok(!String(accepted?.payload).includes("sensitive"));
    // A published Flow admits only with its binding check, and pins the revision published now.
    assert.throws(() => flowsRepo(db).receive("f", "public", { text: "work" }), /binding check/);
    assert.equal(db.prepare("SELECT count(*) AS n FROM flow_events").get()?.n, 1);
    assert.equal(flowsRepo(db).receive("f", "public", { text: "work" }, authorizeGraph, now), "pending");
    assert.equal(db.prepare("SELECT revision FROM flow_graph_events WHERE event_id='public'").get()?.revision, 2);
  } finally {
    db.close();
    await temp.remove();
  }
});

test("additive migration leaves legacy pending payload, action, rows and deduplication unchanged", async () => {
  const temp = tempDir();
  let db = new DatabaseSync(path.join(temp.path, "apx.db"));
  try {
    db.exec("PRAGMA foreign_keys=ON; CREATE TABLE meta(key TEXT PRIMARY KEY,value TEXT NOT NULL)");
    const graphs = MIGRATIONS.findIndex((m) => m.includes("CREATE TABLE flow_graph_drafts"));
    for (const migration of MIGRATIONS.slice(0, graphs)) db.exec(migration);
    db.prepare("INSERT INTO meta(key,value) VALUES ('schema_version',?)").run(String(graphs));
    db.prepare("INSERT INTO projects(id,name,created_at) VALUES ('p','Project','now')").run();
    db.prepare(
      "INSERT INTO flows(id,project_id,name,enabled,predicates,table_key,action,read_keys) VALUES ('f','p','Inbox',1,'[]','latest',?,'[]')",
    ).run(JSON.stringify(definition.action));
    db.prepare(
      "INSERT INTO flow_events(flow_id,event_id,state,created_at,payload,action) VALUES ('f','old','pending','now',?,?)",
    ).run(JSON.stringify({ text: "original" }), JSON.stringify(definition.action));
    db.prepare("INSERT INTO flow_rows(flow_id,key,value) VALUES ('f','latest',?)").run(
      JSON.stringify({ text: "original" }),
    );
    const before = db
      .prepare("SELECT * FROM flow_events")
      .all()
      .map((row) => ({ ...row }));
    db.close();
    db = openDb(temp.path);
    assert.deepEqual(
      db
        .prepare("SELECT * FROM flow_events")
        .all()
        .map(({ executor, stopped_at, source, scheduled_at, test, headers, ...row }) => {
          assert.equal(executor, "legacy");
          assert.equal(stopped_at, null);
          // Every event before schedules came by POST, and before tests none was one.
          assert.equal(source, "webhook");
          assert.equal(scheduled_at, null);
          assert.equal(test, 0);
          assert.equal(headers, null);
          return row;
        }),
      before,
    );
    const legacy = flowsRepo(db);
    // Its address stays where it was: a Flow from before paths keeps its identifier as its path.
    assert.equal(legacy.get("f")?.path, "f");
    assert.equal(legacy.byPath("f")?.id, "f");
    assert.equal(legacy.pending()[0]?.action.kind, "agent");
    assert.deepEqual(legacy.pending()[0]?.payload, { text: "original" });
    assert.equal(legacy.receive("f", "old", { text: "new" }), "duplicate");
    assert.deepEqual(legacy.rows("f", 10)[0]?.value, { text: "original" });
    assert.equal(flowGraphsRepo(db).get("f").draftVersion, null);
    assert.equal(db.prepare("SELECT count(*) AS n FROM flow_graph_events").get()?.n, 0);
  } finally {
    db.close();
    await temp.remove();
  }
});
