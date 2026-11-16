import type { Thread } from "@apx/protocol";
import type { InboxTab } from "../data/prefs.ts";
import { isDelegated } from "./groupThreads.ts";

/** The row a chat shows under: itself, or the chat it was delegated from (and so on up), as the Inbox nests them. */
export function listRoot(threads: Record<string, Thread>, id: string): Thread | undefined {
  const seen = new Set<string>();
  let at = threads[id];
  while (at && isDelegated(at) && !seen.has(at.id)) {
    seen.add(at.id);
    const parent = threads[at.parent_id as string];
    if (!parent) break;
    at = parent;
  }
  return at;
}

/**
 * The Inbox tab whose list holds a chat: a routine's runs in Routines, a task's chats in Tasks, the rest (archived
 * ones too, under their fold) in Chats. Undefined while the chat is not loaded. `taskHomes`: each task's own chat,
 * loaded or not; a teammate asked there is listed under the task.
 */
export function listTab(
  threads: Record<string, Thread>,
  id: string | undefined,
  taskHomes: ReadonlySet<string> = new Set(),
): InboxTab | undefined {
  const root = id ? listRoot(threads, id) : undefined;
  if (!root) return undefined;
  if (taskHomes.has(root.id) || (isDelegated(root) && taskHomes.has(root.parent_id as string))) return "tasks";
  if (root.kind === "routine" && root.routine_id) return "routines";
  if (root.archived) return "chats";
  return root.task_id ? "tasks" : "chats";
}
