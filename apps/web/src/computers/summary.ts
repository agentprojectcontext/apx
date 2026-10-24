import type { Result } from "@apx/protocol";

/**
 * What the sidebar keeps of the computer: its view shows on a host that can run it once the owner allowed an agent
 * (or set it up), and counts the screens agents work on (DECISIONS.md#d-145).
 */
export function computersOf(status: Result<"environments.status">) {
  return {
    shown: status.supported === true && ((status.allowed_agents ?? 0) > 0 || status.enabled),
    inUse: (status.screens ?? []).filter((s) => s.run).length,
  };
}
