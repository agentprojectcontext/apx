import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { say, scriptedLlm, startCore } from "../engine/testkit.ts";

const SERVER = path.join(import.meta.dirname, "fake-server.test-support.mjs");

test("permission status reports only current owner-wide grants without starting servers on list", async () => {
  const env = await startCore({ llm: scriptedLlm(() => say("ok")) });
  const target = { scope: "global" as const, server: "permissions" };
  const status = async () => (await env.client.call("mcp.list", {})).servers.find((s) => s.name === target.server);
  try {
    await env.client.call("mcp.set", { name: target.server, server: { command: process.execPath, args: [SERVER] } });
    assert.equal((await status())?.tool_permission_mode, "unknown");
    assert.equal((await status())?.status, "off");
    const { tools } = await env.client.call("mcp.tools", target);
    assert.equal((await status())?.tool_permission_mode, "ask");
    const [tool] = tools;
    assert.ok(tool);
    env.core.store.approvals.grant(
      { ...tool, tool: tool.name, server: JSON.stringify(["global", "", target.server]) },
      "always",
      "",
      "roby",
    );
    assert.equal((await status())?.tool_permission_mode, "ask", "one agent's grant is not owner-wide");
    await env.client.call("mcp.approveTool", { ...target, tool: "echo" });
    assert.equal((await status())?.tool_permission_mode, "some");
    await env.client.call("mcp.approveTool", { ...target, tool: "token" });
    assert.equal((await status())?.tool_permission_mode, "all");
    for (const tool of tools) await env.client.call("tools.revoke", { key: tool.key });
    assert.equal((await status())?.tool_permission_mode, "ask");
    await env.client.call("mcp.approveTool", { ...target, tool: "echo" });
    await env.client.call("mcp.set", {
      name: target.server,
      server: { command: process.execPath, args: [SERVER], env: { MODE: "changed" } },
    });
    assert.equal((await status())?.tool_permission_mode, "unknown");
    await env.client.call("mcp.tools", target);
    assert.equal((await status())?.tool_permission_mode, "ask", "new contracts invalidate old grants");
  } finally {
    await env.core.close();
    await env.cleanup();
  }
});

test("a server that does not start answers its tools with why, not as a failed call", async () => {
  const env = await startCore({ llm: scriptedLlm(() => say("ok")) });
  const target = { scope: "global" as const, server: "missing" };
  try {
    await env.client.call("mcp.set", { name: target.server, server: { command: "apx-no-such-command" } });
    const { tools, error } = await env.client.call("mcp.tools", target);
    assert.deepEqual(tools, []);
    assert.match(error ?? "", /ENOENT/);
    await assert.rejects(env.client.call("mcp.approveTool", { ...target, tool: "echo" }), /ENOENT/);
  } finally {
    await env.core.close();
    await env.cleanup();
  }
});
