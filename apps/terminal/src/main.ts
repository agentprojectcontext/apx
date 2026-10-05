#!/usr/bin/env node
// The terminal owns no domain logic: every command is a protocol call to the core.
import { parseArgs } from "node:util";
import { ApxClient, ApxError } from "@apx/protocol/client";
import { browser } from "./commands/browser.ts";
import { channels, contacts, pairing } from "./commands/channels.ts";
import { chat } from "./commands/chat.ts";
import { clients } from "./commands/clients.ts";
import { expose } from "./commands/expose.ts";
import { extensions } from "./commands/extensions.ts";
import { localConnection } from "./commands/local.ts";
import { memory } from "./commands/memory.ts";
import { agentEdit, agentModel, models } from "./commands/models.ts";
import { notifications } from "./commands/notifications.ts";
import { pair } from "./commands/pair.ts";
import { routines } from "./commands/routines.ts";
import { installRuntimeSkills } from "./commands/runtime-skills.ts";
import { service } from "./commands/service.ts";
import { importV1, setupHeadless } from "./commands/setup.ts";
import { tasks } from "./commands/tasks.ts";
import { agents, jobs, mcps, projects, runs, secrets, skills, threads, usage } from "./commands/threads.ts";

const HELP = `apx — APX v2 terminal (also apx2)

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
  apx2 skills install-runtimes [--dry-run]
                           Install (or refresh) the skills that teach Claude Code, Codex, Cursor and ~/.agents how to
                           use APX; removes skills APX no longer ships, never anyone else's
  apx2 tasks [add|move|done|say]  The office board (apx2 tasks help)
  apx2 routines [add|run|on|off|rm|log]  Scheduled work (apx2 routines help)
  apx2 notifications [read]       What is waiting for you
  apx2 clients [add <name>|rm <id>]  Outside apps with their own token (Claude Code, Codex…)
  apx2 extensions [inspect|install|on|off|secret|rm]  Skills, MCP servers and routines in one folder
  apx2 memory [words]      Notes agents keep between threads (newest first, or the best matches for the words)
  apx2 memory add [global|project|agent] <text> [--project p] [--agent a]
  apx2 memory rm <id…>     Remove notes
  apx2 channels [add|rm|outbox]   Channels (Telegram bots); apx2 channels add telegram <id> --agent <a>
  apx2 contacts [add|block|rm]    People APX talks to on channels
  apx2 pairing [me|ok|no <code>]  Approve who wrote to a channel
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
  apx2 import-v1 [--keys] [--skills] [--services]
                           Register the project folders a local APX v1 knows (read-only); --keys also copies
                           its model API keys into v2's secret store, --skills its skills, --services its
                           image engines and voices, once

  apx2 service install|uninstall|status|restart
                           Run the core in the background (systemd, launchd or a Windows login entry), started at
                           login and again if it dies
  apx2 expose tailscale|lan|off|status
                           Who may reach the core: your tailnet (https://<machine>.ts.net), the network, or only
                           this computer. Writes <home>/core.env; restart the core afterwards
  apx2 pair                A one-time code and link to connect a phone or another computer
  apx2 setup --headless [--import [--keys] [--skills] [--services]] [--expose tailscale|lan]
                           A server with no desktop: service, optional import, optional exposure, then a pair code

  apx2 mcp [--by <agent>]  Stdio MCP server exposing browser_* tools (for Claude Code, Codex…); with
                           APX_CLIENT_TOKEN also apx_agents / apx_ask / apx_read (apx2 clients add <name>)
  apx2 mcp --run           The tools of one agent run (APX_RUN_TOKEN), for an external harness

Env: APX_URL (default http://127.0.0.1:<APX_PORT or 7440>), APX_TOKEN (default: the one in <home>/core.env),
     APX_HOME (default ~/.apx/v2)`;

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
    services: { type: "boolean" },
    refresh: { type: "boolean" },
    project: { type: "string" },
    cron: { type: "string" },
    clear: { type: "boolean" },
    scopes: { type: "string" },
    person: { type: "string" },
    owed: { type: "string" },
    due: { type: "string" },
    every: { type: "string" },
    at: { type: "string" },
    pre: { type: "string" },
    post: { type: "string" },
    call: { type: "string" },
    role: { type: "string" },
    router: { type: "boolean" },
    timeout: { type: "string" },
    run: { type: "boolean" },
    headless: { type: "boolean" },
    import: { type: "boolean" },
    expose: { type: "string" },
    home: { type: "string" },
    "dry-run": { type: "boolean" },
  },
});
const [command, ...rest] = positionals;
const connection = localConnection();
const terminalClient = () =>
  new ApxClient({ ...localConnection(), client: { name: "apx2-terminal", version: "0.0.0" } });
const client = terminalClient();
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
      if (rest[0] === "install-runtimes") installRuntimeSkills({ dryRun: values["dry-run"] });
      else await skills(client, rest);
      break;
    case "channels":
      await channels(client, rest, { agent: values.agent });
      break;
    case "contacts":
      await contacts(client, rest);
      break;
    case "pairing":
      await pairing(client, rest);
      break;
    case "compact": {
      if (!rest[0]) throw new Error("usage: apx2 compact <thread>");
      const r = await client.call("threads.compact", { thread: rest[0] });
      console.log(r.compacted ? "summarized" : `not summarized: ${r.reason ?? ""}`);
      break;
    }
    case "tasks":
      await tasks(client, rest, {
        project: values.project,
        agent: values.agent,
        person: values.person,
        owed: values.owed,
        due: values.due,
      });
      break;
    case "clients":
      await clients(client, rest, { scopes: values.scopes });
      break;
    case "extensions":
      await extensions(client, rest, { clear: values.clear });
      break;
    case "notifications":
      await notifications(client, rest);
      break;
    case "routines":
      await routines(client, rest, {
        project: values.project,
        agent: values.agent,
        cron: values.cron,
        every: values.every,
        at: values.at,
        pre: values.pre,
        post: values.post,
        call: values.call,
      });
      break;
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
    case "import-v1":
      await importV1(client, {
        keys: values.keys ?? false,
        skills: values.skills ?? false,
        services: values.services ?? false,
      });
      break;
    case "service":
      await service(rest[0], { home: values.home });
      break;
    case "expose":
      await expose(rest[0]);
      break;
    case "pair":
      await pair(client);
      break;
    case "setup":
      await setupHeadless(terminalClient, {
        headless: values.headless,
        expose: values.expose,
        import: values.import
          ? { keys: values.keys ?? false, skills: values.skills ?? false, services: values.services ?? false }
          : undefined,
      });
      break;
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
      // An outside app's token (Settings › MCP › Outside apps) comes in the environment, never on the command line.
      const clientToken = process.env.APX_CLIENT_TOKEN;
      const mcpClient = clientToken
        ? new ApxClient({ ...connection, client: { name: "apx2-mcp", version: "0.0.0" }, clientToken })
        : agentClient;
      await runMcp(mcpClient, values.by ?? "mcp-client", Boolean(clientToken));
      break;
    }
    default:
      console.log(HELP);
      process.exitCode = command && command !== "help" ? 1 : 0;
  }
} catch (err) {
  if (err instanceof ApxError) console.error(`apx2: ${err.code}: ${err.message}`);
  else if (err instanceof TypeError && String(err.cause ?? "").includes("ECONNREFUSED"))
    console.error("apx2: the core is not running (try: apx2 service install, or pnpm dev)");
  else console.error(`apx2: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
}
