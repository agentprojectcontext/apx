// The one place that decides whether an agent's tool call runs, waits for the owner, or is refused.
import { type AgentRules, AUTONOMY_RULES, type RulePolicy, ToolRisk } from "@apx/protocol";
import type { AgentRecord } from "../domain/agents.ts";
import type { Store } from "../domain/store.ts";
import { SUPER_AGENT_TOOLS } from "./agent-set.ts";
import type { Confirm, Effect, Tool } from "./types.ts";

/** Why the owner is asked: always, outside content in the turn, the action's kind, or an agent that asks for all. */
export type ConfirmWhy = "always" | "untrusted" | "needs_ok" | "asks_every" | "rule";
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
 * then a model may be acting on someone else's instructions, so high-impact calls wait for the owner.
 */
export function authorize(tool: Tool, args: Record<string, unknown>, agent: AgentRecord, untrusted: boolean): Decision {
  // A call that only reads here is risk read whatever the tool may do otherwise (DECISIONS.md#d-098).
  return decide(tool.confirm(args), tool.reads?.(args) ? "none" : tool.effect, agent, untrusted, tool.workspace);
}

const OUTSIDE = "content from outside (web, another agent or a message) is in this turn";

/**
 * The rule itself, for APX's tools and for what external agents ask to do with theirs. `workspace`: the call writes
 * files or runs a command in the folder the agent works in.
 */
export function decide(
  level: Confirm,
  effect: Effect,
  agent: AgentRecord,
  untrusted: boolean,
  workspace = false,
): Decision {
  // The agent's own rule for this risk is the owner's explicit choice, over its autonomy (DECISIONS.md#d-090).
  const risk = riskOf(level, effect);
  const rule = agent.rules?.[risk];
  if (rule === "off") return { kind: "deny", reason: `${agent.name}'s rules turn off this kind of action` };
  if (rule === "auto") return { kind: "allow" };
  if (rule === "ask")
    return { kind: "confirm", why: "rule", reason: `${agent.name}'s rules ask before this kind of action` };
  const autonomy = agent.autonomy ?? "standard";
  // Total autonomy is the owner's explicit choice: nothing waits for them, not even `always` (DECISIONS.md#d-047).
  if (autonomy === "total") return { kind: "allow" };
  if (level === "always") return { kind: "confirm", why: "always", reason: "this is a high-impact action" };
  // Accepting edits: the agent's own work in its folder goes on, outside content or not (DECISIONS.md#d-072).
  if (autonomy === "edits" && workspace) return { kind: "allow" };
  if (level === "ask")
    return untrusted
      ? { kind: "confirm", why: "untrusted", reason: OUTSIDE }
      : { kind: "confirm", why: "needs_ok", reason: `${agent.name} needs your OK for this kind of action` };
  if (autonomy === "ask" && effect !== "none")
    return {
      kind: "confirm",
      why: "asks_every",
      reason: `${agent.name} asks before every action that changes something`,
    };
  if (level === "untrusted" && untrusted) return { kind: "confirm", why: "untrusted", reason: OUTSIDE };
  return { kind: "allow" };
}

const STRICTNESS = { ask: 0, standard: 1, edits: 2, total: 3 } as const;

/** An agent with no autonomy of its own goes as far as its project says (the base project's, for a global one). */
export function withProjectAutonomy(store: Store, agent: AgentRecord): AgentRecord {
  if (agent.autonomy) return agent;
  const of = agent.project_id
    ? store.projects.get(agent.project_id)?.autonomy
    : store.settings.read("base_project").autonomy;
  return of ? { ...agent, autonomy: of } : agent;
}

/**
 * A delegated run works with no more than whoever asked for it: only the tools every agent up the chain may use,
 * and the strictest autonomy among them.
 */
export function inherit(
  agent: AgentRecord,
  callers: AgentRecord[],
  tools: Tool[],
): { agent: AgentRecord; tools: Tool[]; allows: (name: string) => boolean } {
  const filters = [agent, ...callers].map((a) => toolFilter(a, tools));
  const allows = (name: string) => filters.every((f) => f(name));
  let autonomy = agent.autonomy ?? "standard";
  for (const c of callers) {
    const a = c.autonomy ?? "standard";
    if (STRICTNESS[a] < STRICTNESS[autonomy]) autonomy = a;
  }
  const rules = strictestRules([agent, ...callers]);
  return {
    agent: { ...agent, autonomy, ...(rules ? { rules } : {}) },
    tools: tools.filter((t) => allows(t.name)),
    allows,
  };
}

const RULE_STRICTNESS: Record<RulePolicy, number> = { off: 0, ask: 1, auto: 2 };

/**
 * Per risk that any of them set a rule for, the strictest they would each apply (a rule, else what their autonomy
 * amounts to): a caller's rule never loosens what the agent it delegates to would do on its own.
 */
function strictestRules(agents: AgentRecord[]): AgentRules | undefined {
  const out: AgentRules = {};
  for (const risk of ToolRisk.options) {
    if (!agents.some((a) => a.rules?.[risk])) continue;
    const each = agents.map((a) => a.rules?.[risk] ?? AUTONOMY_RULES[a.autonomy ?? "standard"][risk]);
    out[risk] = each.reduce((m, p) => (RULE_STRICTNESS[p] < RULE_STRICTNESS[m] ? p : m));
  }
  return Object.keys(out).length ? out : undefined;
}
