// The one place that decides whether an agent's tool call runs, waits for the owner, or is refused.
import type { AgentRecord } from "../domain/agents.ts";
import type { Tool } from "./types.ts";

export type Decision = { kind: "allow" } | { kind: "deny"; reason: string } | { kind: "confirm"; reason: string };

/** Names an agent's `tools:` list may use instead of single tools. */
const GROUPS: Record<string, (name: string) => boolean> = {
  browser: (n) => n.startsWith("browser_"),
  widgets: (n) => n === "show_widget",
  agents: (n) => n === "list_agents" || n === "delegate",
  shell: (n) => n.startsWith("shell"),
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
export function authorize(tool: Tool, agent: AgentRecord, untrusted: boolean): Decision {
  const autonomy = agent.autonomy ?? "standard";
  if (tool.confirm === "always") return { kind: "confirm", reason: "this action always needs your OK" };
  if (autonomy === "ask" && tool.effect !== "none")
    return { kind: "confirm", reason: `${agent.name} asks before every action that changes something` };
  if (autonomy !== "total" && tool.confirm === "untrusted" && untrusted)
    return { kind: "confirm", reason: "content from outside (web, another agent or a message) is in this turn" };
  return { kind: "allow" };
}
