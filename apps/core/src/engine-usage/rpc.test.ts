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
  try {
    await assert.rejects(agent.call("engines.usage", {}), { code: "unauthorized" });
    const socket = await agent.connect();
    try {
      await assert.rejects(socket.call("engines.usage", {}), { code: "unauthorized" });
    } finally {
      socket.close();
    }
  } finally {
    await core.close();
  }
});
