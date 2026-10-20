import { memoryEligibleChat } from "../domain/chat-access.ts";
import { forgetAllowance, NOTEBOOK_TARGET, ownNotes } from "../domain/memories.ts";
import { bumpMemoryGeneration, memorySettings, saveMemorySettings } from "../domain/memory-settings.ts";
import { ownerTimeZone } from "../domain/owner.ts";
import type { Store } from "../domain/store.ts";
import type { MemoryIndex } from "../engine/memory-index.ts";
import type { MemoryMaintenance } from "../engine/memory-maintenance.ts";
import { badRequest, errorMessage, unauthorized, unavailable } from "../errors.ts";
import type { Handlers } from "./router.ts";

export function invalidateMemorySummaries(store: Store): void {
  bumpMemoryGeneration(store);
  for (const thread of store.threads.list({ include_archived: true, include_subthreads: true, limit: null })) {
    if (store.threads.context(thread.id).compaction)
      store.threads.mergeContext(thread.id, {
        compaction: undefined,
        memory_shown: undefined,
        memory_versions: undefined,
      });
  }
}

export function memoryAdminHandlers(store: Store, index: MemoryIndex, maintenance?: MemoryMaintenance) {
  return {
    "memory.settings": () => {
      const embedder = index.engine();
      return { ...memorySettings(store), ...store.memories.counts(index.model()), ...(embedder ? { embedder } : {}) };
    },
    "memory.set_settings": (s) => {
      const previous = memorySettings(store);
      const saved = saveMemorySettings(store, s);
      if (previous.mode !== saved.mode || (previous.auto_recall !== false && saved.auto_recall === false))
        invalidateMemorySummaries(store);
      index.schedule();
      return saved;
    },
    "memory.reindex": async () => {
      try {
        return { ...(await index.index()), ...(index.model() ? { engine: index.model() } : {}) };
      } catch (error) {
        throw unavailable(errorMessage(error, 300));
      }
    },
    "memory.status": () => ({ jobs: store.memoryWork.recent() }),
    "memory.maintenance": async ({ backfill, dream }) =>
      maintenance ? maintenance.maintain(backfill, dream) : { queued: 0, jobs: [] },
    "memory.history": ({ id }) => ({ versions: store.memories.history(id) }),
    "memory.undo": ({ id, revision, expected_revision }) => {
      const current = store.memories.get(id);
      if (expected_revision !== undefined && current?.revision !== expected_revision)
        throw badRequest("memory changed; reload before undoing");
      const note = store.memories.undo(id, revision);
      if (!note) throw badRequest("memory changed or revision unavailable");
      invalidateMemorySummaries(store);
      index.schedule();
      return note;
    },
    "memory.consolidate": ({ notes }, ctx) => {
      const thread = ctx.agent && store.threads.get(ctx.agent.thread_id);
      if (
        !ctx.agent ||
        !store.agents.list().some((a) => a.id === ctx.agent?.id) ||
        !thread ||
        !memoryEligibleChat(store, thread)
      )
        throw unauthorized("private agent context required");
      const merged = store.memories.consolidate(notes, { agent_id: ctx.agent.id, project_id: thread.project_id });
      if (merged) index.schedule();
      return { merged };
    },
    "memory.tidy": ({ retire = [], redate = [] }, ctx) => {
      const thread = ctx.agent && store.threads.get(ctx.agent.thread_id);
      if (
        !ctx.agent ||
        !store.agents.list().some((a) => a.id === ctx.agent?.id) ||
        !thread ||
        !memoryEligibleChat(store, thread)
      )
        throw unauthorized("private agent context required");
      const view = { agent_id: ctx.agent.id, project_id: thread.project_id };
      const live = ownNotes(store.memories, view).length;
      if (retire.length > forgetAllowance(live))
        throw badRequest(`a pass may forget at most ${forgetAllowance(live)} of ${live} notes`);
      // Stale notes go only when the notebook outgrew its target; a correction retires what it supersedes anytime.
      const retired = retire.filter((r) => (r.by || live > NOTEBOOK_TARGET) && store.memories.retire(r, view)).length;
      const zone = ownerTimeZone(store);
      const redated = redate.filter((r) => {
        const note = store.memories.get(r.id);
        const said = note?.evidence?.[0] && store.messages.get(note.evidence[0].message_id)?.created_at;
        const at = new Date(said || note?.created_at || Date.now());
        const day = at.toLocaleDateString("en-CA", zone ? { timeZone: zone } : {});
        return !!store.memories.redate(r, view, day);
      }).length;
      if (retired || redated) {
        invalidateMemorySummaries(store);
        index.schedule();
      }
      return { retired, redated };
    },
  } satisfies Partial<Handlers>;
}
