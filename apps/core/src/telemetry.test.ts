import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { ExtensionInfo, TelemetryEvent } from "@apx/protocol";
import { ApxClient } from "@apx/protocol/client";
import { loadConfig } from "./config.ts";
import { say, scriptedLlm, startCore } from "./engine/testkit.ts";
import { zipFiles } from "./extensions/zip.test-support.ts";
import { createLog } from "./log.ts";
import { createTelemetry } from "./telemetry.ts";
import { countInstall, countUsage } from "./telemetry-counts.ts";
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
  await env.cleanup();
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
    stats: {
      tokens_in: 10,
      tokens_out: 5,
      runs: 1,
      projects: 2,
      agents: 3,
      channels: 0,
      routines: 1,
      searches: 4,
      extensions: ["gmail@1.2.0"],
    },
  });
  assert.equal(day.update.name.endsWith(`/installs/${id}/days/2026-03-02`), true);
  assert.deepEqual(day.update.fields.tokens_in, { integerValue: "10" });
  assert.deepEqual(day.update.fields.searches, { integerValue: "4" });
  assert.deepEqual(day.update.fields.extensions, { arrayValue: { values: [{ stringValue: "gmail@1.2.0" }] } });
  assert.equal("signins" in day.update.fields, false, "a count that did not happen is left out");
});

test("DO_NOT_TRACK, CI and APX_TELEMETRY=off turn telemetry off", () => {
  assert.equal(loadConfig({}, false).telemetry, TELEMETRY_SINK);
  assert.equal(loadConfig({ DO_NOT_TRACK: "1" }, false).telemetry, undefined);
  assert.equal(loadConfig({ CI: "true" }, false).telemetry, undefined);
  assert.equal(loadConfig({ APX_TELEMETRY: "off" }, false).telemetry, undefined);
  assert.equal(loadConfig({ DO_NOT_TRACK: "0" }, false).telemetry, TELEMETRY_SINK);
  assert.equal(loadConfig({ APX_TELEMETRY: "https://example.com/t" }, false).telemetry, "https://example.com/t");
});

const preview = async () => (await env.client.call("telemetry.get", {})).preview;

test("searches, links and installs are counted only after a yes, and never what was typed or where from", async () => {
  await env.client.call("telemetry.set", { usage: false });
  await env.client.call("telemetry.note", { event: "marketplace_search", results: 3 });
  const widget = await env.client.call("surfaces.show", { name: "orders", title: "Orders", html: "<h1>Orders</h1>" });
  await env.client.call("surfaces.share", { surface: widget.id, shared: true });
  await env.client.call("surfaces.share", { surface: widget.id, shared: false });
  assert.equal((await preview()).searches, undefined, "nothing is kept before a yes");
  assert.equal((await preview()).public_links, undefined);

  await env.client.call("telemetry.set", { usage: true });
  await env.client.call("telemetry.note", { event: "marketplace_search", results: 3 });
  await env.client.call("telemetry.note", { event: "marketplace_search", results: 0 });
  await env.client.call("surfaces.share", { surface: widget.id, shared: true });
  await env.client.call("surfaces.share", { surface: widget.id, shared: true });
  const manifest = {
    id: "billing",
    name: "Northwind Billing",
    version: "1.0.0",
    description: "Invoices and payments.",
    mcp: { service: { command: "npx", args: ["-y", "mcp-remote", "https://mcp.billing.example.com"] } },
  };
  const data = zipFiles({ "apx-extension.json": JSON.stringify(manifest) }).toString("base64");
  await env.client.call("extensions.install", { file: { name: "billing.apxext", data } });
  const counted = await preview();
  assert.equal(counted.searches, 2);
  assert.equal(counted.searches_empty, 1);
  assert.equal(counted.public_links, 1, "sharing an already shared widget makes no new link");
  assert.equal(counted.installs_file, 1);
  assert.equal(counted.extensions, undefined, "a file's extension goes only as a count");
  assert.doesNotMatch(JSON.stringify(counted), /billing|Northwind|orders/i);

  const agent = new ApxClient({ url: env.core.url, actor: "agent" });
  await assert.rejects(
    agent.call("telemetry.note", { event: "marketplace_search", results: 1 }),
    /reserved to the owner/,
  );
  await env.client.call("telemetry.set", { usage: false });
  const dropped = await preview();
  assert.equal(dropped.searches, undefined, "a no drops what was not sent yet");
  assert.equal(dropped.installs_file, undefined);
});

test("an install's id goes along only when a public catalog lists it", async () => {
  const store = env.core.store;
  await env.client.call("telemetry.set", { usage: true });
  const info = (provenance: "official" | "third_party", version = "1.2.0") =>
    ({ id: "gmail", version, provenance }) as ExtensionInfo;
  countInstall(store, { url: "https://marketplace.example.com/gmail.apxext" }, info("official"), false);
  countInstall(store, { entry: { catalog: "c1", id: "gmail" } }, info("third_party"), true);
  countInstall(store, { entry: { catalog: "c2", id: "gmail" } }, info("third_party", "1.0.0"), false);
  countInstall(store, { url: "https://example.com/private.apxext" }, info("third_party"), false);
  countInstall(store, { path: "/tmp/acme" }, info("third_party"), false);
  countInstall(store, { server: { name: "Acme", url: "https://mcp.example.com" } }, info("third_party"), false);
  countInstall(store, { url: "https://marketplace.example.com/gmail.apxext" }, info("official", "1.0 beta"), false);
  const p = await preview();
  assert.deepEqual(
    [p.installs_official, p.installs_catalog, p.installs_url, p.installs_folder, p.installs_server],
    [2, 2, 1, 1, 1],
  );
  assert.deepEqual(p.extensions, ["gmail@1.2.0", "gmail@1.2.0", "gmail"]);
  await env.client.call("telemetry.set", { usage: false });
});

test("a day's report carries the counts once and keeps what was counted while it was on its way", async () => {
  let at = new Date("2026-04-01T10:00:00Z");
  const events: TelemetryEvent[] = [];
  const store = env.core.store;
  const t = createTelemetry({
    home: env.home,
    store,
    log: createLog("test", true),
    version: "2.0.0",
    channel: "test",
    sink: async (e) => {
      if (e.kind === "usage") countUsage(store, "signins");
      events.push(e);
    },
    now: () => at,
  });
  t.set(true);
  await t.flush();
  countUsage(store, "signins");
  countUsage(store, "public_artifacts");
  countInstall(
    store,
    { url: "https://marketplace.example.com/gmail.apxext" },
    {
      id: "gmail",
      version: "1.2.0",
      provenance: "official",
    } as ExtensionInfo,
    false,
  );
  at = new Date("2026-04-02T09:00:00Z");
  await t.flush();
  const report = events.findLast((e) => e.kind === "usage");
  assert.ok(report?.kind === "usage");
  assert.equal(report.stats.signins, 1);
  assert.equal(report.stats.public_artifacts, 1);
  assert.deepEqual(report.stats.extensions, ["gmail@1.2.0"]);
  const next = t.get().preview;
  assert.equal(next.signins, 1, "the sign-in counted while the report was sent waits for the next one");
  assert.equal(next.public_artifacts, undefined);
  assert.equal(next.extensions, undefined);
  t.set(false);
});
