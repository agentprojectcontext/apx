#!/usr/bin/env node
// The terminal owns no domain logic: every command is a protocol call to the core.
import { parseArgs } from "node:util";
import { ApxClient, ApxError } from "@apx/protocol/client";
import { browser } from "./commands/browser.ts";
import { chat } from "./commands/chat.ts";
import { agentModel, models } from "./commands/models.ts";
import { agents, runs, secrets, threads } from "./commands/threads.ts";

const HELP = `apx2 — APX v2 terminal

Usage:
  apx2 status [--json]     Is the core up, and is it running my code?
  apx2 ping [text]         Round-trip over the live socket

  apx2 browser tabs
  apx2 browser open <url> [--profile shared|incognito|agent:<id>] [--by <agent>]
  apx2 browser nav <tab> <url>
  apx2 browser snapshot <tab>
  apx2 browser click <tab> <ref>
  apx2 browser type <tab> <ref> <text> [--submit]
  apx2 browser shot <tab> <file.jpg>
  apx2 browser close <tab>
  apx2 browser control <tab> user|idle|done
  apx2 browser cookies                          List browsers whose sessions can be imported
  apx2 browser cookies <source> [filter]        Domains with cookies (counts only)
  apx2 browser import <source> <domain,…> [--profile shared|agent:<id>]

  apx2 chat "<text>" [--agent <id> | --thread <id>] [--new] [--detach] [--interrupt]
                           The one way to talk to an agent. Default: Home (the secretary)
  apx2 threads [list] | get <thread> | cancel <thread>
  apx2 runs get <run> | wait <run> [--timeout 60]
  apx2 agents              Agents and the model each one runs on
  apx2 agents model <agent> <engine/model | engine | router | default> [--router]
                           An agent's model; --router keeps the router as its fallback

  apx2 models [--refresh]  Every engine and the models it offers (asked to the engine)
  apx2 models config       The install default and the router
  apx2 models default <engine/model | engine | router> [--router]
  apx2 models chain <ref> [<ref>…]      The router's fallback chain, in order
  apx2 models rules < rules.json        The router's rules (JSON on stdin)

  apx2 secrets [list] | set <name> (value on stdin) | rm <name>
  apx2 import-v1 [--keys]  Import projects and agents from a local APX v1 (read-only);
                           --keys also copies its model API keys into v2's secret store, once

  apx2 mcp [--by <agent>]  Stdio MCP server exposing browser_* tools (for Claude Code, Codex…)
  apx2 mcp --run           The tools of one agent run (APX_RUN_TOKEN), for an external harness

Env: APX_URL (default http://127.0.0.1:7440), APX_TOKEN`;

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    json: { type: "boolean" },
    help: { type: "boolean", short: "h" },
    profile: { type: "string" },
    by: { type: "string" },
    submit: { type: "boolean" },
    thread: { type: "string" },
    agent: { type: "string" },
    new: { type: "boolean" },
    detach: { type: "boolean" },
    interrupt: { type: "boolean" },
    keys: { type: "boolean" },
    refresh: { type: "boolean" },
    router: { type: "boolean" },
    timeout: { type: "string" },
    run: { type: "boolean" },
  },
});
const [command, ...rest] = positionals;
const connection = {
  url: process.env.APX_URL ?? "http://127.0.0.1:7440",
  ...(process.env.APX_TOKEN ? { token: process.env.APX_TOKEN } : {}),
};
const client = new ApxClient({ ...connection, client: { name: "apx2-terminal", version: "0.0.0" } });
/** MCP servers are driven by a model: the core never gives them the owner's controls. */
const agentClient = new ApxClient({ ...connection, client: { name: "apx2-mcp", version: "0.0.0" }, actor: "agent" });

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
    case "browser":
      await browser(client, values, rest);
      break;
    case "chat":
      await chat(client, rest.join(" "), values);
      break;
    case "threads":
      await threads(client, rest);
      break;
    case "runs":
      await runs(client, rest, Number(values.timeout ?? 60));
      break;
    case "agents":
      if (rest[0] === "model") await agentModel(client, rest.slice(1), values);
      else await agents(client);
      break;
    case "models":
      await models(client, rest, values);
      break;
    case "secrets":
      await secrets(client, rest);
      break;
    case "import-v1": {
      const r = await client.call("system.import_v1", { keys: values.keys ?? false });
      console.log(
        `imported ${r.projects} projects, ${r.agents} agents${r.keys.length ? `; keys: ${r.keys.join(", ")}` : ""}`,
      );
      break;
    }
    case "mcp": {
      if (values.run) {
        // The run token comes in the environment, never on the command line.
        const token = process.env.APX_RUN_TOKEN;
        if (!token) throw new Error("apx2 mcp --run needs APX_RUN_TOKEN");
        const { runRunMcp } = await import("./mcp-run.ts");
        await runRunMcp(agentClient, token);
        break;
      }
      const { runMcp } = await import("./mcp.ts");
      await runMcp(agentClient, values.by ?? "mcp-client");
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
