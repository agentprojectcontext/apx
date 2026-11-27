import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { say, scriptedLlm, startCore } from "../engine/testkit.ts";
import { mcpConfig } from "../mcp/config.ts";
import { tempDir, waitFor } from "../testkit/platform.ts";

const BRIDGE = path.join(import.meta.dirname, "session-bridge.test-support.mjs");

test("disconnect drains OAuth callbacks, isolates connectors and permits explicit reconnection", async () => {
  const source = tempDir("extension-sessions-");
  const env = await startCore({ llm: scriptedLlm(() => say("ok")) });
  const status = async (name: string) => (await env.client.call("mcp.list", {})).servers.find((s) => s.name === name);
  const becomes = (name: string, state: string) =>
    waitFor(async () => (await status(name))?.status === state, `${name} to become ${state}`, { ms: 15_000 });
  const callbackFile = (id: string) => path.join(source.path, `${id}.callback`);
  const signIn = async (id: string) => {
    const extension = (await env.client.call("extensions.list", {})).extensions.find((e) => e.id === id);
    await env.client.call("mcp.signIn", {
      scope: "global",
      server: `${id}-shop`,
      connection_generation: extension?.connection_generation,
    });
    await becomes(`${id}-shop`, "needs-sign-in");
    const callback = fs.readFileSync(callbackFile(id), "utf8");
    assert.equal((await fetch(callback)).status, 200);
    await becomes(`${id}-shop`, "ready");
    return callback;
  };
  try {
    const health = await env.client.call("system.health", {});
    assert.equal(health.code_sha, env.core.identity.code_sha);
    for (const id of ["first_shop", "second_shop"]) {
      fs.writeFileSync(
        path.join(source.path, "apx-extension.json"),
        JSON.stringify({
          manifest: 2,
          id,
          name: id,
          version: "1.0.0",
          mcp: {
            shop: {
              command: "npx",
              args: ["-y", "mcp-remote", "https://mcp.example.com"],
              env: { NODE_OPTIONS: `--import=${pathToFileURL(BRIDGE).href}`, FIXTURE_CALLBACK_FILE: callbackFile(id) },
            },
            archive: { command: "mcp-remote", args: ["https://mcp.example.com"] },
          },
        }),
      );
      const installed = await env.client.call("extensions.install", { path: source.path });
      assert.deepEqual(installed.session, { can_disconnect: true, saved: false });
      await env.client.call("extensions.enable", { id, enabled: true });
    }
    const defs = mcpConfig(env.core.store).global();
    const first = defs.find((d) => d.name === "first_shop-shop")?.env.MCP_REMOTE_CONFIG_DIR;
    const second = defs.find((d) => d.name === "second_shop-shop")?.env.MCP_REMOTE_CONFIG_DIR;
    assert.ok(first && second);
    assert.notEqual(first, second);
    const archive = defs.find((d) => d.name === "first_shop-archive")?.env.MCP_REMOTE_CONFIG_DIR;
    assert.ok(archive);
    fs.mkdirSync(path.join(archive, "mcp-remote-v1"), { recursive: true });
    fs.writeFileSync(
      path.join(archive, "mcp-remote-v1", "00000000000000000000000000000000_tokens.json"),
      "synthetic-archive-session",
    );
    const oldCallback = await signIn("first_shop");
    await signIn("second_shop");
    const secondToken = path.join(second, "mcp-remote-v1", "00000000000000000000000000000000_tokens.json");
    const expected = fs.readFileSync(secondToken, "utf8");
    const paused = await env.client.call("extensions.enable", { id: "first_shop", enabled: false });
    assert.equal(paused.session?.saved, true);
    assert.ok(
      fs.existsSync(path.join(first, "mcp-remote-v1", "00000000000000000000000000000000_tokens.json")),
      "turning off retains the session",
    );
    await env.client.call("extensions.enable", { id: "first_shop", enabled: true });
    const disconnected = await env.client.call("extensions.disconnect", { id: "first_shop" });
    assert.equal(disconnected.enabled, true);
    assert.equal(disconnected.session?.saved, false);
    assert.equal(fs.existsSync(archive), false, "every managed session of this connector is cleared");
    assert.equal(fs.existsSync(first), false);
    assert.equal(fs.readFileSync(secondToken, "utf8"), expected);
    assert.equal((await status("second_shop-shop"))?.status, "ready");
    assert.equal((await status("first_shop-shop"))?.status, "needs-sign-in");
    assert.equal((await status("first_shop-shop"))?.sign_in_url, undefined);
    await assert.rejects(fetch(oldCallback), /fetch failed/);
    const checked = await env.client.call("mcp.test", { scope: "global", server: "first_shop-shop" });
    assert.equal(checked.ok, false);
    assert.equal(fs.existsSync(first), false, "a connection check cannot recreate the session");
    await env.client.call("extensions.enable", { id: "first_shop", enabled: false });
    await env.client.call("extensions.disconnect", { id: "first_shop" });
    await env.client.call("extensions.enable", { id: "first_shop", enabled: true });
    assert.equal((await status("first_shop-shop"))?.status, "needs-sign-in");
    await signIn("first_shop");
    assert.ok(fs.existsSync(path.join(first, "mcp-remote-v1", "00000000000000000000000000000000_tokens.json")));
    // A callback still waiting for approval is stopped too, not just an established transport.
    const latest = await env.client.call("extensions.disconnect", { id: "first_shop" });
    await env.client.call("mcp.signIn", {
      scope: "global",
      server: "first_shop-shop",
      connection_generation: latest.connection_generation,
    });
    const pendingCallback = fs.readFileSync(callbackFile("first_shop"), "utf8");
    await env.client.call("extensions.disconnect", { id: "first_shop" });
    await assert.rejects(fetch(pendingCallback), /fetch failed/);
    assert.equal(fs.existsSync(first), false);
    assert.equal(fs.readFileSync(secondToken, "utf8"), expected);
  } finally {
    await env.core.close();
    await env.cleanup();
    await source.remove();
  }
});

test("a disconnected connector stays signed out across a real core restart and definition changes", async () => {
  const source = tempDir("extension-session-restart-");
  const home = tempDir("extension-session-home-");
  let env = await startCore({ home: home.path, llm: scriptedLlm(() => say("ok")) });
  try {
    fs.writeFileSync(
      path.join(source.path, "apx-extension.json"),
      JSON.stringify({
        manifest: 2,
        id: "restart_shop",
        name: "Shop",
        version: "1.0.0",
        settings: [{ name: "region", label: "Region", type: "string", default: "one" }],
        mcp: {
          shop: {
            command: "npx",
            args: ["mcp-remote", "https://mcp.example.com"],
            env: { REGION: "setting://region" },
          },
        },
      }),
    );
    await env.client.call("extensions.install", { path: source.path });
    await env.client.call("extensions.enable", { id: "restart_shop", enabled: true });
    await env.client.call("extensions.disconnect", { id: "restart_shop" });
    await env.client.call("extensions.settings", { id: "restart_shop", values: { region: "two" } });
    await env.core.close();
    env = await startCore({ home: home.path, llm: scriptedLlm(() => say("ok")) });
    const health = await env.client.call("system.health", {});
    assert.equal(health.code_sha, env.core.identity.code_sha);
    const server = (await env.client.call("mcp.list", {})).servers.find((s) => s.name === "restart_shop-shop");
    assert.equal(server?.status, "needs-sign-in");
    assert.equal(server?.sign_in_url, undefined);
    assert.equal((await env.client.call("mcp.test", { scope: "global", server: "restart_shop-shop" })).ok, false);
  } finally {
    await env.core.close();
    await env.cleanup();
    await home.remove();
    await source.remove();
  }
});

test("a redirected connection folder cannot erase another connector's cache", async () => {
  const source = tempDir("extension-session-link-");
  const outside = tempDir("extension-session-protected-");
  const env = await startCore({ llm: scriptedLlm(() => say("ok")) });
  try {
    fs.writeFileSync(
      path.join(source.path, "apx-extension.json"),
      JSON.stringify({
        manifest: 2,
        id: "linked_shop",
        name: "Linked shop",
        version: "1.0.0",
        mcp: { shop: { command: "mcp-remote", args: ["https://mcp.example.com"] } },
      }),
    );
    await env.client.call("extensions.install", { path: source.path });
    const protectedFile = path.join(outside.path, "mcp-remote", "session.json");
    fs.mkdirSync(path.dirname(protectedFile), { recursive: true });
    fs.writeFileSync(protectedFile, "synthetic-other-session");
    fs.mkdirSync(path.join(env.home, "extension-data"), { recursive: true });
    fs.symlinkSync(
      outside.path,
      path.join(env.home, "extension-data", "linked_shop"),
      process.platform === "win32" ? "junction" : "dir",
    );
    await assert.rejects(env.client.call("extensions.disconnect", { id: "linked_shop" }), /symbolic link/);
    assert.equal(fs.readFileSync(protectedFile, "utf8"), "synthetic-other-session");
  } finally {
    await env.core.close();
    await env.cleanup();
    await outside.remove();
    await source.remove();
  }
});

test("disconnect refuses absent and non-session extensions without erasing settings", async () => {
  const source = tempDir("extension-no-session-");
  const env = await startCore({ llm: scriptedLlm(() => say("ok")) });
  try {
    fs.writeFileSync(
      path.join(source.path, "apx-extension.json"),
      JSON.stringify({
        manifest: 2,
        id: "key_only",
        name: "Key only",
        version: "1.0.0",
        settings: [{ name: "key", label: "API key", type: "string", sensitive: true }],
      }),
    );
    const installed = await env.client.call("extensions.install", { path: source.path });
    assert.equal(installed.session, undefined);
    await env.client.call("extensions.settings", { id: "key_only", values: { key: "synthetic-private-key" } });
    await assert.rejects(env.client.call("extensions.disconnect", { id: "missing" }), /not found/i);
    await assert.rejects(env.client.call("extensions.disconnect", { id: "key_only" }), /no managed sign-in session/i);
    const after = (await env.client.call("extensions.list", {})).extensions.find((e) => e.id === "key_only");
    assert.equal(after?.settings.find((s) => s.name === "key")?.set, true);
  } finally {
    await env.core.close();
    await env.cleanup();
    await source.remove();
  }
});
