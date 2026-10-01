// First-run defaults: a secretary, a small team and the Home thread. Idempotent.
import type { Store } from "./store.ts";

export const HOME_THREAD_ID = "home";

export function seed(store: Store): void {
  if (store.agents().length === 0) {
    store.upsertAgent({
      id: "roby",
      name: "Roby",
      role: "secretario personal",
      kind: "secretary",
      blob: "menta",
      browser_profile: "shared",
    });
    store.upsertAgent({
      id: "scout",
      name: "Scout",
      role: "investigación web; siempre navega en incógnito",
      kind: "agent",
      blob: "zafiro",
      browser_profile: "incognito",
    });
    store.upsertAgent({
      id: "vera",
      name: "Vera",
      role: "diseño y widgets visuales",
      kind: "agent",
      blob: "coral",
      browser_profile: "isolated",
    });
  }
  if (!store.thread(HOME_THREAD_ID)) {
    store.createThread({ id: HOME_THREAD_ID, kind: "home", title: "Home", agent_ids: ["roby"] });
  }
}
