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
import discoverTools from "./tools/discover-tools.js";
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
const TOOLS = [...NATIVE_TOOLS, ...BRIDGED_TOOLS];

export const TOOL_SCHEMAS = TOOLS.map((tool) => tool.schema);

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
  "discover_tools",
  // Inventory — the model needs these to know what exists.
  "list_projects",
  "list_agents",
  "list_mcps",
  "list_skills",
  "load_skill",
  // Memory + identity.
  "read_agent_memory",
  "read_self_memory",
  "remember",
  "set_identity",
  // Sessions + messages (self-recall + channel history).
  "search_sessions",
  "search_messages",
  "tail_messages",
  // Channels + conversation control + lightweight delegation.
  "send_telegram",
  "ask_questions",
  "call_agent",
  // Tasks (very common ask via chat).
  "create_task",
  "list_tasks",
  // Files + basic shell — frequent enough on chat to keep hot.
  "read_file",
  "write_file",
  "edit_file",
  "list_files",
  "search_files",
  "run_shell",
]);

// Channels that get the FULL registry up front (deliberate, user-picked model,
// no cheap-tier TPM cap). Everything else is a "lightweight" channel and starts
// on BASE_TOOL_NAMES with discover_tools to expand.
const FULL_CHANNELS = new Set(["routine", "api", "web", "code", "terminal"]);

// Category labels for grouping the discover_tools catalog. Native tools have no
// registry category, so we assign one here; bridged tools carry their own
// (browser/fetch/search/file) from registry-bridge.js.
const NATIVE_CATEGORY = {
  discover_tools: "system",
  set_permission_mode: "system",
  list_projects: "inventory",
  list_agents: "inventory",
  list_vault_agents: "inventory",
  list_mcps: "inventory",
  list_skills: "inventory",
  load_skill: "skills",
  import_agent: "agents",
  add_project: "projects",
  call_agent: "agents",
  call_runtime: "runtime",
  call_mcp: "mcp",
  read_agent_memory: "memory",
  read_self_memory: "memory",
  remember: "memory",
  set_identity: "identity",
  search_sessions: "sessions",
  search_messages: "messages",
  tail_messages: "messages",
  send_telegram: "messages",
  ask_questions: "conversation",
  create_task: "tasks",
  list_tasks: "tasks",
  transcribe_audio: "voice",
  read_file: "files",
  write_file: "files",
  edit_file: "files",
  list_files: "files",
  search_files: "files",
  run_shell: "shell",
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
const TOOL_META = TOOLS.map((t) => ({
  name: t.name,
  schema: t.schema,
  category: categoryOf(t),
  description: oneLine(t.schema?.function?.description),
}));
const META_BY_NAME = new Map(TOOL_META.map((m) => [m.name, m]));

export const BASE_TOOL_SCHEMAS = TOOLS
  .filter((t) => BASE_TOOL_NAMES.has(t.name))
  .map((t) => t.schema);

// Back-compat alias: a few callers/tests historically referenced the "core"
// subset. The base set supersedes it.
export const CORE_TOOL_SCHEMAS = BASE_TOOL_SCHEMAS;

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
  return Object.fromEntries(TOOLS.map((tool) => [tool.name, tool.makeHandler(toolCtx)]));
}

// Diagnostic helper — useful for `apx daemon status` or debug logging.
export function listBridgedToolNames() {
  return BRIDGED_TOOLS.map(t => t.name);
}
