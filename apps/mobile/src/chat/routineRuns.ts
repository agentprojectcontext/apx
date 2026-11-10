// A routine's runs as the picker in its chat lists them: each run's chat once, newest first.
import { textOrder } from "../format.ts";
import type { Thread } from "../hooks/useWorkspace";
import type { RoutineRun } from "../protocol";

export type RunChoice = {
  thread_id: string;
  /** When the run started (its chat's last change when the core did not list the run). */
  at: string;
  state: string;
  unread: number;
  preview: string;
};

/**
 * The runs of the routine `thread` belongs to: the ones the core lists and the run chats the phone already has,
 * each chat once, newest first. A chat that is not a routine's gives none.
 */
export function runChoices(thread: Thread, threads: readonly Thread[], runs: readonly RoutineRun[]): RunChoice[] {
  const routine = thread.kind === "routine" ? thread.routine_id : undefined;
  if (!routine) return [];
  const known = new Map(threads.map((item) => [item.id, item]));
  const out = new Map<string, RunChoice>();
  for (const run of runs) {
    if (out.has(run.thread_id)) continue;
    const chat = known.get(run.thread_id);
    out.set(run.thread_id, {
      thread_id: run.thread_id,
      at: run.started_at,
      state: chat?.state ?? run.state,
      unread: chat?.unread ?? 0,
      preview: chat?.preview ?? "",
    });
  }
  for (const chat of [thread, ...threads]) {
    if (chat.kind !== "routine" || chat.routine_id !== routine || out.has(chat.id)) continue;
    out.set(chat.id, {
      thread_id: chat.id,
      at: chat.updated_at,
      state: chat.state,
      unread: chat.unread,
      preview: chat.preview,
    });
  }
  return [...out.values()].sort((a, b) => textOrder(b.at, a.at) || textOrder(a.thread_id, b.thread_id));
}
