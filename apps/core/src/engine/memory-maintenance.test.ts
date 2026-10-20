import assert from "node:assert/strict";
import { test } from "node:test";
import { openDb } from "../db/db.ts";
import { qb, sql } from "../domain/sql.ts";
import { createLog } from "../log.ts";
import type { MemoryIndex } from "./memory-index.ts";
import { createMemoryMaintenance } from "./memory-maintenance.ts";
import { say, scriptedLlm, startCore } from "./testkit.ts";
import { createUpkeep } from "./upkeep.ts";

test("discarded owner messages keep scan checkpoints without creating empty capture jobs", async () => {
  const llm = scriptedLlm(() => say("ok"));
  const env = await startCore({ llm, aux: true, memoryMaintenance: true });
  try {
    await env.client.call("memory.set_settings", {
      mode: "notes",
      skill_picker: false,
      auto_compact: false,
      auto_dream: false,
    });
    const thread = await env.client.call("threads.create", { kind: "loose", agent_id: "roby" });
    for (const text of ["ok", "Buenas noches!!!", "Do not keep this password discussion."]) {
      await env.client.call("threads.send", { thread: thread.id, text });
      await env.settle(thread.id);
    }
    assert.equal((await env.client.call("memory.maintenance", { backfill: true })).queued, 0);
    assert.equal(env.core.store.memoryWork.uncheckedEpisodes(100).length, 0);
    assert.deepEqual((await env.client.call("memory.status", {})).jobs, []);
    assert.equal(
      llm.calls.some((call) => String(call.messages[0]?.content).startsWith("Extract durable")),
      false,
    );
  } finally {
    await env.core.close();
    env.cleanup();
  }
});

test("episode, capture, dream and its timestamp roll back together before indexing starts", async () => {
  const llm = scriptedLlm(() => say("ok"));
  const env = await startCore({ llm });
  const store = env.core.store;
  const log = createLog("memory-test", true);
  const upkeep = createUpkeep({ store, llm, log });
  let scheduled = 0;
  const index: MemoryIndex = {
    model: () => undefined,
    engine: () => undefined,
    schedule() {
      scheduled++;
    },
    stop: async () => {},
    index: async () => ({ indexed: 0, total: 0 }),
    search: async () => [],
    searchEpisodes: async () => [],
  };
  const maintenance = createMemoryMaintenance({
    store,
    upkeep,
    index,
    log,
    call: async () => {
      throw new Error("unexpected internal call");
    },
  });
  const set = store.settings.set;
  const dreamKey = "memory_dream:roby:";
  try {
    const thread = await env.client.call("threads.create", { kind: "loose", agent_id: "roby" });
    await env.client.call("threads.send", { thread: thread.id, text: "Northwind archives use violet labels." });
    await env.settle(thread.id);
    const run = store.runs.list(thread.id, 1)[0];
    assert.ok(run);
    const db = openDb(env.home);
    try {
      const q = sql(db);
      q.run(qb.deleteFrom("memory_work"));
      q.run(qb.deleteFrom("memory_episodes"));
      q.run(qb.deleteFrom("memory_episode_scans"));
    } finally {
      db.close();
    }
    store.settings.write("memory", { auto_capture: true, auto_dream: true });
    set(dreamKey, "");
    store.settings.set = (key, value) => {
      if (key === dreamKey) throw new Error("timestamp write failed");
      set(key, value);
    };
    assert.throws(() => maintenance.afterRun(run), /timestamp write failed/);
    assert.equal(store.memoryWork.searchEpisodes("Northwind", [thread.id]).length, 0);
    assert.ok(store.memoryWork.uncheckedEpisodes(100).includes(run.id));
    assert.deepEqual(store.memoryWork.recent(), []);
    assert.equal(scheduled, 0);
    store.settings.set = set;
    maintenance.afterRun(run);
    assert.equal(store.memoryWork.searchEpisodes("Northwind", [thread.id]).length, 1);
    assert.equal(store.memoryWork.uncheckedEpisodes(100).includes(run.id), false);
    assert.deepEqual(
      store.memoryWork
        .recent()
        .map((job) => job.kind)
        .sort(),
      ["capture", "dream"],
    );
    assert.ok(store.settings.get(dreamKey));
    assert.equal(scheduled, 1);
  } finally {
    store.settings.set = set;
    await maintenance.stop();
    await upkeep.stop();
    await env.core.close();
    env.cleanup();
  }
});
