import assert from "node:assert/strict";
import { test } from "node:test";
import { openDb } from "../db/db.ts";
import { tempDir } from "../testkit/platform.ts";
import { FlowCapacityError, flowsRepo } from "./flows.ts";

const flow = {
  id: "f",
  projectId: "p",
  name: "Inbox",
  enabled: true,
  predicates: [],
  tableKey: "latest",
  readKeys: ["config"],
  action: { kind: "agent" as const, agent: "roby", prompt: "Handle event" },
};

test("deterministic reads are snapshotted before the write and bindings survive later edits", async () => {
  const temp = tempDir();
  const db = openDb(temp.path);
  try {
    db.prepare("INSERT INTO projects(id,name,created_at) VALUES ('p','Project','now')").run();
    const repo = flowsRepo(db);
    repo.save(flow);
    repo.write(flow.id, "config", { greeting: "Hello" });
    assert.equal(repo.receive(flow.id, "one", { text: "Work" }), "pending");
    repo.write(flow.id, "config", { greeting: "Changed" });
    repo.save({ ...flow, action: { ...flow.action, agent: "other" } });
    assert.deepEqual(repo.pending()[0]?.payload, {
      event: { text: "Work" },
      rows: [{ key: "config", value: { greeting: "Hello" } }],
    });
    assert.deepEqual(repo.pending()[0]?.action, flow.action);
    assert.deepEqual(repo.rows(flow.id, 10), [
      { key: "config", value: { greeting: "Changed" } },
      { key: "latest", value: { text: "Work" } },
    ]);
  } finally {
    db.close();
    await temp.remove();
  }
});

test("queue admission is bounded, rolls back its table write, and duplicates remain accepted at capacity", async () => {
  const temp = tempDir();
  const db = openDb(temp.path);
  try {
    db.prepare("INSERT INTO projects(id,name,created_at) VALUES ('p','Project','now')").run();
    const repo = flowsRepo(db);
    repo.save({ ...flow, readKeys: [] });
    for (let i = 0; i < 32; i++) assert.equal(repo.receive(flow.id, `e-${i}`, { n: i }), "pending");
    assert.equal(repo.receive(flow.id, "e-0", { n: 999 }), "duplicate");
    assert.throws(() => repo.receive(flow.id, "overflow", { n: 999 }), FlowCapacityError);
    assert.deepEqual(repo.rows(flow.id, 1), [{ key: "latest", value: { n: 31 } }]);
    assert.equal(repo.events(flow.id, 100).length, 32);
    repo.save({ ...flow, enabled: false });
    assert.equal(repo.pending().length, 0);
    assert.throws(() => repo.receive(flow.id, "disabled", {}), /disabled/);
    assert.throws(() => repo.write(flow.id, "too-big", "x".repeat(32769)), /32 KiB/);
    assert.throws(() => repo.write(flow.id, "bad", undefined), /32 KiB/);
    assert.throws(() => repo.admitted(flow.id, "missing", "run"), /no longer pending/);
  } finally {
    db.close();
    await temp.remove();
  }
});

test("a full page of blocked events does not hide later pending work", async () => {
  const temp = tempDir();
  const db = openDb(temp.path);
  try {
    db.prepare("INSERT INTO projects(id,name,created_at) VALUES ('p','Project','now')").run();
    const repo = flowsRepo(db);
    repo.save({ ...flow, readKeys: [] });
    for (let i = 0; i < 25; i++) repo.receive(flow.id, `e-${i}`, { n: i });
    const first = repo.pending(20);
    assert.equal(first.length, 20);
    const second = repo.pending(20, first.at(-1)?.cursor);
    assert.equal(second.length, 5);
    assert.equal(second.at(-1)?.event, "e-24");
  } finally {
    db.close();
    await temp.remove();
  }
});
