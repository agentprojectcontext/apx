// Project-agent tool allowlist.
//
// Super-agent = the full registry. A project agent (Magui, Scout, …) is a
// specialist: its `.apc/agents/<slug>.md` `tools:` field is the allowlist, not
// a hint. The picker stores HTTP-catalog names (`glob`, `memory_get`,
// `agent_list`); the loop speaks native + bridged names (`search_files` is
// native, `glob` is bridged, `read_self_memory` is native). This module is the
// one map between those vocabularies.
import { listCallableToolNames } from "#core/agent/tools/registry.js";
import { TOOLS } from "#core/agent/tools/names.js";

export const AGENT_TOOL_ALIASES = Object.freeze({
  memory_get: TOOLS.READ_SELF_MEMORY,
  memory_set: TOOLS.REMEMBER,
  memory_append: TOOLS.REMEMBER,
  memory_list: TOOLS.READ_SELF_MEMORY,
  agent_list: TOOLS.LIST_AGENTS,
  agent_get: TOOLS.LIST_AGENTS,
  project_info: TOOLS.LIST_PROJECTS,
  run_command: TOOLS.RUN_SHELL,
  mcp_list: TOOLS.LIST_MCPS,
  mcp_run: TOOLS.CALL_MCP,
  session_list: TOOLS.SEARCH_SESSIONS,
  session_search: TOOLS.SEARCH_SESSIONS,
  session_get: TOOLS.SEARCH_SESSIONS,
});

export function declaredAgentTools(agent) {
  const raw = agent?.fields?.Tools ?? agent?.tools ?? [];
  if (Array.isArray(raw)) return raw.map((s) => String(s).trim()).filter(Boolean);
  if (typeof raw === "string") return raw.split(",").map((s) => s.trim()).filter(Boolean);
  return [];
}

// What an agent with no declared `tools:` may NOT call. Everything else it can.
//
// The default used to be a narrow read/search/memory set, and the result was
// agents that could not do their job: a social producer that could not reach the
// MCP holding its publishing tools, a routine that could not file the task it
// had just written. Every one of those was diagnosed as a bug, one card at a
// time, long after the run that needed it had already failed.
//
// So capability is the default and removal is the deliberate act: declare
// `tools:` on the card when an agent should be narrower than the registry. What
// stays out is only what belongs to the super-agent as the host, not work an
// agent might reasonably need.
//
// This is an ALLOWLIST gate, not a prompt budget — lightweight channels still
// send the small base set and expand through discover_tools, so a broad default
// costs nothing on a chat turn. It only stops the runtime from refusing.
const HOST_ONLY_TOOLS = Object.freeze([
  // The super-agent's own persona and privilege level. An agent rewriting who
  // APX is, or widening its own permissions, is never the task.
  TOOLS.SET_IDENTITY,
  TOOLS.SET_PERMISSION_MODE,
  // Registry surgery: adding projects / importing agents reshapes the install
  // the agent is running inside.
  TOOLS.ADD_PROJECT,
  TOOLS.IMPORT_AGENT,
]);

/** Everything a project agent may call by default: the registry minus the host's own. */
export function defaultAgentToolNames() {
  const deny = new Set(HOST_ONLY_TOOLS);
  return listCallableToolNames().filter((n) => !deny.has(n));
}

/**
 * Names this agent may call this turn.
 *
 * - `override` set (routine.allowed_tools) wins, including `[]` = no tools.
 * - else the agent's declared `tools:` field, when it declares one.
 * - no declaration → the broad default (see defaultAgentToolNames).
 * Unknown names are dropped, catalog aliases are rewritten, duplicates collapse.
 *
 * @returns {string[]}
 */
export function resolveAgentAllowedTools(agent, { override } = {}) {
  if (Array.isArray(override)) return resolveNames(override);
  const declared = declaredAgentTools(agent);
  if (!declared.length) return defaultAgentToolNames();
  const resolved = resolveNames(declared);
  // A card whose every name is stale would otherwise mean a silent no-tools
  // turn that dumps markup as the "answer". Capability beats a broken card.
  return resolved.length ? resolved : defaultAgentToolNames();
}

function resolveNames(names) {
  const known = new Set(listCallableToolNames());
  const out = [];
  const seen = new Set();
  for (const raw of names) {
    const name = String(raw || "").trim();
    if (!name) continue;
    const candidate = known.has(name) ? name : (AGENT_TOOL_ALIASES[name] || name);
    if (!known.has(candidate) || seen.has(candidate)) continue;
    seen.add(candidate);
    out.push(candidate);
  }
  return out;
}
