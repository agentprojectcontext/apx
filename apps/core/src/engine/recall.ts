// Which notes go before a message. The first turn of an agent in a thread gets its standing notes (the owner's and
// its own, newest first) plus what matches the message; later turns get only matches not shown yet in this thread.
// Shown notes stay in the model log, so the prefix never changes.
import type { Memory, Thread } from "@apx/protocol";
import type { Store } from "../domain/store.ts";
import { memoryBlock } from "./context.ts";

const STANDING = 8;
const MATCHES = 5;
/** Ids remembered as shown, per agent: older ones may be shown again (they left the context long ago). */
const SHOWN_CAP = 200;

type Shown = Record<string, string[]>;

export function recallFor(
  store: Store,
  agentId: string,
  thread: Pick<Thread, "project_id">,
  text: string,
  ctx: Record<string, unknown>,
): { text?: string | undefined; shown?: Shown | undefined } {
  const all = (ctx.memory_shown ?? {}) as Shown;
  const before = all[agentId];
  const seen = new Set(before ?? []);
  const view = { agent_id: agentId, project_id: thread.project_id };
  const notes: Memory[] = [];
  const add = (list: Memory[]) => {
    for (const m of list)
      if (!seen.has(m.id)) {
        seen.add(m.id);
        notes.push(m);
      }
  };
  if (!before) {
    add(store.memories.list({ view, scope: "global", limit: STANDING }));
    add(store.memories.list({ view, scope: "agent", agent_id: agentId, limit: STANDING }));
  }
  if (text.trim()) add(store.memories.list({ view, query: text.slice(0, 2000), limit: MATCHES }));
  const block = memoryBlock(notes);
  const included = block ? notes.filter((m) => block.includes(`[${m.id}]`)).map((m) => m.id) : [];
  // The first turn records the agent even with nothing to show, so its standing notes are not looked up again.
  if (before && !included.length) return {};
  return { text: block, shown: { ...all, [agentId]: [...(before ?? []), ...included].slice(-SHOWN_CAP) } };
}
