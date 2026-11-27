import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { say, scriptedLlm, startCore } from "../engine/testkit.ts";
import { tempDir, waitFor } from "../testkit/platform.ts";

const BRIDGE = path.join(import.meta.dirname, "session-bridge.test-support.mjs");
const bridge = (callback: string, dir?: string) => ({
  command: "npx",
  args: ["-y", "mcp-remote", "https://mcp.example.com"],
  env: {
    NODE_OPTIONS: `--import=${pathToFileURL(BRIDGE).href}`,
    FIXTURE_CALLBACK_FILE: callback,
    ...(dir ? { MCP_REMOTE_CONFIG_DIR: dir } : {}),
  },
});

test("identical reinstall does not inherit a pending page; off and disconnect preserve their own boundaries", async () => {
  const source = tempDir("pending-reinstall-");
  const env = await startCore({ llm: scriptedLlm(() => say("ok")) });
  const callbackFile = (id: string) => path.join(source.path, `${id}.callback`);
  const write = (id: string) =>
    fs.writeFileSync(
      path.join(source.path, "apx-extension.json"),
      JSON.stringify({
        manifest: 2,
        id,
        name: "Shop",
        version: "1.0.0",
        mcp: { shop: bridge(callbackFile(id)) },
      }),
    );
  const status = async (id: string) =>
    (await env.client.call("mcp.list", {})).servers.find((s) => s.name === `${id}-shop`);
  const start = async (id: string) => {
    const current = (await env.client.call("extensions.list", {})).extensions.find((e) => e.id === id);
    const result = await env.client.call("mcp.signIn", {
      scope: "global",
      server: `${id}-shop`,
      connection_generation: current?.connection_generation,
    });
    assert.equal(result.server.status, "needs-sign-in");
    assert.ok(result.server.sign_in_url);
    return fs.readFileSync(callbackFile(id), "utf8");
  };
  try {
    for (const id of ["pending_shop", "other_shop"]) {
      write(id);
      await env.client.call("extensions.install", { path: source.path });
      await env.client.call("extensions.enable", { id, enabled: true });
    }
    const firstCallback = await start("pending_shop");
    const otherCallback = await start("other_shop");
    const otherUrl = (await status("other_shop"))?.sign_in_url;
    await env.client.call("extensions.enable", { id: "pending_shop", enabled: false });
    assert.equal(await status("pending_shop"), undefined);
    await env.client.call("extensions.enable", { id: "pending_shop", enabled: true });
    assert.equal((await status("pending_shop"))?.status, "needs-sign-in");
    assert.equal((await status("pending_shop"))?.sign_in_url, undefined);
    await assert.rejects(fetch(firstCallback), /fetch failed/);
    await env.client.call("extensions.disconnect", { id: "pending_shop" });
    await assert.rejects(
      env.client.call("mcp.describe", { scope: "global", server: "pending_shop-shop" }),
      /not connected/,
    );
    assert.equal(
      (await status("pending_shop"))?.sign_in_url,
      undefined,
      "disconnect must not reopen a page automatically",
    );
    const removedCallback = await start("pending_shop");
    await env.client.call("extensions.remove", { id: "pending_shop" });
    await assert.rejects(fetch(removedCallback), /fetch failed/);
    assert.equal((await status("other_shop"))?.sign_in_url, otherUrl);
    assert.equal((await status("other_shop"))?.status, "needs-sign-in");

    write("pending_shop");
    await env.client.call("extensions.install", { path: source.path });
    await env.client.call("extensions.enable", { id: "pending_shop", enabled: true });
    assert.equal(
      (await status("pending_shop"))?.status,
      "off",
      "the same package must not inherit an old pending-page marker",
    );
    await assert.rejects(
      env.client.call("mcp.describe", { scope: "global", server: "pending_shop-shop" }),
      /not connected/,
    );
    assert.ok((await status("pending_shop"))?.sign_in_url, "ordinary discovery starts a real fresh authorization page");
    const fresh = fs.readFileSync(callbackFile("pending_shop"), "utf8");
    assert.equal((await fetch(fresh)).status, 200);
    assert.equal((await fetch(otherCallback)).status, 200, "the other connector's existing page is still alive");
    for (const id of ["pending_shop", "other_shop"]) {
      await waitFor(async () => (await status(id))?.status === "ready", `${id} synthetic authorization completes`, {
        ms: 15000,
      });
      assert.ok(
        (await env.client.call("mcp.describe", { scope: "global", server: `${id}-shop` })).tools.some(
          (t) => t.name === "session_check",
        ),
      );
    }
  } finally {
    await env.core.close();
    await env.cleanup();
    await source.remove();
  }
});

test("uninstall does not clear the pending-page state of a legacy manual namesake", async () => {
  const source = tempDir("pending-manual-");
  const env = await startCore({ llm: scriptedLlm(() => say("ok")) });
  const manualCallback = path.join(source.path, "manual.callback");
  const manual = bridge(manualCallback, path.join(source.path, "manual-cache"));
  const status = async () =>
    (await env.client.call("mcp.list", {})).servers.find((s) => s.name === "manual_pending-shop");
  try {
    fs.writeFileSync(
      path.join(source.path, "apx-extension.json"),
      JSON.stringify({
        manifest: 2,
        id: "manual_pending",
        name: "Shop",
        version: "1.0.0",
        mcp: { shop: bridge(path.join(source.path, "extension.callback")) },
      }),
    );
    await env.client.call("extensions.install", { path: source.path });
    env.core.store.settings.set("mcp_servers", JSON.stringify({ mcpServers: { "manual_pending-shop": manual } }));
    await env.client.call("mcp.signIn", { scope: "global", server: "manual_pending-shop" });
    const before = (await status())?.sign_in_url;
    assert.ok(before);
    await env.client.call("extensions.remove", { id: "manual_pending" });
    assert.equal((await status())?.sign_in_url, before, "removing the extension does not stop the manual's page");
    await env.client.call("mcp.set", { name: "manual_pending-shop", server: { ...manual, enabled: false } });
    await env.client.call("mcp.set", { name: "manual_pending-shop", server: { ...manual, enabled: true } });
    assert.equal(
      (await status())?.status,
      "needs-sign-in",
      "the manual's durable pending marker survives the unrelated uninstall",
    );
    assert.equal((await status())?.sign_in_url, undefined);
    await env.client.call("mcp.signIn", { scope: "global", server: "manual_pending-shop" });
    assert.equal((await fetch(fs.readFileSync(manualCallback, "utf8"))).status, 200);
    await waitFor(async () => (await status())?.status === "ready", "manual synthetic authorization completes", {
      ms: 15000,
    });
  } finally {
    await env.core.close();
    await env.cleanup();
    await source.remove();
  }
});
