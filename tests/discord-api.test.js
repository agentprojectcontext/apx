// /api/discord/*: the room list is managed here, the token goes in and never
// comes out, and a send is refused anywhere the bot does not live.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TMP_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "apx-discord-api-"));
process.env.HOME = TMP_HOME;
process.env.APX_HOME = path.join(TMP_HOME, ".apx");

const { ProjectManager } = await import("#host/daemon/db.js");
const { buildApi } = await import("#host/daemon/api.js");
const { readConfig } = await import("#core/config/index.js");

const ROOM = "2000000000000000001";
const OTHER = "2000000000000000002";

async function withApi(fn, plugin = null) {
  const projects = new ProjectManager({});
  projects.registerDefault();
  const app = buildApi({
    projects, registries: null,
    plugins: { get: (id) => (id === "discord" ? plugin : null), status: () => ({}) },
    scheduler: null, version: "test", startedAt: Date.now(),
    addProjectGlobally: () => {}, config: { host: "127.0.0.1", port: 7430 }, token: "",
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const call = async (method, p, body) => {
    const res = await fetch(base + p, {
      method, headers: { "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return { status: res.status, body: await res.json() };
  };
  try {
    await fn(call);
  } finally {
    await new Promise((r) => server.close(r));
  }
}

test("settings: the token is stored and never returned", async () => {
  await withApi(async (call) => {
    const r = await call("PATCH", "/discord/settings", { token: "not-a-real-token", owner_ids: ["1000000000000000002"] });
    assert.equal(r.status, 200);
    assert.equal(r.body.has_token, true);
    assert.ok(!JSON.stringify(r.body).includes("not-a-real-token"));
    assert.equal(readConfig().discord.token, "not-a-real-token");

    const s = await call("GET", "/discord/status");
    assert.equal(s.body.has_token, true);
    assert.ok(!JSON.stringify(s.body).includes("not-a-real-token"));

    const bad = await call("PATCH", "/discord/settings", { limits: { nope: 1 } });
    assert.equal(bad.status, 400);
  });
});

test("channels: list, change and remove a room; bad input is a 400", async () => {
  await withApi(async (call) => {
    assert.equal((await call("PUT", `/discord/channels/${ROOM}`, { mode: "mention", name: "general" })).status, 200);
    assert.equal((await call("PUT", `/discord/channels/${ROOM}`, { mode: "always" })).body.mode, "always");
    assert.equal((await call("PUT", "/discord/channels/general", { mode: "always" })).status, 400);
    assert.equal((await call("PUT", `/discord/channels/${OTHER}`, { mode: "shout" })).status, 400);

    const s = await call("GET", "/discord/status");
    assert.deepEqual(s.body.channels, [{ id: ROOM, mode: "always", name: "general" }]);

    assert.equal((await call("DELETE", `/discord/channels/${ROOM}`)).status, 200);
    assert.equal((await call("DELETE", `/discord/channels/${ROOM}`)).status, 404);
  });
});

test("send: refused to an unlisted room, 503 while disconnected, posted through the plugin when live", async () => {
  const sent = [];
  const plugin = {
    status: () => ({ bot: { id: "1000000000000000001", name: "roby" } }),
    send: async (channelId, text) => { sent.push({ channelId, text }); return { parts: 1, firstId: "5000000000000000001" }; },
  };
  await withApi(async (call) => {
    assert.equal((await call("POST", "/discord/send", { channel_id: OTHER, text: "hola" })).status, 403);
    await call("PUT", `/discord/channels/${ROOM}`, { mode: "read" });
    assert.equal((await call("POST", "/discord/send", { channel_id: ROOM, text: "" })).status, 400);
    const ok = await call("POST", "/discord/send", { channel_id: ROOM, text: "hola" });
    assert.equal(ok.status, 200);
    assert.deepEqual(sent, [{ channelId: ROOM, text: "hola" }]);
  }, plugin);

  await withApi(async (call) => {
    assert.equal((await call("POST", "/discord/send", { channel_id: ROOM, text: "hola" })).status, 503);
  });
});
