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
 * Tools only a MASTER agent (an orchestrator, or anything marked `is_master`)
 * may call — and the super-agent, which never comes through here.
 *
 * A tier between "anybody" and "the host only", for the one thing a team lead
 * legitimately does and a specialist never should: reshape another agent's
 * IDENTITY. `rename_agent` moves somebody else's file, memory dir and every
 * pointer aimed at them; the blast radius is the team, not the caller. An
 * orchestrator asked to "renombrá el orchestrator de postbeam" is doing its
 * job. A social producer deciding mid-task that the QA agent needs a better
 * name is not.
 *
 * Unlike HOST_ONLY_TOOLS this is a HARD gate: it survives a declared `tools:`
 * list, because the card is written by whoever set the agent up and the point
 * is that this capability follows the ROLE, not the paperwork. Promote the
 * agent (`type: orchestrator`, or `is_master`) and it has it.
 */
const MASTER_ONLY_TOOLS = Object.freeze([
  TOOLS.RENAME_AGENT,
]);

/** Does this agent lead a team? `orchestrator` implies it; `is_master` says it. */
export function isMasterAgent(agent) {
  const f = agent?.fields || {};
  if (String(f.Type || agent?.type || "").toLowerCase() === "orchestrator") return true;
  const flag = f.Master ?? f.Primary ?? agent?.is_master;
  return String(flag ?? "").toLowerCase() === "true";
}

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
  // Writing work down. THE WHOLE FAMILY, read and write, because half of it is
  // worse than none: an agent that can list tasks and not open one knows the
  // vocabulary, sees the board, and answers "voy a abrir una task por cada uno"
  // — with nothing to do it with. That is what happened to the COO on
  // 2026-09-11: six real findings, a confident promise, zero tool calls, and
  // the tasks existed only because the external session that sent the audit
  // filed them itself a minute later.
  //
  // A floor, not a grant, because this is not reaching past your scope — it is
  // bookkeeping inside it. Noticing something and writing it down is what an
  // agent IS; a card narrowed to "observe and report" still has to be able to
  // leave the note behind, or the noticing evaporates when the turn ends.
  // Deciding WHO does the work is a different question, and the task's assignee
  // is where that lives.
  TOOLS.LIST_TASKS,
  TOOLS.GET_TASK,
  TOOLS.CREATE_TASK,
  TOOLS.UPDATE_TASK,
  TOOLS.COMPLETE_TASK,
  TOOLS.COMMENT_TASK,
]);

/**
 * Everything a project agent may call by default: the registry minus the host's
 * own, minus the master tier unless this agent leads a team.
 *
 * Called with no agent by the web's tool picker, which is drawing the chips a
 * card MAY tick — a master-only tool is not a choice there, the same way a
 * host-only one isn't, so the no-agent form is the narrow set.
 */
export function defaultAgentToolNames(agent = null) {
  const deny = new Set(HOST_ONLY_TOOLS);
  if (!isMasterAgent(agent)) for (const n of MASTER_ONLY_TOOLS) deny.add(n);
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
  // The master tier is a property of the AGENT, so it is filtered last, over
  // whatever path produced the list — a declared card and a routine override
  // included. See MASTER_ONLY_TOOLS.
  const gate = (names) =>
    isMasterAgent(agent) ? names : names.filter((n) => !MASTER_ONLY_TOOLS.includes(n));
  // An explicit override — including `[]` — is the caller saying exactly what
  // this run may touch (routine suppression depends on `[]` meaning nothing).
  // The floor does not apply here: it would turn "no tools" into ten.
  if (Array.isArray(override)) return gate(resolveNames(override));
  const declared = declaredAgentTools(agent);
  if (!declared.length) return defaultAgentToolNames(agent);
  const resolved = resolveNames(declared);
  // A card whose every name is stale would otherwise mean a silent no-tools
  // turn that dumps markup as the "answer". Capability beats a broken card.
  // Measured BEFORE the gate, or a card declaring only a master tool would read
  // as broken and be handed the whole default set instead of a narrower one.
  if (!resolved.length) return defaultAgentToolNames(agent);
  return gate([...new Set([...AGENT_CORE_TOOLS, ...resolved])]);
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
