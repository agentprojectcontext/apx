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

test("apx mcps copy makes a server from another with the variables changed; set changes one in place", async () => {
  const cloud = {
    name: "cloudflare-acme",
    scope: "global",
    enabled: true,
    status: "ready",
    definition: {
      command: "npx",
      args: ["-y", "cloudflare-mcp"],
      env: { CLOUDFLARE_TOKEN: "secret://CF_TOKEN", CLOUDFLARE_ZONE_ID: "old" },
      headers: {},
    },
  };
  const { client, calls } = recordingClient({
    "mcp.list": { servers: [cloud] },
    "mcp.set": { servers: [{ name: "cloudflare-web", status: "starting" }] },
  });
  const out = await printed(() =>
    mcpCommand(client, ["copy", "cloudflare-acme", "cloudflare-web"], { env: ["CLOUDFLARE_ZONE_ID=new"] }),
  );
  assert.deepEqual(calls.at(-1), [
    "mcp.set",
    {
      name: "cloudflare-web",
      server: {
        command: "npx",
        args: ["-y", "cloudflare-mcp"],
        env: { CLOUDFLARE_TOKEN: "secret://CF_TOKEN", CLOUDFLARE_ZONE_ID: "new" },
      },
    },
  ]);
  assert.match(out, /cloudflare-web: starting · live from the next message/);

  await printed(() => mcpCommand(client, ["set", "cloudflare-acme"], { env: ["CLOUDFLARE_ZONE_ID=other"] }));
  assert.deepEqual(calls.at(-1)?.[1], {
    name: "cloudflare-acme",
    server: {
      command: "npx",
      args: ["-y", "cloudflare-mcp"],
      env: { CLOUDFLARE_TOKEN: "secret://CF_TOKEN", CLOUDFLARE_ZONE_ID: "other" },
      enabled: true,
    },
  });
  assert.match(await printed(() => mcpCommand(client, ["show", "cloudflare-acme"], {})), /"CLOUDFLARE_ZONE_ID": "old"/);
  await assert.rejects(mcpCommand(client, ["copy", "nobody", "x"], {}), /no MCP server nobody/);
  await assert.rejects(mcpCommand(client, ["set", "cloudflare-acme"], { env: ["NOEQUALS"] }), /NAME=value/);
});

test("apx mcps add takes its variables with --env", async () => {
  const { client, calls } = recordingClient({ "mcp.set": { servers: [{ name: "notes", status: "starting" }] } });
  await printed(() => mcpCommand(client, ["add", "notes", "notes-mcp", "--stdio"], { env: ["TOKEN=secret://NOTES"] }));
  assert.deepEqual(calls.at(-1), [
    "mcp.set",
    { name: "notes", server: { command: "notes-mcp", args: ["--stdio"], env: { TOKEN: "secret://NOTES" } } },
  ]);
});

test("apx mcps rename saves the server under the new name before removing the old one", async () => {
  const def = { command: "npx", args: ["x"], env: { TOKEN: "secret://T" }, headers: {} };
  const { client, calls } = recordingClient({
    "mcp.list": { servers: [{ name: "clodflare", scope: "global", enabled: true, status: "off", definition: def }] },
    "mcp.set": { servers: [] },
  });
  await printed(() => mcpCommand(client, ["rename", "clodflare", "cloudflare"], {}));
  const sets = calls.filter(([m]) => m === "mcp.set").map(([, p]) => p);
  assert.deepEqual(sets, [
    { name: "cloudflare", server: { command: "npx", args: ["x"], env: { TOKEN: "secret://T" }, enabled: true } },
    { name: "clodflare", server: null },
  ]);
});
