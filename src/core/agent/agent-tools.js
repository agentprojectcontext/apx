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

/**
 * The floor. Granted to every agent that declares a `tools:` list, on top of
 * whatever it declared.
 *
 * Not a convenience: an agent missing these is not a narrower agent, it is a
 * broken one. It cannot find the tools it was not given (`discover_tools`),
 * cannot read its own skills or memory, cannot hand a question back to a human,
 * and cannot answer another agent over a2a. Every one of those failures reads
 * as "the model is bad at this" rather than as a card that forgot a line.
 *
 * Deliberately small: only what an agent needs to BE one. Anything that touches
 * the world — files, shell, tasks, channels — stays opt-in.
 */
export const AGENT_CORE_TOOLS = Object.freeze([
  // Find what it was not given.
  TOOLS.DISCOVER_TOOLS,
  // Hand a question back to a human instead of guessing.
  TOOLS.ASK_QUESTIONS,
  // Its own skills. read_skill is not optional next to the other two: a skill
  // over 1800 chars is injected as a card and paged with read_skill, so without
  // it a declared skill is a title the agent cannot open.
  TOOLS.LIST_SKILLS,
  TOOLS.LOAD_SKILL,
  TOOLS.READ_SKILL,
  // Its own memory. Reading only — writing is a side effect, and a card that
  // was narrowed on purpose should not start writing because of a default.
  TOOLS.READ_SELF_MEMORY,
  // a2a: who exists, and how to answer them.
  //
  // `list_projects` is deliberately NOT here. Knowing every project on the
  // install is not something an agent needs to be one — it is the install's
  // shape, and a specialist narrowed to one project should not be handed the
  // others because of a floor.
  //
  // CALL_AGENT, not SEND_TO_AGENT, and the difference is the whole point.
  // send_to_agent is the better tool and the one every UNDECLARED agent gets
  // (it is in defaultAgentToolNames and in the hot base set, so nobody has to
  // discover it and shell out to `apx send`) — but it reaches the SUPER-AGENT
  // and the runtimes, and the super-agent is the owner's channel. A floor that
  // carried it would hand every deliberately-narrowed card a way to the owner.
  // The CEO template is the live example: three paragraphs of its prompt say it
  // has no channel of its own and never writes to Manu, and its declared list
  // is what enforces that. call_agent resolves against readAgents() — project
  // agents only — so it cannot cross that line. Reaching past the project is a
  // grant, not a floor: declare it on the cards that should have it.
  TOOLS.LIST_AGENTS,
  TOOLS.CALL_AGENT,
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
  // An explicit override — including `[]` — is the caller saying exactly what
  // this run may touch (routine suppression depends on `[]` meaning nothing).
  // The floor does not apply here: it would turn "no tools" into ten.
  if (Array.isArray(override)) return resolveNames(override);
  const declared = declaredAgentTools(agent);
  if (!declared.length) return defaultAgentToolNames();
  const resolved = resolveNames(declared);
  // A card whose every name is stale would otherwise mean a silent no-tools
  // turn that dumps markup as the "answer". Capability beats a broken card.
  if (!resolved.length) return defaultAgentToolNames();
  return [...new Set([...AGENT_CORE_TOOLS, ...resolved])];
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
