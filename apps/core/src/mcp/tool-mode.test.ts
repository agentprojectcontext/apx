import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { say, scriptedLlm, startCore } from "../engine/testkit.ts";
import { tempDir } from "../testkit/platform.ts";

const SERVER = path.join(import.meta.dirname, "fake-server.test-support.mjs");

async function setup() {
  const env = await startCore({ llm: scriptedLlm(() => say("ok")) });
  const dir = tempDir("apx-mcp-mode-");
  const extra = path.join(dir.path, "extra-tool");
  const target = { scope: "global" as const, server: "notes" };
  await env.client.call("mcp.set", {
    name: target.server,
    server: { command: process.execPath, args: [SERVER], env: { EXTRA_TOOL_FILE: extra } },
  });
  const status = async () => (await env.client.call("mcp.list", {})).servers.find((s) => s.name === target.server);
  /** The server comes back with one more tool, as a real one does after an update. */
  const addTool = async (name: string) => {
    fs.writeFileSync(extra, name);
    await env.client.call("mcp.signIn", target);
  };
  return {
    env,
    target,
    status,
    addTool,
    clean: async () => {
      await env.core.close();
      await env.cleanup();
      await dir.remove();
    },
  };
}

test("allow all stays all: tools a server adds later are allowed too", async () => {
  const { env, target, status, addTool, clean } = await setup();
  try {
    const before = await env.client.call("mcp.tools", target);
    assert.equal(before.mode, "ask");
    const { server } = await env.client.call("mcp.toolMode", { ...target, mode: "all" });
    assert.equal(server.tool_permission_mode, "all");
    await addTool("later");
    const after = await env.client.call("mcp.tools", target);
    assert.deepEqual(
      after.tools.map((t) => [t.name, t.approved]),
      [
        ["echo", true],
        ["token", true],
        ["later", true],
      ],
    );
    assert.equal(after.mode, "all");
    assert.equal((await status())?.tool_permission_mode, "all");

    await env.client.call("mcp.toolMode", { ...target, mode: "ask" });
    const asked = await env.client.call("mcp.tools", target);
    assert.ok(asked.tools.every((t) => !t.approved));
    assert.equal(asked.mode, "ask");
  } finally {
    await clean();
  }
});

test("a pick of some tools keeps new ones asking, even when every tool was picked", async () => {
  const { env, target, status, addTool, clean } = await setup();
  try {
    await env.client.call("mcp.tools", target);
    await env.client.call("mcp.approveTool", { ...target, tool: "echo" });
    await env.client.call("mcp.approveTool", { ...target, tool: "token" });
    // Each tool picked one by one is still a pick: the next tool asks, so the server says "some".
    assert.equal((await status())?.tool_permission_mode, "some");
    await addTool("newer");
    const { tools, mode } = await env.client.call("mcp.tools", target);
    assert.equal(tools.find((t) => t.name === "newer")?.approved, false);
    assert.equal(mode, "some");
  } finally {
    await clean();
  }
});

test("the list tells a server's tools and permissions before it starts again", async () => {
  const { env, target, status, clean } = await setup();
  try {
    assert.equal((await status())?.tool_permission_mode, "unknown");
    await env.client.call("mcp.tools", target);
    await env.client.call("mcp.toolMode", { ...target, mode: "all" });
    // Saving it again closes the connection (its definition is the same, so its grants stay).
    await env.client.call("mcp.set", {
      name: target.server,
      server: {
        command: process.execPath,
        args: [SERVER],
        env: { EXTRA_TOOL_FILE: (await status())?.definition?.env.EXTRA_TOOL_FILE ?? "" },
      },
    });
    const s = await status();
    assert.equal(s?.status, "off");
    assert.deepEqual(s?.tool_names, ["echo", "token"]);
    assert.equal(s?.tools, 2);
    assert.equal(s?.tool_permission_mode, "all");
    // A changed definition is another server: what was seen of the old one is not shown for it.
    await env.client.call("mcp.set", {
      name: target.server,
      server: { command: process.execPath, args: [SERVER], env: { MODE: "changed" } },
    });
    assert.deepEqual((await status())?.tool_names, []);
    assert.equal((await status())?.tool_permission_mode, "unknown");
  } finally {
    await clean();
  }
});

test("a global server narrowed to some projects says so, and moves into a project and back", async () => {
  const env = await startCore({ llm: scriptedLlm(() => say("ok")) });
  const a = tempDir("apx-mcp-a-");
  const b = tempDir("apx-mcp-b-");
  const status = async (project?: string) =>
    (await env.client.call("mcp.list", project ? { project } : {})).servers.find((s) => s.name === "acme");
  const server = { url: "https://mcp.example.com/mcp", headers: { "x-api-key": "secret://ACME_KEY" } };
  try {
    for (const dir of [a, b]) fs.mkdirSync(path.join(dir.path, ".apc"));
    const pa = (await env.client.call("projects.register", { path: a.path })).project.id;
    const pb = (await env.client.call("projects.register", { path: b.path })).project.id;
    await env.client.call("mcp.set", { name: "acme", server });
    assert.deepEqual((await status())?.off_in, []);
    // Turned off in one project with its switch: the list no longer says "everywhere".
    await env.client.call("mcp.toggle", { project: pa, server: "acme", on: false });
    assert.deepEqual((await status())?.off_in, [pa]);
    // The edit dialog sets every project at once.
    await env.client.call("mcp.set", { name: "acme", server: { ...server, off_in: [pb] } });
    assert.deepEqual((await status())?.off_in, [pb]);
    assert.equal((await status(pa))?.off_here, false);
    assert.equal((await status(pb))?.off_here, true);
    // Moved into one project: it lives there, with no switches left behind.
    await env.client.call("mcp.set", { name: "acme", server: { ...server, project: pa } });
    assert.equal((await status())?.only, true);
    assert.equal((await status())?.project_id, pa);
    assert.deepEqual((await status())?.off_in, []);
    assert.equal(await status(pb), undefined);
    // And back to global: every project gets it.
    await env.client.call("mcp.set", { name: "acme", server: { ...server, project: null } });
    assert.equal((await status())?.only, false);
    assert.equal((await status(pb))?.off_here, false);
    await assert.rejects(
      env.client.call("mcp.set", { name: "acme", project: pa, server: { command: "node", off_in: [pb] } }),
      /private availability/,
    );
  } finally {
    await env.core.close();
    await env.cleanup();
    await a.remove();
    await b.remove();
  }
});
