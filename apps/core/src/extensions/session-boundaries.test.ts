import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { say, scriptedLlm, startCore } from "../engine/testkit.ts";
import { mcpConfig } from "../mcp/config.ts";
import { tempDir, waitFor } from "../testkit/platform.ts";

const SERVER = path.join(import.meta.dirname, "../mcp/fake-server.test-support.mjs");
const BRIDGE = path.join(import.meta.dirname, "session-bridge.test-support.mjs");
const manifest = (id: string) => ({
  manifest: 2,
  id,
  name: "Shop",
  version: "1.0.0",
  mcp: { shop: { command: "mcp-remote", args: ["https://mcp.example.com"] } },
});

test("both registration orders refuse extension/manual MCP name collisions before affecting the live server", async () => {
  const source = tempDir("extension-name-order-");
  const env = await startCore({ llm: scriptedLlm(() => say("ok")) });
  try {
    await env.client.call("mcp.set", {
      name: "manual_first-shop",
      server: { command: process.execPath, args: [SERVER] },
    });
    await env.client.call("mcp.signIn", { scope: "global", server: "manual_first-shop" });
    fs.writeFileSync(path.join(source.path, "apx-extension.json"), JSON.stringify(manifest("manual_first")));
    await assert.rejects(env.client.call("extensions.install", { path: source.path }), /belongs to another connection/);
    assert.equal(
      (await env.client.call("mcp.list", {})).servers.find((s) => s.name === "manual_first-shop")?.status,
      "ready",
    );
    fs.writeFileSync(path.join(source.path, "apx-extension.json"), JSON.stringify(manifest("extension_first")));
    await env.client.call("extensions.install", { path: source.path });
    await assert.rejects(
      env.client.call("mcp.set", {
        name: "extension_first-shop",
        server: { command: process.execPath, args: [SERVER] },
      }),
      /belongs to an installed extension/,
    );
    await env.client.call("extensions.enable", { id: "extension_first", enabled: true });
    await assert.rejects(
      env.client.call("mcp.set", { name: "extension_first-shop", server: null }),
      /belongs to an installed extension/,
    );
    assert.equal(
      (await env.client.call("mcp.list", {})).servers.find((s) => s.name === "extension_first-shop")?.status,
      "off",
    );
    assert.equal(
      (await env.client.call("extensions.list", {})).extensions.some((e) => e.id === "manual_first"),
      false,
    );
  } finally {
    await env.core.close();
    await env.cleanup();
    await source.remove();
  }
});

test("a legacy colliding manual MCP keeps its process, tools and approvals when the extension disconnects", async () => {
  const source = tempDir("extension-legacy-name-");
  const env = await startCore({ llm: scriptedLlm(() => say("ok")) });
  try {
    fs.writeFileSync(path.join(source.path, "apx-extension.json"), JSON.stringify(manifest("legacy_shop")));
    await env.client.call("extensions.install", { path: source.path });
    await env.client.call("extensions.enable", { id: "legacy_shop", enabled: true });
    // Seed a pre-existing collision that current registration rules no longer allow.
    env.core.store.settings.set(
      "mcp_servers",
      JSON.stringify({
        mcpServers: {
          "legacy_shop-shop": { command: process.execPath, args: [SERVER] },
        },
      }),
    );
    const before = await env.client.call("mcp.signIn", { scope: "global", server: "legacy_shop-shop" });
    assert.equal(before.server.status, "ready");
    assert.equal(before.server.connection_generation, undefined);
    await env.client.call("mcp.toolMode", { scope: "global", server: "legacy_shop-shop", mode: "all" });
    const result = () =>
      env.client.call("mcp.call", { scope: "global", server: "legacy_shop-shop", tool: "token", arguments: {} });
    const original = await result();
    await env.client.call("extensions.disconnect", { id: "legacy_shop" });
    const status = (await env.client.call("mcp.list", {})).servers.filter((s) => s.name === "legacy_shop-shop");
    assert.equal(status.length, 1);
    assert.equal(status[0]?.status, "ready");
    assert.equal(status[0]?.tool_permission_mode, "all");
    assert.deepEqual(await result(), original, "same PID and tool result, not a silently restarted manual server");
    await assert.rejects(
      env.client.call("extensions.enable", { id: "legacy_shop", enabled: true }),
      /belongs to another connection/,
    );
    await env.client.call("extensions.enable", { id: "legacy_shop", enabled: false });
    await env.client.call("extensions.remove", { id: "legacy_shop" });
    assert.deepEqual(await result(), original, "turning off/removing the extension leaves the manual server alone too");
  } finally {
    await env.core.close();
    await env.cleanup();
    await source.remove();
  }
});

test("a multi-server Connect snapshot cannot sign in its next server after Disconnect", async () => {
  const source = tempDir("extension-connect-generation-");
  const env = await startCore({ llm: scriptedLlm(() => say("ok")) });
  const callbackFile = (name: string) => path.join(source.path, `${name}.callback`);
  try {
    const mcp = Object.fromEntries(
      ["first", "second"].map((name) => [
        name,
        {
          command: "npx",
          args: ["-y", "mcp-remote", "https://mcp.example.com"],
          env: { NODE_OPTIONS: `--import=${pathToFileURL(BRIDGE).href}`, FIXTURE_CALLBACK_FILE: callbackFile(name) },
        },
      ]),
    );
    fs.writeFileSync(
      path.join(source.path, "apx-extension.json"),
      JSON.stringify({
        manifest: 2,
        id: "batch_shop",
        name: "Shop",
        version: "1.0.0",
        mcp,
      }),
    );
    const installed = await env.client.call("extensions.install", { path: source.path });
    const offSnapshot = await env.client.call("extensions.disconnect", { id: "batch_shop" });
    await assert.rejects(
      env.client.call("extensions.enable", {
        id: "batch_shop",
        enabled: true,
        only_if_disabled: true,
        connection_generation: installed.connection_generation,
      }),
      /no longer current/,
    );
    await assert.rejects(
      env.client.call("extensions.enable", { id: "batch_shop", enabled: true, only_if_disabled: true }),
      /no longer current/,
    );
    const snapshot = await env.client.call("extensions.enable", {
      id: "batch_shop",
      enabled: true,
      only_if_disabled: true,
      connection_generation: offSnapshot.connection_generation,
    });
    const first = mcpConfig(env.core.store)
      .global()
      .find((d) => d.name === "batch_shop-first")?.env.MCP_REMOTE_CONFIG_DIR;
    const second = mcpConfig(env.core.store)
      .global()
      .find((d) => d.name === "batch_shop-second")?.env.MCP_REMOTE_CONFIG_DIR;
    assert.ok(first && second);
    fs.mkdirSync(path.join(first, "mcp-remote-v1"), { recursive: true });
    fs.writeFileSync(
      path.join(first, "mcp-remote-v1", "00000000000000000000000000000000_tokens.json"),
      "synthetic-session",
    );
    const firstReady = await env.client.call("mcp.signIn", {
      scope: "global",
      server: "batch_shop-first",
      connection_generation: snapshot.connection_generation,
    });
    assert.equal(firstReady.server.status, "ready");
    assert.equal(firstReady.server.connection_generation, snapshot.connection_generation);
    const disconnected = await env.client.call("extensions.disconnect", { id: "batch_shop" });
    assert.notEqual(disconnected.connection_generation, snapshot.connection_generation);
    await assert.rejects(
      env.client.call("mcp.signIn", {
        scope: "global",
        server: "batch_shop-second",
        connection_generation: snapshot.connection_generation,
      }),
      /no longer current/,
    );
    await assert.rejects(
      env.client.call("mcp.signIn", { scope: "global", server: "batch_shop-second" }),
      /no longer current/,
    );
    assert.equal(fs.existsSync(first), false);
    assert.equal(fs.existsSync(second), false, "stale Connect never spawned its next bridge");
    assert.equal(fs.existsSync(callbackFile("second")), false);
    const secondStart = await env.client.call("mcp.signIn", {
      scope: "global",
      server: "batch_shop-second",
      connection_generation: disconnected.connection_generation,
    });
    assert.equal(secondStart.server.status, "needs-sign-in");
    assert.equal((await fetch(fs.readFileSync(callbackFile("second"), "utf8"))).status, 200);
    await waitFor(
      async () =>
        (await env.client.call("mcp.list", {})).servers.some(
          (s) => s.name === "batch_shop-second" && s.status === "ready",
        ),
      "fresh generation to reconnect",
      { ms: 15_000 },
    );
  } finally {
    await env.core.close();
    await env.cleanup();
    await source.remove();
  }
});
