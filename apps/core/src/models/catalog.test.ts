import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { createBus } from "../bus.ts";
import type { ProviderConfig } from "../config.ts";
import { openDb } from "../db/db.ts";
import { createStore } from "../domain/store.ts";
import { createSecrets } from "../secrets.ts";
import { createCatalog } from "./catalog.ts";

test("the catalog asks each engine for its models, caches them and keeps the last good list on failure", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "apx2-catalog-"));
  const db = openDb(home);
  try {
    const store = createStore(db, createBus());
    const secrets = createSecrets(home, "file", {});
    secrets.set("g", "key");
    const providers: ProviderConfig[] = [
      { id: "g", transport: "openai-chat", base_url: "http://g.test", key: "secret://g", models: [] },
      { id: "nokey", transport: "openai-chat", base_url: "http://n.test", key: "secret://none", models: [] },
    ];
    let up = true;
    let calls = 0;
    const catalog = createCatalog({
      store,
      secrets,
      providers,
      fetchImpl: (async () => {
        calls++;
        if (!up) return new Response("down", { status: 503 });
        return new Response(JSON.stringify({ data: [{ id: "models/g-pro" }, { id: "models/g-embedding-1" }] }));
      }) as unknown as typeof fetch,
      harnessLists: {
        claude: async () => [{ id: "claude-x", name: "Claude X", chat: true }],
        codex: async () => {
          throw new Error("not installed");
        },
      },
    });
    const first = await catalog.list();
    const g = first.find((e) => e.id === "g");
    assert.deepEqual(
      g?.models.map((m) => [m.id, m.chat]),
      [
        ["g-pro", true],
        ["g-embedding-1", false],
      ],
    );
    assert.equal(first.find((e) => e.id === "claude")?.models[0]?.id, "claude-x");
    assert.equal(first.find((e) => e.id === "codex")?.available, false);
    assert.match(first.find((e) => e.id === "nokey")?.detail ?? "", /no key/);
    await catalog.list();
    assert.equal(calls, 1, "served from the cache");
    up = false;
    const stale = await catalog.list(true);
    assert.equal(stale.find((e) => e.id === "g")?.models.length, 2);
    assert.match(stale.find((e) => e.id === "g")?.detail ?? "", /could not refresh/);
  } finally {
    db.close();
    fs.rmSync(home, { recursive: true, force: true });
  }
});
