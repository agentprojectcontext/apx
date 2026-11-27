import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { say, scriptedLlm, startCore } from "../engine/testkit.ts";
import { tempDir } from "../testkit/platform.ts";

const SERVER = path.join(import.meta.dirname, "../mcp/fake-server.test-support.mjs");
const BRIDGE = path.join(import.meta.dirname, "session-bridge.test-support.mjs");

test("uninstall clears every old bridge receipt but leaves manual namesakes and another extension untouched", async () => {
  const source = tempDir("session-uninstall-");
  const env = await startCore({ llm: scriptedLlm(() => say("ok")) });
  const callback = path.join(source.path, "other.callback");
  const bridge = {
    command: "npx",
    args: ["-y", "mcp-remote", "https://mcp.example.com"],
    env: {
      NODE_OPTIONS: `--import=${pathToFileURL(BRIDGE).href}`,
      FIXTURE_CALLBACK_FILE: callback,
    },
  };
  const local = { command: process.execPath, args: [SERVER] };
  const write = (id: string, version: string, mcp: Record<string, typeof bridge | typeof local>) =>
    fs.writeFileSync(
      path.join(source.path, "apx-extension.json"),
      JSON.stringify({ manifest: 2, id, name: "Shop", version, mcp }),
    );
  const expectOtherSignedOut = async () => {
    const result = await env.client.call("mcp.test", { scope: "global", server: "reusedxshop-shop" });
    assert.equal(result.ok, false);
    assert.match(result.error ?? "", /sign in/i);
    assert.equal(
      fs.existsSync(callback),
      false,
      "another connector must not spawn after its receipt is cleared accidentally",
    );
  };
  try {
    write("reused_shop", "1.0.0", { shop: bridge });
    await env.client.call("extensions.install", { path: source.path });
    await env.client.call("extensions.enable", { id: "reused_shop", enabled: true });
    await env.client.call("extensions.disconnect", { id: "reused_shop" });
    // The uninstall must also clear receipts belonging to a server renamed by an earlier update.
    write("reused_shop", "1.0.1", { renamed: bridge });
    await env.client.call("extensions.install", { path: source.path });
    await env.client.call("extensions.disconnect", { id: "reused_shop" });

    write("reusedxshop", "1.0.0", { shop: bridge });
    await env.client.call("extensions.install", { path: source.path });
    await env.client.call("extensions.enable", { id: "reusedxshop", enabled: true });
    await env.client.call("extensions.disconnect", { id: "reusedxshop" });
    await env.client.call("extensions.enable", { id: "reusedxshop", enabled: false });
    await env.client.call("extensions.enable", { id: "reusedxshop", enabled: true });
    await env.client.call("extensions.settings", { id: "reusedxshop", values: {} });
    await expectOtherSignedOut();

    // Historical manual collisions are seeded below the registration guard, never through the public method.
    const manualNames = ["reused_shop-shop", "reused_shop-renamed"];
    env.core.store.settings.set(
      "mcp_servers",
      JSON.stringify({ mcpServers: Object.fromEntries(manualNames.map((name) => [name, local])) }),
    );
    const callManual = (name: string) =>
      env.client.call("mcp.call", { scope: "global", server: name, tool: "token", arguments: {} });
    const before = new Map<string, unknown>();
    for (const name of manualNames) {
      await env.client.call("mcp.signIn", { scope: "global", server: name });
      await env.client.call("mcp.toolMode", { scope: "global", server: name, mode: "all" });
      before.set(name, await callManual(name));
    }
    await env.client.call("extensions.remove", { id: "reused_shop" });
    for (const name of manualNames) {
      assert.deepEqual(
        await callManual(name),
        before.get(name),
        "uninstall preserves the manual server PID and tool access",
      );
      assert.equal(
        (await env.client.call("mcp.list", {})).servers.find((s) => s.name === name)?.tool_permission_mode,
        "all",
      );
    }
    await expectOtherSignedOut();
    for (const name of manualNames) await env.client.call("mcp.set", { name, server: null });

    write("reused_shop", "2.0.0", { shop: local, renamed: local });
    const reinstalled = await env.client.call("extensions.install", { path: source.path });
    assert.equal(reinstalled.session, undefined);
    await env.client.call("extensions.enable", { id: "reused_shop", enabled: true });
    for (const server of manualNames) {
      const described = await env.client.call("mcp.describe", { scope: "global", server });
      assert.ok(
        described.tools.some((tool) => tool.name === "echo"),
        "a non-OAuth reinstall starts normally without signing in",
      );
      assert.equal((await env.client.call("mcp.list", {})).servers.find((s) => s.name === server)?.status, "ready");
    }
    await expectOtherSignedOut();
  } finally {
    await env.core.close();
    await env.cleanup();
    await source.remove();
  }
});
