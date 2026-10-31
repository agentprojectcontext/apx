// First-run defaults: a secretary, a small team and the Home thread. Idempotent.
import { randomAgentName, SUPER_AGENT_ID } from "@apx/protocol";
import type { Store } from "./store.ts";

export const HOME_THREAD_ID = "home";

export function seed(store: Store, agentName?: string): void {
  if (store.agents.list().length === 0) {
    store.agents.upsert({
      id: SUPER_AGENT_ID,
      name: agentName ?? randomAgentName(),
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
      role: "visual design: brand, layouts, design reviews and multi-screen apps",
      kind: "agent",
      blob: "coral",
      browser_profile: "isolated",
    });
  }
  if (!store.threads.get(HOME_THREAD_ID)) {
    // An older install keeps the super-agent id it was created with.
    const superAgent = store.agents.list().find((a) => a.kind === "secretary")?.id ?? SUPER_AGENT_ID;
    store.threads.create({ id: HOME_THREAD_ID, kind: "home", title: "Home", agent_ids: [superAgent] });
  }
}
