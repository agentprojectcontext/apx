import { t } from "../../i18n";
import type { TaskEntry } from "../../types/daemon";

/**
 * The panel's half of the board-column model. The server side is
 * `src/core/tasks/columns.js` — the two agree on the shape, and this file
 * mirrors only what a browser needs: how to label a column and which one a
 * card belongs in.
 *
 * They are not shared code because they cannot be: the panel is a separate
 * build with no path into `src/core`. `columnFor` below is the one piece of
 * duplicated logic, and it is four lines with a matching comment on both ends.
 */
export interface BoardColumn {
  id: string;
  /** Null means "this is a built-in — use the translation for its id". */
  label: string | null;
  /**
   * Automation: when a task lands in this column, hand it to this agent. The
   * slug resolves against the TASK's project, so one global "QA" column puts
   * each project's own qa agent to work.
   */
  on_enter?: { agent: string; instruction: string | null } | null;
}

/** The terminal column every board ends with. Not part of the catalog. */
export const DONE_COLUMN = "done";

/** Built-in ids get a translated name; a custom column keeps what its author typed. */
export function columnLabel(col: BoardColumn): string {
  if (col.label) return col.label;
  if (col.id === DONE_COLUMN) return t("tasks.done_label");
  const key = `tasks.status_${col.id}`;
  const label = t(key as never);
  // t() echoes the key back when it does not know it — better to show the raw
  // id than "tasks.status_qa".
  return label === key ? col.id : label;
}

/**
 * Which column a task sits in. Mirrors `columnFor` in core/tasks/columns.js:
 * closed tasks land in `done` whatever their last open status was, and an open
 * task whose status is not a column HERE falls into the first one, so a card is
 * never invisible.
 */
export function columnFor(task: TaskEntry, columns: BoardColumn[]): string {
  if (task.state !== "open") return DONE_COLUMN;
  const status = task.status || "pending";
  return columns.some((c) => c.id === status) ? status : (columns[0]?.id || "pending");
}
