import assert from "node:assert/strict";
import { test } from "node:test";
import type { FlowGraph } from "../../../../packages/protocol/src/flow-graph.ts";
import { openDb } from "../db/db.ts";
import { tempDir } from "../testkit/platform.ts";
import { retainFlowGraphRevisions } from "./flow-graph-retention.ts";
import { flowGraphsRepo } from "./flow-graphs.ts";
import { saveFlow } from "./flows.ts";
import { sql } from "./sql.ts";

const graph: FlowGraph = {
  schemaVersion: 2,
  nodes: [{ id: "start", kind: "webhook", label: "Webhook" }],
  edges: [],
  layout: [],
};
type Db = ReturnType<typeof openDb>;

// Storage fixtures exercise retention only; they do not publish through the disabled API or execute nodes.
function seedStoredRevisions(db: Db, id: string, count: number) {
  db.prepare("INSERT OR IGNORE INTO projects(id,name,created_at) VALUES ('p','Project','now')").run();
  saveFlow(db, {
    id,
    projectId: "p",
    name: "Flow",
    enabled: false,
    predicates: [],
    tableKey: "latest",
    action: { kind: "none" },
  });
  flowGraphsRepo(db).saveDraft(id, null, graph);
  db.prepare(
    "WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<?) INSERT INTO flow_graph_revisions(flow_id,revision,graph,created_at) SELECT ?,x,?,'old' FROM n",
  ).run(count, id, JSON.stringify(graph));
  db.prepare("UPDATE flow_graph_drafts SET published_revision=? WHERE flow_id=?").run(count, id);
}

function pinStoredRevision(db: Db, revision: number) {
  const event = `event-${revision}`;
  db.prepare(
    "INSERT INTO flow_events(flow_id,event_id,state,created_at,executor) VALUES ('f',?,'failed','old','graph-v2')",
  ).run(event);
  db.prepare(
    "INSERT INTO flow_graph_events(flow_id,event_id,revision,payload,deadline_at) VALUES ('f',?,?,'{}','old')",
  ).run(event, revision);
  db.prepare(
    "INSERT INTO flow_graph_nodes(flow_id,event_id,revision,node_id,state) VALUES ('f',?,?,'start','failed')",
  ).run(event, revision);
}

function appendStoredRevision(db: Db, revision: number) {
  sql(db).tx(() => {
    retainFlowGraphRevisions(db, "f");
    db.prepare("INSERT INTO flow_graph_revisions(flow_id,revision,graph,created_at) VALUES ('f',?,?,'new')").run(
      revision,
      JSON.stringify(graph),
    );
    db.prepare("UPDATE flow_graph_drafts SET published_revision=? WHERE flow_id='f'").run(revision);
  });
}

test("storage retention passes revision 100, preserves pinned history across reopen and rolls back failed inserts", async () => {
  const temp = tempDir();
  let db = openDb(temp.path);
  try {
    seedStoredRevisions(db, "f", 105);
    pinStoredRevision(db, 1);
    sql(db).tx(() => retainFlowGraphRevisions(db, "f"));
    assert.equal(db.prepare("SELECT count(*) AS n FROM flow_graph_revisions WHERE flow_id='f'").get()?.n, 99);
    assert.deepEqual(
      JSON.parse(
        String(db.prepare("SELECT graph FROM flow_graph_revisions WHERE flow_id='f' AND revision=1").get()?.graph),
      ),
      graph,
    );
    assert.equal(
      db.prepare("SELECT revision FROM flow_graph_nodes WHERE flow_id='f' AND event_id='event-1'").get()?.revision,
      1,
    );
    assert.equal(db.prepare("SELECT 1 FROM flow_graph_revisions WHERE flow_id='f' AND revision=2").get(), undefined);
    assert.equal(flowGraphsRepo(db).get("f").publishedRevision, 105);
    db.close();
    db = openDb(temp.path);
    appendStoredRevision(db, 106);
    assert.equal(flowGraphsRepo(db).get("f").publishedRevision, 106);
    assert.equal(db.prepare("SELECT count(*) AS n FROM flow_graph_revisions").get()?.n, 100);
    assert.equal(db.prepare("SELECT revision FROM flow_graph_events WHERE event_id='event-1'").get()?.revision, 1);
    const before = db.prepare("SELECT * FROM flow_graph_revisions ORDER BY revision").all();
    db.exec(
      "CREATE TRIGGER reject_revision BEFORE INSERT ON flow_graph_revisions BEGIN SELECT RAISE(ABORT,'revision rejected'); END",
    );
    assert.throws(() => appendStoredRevision(db, 107), /revision rejected/);
    assert.deepEqual(db.prepare("SELECT * FROM flow_graph_revisions ORDER BY revision").all(), before);
    assert.equal(flowGraphsRepo(db).get("f").publishedRevision, 106);
  } finally {
    db.close();
    await temp.remove();
  }
});

test("global storage retention preserves every current publication while freeing unreferenced history", async () => {
  const temp = tempDir();
  const db = openDb(temp.path);
  try {
    seedStoredRevisions(db, "f", 1);
    for (let i = 0; i < 100; i++) seedStoredRevisions(db, `other-${i}`, 100);
    appendStoredRevision(db, 2);
    assert.equal(db.prepare("SELECT count(*) AS n FROM flow_graph_revisions").get()?.n, 10000);
    for (let i = 0; i < 100; i++) assert.equal(flowGraphsRepo(db).get(`other-${i}`).publishedRevision, 100);
    assert.equal(db.prepare("SELECT count(*) AS n FROM flow_graph_revisions WHERE revision=100").get()?.n, 100);
  } finally {
    db.close();
    await temp.remove();
  }
});

test("storage retention fails atomically when every retained revision is pinned without cascading away history", async () => {
  const temp = tempDir();
  const db = openDb(temp.path);
  try {
    seedStoredRevisions(db, "f", 100);
    for (let revision = 1; revision <= 100; revision++) pinStoredRevision(db, revision);
    assert.throws(() => appendStoredRevision(db, 101), /capacity/);
    assert.equal(flowGraphsRepo(db).get("f").publishedRevision, 100);
    assert.equal(db.prepare("SELECT count(*) AS n FROM flow_graph_revisions").get()?.n, 100);
    assert.equal(db.prepare("SELECT count(*) AS n FROM flow_graph_events").get()?.n, 100);
    assert.equal(db.prepare("SELECT count(*) AS n FROM flow_graph_nodes").get()?.n, 100);
  } finally {
    db.close();
    await temp.remove();
  }
});
