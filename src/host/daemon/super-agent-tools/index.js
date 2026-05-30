import listProjects from "./tools/list-projects.js";
import listAgents from "./tools/list-agents.js";
import listVaultAgents from "./tools/list-vault-agents.js";
import importAgent from "./tools/import-agent.js";
import addProject from "./tools/add-project.js";
import listMcps from "./tools/list-mcps.js";
import readAgentMemory from "./tools/read-agent-memory.js";
import remember from "./tools/remember.js";
import readSelfMemory from "./tools/read-self-memory.js";
import listFiles from "./tools/list-files.js";
import readFile from "./tools/read-file.js";
import writeFile from "./tools/write-file.js";
import editFile from "./tools/edit-file.js";
import runShell from "./tools/run-shell.js";
import tailMessages from "./tools/tail-messages.js";
import searchMessages from "./tools/search-messages.js";
import searchSessions from "./tools/search-sessions.js";
import callAgent from "./tools/call-agent.js";
import callMcp from "./tools/call-mcp.js";
import callRuntime from "./tools/call-runtime.js";
import sendTelegram from "./tools/send-telegram.js";
import setIdentity from "./tools/set-identity.js";
import setPermissionMode from "./tools/set-permission-mode.js";
import searchFiles from "./tools/search-files.js";
import listSkills from "./tools/list-skills.js";
import loadSkill from "./tools/load-skill.js";
import transcribeAudio from "./tools/transcribe-audio.js";
import askQuestions from "./tools/ask-questions.js";
import createTask from "./tools/create-task.js";
import listTasks from "./tools/list-tasks.js";
import { createPermissionGuard } from "./helpers.js";
import { buildBridgedTools, DEFAULT_CATEGORIES } from "./registry-bridge.js";

const NATIVE_TOOLS = [
  listProjects,
  listAgents,
  listVaultAgents,
  importAgent,
  addProject,
  listMcps,
  readAgentMemory,
  remember,
  readSelfMemory,
  listFiles,
  readFile,
  writeFile,
  editFile,
  runShell,
  tailMessages,
  searchMessages,
  searchSessions,
  callAgent,
  callMcp,
  callRuntime,
  sendTelegram,
  setIdentity,
  setPermissionMode,
  searchFiles,
  listSkills,
  loadSkill,
  transcribeAudio,
  askQuestions,
  createTask,
  listTasks,
];

// Registry-backed bridges. Categories can be overridden per-process via env
// APX_BRIDGE_CATEGORIES (comma-separated), e.g. "browser,fetch,search".
// Default: browser, fetch, search, glob, grep (see registry-bridge.js).
function resolveBridgeCategories() {
  const env = (process.env.APX_BRIDGE_CATEGORIES || "").trim();
  if (!env) return DEFAULT_CATEGORIES;
  return new Set(env.split(",").map(s => s.trim()).filter(Boolean));
}

const BRIDGED_TOOLS = buildBridgedTools({ categories: resolveBridgeCategories() });
const TOOLS = [...NATIVE_TOOLS, ...BRIDGED_TOOLS];

export const TOOL_SCHEMAS = TOOLS.map((tool) => tool.schema);

// "Core" tools always sent to the model. The rest are pulled in on-demand via
// load_skill or by switching to a heavier channel. Picked to fit cheap cloud
// tiers: full TOOL_SCHEMAS is ~22 KB / ~5.5 K tokens — too much when Groq
// free tier caps you at 6-12 K TPM. CORE_TOOL_NAMES is ~3 KB / ~700 tokens.
// See spec/done/backlog item 12 for the underlying motivation.
const CORE_TOOL_NAMES = new Set([
  // Inventory — the model NEEDS to call these to know what's there.
  "list_projects",
  "list_agents",
  "list_mcps",
  "list_skills",
  // Memory + identity — used during identity / config conversations.
  "read_agent_memory",
  "set_identity",
  // Self-memory: jot durable facts so they survive across sessions.
  "remember",
  // Self-recall: "what did we do / last session" must work on every channel.
  "search_sessions",
  // Conversation control.
  "ask_questions",
  // On-demand expansion: this is how the model loads the rest of the surface.
  "load_skill",
  // Channels the user expects out of any super-agent turn.
  "send_telegram",
  // Lightweight delegation (no spawn).
  "call_agent",
  // Routine creation (very common ask via chat).
  "create_task",
  "list_tasks",
]);

export const CORE_TOOL_SCHEMAS = TOOLS
  .filter((t) => CORE_TOOL_NAMES.has(t.name))
  .map((t) => t.schema);

/**
 * Choose the tool schema list for a given channel. Telegram / overlay / api
 * (chit-chat) get the "core" subset to stay under cheap-tier TPM limits;
 * routines get the full list because they're deliberate, scheduled, and the
 * user has chosen the model. Override with the explicit `full: true` opt.
 */
export function schemasForChannel(channel, { full = false } = {}) {
  if (full) return TOOL_SCHEMAS;
  // Routines and the local surfaces (web admin chat, `apx exec super-agent`)
  // get the full registry — they run on a model the user picked and aren't
  // subject to the cheap-tier TPM caps that motivate the "core" subset.
  if (channel === "routine") return TOOL_SCHEMAS;
  if (channel === "api") return TOOL_SCHEMAS;
  // Telegram / overlay stay on the small subset to fit cheap cloud TPM limits.
  return CORE_TOOL_SCHEMAS;
}

export function makeToolHandlers(ctx) {
  const toolCtx = {
    ...ctx,
    requirePermission: createPermissionGuard(ctx.globalConfig || {}, {
      implicitConfirmation: !!ctx.implicitConfirmation,
    }),
  };
  return Object.fromEntries(TOOLS.map((tool) => [tool.name, tool.makeHandler(toolCtx)]));
}

// Diagnostic helper — useful for `apx daemon status` or debug logging.
export function listBridgedToolNames() {
  return BRIDGED_TOOLS.map(t => t.name);
}
