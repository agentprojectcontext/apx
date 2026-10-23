import { ownerMemorySource } from "../domain/memory-evidence.ts";
import { memorySettings } from "../domain/memory-settings.ts";
import type { RunRecord } from "../domain/runs.ts";
import type { Store } from "../domain/store.ts";

export const memoryEpisodeSource = ownerMemorySource;

/** Index provenance without spending the auxiliary model budget; each scan is crash-safe and idempotent. */
export function recordMemoryEpisode(store: Store, run: RunRecord): void {
  const settings = memorySettings(store);
  if (settings.mode === "off" || settings.auto_recall === false) return;
  store.memoryWork.checkEpisode(run.id, () => {
    const source = memoryEpisodeSource(store, run);
    const first = source[0];
    if (!first) return;
    store.memoryWork.episode({
      run_id: run.id,
      thread_id: run.thread_id,
      agent_id: run.agent_id,
      project_id: store.threads.get(run.thread_id)?.project_id ?? null,
      message_id: first.id,
      text: source
        .map((m) => m.text)
        .join("\n")
        .slice(0, 4000),
      created_at: run.ended_at ?? run.started_at,
    });
  });
}
