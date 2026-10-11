import assert from "node:assert/strict";
import { test } from "node:test";
import { mcpCommand } from "./mcp.ts";
import { printed, recordingClient } from "./testing.ts";

const servers = [
  { name: "notes", scope: "project", project_id: "acme" },
  { name: "github", scope: "global" },
];

test("apx mcps logs finds the server and prints its last lines, cleaned", async () => {
  const at = "2026-10-11T12:00:00.000Z";
  const { client, calls } = recordingClient({
    "mcp.list": { servers },
    "mcp.logs": { lines: [{ at, text: "missing \u001b[2Jconfig" }] },
  });
  const out = await printed(() => mcpCommand(client, ["logs", "notes"], { project: "acme", lines: "20" }));
  assert.deepEqual(calls.at(-1), ["mcp.logs", { scope: "project", server: "notes", project: "acme", lines: 20 }]);
  assert.equal(out, `${new Date(at).toLocaleTimeString()}  missing  [2Jconfig`);
});

test("apx mcps logs says when a server printed nothing, and checks -n and the server", async () => {
  const { client, calls } = recordingClient({ "mcp.list": { servers }, "mcp.logs": { lines: [] } });
  assert.match(await printed(() => mcpCommand(client, ["logs", "github"], {})), /github printed nothing/);
  assert.deepEqual(calls.at(-1), ["mcp.logs", { scope: "global", server: "github", lines: 100 }]);
  await assert.rejects(mcpCommand(client, ["logs", "github"], { lines: "0" }), /-n is a number/);
  await assert.rejects(mcpCommand(client, ["logs"], {}), /usage: apx mcps logs <server>/);
  await assert.rejects(mcpCommand(client, ["logs", "nobody"], {}), /MCP server nobody not found/);
});
