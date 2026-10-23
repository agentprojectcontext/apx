// The one place that decides whether an agent's tool call runs, waits for the owner, or is refused.
import { type AgentRules, type Autonomy, DEFAULT_AUTONOMY, type RulePolicy, ToolRisk } from "@apx/protocol";
import type { AgentRecord } from "../domain/agents.ts";
import type { Store } from "../domain/store.ts";
import { SUPER_AGENT_TOOLS } from "./agent-set.ts";
import type { Reach } from "./folders.ts";
import type { Confirm, Effect, Tool, UntrustedWhy } from "./types.ts";

/** Why the owner is asked: always, outside content in the turn, the action's kind, or an agent that asks for all. */
export type ConfirmWhy = "always" | "untrusted" | "needs_ok" | "asks_every" | "rule" | UntrustedWhy;

/** The mode an agent works in: its own, else its project's (withProjectAutonomy), else the default. */
export const modeOf = (agent: Pick<AgentRecord, "autonomy">): Autonomy => agent.autonomy ?? DEFAULT_AUTONOMY;
export type Decision =
  | { kind: "allow" }
  | { kind: "confirm"; why: ConfirmWhy; reason: string }
  | { kind: "deny"; reason: string };

/** A call's risk: what always asks cannot be undone; otherwise what it may change says it (DECISIONS.md#d-090). */
export function riskOf(level: Confirm, effect: Effect): ToolRisk {
  if (level === "always") return "irreversible";
  if (effect === "none") return "read";
  return effect === "local" ? "write" : "outside";
}

/** A tool's usual risk, from a call with no arguments (a call's own may be higher: a shell command that deletes). */
export function toolRisk(tool: Tool): ToolRisk {
  let level: Confirm = "never";
  try {
    level = tool.confirm({});
  } catch {}
  return riskOf(level, tool.effect);
}

/** Names an agent's `tools:` list may use instead of single tools. */
const GROUPS: Record<string, (name: string) => boolean> = {
  browser: (n) => n.startsWith("browser_"),
  widgets: (n) => n.endsWith("_widget"),
  agents: (n) => n === "list_agents" || n === "delegate" || n === "grant_tool" || n === "agent_set",
  shell: (n) => n.startsWith("shell"),
  files: (n) => n.startsWith("file_") || n === "send_file" || n === "open_document",
  mcp: (n) => n.startsWith("mcp_"),
  memory: (n) => n === "remember" || n === "recall" || n === "forget",
  images: (n) => n === "make_image",
  tasks: (n) => n.startsWith("task_"),
};

/** Tools every agent keeps whatever its list says: they only read what the turn or memory holds, or ask the owner. */
const ALWAYS = new Set(["read_output", "ask_owner", "load_skill", "recall"]);

/** What an agent's editor offers: each assignable tool with its group, and whether every agent keeps it anyway. */
export function toolCatalog(
  tools: readonly Tool[],
): Array<{ name: string; group?: string; kept: boolean; risk: ToolRisk }> {
  // MCP's two bridge tools join each turn apart from the built-in ones; a list without them loses every MCP tool.
  const names = [...new Set([...tools.map((t) => t.name), ...BRIDGE])];
  const byName = new Map(tools.map((t) => [t.name, t]));
  return names
    .filter((n) => !SUPER_AGENT_TOOLS.has(n))
    .map((name) => {
      const group = Object.keys(GROUPS).find((g) => GROUPS[g]?.(name));
      const tool = byName.get(name);
      // mcp_call runs another server's tool: it acts outside unless a grant or rule says otherwise.
      const risk = tool ? toolRisk(tool) : name === "mcp_call" ? "outside" : "read";
      return { name, ...(group ? { group } : {}), kept: ALWAYS.has(name), risk };
    });
}

/**
 * The agent's `tools:` list as a filter. A list that names nothing APX knows (a file written for another tool) is
 * not a restriction: an agent left with no tools at all would be a silent break.
 */
export function allowedTools(agent: AgentRecord, tools: Tool[]): Tool[] {
  const allows = toolFilter(agent, tools);
  return tools.filter((t) => allows(t.name));
}

/**
 * The same filter as a test on names, decided on `tools` and kept for tools that join later (MCP's, found by
 * mcp_search). MCP's two bridge tools count as naming MCP: a list of MCP tools alone still restricts.
 */
function toolFilter(agent: AgentRecord, tools: Tool[]): (name: string) => boolean {
  const listed = byList(agent, tools);
  // A risk its rules turn off takes its tools out of the turn; what every agent keeps stays.
  const off = new Set(
    tools.filter((t) => !ALWAYS.has(t.name) && agent.rules?.[toolRisk(t)] === "off").map((t) => t.name),
  );
  // Running the team is the super-agent's job alone, whatever another agent's list says.
  return (name) => (agent.kind === "secretary" || !SUPER_AGENT_TOOLS.has(name)) && !off.has(name) && listed(name);
}

function byList(agent: AgentRecord, tools: Tool[]): (name: string) => boolean {
  const wanted = agent.tools?.map((t) => t.trim().toLowerCase()).filter(Boolean) ?? [];
  if (!wanted.length) return () => true;
  const bridge = (name: string) => BRIDGE.has(name) && wanted.some((w) => w === "mcp" || w.startsWith("mcp_"));
  const match = (name: string) => wanted.some((w) => w === name || GROUPS[w]?.(name)) || bridge(name);
  if (!tools.some((t) => !ALWAYS.has(t.name) && match(t.name))) return () => true;
  return (name) => ALWAYS.has(name) || match(name);
}

const BRIDGE = new Set(["mcp_search", "mcp_call"]);

/**
 * `untrusted` is whether text from outside (web pages, other agents, channel messages) is in the turn's context:
 * then a model may be acting on someone else's instructions, so strong actions wait for the owner.
 */
export function authorize(tool: Tool, args: Record<string, unknown>, agent: AgentRecord, untrusted: boolean): Decision {
  // Plan mode still asks the owner, loads skills and hands reading work to a helper (who works in plan mode too).
  if (modeOf(agent) === "plan" && PLAN_KEEPS.has(tool.name) && agent.rules?.[toolRisk(tool)] !== "off")
    return { kind: "allow" };
  const level = tool.confirm(args);
  // Its own temp files change nothing of the owner's: no mode asks for them, only what always asks still does.
  if (tool.scratch?.(args)) return decide(level === "always" ? "always" : "never", "none", agent, untrusted);
  // A call that only reads here is risk read whatever the tool may do otherwise (DECISIONS.md#d-098).
  const d = decide(level, tool.reads?.(args) ? "none" : tool.effect, agent, untrusted, tool.workspace);
  // The tool names what outside content could do through this call, so the card says it (DECISIONS.md#d-121).
  return d.kind === "confirm" && d.why === "untrusted" && level === "untrusted" && tool.untrustedWhy
    ? { ...d, why: tool.untrustedWhy, reason: URL_DATA }
    : d;
}

const URL_DATA = "the URL carries data, and content from outside (web, another agent or a message) is in this turn";

const PLAN_KEEPS = new Set([...ALWAYS, "delegate", "list_agents", "list_sessions"]);

const OUTSIDE = "content from outside (web, another agent or a message) is in this turn";

/**
 * The rule itself, for APX's tools and for what external agents ask to do with theirs (DECISIONS.md#d-106).
 * `workspace`: the call writes files or runs a command in the folder the agent works in, where the folder rule
 * already keeps it.
 */
export function decide(
  level: Confirm,
  effect: Effect,
  agent: AgentRecord,
  untrusted: boolean,
  workspace = false,
): Decision {
  const mode = modeOf(agent);
  if (mode === "plan" && effect !== "none")
    return {
      kind: "deny",
      reason: `${agent.name} works in plan mode: it reads and proposes, and changes nothing. Write the change as a proposal in your answer; the owner switches the mode to apply it`,
    };
  // The agent's own rule for this risk is the owner's explicit choice, over its mode (DECISIONS.md#d-090).
  const risk = riskOf(level, effect);
  const rule = agent.rules?.[risk];
  if (rule === "off") return { kind: "deny", reason: `${agent.name}'s rules turn off this kind of action` };
  if (rule === "auto") return { kind: "allow" };
  if (rule === "ask")
    return { kind: "confirm", why: "rule", reason: `${agent.name}'s rules ask before this kind of action` };
  // Total is the owner's explicit choice: nothing waits for them, not even `always` (DECISIONS.md#d-047).
  if (mode === "total") return { kind: "allow" };
  if (level === "always") return { kind: "confirm", why: "always", reason: "this is a high-impact action" };
  if (mode === "manual" && effect !== "none")
    return {
      kind: "confirm",
      why: "asks_every",
      reason: `${agent.name} asks before every action that changes something`,
    };
  // Its own work where it works goes on, outside content or not: the folder rule keeps it there. Accepting edits, a
  // command that changes something still asks.
  if (workspace && (mode === "auto" || effect === "local")) return { kind: "allow" };
  if (level === "ask")
    return untrusted
      ? { kind: "confirm", why: "untrusted", reason: OUTSIDE }
      : { kind: "confirm", why: "needs_ok", reason: `${agent.name} needs your OK for this kind of action` };
  // Outside content gates what acts in the owner's name or keeps something of theirs, not files and commands here.
  if (level === "untrusted" && untrusted) return { kind: "confirm", why: "untrusted", reason: OUTSIDE };
  return { kind: "allow" };
}

/**
 * How far an agent's files reach (folders.ts Reach): `all` on total or its own rule to act outside on its own,
 * `card` on manual or its own rule to ask before acting outside, `fenced` when its own rule turns that off, else `read`.
 * Asked only through engine/permissions.ts, with the agent as it acts (its project's and callers' mode).
 */
export function reachOf(agent: AgentRecord): Reach {
  const own = agent.rules?.outside;
  const mode = modeOf(agent);
  if (own === "auto" || (mode === "total" && !own)) return "all";
  if (own === "off") return "fenced";
  if (own === "ask" || mode === "manual") return "card";
  return "read";
}

/** An agent with no autonomy of its own goes as far as its project says (the base project's, for a global one). */
export function withProjectAutonomy(store: Store, agent: AgentRecord): AgentRecord {
  if (agent.autonomy) return agent;
  const of = agent.project_id
    ? store.projects.get(agent.project_id)?.autonomy
    : store.settings.read("base_project").autonomy;
  return of ? { ...agent, autonomy: of } : agent;
}

/**
 * A delegated run works in its caller's mode, not its own (DECISIONS.md#d-106): the owner's agents act for the owner,
 * so a helper asked by an agent on total does not stop for what its caller would not. Down the chain from the top,
 * each keeps its own rules over the mode it gets, and a rule turning a risk off anywhere above stays off. Tools are
 * the ones every agent up the chain may use.
 */
export function inherit(
  agent: AgentRecord,
  callers: AgentRecord[],
  tools: Tool[],
): { agent: AgentRecord; tools: Tool[]; allows: (name: string) => boolean } {
  const filters = [agent, ...callers].map((a) => toolFilter(a, tools));
  const allows = (name: string) => filters.every((f) => f(name));
  return { agent: actingAs(agent, callers), tools: tools.filter((t) => allows(t.name)), allows };
}

/** The agent with the mode and rules it acts with under its callers (nearest first), as `inherit` gives it. */
export function actingAs(agent: AgentRecord, callers: AgentRecord[]): AgentRecord {
  const chain = [...callers].reverse();
  const top = chain[0];
  if (!top) return { ...agent, autonomy: modeOf(agent) };
  // The top of the chain sets the mode, each one below adds its own rules.
  let rules: AgentRules = { ...top.rules };
  for (const a of [...chain.slice(1), agent]) rules = narrowed(rules, a.rules);
  return { ...agent, autonomy: modeOf(top), ...(Object.keys(rules).length ? { rules } : {}) };
}

/** The rules a caller passed down, under an agent's own: its own win, except over a risk the caller turned off. */
function narrowed(above: AgentRules, own: AgentRules | undefined): AgentRules {
  const out: AgentRules = {};
  for (const risk of ToolRisk.options) {
    const p: RulePolicy | undefined = above[risk] === "off" ? "off" : (own?.[risk] ?? above[risk]);
    if (p) out[risk] = p;
  }
  return out;
}
