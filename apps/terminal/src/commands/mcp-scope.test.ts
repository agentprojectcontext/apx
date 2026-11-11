import assert from "node:assert/strict";
import { test } from "node:test";
import { printed, recordingClient } from "./testing.ts";
import { mcps } from "./threads.ts";

test("scope edits private availability without losing headers, environment or disabled state", async () => {
  const definition = {
    url: "https://example.com/mcp",
    args: [],
    env: { MODE: "read" },
    headers: { Authorization: "Bearer secret://ACME" },
  };
  const { client, calls } = recordingClient({
    "mcp.list": { servers: [{ name: "acme", scope: "global", enabled: false, definition }] },
    "mcp.set": { servers: [] },
  });
  await printed(() => mcps(client, ["scope", "acme", "prj_1"]));
  await printed(() => mcps(client, ["scope", "acme", "global"]));
  assert.deepEqual(calls, [
    ["mcp.list", {}],
    ["mcp.set", { name: "acme", server: { ...definition, enabled: false, project: "prj_1" } }],
    ["mcp.list", {}],
    ["mcp.set", { name: "acme", server: { ...definition, enabled: false, project: null } }],
  ]);
  await assert.rejects(mcps(client, ["scope", "acme"]), /usage:/);
  await assert.rejects(mcps(client, ["scope", "acme", "global"], { project: "prj_1" }), /usage:/);
  assert.equal(calls.length, 4);
});
