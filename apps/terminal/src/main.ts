#!/usr/bin/env node
import { parseArgs } from "node:util";
import { ApxClient, ApxError } from "@apx/protocol/client";
// The terminal owns no domain logic: every command is a protocol call to the core.
import { admin, status, version, wizard } from "./commands/admin.ts";
import { agentLimits } from "./commands/agent-fields.ts";
import { artifacts } from "./commands/artifacts.ts";
import { browser } from "./commands/browser.ts";
import { channels, contacts, pairing } from "./commands/channels.ts";
import { chat } from "./commands/chat.ts";
import { clients } from "./commands/clients.ts";
import { desktop, openPanel } from "./commands/desktop.ts";
import { expose } from "./commands/expose.ts";
import { extensions } from "./commands/extensions.ts";
import { init } from "./commands/init.ts";
import { localConnection } from "./commands/local.ts";
import { logsCommand } from "./commands/logs.ts";
import { mcpCommand } from "./commands/mcp.ts";
import { image, say, transcribe } from "./commands/media.ts";
import { memory } from "./commands/memory.ts";
import { agentEdit, agentModel, models } from "./commands/models.ts";
import { news } from "./commands/news.ts";
import { notifications } from "./commands/notifications.ts";
import { org, owner, profiles } from "./commands/owner.ts";
import { pair } from "./commands/pair.ts";
import { routines } from "./commands/routines.ts";
import { service } from "./commands/service.ts";
import { adoptBundleApp } from "./commands/service-files.ts";
import { sessions } from "./commands/sessions.ts";
import { importV1, setupHeadless } from "./commands/setup.ts";
import { skillsImport } from "./commands/skills-import.ts";
import { tasks } from "./commands/tasks.ts";
import { agents, jobs, projects, runs, runtimeSkills, secrets, skills, threads, usage } from "./commands/threads.ts";
import { v1 } from "./commands/v1.ts";
import { themedCard as card, failure, unreachableCore } from "./presentation.ts";

const HELP = `apx — the APX terminal

Usage:
  apx                     Interactive crew console (TTY only)
  apx --version [-v]      Local CLI version (works without the core)
  apx status (or --status) [--json] [--plain]   Core, crew, projects, MCP, devices and access
  apx wizard              Guided terminal setup and maintenance
  apx open                The panel in your browser
  apx desktop             The desktop app (downloads and opens its installer when it is not here)
  apx upgrade [--check] [--json]   Check or apply the core's existing updater
  apx devices [list|pair|revoke <id>] [--json]
  apx tailscale [status|connect|off]   Expose APX through Tailscale (must already be logged in)
  apx mcp tools <server> [<tool>] [--project <id>] [--scope global|project] [--json]
  apx mcp run <server> <tool> ['{"key":"value"}'|-] [--project <id>]
  apx mcp check <server> [--project <id>]   Connection test
  apx mcp signin <server> [--project <id>]  Sign in to a server that asked for it
  apx ping [text]         Round-trip over the live socket

  apx browser tabs
  apx browser open <url> [--profile shared|incognito|agent:<id>] [--by <agent>]
  apx browser nav <tab> <url>
  apx browser snapshot <tab>
  apx browser click <tab> <ref>
  apx browser type <tab> <ref> <text> [--submit]
  apx browser shot <tab> <file.jpg>
  apx browser close <tab>
  apx browser control <tab> user|idle|done
  apx browser cookies                          List browsers whose sessions can be imported
  apx browser cookies <source> [filter]        Domains with cookies (counts only)
  apx browser import <source> <domain,…> [--profile shared|agent:<id>]

  apx chat "<text>" [--agent <id> | --thread <id>] [--new] [--detach] [--interrupt | --steer]
  apx chat "<text>" --code [--cwd <folder>] [--write ask|auto|read-only] [--agent <id>]   Code thread
  apx jobs [list] | get <job> | cancel <job>   Background work: agents' runs and terminal commands
  apx skills [list] [project]   Skills agents can load ("off" marks one turned off there)
  apx skills on|off <skill> [--project p]   Turn a skill on or off everywhere, or only in one project
  apx skills save <skill> [--project p]     Create or replace a skill: its SKILL.md on stdin
  apx skills import <folder|file.zip|git url> [--project p] [--only a,b] [--replace] [--yes]
                           List the skills in it (nothing runs); with --yes copy them into APX (or the project)
  apx skills install-runtimes [--dry-run]
                           Refresh now the skills that teach Claude Code, Codex, Cursor and ~/.agents how to use APX
                           (the core does it at every start); removes ones APX no longer ships, never anyone else's
  apx tasks [add|show|edit|settle|move|done|say]  The office board (apx tasks help)
  apx routines [add|show|edit|run|on|off|rm|log]  Scheduled work (apx routines help)
  apx notifications [read]       What is waiting for you
  apx news [tell [<id>…]] [--json]   Release news; tell runs the super-agent's message now
  apx clients [add <name>|rm <id>]  Outside apps with their own token (Claude Code, Codex…)
  apx extensions [inspect|install|on|off|secret|rm]  Skills, MCP servers and routines in one folder
  apx memory [words]      Notes agents keep between threads (newest first, or the best matches for the words)
  apx memory add [global|project|agent] <text> [--project p] [--agent a]
  apx memory edit <id> <text…>   Rewrite a note in place
  apx memory rm <id…>     Remove notes
  apx artifacts [list] [--project <id>] [--json]   Widgets and apps agents made
  apx artifacts push <name> <file.html> [--title t] [--app] [--connect <origin,…>] [--project <id>]   Show a built page
  apx artifacts dir <name> [--project <id>]   Where a built artifact keeps its source (created if missing)
  apx artifacts export <name> [--memory] [--out <file>] [--project <id>]   Save one as an .apxart file
  apx artifacts import <file.apxart> [--project <id>]   Load an .apxart file into this APX
  apx sessions projects codex|claude   Claude Code or Codex projects and chats on this computer
  apx sessions import codex|claude <project> [--only <id,…>] [--name "…"]   Bring them in as an APX project
  apx sessions digest|adopt|page …     What an imported chat is about, who takes it over, its pages as widgets
  apx channels [add|rm|outbox]   Channels (Telegram bots); apx channels add telegram <id> --agent <a>
  apx channels send <channel> <contact> <text…>   Write to a contact yourself, in their chat on that channel
  apx channels recover <thread>   Ask the channel again for files that never arrived in a chat
  apx contacts [add|block|rm]    People APX talks to on channels
  apx pairing [me|ok|no <code>]  Approve who wrote to a channel
  apx compact <thread>    Summarize a thread's older turns now (APX's own loop; Claude Code and Codex compact their own)
  apx owner [set key=value…]     Who you are, for your agents: name, about, language, timezone
  apx org [set] [--project p]    A project's areas and roles (set: JSON on stdin)
  apx profiles [list] | use <id> [key=value…] | off | restore <routine>
                           What the super-agent is for (a profile), its settings and the routines it keeps
  apx image "<prompt>" [--out file] [--size WxH]   Draw an image and save it
  apx say "<text>" [--out file]    Speak text and save the audio
  apx transcribe <audio file>      Speech to text
  apx usage [days]        Turns and tokens by model, and whether they were included or paid per token
  apx mcps [list [project]] | tools|run|check <server> | trust|untrust <project> <server> | add <name> <command…|url> | rm <name>
  apx mcps on|off <server> --project p   Turn one of your servers on or off inside a project
  apx mcps logs <server> [--project p] [-n 100]   What a server printed on stderr since the core started
                           The one way to talk to an agent. Default: Home (the secretary)
  apx threads [list] | get <thread> [--json] | cancel <thread>
  apx threads search <words…>   Messages with every word, best first
  apx runs get <run> | wait <run> [--timeout 60]
  apx runs pending [thread]   What agents are waiting on from you
  apx runs respond <input> approve|deny ["note"] [--scope once|session|always] | "<answer>"
  apx projects [list] | register <folder> | sync [project]
                           Projects are folders with AGENTS.md / .apc/; their agents come from those files
  apx projects create "<Name>" [--path <folder>] [--kind personal|app|company|software|other] [--desc "…"]
                           A new project: in that folder (made if missing), else in a folder of its own in APX's home
  apx projects set <project> [--name "…"] [--kind …] [--desc "…"] [--autonomy manual|auto|accept_edits|plan|total]
                           Rename it, change its kind or description, or how far its agents go without asking
  apx projects folders list|add|rm <project> [folder]
                           Folders its agents may read and never change (another checkout, docs)
  apx projects rm <project>   Forget a project in APX; its folder and files are never deleted
  apx init [folder]       Make a folder (default: this one) an APC project and register it; writes only what is
                           missing (AGENTS.md, .apc/), never over an existing file
  apx agents              Agents and the model each one runs on
  apx agents show <agent>            Its fields and full prompt
  apx agents new <slug> "<Name>" [--project <id>] [--role "<role>"]
  apx agents set <agent> <field>=<value>…   Any field the agent editor has (an unknown one lists them all)
                           Lists as a,b (tools= is all of them); orchestrator=true|false; rules='{"write":"ask"}';
                           autonomy= or rules= go back to the default
  apx agents set <agent> --prompt-file <file | ->   Its prompt from a file, or stdin with -
  apx agents limits [<agent> runs=… tokens=… | <agent> clear | default runs=… tokens=…]
                           How far agents go without you in one chat: the default, and an agent's own (0 = no limit)
  apx agents clone <agent…> [--project <id>] [--rename] [--under <slug>]
                           Copy agents (whole definition) into a project; --rename gives each a new free name
  apx agents archive <agent>         Project agents: changes are written to .apc/agents/<slug>.md
  apx agents archived | restore <agent>   Archived agents, and bringing one back (deleting for good is in the app)
  apx agents model <agent> <engine/model | engine | router | default> [--router]
                           An agent's model; --router keeps the router as its fallback

  apx models [--refresh]  Every engine and the models it offers (asked to the engine)
  apx models config       The install default and the router
  apx models default <engine/model | engine | router> [--router]
  apx models chain <ref> [<ref>…]      The router's fallback chain, in order
  apx models rules < rules.json        The router's rules (JSON on stdin)

  apx secrets [list] | set <name> (value on stdin) | rm <name>
  apx v1 [off]            Is APX v1 still here and running? off stops its daemon for good and makes apx this one
  apx import-v1 [--keys] [--skills] [--services]
                           Import what a local APX v1 holds, from its files (read-only, v1 may be stopped):
                           projects, agents, memory, chats, channels, tasks, routines (off)… --keys also copies
                           its model API keys into v2's secret store, --skills its skills, --services its
                           image engines and voices, once

  apx service install|uninstall|status|restart
                           Run the core in the background (systemd, launchd or a Windows login entry), started at
                           login and again if it dies
  apx service logs [-n 100] [-f]   The core's log file (<home>/logs/core.log), read on this machine only
  apx logs [-n 100] [--level info|warn|error] [--grep text] [--scope core|output] [--json]
                           The core's log through the core (also a remote one); the file when no core answers
  apx expose tailscale|lan|off|status
                           Who may reach the core: your tailnet (https://<machine>.ts.net), the network, or only
                           this computer. Writes <home>/core.env; restart the core afterwards
  apx pair                A one-time code and link to connect a phone or another computer
  apx setup --headless [--import [--keys] [--skills] [--services]] [--expose tailscale|lan]
                           A server with no desktop: service, optional import, optional exposure, then a pair code

  apx mcp [--by <agent>]  Stdio MCP server exposing browser_* tools (for Claude Code, Codex…); with
                           APX_CLIENT_TOKEN also apx_agents / apx_ask / apx_read (apx clients add <name>)
  apx mcp --run           The tools of one agent run (APX_RUN_TOKEN), for an external harness

Env: APX_URL (default http://127.0.0.1:<APX_PORT or 7440>), APX_TOKEN (default: the one in <home>/core.env),
     APX_HOME (default ~/.apx/v2)`;

// Installed from a bundle: the service it writes and the core it starts run through that install's `current`.
adoptBundleApp(process.env, import.meta.dirname);

function argumentsOf() {
  return parseArgs({
    allowPositionals: true,
    options: {
      json: { type: "boolean" },
      status: { type: "boolean" },
      version: { type: "boolean", short: "v" },
      check: { type: "boolean" },
      plain: { type: "boolean" },
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
      env: { type: "string", multiple: true },
      header: { type: "string", multiple: true },
      cron: { type: "string" },
      clear: { type: "boolean" },
      scopes: { type: "string" },
      scope: { type: "string" },
      person: { type: "string" },
      owed: { type: "string" },
      due: { type: "string" },
      start: { type: "string" },
      reviewer: { type: "string" },
      every: { type: "string" },
      at: { type: "string" },
      pre: { type: "string" },
      post: { type: "string" },
      call: { type: "string" },
      name: { type: "string" },
      "prompt-file": { type: "string" },
      "max-steps": { type: "string" },
      title: { type: "string" },
      desc: { type: "string" },
      "desc-file": { type: "string" },
      tags: { type: "string" },
      role: { type: "string" },
      kind: { type: "string" },
      autonomy: { type: "string" },
      path: { type: "string" },
      rename: { type: "boolean" },
      replace: { type: "boolean" },
      yes: { type: "boolean", short: "y" },
      under: { type: "string" },
      router: { type: "boolean" },
      timeout: { type: "string" },
      run: { type: "boolean" },
      headless: { type: "boolean" },
      import: { type: "boolean" },
      expose: { type: "string" },
      home: { type: "string" },
      "dry-run": { type: "boolean" },
      out: { type: "string" },
      size: { type: "string" },
      lines: { type: "string", short: "n" },
      follow: { type: "boolean", short: "f" },
      level: { type: "string" },
      grep: { type: "string" },
      only: { type: "string" },
      app: { type: "boolean" },
      connect: { type: "string" },
      memory: { type: "boolean" },
    },
  });
}
let parsed: ReturnType<typeof argumentsOf>;
try {
  parsed = argumentsOf();
} catch (err) {
  console.error(failure("Invalid arguments", [err instanceof Error ? err.message : String(err), "Try: apx --help"]));
  process.exit(2);
}
const { values, positionals } = parsed;
const fail = (title: string, lines: string[]) => failure(title, lines, Boolean(values.plain || values.json));
const [command, ...rest] = positionals;
const connection = localConnection();
const terminalClient = () =>
  new ApxClient({ ...localConnection(), client: { name: "apx-terminal", version: "0.0.0" } });
const client = terminalClient();
/** MCP servers are driven by a model: the core never gives them the owner's controls. */
const agentClient = new ApxClient({ ...connection, client: { name: "apx-mcp", version: "0.0.0" }, actor: "agent" });

try {
  switch (values.version ? "version" : values.help ? "help" : values.status ? "status" : command) {
    case "version":
      console.log(version(values.json));
      break;
    case "status":
      await status(client, { json: values.json, plain: values.plain });
      break;
    case "devices":
    case "upgrade":
    case "update":
    case "tailscale":
      await admin(client, command ?? "", rest, values);
      break;
    case "wizard":
      await wizard(client);
      break;
    case "open":
      await openPanel();
      break;
    case "desktop":
      await desktop();
      break;
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
      await threads(client, rest, { json: values.json });
      break;
    case "runs":
      await runs(client, rest, Number(values.timeout ?? 60), values.scope);
      break;
    case "jobs":
      await jobs(client, rest);
      break;
    case "skills":
      if (rest[0] === "install-runtimes") await runtimeSkills(client, Boolean(values["dry-run"]));
      else if (rest[0] === "import")
        await skillsImport(client, rest[1], {
          project: values.project,
          only: values.only,
          replace: values.replace,
          yes: values.yes,
        });
      else await skills(client, rest, { project: values.project });
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
      if (!rest[0]) throw new Error("usage: apx compact <thread>");
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
        start: values.start,
        reviewer: values.reviewer,
        title: values.title,
        desc: values.desc,
        descFile: values["desc-file"],
        tags: values.tags,
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
    case "news":
      await news(client, rest, { json: values.json });
      break;
    case "v1":
      await v1(client, rest);
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
        name: values.name,
        promptFile: values["prompt-file"],
        maxSteps: values["max-steps"],
      });
      break;
    case "memory":
      await memory(client, rest, { project: values.project, agent: values.agent, json: values.json });
      break;
    case "sessions":
      await sessions(client, rest, {
        only: values.only,
        name: values.name,
        title: values.title,
        refresh: values.refresh,
        json: values.json,
      });
      break;
    case "usage":
      await usage(client, rest);
      break;
    case "owner":
      await owner(client, rest);
      break;
    case "org":
      await org(client, rest, { project: values.project });
      break;
    case "profiles":
      await profiles(client, rest);
      break;
    case "artifacts":
      await artifacts(client, rest, {
        project: values.project,
        title: values.title,
        app: values.app,
        connect: values.connect,
        json: values.json,
        memory: values.memory,
        out: values.out,
      });
      break;
    case "image":
      await image(client, rest, { out: values.out, size: values.size });
      break;
    case "say":
      await say(client, rest, { out: values.out });
      break;
    case "transcribe":
      await transcribe(client, rest);
      break;
    case "mcps":
      await mcpCommand(client, rest, values);
      break;
    case "agents":
      if (rest[0] === "model") await agentModel(client, rest.slice(1), values);
      else if (rest[0] === "limits") await agentLimits(client, rest.slice(1));
      else if (rest[0] && rest[0] !== "list") await agentEdit(client, rest, values);
      else await agents(client);
      break;
    case "projects":
      await projects(client, rest, values);
      break;
    case "init":
      await init(client, rest, { json: values.json });
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
    case "logs":
      await logsCommand(client, connection.url, {
        lines: values.lines,
        level: values.level,
        grep: values.grep,
        scope: values.scope,
        json: values.json,
      });
      break;
    case "service":
      await service(rest[0], { home: values.home, lines: values.lines, follow: values.follow });
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
      if (rest.length) {
        await mcpCommand(client, rest, values);
        break;
      }
      if (values.run) {
        // The run token comes in the environment, never on the command line.
        const token = process.env.APX_RUN_TOKEN;
        if (!token) throw new Error("apx mcp --run needs APX_RUN_TOKEN");
        const { runRunMcp } = await import("./mcp-run.ts");
        await runRunMcp(agentClient, token);
        break;
      }
      const { runMcp } = await import("./mcp.ts");
      // An outside app's token (Settings › MCP › Outside apps) comes in the environment, never on the command line.
      const clientToken = process.env.APX_CLIENT_TOKEN;
      const mcpClient = clientToken
        ? new ApxClient({ ...connection, client: { name: "apx-mcp", version: "0.0.0" }, clientToken })
        : agentClient;
      await runMcp(mcpClient, values.by ?? "mcp-client", Boolean(clientToken));
      break;
    }
    case "help":
    case undefined:
      if (
        !values.help &&
        command === undefined &&
        process.stdin.isTTY &&
        process.stdout.isTTY &&
        !values.plain &&
        !values.json
      ) {
        await wizard(client);
        break;
      }
      if (!values.plain && !values.json)
        console.log(
          card("Help", [
            "Agents that remember.",
            "One core. Every device.",
            "",
            "Start: apx wizard",
            "Crew: apx status",
            "Core: apx service status",
            "Tools: apx mcp tools <server>",
          ]),
        );
      console.log(HELP);
      break;
    case "daemon":
      console.error(
        card("Daemon is now service", [
          "APX v2 calls the background core a service.",
          "",
          "Inspect: apx service status",
          "Restart: apx service restart",
          "At login: apx service install",
          "Remove: apx service uninstall",
        ]),
      );
      process.exitCode = 1;
      break;
    default:
      console.error(fail("404 · Command not found", [`Unknown command: ${command}`, "Try: apx --help"]));
      process.exitCode = 1;
  }
} catch (err) {
  const unreachable = unreachableCore(err);
  if (err instanceof ApxError) console.error(fail(`APX · ${err.code}`, [err.message]));
  else if (unreachable) console.error(fail(unreachable.title, unreachable.lines));
  else console.error(fail("APX · Error", [err instanceof Error ? err.message : String(err)]));
  process.exitCode = 1;
}
