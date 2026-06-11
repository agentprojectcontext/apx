import listProjects from "./handlers/list-projects.js";
import listAgents from "./handlers/list-agents.js";
import listVaultAgents from "./handlers/list-vault-agents.js";
import importAgent from "./handlers/import-agent.js";
import addProject from "./handlers/add-project.js";
import listMcps from "./handlers/list-mcps.js";
import readAgentMemory from "./handlers/read-agent-memory.js";
import remember from "./handlers/remember.js";
import readSelfMemory from "./handlers/read-self-memory.js";
import listFiles from "./handlers/list-files.js";
import readFile from "./handlers/read-file.js";
import writeFile from "./handlers/write-file.js";
import editFile from "./handlers/edit-file.js";
import runShell from "./handlers/run-shell.js";
import tailMessages from "./handlers/tail-messages.js";
import searchMessages from "./handlers/search-messages.js";
import searchSessions from "./handlers/search-sessions.js";
import callAgent from "./handlers/call-agent.js";
import callMcp from "./handlers/call-mcp.js";
import callRuntime from "./handlers/call-runtime.js";
import sendTelegram from "./handlers/send-telegram.js";
import setIdentity from "./handlers/set-identity.js";
import setPermissionMode from "./handlers/set-permission-mode.js";
import searchFiles from "./handlers/search-files.js";
import listSkills from "./handlers/list-skills.js";
import loadSkill from "./handlers/load-skill.js";
import transcribeAudio from "./handlers/transcribe-audio.js";
import askQuestions from "./handlers/ask-questions.js";
import createTask from "./handlers/create-task.js";
import listTasks from "./handlers/list-tasks.js";
import discoverTools from "./handlers/discover-tools.js";
import { createPermissionGuard } from "./helpers.js";
import { buildBridgedTools, DEFAULT_CATEGORIES } from "./registry-bridge.js";
import { TOOLS } from "./names.js";
import { CHANNELS } from "#core/constants/channels.js";

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
  discoverTools,
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
const ALL_TOOLS = [...NATIVE_TOOLS, ...BRIDGED_TOOLS];

export const TOOL_SCHEMAS = ALL_TOOLS.map((tool) => tool.schema);

// ---------------------------------------------------------------------------
// Lazy tools: base set (always loaded) + on-demand set (revealed via
// discover_tools). Motivation: full TOOL_SCHEMAS is ~25 KB / ~6.3 K tokens —
// too much when Groq's free tier caps you at 6-12 K TPM. The base set is
// ~24 tools (the ones a Telegram chat actually reaches for); everything else
// (browser/Puppeteer, fetch, web_search, runtime delegation, voice, …) stays
// off the wire until the model asks for it with discover_tools().
// ---------------------------------------------------------------------------

// Always loaded on lightweight channels. Covers messages, files, memory,
// sessions, projects/inventory, basic shell, tasks, skills, and discovery.
export const BASE_TOOL_NAMES = new Set([
  // Discovery — the entry point to everything not loaded here.
  TOOLS.DISCOVER_TOOLS,
  // Inventory — the model needs these to know what exists.
  TOOLS.LIST_PROJECTS,
  TOOLS.LIST_AGENTS,
  TOOLS.LIST_MCPS,
  TOOLS.LIST_SKILLS,
  TOOLS.LOAD_SKILL,
  // Memory + identity.
  TOOLS.READ_AGENT_MEMORY,
  TOOLS.READ_SELF_MEMORY,
  TOOLS.REMEMBER,
  TOOLS.SET_IDENTITY,
  // Sessions + messages (self-recall + channel history).
  TOOLS.SEARCH_SESSIONS,
  TOOLS.SEARCH_MESSAGES,
  TOOLS.TAIL_MESSAGES,
  // Channels + conversation control + lightweight delegation.
  TOOLS.SEND_TELEGRAM,
  TOOLS.ASK_QUESTIONS,
  TOOLS.CALL_AGENT,
  // Tasks (very common ask via chat).
  TOOLS.CREATE_TASK,
  TOOLS.LIST_TASKS,
  // Files + basic shell — frequent enough on chat to keep hot.
  TOOLS.READ_FILE,
  TOOLS.WRITE_FILE,
  TOOLS.EDIT_FILE,
  TOOLS.LIST_FILES,
  TOOLS.SEARCH_FILES,
  TOOLS.RUN_SHELL,
]);

// Channels that get the FULL registry up front (deliberate, user-picked model,
// no cheap-tier TPM cap). Everything else is a "lightweight" channel and starts
// on BASE_TOOL_NAMES with discover_tools to expand.
const FULL_CHANNELS = new Set([
  CHANNELS.ROUTINE,
  CHANNELS.API,
  CHANNELS.WEB,
  CHANNELS.CODE,
]);

// Category labels for grouping the discover_tools catalog. Native tools have no
// registry category, so we assign one here; bridged tools carry their own
// (browser/fetch/search/file) from registry-bridge.js.
const NATIVE_CATEGORY = {
  [TOOLS.DISCOVER_TOOLS]:      "system",
  [TOOLS.SET_PERMISSION_MODE]: "system",
  [TOOLS.LIST_PROJECTS]:       "inventory",
  [TOOLS.LIST_AGENTS]:         "inventory",
  [TOOLS.LIST_VAULT_AGENTS]:   "inventory",
  [TOOLS.LIST_MCPS]:           "inventory",
  [TOOLS.LIST_SKILLS]:         "inventory",
  [TOOLS.LOAD_SKILL]:          "skills",
  [TOOLS.IMPORT_AGENT]:        "agents",
  [TOOLS.ADD_PROJECT]:         "projects",
  [TOOLS.CALL_AGENT]:          "agents",
  [TOOLS.CALL_RUNTIME]:        "runtime",
  [TOOLS.CALL_MCP]:            "mcp",
  [TOOLS.READ_AGENT_MEMORY]:   "memory",
  [TOOLS.READ_SELF_MEMORY]:    "memory",
  [TOOLS.REMEMBER]:            "memory",
  [TOOLS.SET_IDENTITY]:        "identity",
  [TOOLS.SEARCH_SESSIONS]:     "sessions",
  [TOOLS.SEARCH_MESSAGES]:     "messages",
  [TOOLS.TAIL_MESSAGES]:       "messages",
  [TOOLS.SEND_TELEGRAM]:       "messages",
  [TOOLS.ASK_QUESTIONS]:       "conversation",
  [TOOLS.CREATE_TASK]:         "tasks",
  [TOOLS.LIST_TASKS]:          "tasks",
  [TOOLS.TRANSCRIBE_AUDIO]:    "voice",
  [TOOLS.READ_FILE]:           "files",
  [TOOLS.WRITE_FILE]:          "files",
  [TOOLS.EDIT_FILE]:           "files",
  [TOOLS.LIST_FILES]:          "files",
  [TOOLS.SEARCH_FILES]:        "files",
  [TOOLS.RUN_SHELL]:           "shell",
};

function categoryOf(tool) {
  return tool.category || NATIVE_CATEGORY[tool.name] || "other";
}

function oneLine(desc = "") {
  const flat = String(desc).replace(/\s+/g, " ").trim();
  if (flat.length <= 120) return flat;
  return flat.slice(0, 117).trimEnd() + "…";
}

// Static metadata index for every tool — name, schema, category, short blurb.
// Used by the per-turn tool session for the catalog and activation lookups.
const TOOL_META = ALL_TOOLS.map((t) => ({
  name: t.name,
  schema: t.schema,
  category: categoryOf(t),
  description: oneLine(t.schema?.function?.description),
}));
const META_BY_NAME = new Map(TOOL_META.map((m) => [m.name, m]));

export const BASE_TOOL_SCHEMAS = ALL_TOOLS
  .filter((t) => BASE_TOOL_NAMES.has(t.name))
  .map((t) => t.schema);

const schemaName = (s) => s?.function?.name || s?.name;

/**
 * Choose the INITIAL tool schema list for a channel. Full channels get the
 * whole registry; lightweight channels (telegram/desktop/deck/web_sidebar) get
 * the base set and expand on demand via discover_tools. `full: true` forces the
 * complete registry regardless of channel.
 */
export function schemasForChannel(channel, { full = false } = {}) {
  if (full || FULL_CHANNELS.has(channel)) return TOOL_SCHEMAS;
  return BASE_TOOL_SCHEMAS;
}

/**
 * Per-turn tool session: tracks which tools are live, exposes the catalog of
 * not-yet-loaded tools, and activates more on demand. The agent loop reads
 * `pending` after each iteration and merges the new schemas into the live set,
 * so activated tools become callable on the model's next step.
 *
 * `allowedTools` mirrors the role gate: "*" = unrestricted, [] = nothing, an
 * array = allowlist. Both the initial set AND any activation respect it, so a
 * limited sender can't discover its way past the gate.
 */
export function createToolSession(channel, { full = false, allowedTools = "*" } = {}) {
  const allowAll = allowedTools === "*";
  const allow = allowAll || !Array.isArray(allowedTools) ? null : new Set(allowedTools);
  const permits = (name) => allowAll || (allow ? allow.has(name) : false);

  // If the role gate is "[]" (no tools), start empty and stay empty.
  const gateEmpty = Array.isArray(allowedTools) && allowedTools.length === 0;

  const initial = (gateEmpty ? [] : schemasForChannel(channel, { full }))
    .filter((s) => permits(schemaName(s)));
  const activeNames = new Set(initial.map(schemaName));

  const session = {
    channel,
    initialSchemas: initial,
    pending: [],
    activeNames,

    // Tools that exist but aren't loaded yet (and are permitted by the gate).
    notLoaded() {
      return TOOL_META.filter((m) => !activeNames.has(m.name) && permits(m.name));
    },

    // Catalog response for discover_tools() with no args: grouped by category.
    catalogResponse() {
      const pool = session.notLoaded();
      const byCategory = {};
      for (const m of pool) {
        (byCategory[m.category] ||= []).push({ name: m.name, description: m.description });
      }
      return {
        ok: true,
        loaded_count: activeNames.size,
        available_count: pool.length,
        categories: byCategory,
        hint:
          "Activá lo que necesites con discover_tools({ category: \"<cat>\" }) o " +
          "discover_tools({ names: [\"tool_a\", \"tool_b\"] }). Quedan disponibles desde tu próximo paso.",
      };
    },

    // Activate by exact names and/or whole category. Pushes new schemas to
    // `pending` for the agent loop to merge.
    activate({ names, category } = {}) {
      const targets = new Set();
      if (Array.isArray(names)) for (const n of names) targets.add(n);
      if (typeof category === "string" && category.trim()) {
        const cat = category.trim();
        for (const m of TOOL_META) if (m.category === cat) targets.add(m.name);
      }

      const activated = [];
      const alreadyLoaded = [];
      const unknown = [];
      const denied = [];
      for (const name of targets) {
        const meta = META_BY_NAME.get(name);
        if (!meta) { unknown.push(name); continue; }
        if (!permits(name)) { denied.push(name); continue; }
        if (activeNames.has(name)) { alreadyLoaded.push(name); continue; }
        activeNames.add(name);
        session.pending.push(meta.schema);
        activated.push(name);
      }

      return {
        ok: activated.length > 0 || (unknown.length === 0 && denied.length === 0),
        activated,
        already_loaded: alreadyLoaded,
        ...(unknown.length ? { unknown } : {}),
        ...(denied.length ? { denied } : {}),
        note: activated.length
          ? `Activé ${activated.length} tool(s): ${activated.join(", ")}. Ya las podés usar desde tu próximo paso.`
          : "No se activó ninguna tool nueva.",
      };
    },
  };

  return session;
}

/**
 * Compact "tools you can activate" block for the system prompt: instructions +
 * just the NAMES (no schemas) of not-loaded tools, grouped by category. Returns
 * "" when nothing is pending (full channels), so it's omitted from the prompt.
 */
export function buildLazyToolsBlock(session) {
  if (!session) return "";
  const pool = session.notLoaded();
  if (pool.length === 0) return "";

  const byCategory = {};
  for (const m of pool) (byCategory[m.category] ||= []).push(m.name);
  const lines = Object.keys(byCategory)
    .sort()
    .map((cat) => `- ${cat}: ${byCategory[cat].join(", ")}`);

  return [
    "# Tools adicionales (activación on-demand)",
    "Tenés las tools base siempre cargadas. Estas otras EXISTEN pero no están",
    "cargadas (para ahorrar tokens). Activalas cuando las necesites con",
    "discover_tools — quedan disponibles desde tu próximo paso:",
    '  • discover_tools()                              → catálogo completo (nombre + descripción)',
    '  • discover_tools({ category: "browser" })       → activa toda una categoría',
    '  • discover_tools({ names: ["browser_navigate"] })→ activa tools puntuales',
    "Si no encontrás la tool que buscás, llamá discover_tools() sin argumentos.",
    "",
    `Tools no cargadas (solo nombres, ${pool.length} en total):`,
    ...lines,
  ].join("\n");
}

export function makeToolHandlers(ctx) {
  const toolCtx = {
    ...ctx,
    requirePermission: createPermissionGuard(ctx.globalConfig || {}, {
      requestConfirmation: ctx.requestConfirmation || null,
    }),
  };
  return Object.fromEntries(ALL_TOOLS.map((tool) => [tool.name, tool.makeHandler(toolCtx)]));
}

// Diagnostic helper — useful for `apx daemon status` or debug logging.
export function listBridgedToolNames() {
  return BRIDGED_TOOLS.map(t => t.name);
}
