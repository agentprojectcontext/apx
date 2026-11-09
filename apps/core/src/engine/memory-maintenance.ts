import { randomUUID } from "node:crypto";
import { memoryEligibleChat } from "../domain/chat-access.ts";
import { memorySettings } from "../domain/memory-settings.ts";
import { ownerTimeZone } from "../domain/owner.ts";
import { ownerOrigin, type RunRecord } from "../domain/runs.ts";
import type { Store } from "../domain/store.ts";
import type { Log } from "../log.ts";
import type { InternalCall } from "../rpc/internal.ts";
import { memoryEpisodeSource, recordMemoryEpisode } from "./memory-episodes.ts";
import type { MemoryIndex } from "./memory-index.ts";
import { performMemoryJob, SHARED_DREAM_PREFIX } from "./memory-job.ts";
import { captureProcedure } from "./memory-procedure.ts";
import type { Upkeep } from "./upkeep.ts";

export function createMemoryMaintenance(deps: {
  store: Store;
  upkeep: Upkeep;
  call: InternalCall;
  index: MemoryIndex;
  log: Log;
}) {
  const { store, log } = deps;
  let running: Promise<void> | undefined;
  let again = false;
  let stopped = false;
  let timer: ReturnType<typeof setInterval> | undefined;

  function eligible(run: RunRecord): boolean {
    const thread = store.threads.get(run.thread_id);
    return (
      run.state === "completed" &&
      ownerOrigin(run.input?.origin) &&
      !!thread &&
      thread.agent_ids.includes(run.agent_id) &&
      store.agents.active(run.agent_id) &&
      memoryEligibleChat(store, thread)
    );
  }
  function enqueue(run: RunRecord, dream = false, manual = false, shared = false): boolean {
    const thread = store.threads.get(run.thread_id);
    if (!thread || !eligible(run)) return false;
    const capture = memorySettings(store).auto_capture !== false && memoryEpisodeSource(store, run).length > 0;
    store.tx(() => {
      recordMemoryEpisode(store, run);
      if (capture)
        store.memoryWork.enqueue({
          id: `capture:${run.id}`,
          kind: "capture",
          agent_id: run.agent_id,
          thread_id: thread.id,
          run_id: run.id,
          ...(thread.project_id ? { project_id: thread.project_id } : {}),
        });
      if (dream)
        store.memoryWork.enqueue({
          id: `dream:${run.id}${manual ? `:${randomUUID()}` : ""}`,
          kind: "dream",
          agent_id: run.agent_id,
          thread_id: thread.id,
          run_id: run.id,
          ...(thread.project_id ? { project_id: thread.project_id } : {}),
        });
      if (shared)
        store.memoryWork.enqueue({
          id: `${SHARED_DREAM_PREFIX}${run.id}${manual ? `:${randomUUID()}` : ""}`,
          kind: "dream",
          agent_id: run.agent_id,
          thread_id: thread.id,
          run_id: run.id,
          ...(thread.project_id ? { project_id: thread.project_id } : {}),
        });
    });
    return capture || dream || shared;
  }
  function drain(): Promise<void> {
    if (stopped) return Promise.resolve();
    if (running) {
      // Work queued or deferred during a pass is past that pass's snapshot: run another once it ends.
      again = true;
      return running;
    }
    again = false;
    running = (async () => {
      for (const pending of store.memoryWork.pending()) {
        if (stopped) break;
        const job = store.memoryWork.claim(pending.id);
        if (!job) continue;
        try {
          await performMemoryJob(deps, job, eligible, () => stopped);
        } catch (err) {
          store.memoryWork.finish(
            job.id,
            job.attempts >= 3 ? "failed" : "pending",
            JSON.parse(store.memoryWork.get(job.id)?.result ?? "{}"),
            "memory maintenance failed",
          );
          log.warn(
            { job: job.id, error: err instanceof Error ? err.name : "UnknownError" },
            "memory maintenance failed",
          );
        }
      }
    })().finally(() => {
      running = undefined;
      if (again) void drain();
    });
    return running;
  }
  return {
    start() {
      // The last day's turns, at most 20 per chat; eligible() keeps only the owner's top-level chats.
      const perChat = new Map<string, number>();
      for (const run of store.runs.completedSince(new Date(Date.now() - 86_400_000).toISOString())) {
        const seen = perChat.get(run.thread_id) ?? 0;
        if (seen >= 20) continue;
        perChat.set(run.thread_id, seen + 1);
        if (!store.threads.get(run.thread_id)?.archived && eligible(run)) enqueue(run);
      }
      deps.index.schedule();
      timer = setInterval(() => {
        deps.index.schedule();
        void drain();
      }, 30_000);
      timer.unref();
      void drain();
    },
    afterRun(run: RunRecord) {
      if (!eligible(run)) return;
      const place = store.threads.get(run.thread_id)?.project_id ?? "";
      const key = `memory_dream:${run.agent_id}:${place}`;
      // The notes a place shares are tidied once a day too, by whichever of its agents works first.
      const sharedKey = `memory_dream:shared:${place}`;
      const due = (k: string) => {
        const last = store.settings.get(k);
        return memorySettings(store).auto_dream !== false && (!last || Date.now() - Date.parse(last) >= 86_400_000);
      };
      const dream = due(key);
      const shared = due(sharedKey);
      store.tx(() => {
        enqueue(run, dream, false, shared);
        if (dream) store.settings.set(key, new Date().toISOString());
        if (shared) store.settings.set(sharedKey, new Date().toISOString());
      });
      void captureProcedure(store, deps.call, run, ownerTimeZone(store))
        .then((saved) => saved && deps.index.schedule())
        .catch((err) =>
          log.warn(
            { run: run.id, error: err instanceof Error ? err.message : "UnknownError" },
            "procedure note failed",
          ),
        );
      deps.index.schedule();
      void drain();
    },
    async maintain(backfill = false, dream = false) {
      let queued = 0;
      const tidied = new Set<string>();
      if (backfill || dream)
        for (const thread of store.threads.list({ include_archived: true, include_subthreads: false, limit: null })) {
          if (!memoryEligibleChat(store, thread)) continue;
          const eligibleRuns = store.runs.list(thread.id, backfill ? 100 : 20).filter(eligible);
          const runs = backfill ? eligibleRuns : eligibleRuns.slice(0, 1);
          for (const run of runs) {
            // One pass over the notes each place shares, whichever of its chats comes first.
            const shared = dream && !tidied.has(thread.project_id ?? "");
            if (shared) tidied.add(thread.project_id ?? "");
            if (enqueue(run, dream, true, shared)) queued++;
          }
        }
      if (backfill || dream) deps.index.schedule();
      void drain();
      return { queued, jobs: store.memoryWork.recent() };
    },
    async stop() {
      stopped = true;
      if (timer) clearInterval(timer);
      await running;
    },
  };
}
export type MemoryMaintenance = ReturnType<typeof createMemoryMaintenance>;
