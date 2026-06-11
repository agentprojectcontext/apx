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
import { cmdSys as cmdCode } from "./commands/sys.js";
import { cmdRun, cmdEnvDetect } from "./commands/runtime.js";
import { cmdSend, cmdConnections } from "./commands/a2a.js";
import {
  cmdConfigShow,
  cmdConfigSet,
  cmdConfigUnset,
  cmdPermission,
} from "./commands/config.js";
import { cmdPluginsList, cmdPluginStatus } from "./commands/plugins.js";
import { cmdDesktopStart, cmdDesktopStop, cmdDesktopStatus, cmdDesktopInstall, cmdDesktopUninstall } from "./commands/desktop.js";
import { cmdVoiceSay, cmdVoiceListen, cmdVoiceProviders } from "./commands/voice.js";
import { cmdSkillsAdd, cmdSkillsList, cmdSkillsStatus, cmdSkillsSync } from "./commands/skills.js";
import { cmdIdentity } from "./commands/identity.js";
import { cmdCommandList, cmdCommandShow } from "./commands/command.js";
import { cmdUpdate } from "./commands/update.js";
import { cmdSetup } from "./commands/setup.js";
import { cmdStatus } from "./commands/status.js";
import { cmdModel } from "./commands/model.js";
import { cmdPair, cmdPairWeb, cmdPairList, cmdPairRevoke } from "./commands/pair.js";
import { checkForUpdate } from "#core/update-check.js";
import { mascot } from "#core/mascot.js";
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

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const VERSION = JSON.parse(
  fs.readFileSync(path.join(__dirname, "..", "..", "..", "package.json"), "utf8")
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

const topic = ({ title, summary, usage = [], commands = [], options = [], examples = [], notes = [] }) => ({
  title,
  summary,
  usage,
  commands,
  options,
  examples,
  notes,
});

const HELP_TOPICS = new Map(Object.entries({
  init: topic({
    title: "apx init",
    summary: "Initialize APC project files in the current directory or a target path.",
    usage: ["apx init [path] [--name <name>]"],
    options: [
      ["--name <name>", "Project display name written to .apc/project.json."],
    ],
    examples: ["apx init", "apx init ./my-project --name \"My Project\""],
  }),
  setup: topic({
    title: "apx setup",
    summary: "Run the interactive APX setup wizard.",
    usage: ["apx setup", "apx install"],
    examples: ["apx setup"],
  }),
  install: topic({
    title: "apx install",
    summary: "Alias for apx setup.",
    usage: ["apx install"],
    examples: ["apx install"],
  }),
  status: topic({
    title: "apx status",
    summary: "Print daemon, super-agent, engine, Telegram, and project status.",
    usage: ["apx status"],
    examples: ["apx status"],
  }),
  update: topic({
    title: "apx update",
    summary: "Check for a published APX update and upgrade the global install.",
    usage: ["apx update", "apx upgrade"],
    examples: ["apx update"],
  }),
  upgrade: topic({
    title: "apx upgrade",
    summary: "Alias for apx update.",
    usage: ["apx upgrade"],
    examples: ["apx upgrade"],
  }),
  project: topic({
    title: "apx project",
    summary: "Register, list, remove, and rebuild daemon project entries.",
    usage: ["apx project <subcommand> [args] [--flags]"],
    commands: [
      ["add [path]", "Register a project path with the daemon."],
      ["list | ls", "List known daemon projects."],
      ["remove | rm <id>", "Remove a daemon project entry."],
      ["rebuild [id]", "Rebuild daemon index from project files."],
      ["<name|id> <command>", "Run another APX command pinned to that project."],
    ],
    options: [["--project <name|id|path>", "Pin command to a specific project where supported."]],
    examples: ["apx project add .", "apx project list", "apx project testing mcp list"],
  }),
  "project add": topic({
    title: "apx project add",
    summary: "Register a project with the APX daemon.",
    usage: ["apx project add [path]"],
    examples: ["apx project add .", "apx project add ../repo"],
  }),
  "project list": topic({
    title: "apx project list",
    summary: "List projects known by the daemon.",
    usage: ["apx project list", "apx project ls"],
    examples: ["apx project list"],
  }),
  "project remove": topic({
    title: "apx project remove",
    summary: "Remove a project entry from daemon storage.",
    usage: ["apx project remove <id>", "apx project rm <id>"],
    examples: ["apx project remove default"],
  }),
  "project rebuild": topic({
    title: "apx project rebuild",
    summary: "Rebuild a daemon project index from filesystem context.",
    usage: ["apx project rebuild [id]"],
    examples: ["apx project rebuild", "apx project rebuild default"],
  }),
  "project config": topic({
    title: "apx project config",
    summary: "Read / write the per-project config (.apc/config.json) via the daemon API.",
    usage: ["apx project config <show|set|unset|edit> <project> [args]"],
    commands: [
      ["show <project>", "Print effective + project_only config. Use --key dotted.key for one value."],
      ["set <project> <key> <value>", "Set a dotted key in the project config (PATCH set)."],
      ["unset <project> <key>", "Remove a dotted key from the project config (PATCH unset)."],
      ["edit <project>", "Open the project_only config in $EDITOR; full replace on save."],
    ],
    options: [
      ["--key <dotted.key>", "Limit `show` to one key — prints effective and project_only side by side."],
      ["--json", "Emit JSON instead of human-readable lines (show --key only)."],
    ],
    examples: [
      "apx project config show iacrmar",
      "apx project config show iacrmar --key super_agent.model",
      "apx project config set iacrmar super_agent.model groq:llama-3.3-70b-versatile",
      "apx project config unset iacrmar super_agent.model",
      "apx project config edit iacrmar",
    ],
  }),
  "project config show": topic({
    title: "apx project config show",
    summary: "Print the effective and project_only config for a project.",
    usage: ["apx project config show <project> [--key dotted.key] [--json]"],
    options: [
      ["--key <dotted.key>", "Print just one key (effective + project_only)."],
      ["--json", "JSON output (only with --key)."],
    ],
    examples: ["apx project config show iacrmar", "apx project config show iacrmar --key super_agent.model"],
  }),
  "project config set": topic({
    title: "apx project config set",
    summary: "Set a dotted-key value in .apc/config.json (PATCH).",
    usage: ["apx project config set <project> <dotted.key> <value>"],
    examples: ["apx project config set iacrmar super_agent.model groq:llama-3.3-70b-versatile"],
  }),
  "project config unset": topic({
    title: "apx project config unset",
    summary: "Remove a dotted-key from .apc/config.json (PATCH unset).",
    usage: ["apx project config unset <project> <dotted.key>"],
    examples: ["apx project config unset iacrmar super_agent.model"],
  }),
  "project config edit": topic({
    title: "apx project config edit",
    summary: "Open the project_only config in $EDITOR. Saves with PUT on exit.",
    usage: ["apx project config edit <project>"],
    examples: ["apx project config edit iacrmar"],
  }),
  agent: topic({
    title: "apx agent",
    summary: "Create, inspect, import, and vault agent definitions.",
    usage: ["apx agent <subcommand> [args] [--flags]"],
    commands: [
      ["add <slug>", "Create a project-local agent."],
      ["list | ls", "List project agents."],
      ["get | show <slug>", "Print one agent definition."],
      ["import <slug>", "Import an agent template from ~/.apx/agents."],
      ["vault list | ls", "List vault templates (bundled defaults + your overrides)."],
      ["vault add <slug>", "Create a new vault template in the user layer (~/.apx/agents/)."],
      ["vault rm <slug>", "Delete a vault template (tombstones the bundled default so it stays hidden)."],
      ["vault restore <slug>", "Lift a tombstone so a previously-removed bundled default is visible again."],
    ],
    examples: ["apx agent add reviewer --role Reviewer --model gpt-5.2", "apx agent list"],
  }),
  "agent add": topic({
    title: "apx agent add",
    summary: "Create a project-local agent definition.",
    usage: ["apx agent add <slug> [--role <role>] [--model <model>] [--skills a,b] [--language <tag>] [--description <text>] [--tools a,b]"],
    options: [
      ["--role <role>", "Human-readable role."],
      ["--model <model>", "Preferred model id."],
      ["--skills a,b", "Comma-separated skill names."],
      ["--language <tag>", "Default response language, for example en-US or es-AR."],
      ["--description <text>", "Short agent description."],
      ["--tools a,b", "Comma-separated tool hints."],
    ],
    examples: ["apx agent add reviewer --role Reviewer --model gpt-5.2 --skills review,test"],
  }),
  "agent list": topic({
    title: "apx agent list",
    summary: "List agents available in the current APC project.",
    usage: ["apx agent list", "apx agent ls"],
    examples: ["apx agent list"],
  }),
  "agent get": topic({
    title: "apx agent get",
    summary: "Print one project agent definition.",
    usage: ["apx agent get <slug>", "apx agent show <slug>"],
    examples: ["apx agent get reviewer"],
  }),
  "agent import": topic({
    title: "apx agent import",
    summary: "Import a reusable agent template from the APX vault into the current project.",
    usage: ["apx agent import <slug> [--copy] [--force]"],
    options: [
      ["--copy", "Copy the vault markdown file into the project instead of linking it."],
      ["--force", "Overwrite an existing project-local definition when used with --copy."],
    ],
    examples: ["apx agent import reviewer", "apx agent import reviewer --copy --force"],
  }),
  "agent vault": topic({
    title: "apx agent vault",
    summary: "Manage reusable global agent templates under ~/.apx/agents.",
    usage: ["apx agent vault <subcommand> [args] [--flags]"],
    commands: [
      ["list | ls", "List vault templates."],
      ["add <slug>", "Create a vault template or copy a local project agent into the vault."],
    ],
    examples: ["apx agent vault list", "apx agent vault add reviewer"],
  }),
  "agent vault list": topic({
    title: "apx agent vault list",
    summary: "List reusable global agent templates.",
    usage: ["apx agent vault list", "apx agent vault ls"],
    examples: ["apx agent vault list"],
  }),
  "agent vault add": topic({
    title: "apx agent vault add",
    summary: "Create a reusable global agent template.",
    usage: ["apx agent vault add <slug> [--role <role>] [--model <model>] [--skills a,b] [--language <tag>] [--description <text>]"],
    options: [
      ["--role <role>", "Human-readable role."],
      ["--model <model>", "Preferred model id."],
      ["--skills a,b", "Comma-separated skill names."],
      ["--language <tag>", "Default response language."],
      ["--description <text>", "Short agent description."],
    ],
    examples: ["apx agent vault add reviewer --role Reviewer --model gpt-5.2"],
  }),
  "agent vault rm": topic({
    title: "apx agent vault rm",
    summary: "Delete a vault template. Bundled defaults are tombstoned, not erased; restore them with `apx agent vault restore`.",
    usage: ["apx agent vault rm <slug>"],
    examples: ["apx agent vault rm tessa-qa"],
  }),
  "agent vault restore": topic({
    title: "apx agent vault restore",
    summary: "Lift a tombstone so a previously-removed bundled default is visible again.",
    usage: ["apx agent vault restore <slug>"],
    examples: ["apx agent vault restore tessa-qa"],
  }),
  identity: topic({
    title: "apx identity",
    summary: "Read or edit APX profile identity fields.",
    usage: ["apx identity <show|set|wizard> [args]"],
    commands: [
      ["show", "Print current identity."],
      ["set <key> <value>", "Set one identity field."],
      ["wizard", "Run interactive identity setup."],
    ],
    examples: ["apx identity show", "apx identity set agent_name Ada"],
  }),
  "identity show": topic({
    title: "apx identity show",
    summary: "Print current APX profile identity.",
    usage: ["apx identity show"],
    examples: ["apx identity show"],
  }),
  "identity set": topic({
    title: "apx identity set",
    summary: "Set one APX profile identity field.",
    usage: ["apx identity set <key> <value>"],
    examples: ["apx identity set agent_name Ada", "apx identity set owner_name Sam"],
  }),
  "identity wizard": topic({
    title: "apx identity wizard",
    summary: "Run interactive identity setup.",
    usage: ["apx identity wizard"],
    examples: ["apx identity wizard"],
  }),
  config: topic({
    title: "apx config",
    summary: "Read and edit project configuration in .apc/config.json.",
    usage: ["apx config [show] [--effective] [--only-overrides]", "apx config set <key.path> <value>", "apx config unset <key.path>"],
    commands: [
      ["show | ls", "Print config."],
      ["set <key> <value>", "Set a JSON-aware value."],
      ["unset | rm <key>", "Remove a key."],
    ],
    options: [
      ["--effective", "Show merged effective config."],
      ["--only-overrides", "Show only project overrides."],
    ],
    examples: ["apx config show --effective", "apx config set engines.openai.model gpt-5.2"],
  }),
  "config show": topic({
    title: "apx config show",
    summary: "Print project config.",
    usage: ["apx config show [--effective] [--only-overrides]", "apx config ls"],
    options: [
      ["--effective", "Show merged effective config."],
      ["--only-overrides", "Show only project overrides."],
    ],
    examples: ["apx config show", "apx config show --effective"],
  }),
  "config set": topic({
    title: "apx config set",
    summary: "Set a JSON-aware value in .apc/config.json.",
    usage: ["apx config set <key.path> <value>"],
    examples: ["apx config set super_agent.enabled true", "apx config set engines.openai.model gpt-5.2"],
  }),
  "config unset": topic({
    title: "apx config unset",
    summary: "Remove a key from .apc/config.json.",
    usage: ["apx config unset <key.path>", "apx config rm <key.path>"],
    examples: ["apx config unset engines.openai.model"],
  }),
  permission: topic({
    title: "apx permission",
    summary: "Show or set APX tool permission mode.",
    usage: ["apx permission show", "apx permission set <total|automatico|permiso>"],
    commands: [
      ["show", "Print current permission mode."],
      ["set <mode>", "Set permission mode."],
    ],
    examples: ["apx permission show", "apx permission set automatico"],
  }),
  "permission show": topic({
    title: "apx permission show",
    summary: "Print current APX tool permission mode.",
    usage: ["apx permission show"],
    examples: ["apx permission show"],
  }),
  "permission set": topic({
    title: "apx permission set",
    summary: "Set APX tool permission mode.",
    usage: ["apx permission set <total|automatico|permiso>"],
    examples: ["apx permission set permiso"],
  }),
  memory: topic({
    title: "apx memory",
    summary: "Read, append, or replace an agent memory.md file.",
    usage: ["apx memory <slug>", "apx memory <slug> --append \"<note>\"", "apx memory <slug> --replace < memory.md"],
    options: [
      ["--append <note>", "Append a durable note under Recent context."],
      ["--replace", "Replace memory from stdin."],
    ],
    examples: ["apx memory reviewer", "apx memory reviewer --append \"Prefers short PR summaries\""],
  }),
  session: topic({
    title: "apx session",
    summary: "Manage local runtime sessions stored under ~/.apx/projects/<project-id>.",
    usage: ["apx session <subcommand> [args] [--flags]"],
    commands: [
      ["new <slug>", "Create a session file."],
      ["list | ls [slug]", "List sessions."],
      ["get | show <id>", "Print session metadata or body."],
      ["update <id>", "Update session frontmatter."],
      ["close <id>", "Mark a session complete."],
      ["check", "Exit non-zero if an active session exists."],
      ["close-stale", "Auto-close stale active sessions."],
      ["resume <id>", "Show APC session and optional external transcript summary."],
      ["compact <slug>", "Compact latest or selected conversation into summary."],
      ["find | search <text>", "Find sessions by title (cross-engine). --deep also searches content."],
      ["summary <id>", "LLM summary of any session by id (alias for resume --summary)."],
      ["ask <id> \"<q>\"", "Ask a question about a session; map-reduces large transcripts."],
    ],
    examples: ["apx session find \"mejorar interfaz web\"", "apx session ask 019abc... \"¿qué cambios al sidebar?\""],
  }),
  "session find": topic({
    title: "apx session find",
    summary: "Find sessions by title across every engine, newest first. The fast way to turn a remembered title into a session id.",
    usage: [
      "apx session find \"<text>\" [--deep] [--engine <id>] [--dir <path>|--project <name>] [--limit N] [--json]",
    ],
    options: [
      ["--deep", "Also search inside transcript content, not just titles (slower)."],
      ["--engine <id>", "Restrict to one engine (apx | claude | codex)."],
      ["--dir <path> / --project <name>", "Scope to one project (reaches unregistered Claude projects)."],
      ["--limit N", "Max results (default 20)."],
      ["--json", "Machine-readable output."],
    ],
    examples: [
      "apx session find \"mejorar interfaz web\"",
      "apx session find \"sidebar\" --deep --engine codex",
    ],
  }),
  "session summary": topic({
    title: "apx session summary",
    summary: "Print an LLM summary of any session by id (resolves the owning engine automatically).",
    usage: ["apx session summary <id> [--engine <id>]"],
    examples: ["apx session summary 019abc...", "apx session summary 2e3c84 --engine claude"],
  }),
  "session ask": topic({
    title: "apx session ask",
    summary: "Ask a free-form question about a session. Small transcripts answered in one shot; large ones are map-reduced (mine each part, then synthesize).",
    usage: ["apx session ask <id> \"<question>\" [--engine <id>] [--max-chunks N]"],
    options: [
      ["--max-chunks N", "Cap how many transcript parts are mined (default 20)."],
      ["--engine <id>", "Restrict to one engine (apx | claude | codex)."],
    ],
    examples: ["apx session ask 019abc... \"¿qué decidimos sobre el sidebar?\""],
  }),
  "session new": topic({
    title: "apx session new",
    summary: "Create a local runtime session file for an agent.",
    usage: ["apx session new <slug> --title \"<title>\" [--task-ref <ref>] [--body -|\"text\"]"],
    options: [
      ["--title <title>", "Required session title."],
      ["--task-ref <ref>", "External task id or URL."],
      ["--body -|text", "Initial session body from stdin or inline text."],
    ],
    examples: ["apx session new reviewer --title \"Review PR\" --body -"],
  }),
  "session list": topic({
    title: "apx session list",
    summary: "List local runtime sessions.",
    usage: ["apx session list [slug] [--last N]", "apx session ls [slug]"],
    options: [["--last N", "Limit output to the most recent N sessions."]],
    examples: ["apx session list", "apx session list reviewer --last 5"],
  }),
  "session get": topic({
    title: "apx session get",
    summary: "Print one session record (APX local, or any detected engine).",
    usage: [
      "apx session get <id> [--body|--full|--tail N] [--json]",
      "apx session get <id> --engine <apx|claude|codex> [--full|--tail N]",
      "apx session get <id> --any [--full|--tail N]",
    ],
    options: [
      ["--body / --full", "Print the full session file (markdown or JSONL transcript)."],
      ["--tail N[k|m]", "Print the last N bytes of the transcript (e.g. --tail 32k)."],
      ["--engine <id>", "Look inside one engine's storage: apx | claude | codex."],
      ["--any", "Search every detected engine; errors on id collisions."],
      ["--json", "Machine-readable metadata."],
    ],
    examples: [
      "apx session get 2026-05-09-01",
      "apx session get 2026-05-09-01 --body",
      "apx session get b3f0c... --engine claude --tail 16k",
      "apx session get b3f0c... --any --full",
    ],
  }),
  "session update": topic({
    title: "apx session update",
    summary: "Update session frontmatter fields.",
    usage: ["apx session update <id> [--status <s>] [--result <r>] [--title <t>] [--task_ref <ref>] [--completed <iso>]"],
    options: [
      ["--status <s>", "Set status."],
      ["--result <r>", "Set result summary."],
      ["--title <t>", "Set title."],
      ["--task_ref <ref>", "Set task reference."],
      ["--completed <iso>", "Set completion timestamp."],
    ],
    examples: ["apx session update 2026-05-09-01 --status \"in progress\""],
  }),
  "session close": topic({
    title: "apx session close",
    summary: "Mark a session complete and optionally store a result.",
    usage: ["apx session close <id> [--result \"<text>\"]"],
    options: [["--result <text>", "One-line completion result."]],
    examples: ["apx session close 2026-05-09-01 --result \"Tests passing\""],
  }),
  "session check": topic({
    title: "apx session check",
    summary: "Detect active sessions to avoid agent collision.",
    usage: ["apx session check"],
    examples: ["apx session check"],
  }),
  "session close-stale": topic({
    title: "apx session close-stale",
    summary: "Auto-close active sessions older than the stale threshold.",
    usage: ["apx session close-stale"],
    examples: ["apx session close-stale"],
  }),
  "session resume": topic({
    title: "apx session resume",
    summary:
      "Locate <id> across every detected engine (apx | claude | codex), show it, and optionally continue.",
    usage: [
      "apx session resume <id> [--engine <id>] [--summary] [--full|--tail N]",
      "apx session resume <id> --continue            # spawn native CLI to resume",
      "apx session resume <id> --into apx[:slug]     # create a new APX session seeded with the summary",
    ],
    options: [
      ["--engine <id>", "Restrict the search to one engine: apx | claude | codex."],
      ["--summary", "Ask the super-agent to summarize the transcript (needs daemon)."],
      ["--tail N[k|m]", "Print the last N bytes of the transcript (default = metadata only)."],
      ["--full / --body", "Print the entire transcript."],
      ["--continue", "Spawn the engine's native CLI (claude --resume / codex resume)."],
      ["--into apx[:slug]", "Create a new APX session whose body is the summary of <id>."],
      ["--project <name|id|path>", "Pin to a specific APX project (apx-engine summaries only)."],
    ],
    examples: [
      "apx session resume b3f0c12a... --summary",
      "apx session resume 2026-05-09-01 --continue",
      "apx session resume b3f0c12a... --engine claude --into apx:reviewer",
    ],
  }),
  "session compact": topic({
    title: "apx session compact",
    summary: "Compact an agent conversation into a durable summary.",
    usage: ["apx session compact <slug> [--conversation <id>] [--model <model>] [--project <name|id|path>]"],
    options: [
      ["--conversation <id>", "Compact a specific conversation instead of latest."],
      ["--model <model>", "Override summarizer model."],
      ["--project <name|id|path>", "Pin to a specific daemon project."],
    ],
    examples: ["apx session compact reviewer --conversation abc123"],
  }),
  sessions: topic({
    title: "apx sessions",
    summary:
      "List AI engine sessions (APX, Claude Code, Codex, …). Without --engine, lists every detected engine.",
    usage: ["apx sessions list [--engine <id>] [--project <name>|--dir <path>] [--limit N]"],
    commands: [
      ["list | ls", "List engine projects, or sessions of one project."],
    ],
    options: [
      ["--engine <id>", "Filter to one engine: apx | claude | codex | antigravity. Omit to list every detected engine."],
      ["--project <name>", "A registered APX project to resolve the directory from."],
      ["--dir <path>", "An explicit project directory (for unregistered projects)."],
      ["--limit N", "Show only the N most recent sessions per engine."],
    ],
    examples: [
      "apx sessions list                              # every engine, every project",
      "apx sessions list --engine claude",
      "apx sessions list --engine claude --project iacrmar",
      "apx sessions list --dir /path/to/project       # this dir across every engine",
    ],
  }),
  "sessions list": topic({
    title: "apx sessions list",
    summary:
      "List sessions. No --engine → every detected engine (empty engines show '(sin nada)', missing engines are skipped).",
    usage: [
      "apx sessions list                                # multi-engine view",
      "apx sessions list --engine <id>                   # one engine",
      "apx sessions list --engine <id> --project <name>",
      "apx sessions list --engine <id> --dir <path>",
    ],
    options: [
      ["--engine <id>", "apx | claude | codex | antigravity. Omit to scan all."],
      ["--project <name>", "Resolve directory from a registered APX project."],
      ["--dir <path>", "Explicit project directory."],
      ["--limit N", "Show only the N most recent sessions per engine."],
    ],
    examples: [
      "apx sessions list                                            # every engine, every project",
      "apx sessions list --engine claude --project iacrmar",
      "apx sessions list --engine codex --dir /Volumes/work/iacrmar",
    ],
  }),
  mcp: topic({
    title: "apx mcp",
    summary: "Manage and call MCP servers merged from APC and supported IDE configs.",
    usage: ["apx mcp <subcommand> [args] [--flags]"],
    commands: [
      ["list | ls", "List MCP servers for a project."],
      ["add <name>", "Add a project-owned MCP server."],
      ["remove | rm <name>", "Remove a project-owned MCP server."],
      ["enable <name>", "Enable a project-owned MCP server."],
      ["disable <name>", "Disable a project-owned MCP server."],
      ["run <name> <tool>", "Call one MCP tool."],
      ["tools <name>", "Show tool-list hint."],
      ["check", "Audit source files, merge order, and conflicts."],
    ],
    options: [["--project <name|id|path>", "Pin command to a specific project."]],
    examples: ["apx mcp list", "apx mcp run filesystem read_file '{\"path\":\"README.md\"}'"],
  }),
  "mcp list": topic({
    title: "apx mcp list",
    summary: "List MCP servers available to a project.",
    usage: ["apx mcp list [--project <name|id|path>]", "apx mcp ls [--project <name|id|path>]"],
    options: [
      ["--project <name|id|path>", "Pin command to a specific project."],
      ["--scope <shared|runtime|global|all>", "Filter by scope (default: all). shared = .apc/mcps.json, runtime = ~/.apx/projects/<id>/mcps.json, global = ~/.apx/mcps.json."],
    ],
    examples: [
      "apx mcp list",
      "apx mcp list --project default",
      "apx mcp list --scope runtime --project iacrmar",
    ],
  }),
  "mcp add": topic({
    title: "apx mcp add",
    summary: "Add an APX-owned MCP server. Default scope is `shared` (commit to repo) inside an APC project, else `global`.",
    usage: ["apx mcp add <name> --command <cmd> [--scope <shared|runtime|global>] [--env KEY=VAL ...] [--project <name|id|path>] [-- <arg> ...]"],
    options: [
      ["--command <cmd>", "Executable command for stdio MCP server."],
      ["--scope <s>", "shared = .apc/mcps.json (committable); runtime = ~/.apx/projects/<id>/mcps.json (per-project, local, chmod 0600 — use for tokens); global = ~/.apx/mcps.json (machine-wide)."],
      ["--env KEY=VAL", "Environment variable. Repeatable."],
      ["--project <name|id|path>", "Pin command to a specific project."],
      ["-- <arg> ...", "Arguments passed to the MCP command."],
    ],
    examples: [
      "apx mcp add filesystem --command npx -- -y @modelcontextprotocol/server-filesystem .",
      "apx mcp add github --scope runtime --project iacrmar --command npx -- -y @modelcontextprotocol/server-github",
    ],
  }),
  "mcp remove": topic({
    title: "apx mcp remove",
    summary: "Remove an APX-owned MCP server from a given scope.",
    usage: [
      "apx mcp remove <name> [--scope <shared|runtime|global>] [--project <name|id|path>]",
      "apx mcp rm <name> [--scope <shared|runtime|global>] [--project <name|id|path>]",
    ],
    options: [
      ["--project <name|id|path>", "Pin command to a specific project."],
      ["--scope <s>", "Which scope to remove from. Defaults to `shared` inside an APC project, else `global`."],
    ],
    examples: ["apx mcp remove filesystem", "apx mcp remove github --scope runtime --project iacrmar"],
  }),
  "mcp enable": topic({
    title: "apx mcp enable",
    summary: "Enable a project-owned MCP server.",
    usage: ["apx mcp enable <name> [--project <name|id|path>]"],
    options: [["--project <name|id|path>", "Pin command to a specific project."]],
    examples: ["apx mcp enable filesystem"],
  }),
  "mcp disable": topic({
    title: "apx mcp disable",
    summary: "Disable a project-owned MCP server.",
    usage: ["apx mcp disable <name> [--project <name|id|path>]"],
    options: [["--project <name|id|path>", "Pin command to a specific project."]],
    examples: ["apx mcp disable filesystem"],
  }),
  "mcp run": topic({
    title: "apx mcp run",
    summary: "Call a tool on an MCP server through the daemon.",
    usage: ["apx mcp run <name> <tool> ['<json-args>'] [--project <name|id|path>]"],
    options: [["--project <name|id|path>", "Pin command to a specific project."]],
    examples: ["apx mcp run filesystem read_file '{\"path\":\"README.md\"}'"],
  }),
  "mcp tools": topic({
    title: "apx mcp tools",
    summary: "Show MCP tool-list guidance for a server.",
    usage: ["apx mcp tools <name> [--project <name|id|path>]"],
    options: [["--project <name|id|path>", "Pin command to a specific project."]],
    examples: ["apx mcp tools filesystem"],
  }),
  "mcp check": topic({
    title: "apx mcp check",
    summary: "Audit MCP source files, active entries, and merge conflicts.",
    usage: ["apx mcp check [--project <name|id|path>]"],
    options: [["--project <name|id|path>", "Pin command to a specific project."]],
    examples: ["apx mcp check"],
  }),
  daemon: topic({
    title: "apx daemon",
    summary: "Start, stop, restart, inspect, reload, and read logs from the local APX daemon.",
    usage: ["apx daemon <start|stop|restart|reload|status|logs> [--flags]"],
    commands: [
      ["start", "Start daemon."],
      ["stop", "Stop daemon."],
      ["restart", "Stop then start — picks up code, prompt, and tool changes."],
      ["reload", "Re-read ~/.apx/config.json only (NOT code/prompts) without restart."],
      ["status", "Show daemon health."],
      ["logs", "Print daemon log tail."],
    ],
    examples: ["apx daemon status", "apx daemon restart", "apx daemon logs --tail 100"],
  }),
  "daemon restart": topic({
    title: "apx daemon restart",
    summary: "Restart the local APX daemon (stop + start in one step).",
    usage: ["apx daemon restart"],
    examples: ["apx daemon restart"],
  }),
  "daemon start": topic({
    title: "apx daemon start",
    summary: "Start the local APX daemon.",
    usage: ["apx daemon start"],
    examples: ["apx daemon start"],
  }),
  "daemon stop": topic({
    title: "apx daemon stop",
    summary: "Stop the local APX daemon.",
    usage: ["apx daemon stop"],
    examples: ["apx daemon stop"],
  }),
  "daemon status": topic({
    title: "apx daemon status",
    summary: "Show local APX daemon status.",
    usage: ["apx daemon status"],
    examples: ["apx daemon status"],
  }),
  "daemon logs": topic({
    title: "apx daemon logs",
    summary: "Print daemon logs.",
    usage: ["apx daemon logs [--tail N]"],
    options: [["--tail N", "Number of lines to print."]],
    examples: ["apx daemon logs --tail 100"],
  }),
  telegram: topic({
    title: "apx telegram",
    summary: "Configure, inspect, and send through the Telegram bridge.",
    usage: ["apx telegram <send|status|start|stop|setup|channel|contacts|role|roles|owner> [args] [--flags]"],
    commands: [
      ["send \"text\"", "Send a Telegram message."],
      ["status", "Show Telegram plugin status."],
      ["start", "Start polling on every configured channel."],
      ["stop", "Stop polling (config stays intact)."],
      ["setup", "Print setup guidance."],
      ["channel <sub>", "Manage channels: add | list | show | set | unset | remove."],
      ["contacts", "List the known-people roster (auto-recorded from inbound messages)."],
      ["role <user_id> <role>", "Assign a role to a contact (owner-only / terminal)."],
      ["roles <sub>", "Define role→tools: list | set <name> --tools a,b | rm <name>."],
      ["owner <channel> <user_id>", "Set who owns a channel."],
    ],
    examples: [
      "apx telegram status",
      "apx telegram channel add",
      "apx telegram contacts",
      "apx telegram role 889721252 editor",
      "apx telegram owner default 889721252",
      "apx telegram send \"hello\" --chat 123456",
    ],
  }),
  "telegram contacts": topic({
    title: "apx telegram contacts",
    summary: "List the global contacts roster, with each person's role and last-seen.",
    usage: ["apx telegram contacts", "apx telegram contacts rm <user_id>"],
    examples: ["apx telegram contacts", "apx telegram contacts rm 123456"],
  }),
  "telegram role": topic({
    title: "apx telegram role",
    summary: "Assign a role to a contact by Telegram user_id. Roles gate which tools they can use.",
    usage: ["apx telegram role <user_id> <role>"],
    examples: ["apx telegram role 889721252 editor", "apx telegram role 123456 guest"],
  }),
  "telegram roles": topic({
    title: "apx telegram roles",
    summary: "Define role→tools capability maps. owner/guest are built-in.",
    usage: [
      "apx telegram roles",
      "apx telegram roles set <name> --tools call_agent,list_tasks",
      "apx telegram roles set <name> --tools '*'",
      "apx telegram roles rm <name>",
    ],
    examples: [
      "apx telegram roles",
      "apx telegram roles set editor --tools call_agent,create_task,list_tasks",
    ],
  }),
  "telegram owner": topic({
    title: "apx telegram owner",
    summary: "Set who owns a channel (overrides their role to owner on that channel).",
    usage: ["apx telegram owner <channel> <user_id>"],
    examples: ["apx telegram owner default 889721252"],
  }),
  "telegram send": topic({
    title: "apx telegram send",
    summary: "Send a Telegram message through the configured bridge.",
    usage: ["apx telegram send \"<text>\" [--chat <id>] [--interrupt]"],
    options: [
      ["--chat <id>", "Override configured chat id."],
      ["--interrupt", "Send immediately, bypassing any pending agent queue (alias: --force)."],
      ["--force", "Alias for --interrupt."],
    ],
    examples: [
      "apx telegram send \"Deploy finished\" --chat 123456",
      "apx telegram send \"Urgent!\" --interrupt",
    ],
  }),
  "telegram status": topic({
    title: "apx telegram status",
    summary: "Show Telegram bridge status.",
    usage: ["apx telegram status"],
    examples: ["apx telegram status"],
  }),
  "telegram start": topic({
    title: "apx telegram start",
    summary: "Start Telegram polling on every configured channel.",
    usage: ["apx telegram start"],
    examples: ["apx telegram start"],
  }),
  "telegram stop": topic({
    title: "apx telegram stop",
    summary: "Stop Telegram polling (config stays intact; resume with apx telegram start).",
    usage: ["apx telegram stop"],
    examples: ["apx telegram stop"],
  }),
  "telegram setup": topic({
    title: "apx telegram setup",
    summary: "Print Telegram setup guidance.",
    usage: ["apx telegram setup"],
    examples: ["apx telegram setup"],
  }),
  "telegram channel": topic({
    title: "apx telegram channel",
    summary: "Manage entries in cfg.telegram.channels[] — name, bot, chat, pinned project, master agent.",
    usage: ["apx telegram channel <subcommand> [args] [--flags]"],
    commands: [
      ["add [name]", "Interactive wizard (or non-interactive with flags)."],
      ["list | ls", "List configured channels."],
      ["show <name>", "Print one channel as JSON."],
      ["set <name>", "Patch fields (--project, --agent, --respond-engine true|false, --bot-token, --chat-id)."],
      ["unset <name>", "Clear optional fields (--project, --agent, --bot-token, --chat-id)."],
      ["remove | rm <name>", "Delete the channel from the array."],
    ],
    options: [
      ["--project <name|id|path>", "Pin channel to a project for inbound routing."],
      ["--agent <slug>", "Route inbound to this agent instead of the super-agent."],
      ["--respond-engine <true|false>", "Whether the engine auto-replies on this channel."],
      ["--bot-token <token>", "Override bot_token (use `add` non-interactively or `set` to rotate)."],
      ["--chat-id <id>", "Default outbound chat id."],
    ],
    examples: [
      "apx telegram channel add",
      "apx telegram channel add clientes --bot-token TOKEN --chat-id 1234 --project iacrmar --agent comercial",
      "apx telegram channel list",
      "apx telegram channel set clientes --agent reviewer",
      "apx telegram channel unset clientes --agent",
      "apx telegram channel remove clientes",
    ],
  }),
  "telegram channel add": topic({
    title: "apx telegram channel add",
    summary: "Interactive wizard (or one-shot non-interactive form) to add a Telegram channel.",
    usage: [
      "apx telegram channel add",
      "apx telegram channel add <name> --bot-token TOKEN --chat-id ID [--project P] [--agent A] [--respond-engine true|false]",
    ],
    examples: [
      "apx telegram channel add",
      "apx telegram channel add support --bot-token 12345:ABC --chat-id 1234 --project default",
    ],
  }),
  "telegram channel list": topic({
    title: "apx telegram channel list",
    summary: "List configured Telegram channels.",
    usage: ["apx telegram channel list", "apx telegram channel ls"],
    examples: ["apx telegram channel list"],
  }),
  "telegram channel show": topic({
    title: "apx telegram channel show",
    summary: "Print one Telegram channel as pretty JSON.",
    usage: ["apx telegram channel show <name>"],
    examples: ["apx telegram channel show clientes"],
  }),
  "telegram channel set": topic({
    title: "apx telegram channel set",
    summary: "Patch fields on an existing Telegram channel and reload the daemon.",
    usage: ["apx telegram channel set <name> [--project P] [--agent A] [--respond-engine true|false] [--bot-token T] [--chat-id ID]"],
    examples: [
      "apx telegram channel set clientes --project iacrmar --agent comercial",
      "apx telegram channel set clientes --respond-engine false",
    ],
  }),
  "telegram channel unset": topic({
    title: "apx telegram channel unset",
    summary: "Clear optional fields on a channel (project pin, master agent, etc).",
    usage: ["apx telegram channel unset <name> [--project] [--agent] [--bot-token] [--chat-id]"],
    examples: ["apx telegram channel unset clientes --agent", "apx telegram channel unset clientes --project"],
  }),
  "telegram channel remove": topic({
    title: "apx telegram channel remove",
    summary: "Delete a channel from cfg.telegram.channels[] and reload the daemon.",
    usage: ["apx telegram channel remove <name>", "apx telegram channel rm <name>"],
    examples: ["apx telegram channel remove clientes"],
  }),
  messages: topic({
    title: "apx messages",
    summary: "Read APX message logs.",
    usage: ["apx messages <tail|chat|search> [args] [--flags]"],
    commands: [
      ["tail", "Print recent messages."],
      ["chat", "Print recent messages as a chat transcript with actor types."],
      ["search \"query\"", "Search message logs."],
    ],
    examples: ["apx messages chat --channel telegram -n 20", "apx messages search \"deploy\""],
  }),
  "messages tail": topic({
    title: "apx messages tail",
    summary: "Print recent APX messages.",
    usage: ["apx messages tail [--agent <slug>] [--channel <name>] [-n N] [--global] [--project <name|id|path>]"],
    options: [
      ["--agent <slug>", "Filter by agent."],
      ["--channel <name>", "Filter by channel, for example runtime, telegram, exec."],
      ["-n N", "Number of messages to print."],
      ["--global", "Read global message store where supported."],
      ["--project <name|id|path>", "Pin command to a specific project."],
    ],
    examples: ["apx messages tail", "apx messages tail --channel runtime -n 20"],
  }),
  "messages search": topic({
    title: "apx messages search",
    summary: "Search APX message logs.",
    usage: ["apx messages search \"<query>\" [--project <name|id|path>]"],
    options: [["--project <name|id|path>", "Pin command to a specific project."]],
    examples: ["apx messages search \"deploy\""],
  }),
  search: topic({
    title: "apx search",
    summary: "Web search from the terminal (DuckDuckGo / Brave / Puppeteer fallback).",
    usage: ["apx search \"<query>\" [--mode auto|ddg|brave|browser] [-n N] [--json]"],
    options: [
      ["--mode <m>", "auto (default) | ddg | brave | browser. Brave needs BRAVE_API_KEY."],
      ["-n N",       "Number of results (default 5, max 20)."],
      ["--json",     "Output raw JSON instead of the formatted list."],
    ],
    examples: [
      "apx search \"agent project context\"",
      "apx search \"node 22 release notes\" --mode ddg -n 10",
      "apx search \"weather buenos aires\" --json",
    ],
  }),
  "messages chat": topic({
    title: "apx messages chat",
    summary: "Print APX messages as a chat transcript with user, agent, tool, or system type.",
    usage: ["apx messages chat [--channel <name>] [-n N] [--global] [--agent <slug>] [--project <name|id|path>]"],
    options: [
      ["--channel <name>", "Filter by channel; telegram defaults to global message store."],
      ["-n N", "Number of messages to print."],
      ["--global", "Read global message store."],
      ["--agent <slug>", "Filter project messages by agent."],
      ["--project <name|id|path>", "Pin command to a specific project."],
    ],
    examples: ["apx messages chat --channel telegram -n 20", "apx messages chat --channel a2a --project default"],
  }),
  exec: topic({
    title: "apx exec",
    summary: "One-shot LLM call. Default target is the APX super-agent (daemon); use -a for an APC agent slug.",
    usage: [
      "apx exec \"<prompt>\" [--model <id>] [--project <name|id|path>]",
      "apx exec -- \"<prompt>\"",
      "apx exec -a <agent> \"<prompt>\" [--model <id>]",
      "apx exec <agent> \"<prompt>\"  (legacy positional agent)",
    ],
    options: [
      ["-a, --agent <slug>", "APC agent slug (omit for super-agent default)."],
      ["--model <id>", "Override configured model."],
      ["--max-tokens N", "Output token limit."],
      ["--temperature T", "Sampling temperature."],
      ["--project <name|id|path>", "Pin command to a specific project."],
    ],
    examples: [
      "apx exec \"What time is it in UTC?\"",
      "apx exec -- \"decime qué hora es\"",
      "apx exec -a reviewer \"Summarize your role\"",
      "apx exec reviewer \"Summarize your role\" --model gpt-5.2",
    ],
  }),
  chat: topic({
    title: "apx chat",
    summary: "Start an interactive agent chat REPL.",
    usage: ["apx chat <agent> [--conversation <id>] [--model <id>] [--project <name|id|path>]"],
    options: [
      ["--conversation <id>", "Continue an existing conversation."],
      ["--model <id>", "Override configured model."],
      ["--project <name|id|path>", "Pin command to a specific project."],
    ],
    examples: ["apx chat reviewer", "apx chat reviewer --conversation abc123"],
  }),
  code: topic({
    title: "apx code",
    summary: "Start the APX terminal coding assistant with system and workspace context.",
    usage: ["apx code [--project <name|id|path>] [--agent <slug>]"],
    options: [
      ["--project <name|id|path>", "Pin command to a specific project."],
      ["--agent <slug>", "Route chat to a project agent instead of the APX default (super-agent mode)."],
    ],
    examples: ["apx code", "apx code --project default", "apx code --agent reviewer"],
  }),
  conversations: topic({
    title: "apx conversations",
    summary: "List or read stored agent conversations.",
    usage: ["apx conversations <list|get> <agent> [id] [--project <name|id|path>]", "apx conv <list|get> <agent> [id]"],
    commands: [
      ["list | ls <agent>", "List conversations for an agent."],
      ["get | show <agent> <id>", "Print one conversation."],
    ],
    options: [["--project <name|id|path>", "Pin command to a specific project."]],
    examples: ["apx conversations list reviewer", "apx conversations get reviewer abc123"],
  }),
  "conversations list": topic({
    title: "apx conversations list",
    summary: "List stored conversations for an agent.",
    usage: ["apx conversations list <agent> [--project <name|id|path>]", "apx conv ls <agent>"],
    options: [["--project <name|id|path>", "Pin command to a specific project."]],
    examples: ["apx conversations list reviewer"],
  }),
  "conversations get": topic({
    title: "apx conversations get",
    summary: "Print one stored conversation.",
    usage: ["apx conversations get <agent> <id> [--project <name|id|path>]", "apx conv show <agent> <id>"],
    options: [["--project <name|id|path>", "Pin command to a specific project."]],
    examples: ["apx conversations get reviewer abc123"],
  }),
  conv: topic({
    title: "apx conv",
    summary: "Alias for apx conversations.",
    usage: ["apx conv <list|get> <agent> [id]"],
    examples: ["apx conv list reviewer"],
  }),
  run: topic({
    title: "apx run",
    summary: "Launch a full external runtime session for an agent.",
    usage: ["apx run <agent> --runtime <claude-code|codex|opencode|aider|cursor-agent|gemini-cli|qwen-code> \"<prompt>\" [--timeout <seconds>] [--project <name|id|path>]"],
    options: [
      ["--runtime <id>", "Runtime CLI to launch: claude-code, codex, opencode, aider, cursor-agent, gemini-cli, qwen-code."],
      ["--timeout <seconds>", "Runtime timeout."],
      ["--project <name|id|path>", "Pin command to a specific project."],
    ],
    examples: ["apx run reviewer --runtime codex \"Review this repo\" --timeout 600"],
  }),
  env: topic({
    title: "apx env",
    summary: "Inspect local agent runtime environment.",
    usage: ["apx env detect", "apx env list"],
    commands: [["detect | list", "Show which supported runtime CLIs are installed."]],
    examples: ["apx env detect"],
  }),
  "env detect": topic({
    title: "apx env detect",
    summary: "Show which supported runtime CLIs are installed.",
    usage: ["apx env detect", "apx env list"],
    examples: ["apx env detect"],
  }),
  send: topic({
    title: "apx send",
    summary: "Log an agent-to-agent message, optionally delivering it through the target engine.",
    usage: ["apx send <from> <to> \"<message>\" [--deliver] [--project <name|id|path>]"],
    options: [
      ["--deliver", "Run the target engine after logging the message."],
      ["--project <name|id|path>", "Pin command to a specific project."],
    ],
    examples: ["apx send planner reviewer \"Please review this plan\" --deliver"],
  }),
  connections: topic({
    title: "apx connections",
    summary: "Show an agent communication map.",
    usage: ["apx connections <agent> [--project <name|id|path>]"],
    options: [["--project <name|id|path>", "Pin command to a specific project."]],
    examples: ["apx connections reviewer"],
  }),
  routine: topic({
    title: "apx routine",
    summary: "Manage scheduled APX routines.",
    usage: ["apx routine <subcommand> [args] [--flags]"],
    commands: [
      ["list | ls", "List routines with next and last run."],
      ["add | new <name>", "Create a routine."],
      ["get | show <name>", "Print routine definition."],
      ["history | hist <name>", "Show execution history."],
      ["run <name>", "Trigger manually."],
      ["enable <name>", "Enable routine."],
      ["disable <name>", "Disable routine."],
      ["remove | rm <name>", "Remove routine."],
    ],
    examples: ["apx routine list", "apx routine add heartbeat --kind heartbeat --schedule every:5m"],
  }),
  routines: topic({
    title: "apx routines",
    summary: "Alias for apx routine.",
    usage: ["apx routines <subcommand> [args] [--flags]"],
    examples: ["apx routines list"],
  }),
  "routine list": topic({
    title: "apx routine list",
    summary: "List routines with next and last run details.",
    usage: ["apx routine list [--project <name|id|path>]", "apx routine ls [--project <name|id|path>]"],
    options: [["--project <name|id|path>", "Pin command to a specific project."]],
    examples: ["apx routine list"],
  }),
  "routine add": topic({
    title: "apx routine add",
    summary: "Create a scheduled routine.",
    usage: ["apx routine add <name> --kind <kind> --schedule <schedule> [--spec '<json>'] [--pre-commands 'cmd1,cmd2'] [--post-commands 'cmd'] [--skip-prompt-on signal|pre_failure|pre_success|always|never] [--project <name|id|path>]"],
    options: [
      ["--kind <kind>", "heartbeat, exec_agent, super_agent, telegram, or shell."],
      ["--schedule <schedule>", "every:60s, every:5m, every:1h, or once:<iso>."],
      ["--spec '<json>'", "Routine-specific JSON config."],
      ["--pre-commands 'cmd'", "Comma-separated shell commands to run BEFORE the LLM. Use 'artifact:<name>' shorthand."],
      ["--post-commands 'cmd'", "Comma-separated shell commands to run AFTER the LLM. Env: APX_LLM_OUTPUT, APX_PRE_OUTPUT, APX_STATUS."],
      ["--skip-prompt-on <mode>", "signal (default), pre_failure, pre_success, always, never."],
      ["--permission-mode <mode>", "total, automatico, or permiso."],
      ["--allowed-tools a,b", "Comma-separated allowed tool names."],
      ["--project <name|id|path>", "Pin command to a specific project."],
    ],
    examples: [
      "apx routine add check --kind shell --schedule every:1h --spec '{\"cmd\":\"npm test\"}'",
      "apx routine add asana-check --kind super_agent --schedule '*/5 * * * *' --pre-commands 'artifact:check_asana.sh' --skip-prompt-on pre_success --project 0",
    ],
  }),
  "routine get": topic({
    title: "apx routine get",
    summary: "Print one routine definition.",
    usage: ["apx routine get <name> [--project <name|id|path>]", "apx routine show <name> [--project <name|id|path>]"],
    options: [["--project <name|id|path>", "Pin command to a specific project."]],
    examples: ["apx routine get check"],
  }),
  "routine history": topic({
    title: "apx routine history",
    summary: "Show execution history for one routine.",
    usage: ["apx routine history <name> [--project <name|id|path>]", "apx routine hist <name> [--project <name|id|path>]"],
    options: [["--project <name|id|path>", "Pin command to a specific project."]],
    examples: ["apx routine history check"],
  }),
  "routine run": topic({
    title: "apx routine run",
    summary: "Trigger a routine manually, ignoring schedule.",
    usage: ["apx routine run <name> [--project <name|id|path>]"],
    options: [["--project <name|id|path>", "Pin command to a specific project."]],
    examples: ["apx routine run check"],
  }),
  "routine enable": topic({
    title: "apx routine enable",
    summary: "Enable one routine.",
    usage: ["apx routine enable <name> [--project <name|id|path>]"],
    options: [["--project <name|id|path>", "Pin command to a specific project."]],
    examples: ["apx routine enable check"],
  }),
  "routine disable": topic({
    title: "apx routine disable",
    summary: "Disable one routine.",
    usage: ["apx routine disable <name> [--project <name|id|path>]"],
    options: [["--project <name|id|path>", "Pin command to a specific project."]],
    examples: ["apx routine disable check"],
  }),
  "routine remove": topic({
    title: "apx routine remove",
    summary: "Remove one routine.",
    usage: ["apx routine remove <name> [--project <name|id|path>]", "apx routine rm <name> [--project <name|id|path>]"],
    options: [["--project <name|id|path>", "Pin command to a specific project."]],
    examples: ["apx routine remove check"],
  }),
  artifact: topic({
    title: "apx artifact",
    summary: "Managed files stored in project storage. Used as pre/post-commands scripts or data files for routines.",
    usage: ["apx artifact <subcommand> [args] [--flags]"],
    commands: [
      ["create <name>", "Create a new empty artifact. Prints its absolute path."],
      ["list | ls", "List artifacts in the project."],
      ["show <name>", "Print artifact content."],
      ["run <name> [args...]", "Execute a runnable artifact (shebang or +x). Stdio is inherited."],
      ["remove | rm <name>", "Delete an artifact."],
    ],
    examples: [
      "apx artifact create check_asana.sh --project 0",
      "apx artifact list",
      "apx artifact show check_asana.sh",
      "apx artifact run check_asana.sh",
    ],
  }),
  "artifact create": topic({
    title: "apx artifact create",
    summary: "Create a new managed artifact file.",
    usage: ["apx artifact create <name> [--content 'text'] [--project <name|id|path>]"],
    options: [
      ["--content 'text'", "Initial file content (default: empty)."],
      ["--project <name|id|path>", "Pin command to a specific project."],
    ],
    examples: ["apx artifact create check_asana.sh --project 0"],
  }),
  "artifact list": topic({
    title: "apx artifact list",
    summary: "List artifacts in the project storage.",
    usage: ["apx artifact list [--project <name|id|path>]"],
    options: [["--project <name|id|path>", "Pin command to a specific project."]],
    examples: ["apx artifact list"],
  }),
  "artifact show": topic({
    title: "apx artifact show",
    summary: "Print artifact content.",
    usage: ["apx artifact show <name> [--project <name|id|path>]"],
    options: [["--project <name|id|path>", "Pin command to a specific project."]],
    examples: ["apx artifact show check_asana.sh"],
  }),
  "artifact remove": topic({
    title: "apx artifact remove",
    summary: "Delete an artifact.",
    usage: ["apx artifact remove <name> [--project <name|id|path>]", "apx artifact rm <name>"],
    options: [["--project <name|id|path>", "Pin command to a specific project."]],
    examples: ["apx artifact remove check_asana.sh"],
  }),
  command: topic({
    title: "apx command",
    summary: "List or show workflow commands from .apc/commands/.",
    usage: ["apx command [list] [--project <name|id|path>]", "apx command show <name> [--project <name|id|path>]"],
    commands: [
      ["list | ls", "List workflow commands."],
      ["show | get <name>", "Print one command file."],
    ],
    options: [["--project <name|id|path>", "Pin command to a specific project; defaults to current APC project or default."]],
    examples: ["apx command list", "apx command show release"],
  }),
  commands: topic({
    title: "apx commands",
    summary: "Alias for apx command.",
    usage: ["apx commands [list]", "apx commands show <name>"],
    examples: ["apx commands list"],
  }),
  "command list": topic({
    title: "apx command list",
    summary: "List workflow commands in .apc/commands/.",
    usage: ["apx command list [--project <name|id|path>]", "apx command ls [--project <name|id|path>]"],
    options: [["--project <name|id|path>", "Pin command to a specific project; defaults to current APC project or default."]],
    examples: ["apx command list"],
  }),
  "command show": topic({
    title: "apx command show",
    summary: "Print one workflow command file.",
    usage: ["apx command show <name> [--project <name|id|path>]", "apx command get <name> [--project <name|id|path>]"],
    options: [["--project <name|id|path>", "Pin command to a specific project; defaults to current APC project or default."]],
    examples: ["apx command show release"],
  }),
  skills: topic({
    title: "apx skills",
    summary: "Install and inspect APX skill files for IDEs and agent tools.",
    usage: ["apx skills [add] [targets] [--global]", "apx skills sync", "apx skills list", "apx skills status"],
    commands: [
      ["add [targets]", "Install APX skills into selected targets."],
      ["sync | refresh", "Re-install every bundled skill to every global skill dir (idempotent)."],
      ["list | ls", "List skills installed in this project's .apc/skills/."],
      ["status", "Show which bundled skills are present in each global dir."],
    ],
    examples: [
      "apx skills add claude-code cursor",
      "apx skills add --global",
      "apx skills sync                # force-refresh after editing skills/ in the repo",
      "apx skills sync --verbose      # show every (skill × target) line",
    ],
  }),
  "skills add": topic({
    title: "apx skills add",
    summary: "Install APX skill files into local or global agent-tool targets.",
    usage: ["apx skills add [targets] [--global]"],
    options: [["--global", "Install to global user-level skill targets."]],
    examples: ["apx skills add claude-code cursor", "apx skills add --global"],
  }),
  "skills sync": topic({
    title: "apx skills sync",
    summary:
      "Refresh bundled APX skills (auto-discovered from skills/) into every global skill dir (.claude, .cursor, .codex, .agents). Pushes only `scope: public` skills by default; pass --include-optional / --include-internal to push the other tiers. Prunes copies of slugs no longer included (use --no-prune to keep them).",
    usage: [
      "apx skills sync [--verbose] [--include-optional] [--include-internal] [--no-prune]",
      "apx skills refresh",
    ],
    options: [
      ["--include-optional", "Also push `scope: optional` skills (apx-voice, …)."],
      ["--include-internal", "Also push `scope: internal` APX-dev skills (apx-mcp-builder, …)."],
      ["--no-prune", "Don't remove global copies of slugs that aren't included this run."],
      ["--verbose", "List each (skill × dir) result, not just the rollup."],
    ],
    examples: [
      "apx skills sync",
      "apx skills sync --include-optional",
      "apx skills sync --include-internal --verbose",
    ],
  }),
  "skills list": topic({
    title: "apx skills list",
    summary: "List known APX skill targets.",
    usage: ["apx skills list", "apx skills ls"],
    examples: ["apx skills list"],
  }),
  "skills status": topic({
    title: "apx skills status",
    summary: "Show which APX skill targets are installed.",
    usage: ["apx skills status"],
    examples: ["apx skills status"],
  }),
  plugins: topic({
    title: "apx plugins",
    summary: "Inspect loaded APX daemon plugins.",
    usage: ["apx plugins [list]", "apx plugins status <id>"],
    commands: [
      ["list | ls", "Show loaded plugins and status."],
      ["status <id>", "Print detailed status for one plugin."],
    ],
    examples: ["apx plugins list", "apx plugins status telegram"],
  }),
  plugin: topic({
    title: "apx plugin",
    summary: "Alias for apx plugins.",
    usage: ["apx plugin [list]", "apx plugin status <id>"],
    examples: ["apx plugin list"],
  }),
  "plugins list": topic({
    title: "apx plugins list",
    summary: "Show loaded plugins and their status.",
    usage: ["apx plugins list", "apx plugins ls"],
    examples: ["apx plugins list"],
  }),
  "plugins status": topic({
    title: "apx plugins status",
    summary: "Show detailed status for one plugin.",
    usage: ["apx plugins status <id>"],
    examples: ["apx plugins status telegram"],
  }),

  task: topic({
    title: "apx task",
    summary: "Per-project TODO list backed by the daemon (/projects/:pid/tasks).",
    usage: ["apx task <subcommand> [args] [--flags]"],
    commands: [
      ["add | new | create \"<title>\"", "Create a task. Tags repeatable."],
      ["list | ls", "List tasks (default state=open)."],
      ["show | get <id>", "Print one task as JSON."],
      ["done | complete <id>", "Mark task done."],
      ["drop | archive <id>", "Drop / archive a task."],
      ["reopen <id>", "Reopen a done or dropped task."],
      ["patch | edit <id>", "Edit fields on an existing task."],
    ],
    options: [["--project <name|id|path>", "Pin command to a specific project."]],
    examples: [
      "apx task add \"Ship release notes\" --tag release --due 2026-06-01",
      "apx task list --state open --tag release",
      "apx task done t_abc123",
    ],
  }),
  tasks: topic({
    title: "apx tasks",
    summary: "Alias for apx task.",
    usage: ["apx tasks <subcommand> [args] [--flags]"],
    examples: ["apx tasks list"],
  }),
  "task add": topic({
    title: "apx task add",
    summary: "Create a task on a project's TODO list.",
    usage: ["apx task add \"<title>\" [--project X] [--body Y] [--tag t]... [--due 2026-05-30] [--agent A] [--source S]"],
    options: [
      ["--body <text>", "Optional task body / description."],
      ["--tag <name>", "Tag the task. Repeatable for multiple tags."],
      ["--due <date>", "Due date (any ISO-ish string the daemon accepts)."],
      ["--agent <slug>", "Pre-assign the task to an agent."],
      ["--source <name>", "Origin label (default: cli)."],
      ["--project <name|id|path>", "Pin command to a specific project."],
    ],
    examples: [
      "apx task add \"Review PR #42\" --agent reviewer --tag review",
      "apx task add \"Release notes\" --tag release --tag docs --due 2026-06-01",
    ],
  }),
  "task list": topic({
    title: "apx task list",
    summary: "List tasks in the current project (defaults to open).",
    usage: ["apx task list [--state open|done|dropped|all] [--tag X] [--agent Y] [--due-before ISO] [--limit N] [--project P]"],
    options: [
      ["--state <s>", "open (default) | done | dropped | all."],
      ["--tag <name>", "Filter by tag."],
      ["--agent <slug>", "Filter by assigned agent."],
      ["--due-before <iso>", "Only tasks with due date before this ISO date."],
      ["--limit N", "Cap the number of rows."],
      ["--project <name|id|path>", "Pin command to a specific project."],
    ],
    examples: [
      "apx task list",
      "apx task list --state all --limit 50",
      "apx task list --agent reviewer --tag review",
    ],
  }),
  "task show": topic({
    title: "apx task show",
    summary: "Print one task as JSON.",
    usage: ["apx task show <id> [--project <name|id|path>]"],
    options: [["--project <name|id|path>", "Pin command to a specific project."]],
    examples: ["apx task show t_abc123"],
  }),
  "task done": topic({
    title: "apx task done",
    summary: "Mark a task as done.",
    usage: ["apx task done <id> [--by <name>] [--project <name|id|path>]"],
    options: [
      ["--by <name>", "Who marked it done (free-form label)."],
      ["--project <name|id|path>", "Pin command to a specific project."],
    ],
    examples: ["apx task done t_abc123", "apx task done t_abc123 --by reviewer"],
  }),
  "task drop": topic({
    title: "apx task drop",
    summary: "Drop / archive a task (kept in history, hidden from default list).",
    usage: ["apx task drop <id> [--by <name>] [--project <name|id|path>]"],
    options: [
      ["--by <name>", "Who dropped it (free-form label)."],
      ["--project <name|id|path>", "Pin command to a specific project."],
    ],
    examples: ["apx task drop t_abc123"],
  }),
  "task reopen": topic({
    title: "apx task reopen",
    summary: "Reopen a previously done or dropped task.",
    usage: ["apx task reopen <id> [--project <name|id|path>]"],
    options: [["--project <name|id|path>", "Pin command to a specific project."]],
    examples: ["apx task reopen t_abc123"],
  }),
  "task patch": topic({
    title: "apx task patch",
    summary: "Edit fields on an existing task (title/body/due/agent/tags).",
    usage: ["apx task patch <id> [--title T] [--body B] [--due D] [--agent A] [--tag t]... [--project P]"],
    options: [
      ["--title <text>", "Replace the title."],
      ["--body <text>", "Replace the body."],
      ["--due <date>", "Replace the due date (empty string clears)."],
      ["--agent <slug>", "Reassign (empty string clears)."],
      ["--tag <name>", "Replace tags. Repeatable; passing none clears."],
      ["--project <name|id|path>", "Pin command to a specific project."],
    ],
    examples: [
      "apx task patch t_abc123 --title \"New title\"",
      "apx task patch t_abc123 --tag review --tag urgent",
    ],
  }),

  // ── Pair (companion-device pairing) ───────────────────────────────────────
  pair: topic({
    title: "apx pair",
    summary: "Pair a companion device (Deck app, etc.) with the local APX daemon via QR code.",
    usage: [
      "apx pair [label] [--label <name>]",
      "apx pair web",
      "apx pair list | ls",
      "apx pair revoke <id>",
    ],
    commands: [
      ["(no arg) | deck | device", "QR for the APX Deck app (JSON payload). Poll until the device confirms."],
      ["web", "QR + link for a browser on the LAN — scan with the phone camera or share the link."],
      ["list | ls", "List currently-paired clients."],
      ["revoke | rm <id>", "Revoke a paired client token."],
    ],
    options: [["--label <name>", "Friendly label stored with the pairing."]],
    examples: ["apx pair", "apx pair web", "apx pair list", "apx pair revoke d_abc123"],
    notes: [
      "`apx pair` (deck) QR carries a JSON payload only the Deck app understands.",
      "`apx pair web` QR carries a URL a browser/phone-camera can open — see `apx help pair web`.",
      "Both share one engine: a per-client token, listable with `apx pair list`, revocable with `apx pair revoke`.",
    ],
  }),
  "pair web": topic({
    title: "apx pair web",
    summary: "Pair a browser on the LAN. Mints a one-shot code (90s) and renders a QR + a shareable link.",
    usage: ["apx pair web"],
    commands: [
      ["scan QR", "Point the phone's native camera at the QR → it opens the web already linked."],
      ["share link", "Copy the printed `link:` (…/#pair=<code>) into Telegram/chat; tapping it pairs the browser."],
      ["paste code", "Type the printed `code:` into the web pairing screen (manual fallback)."],
    ],
    examples: ["apx pair web"],
    notes: [
      "The QR/link encode a URL, so they only work for browsers — for the APX Deck app use `apx pair`.",
      "The daemon must be reachable from the device: bind LAN (host=0.0.0.0) or use a tunnel (Tailscale/Cloudflare).",
      "The code expires in 90s and is single-use; re-run to get a fresh one.",
      "Each paired browser shows up in Settings › Dispositivos (kind=web) and is revocable with `apx pair revoke <id>`.",
    ],
  }),
  "pair new": topic({
    title: "apx pair new",
    summary: "Issue a pairing nonce, render the QR, and poll the daemon until the device confirms.",
    usage: ["apx pair [label] [--label <name>]", "apx pair new", "apx pair device"],
    options: [["--label <name>", "Friendly label stored with the pairing."]],
    examples: ["apx pair", "apx pair \"phone\"", "apx pair new --label tablet"],
  }),
  "pair list": topic({
    title: "apx pair list",
    summary: "List currently-paired companion clients.",
    usage: ["apx pair list", "apx pair ls"],
    examples: ["apx pair list"],
  }),
  "pair revoke": topic({
    title: "apx pair revoke",
    summary: "Revoke a paired client token by id.",
    usage: ["apx pair revoke <id>", "apx pair rm <id>"],
    examples: ["apx pair revoke d_abc123"],
  }),

  // ── Desktop (floating voice window) ───────────────────────────────────────
  desktop: topic({
    title: "apx desktop",
    summary: "Launch, stop, or inspect the floating Electron voice desktop window.",
    usage: ["apx desktop <start|stop|status|install|uninstall> [--flags]"],
    commands: [
      ["start",     "Start the desktop window (or report if already running)."],
      ["stop",      "Stop the desktop window."],
      ["status",    "Print desktop process state, PID, and autostart status."],
      ["install",   "Activate autostart at user login (per-user, no sudo)."],
      ["uninstall", "Deactivate autostart at user login."],
    ],
    options: [["--debug, -d", "Verbose start-up logs (start only)."]],
    examples: [
      "apx desktop start", "apx desktop status", "apx desktop stop",
      "apx desktop install", "apx desktop uninstall",
    ],
  }),
  "desktop start": topic({
    title: "apx desktop start",
    summary: "Start the floating Electron voice desktop window. No-op if it is already running.",
    usage: ["apx desktop start [--debug]"],
    options: [["--debug, -d", "Verbose start-up logs."]],
    examples: ["apx desktop start", "apx desktop start --debug"],
  }),
  "desktop stop": topic({
    title: "apx desktop stop",
    summary: "Stop the floating Electron voice desktop window.",
    usage: ["apx desktop stop"],
    examples: ["apx desktop stop"],
  }),
  "desktop status": topic({
    title: "apx desktop status",
    summary: "Print desktop process state and PID (read from ~/.apx/desktop.pid).",
    usage: ["apx desktop status"],
    examples: ["apx desktop status"],
  }),
  overlay: topic({
    title: "apx overlay (deprecated)",
    summary: "Renamed to `apx desktop`. The old name still works and forwards.",
    usage: ["apx desktop <start|stop|status>"],
    examples: ["apx desktop start"],
  }),

  // ── Voice (TTS / mic round-trip) ──────────────────────────────────────────
  voice: topic({
    title: "apx voice",
    summary: "Speak text through the daemon TTS, run a mic→reply round-trip, or list providers.",
    usage: [
      "apx voice say \"<text>\" [--provider <id>] [--voice <name>] [--no-play]",
      "apx voice listen [--seconds N] [--provider <id>] [--no-play]",
      "apx voice providers",
    ],
    commands: [
      ["say \"<text>\"", "Synthesize and play text via /tts/say."],
      ["listen", "Record from mic, send to /voice/turn, play the reply."],
      ["providers | list", "List configured TTS / STT providers."],
    ],
    options: [
      ["--provider <id>", "Override configured provider for this call."],
      ["--voice <name>", "Override voice id (say only)."],
      ["--seconds N", "Record for N seconds (listen). 0 = stop on silence."],
      ["--no-play", "Do not play audio after synthesis / reply."],
    ],
    examples: [
      "apx voice say \"hola, ¿cómo estás?\"",
      "apx voice listen --seconds 5",
      "apx voice providers",
    ],
  }),
  "voice say": topic({
    title: "apx voice say",
    summary: "Synthesize text through the daemon TTS pipeline (/tts/say) and (by default) play it.",
    usage: ["apx voice say \"<text>\" [--provider <id>] [--voice <name>] [--no-play]"],
    options: [
      ["--provider <id>", "Override configured TTS provider."],
      ["--voice <name>", "Override voice id."],
      ["--no-play", "Synthesize but do not play the audio file."],
    ],
    examples: [
      "apx voice say \"hola\"",
      "apx voice say \"prueba\" --provider piper --voice es_AR",
      "apx voice say \"silenciado\" --no-play",
    ],
  }),
  "voice listen": topic({
    title: "apx voice listen",
    summary: "Record from the local mic, send to /voice/turn (STT + super-agent + TTS), and play the reply.",
    usage: ["apx voice listen [--seconds N] [--provider <id>] [--no-play]"],
    options: [
      ["--seconds N", "Record N seconds. 0 (default) = stop on silence."],
      ["--provider <id>", "Override STT provider."],
      ["--no-play", "Do not play the reply audio."],
    ],
    examples: ["apx voice listen", "apx voice listen --seconds 5"],
  }),
  "voice providers": topic({
    title: "apx voice providers",
    summary: "List configured TTS / STT providers known to the daemon.",
    usage: ["apx voice providers", "apx voice list"],
    examples: ["apx voice providers"],
  }),

  // ── Unified daemon log ────────────────────────────────────────────────────
  log: topic({
    title: "apx log",
    summary: "Read the unified daemon log (~/.apx/logs/apx.log). Covers every module: telegram, whisper, super-agent, tools, desktop.",
    usage: ["apx log [--tail N] [-f|--follow] [--errors]"],
    options: [
      ["--tail N", "Print the last N lines (default 100)."],
      ["-f, --follow", "Keep tailing as new lines are appended."],
      ["--errors", "Show only [ERROR] lines (also includes structured errors.jsonl)."],
    ],
    examples: ["apx log", "apx log --tail 50", "apx log -f", "apx log --errors --tail 20"],
  }),
  logs: topic({
    title: "apx logs",
    summary: "Alias for apx log.",
    usage: ["apx logs [--tail N] [-f|--follow] [--errors]"],
    examples: ["apx logs --tail 50"],
  }),

  // ── Model router ──────────────────────────────────────────────────────────
  model: topic({
    title: "apx model",
    summary: "Inspect or edit the super-agent model fallback router (~/.apx/config.json super_agent.model_fallback).",
    usage: ["apx model <subcommand> [args]"],
    commands: [
      ["status | show", "Print fallback order, configured keys, per-provider probe results, and active model."],
      ["order <p1> <p2> …", "Set the fallback order (e.g. ollama openrouter groq)."],
      ["key <provider> <api-key>", "Save an API key under engines.<provider>.api_key."],
      ["set <provider> <model-id>", "Pin a specific model id for one provider in the fallback map."],
      ["test", "Resolve which model the router would pick right now."],
      ["enable", "Enable the fallback router."],
      ["disable", "Disable the fallback router (primary only)."],
    ],
    examples: [
      "apx model status",
      "apx model order ollama openrouter groq",
      "apx model key groq sk-xxxx",
      "apx model set openrouter openrouter/anthropic/claude-3.7-sonnet",
      "apx model test",
    ],
  }),
  "model status": topic({
    title: "apx model status",
    summary: "Show provider health + active model picked by the fallback router.",
    usage: ["apx model status", "apx model show"],
    examples: ["apx model status"],
  }),
  "model order": topic({
    title: "apx model order",
    summary: "Set the fallback order across providers.",
    usage: ["apx model order <p1> <p2> …"],
    examples: ["apx model order ollama openrouter groq"],
  }),
  "model key": topic({
    title: "apx model key",
    summary: "Save an API key for one provider in ~/.apx/config.json (engines.<provider>.api_key).",
    usage: ["apx model key <groq|openrouter|openai|…> <api-key>"],
    examples: ["apx model key groq sk-xxxx"],
  }),
  "model set": topic({
    title: "apx model set",
    summary: "Pin a specific model id for one provider in the fallback map.",
    usage: ["apx model set <provider> <provider:model-id>"],
    examples: ["apx model set openrouter openrouter/anthropic/claude-3.7-sonnet"],
  }),
  "model test": topic({
    title: "apx model test",
    summary: "Resolve which model the router would pick right now.",
    usage: ["apx model test"],
    examples: ["apx model test"],
  }),
  "model enable": topic({
    title: "apx model enable",
    summary: "Enable the fallback router.",
    usage: ["apx model enable"],
    examples: ["apx model enable"],
  }),
  "model disable": topic({
    title: "apx model disable",
    summary: "Disable the fallback router (primary model only).",
    usage: ["apx model disable"],
    examples: ["apx model disable"],
  }),

  "daemon reload": topic({
    title: "apx daemon reload",
    summary: "Reload ~/.apx/config.json into the daemon without restarting.",
    usage: ["apx daemon reload"],
    examples: ["apx daemon reload"],
  }),
}));

const HELP_ALIASES = new Map(Object.entries({
  "project ls": "project list",
  "project rm": "project remove",
  "agent ls": "agent list",
  "agent show": "agent get",
  "agent vault ls": "agent vault list",
  "session ls": "session list",
  "session show": "session get",
  "session search": "session find",
  "sessions ls": "sessions list",
  "mcp ls": "mcp list",
  "mcp rm": "mcp remove",
  "conv list": "conversations list",
  "conv ls": "conversations list",
  "conv get": "conversations get",
  "conv show": "conversations get",
  "env list": "env detect",
  "routines list": "routine list",
  "routines ls": "routine list",
  "routines add": "routine add",
  "routines new": "routine add",
  "routine new": "routine add",
  "routines get": "routine get",
  "routines show": "routine get",
  "routine show": "routine get",
  "routines history": "routine history",
  "routines hist": "routine history",
  "routine hist": "routine history",
  "routines run": "routine run",
  "routines enable": "routine enable",
  "routines disable": "routine disable",
  "routines remove": "routine remove",
  "routines rm": "routine remove",
  "routine rm": "routine remove",
  "commands list": "command list",
  "commands ls": "command list",
  "command ls": "command list",
  "commands show": "command show",
  "commands get": "command show",
  "command get": "command show",
  "skills ls": "skills list",
  "plugin list": "plugins list",
  "plugin ls": "plugins list",
  "plugin status": "plugins status",
  "telegram channels": "telegram channel",
  "telegram channels list": "telegram channel list",
  "telegram channels ls": "telegram channel list",
  "telegram channels add": "telegram channel add",
  "telegram channels show": "telegram channel show",
  "telegram channels set": "telegram channel set",
  "telegram channels unset": "telegram channel unset",
  "telegram channels remove": "telegram channel remove",
  "telegram channels rm": "telegram channel remove",
  "telegram channel ls": "telegram channel list",
  "telegram channel get": "telegram channel show",
  "telegram channel rm": "telegram channel remove",
  "project config get": "project config show",
  "project config rm": "project config unset",

  // tasks (alias of task)
  "tasks list": "task list",
  "tasks ls": "task list",
  "task ls": "task list",
  "tasks add": "task add",
  "tasks new": "task add",
  "tasks create": "task add",
  "task new": "task add",
  "task create": "task add",
  "tasks show": "task show",
  "tasks get": "task show",
  "task get": "task show",
  "tasks done": "task done",
  "tasks complete": "task done",
  "task complete": "task done",
  "tasks drop": "task drop",
  "tasks archive": "task drop",
  "task archive": "task drop",
  "tasks reopen": "task reopen",
  "tasks patch": "task patch",
  "tasks edit": "task patch",
  "task edit": "task patch",

  // pair
  "pair device": "pair new",
  "pair ls": "pair list",
  "pair rm": "pair revoke",

  // voice
  "voice list": "voice providers",

  // model
  "model show": "model status",
  "model set-order": "model order",
  "model set-key": "model key",
}));

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

    hSec("Projects"),
    hCmd("apx project add [path]",     36, "register a project with the daemon"),
    hCmd("apx project list",           36, ""),
    hCmd("apx project remove <id>",    36, ""),
    hCmd("apx project rebuild [id]",   36, "rebuild project index from filesystem"),

    hSec("Agents"),
    hCmd("apx agent add <slug>",       36, "--role R  --model M  --skills a,b  --language es-AR  --description D"),
    hCmd("apx agent list",             36, ""),
    hCmd("apx agent get <slug>",       36, ""),
    hCmd("apx agent import",           36, ""),
    hCmd("apx agent vault list",       36, ""),
    hCmd("apx agent vault add",        36, ""),

    hSec("APX Profile"),
    hCmd("apx identity show",          36, "print current APX identity (name, owner, personality)"),
    hCmd("apx identity set <k> <v>",   36, "set identity field"),
    hCmd("apx identity wizard",        36, "interactive identity setup"),

    hSec("Config"),
    hCmd("apx config show",            36, "--effective  --only-overrides"),
    hCmd("apx config set|unset",       36, "<key> [value]  edit .apc/config.json  (JSON-aware)"),
    hCmd("apx model status",           36, "provider health + active model (fallback router)"),
    hCmd("apx model order",            36, "<p1> <p2> …  fallback order  e.g. ollama openrouter groq"),
    hCmd("apx model key",              36, "<groq|openrouter> <api-key>  → ~/.apx/config.json"),
    hCmd("apx model test",             36, "resolve which model the router picks now"),
    hCmd("apx permission show",        36, "show APX tool permission mode"),
    hCmd("apx permission set <mode>",  36, "mode: total | automatico | permiso"),

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
    hCmd("apx session find <text>",    36, "find sessions by title (cross-engine)  --deep  --engine X"),
    hCmd("apx session summary <id>",   36, "LLM summary of any session by id"),
    hCmd("apx session ask <id> \"<q>\"", 36, "ask about a session  --max-chunks N"),
    hCmd("apx sessions list",          36, "list AI engine sessions  --engine claude|codex|apx  --project P | --dir D"),

    hSec("MCPs"),
    hCmd("apx mcp list",               36, ""),
    hCmd("apx mcp add <name>",         36, "--command <cmd> [args]  --env KEY=VAL"),
    hCmd("apx mcp remove <name>",      36, ""),
    hCmd("apx mcp enable/disable",     36, "<name>"),
    hCmd("apx mcp run <name> <tool>",  36, "[<json-args>]  call a tool through the daemon"),
    hCmd("apx mcp tools <name>",       36, "list available tools"),
    hCmd("apx mcp check",              36, "audit multi-source merge"),

    hSec("Daemon Service"),
    hCmd("apx daemon start",           36, ""),
    hCmd("apx daemon reload",          36, "reload ~/.apx/config.json without restart"),
    hCmd("apx daemon stop",            36, ""),
    hCmd("apx daemon status",          36, ""),
    hCmd("apx daemon logs",            36, "--tail N  legacy daemon stdout log"),
    hCmd("apx log",                    36, "unified log (all modules)  -f follow  --tail N  --errors only"),

    hSec("Telegram"),
    hCmd("apx telegram send \"text\"", 36, "--chat <id>"),
    hCmd("apx telegram status",        36, ""),
    hCmd("apx telegram setup",         36, ""),

    hSec("Messages"),
    hCmd("apx messages tail",          36, "--agent <slug>  --channel <ch>  -n 50  --global"),
    hCmd("apx messages chat",          36, "--channel telegram  -n 50"),
    hCmd("apx messages search \"q\"",  36, ""),

    hSec("LLM / Code"),
    hCmd("apx code",                   36, "APX terminal coding assistant"),
    hCmd("apx exec \"prompt\"",         36, "super-agent (default)  --model <id>  -a <agent> for APC slug"),
    hCmd("apx chat <agent>",           36, "interactive agent REPL  --conversation <id>"),
    hCmd("apx search \"query\"",       36, "web search (ddg | brave | browser)  --mode <m>  -n N"),
    hCmd("apx conversations list",     36, "stored exec/chat conversations for <agent>"),
    hCmd("apx conversations get",      36, "<agent> <id>"),

    hSec("Runtimes"),
    hCmd("apx run <agent>",            36, "--runtime <id> \"prompt\"  --timeout <s>"),
    `                                        ${H.DI}runtimes: claude-code | codex | opencode | aider | cursor-agent | gemini-cli | qwen-code${H.R}`,
    hCmd("apx env detect",             36, "which agent CLIs are installed"),

    hSec("Agent-to-Agent"),
    hCmd("apx send <from> <to> \"msg\"",36, "--deliver  log A2A message; --deliver runs target engine"),
    hCmd("apx connections <agent>",    36, "mental map: who/how/when this agent talked"),

    hSec("Routines & Pipeline"),
    hCmd("apx routine list",           36, "list routines + next/last run"),
    hCmd("apx routine add <name>",     36, "--kind K  --schedule S  [--spec '{...}']"),
    `    ${H.DI}kinds: heartbeat | exec_agent | super_agent | telegram | shell${H.R}`,
    `    ${H.DI}flags: --permission-mode total|automatico|permiso  --allowed-tools a,b${H.R}`,
    `    ${H.DI}pipeline: --pre-commands 'cmd1,cmd2'  --post-commands 'cmd'${H.R}`,
    `    ${H.DI}         --skip-prompt-on signal|pre_failure|pre_success|always|never${H.R}`,
    `    ${H.DI}schedule: every:60s | every:5m | every:1h | once:<iso>${H.R}`,
    hCmd("apx routine get <name>",     36, ""),
    hCmd("apx routine history <name>", 36, "show routine execution history"),
    hCmd("apx routine run <name>",     36, "manual trigger (ignores schedule)"),
    hCmd("apx routine enable <name>",  36, ""),
    hCmd("apx routine disable <name>", 36, ""),
    hCmd("apx routine remove <name>",  36, ""),

    hSec("Tasks"),
    hCmd("apx task add \"<title>\"",   36, "--tag t  --due 2026-06-01  --agent A  --body \"...\""),
    hCmd("apx task list",              36, "--state open|done|dropped|all  --tag X  --agent Y  --limit N"),
    hCmd("apx task show <id>",         36, "print one task as JSON"),
    hCmd("apx task done <id>",         36, "--by <name>  mark task done"),
    hCmd("apx task drop <id>",         36, "drop / archive a task"),
    hCmd("apx task reopen <id>",       36, "reopen a done/dropped task"),
    hCmd("apx task patch <id>",        36, "--title T  --body B  --due D  --agent A  --tag t"),

    hSec("Artifacts"),
    hCmd("apx artifact create <name>", 36, "create managed file in project storage  [--content '...'] [--project 0]"),
    hCmd("apx artifact list",          36, "list artifacts"),
    hCmd("apx artifact show <name>",   36, "print artifact content"),
    hCmd("apx artifact remove <name>", 36, ""),

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

    hSec("Voice & Overlay"),
    hCmd("apx voice say \"text\"",     36, "TTS via daemon  --provider <id>  --voice <name>  --no-play"),
    hCmd("apx voice listen",           36, "mic → /voice/turn → reply  --seconds N  --no-play"),
    hCmd("apx voice providers",        36, "list configured TTS / STT providers"),
    hCmd("apx desktop start",          36, "launch floating voice desktop window (Electron)"),
    hCmd("apx desktop stop",           36, ""),
    hCmd("apx desktop status",         36, "show desktop process + autostart state"),
    hCmd("apx desktop install",        36, "auto-launch the window at login (mac/win/linux)"),
    hCmd("apx desktop uninstall",      36, "remove the auto-launch entry"),

    hSec("Pair (companion devices)"),
    hCmd("apx pair [label]",           36, "QR pairing for Deck app / companion clients"),
    hCmd("apx pair web",               36, "QR + link to pair a browser on the LAN"),
    hCmd("apx pair list",              36, "list paired clients"),
    hCmd("apx pair revoke <id>",       36, "revoke a paired client token"),

    hSec("Flags"),
    hFlag("--project <name|id|path>",  36, "pin commands to a specific project"),
    hFlag("--help",                    36, "show this help"),
    hFlag("--version",                 36, "print version"),
    "",
  ].join("\n") + "\n";
}

function buildTopicHelp(t) {
  const lines = [
    "",
    `  ${H.B}${H.WH}${t.title}${H.R}`,
    `  ${H.DI}${t.summary}${H.R}`,
    "",
  ];
  if (t.usage.length) {
    lines.push(hSec("Usage"));
    for (const u of t.usage) lines.push(`    ${H.WH}${u}${H.R}`);
  }
  if (t.commands.length) {
    lines.push(hSec("Commands"));
    for (const [name, desc] of t.commands) lines.push(hSub(name, 28, desc));
  }
  if (t.options.length) {
    lines.push(hSec("Options"));
    for (const [flag, desc] of t.options) lines.push(hFlag(flag, 28, desc));
  }
  if (t.examples.length) {
    lines.push(hSec("Examples"));
    for (const ex of t.examples) lines.push(`    ${H.WH}${ex}${H.R}`);
  }
  if (t.notes?.length) {
    lines.push(hSec("Notes"));
    for (const n of t.notes) lines.push(`    ${H.DI}${n}${H.R}`);
  }
  lines.push(
    hSec("Global Flags"),
    hFlag("--help", 28, "show this help"),
    hFlag("--version", 28, "print version"),
    "",
  );
  return lines.join("\n") + "\n";
}

function normalizeHelpKey(key) {
  return HELP_ALIASES.get(key) || key;
}

function findHelpTopic(argv) {
  const hasHelpFlag = argv.some((a) => a === "--help" || a === "-h");
  const hasHelpCommand = argv[0] === "help" || argv[1] === "help";
  const wantsHelp = hasHelpFlag || hasHelpCommand;
  if (!wantsHelp) return null;

  const withoutFlags = argv.filter((a) => a !== "--help" && a !== "-h");
  const tokens = withoutFlags[0] === "help"
    ? withoutFlags.slice(1)
    : withoutFlags[1] === "help"
      ? [withoutFlags[0], ...withoutFlags.slice(2)]
      : withoutFlags;
  if (tokens.length === 0) return { global: true };

  const projectSubcommands = new Set(["add", "list", "ls", "remove", "rm", "rebuild", "config"]);
  if (tokens[0] === "project" && tokens.length >= 3 && !projectSubcommands.has(tokens[1])) {
    for (let n = tokens.length - 2; n > 0; n--) {
      const key = normalizeHelpKey(tokens.slice(2, 2 + n).join(" "));
      if (HELP_TOPICS.has(key)) return { topic: HELP_TOPICS.get(key) };
    }
  }

  for (let n = tokens.length; n > 0; n--) {
    const key = normalizeHelpKey(tokens.slice(0, n).join(" "));
    if (HELP_TOPICS.has(key)) return { topic: HELP_TOPICS.get(key) };
  }

  return { global: true };
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
    } else if (a === "-a") {
      args.flags.agent = argv[++i];
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
        else if (sub === "check") await cmdMcpCheck(a);
        else die(`unknown mcp subcommand: ${sub || "(none)"}`);
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

      case "command":
      case "commands": {
        const sub = rest[0];
        const a = parseArgs(rest.slice(1));
        if (!sub || sub === "list" || sub === "ls") await cmdCommandList(a);
        else if (sub === "show" || sub === "get") await cmdCommandShow(a);
        else die(`unknown command subcommand: ${sub}`);
        break;
      }

      case "skills": {
        const sub = rest[0];
        const a = parseArgs(rest.slice(1));
        if (!sub || sub === "add") await cmdSkillsAdd(a);
        else if (sub === "list" || sub === "ls") await cmdSkillsList(a);
        else if (sub === "status") await cmdSkillsStatus();
        else if (sub === "sync" || sub === "refresh") await cmdSkillsSync(a);
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

      case "overlay":
        console.error("  apx overlay has been renamed to apx desktop — forwarding.");
        /* falls through */
      case "desktop": {
        const [sub, ...oRest] = rest;
        const oArgs = parseArgs(oRest);
        if (!sub || sub === "start")  { await cmdDesktopStart(oArgs); return; }
        if (sub === "stop")           { await cmdDesktopStop(oArgs);  return; }
        if (sub === "status")         { await cmdDesktopStatus(oArgs);return; }
        if (sub === "install")        { await cmdDesktopInstall(oArgs);  return; }
        if (sub === "uninstall")      { await cmdDesktopUninstall(oArgs);return; }
        die(`unknown desktop sub-command: ${sub}\nUsage: apx desktop <start|stop|status|install|uninstall>`);
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
(async () => {
  try {
    await dispatch(topCmd, topRest);
    checkForUpdate(VERSION);
  } catch (err) {
    die(err && err.message ? err.message : String(err));
  }
})();
