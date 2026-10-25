// What only the computer's own screens and an agent's card read: kept off the first load (AGENTS.md rule 27).
import type { Result } from "@apx/protocol";
import type { Computers } from "./summary.ts";

/**
 * Agent screens up now, held by a working run or kept warm after it: what the picker lists and each one takes a slot
 * of `max_screens`, so every count of screens in use reads this.
 */
export const screensUp = (status: Result<"environments.status"> | undefined) => status?.screens?.length ?? 0;

/** One agent and the computer, for its card: not allowed, allowed with no screen up, or up on its screen. */
export function agentComputer(c: Computers, agent: string) {
  const up = c.screens.find((s) => s.agent === agent);
  if (up) return { state: "running" as const, screen: up.screen, held: Boolean(up.run) };
  return { state: c.allowed.includes(agent) ? ("allowed" as const) : ("off" as const) };
}

/**
 * The chat an agent's screen works for: the one its run holds it in, else the agent's chat on the computer (a screen
 * kept up after its run, or seen from another chat of the same agent).
 */
export function screenChat(
  status: Result<"environments.status"> | undefined,
  threads: Readonly<Record<string, { agent_ids: string[] } | undefined>>,
  agent: string | undefined,
): string | undefined {
  const held = status?.screens?.find((s) => s.agent === agent && s.thread)?.thread;
  if (held || !agent) return held;
  return (status?.chats ?? []).find((id) => threads[id]?.agent_ids[0] === agent);
}
