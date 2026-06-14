import { test } from "node:test";
import assert from "node:assert/strict";
import {
  desktopClients,
  setDesktopMessageHandler,
  registerDesktopClient,
  broadcastDesktop,
  sendToClient,
  isDesktopUpgradePath,
  extractWsToken,
  isDesktopUpgradeAuthorized,
} from "#host/daemon/desktop-ws.js";

// Minimal stand-in for a `ws` WebSocket: records sent payloads and lets the
// test fire lifecycle/message events synchronously.
class FakeWs {
  constructor(readyState = 1) {
    this.readyState = readyState;
    this.sent = [];
    this._handlers = {};
  }
  on(event, fn) {
    (this._handlers[event] ||= []).push(fn);
    return this;
  }
  emit(event, ...args) {
    for (const fn of this._handlers[event] || []) fn(...args);
  }
  send(payload) {
    this.sent.push(payload);
  }
}

// The hub is a module-level singleton shared across tests; clear it each time.
function reset() {
  desktopClients.clear();
  setDesktopMessageHandler(null);
}

test("registerDesktopClient tracks the client and drops it on close/error", () => {
  reset();
  const a = new FakeWs();
  const b = new FakeWs();
  registerDesktopClient(a);
  registerDesktopClient(b);
  assert.equal(desktopClients.size, 2);

  a.emit("close");
  assert.equal(desktopClients.size, 1);
  assert.ok(desktopClients.has(b));

  b.emit("error", new Error("boom"));
  assert.equal(desktopClients.size, 0);
});

test("incoming messages are JSON-parsed and routed to the handler", () => {
  reset();
  const ws = new FakeWs();
  const seen = [];
  setDesktopMessageHandler((sock, data) => seen.push({ sock, data }));
  registerDesktopClient(ws);

  ws.emit("message", Buffer.from(JSON.stringify({ type: "message", text: "hi" })));
  assert.equal(seen.length, 1);
  assert.equal(seen[0].sock, ws);
  assert.deepEqual(seen[0].data, { type: "message", text: "hi" });
});

test("invalid JSON falls back to a {type:'raw'} envelope", () => {
  reset();
  const ws = new FakeWs();
  const seen = [];
  setDesktopMessageHandler((_sock, data) => seen.push(data));
  registerDesktopClient(ws);

  ws.emit("message", Buffer.from("not-json{"));
  assert.deepEqual(seen[0], { type: "raw", raw: "not-json{" });
});

test("messages are ignored when no handler is registered", () => {
  reset();
  const ws = new FakeWs();
  registerDesktopClient(ws);
  // No handler set — must not throw.
  assert.doesNotThrow(() => ws.emit("message", Buffer.from('{"type":"ping"}')));
});

test("broadcastDesktop only sends to OPEN clients and serializes objects", () => {
  reset();
  const open = new FakeWs(1);
  const connecting = new FakeWs(0);
  registerDesktopClient(open);
  registerDesktopClient(connecting);

  broadcastDesktop({ type: "token", text: "x" });
  assert.deepEqual(open.sent, [JSON.stringify({ type: "token", text: "x" })]);
  assert.equal(connecting.sent.length, 0);

  // Strings pass through untouched.
  broadcastDesktop("ping");
  assert.equal(open.sent[1], "ping");
});

test("broadcastDesktop swallows send() errors so one bad client can't break the fan-out", () => {
  reset();
  const good = new FakeWs(1);
  const bad = new FakeWs(1);
  bad.send = () => {
    throw new Error("socket gone");
  };
  registerDesktopClient(bad);
  registerDesktopClient(good);

  assert.doesNotThrow(() => broadcastDesktop({ type: "done" }));
  assert.equal(good.sent.length, 1);
});

test("sendToClient targets a single OPEN client and is a no-op when closed", () => {
  reset();
  const ws = new FakeWs(1);
  sendToClient(ws, { type: "pong" });
  assert.deepEqual(ws.sent, [JSON.stringify({ type: "pong" })]);

  const closed = new FakeWs(3); // CLOSED
  sendToClient(closed, { type: "pong" });
  assert.equal(closed.sent.length, 0);
});

// --- WS upgrade auth (regression guard for BUG-WS-AUTH) -------------------
// The desktop WS channel must require a valid bearer token, like the HTTP
// /desktop/* routes. Before the fix, the upgrade handler checked only the URL
// and let any client open the channel and drive the super-agent.

test("isDesktopUpgradePath matches /desktop/ws and legacy /overlay/ws, with query", () => {
  assert.equal(isDesktopUpgradePath("/desktop/ws"), true);
  assert.equal(isDesktopUpgradePath("/overlay/ws"), true);
  assert.equal(isDesktopUpgradePath("/desktop/ws?token=abc"), true);
  assert.equal(isDesktopUpgradePath("/"), false);
  assert.equal(isDesktopUpgradePath("/projects"), false);
  assert.equal(isDesktopUpgradePath("/desktop/wsX"), false);
});

test("extractWsToken reads the bearer header, then the ?token= fallback", () => {
  assert.equal(extractWsToken({ headers: { authorization: "Bearer abc123" }, url: "/desktop/ws" }), "abc123");
  assert.equal(extractWsToken({ headers: {}, url: "/desktop/ws?token=qp" }), "qp");
  // header wins over query
  assert.equal(extractWsToken({ headers: { authorization: "Bearer hdr" }, url: "/desktop/ws?token=qp" }), "hdr");
  assert.equal(extractWsToken({ headers: {}, url: "/desktop/ws" }), "");
});

test("isDesktopUpgradeAuthorized rejects missing/wrong tokens and accepts a known one", () => {
  const tokenStore = { has: (t) => t === "good-master" };
  // missing
  assert.equal(isDesktopUpgradeAuthorized({ headers: {}, url: "/desktop/ws" }, tokenStore), false);
  // wrong
  assert.equal(isDesktopUpgradeAuthorized({ headers: { authorization: "Bearer nope" }, url: "/desktop/ws" }, tokenStore), false);
  // correct via header
  assert.equal(isDesktopUpgradeAuthorized({ headers: { authorization: "Bearer good-master" }, url: "/desktop/ws" }, tokenStore), true);
  // correct via query param
  assert.equal(isDesktopUpgradeAuthorized({ headers: {}, url: "/desktop/ws?token=good-master" }, tokenStore), true);
  // no store → deny
  assert.equal(isDesktopUpgradeAuthorized({ headers: { authorization: "Bearer good-master" }, url: "/desktop/ws" }, null), false);
});
