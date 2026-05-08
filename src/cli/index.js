#!/usr/bin/env node
// apx — unified CLI for APC (Agent Project Context).
// ESM, Node >= 18.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { cmdInit } from "./commands/init.js";
import {
  cmdProjectAdd,
  cmdProjectList,
  cmdProjectRemove,
  cmdProjectRebuild,
} from "./commands/project.js";
import {
  cmdAgentAdd,
  cmdAgentList,
  cmdAgentGet,
  cmdAgentImport,
  cmdAgentVaultList,
  cmdAgentVaultAdd,
} from "./commands/agent.js";
import { cmdMemory } from "./commands/memory.js";
import {
  cmdSessionNew,
  cmdSessionList,
  cmdSessionGet,
  cmdSessionUpdate,
  cmdSessionClose,
  cmdSessionCheck,
  cmdSessionCloseStale,
  cmdSessionResume,
  cmdSessionCompact,
} from "./commands/session.js";
import {
  cmdMcpList,
  cmdMcpAdd,
  cmdMcpRemove,
  cmdMcpEnable,
  cmdMcpDisable,
  cmdMcpRun,
  cmdMcpTools,
  cmdMcpCheck,
} from "./commands/mcp.js";
import {
  cmdDaemonStart,
  cmdDaemonStop,
  cmdDaemonStatus,
  cmdDaemonLogs,
} from "./commands/daemon.js";
import {
  cmdTelegramSend,
  cmdTelegramStatus,
  cmdTelegramSetup,
} from "./commands/telegram.js";
import { cmdMessagesTail, cmdMessagesSearch } from "./commands/messages.js";
import { cmdExec } from "./commands/exec.js";
import {
  cmdChat,
  cmdConversationsList,
  cmdConversationsGet,
} from "./commands/chat.js";
import { cmdRun, cmdEnvDetect } from "./commands/runtime.js";
import { cmdSend, cmdConnections } from "./commands/a2a.js";
import {
  cmdConfigShow,
  cmdConfigSet,
  cmdConfigUnset,
} from "./commands/config.js";
import { cmdPluginsList, cmdPluginStatus } from "./commands/plugins.js";
import { cmdSkillsAdd, cmdSkillsList, cmdSkillsStatus } from "./commands/skills.js";
import { cmdIdentity } from "./commands/identity.js";
import { cmdCommandList, cmdCommandShow } from "./commands/command.js";
import {
  cmdRoutineList,
  cmdRoutineGet,
  cmdRoutineAdd,
  cmdRoutineRemove,
  cmdRoutineEnable,
  cmdRoutineDisable,
  cmdRoutineRun,
} from "./commands/routine.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const VERSION = JSON.parse(
  fs.readFileSync(path.join(__dirname, "..", "..", "package.json"), "utf8")
).version;

const HELP = `apx — Agent Project Context

Usage:
  apx <command> [<subcommand>] [args] [--flags]

Bootstrap:
  apx init [path] [--name "<name>"]                    initialize an APC project
  apx project add [path]                               register a project with the daemon
  apx project list
  apx project remove <path|id>
  apx project rebuild [<path|id>]                      rebuild project index from filesystem
  apx add project [path]                               alias for: apx project add

Agents:
  apx agent add <slug> [--role R] [--model M] [--skills a,b] [--language es-AR] [--description D]
  apx agent list
  apx agent get <slug>

Memory:
  apx memory <slug>                                    print memory.md
  apx memory <slug> --append "<note>"                  append under "## Recent context"
  apx memory <slug> --replace                          replace from stdin

Sessions:
  apx session new <slug> --title "<title>" [--task-ref REF] [--body - | --body "<text>"]
  apx session list [<slug>] [--last N]
  apx session get <id> [--body]
  apx session update <id> [--status S] [--result R] [--title T] [--task-ref REF]
  apx session close <id> [--result "<text>"]
  apx session check                                    anti-collision: exit 1 if active session
  apx session close-stale                              auto-close sessions older than 1h
  apx session resume <id> [--summary] [--full]         read APC session + external transcript (Claude Code, etc.)
  apx session compact <agent> [--conversation <id>]    collapse conversation history into a dense summary

MCPs:
  apx mcp list
  apx mcp add <name> --command <cmd> [args...] [--env KEY=VAL]
  apx mcp remove <name>
  apx mcp enable <name>
  apx mcp disable <name>
  apx mcp run <name> <tool> [<json-args>]              call a tool through the daemon
  apx mcp tools <name>                                 list tools (v0.2)
  apx mcp check                                        audit multi-source merge (v0.2)

Daemon:
  apx daemon start
  apx daemon stop
  apx daemon status
  apx daemon logs [--tail N]

Telegram:
  apx telegram send "<text>" [--chat <id>]
  apx telegram status
  apx telegram setup

Messages:
  apx messages tail [--agent <slug>] [--channel <ch>] [-n 50] [--global]
                     global channels (telegram, direct, whatsapp) → ~/.apx/messages/<ch>/
                     project channels (runtime, a2a, exec)        → ~/.apx/projects/<id>/messages/
  apx messages search "<query>"

LLM engines (v0.2):
  apx exec <agent> "<prompt>" [--model <id>] [--max-tokens N] [--temperature T]
                                                       one-shot LLM call (Anthropic/OpenAI/Ollama/Gemini/mock)
  apx chat <agent> [--conversation <id>] [--model <id>]   interactive REPL
  apx conversations list <agent>
  apx conversations get  <agent> <id>

External agent runtimes (v0.3):
  apx run <agent> --runtime <id> "<prompt>" [--timeout <s>]
                                                       claude-code | codex | opencode | aider
  apx env detect                                       which agent CLIs are installed

Agent-to-agent (v0.4):
  apx send <from> <to> "<body>" [--deliver]            log a2a message; --deliver runs target's engine
  apx connections <agent>                              mental map: who/how/when this agent talked

Project config (.apc/config.json):
  apx config show [--effective | --only-overrides]    show project overrides + effective config
  apx config set   <key.path> <value>                  set a key in .apc/config.json (JSON-aware)
  apx config unset <key.path>                          remove a key from .apc/config.json

Global flags:
  --project <name|id|path>                             pin commands to a specific project
                                                       (or use sugar: apx project <name|id> <subcommand...>)

Plugins:
  apx plugins list                                     show loaded plugins and their status
  apx plugins status <id>                              detailed status of one plugin (e.g. telegram)

Routines (per-project scheduled tasks):
  apx routine list                                     list routines + next/last run
  apx routine add <name> --kind <K> --schedule <S> [--spec '<json>' | --K=V...]
                                                       kinds: heartbeat | exec_agent | telegram | shell
                                                       schedule: every:60s | every:5m | every:1h | once:<iso>
  apx routine get <name>
  apx routine run <name>                               run now (manual trigger, ignores schedule)
  apx routine enable <name> | apx routine disable <name>
  apx routine remove <name>

Commands (.apc/commands/):
  apx command list                     list workflow commands
  apx command show <name>              print command content

Skills (IDE integration):
  apx skills add [<target>...]         install APX skill into project IDE rule files
                                         targets: claude-code cursor windsurf copilot trae
                                         (omit targets to install all)
  apx skills add --global              install to ~/.claude/skills/ ~/.cursor/skills/ ~/.agents/skills/
                                         picked up by Claude Code, Cursor, Codex, Antigravity globally
  apx skills list                      list skills in .apc/skills/
  apx skills status                    show which IDE targets are installed (project + global)

Other:
  apx --help
  apx --version

Docs: https://agentprojectcontext.com
`;

function parseArgs(argv) {
  const args = { _: [], flags: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--") {
      // everything after `--` is positional
      args._.push(...argv.slice(i + 1));
      break;
    }
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) {
        args.flags[key] = true;
      } else {
        // support repeated flags (e.g. --env A=1 --env B=2)
        if (Object.prototype.hasOwnProperty.call(args.flags, key)) {
          if (Array.isArray(args.flags[key])) args.flags[key].push(next);
          else args.flags[key] = [args.flags[key], next];
        } else {
          args.flags[key] = next;
        }
        i++;
      }
    } else if (a === "-n") {
      args.flags.n = argv[++i];
    } else {
      args._.push(a);
    }
  }
  return args;
}

function die(msg, code = 1) {
  process.stderr.write(`apx: ${msg}\n`);
  process.exit(code);
}

const argv = process.argv.slice(2);

if (argv.length === 0 || argv[0] === "--help" || argv[0] === "-h" || argv[0] === "help") {
  process.stdout.write(HELP);
  process.exit(0);
}

if (argv[0] === "--version" || argv[0] === "-v") {
  console.log(VERSION);
  process.exit(0);
}

async function dispatch(cmd, rest) {
  switch (cmd) {
      case "init":
        cmdInit(parseArgs(rest));
        break;

      case "project": {
        const sub = rest[0];
        const a = parseArgs(rest.slice(1));
        const PROJECT_SUBCOMMANDS = new Set([
          "add", "list", "ls", "remove", "rm", "rebuild",
        ]);
        if (sub === "add") await cmdProjectAdd(a);
        else if (sub === "list" || sub === "ls") await cmdProjectList();
        else if (sub === "remove" || sub === "rm") await cmdProjectRemove(a);
        else if (sub === "rebuild") await cmdProjectRebuild(a);
        else if (sub && !PROJECT_SUBCOMMANDS.has(sub)) {
          // Sugar: `apx project <name|id> <subcommand...>` runs the inner
          // subcommand with --project=<name|id> appended.
          //   apx project testing mcp list  → apx mcp list --project testing
          //   apx project 2 routine list    → apx routine list --project 2
          const innerCmd = rest[1];
          if (!innerCmd) die(`apx project ${sub}: missing subcommand`);
          const innerRest = [...rest.slice(2), "--project", sub];
          await dispatch(innerCmd, innerRest);
        }
        else die(`unknown project subcommand: ${sub || "(none)"}`);
        break;
      }

      case "agent": {
        const sub = rest[0];
        const a = parseArgs(rest.slice(1));
        if (sub === "add") await cmdAgentAdd(a);
        else if (sub === "list" || sub === "ls") cmdAgentList();
        else if (sub === "get" || sub === "show") cmdAgentGet(a);
        else if (sub === "import") await cmdAgentImport(a);
        else if (sub === "vault") {
          const vsub = a._[0];
          const va = { ...a, _: a._.slice(1) };
          if (vsub === "list" || vsub === "ls") cmdAgentVaultList();
          else if (vsub === "add") await cmdAgentVaultAdd(va);
          else die(`unknown vault subcommand: ${vsub || "(none)"} — try: list, add`);
        }
        else die(`unknown agent subcommand: ${sub || "(none)"}`);
        break;
      }

      case "memory":
        cmdMemory(parseArgs(rest));
        break;

      case "session": {
        const sub = rest[0];
        const a = parseArgs(rest.slice(1));
        if (sub === "new") cmdSessionNew(a);
        else if (sub === "list" || sub === "ls") cmdSessionList(a);
        else if (sub === "get" || sub === "show") cmdSessionGet(a);
        else if (sub === "update") cmdSessionUpdate(a);
        else if (sub === "close") cmdSessionClose(a);
        else if (sub === "check") cmdSessionCheck();
        else if (sub === "close-stale") cmdSessionCloseStale();
        else if (sub === "resume") await cmdSessionResume(a);
        else if (sub === "compact") await cmdSessionCompact(a);
        else die(`unknown session subcommand: ${sub || "(none)"}`);
        break;
      }

      case "mcp": {
        const sub = rest[0];
        const a = parseArgs(rest.slice(1));
        if (sub === "list" || sub === "ls") await cmdMcpList(a);
        else if (sub === "add") await cmdMcpAdd(a);
        else if (sub === "remove" || sub === "rm") await cmdMcpRemove(a);
        else if (sub === "enable") await cmdMcpEnable(a);
        else if (sub === "disable") await cmdMcpDisable(a);
        else if (sub === "run") await cmdMcpRun(a);
        else if (sub === "tools") await cmdMcpTools(a);
        else if (sub === "check") await cmdMcpCheck(a);
        else die(`unknown mcp subcommand: ${sub || "(none)"}`);
        break;
      }

      case "daemon": {
        const sub = rest[0];
        const a = parseArgs(rest.slice(1));
        if (sub === "start") await cmdDaemonStart(a);
        else if (sub === "stop") await cmdDaemonStop(a);
        else if (sub === "status") await cmdDaemonStatus(a);
        else if (sub === "logs") cmdDaemonLogs(a);
        else die(`unknown daemon subcommand: ${sub || "(none)"}`);
        break;
      }

      case "telegram": {
        const sub = rest[0];
        const a = parseArgs(rest.slice(1));
        if (sub === "send") await cmdTelegramSend(a);
        else if (sub === "status") await cmdTelegramStatus();
        else if (sub === "setup") cmdTelegramSetup();
        else die(`unknown telegram subcommand: ${sub || "(none)"}`);
        break;
      }

      case "messages": {
        const sub = rest[0];
        const a = parseArgs(rest.slice(1));
        if (sub === "tail") await cmdMessagesTail(a);
        else if (sub === "search") await cmdMessagesSearch(a);
        else die(`unknown messages subcommand: ${sub || "(none)"}`);
        break;
      }

      case "exec":
        await cmdExec(parseArgs(rest));
        break;

      case "chat":
        await cmdChat(parseArgs(rest));
        break;

      case "conversations":
      case "conv": {
        const sub = rest[0];
        const a = parseArgs(rest.slice(1));
        if (sub === "list" || sub === "ls") await cmdConversationsList(a);
        else if (sub === "get" || sub === "show") await cmdConversationsGet(a);
        else die(`unknown conversations subcommand: ${sub || "(none)"}`);
        break;
      }

      case "run":
        await cmdRun(parseArgs(rest));
        break;

      case "env": {
        const sub = rest[0];
        if (sub === "detect" || sub === "list") await cmdEnvDetect();
        else die(`unknown env subcommand: ${sub || "(none)"}`);
        break;
      }

      case "send":
        await cmdSend(parseArgs(rest));
        break;

      case "connections":
      case "graph":
        await cmdConnections(parseArgs(rest));
        break;

      case "config": {
        const sub = rest[0];
        const a = parseArgs(rest.slice(1));
        if (sub === "show" || sub === "ls" || sub === undefined) await cmdConfigShow(a);
        else if (sub === "set") await cmdConfigSet(a);
        else if (sub === "unset" || sub === "rm") await cmdConfigUnset(a);
        else die(`unknown config subcommand: ${sub}`);
        break;
      }

      case "plugins":
      case "plugin": {
        const sub = rest[0];
        const a = parseArgs(rest.slice(1));
        if (sub === "list" || sub === "ls" || sub === undefined) await cmdPluginsList();
        else if (sub === "status") await cmdPluginStatus(a);
        else die(`unknown plugins subcommand: ${sub}`);
        break;
      }

      case "routine":
      case "routines": {
        const sub = rest[0];
        const a = parseArgs(rest.slice(1));
        if (sub === "list" || sub === "ls" || sub === undefined) await cmdRoutineList(a);
        else if (sub === "get" || sub === "show") await cmdRoutineGet(a);
        else if (sub === "add" || sub === "new") await cmdRoutineAdd(a);
        else if (sub === "remove" || sub === "rm") await cmdRoutineRemove(a);
        else if (sub === "enable") await cmdRoutineEnable(a);
        else if (sub === "disable") await cmdRoutineDisable(a);
        else if (sub === "run") await cmdRoutineRun(a);
        else die(`unknown routine subcommand: ${sub}`);
        break;
      }

      case "command":
      case "commands": {
        const sub = rest[0];
        const a = parseArgs(rest.slice(1));
        if (!sub || sub === "list" || sub === "ls") cmdCommandList();
        else if (sub === "show" || sub === "get") cmdCommandShow(a);
        else die(`unknown command subcommand: ${sub}`);
        break;
      }

      case "skills": {
        const sub = rest[0];
        const a = parseArgs(rest.slice(1));
        if (!sub || sub === "add") await cmdSkillsAdd(a);
        else if (sub === "list" || sub === "ls") await cmdSkillsList(a);
        else if (sub === "status") await cmdSkillsStatus();
        else die(`unknown skills subcommand: ${sub}`);
        break;
      }

      case "identity":
        await cmdIdentity(parseArgs(rest));
        break;

      case "add": {
        // apx add <domain> [...args] — consistent alternative to apx <domain> add
        const sub = rest[0];
        if (sub === "project") await cmdProjectAdd(parseArgs(rest.slice(1)));
        else die(`unknown 'add' subcommand: ${sub || "(none)"} — try: project`);
        break;
      }

      default:
        die(`unknown command: ${cmd}\nRun \`apx --help\` for usage.`);
    }
}

const [topCmd, ...topRest] = argv;
(async () => {
  try {
    await dispatch(topCmd, topRest);
  } catch (err) {
    die(err && err.message ? err.message : String(err));
  }
})();
