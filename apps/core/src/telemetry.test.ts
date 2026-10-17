import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { TelemetryEvent } from "@apx/protocol";
import { loadConfig } from "./config.ts";
import { say, scriptedLlm, startCore } from "./engine/testkit.ts";
import { createLog } from "./log.ts";
import { createTelemetry } from "./telemetry.ts";
import { firestoreWrite, TELEMETRY_SINK, type TelemetrySink } from "./telemetry-sink.ts";

let env: Awaited<ReturnType<typeof startCore>>;
const sent: TelemetryEvent[] = [];
let down = false;
const recorder: TelemetrySink = async (e) => {
  if (down) throw new Error("offline");
  sent.push(e);
};
const stages = () => sent.flatMap((e) => (e.kind === "stage" ? [e.stage] : []));

before(async () => {
  env = await startCore({ llm: scriptedLlm(() => say("ok")), telemetrySink: recorder });
});
after(async () => {
  await env.core.close();
  env.cleanup();
});

test("an install reports each lifecycle step once, in order, and a failed one is tried again", async () => {
  down = true;
  await env.core.telemetry.flush();
  assert.deepEqual(stages(), [], "nothing lands while offline");
  down = false;
  await env.core.telemetry.flush();
  assert.deepEqual(stages(), ["installed"]);

  await env.client.call("telemetry.seen", {});
  await env.core.telemetry.flush();
  await env.client.call("telemetry.set", { usage: false });
  await env.core.telemetry.flush();
  env.core.store.settings.set("setup_done", "1");
  await env.client.call("threads.send", { thread: "home", text: "hello" });
  await env.core.telemetry.flush();
  await env.core.telemetry.flush();
  assert.deepEqual(stages(), ["installed", "opened", "consent", "setup", "first_run"]);

  const consent = sent.find((e) => e.kind === "stage" && e.stage === "consent");
  assert.equal(consent?.kind === "stage" && consent.usage, false);
  const state = await env.client.call("telemetry.get", {});
  assert.equal(state.enabled, true);
  assert.equal(state.usage, false);
  assert.deepEqual(Object.keys(state.sent).sort(), ["consent", "first_run", "installed", "opened", "setup"]);
  assert.match(state.install_id, /^[0-9a-f-]{36}$/);
  assert.notEqual(state.install_id, (await env.client.call("system.health", {})).home_id, "its own id, not the home's");
  // Changing the answer reaches the record again; no usage report without a yes.
  await env.client.call("telemetry.set", { usage: true });
  await env.core.telemetry.flush();
  assert.equal(stages().filter((s) => s === "consent").length, 2);
  assert.equal(
    sent.some((e) => e.kind === "usage"),
    false,
  );
});

test("usage goes once a day after the owner's yes, never counting the day it was given", async () => {
  let at = new Date("2026-03-01T10:00:00Z");
  const events: TelemetryEvent[] = [];
  const t = createTelemetry({
    home: env.home,
    store: env.core.store,
    log: createLog("test", true),
    version: "2.0.0",
    channel: "test",
    sink: async (e) => {
      events.push(e);
    },
    now: () => at,
  });
  t.set(false);
  t.set(true);
  await t.flush();
  assert.equal(
    events.some((e) => e.kind === "usage"),
    false,
    "nothing on the day of the yes",
  );
  at = new Date("2026-03-02T09:00:00Z");
  await t.flush();
  await t.flush();
  const usage = events.filter((e) => e.kind === "usage");
  assert.equal(usage.length, 1);
  const report = usage[0];
  assert.ok(report?.kind === "usage");
  assert.equal(report.day, "2026-03-02");
  assert.deepEqual(Object.keys(report.stats).sort(), [
    "agents",
    "channels",
    "projects",
    "routines",
    "runs",
    "tokens_in",
    "tokens_out",
  ]);
  // Only numbers leave: no names, models, paths or text.
  for (const v of Object.values(report.stats)) assert.equal(typeof v, "number");
  t.set(false);
  at = new Date("2026-03-03T09:00:00Z");
  await t.flush();
  assert.equal(events.filter((e) => e.kind === "usage").length, 1, "a no stops the reports");
});

test("a new version sends `updated` once; no sink sends nothing", async () => {
  const events: TelemetryEvent[] = [];
  const base = { home: env.home, store: env.core.store, log: createLog("test", true), channel: "test" as const };
  const next = createTelemetry({ ...base, version: "99.0.0", sink: async (e) => void events.push(e) });
  await next.flush();
  await next.flush();
  assert.deepEqual(
    events.map((e) => e.kind === "stage" && e.stage),
    ["updated"],
  );
  const off = createTelemetry({ ...base, version: "99.1.0", sink: undefined });
  await off.flush();
  assert.equal(off.get().enabled, false);
});

test("the Firestore write creates the record once and then only stamps steps", () => {
  const info = { version: "2.1.0", os: "darwin", arch: "arm64", channel: "app" as const };
  const id = "6f1c2b9e-1d2a-4c3b-8e4f-5a6b7c8d9e0f";
  const created = firestoreWrite("demo", { kind: "stage", install_id: id, stage: "installed", info });
  assert.deepEqual(created.currentDocument, { exists: false });
  assert.equal(created.update.name, `projects/demo/databases/(default)/documents/installs/${id}`);
  assert.deepEqual(
    created.updateTransforms.map((t) => t.fieldPath),
    ["created", "updated_at", "stages.installed"],
  );
  const opened = firestoreWrite("demo", { kind: "stage", install_id: id, stage: "opened", info, usage: true });
  assert.deepEqual(opened.currentDocument, { exists: true });
  assert.deepEqual(opened.updateMask?.fieldPaths, ["version", "os", "arch", "channel", "usage"]);
  const day = firestoreWrite("demo", {
    kind: "usage",
    install_id: id,
    day: "2026-03-02",
    version: "2.1.0",
    stats: { tokens_in: 10, tokens_out: 5, runs: 1, projects: 2, agents: 3, channels: 0, routines: 1 },
  });
  assert.equal(day.update.name.endsWith(`/installs/${id}/days/2026-03-02`), true);
  assert.deepEqual(day.update.fields.tokens_in, { integerValue: "10" });
});

test("DO_NOT_TRACK, CI and APX_TELEMETRY=off turn telemetry off", () => {
  assert.equal(loadConfig({}, false).telemetry, TELEMETRY_SINK);
  assert.equal(loadConfig({ DO_NOT_TRACK: "1" }, false).telemetry, undefined);
  assert.equal(loadConfig({ CI: "true" }, false).telemetry, undefined);
  assert.equal(loadConfig({ APX_TELEMETRY: "off" }, false).telemetry, undefined);
  assert.equal(loadConfig({ DO_NOT_TRACK: "0" }, false).telemetry, TELEMETRY_SINK);
  assert.equal(loadConfig({ APX_TELEMETRY: "https://example.com/t" }, false).telemetry, "https://example.com/t");
});
