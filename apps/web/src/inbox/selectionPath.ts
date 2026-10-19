import type { Thread } from "@apx/protocol";

/** The selected chat and its loaded callers; malformed cycles cannot trap the list. */
export function selectionPath(threads: Record<string, Thread>, selected: string | undefined): Set<string> {
  const path = new Set<string>();
  let id = selected;
  while (id && !path.has(id)) {
    path.add(id);
    id = threads[id]?.parent_id;
  }
  return path;
}
