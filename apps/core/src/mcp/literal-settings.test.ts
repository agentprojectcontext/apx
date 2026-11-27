import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { say, scriptedLlm, startCore } from "../engine/testkit.ts";
import { tempDir } from "../testkit/platform.ts";

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
