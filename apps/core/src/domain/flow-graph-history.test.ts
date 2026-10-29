import assert from "node:assert/strict";
import { test } from "node:test";
import type { FlowGraph } from "../../../../packages/protocol/src/flow-graph.ts";
import { openDb } from "../db/db.ts";
import { tempDir } from "../testkit/platform.ts";
import { FLOW_HISTORY_KEEP } from "./flow-graph-history.ts";
import { validateFlowGraph } from "./flow-graph-validate.ts";
import { flowGraphsRepo } from "./flow-graphs.ts";
import { saveFlow } from "./flows.ts";

const authorize = (value: FlowGraph) => assert.deepEqual(validateFlowGraph(value), []);
const named = (label: string): FlowGraph => ({
  schemaVersion: 2,
  nodes: [
    { id: "start", kind: "webhook", label },
    { id: "save", kind: "table_write", label: "Save", key: "latest", value: { kind: "event", path: [] } },
  ],
  edges: [{ source: "start", target: "save" }],
  layout: [],
});
const none = () => null;
const drawingOf = (repo: ReturnType<typeof flowGraphsRepo>, entry: number) =>
  repo.history.get("f", entry, none)?.graph as FlowGraph;

async function withRepo(run: (repo: ReturnType<typeof flowGraphsRepo>, db: ReturnType<typeof openDb>) => void) {
  const temp = tempDir();
  const db = openDb(temp.path);
  try {
    db.prepare("INSERT INTO projects(id,name,created_at) VALUES ('p','Project','now')").run();
    saveFlow(db, {
      id: "f",
      projectId: "p",
      name: "Inbox",
      enabled: true,
      predicates: [],
      tableKey: "latest",
      action: { kind: "none" },
    });
    run(flowGraphsRepo(db), db);
  } finally {
    db.close();
    await temp.remove();
  }
}

test("each save that changes the drawing leaves one entry; the same drawing and test pins leave none", () =>
  withRepo((repo) => {
    repo.saveDraft("f", null, named("A"));
    // The same drawing again changes nothing.
    repo.saveDraft("f", 1, named("A"));
    // The owner's Save on a Flow that is on publishes what it just saved: one entry, now published.
    repo.publish("f", 2, null, authorize);
    repo.saveDraft("f", 3, named("B"), "writer");
    // The owner publishes the agent's draft: who drew it and who made it run stay apart.
    repo.publish("f", 4, 1, authorize);
    repo.testRevision("f", named("T"));
    const list = repo.history.list("f", (id) => (id === "writer" ? "Writer" : null));
    assert.deepEqual(
      list.map((e) => [e.entry, e.kind, e.by, e.byName, e.revision, e.steps]),
      [
        [3, "published", null, null, 2, 2],
        [2, "draft", "writer", "Writer", null, 2],
        [1, "published", null, null, 1, 2],
      ],
    );
    assert.equal(drawingOf(repo, 2).nodes[0]?.label, "B");
  }));

test("restoring makes an entry the draft and never what runs", () =>
  withRepo((repo) => {
    repo.saveDraft("f", null, named("A"));
    repo.publish("f", 1, null, authorize);
    repo.saveDraft("f", 2, named("B"));
    const doc = repo.saveDraft("f", 3, drawingOf(repo, 1), undefined, {
      by: null,
      kind: "restored",
      restoredFrom: 1,
    });
    // The same drawing as what runs: no draft waits, and what runs is still revision 1.
    assert.equal(doc.publishedRevision, 1);
    assert.equal(doc.draft, null);
    repo.saveDraft("f", 4, named("C"));
    const back = drawingOf(repo, 2);
    const again = repo.saveDraft("f", 5, back, undefined, { by: null, kind: "restored", restoredFrom: 2 });
    assert.deepEqual(again.draft, back);
    assert.equal(again.publishedRevision, 1);
    assert.deepEqual(
      repo.history.list("f", none).map((e) => [e.entry, e.kind, e.restoredFrom]),
      [
        [5, "restored", 2],
        [4, "draft", null],
        [3, "restored", 1],
        [2, "draft", null],
        [1, "published", null],
      ],
    );
  }));

test("history keeps the last entries per Flow, and published ones a run still points at", () =>
  withRepo((repo) => {
    repo.saveDraft("f", null, named("ran"));
    repo.publish("f", 1, null, authorize);
    assert.equal(repo.admit("f", "e1", { text: "hi" }, new Date("2026-01-01T00:00:00Z"), authorize).state, "pending");
    let version = 2;
    for (let i = 0; i < FLOW_HISTORY_KEEP + 10; i++)
      version = repo.saveDraft("f", version, named(`v${i}`)).draftVersion ?? 0;
    const list = repo.history.list("f", none);
    assert.equal(list.length, FLOW_HISTORY_KEEP + 1);
    assert.equal(list[0]?.entry, FLOW_HISTORY_KEEP + 11);
    // The run's revision keeps its entry past the bound.
    assert.deepEqual(list.at(-1) && [list.at(-1)?.entry, list.at(-1)?.kind, list.at(-1)?.revision], [
      1,
      "published",
      1,
    ]);
  }));
