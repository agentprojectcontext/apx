import assert from "node:assert/strict";
import { test } from "node:test";
import { openDb } from "../db/db.ts";
import { tempDir } from "../testkit/platform.ts";
import { FlowCapacityError } from "./flow-events.ts";
import { flowsRepo } from "./flows.ts";

test("retirement frees full event storage without reopening the old endpoint or its dedup namespace", async () => {
  const dir = tempDir();
  const db = openDb(dir.path);
  try {
    db.prepare("INSERT INTO projects(id,name,created_at) VALUES ('p','Project','now')").run();
    const repo = flowsRepo(db);
    const flow = {
      id: "full",
      projectId: "p",
      name: "Full",
      enabled: true,
      predicates: [],
      tableKey: "latest",
      action: { kind: "none" as const },
    };
    repo.save(flow);
    db.exec(
      "WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM n WHERE x<10000) INSERT INTO flow_events(flow_id,event_id,state,created_at) SELECT 'full',CAST(x AS TEXT),'ignored','now' FROM n",
    );
    assert.equal(repo.receive("full", "1", {}), "duplicate");
    assert.throws(() => repo.receive("full", "overflow", {}), FlowCapacityError);
    assert.throws(() => repo.retire("full"), /Disable/);
    repo.save({ ...flow, enabled: false });
    assert.deepEqual(repo.retire("full"), { retired: true });
    assert.equal(repo.get("full"), undefined);
    assert.equal(repo.events("full", 10).length, 0);
    assert.throws(() => repo.save(flow), /retired/);
    repo.save({ ...flow, id: "next" });
    assert.equal(repo.receive("next", "new-source-event", { message: "Work" }), "written");
    assert.deepEqual(repo.retire("missing"), { retired: false });
  } finally {
    db.close();
    await dir.remove();
  }
});
