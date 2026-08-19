// Project-agent tool allowlist.
//
// Super-agent = the full registry. A project agent (Magui, Scout, …) is a
// specialist: its `.apc/agents/<slug>.md` `tools:` field is the allowlist, not
// a hint. The picker stores HTTP-catalog names (`glob`, `memory_get`,
// `agent_list`); the loop speaks native + bridged names (`search_files` is
// native, `glob` is bridged, `read_self_memory` is native). This module is the
// one map between those vocabularies.
import { DEFAULT_AGENT_TOOLS } from "#core/http-tools/catalog.js";
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

/**
 * Names this agent may call this turn.
 *
 * - `override` set (routine.allowed_tools) wins, including `[]` = no tools.
 * - else the agent's declared `tools:` field.
 * - empty declaration falls back to DEFAULT_AGENT_TOOLS (safe read/search/memory).
 * Unknown names are dropped, catalog aliases are rewritten, duplicates collapse.
 *
 * @returns {string[]}
 */
export function resolveAgentAllowedTools(agent, { override } = {}) {
  if (Array.isArray(override)) return resolveNames(override);
  const declared = declaredAgentTools(agent);
  const source = declared.length ? declared : [...DEFAULT_AGENT_TOOLS];
  const resolved = resolveNames(source);
  if (resolved.length) return resolved;
  // Declared names that none map (stale card) — still give the safe default
  // rather than a silent no-tools turn that dumps markup as the "answer".
  return resolveNames([...DEFAULT_AGENT_TOOLS]);
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
