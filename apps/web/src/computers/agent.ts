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
