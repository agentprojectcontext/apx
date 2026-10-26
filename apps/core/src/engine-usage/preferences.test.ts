import assert from "node:assert/strict";
import { test } from "node:test";
import { createBus } from "../bus.ts";
import { openDb } from "../db/db.ts";
import { createStore } from "../domain/store.ts";
import { createEngineUsage } from "../harness/engine-usage.ts";
import { tempDir } from "../testkit/platform.ts";
import { usagePreferences } from "./preferences.ts";

test("quotas default off except a linked ChatGPT plan; opt-out survives linking and reload", async () => {
  await using home = tempDir();
  const db = openDb(home.path);
  try {
    const store = createStore(db, createBus());
    let linked = false;
    let probes = 0;
    const reader = (enabled: (id: string) => boolean) =>
      createEngineUsage({
        status: async () =>
          ["codex", "claude", "acp:opencode"].map((id) => ({
            id,
            label: id,
            installed: true,
            logged_in: true,
            default: false,
          })),
        enabled,
        binary: async () => "fixture",
        read: async () => {
          probes++;
          return [{ id: "primary", used_percent: 12 }];
        },
      });
    const prefs = usagePreferences(store.settings, reader, () => linked);
    assert.deepEqual((await prefs.read()).engines, []);
    assert.equal(probes, 0);
    linked = true;
    assert.deepEqual(
      (await prefs.read()).engines.map((e) => e.id),
      ["codex"],
    );
    assert.equal(probes, 1);
    await prefs.read();
    assert.equal(probes, 1);
    prefs.set("codex", false);
    assert.deepEqual((await prefs.read()).engines, []);
    assert.equal(probes, 1);
    linked = false;
    linked = true;
    const reloaded = usagePreferences(store.settings, reader, () => linked);
    assert.equal(reloaded.get().engines.codex, false);
    assert.deepEqual((await reloaded.read()).engines, []);
    prefs.set("acp:opencode", true);
    assert.deepEqual(
      (await prefs.read()).engines.map((e) => [e.id, e.reason]),
      [["acp:opencode", "unsupported"]],
    );
    prefs.set("codex", true);
    assert.equal((await prefs.read()).engines.find((e) => e.id === "codex")?.windows[0]?.used_percent, 12);
    assert.equal(probes, 2);
  } finally {
    db.close();
  }
});

test("turning usage off while a probe is pending cannot expose its result", async () => {
  await using home = tempDir();
  const db = openDb(home.path);
  try {
    const store = createStore(db, createBus());
    const done = Promise.withResolvers<void>();
    const prefs = usagePreferences(
      store.settings,
      (enabled) =>
        createEngineUsage({
          status: async () => [{ id: "codex", label: "Codex", installed: true, logged_in: true, default: false }],
          enabled,
          binary: async () => "fixture",
          read: async () => {
            await done.promise;
            return [{ id: "primary", used_percent: 25 }];
          },
        }),
      () => true,
    );
    const pending = prefs.read();
    prefs.set("codex", false);
    done.resolve();
    assert.deepEqual((await pending).engines, []);
    assert.deepEqual((await prefs.read()).engines, []);
  } finally {
    db.close();
  }
});
