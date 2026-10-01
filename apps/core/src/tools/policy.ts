// The one place that decides whether an agent's tool call runs, waits for the owner, or is refused.
import type { AgentRecord } from "../domain/agents.ts";
import type { Confirm, Effect, Tool } from "./types.ts";

export type Decision = { kind: "allow" } | { kind: "confirm"; reason: string };

/** Names an agent's `tools:` list may use instead of single tools. */
const GROUPS: Record<string, (name: string) => boolean> = {
  browser: (n) => n.startsWith("browser_"),
  widgets: (n) => n === "show_widget",
  agents: (n) => n === "list_agents" || n === "delegate",
  shell: (n) => n.startsWith("shell"),
  mcp: (n) => n.startsWith("mcp_"),
};

/** Tools every agent keeps whatever its list says: they only read what the turn already produced or ask the owner. */
const ALWAYS = new Set(["read_output", "ask_owner"]);

/** Marker every untrusted envelope carries (tools/result.ts `untrusted`). */
export const UNTRUSTED_MARK = 'trust="untrusted"';

/**
 * The agent's `tools:` list as a filter. A list that names nothing APX knows (a file written for another tool) is
 * not a restriction: an agent left with no tools at all would be a silent break.
 */
export function allowedTools(agent: AgentRecord, tools: Tool[]): Tool[] {
  const wanted = agent.tools?.map((t) => t.trim().toLowerCase()).filter(Boolean) ?? [];
  if (!wanted.length) return tools;
  const match = (name: string) => wanted.some((w) => w === name || GROUPS[w]?.(name));
  if (!tools.some((t) => !ALWAYS.has(t.name) && match(t.name))) return tools;
  return tools.filter((t) => ALWAYS.has(t.name) || match(t.name));
}

/**
 * `untrusted` is whether text from outside (web pages, other agents, channel messages) is in the turn's context:
 * then a model may be acting on someone else's instructions, so high-impact calls wait for the owner.
 */
export function authorize(tool: Tool, args: Record<string, unknown>, agent: AgentRecord, untrusted: boolean): Decision {
  return decide(tool.confirm(args), tool.effect, agent, untrusted);
}

/** The rule itself, for APX's tools and for what external agents ask to do with theirs. */
export function decide(level: Confirm, effect: Effect, agent: AgentRecord, untrusted: boolean): Decision {
  const autonomy = agent.autonomy ?? "standard";
  if (level === "always") return { kind: "confirm", reason: "this action always needs your OK" };
  // Total autonomy skips the question only while the turn holds nothing from outside that could be steering it.
  if (level === "ask" && (autonomy !== "total" || untrusted))
    return {
      kind: "confirm",
      reason: untrusted
        ? "content from outside (web, another agent or a message) is in this turn"
        : `${agent.name} needs your OK for this kind of action`,
    };
  if (autonomy === "ask" && effect !== "none")
    return { kind: "confirm", reason: `${agent.name} asks before every action that changes something` };
  if (autonomy !== "total" && level === "untrusted" && untrusted)
    return { kind: "confirm", reason: "content from outside (web, another agent or a message) is in this turn" };
  return { kind: "allow" };
}

const STRICTNESS = { ask: 0, standard: 1, total: 2 } as const;

/**
 * A delegated run works with no more than whoever asked for it: only the tools every agent up the chain may use,
 * and the strictest autonomy among them.
 */
export function inherit(
  agent: AgentRecord,
  callers: AgentRecord[],
  tools: Tool[],
): { agent: AgentRecord; tools: Tool[] } {
  let allowed = allowedTools(agent, tools);
  let autonomy = agent.autonomy ?? "standard";
  for (const c of callers) {
    const theirs = new Set(allowedTools(c, tools).map((t) => t.name));
    allowed = allowed.filter((t) => theirs.has(t.name));
    const a = c.autonomy ?? "standard";
    if (STRICTNESS[a] < STRICTNESS[autonomy]) autonomy = a;
  }
  return { agent: { ...agent, autonomy }, tools: allowed };
}
