// The owner lets agents go on after the breaker paused a conversation tree: with a fresh budget counted from now, or
// with no limit until they next write in it. Tasks given while paused start, and chats that kept a result go on.
// See DECISIONS.md#d-081
import type { Store } from "../domain/store.ts";
import { tree } from "./breaker.ts";
import type { AdmitFn } from "./engine.ts";
import { startTaskWork } from "./task-work.ts";

export type GoOnMode = "reset" | "release";

/** Lets the tree `threadId` is in go on; returns how many turns it started. */
export function goOn(store: Store, admit: AdmitFn, threadId: string, mode: GoOnMode): number {
  const ids = tree(store, threadId);
  const top = ids[0] ?? threadId;
  const at = new Date().toISOString();
  store.threads.mergeContext(top, mode === "reset" ? { budget_from: at } : { released_at: at });
  let started = 0;
  for (const id of ids) {
    const { held, kept } = store.threads.context(id);
    if (held?.length) {
      store.threads.mergeContext(id, { held: undefined });
      for (const h of held) {
        const task = store.tasks.get(h.task);
        const asker = store.runs.get(h.run);
        // Reassigned or begun meanwhile: whoever has it now goes on as it is.
        if (!task || !asker || task.assignee !== h.agent || store.threads.byTask(task.id).length) continue;
        const name = store.agents.get(asker.agent_id)?.name ?? asker.agent_id;
        const by = { kind: "agent" as const, id: asker.agent_id, name, thread_id: id, run_id: h.run, depth: h.depth };
        if (startTaskWork(store, admit, task, h.agent, by)) started++;
      }
    }
    if (kept && store.agents.get(kept)) {
      store.threads.mergeContext(id, { kept: undefined });
      admit({ thread_id: id, agent_id: kept, trigger: "system", origin: { kind: "go_on", mode }, text: "" });
      started++;
    }
  }
  return started;
}
