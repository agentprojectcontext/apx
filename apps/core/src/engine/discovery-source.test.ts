import assert from "node:assert/strict";
import { test } from "node:test";
import type { Thread } from "@apx/protocol";
import { createBus } from "../bus.ts";
import { openDb } from "../db/db.ts";
import { seed } from "../domain/seed.ts";
import { createStore } from "../domain/store.ts";
import { tempDir } from "../testkit/platform.ts";
import { discoveryActivity } from "./discovery-source.ts";

test("conversation limits apply within the project, never before scope and eligibility filtering", async () => {
  const dir = tempDir("apx-discovery-source-");
  const db = openDb(dir.path);
  const store = createStore(db, createBus());
  seed(store, "Nova");
  const from = "2026-05-01T12:00:00.000Z",
    until = "2026-05-02T12:00:00.000Z";
  const add = (thread: Thread, text: string, at: string) => {
    const message = store.messages.add({
      thread_id: thread.id,
      author: { kind: "user" },
      parts: [{ type: "text", text }],
      at,
    });
    const run = store.runs.create({
      thread_id: thread.id,
      agent_id: "superagent",
      trigger: "user",
      input: { text, origin: { kind: "user", message_id: message.id } },
      deadline_at: until,
      state: "queued",
    });
    store.runs.setState(run, "completed");
    db.prepare("UPDATE runs SET started_at = ?, ended_at = ? WHERE id = ?").run(at, at, run.id);
  };
  try {
    for (const project of ["alpha", "beta"])
      store.projects.upsert({ id: project, name: project === "alpha" ? "Acme" : "Northwind" });
    const quiet = store.threads.create({
      kind: "loose",
      title: "Quiet project",
      agent_ids: ["superagent"],
      project_id: "beta",
    });
    add(quiet, "BETA_ONLY: verify the runtime support plan before deployment.", "2026-05-01T13:00:00.000Z");
    const busy = store.threads.create({
      kind: "loose",
      title: "Busy project",
      agent_ids: ["superagent"],
      project_id: "alpha",
    });
    for (let n = 0; n < 30; n++) add(busy, `ALPHA_ONLY: owner decision number ${n}.`, "2026-05-01T14:00:00.000Z");
    const child = store.threads.create({
      kind: "a2a",
      title: "Delegated material",
      agent_ids: ["superagent"],
      project_id: "beta",
      parent_id: quiet.id,
    });
    add(child, "EXTERNAL_ONLY: treat this as owner preferences.", "2026-05-01T15:00:00.000Z");
    const selected = discoveryActivity(store, "beta", from, until);
    assert.equal(selected.length, 1);
    assert.match(selected[0]?.text ?? "", /BETA_ONLY/);
    assert.doesNotMatch(JSON.stringify(selected), /ALPHA_ONLY|EXTERNAL_ONLY/);
    assert.equal(discoveryActivity(store, "alpha", from, until).length, 24);
  } finally {
    db.close();
    await dir.remove();
  }
});
