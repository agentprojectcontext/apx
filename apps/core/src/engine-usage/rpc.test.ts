import assert from "node:assert/strict";
import { test } from "node:test";
import { ApxClient } from "@apx/protocol/client";
import { testConfig } from "../config.ts";
import { createCore } from "../server.ts";
import { tempDir } from "../testkit/platform.ts";

test("agents can read enabled account limits but cannot change preferences over HTTP or WebSocket", async () => {
  await using home = tempDir();
  const core = await createCore(testConfig({ home: home.path }), { quiet: true });
  const agent = new ApxClient({ url: core.url, actor: "agent" });
  const owner = new ApxClient({ url: core.url });
  try {
    assert.equal((await owner.call("engines.usage_preferences", {})).engines.codex, false);
    const live = await owner.connect();
    try {
      assert.equal((await live.call("engines.set_usage", { engine: "codex", enabled: true })).engines.codex, true);
      assert.equal((await owner.call("engines.usage_preferences", {})).engines.codex, true);
      await owner.call("engines.set_usage", { engine: "codex", enabled: false });
      assert.deepEqual((await live.call("engines.usage", {})).engines, []);
      assert.deepEqual((await owner.call("engines.usage", {})).engines, []);
    } finally {
      live.close();
    }
    assert.deepEqual(await agent.call("engines.usage", {}), await owner.call("engines.usage", {}));
    await assert.rejects(agent.call("engines.usage_preferences", {}), { code: "unauthorized" });
    await assert.rejects(agent.call("engines.set_usage", { engine: "codex", enabled: true }), { code: "unauthorized" });
    const external = await owner.call("clients.create", { name: "Acme", scopes: ["chat", "browser"] });
    const app = new ApxClient({ url: core.url, clientToken: external.token });
    await assert.rejects(app.call("engines.usage", {}), { code: "unauthorized" });
    const externalSocket = await new ApxClient({ url: core.url, token: external.token }).connect();
    try {
      await assert.rejects(externalSocket.call("engines.usage", {}), { code: "unauthorized" });
    } finally {
      externalSocket.close();
    }
    const socket = await agent.connect();
    try {
      assert.deepEqual(await socket.call("engines.usage", {}), await owner.call("engines.usage", {}));
      await assert.rejects(socket.call("engines.usage_preferences", {}), { code: "unauthorized" });
      await assert.rejects(socket.call("engines.set_usage", { engine: "codex", enabled: true }), {
        code: "unauthorized",
      });
    } finally {
      socket.close();
    }
  } finally {
    await core.close();
  }
});
