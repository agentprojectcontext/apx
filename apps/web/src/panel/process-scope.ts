import type { Job, Thread } from "@apx/protocol";

/**
 * Descendants belong to the current chat, including workers delegated by its subagents; so do the teammates it `asked`
 * on its task (they hang under the task's conversation) and theirs.
 */
export function chatDescendants(threads: readonly Thread[], root: string, asked: readonly string[] = []): Thread[] {
  const byId = new Map(threads.map((thread) => [thread.id, thread]));
  const own = new Set(asked);
  return threads.filter((thread) => {
    if (own.has(thread.id)) return thread.id !== root;
    const seen = new Set([thread.id]);
    let parent = thread.parent_id;
    while (parent) {
      if (parent === root || own.has(parent)) return thread.id !== root;
      if (seen.has(parent)) return false;
      seen.add(parent);
      parent = byId.get(parent)?.parent_id;
    }
    return false;
  });
}

/** The chat itself or one of the conversations it handed out, following parents through the threads it knows. */
function withinChat(threads: Readonly<Record<string, Pick<Thread, "parent_id">>>, id: string, root: string): boolean {
  const seen = new Set<string>();
  for (let at: string | undefined = id; at && !seen.has(at); at = threads[at]?.parent_id) {
    if (at === root) return true;
    seen.add(at);
  }
  return false;
}

/** An agent this chat called (or one it called in turn) is working now. */
export function delegationRunning(
  jobs: readonly Pick<Job, "kind" | "ended_at" | "parent_thread_id">[],
  threads: Readonly<Record<string, Pick<Thread, "parent_id">>>,
  root: string,
): boolean {
  return jobs.some(
    (j) =>
      j.kind === "agent" && !j.ended_at && j.parent_thread_id != null && withinChat(threads, j.parent_thread_id, root),
  );
}
