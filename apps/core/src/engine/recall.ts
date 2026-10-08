// Which notes go before a message. The first turn of an agent in a thread gets its standing notes (the owner's and
// its own, newest first) plus what matches the message; later turns get only matches not shown yet in this thread.
// Shown notes stay in the model log, so the prefix never changes; once the turn that showed the standing notes falls
// out of the model's view (history budget), they are offered again.
import type { Memory, Thread } from "@apx/protocol";
import type { Store } from "../domain/store.ts";
import type { ThreadContext } from "../domain/threads.ts";
import { notesText } from "../tools/memory.ts";
import type { NoteSearch } from "./memory-index.ts";

const STANDING = 8;
const MATCHES = 5;
/** Ids remembered as shown, per agent: older ones may be shown again (they left the context long ago). */
const SHOWN_CAP = 200;

/**
 * `from`: the oldest model log seq still in the model's view. Returns the block and, when something changed, the
 * bookkeeping to store once the input's seq is known.
 */
export async function recallFor(
  store: Store,
  search: (o: NoteSearch) => Promise<Memory[]>,
  agentId: string,
  thread: Pick<Thread, "project_id">,
  text: string,
  ctx: ThreadContext,
  from: number,
): Promise<{ text?: string | undefined; shown?: ((at: number) => ThreadContext) | undefined }> {
  const all = ctx.memory_shown ?? {};
  const since = ctx.memory_since ?? {};
  const stale = since[agentId] !== undefined && (since[agentId] as number) < from;
  const before = stale ? undefined : all[agentId];
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
    // What an agent wrote about the owner stands only once the owner confirmed it; until then it shows only on a match.
    add(store.memories.list({ view, scope: "global", pending: false, limit: STANDING }));
    add(store.memories.list({ view, scope: "agent", agent_id: agentId, limit: STANDING }));
  }
  if (text.trim()) add(await search({ view, query: text.slice(0, 2000), limit: MATCHES }));
  const block = notesText(notes);
  // The first turn records the agent even with nothing to show, so its standing notes are not looked up again.
  if (before && !block.ids.length) return {};
  return {
    text: block.text,
    shown: (at) => ({
      memory_shown: { ...all, [agentId]: [...(before ?? []), ...block.ids].slice(-SHOWN_CAP) },
      memory_since: before ? since : { ...since, [agentId]: at },
    }),
  };
}
