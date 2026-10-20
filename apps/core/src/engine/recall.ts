// Which notes go before a message. The first turn of an agent in a thread gets its standing notes (the owner's and
// its own, newest first) plus what matches the message; later turns get only matches not shown yet in this thread.
// Shown notes stay in the model log, so the prefix never changes; once the turn that showed the standing notes falls
// out of the model's view (history budget), they are offered again.
import type { Memory, Thread } from "@apx/protocol";
import { canUseChatMemory } from "../domain/chat-access.ts";
import { canSee, ftsQuery } from "../domain/memories.ts";
import type { Store } from "../domain/store.ts";
import type { ThreadContext } from "../domain/threads.ts";
import { notesText } from "../tools/memory.ts";
import type { NoteSearch } from "./memory-index.ts";

const STANDING = 8;
const MATCHES = 5;
/** Ids remembered as shown, per agent: older ones may be shown again (they left the context long ago). */
const SHOWN_CAP = 200;
/** A global note comes into a delegated turn only when it shares this many distinctive words with the task. */
const GLOBAL_SHARED_WORDS = 2;
/** Words every task and every owner note use; sharing them says nothing about the subject. */
const GENERIC = new Set(
  "owner owners dueno project projects proyecto proyectos user usuario agent agents agente task tasks tarea repo check revisar".split(
    " ",
  ),
);

const plain = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

/** True when the note shares enough distinctive words (same prefix rule as the search, generic words aside) with the task. */
function relatedToTask(note: Memory, task: string): boolean {
  const words = [...(ftsQuery(task, 40) ?? "").matchAll(/"([^"]+)"(\*)?/g)]
    .map((m) => ({ w: m[1] as string, prefix: !!m[2] }))
    .filter(({ w }) => !GENERIC.has(w));
  const have = plain(note.text).match(/[\p{L}\p{N}]{3,}/gu) ?? [];
  const shared = words.filter(({ w, prefix }) => have.some((h) => (prefix ? h.startsWith(w) : h === w)));
  return shared.length >= GLOBAL_SHARED_WORDS;
}

/**
 * `from`: the oldest model log seq still in the model's view. `delegated`: a helper's turn, which is about the task
 * it was handed: no standing global notes, and a global match only when it shares words with the task.
 * Returns the block and, when something changed, the bookkeeping to store once the input's seq is known.
 */
export async function recallFor(
  store: Store,
  search: (o: NoteSearch) => Promise<Memory[]>,
  agentId: string,
  thread: Pick<Thread, "project_id"> & { id?: string },
  text: string,
  ctx: ThreadContext,
  from: number,
  delegated = false,
): Promise<{ text?: string | undefined; shown?: ((at: number) => ThreadContext) | undefined }> {
  const all = ctx.memory_shown ?? {};
  const since = ctx.memory_since ?? {};
  const stale = since[agentId] !== undefined && (since[agentId] as number) < from;
  const before = stale ? undefined : all[agentId];
  const versions = ctx.memory_versions ?? {};
  const seen = new Set((before ?? []).filter((id) => versions[id] === (store.memories.get(id)?.revision ?? 1)));
  const view = { agent_id: agentId, project_id: thread.project_id };
  const notes: Memory[] = [];
  const add = (list: Memory[]) => {
    for (const m of list)
      if (!seen.has(m.id) && canUseChatMemory(store, thread, m)) {
        seen.add(m.id);
        notes.push(m);
      }
  };
  if (text.trim()) {
    const found = await search({
      view,
      query: text.slice(0, 2000),
      exclude: [...seen],
      limit: delegated ? MATCHES * 3 : MATCHES,
    });
    add(delegated ? found.filter((m) => m.scope !== "global" || relatedToTask(m, text)).slice(0, MATCHES) : found);
  }
  const matched = notes.length;
  if (!before) {
    if (delegated && thread.project_id)
      add(store.memories.list({ view, scope: "project", project_id: thread.project_id, limit: STANDING }));
    else if (!delegated) add(store.memories.list({ view, scope: "global", pending: false, limit: STANDING }));
    add(store.memories.list({ view, scope: "agent", agent_id: agentId, limit: STANDING }));
  }
  const snapshot = () => {
    const live = (list: Memory[]) =>
      list.flatMap((m) => {
        const n = store.memories.get(m.id);
        return n && !n.forgotten_at && canSee(view, n) && canUseChatMemory(store, thread, n) ? [n] : [];
      });
    const matches = notesText(live(notes.slice(0, matched)), matched ? 1800 : 2400);
    const profile = notesText(live(notes.slice(matched)), matches.ids.length ? 600 : 2400);
    return {
      text: [matches.text, profile.text].filter(Boolean).join("\n") || undefined,
      ids: [...matches.ids, ...profile.ids],
    };
  };
  const block = snapshot();
  // The first turn records the agent even with nothing to show, so its standing notes are not looked up again.
  if (before && !block.ids.length) return {};
  return {
    get text() {
      return snapshot().text;
    },
    shown: (at) => ({
      memory_shown: { ...all, [agentId]: [...new Set([...(before ?? []), ...snapshot().ids])].slice(-SHOWN_CAP) },
      memory_versions: {
        ...versions,
        ...Object.fromEntries(snapshot().ids.map((id) => [id, store.memories.get(id)?.revision ?? 1])),
      },
      memory_since: before ? since : { ...since, [agentId]: at },
    }),
  };
}
