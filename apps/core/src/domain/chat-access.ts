import type { Memory, Thread } from "@apx/protocol";
import type { AgentRecord } from "./agents.ts";
import type { Store } from "./store.ts";

export function canReadChat(store: Store, agent: AgentRecord, thread: Thread): boolean {
  const context = store.threads.context(thread.id);
  if (context.client) return false;
  if (agent.kind === "secretary" || thread.agent_ids.includes(agent.id)) return true;
  if (agent.project_id) return thread.project_id === agent.project_id;
  return !thread.project_id && !thread.channel && !context.room && !thread.parent_id;
}

/** Automatic recall never widens the explicit chat reader's visibility. */
export function canRecallOwnChat(
  store: Store,
  agent: AgentRecord,
  current: Pick<Thread, "id" | "project_id">,
  thread: Thread,
): boolean {
  const context = store.threads.context(thread.id);
  const family = store.threads.context(current.id).memory_family;
  return (
    (!family || family !== context.memory_family) &&
    thread.id !== current.id &&
    thread.project_id === current.project_id &&
    thread.agent_ids.includes(agent.id) &&
    canReadChat(store, agent, thread) &&
    !thread.engine &&
    !thread.channel &&
    !thread.parent_id &&
    !context.room &&
    !context.client &&
    !context.worker
  );
}

export function memoryEligibleChat(store: Store, thread: Thread): boolean {
  const context = store.threads.context(thread.id);
  return !thread.engine && !thread.channel && !thread.parent_id && !context.room && !context.client && !context.worker;
}

/** A fork inherits the knowledge at its branch point, not later memories from sibling conversations. */
export function canUseChatMemory(
  store: Store,
  current: { id?: string; project_id?: string | undefined },
  note: Memory,
): boolean {
  if (!current.id || !note.thread_id || current.id === note.thread_id) return true;
  const context = store.threads.context(current.id);
  if (!context.memory_family || store.threads.context(note.thread_id).memory_family !== context.memory_family)
    return true;
  if (!context.memory_cutoff || note.updated_at > context.memory_cutoff) return false;
  const evidence = (note.evidence ?? [])
    .map((e) => store.messages.get(e.message_id)?.created_at)
    .filter((at): at is string => !!at);
  const at = evidence.length
    ? evidence.sort().at(-1)
    : note.run_id
      ? store.runs.get(note.run_id)?.started_at
      : note.created_at;
  return !!at && at <= context.memory_cutoff;
}
