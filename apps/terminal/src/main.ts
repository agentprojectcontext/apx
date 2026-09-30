#!/usr/bin/env node
// The terminal owns no domain logic: every command is a protocol call to the core.
import { parseArgs } from "node:util";
import { ApxClient, ApxError } from "@apx/protocol/client";

const HELP = `apx2 — APX v2 terminal

Usage:
  apx2 status [--json]     Is the core up, and is it running my code?
  apx2 ping [text]         Round-trip over the live socket

Env: APX_URL (default http://127.0.0.1:7440), APX_TOKEN`;

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { json: { type: "boolean" }, help: { type: "boolean", short: "h" } },
});
const [command, ...rest] = positionals;
const client = new ApxClient({
  url: process.env.APX_URL ?? "http://127.0.0.1:7440",
  ...(process.env.APX_TOKEN ? { token: process.env.APX_TOKEN } : {}),
  client: { name: "apx2-terminal", version: "0.0.0" },
});

try {
  switch (values.help ? "help" : command) {
    case "status": {
      const h = await client.call("system.health", {});
      if (values.json) {
        console.log(JSON.stringify(h, null, 2));
        break;
      }
      console.log(`apx core ${h.version} · ${h.code_sha} · up ${h.uptime_s}s`);
      for (const [name, s] of Object.entries(h.subsystems))
        console.log(`  ${name.padEnd(12)} ${s.status}${s.detail ? ` — ${s.detail}` : ""}`);
      break;
    }
    case "ping": {
      const socket = await client.connect();
      const r = await socket.call("system.ping", rest[0] ? { echo: rest[0] } : {});
      console.log(`${r.pong} (${r.at})`);
      socket.close();
      break;
    }
    default:
      console.log(HELP);
      process.exitCode = command && command !== "help" ? 1 : 0;
  }
} catch (err) {
  if (err instanceof ApxError) console.error(`apx2: ${err.code}: ${err.message}`);
  else if (err instanceof TypeError && String(err.cause ?? "").includes("ECONNREFUSED"))
    console.error("apx2: the core is not running (try: pnpm dev)");
  else console.error(`apx2: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
}
