/**
 * How you left the Tasks screen, remembered per device.
 *
 * Leaving for the chat and coming back used to drop you on the list, showing
 * open tasks, filter cleared — every time. The board was a place you had to
 * re-find, which is most of the reason a board stops being where you work.
 *
 * localStorage, not the daemon, on purpose: this is a per-DEVICE preference in
 * the same family as the channel view/notify filters. The board you keep open
 * on the laptop is not the one you want on the phone, and syncing it would make
 * one of the two wrong.
 *
 * The URL still wins when it says something (`?view=board`), so a link someone
 * sends still opens what it promises instead of whatever that device last did.
 */
export type TaskView = "list" | "board";
export type TaskState = "open" | "done" | "dropped" | "all";

export interface TaskViewPrefs {
  view: TaskView;
  state: TaskState;
  /** A column id. Only meaningful for open tasks, and only in a project that has it. */
  status: string;
}

const KEY = "apx.tasks.view";

export const DEFAULT_TASK_VIEW_PREFS: TaskViewPrefs = { view: "list", state: "open", status: "" };

const VIEWS: TaskView[] = ["list", "board"];
const STATES: TaskState[] = ["open", "done", "dropped", "all"];

/**
 * Read the stored preference. Never throws and never returns a shape the screen
 * has to check: a private window, cleared site data, or a value written by an
 * older build all come back as the defaults.
 */
export function readTaskViewPrefs(): TaskViewPrefs {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT_TASK_VIEW_PREFS };
    const saved = JSON.parse(raw) as Partial<TaskViewPrefs>;
    return {
      view: VIEWS.includes(saved?.view as TaskView) ? (saved!.view as TaskView) : "list",
      state: STATES.includes(saved?.state as TaskState) ? (saved!.state as TaskState) : "open",
      status: typeof saved?.status === "string" ? saved.status : "",
    };
  } catch {
    return { ...DEFAULT_TASK_VIEW_PREFS };
  }
}

/** Store it. A device that refuses storage just does not remember — never an error. */
export function writeTaskViewPrefs(prefs: TaskViewPrefs): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs));
  } catch {
    /* private window, blocked site data — the screen works, it just forgets */
  }
}

/**
 * A remembered status filter is only valid where that column exists.
 *
 * Columns are per project (core/tasks/columns.js), so "qa" saved on one board
 * is a filter that matches nothing on the next — and a screen that silently
 * shows zero tasks reads as broken, not as filtered. Restoring it needs the
 * project's own vocabulary, so this is checked once the columns have loaded.
 */
export function statusStillValid(status: string, available: { id: string }[]): boolean {
  if (!status) return true;
  return available.some((c) => c.id === status);
}
