import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { say, scriptedLlm, startCore } from "../engine/testkit.ts";
import { unavailable } from "../errors.ts";
import { createLog } from "../log.ts";
import { createMcp } from "../mcp/manager.ts";
import { mcpHandlers } from "./mcp.ts";

test("server changes and trust revocation report a failed shutdown", async () => {
  const env = await startCore({ llm: scriptedLlm(() => say("ok")) });
  const mcp = createMcp({
    store: env.core.store,
    secrets: env.core.secrets,
    log: createLog("test", true),
    workDir: env.home,
  });
  try {
    await env.client.call("mcp.set", {
      name: "shutdown",
      server: { command: process.execPath, args: [path.join(env.home, "test.cjs")] },
    });
    const handlers = mcpHandlers(
      {
        ...mcp,
        drop: async () => {
          throw unavailable("server did not exit");
        },
      },
      env.core.store,
    );
    await assert.rejects(handlers["mcp.trust"]({ server: "shutdown", trusted: false }), /server did not exit/);
    await assert.rejects(handlers["mcp.set"]({ name: "shutdown", server: null }), /server did not exit/);
  } finally {
    await mcp.close();
    await env.core.close();
    await env.cleanup();
  }
});
