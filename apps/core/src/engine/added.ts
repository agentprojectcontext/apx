// Something new the owner added (a project, an agent) reaches the super-agent in Home, which offers to adapt it: the
// owner hears of it from their secretary, not from a settings screen (DECISIONS.md#d-161).
import { HOME_THREAD_ID } from "../domain/seed.ts";
import type { Store } from "../domain/store.ts";
import type { AdmitFn } from "./engine.ts";

export type Added = { what: "project" | "agent"; id: string; name: string };

/** Tells the super-agent; not while it is working, since then it is most likely its own doing. */
export function tellAdded(store: Store, admit: AdmitFn, added: Added): void {
  const boss = store.agents.list().find((a) => a.kind === "secretary");
  if (!boss || !store.threads.get(HOME_THREAD_ID) || added.id === boss.id) return;
  if (store.runs.byAgent(boss.id, 5).some((r) => r.state === "working" || r.state === "input-required")) return;
  admit({
    thread_id: HOME_THREAD_ID,
    agent_id: boss.id,
    trigger: "system",
    origin: { kind: "added", ...added },
    text: `${added.what} added: ${added.name}`,
  });
}
