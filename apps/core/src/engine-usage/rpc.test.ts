import assert from "node:assert/strict";
import { test } from "node:test";
import { ApxClient } from "@apx/protocol/client";
import { testConfig } from "../config.ts";
import { createCore } from "../server.ts";
import { tempDir } from "../testkit/platform.ts";

test("agents cannot query owner account limits over HTTP or WebSocket", async () => {
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
    await assert.rejects(agent.call("engines.usage", {}), { code: "unauthorized" });
    await assert.rejects(agent.call("engines.usage_preferences", {}), { code: "unauthorized" });
    await assert.rejects(agent.call("engines.set_usage", { engine: "codex", enabled: true }), { code: "unauthorized" });
    const socket = await agent.connect();
    try {
      await assert.rejects(socket.call("engines.usage", {}), { code: "unauthorized" });
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
