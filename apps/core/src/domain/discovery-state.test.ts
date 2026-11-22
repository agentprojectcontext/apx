import assert from "node:assert/strict";
import { test } from "node:test";
import { createBus } from "../bus.ts";
import { openDb } from "../db/db.ts";
import { tempDir } from "../testkit/platform.ts";
import { discoveryState } from "./discovery-state.ts";
import { seed } from "./seed.ts";
import { createStore } from "./store.ts";

const AT = "2026-05-01T12:00:00.000Z";

test("discovery is opt-in, validates public sources and protects stale settings", async () => {
  const dir = tempDir("apx-discovery-");
  const db = openDb(dir.path);
  const store = createStore(db, createBus());
  seed(store, "Nova");
  const state = discoveryState(store, () => new Date(AT));
  try {
    const initial = store.settings.read("discovery");
    assert.equal(initial.enabled, false);
    assert.equal(initial.deep_every_days, 2);
    assert.equal(initial.report_routine, null);
    assert.deepEqual(initial.interests, []);
    assert.equal(initial.location, "");
    state.configure({ interests: ["Open-source software"] }, initial);
    assert.throws(() => state.configure({ enabled: true }, initial), /changed/);
    for (const url of [
      "http://example.com/",
      "https://user:password@example.com/",
      "https://example.com/?token=private",
    ]) {
      assert.throws(() => state.configure({ sources: [{ label: "Acme", public_terms: "", pages: [url] }] }));
    }
    assert.throws(() => state.configure({ timezone: "Not/AZone" }));
    assert.throws(() => state.configure({ report_routine: "missing" }), /global report/);
    assert.equal(store.settings.read("discovery").enabled, false);
    assert.deepEqual(store.settings.read("discovery").interests, ["Open-source software"]);
  } finally {
    db.close();
    await dir.remove();
  }
});

test("authorization revocation purges evidence but retains cooldown and muted topics", async () => {
  const dir = tempDir("apx-discovery-");
  const db = openDb(dir.path);
  const store = createStore(db, createBus());
  seed(store, "Nova");
  const state = discoveryState(store, () => new Date(AT));
  try {
    const initial = state.read();
    state.write({
      ...initial,
      coverage: { missing: { reviewed_at: AT } },
      muted: ["muted-topic"],
      seen: [{ topic: "recent-topic", at: AT }],
      inaccessible: [{ url: "https://example.com/", reason: "Unavailable", kind: "unreadable" }],
    });
    state.configure({ enabled: false });
    assert.deepEqual(state.read().coverage, {});
    assert.deepEqual(state.read().findings, []);
    assert.deepEqual(state.read().inaccessible, []);
    assert.deepEqual(state.read().muted, ["muted-topic"]);
    assert.deepEqual(state.read().seen, [{ topic: "recent-topic", at: AT }]);
    assert.equal(state.allowed("missing"), false);
    assert.throws(() => state.feedback("missing", "useful"), /finding/);
    store.settings.set("discovery_runtime", "{bad json");
    assert.equal(state.read().state, "uncertain");
    assert.ok(Date.parse(state.read().next) > Date.parse(AT), "corrupt state cannot replay research or report claims");
  } finally {
    db.close();
    await dir.remove();
  }
});
