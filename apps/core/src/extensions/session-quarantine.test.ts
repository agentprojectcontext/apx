import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { say, scriptedLlm, startCore } from "../engine/testkit.ts";
import { createLog } from "../log.ts";
import { createMcp } from "../mcp/manager.ts";
import { extensionHandlers } from "../rpc/extensions.ts";
import { mcpHandlers } from "../rpc/mcp.ts";
import { extensionStack } from "../server-wiring.ts";
import { tempDir, waitFor } from "../testkit/platform.ts";

const SERVER = path.join(import.meta.dirname, "../mcp/fake-server.test-support.mjs");
const BRIDGE = path.join(import.meta.dirname, "session-bridge.test-support.mjs");

for (const action of ["disconnect", "remove"] as const) {
  test(`${action} blocks a quarantined bridge by extension ownership while its manual namesake is removed`, async () => {
    const source = tempDir("session-quarantine-");
    const env = await startCore({ llm: scriptedLlm(() => say("ok")) });
    const log = createLog("test", true);
    const stack = extensionStack({
      store: env.core.store,
      secrets: env.core.secrets,
      bus: env.core.bus,
      home: env.home,
      marketplaceIndex: undefined,
      log,
    });
    const mcp = createMcp({ store: env.core.store, secrets: env.core.secrets, workDir: env.home, log });
    const release = Promise.withResolvers<void>();
    let paused = false;
    let mutation: Promise<unknown> | undefined;
    const lifecycle = extensionHandlers(
      {
        ...stack.extensions,
        remove: async (...args: Parameters<typeof stack.extensions.remove>) => {
          if (action === "remove") {
            paused = true;
            await release.promise;
          }
          return stack.extensions.remove(...args);
        },
      },
      {
        ...mcp,
        drop: async (...args: Parameters<typeof mcp.drop>) => {
          if (action === "disconnect" && args[0].name === "quarantined-worker") {
            paused = true;
            await release.promise;
          }
          return mcp.drop(...args);
        },
      },
      env.core.bus,
      env.core.store,
    );
    const manual = mcpHandlers(mcp, env.core.store);
    try {
      fs.writeFileSync(
        path.join(source.path, "apx-extension.json"),
        JSON.stringify({
          manifest: 2,
          id: "quarantined",
          name: "Shop",
          version: "1.0.0",
          mcp: {
            shop: {
              command: "npx",
              args: ["-y", "mcp-remote", "https://mcp.example.com"],
              env: {
                NODE_OPTIONS: `--import=${pathToFileURL(BRIDGE).href}`,
                FIXTURE_CALLBACK_FILE: path.join(source.path, "callback"),
              },
            },
            worker: { command: process.execPath, args: [SERVER] },
          },
        }),
      );
      await env.client.call("extensions.install", { path: source.path });
      await env.client.call("extensions.enable", { id: "quarantined", enabled: true });
      const cache = mcp.find("global", "quarantined-shop")?.env.MCP_REMOTE_CONFIG_DIR;
      assert.ok(cache);
      fs.mkdirSync(path.join(cache, "mcp-remote-v1"), { recursive: true });
      fs.writeFileSync(
        path.join(cache, "mcp-remote-v1", "00000000000000000000000000000000_tokens.json"),
        "synthetic-session",
      );
      env.core.store.settings.set(
        "mcp_servers",
        JSON.stringify({
          mcpServers: {
            "quarantined-shop": { command: process.execPath, args: [SERVER] },
          },
        }),
      );
      const worker = mcp.find("global", "quarantined-worker");
      assert.ok(worker);
      await mcp.describe(worker);
      await manual["mcp.signIn"]({ scope: "global", server: "quarantined-shop" });
      await manual["mcp.toolMode"]({ scope: "global", server: "quarantined-shop", mode: "all" });
      const callManual = () =>
        manual["mcp.call"]({ scope: "global", server: "quarantined-shop", tool: "token", arguments: {} });
      const before = await callManual();
      mutation =
        action === "disconnect"
          ? lifecycle["extensions.disconnect"]({ id: "quarantined" })
          : lifecycle["extensions.remove"]({ id: "quarantined" });
      void mutation.catch(() => {});
      await waitFor(() => paused, "extension mutation reached the explicit drain barrier", { ms: 5000 });
      assert.deepEqual(
        await callManual(),
        before,
        "the manual process remains usable while only its extension is suspended",
      );
      await manual["mcp.set"]({ name: "quarantined-shop", server: null });
      const revealed = mcp.find("global", "quarantined-shop");
      assert.equal(revealed?.extension_id, "quarantined");
      assert.ok(revealed);
      await assert.rejects(mcp.describe(revealed), /being updated/);
      const tested = await mcp.test(revealed);
      assert.equal(tested.ok, false);
      assert.match(tested.error ?? "", /being updated/);
      const current = stack.extensions.list().find((e) => e.id === "quarantined");
      await assert.rejects(
        manual["mcp.signIn"]({
          scope: "global",
          server: "quarantined-shop",
          connection_generation: current?.connection_generation,
        }),
        /being updated/,
      );
      assert.equal(fs.existsSync(cache), true, "the operation is still paused before removing the saved session");
      release.resolve();
      await mutation;
      assert.equal(fs.existsSync(cache), false);
      if (action === "remove") {
        assert.equal(mcp.find("global", "quarantined-shop"), undefined);
        await assert.rejects(mcp.signIn(revealed), /no longer current/);
      } else {
        const after = mcp.find("global", "quarantined-shop");
        assert.ok(after);
        const stopped = await mcp.test(after);
        assert.equal(stopped.ok, false);
        assert.match(stopped.error ?? "", /sign in/i);
      }
    } finally {
      release.resolve();
      await mutation?.catch(() => {});
      await mcp.close();
      stack.plugins.close();
      await env.core.close();
      await env.cleanup();
      await source.remove();
    }
  });
}
