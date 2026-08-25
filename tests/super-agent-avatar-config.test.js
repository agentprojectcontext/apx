import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "apx-avatar-config-"));
process.env.HOME = tmp;
process.env.APX_HOME = path.join(tmp, ".apx");

const { writeConfig, readConfig } = await import("#core/config/index.js");
const { register } = await import("#host/daemon/api/admin-config.js");
const { eventsClients, registerEventsClient } = await import("#host/daemon/events-ws.js");

class FakeWs {
  constructor() {
    this.readyState = 1;
    this.sent = [];
  }
  on() { return this; }
  send(value) { this.sent.push(JSON.parse(value)); }
}

function handlers(config) {
  const routes = {};
  const api = {
    get(route, fn) { routes[`GET ${route}`] = fn; },
    patch(route, fn) { routes[`PATCH ${route}`] = fn; },
  };
  register(api, { config });
  return routes;
}

function response() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

test("super-agent avatar config validates, persists, and broadcasts", () => {
  writeConfig({ super_agent: { enabled: true, icon: "noche" } });
  const config = readConfig();
  const routes = handlers(config);
  const ws = new FakeWs();
  eventsClients.clear();
  registerEventsClient(ws, config);
  ws.sent.length = 0;

  const bad = response();
  routes["PATCH /admin/config"]({ body: { set: { "super_agent.icon": "fake" } } }, bad);
  assert.equal(bad.statusCode, 400);
  assert.equal(readConfig().super_agent.icon, "noche");

  const good = response();
  routes["PATCH /admin/config"]({ body: { set: { "super_agent.icon": "coral" } } }, good);
  assert.equal(good.statusCode, 200);
  assert.equal(readConfig().super_agent.icon, "coral");
  assert.equal(config.super_agent.icon, "coral");
  assert.deepEqual(ws.sent, [{
    type: "settings",
    settings: { super_agent: { icon: "coral" } },
  }]);

  ws.sent.length = 0;
  const cleared = response();
  routes["PATCH /admin/config"]({ body: { unset: ["super_agent.icon"] } }, cleared);
  assert.equal(cleared.statusCode, 200);
  assert.equal(readConfig().super_agent.icon, undefined);
  assert.equal(ws.sent[0].settings.super_agent.icon, "noche");
  eventsClients.clear();
});

test("super-agent settings response includes the resolved avatar", () => {
  writeConfig({ super_agent: { enabled: true, icon: "zafiro" } });
  const routes = handlers(readConfig());
  const res = response();
  routes["GET /admin/super-agent"]({}, res);
  assert.equal(res.body.icon, "zafiro");
});
