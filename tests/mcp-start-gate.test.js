// Cold-starts that share an npm/npx cache dir must be serialized so two MCPs
// with the same command+args (e.g. the same npx package registered in two
// projects with different env) never install into that dir concurrently. This
// exercises the per-spec start gate in core/mcp/runner.js with a fake stdio
// MCP that records when each instance enters and leaves its "install" window.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { makeTempProject, cleanupTempProject } from "./_helpers.js";
import { McpRegistry } from "#core/mcp/runner.js";

// A minimal stdio MCP server. On boot it appends START, busy-waits to simulate
// the cache-touching install phase, appends READY, then speaks just enough
// JSON-RPC to satisfy initialize + tools/list.
const FAKE_MCP = `
const fs = require("node:fs");
const LOG = process.env.LOG, SLOT = process.env.SLOT;
const stamp = (tag) => fs.appendFileSync(LOG, tag + " " + SLOT + " " + process.hrtime.bigint() + "\\n");
stamp("START");
const until = Date.now() + 150;
while (Date.now() < until) {} // block the loop like an npm install would
stamp("READY");
let buf = "";
process.stdin.on("data", (d) => {
  buf += d;
  let i;
  while ((i = buf.indexOf("\\n")) >= 0) {
    const line = buf.slice(0, i); buf = buf.slice(i + 1);
    if (!line.trim()) continue;
    const msg = JSON.parse(line);
    if (msg.method === "initialize") {
      process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { protocolVersion: "2024-11-05", capabilities: {}, serverInfo: { name: "fake", version: "0" } } }) + "\\n");
    } else if (msg.method === "tools/list") {
      process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { tools: [] } }) + "\\n");
    }
  }
});
`;

test("cold-starts sharing a command+args spec are serialized, not concurrent", async () => {
  const root = makeTempProject({ name: "gate" });
  const scriptPath = path.join(root, "fake-mcp.js");
  fs.writeFileSync(scriptPath, FAKE_MCP);
  const logPath = path.join(root, "starts.log");
  fs.writeFileSync(logPath, "");

  // Two entries, IDENTICAL command+args (so they share a start gate) but
  // different env — exactly the shape of one npx package registered twice.
  const entry = (slot) => ({
    command: process.execPath,
    args: [scriptPath],
    env: { LOG: logPath, SLOT: slot },
    enabled: true,
  });
  fs.writeFileSync(
    path.join(root, ".apc", "mcps.json"),
    JSON.stringify({ mcpServers: { a: entry("a"), b: entry("b") } }, null, 2)
  );

  const registry = new McpRegistry(root);
  try {
    await Promise.all([registry.listTools("a"), registry.listTools("b")]);

    const events = fs.readFileSync(logPath, "utf8").trim().split("\n").map((l) => {
      const [tag, slot, ts] = l.split(" ");
      return { tag, slot, ts: BigInt(ts) };
    });
    const at = (tag, slot) => events.find((e) => e.tag === tag && e.slot === slot).ts;

    // Both instances booted...
    assert.equal(events.filter((e) => e.tag === "START").length, 2);
    assert.equal(events.filter((e) => e.tag === "READY").length, 2);

    // ...but their install windows must not overlap: whoever started second
    // did so only after the first finished its window (READY).
    const overlaps =
      at("START", "a") < at("READY", "b") && at("START", "b") < at("READY", "a");
    assert.equal(overlaps, false, "cold-start windows overlapped — gate did not serialize them");
  } finally {
    registry.shutdown();
    cleanupTempProject(root);
  }
});
