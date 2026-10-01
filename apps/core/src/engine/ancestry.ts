// Where a thread sits in a delegation tree. Policy and limits follow the thread, not the run: every turn in a
// sub-thread (the first one, a woken one, an owner's message) works under the agents above it.
import type { Thread } from "@apx/protocol";
import type { AgentRecord } from "../domain/agents.ts";
import type { Store } from "../domain/store.ts";

/** The threads above `threadId`, nearest first. */
export function ancestors(store: Store, threadId: string): Thread[] {
  const out: Thread[] = [];
  let t = store.threads.get(threadId);
  while (t?.parent_id && out.length < 10) {
    t = store.threads.get(t.parent_id);
    if (t) out.push(t);
  }
  return out;
}

/** The agents that asked, directly or not, for work in this thread. */
export const callersOf = (store: Store, threadId: string): AgentRecord[] =>
  ancestors(store, threadId).flatMap((t) => {
    const a = store.agents.get(t.agent_ids[0] ?? "");
    return a ? [a] : [];
  });
