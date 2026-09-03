import useSWR from "swr";
import { Tasks } from "../../lib/api";
import { DONE_COLUMN, type BoardColumn } from "./columns";

/**
 * The columns a project actually has — for every control that offers a status,
 * not just the board.
 *
 * Without this the four built-ins were hardcoded in three places (the detail's
 * status select, the task form, the screen's filter chips), so adding a "QA"
 * column gave you a board you could drag a card into and then a detail panel
 * whose dropdown had never heard of it. A card could be moved somewhere the
 * rest of the UI could not name.
 *
 * `done` is stripped: it is a state, reached by completing a task, never by
 * picking it from a dropdown.
 */
export function useTaskColumns(pid?: string) {
  const { data } = useSWR(
    pid ? `/api/projects/${pid}/tasks/columns` : "/api/tasks/columns",
    () => (pid ? Tasks.columns.forProject(pid) : Tasks.columns.catalog().then((r) => ({ columns: r.columns }))),
    // The catalog changes when someone edits it, not while you work — one fetch
    // per screen is plenty, and every control on it shares this key.
    { revalidateOnFocus: false },
  );

  const columns: BoardColumn[] = data?.columns ?? [];
  /** Pickable statuses, in the project's own order. */
  const statuses = columns.filter((c) => c.id !== DONE_COLUMN);
  return { columns, statuses };
}
