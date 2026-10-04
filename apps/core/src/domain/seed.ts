// First-run defaults: a secretary, a small team and the Home thread. Idempotent.
import type { Store } from "./store.ts";

export const HOME_THREAD_ID = "home";

/** A fresh super-agent gets one of these: a hint that the owner names it, not APX. */
export const AGENT_NAMES = [
  "Nova",
  "Milo",
  "Kira",
  "Lumo",
  "Iris",
  "Zeta",
  "Pipa",
  "Teo",
  "Luma",
  "Bruno",
  "Maya",
  "Coco",
];

export function seed(store: Store, agentName?: string): void {
  if (store.agents.list().length === 0) {
    store.agents.upsert({
      id: "roby",
      name: agentName ?? AGENT_NAMES[Math.floor(Math.random() * AGENT_NAMES.length)] ?? "Nova",
      role: "personal secretary",
      kind: "secretary",
      blob: "menta",
      browser_profile: "shared",
    });
    store.agents.upsert({
      id: "scout",
      name: "Scout",
      role: "web research; always browses incognito",
      kind: "agent",
      blob: "zafiro",
      browser_profile: "incognito",
    });
    store.agents.upsert({
      id: "vera",
      name: "Vera",
      role: "design and visual widgets",
      kind: "agent",
      blob: "coral",
      browser_profile: "isolated",
    });
  }
  if (!store.threads.get(HOME_THREAD_ID)) {
    store.threads.create({ id: HOME_THREAD_ID, kind: "home", title: "Home", agent_ids: ["roby"] });
  }
}
