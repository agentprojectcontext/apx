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
  cmdAgentRemove,
  cmdAgentImport,
  cmdAgentVaultList,
  cmdAgentVaultAdd,
  cmdAgentVaultRm,
  cmdAgentVaultRestore,
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
  cmdSessionSummary,
  cmdSessionAsk,
} from "./commands/session.js";
import { cmdSessionsList, cmdSessionFind } from "./commands/sessions.js";
import {
  cmdMcpList,
  cmdMcpAdd,
  cmdMcpRemove,
  cmdMcpEnable,
  cmdMcpDisable,
  cmdMcpRun,
  cmdMcpTools,
  cmdMcpLogs,
  cmdMcpCheck,
} from "./commands/mcp.js";
import {
  cmdDaemonStart,
  cmdDaemonStop,
  cmdDaemonRestart,
  cmdDaemonStatus,
  cmdDaemonLogs,
  cmdDaemonReload,
} from "./commands/daemon.js";
import {
  cmdTelegramSend,
  cmdTelegramStatus,
  cmdTelegramSetup,
  cmdTelegramStart,
  cmdTelegramStop,
  cmdTelegramChannelAdd,
  cmdTelegramChannelList,
  cmdTelegramChannelShow,
  cmdTelegramChannelSet,
  cmdTelegramChannelUnset,
  cmdTelegramChannelRemove,
  cmdTelegramContacts,
  cmdTelegramContactRemove,
  cmdTelegramRole,
  cmdTelegramRoles,
  cmdTelegramOwner,
} from "./commands/telegram.js";
import {
  cmdProjectConfigShow,
  cmdProjectConfigSet,
  cmdProjectConfigUnset,
  cmdProjectConfigEdit,
} from "./commands/project-config.js";
import { cmdMessagesTail, cmdMessagesSearch, cmdMessagesChat } from "./commands/messages.js";
import { cmdLog } from "./commands/log.js";
import { cmdSearch } from "./commands/search.js";
import { cmdExec } from "./commands/exec.js";
import {
  cmdChat,
  cmdConversationsList,
  cmdConversationsGet,
} from "./commands/chat.js";
import { cmdCode } from "./commands/code.js";
import { cmdAcp } from "./commands/acp.js";
import { cmdRun, cmdEnvDetect } from "./commands/runtime.js";
import { cmdSend, cmdConnections } from "./commands/a2a.js";
import {
  cmdConfigShow,
  cmdConfigSet,
  cmdConfigUnset,
  cmdPermission,
} from "./commands/config.js";
import { cmdPluginsList, cmdPluginStatus } from "./commands/plugins.js";
import {
  cmdObsidianSet,
  cmdObsidianStatus,
  cmdObsidianSync,
  cmdObsidianRemove,
} from "./commands/obsidian.js";
import { cmdDesktopStart, cmdDesktopStop, cmdDesktopRestart, cmdDesktopStatus, cmdDesktopInstall, cmdDesktopUninstall, desktopRunning } from "./commands/desktop.js";
import { cmdVoiceSay, cmdVoiceListen, cmdVoiceProviders } from "./commands/voice.js";
import { cmdSkillsAdd, cmdSkillsList, cmdSkillsStatus, cmdSkillsSync, cmdSkillsIndex, cmdSkillsInspect, cmdSkillsInspector } from "./commands/skills.js";
import { cmdIdentity } from "./commands/identity.js";
import { cmdCommandList, cmdCommandShow } from "./commands/command.js";
import { cmdUpdate } from "./commands/update.js";
import { cmdSetup } from "./commands/setup.js";
import { cmdStatus } from "./commands/status.js";
import { cmdModel } from "./commands/model.js";
import { cmdPair, cmdPairWeb, cmdPairList, cmdPairRevoke } from "./commands/pair.js";
import { checkForUpdate } from "#core/update-check.js";
import { mascot } from "#core/mascot.js";
import { apxHeader, apxBanner } from "./branding.js";
import {
  cmdRoutineList,
  cmdRoutineGet,
  cmdRoutineAdd,
  cmdRoutineRemove,
  cmdRoutineEnable,
  cmdRoutineDisable,
  cmdRoutineRun,
  cmdRoutineHistory,
  cmdRoutineMemory,
} from "./commands/routine.js";
import {
  cmdArtifactCreate,
  cmdArtifactList,
  cmdArtifactShow,
  cmdArtifactRemove,
  cmdArtifactRun,
  cmdArtifactPreview,
  cmdArtifactShare,
  cmdArtifactPreviews,
  cmdArtifactStop,
} from "./commands/artifact.js";
import {
  cmdTaskAdd,
  cmdTaskList,
  cmdTaskShow,
  cmdTaskDone,
  cmdTaskDrop,
  cmdTaskReopen,
  cmdTaskPatch,
} from "./commands/task.js";
import {
  cmdProfileList,
  cmdProfileShow,
  cmdProfileInstall,
  cmdProfileUse,
  cmdProfileOff,
  cmdProfileConfig,
  cmdProfileDoctor,
  cmdProfileUninstall,
} from "./commands/profile.js";
import {
  cmdPanelStatus,
  cmdPanelShare,
  cmdPanelUnshare,
} from "./commands/panel.js";
import {
  cmdOrgShow,
  cmdOrgAreaAdd,
  cmdOrgAreaRm,
  cmdOrgRoleAdd,
  cmdOrgRoleRm,
} from "./commands/org.js";

import { buildHelp, buildTopicHelp, findHelpTopic } from "./help/index.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const VERSION = JSON.parse(
  fs.readFileSync(path.join(__dirname, "..", "..", "..", "package.json"), "utf8")
).version;

// Flags that never take a value. Without this the parser would greedily
// swallow the following positional (e.g. `apx exec --code "hi"` would set
// flags.code = "hi" and drop the prompt). Boolean flags always resolve to true.
const BOOLEAN_FLAGS = new Set(["code", "verbose", "global", "mcp", "memory"]);

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
      if (BOOLEAN_FLAGS.has(key)) {
        args.flags[key] = true;
      } else if (next === undefined || next.startsWith("--")) {
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
    } else if (a === "-a") {
      args.flags.agent = argv[++i];
    } else if (a === "-c") {
      args.flags.code = true;
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

const helpRequest = findHelpTopic(argv);
if (argv.length === 0 || helpRequest?.global) {
  process.stdout.write(buildHelp(VERSION));
  process.exit(0);
}
if (helpRequest?.topic) {
  process.stdout.write(buildTopicHelp(helpRequest.topic));
  process.exit(0);
}

if (argv[0] === "--version" || argv[0] === "-v") {
  // Big wordmark to stderr (branding), bare version to stdout so
  // `apx --version` stays parseable in scripts. apxBanner self-suppresses
  // under APX_QUIET / APX_NO_BANNER.
  apxBanner(VERSION, "version");
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
          "add", "list", "ls", "remove", "rm", "rebuild", "config",
        ]);
        if (sub === "add") await cmdProjectAdd(a);
        else if (sub === "list" || sub === "ls") await cmdProjectList();
        else if (sub === "remove" || sub === "rm") await cmdProjectRemove(a);
        else if (sub === "rebuild") await cmdProjectRebuild(a);
        else if (sub === "config") {
          // apx project config <show|set|unset|edit> <project> ...
          const csub = rest[1];
          const ca = parseArgs(rest.slice(2));
          if (csub === "show" || csub === "get") await cmdProjectConfigShow(ca);
          else if (csub === "set") await cmdProjectConfigSet(ca);
          else if (csub === "unset" || csub === "rm") await cmdProjectConfigUnset(ca);
          else if (csub === "edit") await cmdProjectConfigEdit(ca);
          else die(`unknown project config subcommand: ${csub || "(none)"} — try: show, set, unset, edit`);
        }
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
        else if (sub === "remove" || sub === "rm" || sub === "delete") await cmdAgentRemove(a);
        else if (sub === "import") await cmdAgentImport(a);
        else if (sub === "vault") {
          const vsub = a._[0];
          const va = { ...a, _: a._.slice(1) };
          if (vsub === "list" || vsub === "ls") cmdAgentVaultList(va);
          else if (vsub === "add") await cmdAgentVaultAdd(va);
          else if (vsub === "rm" || vsub === "remove") cmdAgentVaultRm(va);
          else if (vsub === "restore") cmdAgentVaultRestore(va);
          else die(`unknown vault subcommand: ${vsub || "(none)"} — try: list, add, rm, restore`);
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
        else if (sub === "find" || sub === "search") cmdSessionFind(a);
        else if (sub === "summary") await cmdSessionSummary(a);
        else if (sub === "ask") await cmdSessionAsk(a);
        else die(`unknown session subcommand: ${sub || "(none)"}`);
        break;
      }

      case "sessions": {
        const sub = rest[0];
        const isListSub = sub === "list" || sub === "ls";
        const a = parseArgs(isListSub ? rest.slice(1) : rest);
        if (!sub || isListSub || sub.startsWith("--")) cmdSessionsList(a);
        else die(`unknown sessions subcommand: ${sub} — try: list`);
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
        else if (sub === "logs") await cmdMcpLogs(a);
        else if (sub === "check") await cmdMcpCheck(a);
        else die(`unknown mcp subcommand: ${sub || "(none)"}`);
        break;
      }

      case "obsidian": {
        const sub = rest[0];
        const a = parseArgs(rest.slice(1));
        if (!sub || sub === "status" || sub === "show") await cmdObsidianStatus(a);
        else if (sub === "set" || sub === "connect" || sub === "add") await cmdObsidianSet(a);
        else if (sub === "sync") await cmdObsidianSync(a);
        else if (sub === "remove" || sub === "rm" || sub === "disconnect") await cmdObsidianRemove(a);
        else die(`unknown obsidian subcommand: ${sub}\nUsage: apx obsidian <set|status|sync|remove> [--global|--project <p>]`);
        break;
      }

      case "daemon": {
        const sub = rest[0];
        const a = parseArgs(rest.slice(1));
        if (sub === "start") await cmdDaemonStart(a);
        else if (sub === "stop") await cmdDaemonStop(a);
        else if (sub === "restart") await cmdDaemonRestart(a);
        else if (sub === "reload") await cmdDaemonReload(a);
        else if (sub === "status") await cmdDaemonStatus(a);
        else if (sub === "logs") cmdDaemonLogs(a);
        else die(`unknown daemon subcommand: ${sub || "(none)"}`);
        break;
      }

      case "pair": {
        const sub = rest[0];
        const a = parseArgs(rest.slice(1));
        if (!sub || sub === "new" || sub === "device" || sub === "deck") await cmdPair(a);
        else if (sub === "web") await cmdPairWeb(a);
        else if (sub === "list" || sub === "ls") await cmdPairList();
        else if (sub === "revoke" || sub === "rm") await cmdPairRevoke(a);
        else die(`unknown pair subcommand: ${sub} — try: (no arg)/deck, web, list, revoke <id>`);
        break;
      }

      case "telegram": {
        const sub = rest[0];
        const a = parseArgs(rest.slice(1));
        if (sub === "send") await cmdTelegramSend(a);
        else if (sub === "status") await cmdTelegramStatus();
        else if (sub === "start") await cmdTelegramStart();
        else if (sub === "stop") await cmdTelegramStop();
        else if (sub === "setup") cmdTelegramSetup();
        else if (sub === "channel" || sub === "channels") {
          const csub = rest[1];
          const ca = parseArgs(rest.slice(2));
          if (csub === "add") await cmdTelegramChannelAdd(ca);
          else if (csub === "list" || csub === "ls" || !csub) await cmdTelegramChannelList();
          else if (csub === "show" || csub === "get") await cmdTelegramChannelShow(ca);
          else if (csub === "set") await cmdTelegramChannelSet(ca);
          else if (csub === "unset") await cmdTelegramChannelUnset(ca);
          else if (csub === "remove" || csub === "rm") await cmdTelegramChannelRemove(ca);
          else die(`unknown telegram channel subcommand: ${csub} — try: add, list, show, set, unset, remove`);
        }
        else if (sub === "contacts" || sub === "contact") {
          const csub = rest[1];
          const ca = parseArgs(rest.slice(2));
          if (csub === "rm" || csub === "remove") await cmdTelegramContactRemove(ca);
          else if (!csub || csub === "list" || csub === "ls") await cmdTelegramContacts();
          else die(`unknown telegram contacts subcommand: ${csub} — try: list, rm`);
        }
        else if (sub === "role") await cmdTelegramRole(parseArgs(rest.slice(1)));
        else if (sub === "roles") await cmdTelegramRoles(parseArgs(rest.slice(1)));
        else if (sub === "owner") await cmdTelegramOwner(parseArgs(rest.slice(1)));
        else die(`unknown telegram subcommand: ${sub || "(none)"}`);
        break;
      }

      case "messages": {
        const sub = rest[0];
        const a = parseArgs(rest.slice(1));
        if (sub === "tail") await cmdMessagesTail(a);
        else if (sub === "chat") await cmdMessagesChat(a);
        else if (sub === "search") await cmdMessagesSearch(a);
        else die(`unknown messages subcommand: ${sub || "(none)"}`);
        break;
      }

      case "log":
      case "logs": {
        // `apx log` is the unified daemon log (everything: telegram, whisper,
        // super-agent, tools, desktop). For just the legacy stdout sink,
        // use `apx daemon logs`. `apx log -f` follows; `--errors` filters.
        await cmdLog(parseArgs(rest));
        break;
      }

      case "exec":
        await cmdExec(parseArgs(rest));
        break;

      case "acp":
        // ACP server owns stdio until the client closes the pipe.
        await cmdAcp(parseArgs(rest));
        return;

      case "search":
        await cmdSearch(parseArgs(rest));
        break;

      case "chat":
        await cmdChat(parseArgs(rest));
        break;

      case "code":
        await cmdCode(parseArgs(rest));
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

      case "permission": {
        await cmdPermission(parseArgs(rest));
        break;
      }

      case "model": {
        await cmdModel(parseArgs(rest));
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
        else if (sub === "history" || sub === "hist") await cmdRoutineHistory(a);
        else if (sub === "memory" || sub === "mem") await cmdRoutineMemory(a);
        else die(`unknown routine subcommand: ${sub}`);
        break;
      }

      case "artifact":
      case "artifacts": {
        const sub = rest[0];
        const a = parseArgs(rest.slice(1));
        if (!sub || sub === "list" || sub === "ls") await cmdArtifactList(a);
        else if (sub === "create" || sub === "new") await cmdArtifactCreate(a);
        else if (sub === "show" || sub === "get") await cmdArtifactShow(a);
        else if (sub === "remove" || sub === "rm") await cmdArtifactRemove(a);
        else if (sub === "run") await cmdArtifactRun(a);
        else if (sub === "preview" || sub === "serve") await cmdArtifactPreview(a);
        else if (sub === "share") await cmdArtifactShare(a);
        else if (sub === "previews") await cmdArtifactPreviews(a);
        else if (sub === "stop") await cmdArtifactStop(a);
        else die(`unknown artifact subcommand: ${sub}`);
        break;
      }

      case "task":
      case "tasks": {
        const sub = rest[0];
        const a = parseArgs(rest.slice(1));
        if (!sub || sub === "list" || sub === "ls") await cmdTaskList(a);
        else if (sub === "add" || sub === "new" || sub === "create") await cmdTaskAdd(a);
        else if (sub === "show" || sub === "get") await cmdTaskShow(a);
        else if (sub === "done" || sub === "complete") await cmdTaskDone(a);
        else if (sub === "drop" || sub === "archive") await cmdTaskDrop(a);
        else if (sub === "reopen") await cmdTaskReopen(a);
        else if (sub === "patch" || sub === "edit") await cmdTaskPatch(a);
        else die(`unknown task subcommand: ${sub}\nUsage: apx task <list|add|show|done|drop|reopen|patch>`);
        break;
      }

      case "panel": {
        const sub = rest[0];
        const a = parseArgs(rest.slice(1));
        if (!sub || sub === "status") await cmdPanelStatus(a);
        else if (sub === "share") await cmdPanelShare(a);
        else if (sub === "unshare") await cmdPanelUnshare(a);
        else die(`unknown panel subcommand: ${sub}\nUsage: apx panel <status|share|unshare>`);
        break;
      }

      case "profile":
      case "profiles": {
        const sub = rest[0];
        const a = parseArgs(rest.slice(1));
        if (!sub || sub === "list" || sub === "ls") await cmdProfileList(a);
        else if (sub === "show" || sub === "get") await cmdProfileShow(a);
        else if (sub === "install" || sub === "add") await cmdProfileInstall(a);
        else if (sub === "use" || sub === "activate") await cmdProfileUse(a);
        else if (sub === "off" || sub === "deactivate") await cmdProfileOff(a);
        else if (sub === "config") await cmdProfileConfig(a);
        else if (sub === "doctor") await cmdProfileDoctor(a);
        else if (sub === "uninstall" || sub === "remove" || sub === "rm") await cmdProfileUninstall(a);
        else die(`unknown profile subcommand: ${sub}\nUsage: apx profile <list|show|install|use|off|config|doctor|uninstall>`);
        break;
      }

      case "command":
      case "commands": {
        const sub = rest[0];
        const a = parseArgs(rest.slice(1));
        if (!sub || sub === "list" || sub === "ls") await cmdCommandList(a);
        else if (sub === "show" || sub === "get") await cmdCommandShow(a);
        else die(`unknown command subcommand: ${sub}`);
        break;
      }

      case "org":
      case "organization": {
        const sub = rest[0];
        const a = parseArgs(rest.slice(1));
        // `apx org area add ...` / `apx org role rm ...` — the resource verb is
        // the first positional, the action the second.
        if (!sub || sub === "show" || sub === "list") await cmdOrgShow(a);
        else if (sub === "area") {
          const action = rest[1];
          const aa = parseArgs(rest.slice(1)); // keep `area` as _[0] for name parsing
          if (action === "add" || action === "new") await cmdOrgAreaAdd(aa);
          else if (action === "rm" || action === "remove" || action === "delete") await cmdOrgAreaRm(aa);
          else die("usage: apx org area <add|rm> ...");
        } else if (sub === "role") {
          const action = rest[1];
          const ra = parseArgs(rest.slice(1));
          if (action === "add" || action === "new") await cmdOrgRoleAdd(ra);
          else if (action === "rm" || action === "remove" || action === "delete") await cmdOrgRoleRm(ra);
          else die("usage: apx org role <add|rm> ...");
        } else die(`unknown org subcommand: ${sub}\nUsage: apx org <show|area|role> ...`);
        break;
      }

      case "skills": {
        const sub = rest[0];
        const a = parseArgs(rest.slice(1));
        if (!sub || sub === "add") await cmdSkillsAdd(a);
        else if (sub === "list" || sub === "ls") await cmdSkillsList(a);
        else if (sub === "status") await cmdSkillsStatus();
        else if (sub === "sync" || sub === "refresh") await cmdSkillsSync(a);
        else if (sub === "index") await cmdSkillsIndex(a);
        else if (sub === "inspect") await cmdSkillsInspect(a);
        else if (sub === "inspector") await cmdSkillsInspector(a);
        else die(`unknown skills subcommand: ${sub}`);
        break;
      }

      case "identity":
        await cmdIdentity(parseArgs(rest));
        break;

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

      // Refresh everything held in memory after a code change (e.g. a `git
      // pull` in a dev checkout): restart the daemon, and restart the desktop
      // too if it was running. The daemon picks up new code/prompts; the
      // desktop picks up its new renderer/main.js. Token re-sync is automatic
      // (the desktop WS re-reads daemon.token on reconnect).
      case "restart": {
        const a = parseArgs(rest);
        await cmdDaemonRestart(a);
        if (desktopRunning()) await cmdDesktopRestart(a);
        return;
      }

      case "overlay":
        console.error("  apx overlay has been renamed to apx desktop — forwarding.");
        /* falls through */
      case "desktop": {
        const [sub, ...oRest] = rest;
        const oArgs = parseArgs(oRest);
        if (!sub || sub === "start")  { await cmdDesktopStart(oArgs); return; }
        if (sub === "stop")           { await cmdDesktopStop(oArgs);  return; }
        if (sub === "restart")        { await cmdDesktopRestart(oArgs); return; }
        if (sub === "status")         { await cmdDesktopStatus(oArgs);return; }
        if (sub === "install")        { await cmdDesktopInstall(oArgs);  return; }
        if (sub === "uninstall")      { await cmdDesktopUninstall(oArgs);return; }
        die(`unknown desktop sub-command: ${sub}\nUsage: apx desktop <start|stop|restart|status|install|uninstall>`);
        return;
      }

      case "voice": {
        const [sub, ...vRest] = rest;
        const vArgs = parseArgs(vRest);
        if (sub === "say")        { await cmdVoiceSay(vArgs); return; }
        if (sub === "listen")     { await cmdVoiceListen(vArgs); return; }
        if (sub === "providers" || sub === "list") { await cmdVoiceProviders(); return; }
        die(`unknown voice sub-command: ${sub || "(missing)"}\nUsage: apx voice <say|listen|providers>`);
        return;
      }

      default:
        die(`unknown command: ${cmd}\nRun \`apx --help\` for usage.`);
    }
}

const [topCmd, ...topRest] = argv;

// ── CLI branding ────────────────────────────────────────────────────────────
// Every command prints an "APX CLI · vX · <command>" mark to stderr (so stdout
// pipes stay clean). Two exceptions:
//   - SELF_BRANDED: commands that already render their own logo/mascot/status
//     block — re-stamping them would double up.
//   - BANNERED: branding-heavy moments that get the big ASCII wordmark instead
//     of the compact line.
// Suppress everything with APX_QUIET=1 / APX_NO_BANNER=1 (see branding.js).
const SELF_BRANDED = new Set([
  "status", "setup", "install", "daemon", "update", "upgrade", "help", "restart",
]);
const BANNERED = new Set(["init"]);

function brandFor(cmd, rest) {
  if (SELF_BRANDED.has(cmd)) return;
  // Subtitle = the command path only (cmd + leading subcommand tokens), never
  // free-form args. Stop at the first token that looks like an argument: a flag,
  // something with spaces (a quoted prompt), or anything long. So
  // `skills inspector status` shows fully, but `exec "long prompt…"` shows just
  // `exec`.
  const path = [cmd];
  for (const tok of rest) {
    if (!tok || tok.startsWith("-") || /\s/.test(tok) || tok.length > 24) break;
    path.push(tok);
    if (path.length >= 3) break;
  }
  const subtitle = path.join(" ");
  if (BANNERED.has(cmd)) apxBanner(VERSION, subtitle);
  else apxHeader(VERSION, subtitle);
}

(async () => {
  try {
    brandFor(topCmd, topRest);
    await dispatch(topCmd, topRest);
    checkForUpdate(VERSION);
  } catch (err) {
    die(err && err.message ? err.message : String(err));
  }
})();
