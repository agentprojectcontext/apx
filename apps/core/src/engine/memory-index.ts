// Notes by meaning: when the owner turns it on, each note is indexed with an embedding engine (in the background),
// and a search mixes the notes that share words with the query and those close in meaning. If the engine is slow
// or down, search goes on by words alone: memory never blocks a turn.
import type { Memory } from "@apx/protocol";
import { canSee, fuse, type MemoryView } from "../domain/memories.ts";
import { memorySettings } from "../domain/memory-settings.ts";
import type { Store } from "../domain/store.ts";
import { errorMessage } from "../errors.ts";
import type { Log } from "../log.ts";
import type { Services } from "../services/registry.ts";

/** How long a turn waits for the query's vector before searching by words only. */
const QUERY_EMBED_MS = 3000;
const BATCH = 32;

export type NoteSearch = {
  view?: MemoryView | undefined;
  scope?: Memory["scope"] | undefined;
  project_id?: string | undefined;
  agent_id?: string | undefined;
  exclude?: string[] | undefined;
  pending?: boolean | undefined;
  query: string;
  limit: number;
};

export function createMemoryIndex(deps: { store: Store; services: Services; log: Log }) {
  const { store, services, log } = deps;
  let indexing: Promise<{ indexed: number; total: number }> | undefined;
  const ac = new AbortController();
  const semantic = () => memorySettings(store).mode === "semantic" && services.embeddingModel() !== undefined;

  const live = (o: NoteSearch, notes: Memory[]) =>
    notes.flatMap((note) => {
      const current = store.memories.get(note.id);
      if (
        !current ||
        current.forgotten_at ||
        (o.view && !canSee(o.view, current)) ||
        (o.pending !== undefined && current.pending !== o.pending)
      )
        return [];
      return [current];
    });

  async function indexAll(): Promise<{ indexed: number; total: number }> {
    const model = services.embeddingModel();
    if (!model) return store.memories.counts(undefined);
    for (;;) {
      ac.signal.throwIfAborted();
      const batch = store.memories.unindexed(model, BATCH);
      if (!batch.length) break;
      const { vectors, model: used } = await services.embed(
        batch.map((n) => n.text),
        AbortSignal.any([ac.signal, AbortSignal.timeout(120_000)]),
      );
      ac.signal.throwIfAborted();
      batch.forEach((n, i) => {
        const v = vectors[i];
        const live = store.memories.get(n.id);
        if (v && live && !live.forgotten_at && live.text === n.text) store.memories.setEmbedding(n.id, v, used);
      });
      // A different engine answered (the first one is down): stop rather than index everything twice.
      if (used !== model) break;
    }
    for (;;) {
      ac.signal.throwIfAborted();
      const batch = store.memoryWork.unindexed(model, BATCH);
      if (!batch.length) break;
      const { vectors, model: used } = await services.embed(
        batch.map((n) => n.text),
        AbortSignal.any([ac.signal, AbortSignal.timeout(120_000)]),
      );
      ac.signal.throwIfAborted();
      batch.forEach((n, i) => {
        const vector = vectors[i];
        if (vector) store.memoryWork.setEmbedding(n.run_id, vector, used);
      });
      if (used !== model) break;
    }
    return store.memories.counts(model);
  }

  function index(): Promise<{ indexed: number; total: number }> {
    indexing ??= indexAll().finally(() => {
      indexing = undefined;
    });
    return indexing;
  }

  return {
    async stop() {
      ac.abort();
      await indexing?.catch(() => undefined);
    },
    /** The engine and model notes are indexed with now (none when search by meaning is off or has no engine). */
    model: (): string | undefined =>
      memorySettings(store).mode === "semantic" ? services.embeddingModel() : undefined,
    /** The embedding engine set up, whatever memory's mode, as the owner reads it. */
    engine: (): string | undefined => services.embeddingLabel(),
    /** Indexes what is missing; callers share the run in progress. */
    index,
    /** In the background after a note changes; a failure is only logged. */
    schedule(): void {
      if (ac.signal.aborted || !semantic()) return;
      void index().catch((err) => log.warn({ err: errorMessage(err, 200) }, "memory indexing failed"));
    },
    async searchEpisodes(query: string, threadIds: string[]) {
      const words = store.memoryWork.searchEpisodes(query, threadIds);
      if (!semantic()) return words;
      try {
        const { vectors, model } = await services.embed([query], AbortSignal.timeout(QUERY_EMBED_MS));
        const vector = vectors[0];
        const semanticRows = vector ? store.memoryWork.nearest(threadIds, vector, model) : [];
        return [...new Map([...semanticRows, ...words].map((row) => [row.run_id, row])).values()].slice(0, 12);
      } catch (err) {
        log.warn({ err: errorMessage(err, 200) }, "chat recall by meaning failed; by words only");
        return words;
      }
    },
    /** Words, and meaning when it is on; the best of both first. */
    async search(o: NoteSearch): Promise<Memory[]> {
      const byWords = store.memories.list(o);
      if (!semantic()) return byWords;
      try {
        const { vectors, model } = await services.embed([o.query], AbortSignal.timeout(QUERY_EMBED_MS));
        const vector = vectors[0];
        if (!vector) return live(o, byWords);
        return live(o, fuse([byWords, store.memories.nearest({ ...o, vector, model })], o.limit));
      } catch (err) {
        log.warn({ err: errorMessage(err, 200) }, "search by meaning failed; by words only");
        return live(o, byWords);
      }
    },
  };
}

export type MemoryIndex = ReturnType<typeof createMemoryIndex>;
