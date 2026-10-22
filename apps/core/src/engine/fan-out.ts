// The super-agent hands work to several agents in one turn only with the owner's OK: one wide request can otherwise
// turn into a task per project at once. Asked, the owner may let it go on or have it look first and propose a plan.
// The owner turns this off in Settings → Agents (`fan_out_ask`).
import type { AgentRecord } from "../domain/agents.ts";
import type { RunRecord } from "../domain/runs.ts";
import type { Store } from "../domain/store.ts";

/** The distinct agent a turn gives work to that makes it ask: the third one. */
export const FAN_OUT_AT = 3;

/** The agent a call gives work to, if it gives work to another agent. */
export function handsTo(tool: string, args: Record<string, unknown>, self: AgentRecord): string | undefined {
  const to = tool === "delegate" ? args.agent : tool === "task_create" || tool === "task_update" ? args.assignee : null;
  if (typeof to !== "string" || !to.trim()) return undefined;
  const key = to.trim().toLowerCase();
  return key === self.id.toLowerCase() || key === self.name.toLowerCase() ? undefined : key;
}

/**
 * The agents this call would bring the turn's hand-offs to, when that reaches FAN_OUT_AT and the owner wants to be
 * asked; undefined when it runs as usual. Only the super-agent asks: a team's agents split their own work.
 */
export function fanOut(
  store: Store,
  run: RunRecord,
  agent: AgentRecord,
  tool: string,
  args: Record<string, unknown>,
): string[] | undefined {
  if (agent.kind !== "secretary" || !store.settings.read("fan_out_ask")) return undefined;
  const next = handsTo(tool, args, agent);
  if (!next) return undefined;
  const given = new Set(
    store.runs
      .steps(run.id)
      .filter((s) => s.state === "ok")
      .flatMap((s) => handsTo(s.tool, s.args, agent) ?? []),
  );
  if (given.has(next)) return undefined;
  given.add(next);
  return given.size >= FAN_OUT_AT ? [...given] : undefined;
}

/** What the agent reads when the owner wants it to look first. */
export const LOOK_FIRST =
  "not run: the owner wants you to look at this yourself before handing it out. Survey it in one pass (read what you can across the projects), then tell the owner what you found and propose a plan: which agents would do what. Hand nothing more out until they agree.";
