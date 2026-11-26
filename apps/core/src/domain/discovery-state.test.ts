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

const routine = (store: ReturnType<typeof createStore>, name: string, origin?: string) =>
  store.routines.create({
    name,
    action: "agent",
    call_model: "always",
    next_run_at: undefined,
    agent_id: "superagent",
    enabled: true,
    schedule: { kind: "cron", cron: "0 9 * * *" },
    prompt: name,
    ...(origin ? { origin } : {}),
  });

test("turning research on fills the owner's time zone and their one daily report, keeping what they chose", async () => {
  const dir = tempDir("apx-discovery-");
  const db = openDb(dir.path);
  const store = createStore(db, createBus());
  seed(store, "Nova");
  const state = discoveryState(store, () => new Date(AT));
  try {
    store.settings.write("owner_profile", {
      ...store.settings.read("owner_profile"),
      timezone: "America/Argentina/Cordoba",
    });
    const brief = routine(store, "Morning brief");
    state.prefill();
    const off = store.settings.read("discovery");
    assert.equal(off.enabled, false, "pre-filled, never turned on");
    assert.equal(off.timezone, "America/Argentina/Cordoba");
    assert.equal(off.report_routine, brief.id);
    assert.equal(off.projects, "all");

    state.configure({ report_routine: null, timezone: "UTC" });
    const evening = routine(store, "Evening wrap-up");
    state.configure({ enabled: true });
    assert.equal(store.settings.read("discovery").report_routine, null, "two reports and none the morning brief: none");
    assert.equal(store.settings.read("discovery").timezone, "America/Argentina/Cordoba");

    state.configure({ enabled: false, report_routine: null });
    const morning = routine(store, "Day open", "secretary:day-open");
    state.configure({ enabled: true });
    assert.equal(store.settings.read("discovery").report_routine, morning.id, "the profile's morning brief");

    state.configure({ enabled: false, report_routine: null });
    state.configure({ enabled: true, report_routine: evening.id });
    assert.equal(store.settings.read("discovery").report_routine, evening.id, "what the owner chose wins");
  } finally {
    db.close();
    await dir.remove();
  }
});

test("adding to research keeps what it found and its schedule, and only adds what is new", async () => {
  const dir = tempDir("apx-discovery-");
  const db = openDb(dir.path);
  const store = createStore(db, createBus());
  seed(store, "Nova");
  const state = discoveryState(store, () => new Date(AT));
  try {
    store.projects.upsert({ id: "acme", name: "Acme" });
    assert.throws(() => state.add({ interests: ["Jazz"] }), /off/);
    state.configure({ enabled: true, projects: "selected", project_ids: [], interests: ["Jazz"] });
    const finding = {
      id: "kept",
      topic: "topic",
      title: "Kept",
      summary: "A kept finding.",
      action: "Read it.",
      uncertainty: "None.",
      evidence: [{ url: "https://example.com/", title: "Example", quote: "A quote long enough.", read_at: AT }],
      found_at: AT,
      expires_at: "2026-05-08T12:00:00.000Z",
    };
    state.write({ ...state.read(), findings: [finding], next: "2026-05-02T12:00:00.000Z" });
    const added = state.add({
      interests: ["jazz", "Cine"],
      projects: ["acme"],
      pages: [{ url: "https://example.com/news", label: "Acme news", project: "acme" }],
      location: "Córdoba",
    });
    assert.deepEqual(added, {
      interests: ["Cine"],
      projects: ["acme"],
      pages: [{ url: "https://example.com/news", label: "Acme news" }],
      location: "Córdoba",
    });
    const settings = store.settings.read("discovery");
    assert.deepEqual(settings.interests, ["Jazz", "Cine"]);
    assert.deepEqual(settings.project_ids, ["acme"]);
    assert.deepEqual(settings.sources, [
      { label: "Acme news", public_terms: "", pages: ["https://example.com/news"], project: "acme" },
    ]);
    assert.deepEqual(
      state.read().findings.map((f) => f.id),
      ["kept"],
    );
    assert.equal(state.read().next, "2026-05-02T12:00:00.000Z");
    assert.deepEqual(state.add({ pages: [{ url: "https://example.com/news", label: "Again" }], location: "Córdoba" }), {
      interests: [],
      projects: [],
      pages: [],
    });
    assert.throws(() => state.add({ projects: ["missing"] }), /not found/);
  } finally {
    db.close();
    await dir.remove();
  }
});
