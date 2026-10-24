import type { Result } from "@apx/protocol";

/**
 * What the sidebar keeps of the computer: its view shows on a host that can run it once the owner allowed an agent
 * (or set it up), and counts the screens agents work on (DECISIONS.md#d-152).
 */
export function computersOf(status: Result<"environments.status">): Computers {
  return {
    shown: status.supported === true && ((status.allowed_agents ?? 0) > 0 || status.enabled),
    inUse: (status.screens ?? []).filter((s) => s.run).length,
    supported: status.supported === true,
    allowed: status.allowed ?? [],
    screens: (status.screens ?? []).flatMap((s) =>
      s.agent ? [{ agent: s.agent, screen: s.screen, held: !!s.run }] : [],
    ),
  };
}

export type Computers = {
  shown: boolean;
  inUse: number;
  supported: boolean;
  allowed: string[];
  screens: Array<{ agent: string; screen: number; held: boolean }>;
};

export const NO_COMPUTERS: Computers = { shown: false, inUse: 0, supported: false, allowed: [], screens: [] };

/** One agent and the computer, for its card: not allowed, allowed with no screen up, or up on its screen. */
export function agentComputer(c: Computers, agent: string) {
  const up = c.screens.find((s) => s.agent === agent);
  if (up) return { state: "running" as const, screen: up.screen, held: up.held };
  return { state: c.allowed.includes(agent) ? ("allowed" as const) : ("off" as const) };
}
