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
import { cmdUpdate } from "./commands/update.js";
import { cmdSetup } from "./commands/setup.js";
import { cmdStatus } from "./commands/status.js";
import { checkForUpdate } from "../core/update-check.js";
import { mascot } from "../core/mascot.js";
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

// ── ANSI helpers (help only) ─────────────────────────────────────────────────
const H = {
  R:  "\x1b[0m",
  B:  "\x1b[1m",
  DI: "\x1b[2m",
  CY: "\x1b[36m",
  GR: "\x1b[32m",
  YE: "\x1b[33m",
  WH: "\x1b[97m",
  MA: "\x1b[35m",
};
const hSec  = (s) => `\n${H.B}${H.CY}  ${s}${H.R}\n`;
const hCmd  = (cmd, pad, desc) => `  ${H.WH}${cmd.padEnd(pad)}${H.R}  ${H.DI}${desc}${H.R}`;
const hSub  = (sub, pad, desc) => `    ${H.CY}${sub.padEnd(pad)}${H.R}  ${H.DI}${desc}${H.R}`;
const hFlag = (f,   pad, desc) => `    ${H.YE}${f.padEnd(pad)}${H.R}  ${H.DI}${desc}${H.R}`;

function buildHelp(version) {
  return [
    "",
    `  ${H.B}${H.WH}apx${H.R}  ${H.DI}Agent Project Context  v${version}${H.R}`,
    `  ${H.DI}Docs: https://agentprojectcontext.com${H.R}`,
    "",
    `  ${H.DI}Usage:${H.R}  ${H.WH}apx${H.R} ${H.CY}<command>${H.R} ${H.DI}[subcommand] [args] [--flags]${H.R}`,
    "",

    hSec("Bootstrap"),
    hCmd("apx init [path]",            36, "--name \"<name>\"  initialize a new APC project"),
    hCmd("apx setup",                  36, "interactive wizard: provider → model → channels → daemon  (alias: install)"),
    hCmd("apx status",                 36, "full system status: daemon, super-agent, engines, telegram, projects"),
    hCmd("apx update",                 36, "check for updates and upgrade  (alias: upgrade)"),
    hCmd("apx project add [path]",     36, "register a project with the daemon"),
    hCmd("apx project list",           36, ""),
    hCmd("apx project remove <id>",    36, ""),
    hCmd("apx project rebuild [id]",   36, "rebuild project index from filesystem"),
    hCmd("apx add project [path]",     36, "alias for: apx project add"),

    hSec("Agents"),
    hCmd("apx agent add <slug>",       36, "--role R  --model M  --skills a,b  --language es-AR  --description D"),
    hCmd("apx agent list",             36, ""),
    hCmd("apx agent get <slug>",       36, ""),
    hCmd("apx agent import",           36, ""),
    hCmd("apx agent vault list",       36, ""),
    hCmd("apx agent vault add",        36, ""),

    hSec("Identity & Config"),
    hCmd("apx identity show",          36, "print current agent identity (name, owner, personality)"),
    hCmd("apx identity set <k> <v>",   36, "set identity field"),
    hCmd("apx identity wizard",        36, "interactive identity setup"),
    hCmd("apx config show",            36, "--effective  --only-overrides"),
    hCmd("apx config set <key> <val>", 36, "set key in .apc/config.json  (JSON-aware)"),
    hCmd("apx config unset <key>",     36, "remove key from .apc/config.json"),

    hSec("Memory"),
    hCmd("apx memory <slug>",          36, "print memory.md"),
    hCmd("apx memory <slug> --append", 36, "\"<note>\"  append under '## Recent context'"),
    hCmd("apx memory <slug> --replace",36, "replace from stdin"),

    hSec("Sessions"),
    hCmd("apx session new <slug>",     36, "--title \"T\" [--task-ref REF] [--body -|\"text\"]"),
    hCmd("apx session list [slug]",    36, "--last N"),
    hCmd("apx session get <id>",       36, "--body"),
    hCmd("apx session update <id>",    36, "--status S  --result R  --title T"),
    hCmd("apx session close <id>",     36, "--result \"text\""),
    hCmd("apx session check",          36, "anti-collision: exit 1 if active session"),
    hCmd("apx session close-stale",    36, "auto-close sessions older than 1h"),
    hCmd("apx session resume <id>",    36, "--summary  --full  (APC + Claude Code transcript)"),
    hCmd("apx session compact <slug>", 36, "--conversation <id>  collapse history into summary"),

    hSec("MCPs"),
    hCmd("apx mcp list",               36, ""),
    hCmd("apx mcp add <name>",         36, "--command <cmd> [args]  --env KEY=VAL"),
    hCmd("apx mcp remove <name>",      36, ""),
    hCmd("apx mcp enable/disable",     36, "<name>"),
    hCmd("apx mcp run <name> <tool>",  36, "[<json-args>]  call a tool through the daemon"),
    hCmd("apx mcp tools <name>",       36, "list available tools"),
    hCmd("apx mcp check",              36, "audit multi-source merge"),

    hSec("Daemon"),
    hCmd("apx daemon start",           36, ""),
    hCmd("apx daemon stop",            36, ""),
    hCmd("apx daemon status",          36, ""),
    hCmd("apx daemon logs",            36, "--tail N"),

    hSec("Telegram"),
    hCmd("apx telegram send \"text\"", 36, "--chat <id>"),
    hCmd("apx telegram status",        36, ""),
    hCmd("apx telegram setup",         36, ""),

    hSec("Messages"),
    hCmd("apx messages tail",          36, "--agent <slug>  --channel <ch>  -n 50  --global"),
    hCmd("apx messages search \"q\"",  36, ""),

    hSec("LLM / Chat"),
    hCmd("apx exec <agent> \"prompt\"",36, "--model <id>  --max-tokens N  --temperature T"),
    hCmd("apx chat <agent>",           36, "--conversation <id>  --model <id>  (interactive REPL)"),
    hCmd("apx conversations list",     36, "<agent>"),
    hCmd("apx conversations get",      36, "<agent> <id>"),

    hSec("Runtimes"),
    hCmd("apx run <agent>",            36, "--runtime <id> \"prompt\"  --timeout <s>"),
    `                                        ${H.DI}runtimes: claude-code | codex | opencode | aider${H.R}`,
    hCmd("apx env detect",             36, "which agent CLIs are installed"),

    hSec("Agent-to-Agent"),
    hCmd("apx send <from> <to> \"msg\"",36, "--deliver  log A2A message; --deliver runs target engine"),
    hCmd("apx connections <agent>",    36, "mental map: who/how/when this agent talked"),
    hCmd("apx graph <agent>",          36, "alias for connections"),

    hSec("Routines"),
    hCmd("apx routine list",           36, "list routines + next/last run"),
    hCmd("apx routine add <name>",     36, "--kind K  --schedule S  [--spec '{...}']"),
    `    ${H.DI}kinds: heartbeat | exec_agent | telegram | shell${H.R}`,
    `    ${H.DI}schedule: every:60s | every:5m | every:1h | once:<iso>${H.R}`,
    hCmd("apx routine get <name>",     36, ""),
    hCmd("apx routine run <name>",     36, "manual trigger (ignores schedule)"),
    hCmd("apx routine enable <name>",  36, ""),
    hCmd("apx routine disable <name>", 36, ""),
    hCmd("apx routine remove <name>",  36, ""),

    hSec("Commands & Skills"),
    hCmd("apx command list",           36, "list workflow commands (.apc/commands/)"),
    hCmd("apx command show <name>",    36, "print command content"),
    hCmd("apx skills add [targets]",   36, "install skill into IDE rule files  (claude-code cursor windsurf copilot trae)"),
    hCmd("apx skills add --global",    36, "install to ~/.claude/skills/ etc."),
    hCmd("apx skills list",            36, ""),
    hCmd("apx skills status",          36, "show which IDE targets are installed"),

    hSec("Plugins"),
    hCmd("apx plugins list",           36, "show loaded plugins and their status"),
    hCmd("apx plugins status <id>",    36, "detailed status of one plugin (e.g. telegram)"),

    hSec("Flags"),
    hFlag("--project <name|id|path>",  36, "pin commands to a specific project"),
    hFlag("--help",                    36, "show this help"),
    hFlag("--version",                 36, "print version"),
    "",
  ].join("\n") + "\n";
}

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
  // Show panda mascot for user-facing errors
  const isUnknown = msg.startsWith("unknown command") || msg.startsWith("unknown");
  mascot(isUnknown ? "confused" : "sad", `apx: ${msg}`);
  process.exit(code);
}

const argv = process.argv.slice(2);

// ── Global error safety net ──────────────────────────────────────────────────
// Catches any unhandled promise rejection or sync exception that escapes
// the main try/catch — shows the panda instead of a raw Node.js stack trace.
process.on("uncaughtException", (err) => {
  die(err && err.message ? err.message : String(err));
});
process.on("unhandledRejection", (reason) => {
  die(reason instanceof Error ? reason.message : String(reason));
});

if (argv.length === 0 || argv[0] === "--help" || argv[0] === "-h" || argv[0] === "help") {
  process.stdout.write(buildHelp(VERSION));
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

      case "status":
        await cmdStatus();
        return; // skip checkForUpdate after status (avoid noise)

      case "setup":
      case "install":
        await cmdSetup();
        return;

      case "update":
      case "upgrade":
        await cmdUpdate(parseArgs(rest), VERSION);
        return; // skip checkForUpdate after an update

      default:
        die(`unknown command: ${cmd}\nRun \`apx --help\` for usage.`);
    }
}

const [topCmd, ...topRest] = argv;
(async () => {
  try {
    await dispatch(topCmd, topRest);
    checkForUpdate(VERSION);
  } catch (err) {
    die(err && err.message ? err.message : String(err));
  }
})();
