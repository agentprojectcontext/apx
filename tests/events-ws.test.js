// The live event feed: who may open it, what a client is told, and how many
// frames a chatty turn turns into.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const HOME = fs.mkdtempSync(path.join(os.tmpdir(), "apx-events-ws-"));
process.env.HOME = HOME;
process.env.APX_HOME = path.join(HOME, ".apx"); // isolate the apx home too — HOME alone is overridden by the runner's APX_HOME

const {
  eventsClients,
  isEventsUpgradePath,
  registerEventsClient,
  broadcastEvents,
  broadcastSuperAgentAvatar,
  startEventsBridge,
  EVENTS_WS_PATH,
} = await import("#host/daemon/events-ws.js");
const { emitMessageEvent, resetEventBus } = await import("#core/events/bus.js");
const { isWsUpgradeAuthorized } = await import("#host/daemon/ws-auth.js");

class FakeWs {
  constructor(readyState = 1) {
    this.readyState = readyState;
    this.sent = [];
    this.pings = 0;
    this._handlers = {};
  }
  on(event, fn) { (this._handlers[event] ||= []).push(fn); return this; }
  emit(event, ...args) { for (const fn of this._handlers[event] || []) fn(...args); }
  send(payload) { this.sent.push(payload); }
  ping() { this.pings += 1; }
  close() { this.readyState = 3; }
  terminate() { this.readyState = 3; }
  /** Parsed frames, in order. */
  frames() { return this.sent.map((s) => JSON.parse(s)); }
}

function reset() {
  eventsClients.clear();
  resetEventBus();
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

test("the feed lives under /api, and only its own path opens it", () => {
  assert.equal(EVENTS_WS_PATH, "/api/events/ws");
  assert.equal(isEventsUpgradePath("/api/events/ws"), true);
  assert.equal(isEventsUpgradePath("/api/events/ws?token=abc"), true);
  assert.equal(isEventsUpgradePath("/api/events/wsX"), false);
  assert.equal(isEventsUpgradePath("/events/ws"), false);
  assert.equal(isEventsUpgradePath("/api/desktop/ws"), false);
});

test("the feed is gated by the same token check as every other WS channel", () => {
  const tokenStore = { has: (t) => t === "good-master" };
  assert.equal(isWsUpgradeAuthorized({ headers: {}, url: EVENTS_WS_PATH }, tokenStore), false);
  assert.equal(
    isWsUpgradeAuthorized({ headers: {}, url: `${EVENTS_WS_PATH}?token=nope` }, tokenStore),
    false,
  );
  assert.equal(
    isWsUpgradeAuthorized({ headers: { authorization: "Bearer good-master" }, url: EVENTS_WS_PATH }, tokenStore),
    true,
  );
  assert.equal(
    isWsUpgradeAuthorized({ headers: {}, url: `${EVENTS_WS_PATH}?token=good-master` }, tokenStore),
    true,
  );
});

test("a connecting client is greeted, tracked, and dropped when it goes away", () => {
  reset();
  const a = new FakeWs();
  registerEventsClient(a, { super_agent: { icon: "coral" } });
  assert.equal(eventsClients.size, 1);
  assert.equal(a.frames()[0].type, "hello");
  assert.equal(a.frames()[0].settings.super_agent.icon, "coral");

  const b = new FakeWs();
  registerEventsClient(b);
  a.emit("close");
  assert.equal(eventsClients.size, 1);
  assert.ok(eventsClients.has(b));
  b.emit("error", new Error("boom"));
  assert.equal(eventsClients.size, 0);
});

test("avatar changes fan out through the settings feed", () => {
  reset();
  const ws = new FakeWs();
  registerEventsClient(ws);
  ws.sent.length = 0;
  broadcastSuperAgentAvatar({ super_agent: { icon: "zafiro" } });
  assert.deepEqual(ws.frames(), [{
    type: "settings",
    settings: { super_agent: { icon: "zafiro" } },
  }]);
});

test("broadcastEvents skips a socket that is not open", () => {
  reset();
  const open = new FakeWs(1);
  const closing = new FakeWs(2);
  registerEventsClient(open);
  registerEventsClient(closing);
  open.sent.length = 0;
  closing.sent.length = 0;
  broadcastEvents({ type: "messages", events: [] });
  assert.equal(open.sent.length, 1);
  assert.equal(closing.sent.length, 0);
});

test("a ledger write reaches every connected client", async () => {
  reset();
  const stop = startEventsBridge({ projects: null });
  const ws = new FakeWs();
  registerEventsClient(ws);
  ws.sent.length = 0; // drop the hello

  emitMessageEvent({
    scope: "global",
    channel: "telegram",
    thread: "2026-01-15",
    project_id: null,
    direction: "in",
    type: "user",
    ts: "2026-01-15T10:00:00Z",
  });
  await wait(400);

  const frames = ws.frames();
  assert.equal(frames.length, 1);
  assert.equal(frames[0].type, "messages");
  assert.equal(frames[0].events.length, 1);
  assert.equal(frames[0].events[0].channel, "telegram");
  assert.equal(frames[0].events[0].thread, "2026-01-15");
  assert.deepEqual(frames[0].notifications, [], "the owner's send is not a pet bubble");
  stop();
});

test("a conversation write carries the role it was appended under", async () => {
  reset();
  const stop = startEventsBridge({ projects: null });
  const ws = new FakeWs();
  registerEventsClient(ws);
  ws.sent.length = 0;

  // A project agent's own file: no direction, no type — appendTurn emits the
  // ROLE. Without it on the wire every such write looks the same, and a
  // subscriber that only cares about the agent SPEAKING has to re-fetch for the
  // owner's message and for each tool row too (60-odd fetches for one turn).
  emitMessageEvent({
    scope: "conversation",
    project_root: null,
    agent_slug: "scout",
    conversation_id: "c1",
    role: "tool",
    ts: "2026-01-15T10:00:00Z",
  });
  await wait(400);

  const [frame] = ws.frames();
  assert.equal(frame.events[0].role, "tool");
  assert.equal(frame.events[0].type, null, "a conversation write has no ledger type");
  stop();
});

test("a streamed turn's many writes collapse into one frame", async () => {
  reset();
  const stop = startEventsBridge({ projects: null });
  const ws = new FakeWs();
  registerEventsClient(ws);
  ws.sent.length = 0;

  // What a streaming Telegram answer does: a row per chunk, same thread.
  for (let i = 0; i < 8; i++) {
    emitMessageEvent({ scope: "global", channel: "telegram", thread: "2026-01-15", direction: "out", type: "agent" });
  }
  // A different thread in the same window is still its own event.
  emitMessageEvent({ scope: "global", channel: "web", thread: "2026-01-15", direction: "in", type: "user" });
  await wait(400);

  const frames = ws.frames();
  assert.equal(frames.length, 1, "one window, one frame");
  assert.equal(frames[0].events.length, 2, "one per distinct thread");
  assert.deepEqual(frames[0].events.map((e) => e.channel).sort(), ["telegram", "web"]);
  stop();
});

test("the pet is told when an agent launches a final, not when the owner sends", async () => {
  reset();
  const stop = startEventsBridge({ projects: null });
  const ws = new FakeWs();
  registerEventsClient(ws);
  ws.sent.length = 0;

  emitMessageEvent({
    scope: "global", channel: "telegram", thread: "2026-01-15",
    direction: "in", type: "user", author: "@manu",
  });
  emitMessageEvent({
    scope: "global", channel: "telegram", thread: "2026-01-15",
    direction: "out", type: "agent", author: "Roby", agent_slug: "super_agent",
  });
  emitMessageEvent({
    scope: "project", channel: "group", thread: "2026-01-15",
    direction: "out", type: "agent", author: "sofia", agent_slug: "sofia",
  });
  emitMessageEvent({
    scope: "project", channel: "a2a", thread: "2026-01-15",
    direction: "out", type: "agent", author: "magui", agent_slug: "magui", to: "roby",
  });
  await wait(400);

  const [frame] = ws.frames();
  assert.deepEqual(frame.notifications, [
    "Roby respondió en Telegram",
    "sofia respondió en Grupo",
    "Nuevo mensaje de Magui a Roby",
  ]);
  // The recipient reaches the pet on the wire, not only inside the copy the
  // daemon computed: an older client that renders `events` itself gets it too.
  assert.equal(frame.events.find((e) => e.channel === "a2a").to, "roby");
  assert.equal(frame.events.find((e) => e.channel === "telegram").to, null);
  stop();
});

test("a project write is resolved to the project id the panel knows", async () => {
  reset();
  const projects = {
    list: () => [{ id: 4 }, { id: 9 }],
    get: (id) => ({ storagePath: id === 9 ? "/store/nine" : "/store/four" }),
  };
  const stop = startEventsBridge({ projects });
  const ws = new FakeWs();
  registerEventsClient(ws);
  ws.sent.length = 0;

  emitMessageEvent({
    scope: "conversation",
    project_root: "/store/nine",
    agent_slug: "acme-bot",
    conversation_id: "2026-01-15-01",
    ts: "2026-01-15T12:00:00Z",
  });
  await wait(400);

  const [frame] = ws.frames();
  assert.equal(frame.events[0].project_id, 9);
  assert.equal(frame.events[0].conversation_id, "2026-01-15-01");
  assert.equal(frame.events[0].agent_slug, "acme-bot");
  // The path stays on this machine.
  assert.equal("project_root" in frame.events[0], false);
  stop();
});

test("an unknown project root resolves to null rather than a wrong id", async () => {
  reset();
  const projects = { list: () => [{ id: 4 }], get: () => ({ storagePath: "/store/four" }) };
  const stop = startEventsBridge({ projects });
  const ws = new FakeWs();
  registerEventsClient(ws);
  ws.sent.length = 0;
  emitMessageEvent({ scope: "project", project_root: "/store/elsewhere", channel: "exec" });
  await wait(400);
  assert.equal(ws.frames()[0].events[0].project_id, null);
  stop();
});

test("stopping the bridge unsubscribes it and closes the clients", async () => {
  reset();
  const stop = startEventsBridge({ projects: null });
  const ws = new FakeWs();
  registerEventsClient(ws);
  stop();
  assert.equal(eventsClients.size, 0);
  ws.sent.length = 0;
  emitMessageEvent({ scope: "global", channel: "telegram", thread: "2026-01-15" });
  await wait(400);
  assert.equal(ws.sent.length, 0);
});
