// Which browser profiles may hold the owner's sessions (DECISIONS.md#d-283): the shared one always; an agent's own or
// incognito one from the moment the owner lent their cookies, signed in through it, took over its tab or got a handoff.
import type { AgentRecord } from "./agents.ts";
import type { Store } from "./store.ts";

/** The browser profile an agent's tabs open in: its own, incognito, or the shared one (the default). */
export function profileOf(agent: Pick<AgentRecord, "id" | "browser_profile">): string {
  if (agent.browser_profile === "incognito") return "incognito";
  if (agent.browser_profile === "isolated") return `agent:${agent.id.toLowerCase().replace(/[^a-z0-9-]/g, "-")}`;
  return "shared";
}

const key = (profile: string) => `browser_logged:${profile}`;

/** The owner's sessions may be in this profile from now on. */
export const markOwnerSessions = (store: Store, profile: string) =>
  store.settings.set(key(profile), new Date().toISOString());

/** Whether this profile ("shared", "incognito" or "agent:<id>") may hold the owner's sessions. */
export const holdsOwnerSessions = (store: Store, profile: string) =>
  profile === "shared" || !!store.settings.get(key(profile));
