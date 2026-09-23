// A ceiling on what unwatched work may spend in an hour.
//
// 2026-09-23: ~230 a2a turns in under an hour spent three providers before
// anything stopped them — each turn reasonable, the whole of it not. These pin
// the breaker: it counts only unwatched work, trips on the volume, pauses that
// work (never a person's chat), tells the owner once, and can be lifted.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TMP_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "apx-spend-"));
process.env.HOME = TMP_HOME;
process.env.APX_HOME = path.join(TMP_HOME, ".apx");

const { test, beforeEach } = await import("node:test");
const { default: assert } = await import("node:assert/strict");
const {
  noteEngineCall, spendPause, spendState, resumeSpend, onSpendTrip, claimSpendNotice, _resetSpendBreaker,
} = await import("#core/agent/spend-breaker.js");
const { runAgent } = await import("#core/agent/run-agent.js");
const { notifyOwnerSpendPause } = await import("#core/routines/delivery.js");
const { CHANNELS } = await import("#core/constants/channels.js");

beforeEach(() => _resetSpendBreaker());

const cfg = (limits) => ({
  super_agent: { model: "mock:base", model_fallback: { enabled: false }, stuck_detection: { enabled: false }, spend_breaker: limits },
  engines: {},
});

test("only unwatched work is counted, and a person is never paused", () => {
  const config = cfg({ calls_per_hour: 2 });
  for (let i = 0; i < 10; i++) noteEngineCall({ channel: CHANNELS.WEB, config });
  assert.equal(spendState({ config }).calls_last_hour, 0);
  for (let i = 0; i < 3; i++) noteEngineCall({ channel: CHANNELS.ROUTINE, config });
  assert.ok(spendPause({ channel: CHANNELS.ROUTINE }), "routines are paused past the limit");
  assert.ok(spendPause({ channel: CHANNELS.A2A }), "and so is a2a");
  assert.equal(spendPause({ channel: CHANNELS.WEB }), null, "a chat with a person goes on");
  assert.equal(spendPause({ channel: CHANNELS.TELEGRAM }), null);
});

test("a per-project limit pauses that project only", () => {
  const config = cfg({ calls_per_hour: 100, project_calls_per_hour: 2 });
  for (let i = 0; i < 3; i++) noteEngineCall({ channel: CHANNELS.A2A, project: 7, config });
  assert.equal(spendPause({ channel: CHANNELS.A2A, project: 7 }).scope, "project");
  assert.equal(spendPause({ channel: CHANNELS.A2A, project: 8 }), null);
});

test("the window rolls: calls older than an hour do not count", () => {
  const config = cfg({ calls_per_hour: 2 });
  const hourAgo = Date.now() - 61 * 60 * 1000;
  noteEngineCall({ channel: CHANNELS.ROUTINE, config, now: hourAgo });
  noteEngineCall({ channel: CHANNELS.ROUTINE, config, now: hourAgo });
  noteEngineCall({ channel: CHANNELS.ROUTINE, config });
  noteEngineCall({ channel: CHANNELS.ROUTINE, config });
  assert.equal(spendPause({ channel: CHANNELS.ROUTINE }), null);
});

test("the owner is told once per trip, and a resume lifts the pause", () => {
  const config = cfg({ calls_per_hour: 1 });
  const trips = [];
  onSpendTrip((p) => trips.push(p));
  for (let i = 0; i < 5; i++) noteEngineCall({ channel: CHANNELS.ROUTINE, config });
  assert.equal(trips.length, 1, "one trip, not one per call past the limit");
  assert.equal(claimSpendNotice(), true);
  assert.equal(claimSpendNotice(), false);
  assert.ok(resumeSpend());
  assert.equal(spendPause({ channel: CHANNELS.ROUTINE }), null);
  assert.equal(spendState({ config }).calls_last_hour, 0, "the count restarts, or it would trip again at once");
});

test("off switch: enabled false never trips", () => {
  const config = cfg({ enabled: false, calls_per_hour: 1 });
  for (let i = 0; i < 5; i++) noteEngineCall({ channel: CHANNELS.ROUTINE, config });
  assert.equal(spendPause({ channel: CHANNELS.ROUTINE }), null);
});

test("a routine past the limit stops at the engine call; a web turn does not", async () => {
  const config = cfg({ calls_per_hour: 2 });
  const run = (channel) => runAgent({
    globalConfig: config, system: "s", prompt: "hola", toolSchemas: [], makeToolHandlers: () => ({}),
    toolHandlerCtx: { channel },
  });
  await run(CHANNELS.ROUTINE);
  await run(CHANNELS.ROUTINE);
  await assert.rejects(run(CHANNELS.ROUTINE), (e) => e.code === "SPEND_PAUSED");
  const web = await run(CHANNELS.WEB);
  assert.ok(web.text, "the owner's own chat still answers");
});

test("the notice is model-authored, with the owner's-language floor when no model answers", async () => {
  const config = cfg({ calls_per_hour: 1 });
  for (let i = 0; i < 2; i++) noteEngineCall({ channel: CHANNELS.ROUTINE, config });
  const pause = spendPause({ channel: CHANNELS.ROUTINE });
  const sent = [];
  const ctx = {
    plugins: { get: () => ({ send: async (m) => { sent.push(m.text); } }) },
    globalConfig: { ...config, user: { language: "es" } },
  };
  const ok = await notifyOwnerSpendPause(ctx, pause, { callFn: async () => { throw new Error("no model"); } });
  assert.equal(ok, true);
  assert.match(sent[0], /apx usage resume/);
  assert.match(sent[0], /segundo plano/);
  assert.equal(await notifyOwnerSpendPause(ctx, pause, { callFn: async () => ({ text: "x" }) }), false, "once per trip");
});

test("a pause that runs out starts a fresh hour instead of tripping again", () => {
  const config = cfg({ calls_per_hour: 2, pause_min: 1 });
  for (let i = 0; i < 3; i++) noteEngineCall({ channel: CHANNELS.ROUTINE, config });
  assert.ok(spendPause({ channel: CHANNELS.ROUTINE }));
  const later = Date.now() + 2 * 60 * 1000;
  assert.equal(spendPause({ channel: CHANNELS.ROUTINE, now: later }), null);
  noteEngineCall({ channel: CHANNELS.ROUTINE, config, now: later });
  assert.equal(spendPause({ channel: CHANNELS.ROUTINE, now: later }), null);
});

test("GET /usage/breaker shows the state and POST resume lifts it", async () => {
  const { buildApi } = await import("#host/daemon/api.js");
  const { ProjectManager } = await import("#host/daemon/db.js");
  const config = cfg({ calls_per_hour: 1 });
  for (let i = 0; i < 2; i++) noteEngineCall({ channel: CHANNELS.ROUTINE, config });
  const app = buildApi({
    projects: new ProjectManager({}), registries: null, plugins: { get: () => null, status: () => ({}) },
    scheduler: null, version: "test", startedAt: Date.now(),
    addProjectGlobally: () => {}, config: { host: "127.0.0.1", port: 7430 }, token: "",
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${server.address().port}/api`;
  try {
    const state = await (await fetch(`${base}/usage/breaker`)).json();
    assert.ok(state.paused, "the pause is visible");
    const r = await (await fetch(`${base}/usage/breaker/resume`, { method: "POST" })).json();
    assert.equal(r.resumed, true);
    assert.equal(r.state.paused, null);
  } finally {
    server.close();
  }
});
