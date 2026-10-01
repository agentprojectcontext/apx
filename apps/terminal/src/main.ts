#!/usr/bin/env node
// The terminal owns no domain logic: every command is a protocol call to the core.
import { parseArgs } from "node:util";
import { ApxClient, ApxError } from "@apx/protocol/client";
import { browser } from "./commands/browser.ts";
import { chat } from "./commands/chat.ts";
import { memory } from "./commands/memory.ts";
import { agentEdit, agentModel, models } from "./commands/models.ts";
import { agents, jobs, mcps, projects, runs, secrets, skills, threads, usage } from "./commands/threads.ts";

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

  apx2 chat "<text>" [--agent <id> | --thread <id>] [--new] [--detach] [--interrupt | --steer]
  apx2 chat "<text>" --code [--cwd <folder>] [--write ask|auto|read-only] [--agent <id>]   Code thread
  apx2 jobs [list] | get <job> | cancel <job>   Background work: agents' runs and terminal commands
  apx2 skills [project]    Skills agents can load
  apx2 memory [words]      Notes agents keep between threads (newest first, or the best matches for the words)
  apx2 memory add [global|project|agent] <text> [--project p] [--agent a]
  apx2 memory rm <id…>     Remove notes
  apx2 compact <thread>    Summarize a thread's older turns now (APX's own loop; Claude Code and Codex compact their own)
  apx2 usage [days]        Turns and tokens by model, and whether they were included or paid per token
  apx2 mcps [list [project]] | trust|untrust <project> <server> | add <name> <command…|url> | rm <name>
                           The one way to talk to an agent. Default: Home (the secretary)
  apx2 threads [list] | get <thread> | cancel <thread>
  apx2 runs get <run> | wait <run> [--timeout 60]
  apx2 runs pending [thread]   What agents are waiting on from you
  apx2 runs respond <input> approve|deny ["note"] | "<answer>"
  apx2 projects [list] | register <folder> | sync [project]
                           Projects are folders with AGENTS.md / .apc/; their agents come from those files
  apx2 agents              Agents and the model each one runs on
  apx2 agents new <slug> "<Name>" [--project <id>] [--role "<role>"]
  apx2 agents set <agent> name=… role=… slug=… parent=… blob=…
  apx2 agents archive <agent>         Project agents: changes are written to .apc/agents/<slug>.md
  apx2 agents model <agent> <engine/model | engine | router | default> [--router]
                           An agent's model; --router keeps the router as its fallback

  apx2 models [--refresh]  Every engine and the models it offers (asked to the engine)
  apx2 models config       The install default and the router
  apx2 models default <engine/model | engine | router> [--router]
  apx2 models chain <ref> [<ref>…]      The router's fallback chain, in order
  apx2 models rules < rules.json        The router's rules (JSON on stdin)

  apx2 secrets [list] | set <name> (value on stdin) | rm <name>
  apx2 import-v1 [--keys] [--skills]
                           Register the project folders a local APX v1 knows (read-only); --keys also copies
                           its model API keys into v2's secret store, --skills its skills into v2's home, once

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
    steer: { type: "boolean" },
    code: { type: "boolean" },
    cwd: { type: "string" },
    write: { type: "string" },
    keys: { type: "boolean" },
    skills: { type: "boolean" },
    refresh: { type: "boolean" },
    project: { type: "string" },
    role: { type: "string" },
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
    case "jobs":
      await jobs(client, rest);
      break;
    case "skills":
      await skills(client, rest);
      break;
    case "compact": {
      if (!rest[0]) throw new Error("usage: apx2 compact <thread>");
      const r = await client.call("threads.compact", { thread: rest[0] });
      console.log(r.compacted ? "summarized" : `not summarized: ${r.reason ?? ""}`);
      break;
    }
    case "memory":
      await memory(client, rest, { project: values.project, agent: values.agent, json: values.json });
      break;
    case "usage":
      await usage(client, rest);
      break;
    case "mcps":
      await mcps(client, rest);
      break;
    case "agents":
      if (rest[0] === "model") await agentModel(client, rest.slice(1), values);
      else if (rest[0] && rest[0] !== "list") await agentEdit(client, rest, values);
      else await agents(client);
      break;
    case "projects":
      await projects(client, rest);
      break;
    case "models":
      await models(client, rest, values);
      break;
    case "secrets":
      await secrets(client, rest);
      break;
    case "import-v1": {
      const r = await client.call("system.import_v1", { keys: values.keys ?? false, skills: values.skills ?? false });
      console.log(
        `imported ${r.projects} projects, ${r.agents} agents${r.keys.length ? `; keys: ${r.keys.join(", ")}` : ""}${r.skills.length ? `; ${r.skills.length} skills` : ""}`,
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
