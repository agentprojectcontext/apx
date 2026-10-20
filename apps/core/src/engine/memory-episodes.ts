import { memoryEligibleChat } from "../domain/chat-access.ts";
import { memorySensitive } from "../domain/memories.ts";
import { isMemoryGreeting } from "../domain/memory-content.ts";
import { memorySettings } from "../domain/memory-settings.ts";
import { ownerOrigin, type RunRecord } from "../domain/runs.ts";
import type { Store } from "../domain/store.ts";

const textOf = (m: { parts: Array<{ type: string; text?: string }> }) =>
  m.parts.flatMap((p) => (p.type === "text" ? [p.text ?? ""] : [])).join("\n");

export function memoryEpisodeSource(store: Store, run: RunRecord) {
  const thread = store.threads.get(run.thread_id);
  if (
    run.state !== "completed" ||
    !ownerOrigin(run.input?.origin) ||
    !thread ||
    !memoryEligibleChat(store, thread) ||
    !thread.agent_ids.includes(run.agent_id) ||
    !store.agents.list().some((a) => a.id === run.agent_id)
  )
    return [];
  const view = { agent_id: run.agent_id, project_id: thread.project_id };
  return store.memorySources.forRun(run.id).flatMap((id) => {
    const m = store.messages.get(id);
    if (!m || m.thread_id !== thread.id || m.author.kind !== "user") return [];
    const text = textOf(m);
    return text.trim().length < 12 ||
      isMemoryGreeting(text) ||
      memorySensitive(text) ||
      store.memories.excluded(view, text, { message_id: id, run_id: run.id })
      ? []
      : [{ id, text: text.slice(0, 4000) }];
  });
}

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
