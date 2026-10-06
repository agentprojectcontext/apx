import type { Thread } from "@apx/protocol";

/** Descendants belong to the current chat, including workers delegated by its subagents. */
export function chatDescendants(threads: readonly Thread[], root: string): Thread[] {
  const byId = new Map(threads.map((thread) => [thread.id, thread]));
  return threads.filter((thread) => {
    const seen = new Set([thread.id]);
    let parent = thread.parent_id;
    while (parent) {
      if (parent === root) return thread.id !== root;
      if (seen.has(parent)) return false;
      seen.add(parent);
      parent = byId.get(parent)?.parent_id;
    }
    return false;
  });
}
