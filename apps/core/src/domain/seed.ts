// First-run defaults: a secretary, a small team and the Home thread. Idempotent.
import { randomAgentName } from "@apx/protocol";
import type { Store } from "./store.ts";

export const HOME_THREAD_ID = "home";

export function seed(store: Store, agentName?: string): void {
  if (store.agents.list().length === 0) {
    store.agents.upsert({
      id: "roby",
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
