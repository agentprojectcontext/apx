import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { say, scriptedLlm, startCore } from "../engine/testkit.ts";
import { tempDir } from "../testkit/platform.ts";
import { mcpApproval, mcpServerApproval } from "./approval.ts";
import { mcpConfig } from "./config.ts";

test("extension connectors without setting substitutions keep their existing trust and approval keys", async () => {
  await using source = tempDir("apx-stable-approval-");
  const env = await startCore({ llm: scriptedLlm(() => say("ok")) });
  try {
    const server = { command: process.execPath, args: [], env: {}, headers: {} };
    fs.writeFileSync(
      path.join(source.path, "apx-extension.json"),
      JSON.stringify({
        manifest: 2,
        id: "stable",
        name: "Stable connector",
        version: "1.0.0",
        mcp: { fixture: server },
      }),
    );
    await env.client.call("extensions.install", { path: source.path });
    await env.client.call("extensions.enable", { id: "stable", enabled: true });
    const config = mcpConfig(env.core.store);
    const def = config.global().find((d) => d.name === "stable-fixture");
    assert.ok(def);
    await env.client.call("mcp.set", { name: "baseline", server });
    const baseline = config.global().find((d) => d.name === "baseline");
    assert.ok(baseline);
    const existing = { ...baseline, name: def.name };
    const tool = { name: "echo", inputSchema: {}, annotations: { readOnlyHint: true } };
    assert.equal(def.hash, existing.hash);
    assert.equal(mcpApproval(def, tool).key, mcpApproval(existing, tool).key);
    assert.equal(mcpServerApproval(def).key, mcpServerApproval(existing).key);
    config.setTrust(existing, true);
    assert.equal(config.trusted(def), true);
  } finally {
    await env.core.close();
    await env.cleanup();
  }
});

test("resolved secrets containing literal markers reach the child unchanged", async () => {
  await using source = tempDir("apx-single-pass-");
  const env = await startCore({ llm: scriptedLlm(() => say("ok")) });
  try {
    fs.writeFileSync(
      path.join(source.path, "apx-extension.json"),
      JSON.stringify({
        manifest: 2,
        id: "markers",
        name: "Marker connector",
        version: "1.0.0",
        secrets: [{ name: "token", label: "Token" }],
        settings: [{ name: "text", label: "Text", type: "string" }],
        mcp: {
          fixture: {
            command: process.execPath,
            args: [path.join(import.meta.dirname, "fake-server.test-support.mjs")],
            env: { NOTES_TOKEN: "secret://token|setting://text" },
          },
        },
      }),
    );
    await env.client.call("extensions.install", { path: source.path });
    await env.client.call("extensions.settings", { id: "markers", values: { text: "plain secret://untouched" } });
    await env.client.call("secrets.set", { name: "ext-markers-token", value: "synthetic-{{apx-literal-0}}" });
    await env.client.call("extensions.enable", { id: "markers", enabled: true });
    const result = await env.client.call("mcp.call", {
      scope: "global",
      server: "markers-fixture",
      tool: "token",
      arguments: {},
    });
    assert.match(
      String(result.content?.[0]?.text),
      /token=synthetic-\{\{apx-literal-0\}\}\|plain secret:\/\/untouched leaked=no/,
    );
  } finally {
    await env.core.close();
    await env.cleanup();
  }
});

test("plain extension settings reach a child as literal text, including reference-like text", async () => {
  await using source = tempDir("apx-literal-setting-");
  const env = await startCore({ llm: scriptedLlm(() => say("ok")) });
  try {
    fs.writeFileSync(
      path.join(source.path, "apx-extension.json"),
      JSON.stringify({
        manifest: 2,
        id: "literal",
        name: "Literal settings",
        version: "1.0.0",
        settings: [{ name: "text", label: "Text", type: "string" }],
        mcp: {
          fixture: {
            command: process.execPath,
            args: [path.join(import.meta.dirname, "fake-server.test-support.mjs")],
            env: { NOTES_TOKEN: "setting://text" },
          },
        },
      }),
    );
    await env.client.call("extensions.install", { path: source.path });
    const target = { scope: "global" as const, server: "literal-fixture" };
    await env.client.call("secrets.set", { name: "literal_fixture", value: "fixture value must not be substituted" });
    for (const text of ["ordinary text", "env:ACME_LITERAL", "setting://literal", "secret://literal_fixture"]) {
      await env.client.call("extensions.settings", { id: "literal", values: { text } });
      await env.client.call("extensions.enable", { id: "literal", enabled: true });
      const result = await env.client.call("mcp.call", { ...target, tool: "token", arguments: {} });
      assert.ok(String(result.content?.[0]?.text).includes(`token=${text} leaked=no`));
    }
  } finally {
    await env.core.close();
    await env.cleanup();
  }
});
