import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { AGENT_NAMES, SUPER_AGENT_ID } from "@apx/protocol";
import { createBus } from "../bus.ts";
import { testConfig } from "../config.ts";
import { openDb } from "../db/db.ts";
import { createCore } from "../server.ts";
import { removeDir, tempDir } from "../testkit/platform.ts";
import { HOME_THREAD_ID, seed } from "./seed.ts";
import { createStore } from "./store.ts";

test("a fresh install names its super-agent from the list, unless the install says which name", async () => {
  for (const agentName of [undefined, "Ada"]) {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "apx-seed-"));
    const core = await createCore(testConfig({ home, agentName }), { quiet: true });
    const boss = core.store.agents.list().find((a) => a.kind === "secretary");
    await core.close();
    await removeDir(home);
    if (agentName) assert.equal(boss?.name, agentName);
    else assert.ok((AGENT_NAMES as readonly string[]).includes(boss?.name ?? ""), `unexpected name ${boss?.name}`);
  }
});

test("a fresh install's super-agent gets the super-agent id; an older install keeps the id it has", async () => {
  const dir = tempDir("apx-seed-id-");
  const db = openDb(dir.path);
  try {
    const store = createStore(db, createBus());
    seed(store, "Nova");
    assert.equal(store.agents.list().find((a) => a.kind === "secretary")?.id, SUPER_AGENT_ID);
    assert.deepEqual(store.threads.get(HOME_THREAD_ID)?.agent_ids, [SUPER_AGENT_ID]);
  } finally {
    db.close();
    await dir.remove();
  }
  const old = tempDir("apx-seed-old-");
  const oldDb = openDb(old.path);
  try {
    const store = createStore(oldDb, createBus());
    store.agents.upsert({
      id: "roby",
      name: "Roby",
      role: "personal secretary",
      kind: "secretary",
      blob: "menta",
      browser_profile: "shared",
    });
    seed(store);
    assert.deepEqual(
      store.agents.list().map((a) => a.id),
      ["roby"],
    );
    assert.deepEqual(store.threads.get(HOME_THREAD_ID)?.agent_ids, ["roby"]);
  } finally {
    oldDb.close();
    await old.remove();
  }
});
