import listProjects from "./tools/list-projects.js";
import listAgents from "./tools/list-agents.js";
import listVaultAgents from "./tools/list-vault-agents.js";
import importAgent from "./tools/import-agent.js";
import addProject from "./tools/add-project.js";
import listMcps from "./tools/list-mcps.js";
import readAgentMemory from "./tools/read-agent-memory.js";
import listFiles from "./tools/list-files.js";
import readFile from "./tools/read-file.js";
import writeFile from "./tools/write-file.js";
import editFile from "./tools/edit-file.js";
import runShell from "./tools/run-shell.js";
import tailMessages from "./tools/tail-messages.js";
import searchMessages from "./tools/search-messages.js";
import callAgent from "./tools/call-agent.js";
import callMcp from "./tools/call-mcp.js";
import callRuntime from "./tools/call-runtime.js";
import sendTelegram from "./tools/send-telegram.js";
import setIdentity from "./tools/set-identity.js";
import setPermissionMode from "./tools/set-permission-mode.js";
import searchFiles from "./tools/search-files.js";
import listSkills from "./tools/list-skills.js";
import loadSkill from "./tools/load-skill.js";
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
  listFiles,
  readFile,
  writeFile,
  editFile,
  runShell,
  tailMessages,
  searchMessages,
  callAgent,
  callMcp,
  callRuntime,
  sendTelegram,
  setIdentity,
  setPermissionMode,
  searchFiles,
  listSkills,
  loadSkill,
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
