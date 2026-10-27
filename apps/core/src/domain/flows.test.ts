import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { openDb } from "../db/db.ts";
import { receiveFlowEvent, saveFlow } from "./flows.ts";

test("flow writes and deduplicates atomically across database reopen", () => {
  const home = mkdtempSync(path.join(tmpdir(), "apx-flow-"));
  try {
    let db = openDb(home);
    db.prepare("INSERT INTO projects(id,name,created_at) VALUES ('p','Project','now'), ('q','Other','now')").run();
    const flow = {
      id: "f",
      projectId: "p",
      enabled: true,
      predicates: [{ path: ["type"], equals: "work" }],
      tableKey: "inbox",
    };
    saveFlow(db, flow);
    assert.throws(() => saveFlow(db, { ...flow, projectId: "q" }), /another project/);
    assert.equal(receiveFlowEvent(db, "f", "empty", {}), "ignored");
    assert.equal(receiveFlowEvent(db, "f", "other", { type: "other" }), "ignored");
    assert.equal(receiveFlowEvent(db, "f", "one", { type: "work", value: 1 }), "written");
    db.close();
    db = openDb(home);
    assert.equal(receiveFlowEvent(db, "f", "one", { type: "work", value: 2 }), "duplicate");
    const row = db.prepare("SELECT value FROM flow_rows WHERE flow_id='f' AND key='inbox'").get() as { value: string };
    assert.deepEqual(JSON.parse(row.value), { type: "work", value: 1 });
    assert.equal(db.prepare("SELECT count(*) AS n FROM flow_events").get()?.n, 3);
    saveFlow(db, { ...flow, enabled: false });
    assert.throws(() => receiveFlowEvent(db, "f", "two", {}), /disabled/);
    db.close();
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
