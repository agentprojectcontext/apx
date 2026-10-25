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
    // Read by the agents' cards (computers/agent.ts), kept as the core sent them.
    allowed: status.allowed ?? [],
    screens: status.screens ?? [],
  };
}

export type Computers = {
  shown: boolean;
  inUse: number;
  supported: boolean;
  allowed: string[];
  screens: Array<{ agent?: string | undefined; screen: number; run?: string | undefined }>;
};

export const NO_COMPUTERS: Computers = { shown: false, inUse: 0, supported: false, allowed: [], screens: [] };
