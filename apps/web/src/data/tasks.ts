// The office board: tasks (tasks.*), kept current by task.updated events.
import type { Params, Task, TaskColumn, TaskState } from "@apx/protocol";
import { t } from "../i18n/index.ts";
import { client } from "./client.ts";
import { createStore, useSlice } from "./createStore.ts";
import { notify } from "./notices.ts";

type State = { tasks: Record<string, Task>; columns: TaskColumn[]; ready: boolean };
const store = createStore<State>({ tasks: {}, columns: [], ready: false });

export const useTasks = <T>(select: (s: State) => T): T => useSlice(store, select);

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));
const fail = (e: unknown) => notify(t("error.tasks", { error: errText(e) }));

export const tasksLoaded = () => store.get().ready;

let loading: Promise<void> | undefined;

/** Open tasks plus the latest closed ones (done or dropped), so a just-finished card does not vanish. */
export function loadTasks(): Promise<void> {
  loading ??= readTasks().finally(() => {
    loading = undefined;
  });
  return loading;
}

async function readTasks(): Promise<void> {
  try {
    const [open, done, dropped] = await Promise.all([
      client.call("tasks.list", { state: "open" }),
      client.call("tasks.list", { state: "done", limit: 30 }),
      client.call("tasks.list", { state: "dropped", limit: 20 }),
    ]);
    store.set({
      tasks: Object.fromEntries([...open.tasks, ...done.tasks, ...dropped.tasks].map((x) => [x.id, x])),
      columns: open.columns,
      ready: true,
    });
  } catch (e) {
    store.set({ ready: true });
    fail(e);
  }
}

const asked = new Set<string>();

/** Reads one task the board has not loaded (an old one an agent names in a chat); once per id. */
export function ensureTask(id: string): void {
  // Inbox task labels and menus need the columns even before the board has been opened.
  if (!tasksLoaded()) void loadTasks();
  if (store.get().tasks[id] || asked.has(id)) return;
  asked.add(id);
  void client.call("tasks.get", { task: id }).then(
    (r) => taskChanged(r.task),
    () => undefined,
  );
}

/** A task.updated event. */
export function taskChanged(task: Task): void {
  store.set((s) => ({ tasks: { ...s.tasks, [task.id]: task } }));
}

/** A task.deleted event. */
export function taskDeleted(id: string): void {
  store.set((s) => {
    const { [id]: _gone, ...tasks } = s.tasks;
    return { tasks };
  });
}

export async function createTask(p: Params<"tasks.create">) {
  try {
    taskChanged(await client.call("tasks.create", p));
    return true;
  } catch (e) {
    fail(e);
    return false;
  }
}

export async function updateTask(task: string, c: Omit<Params<"tasks.update">, "task">) {
  try {
    taskChanged(await client.call("tasks.update", { task, ...c }));
  } catch (e) {
    fail(e);
  }
}

/** Accepts an agent's proposed tasks: each starts as if it had just been given. */
export async function acceptTasks(tasks: string[]) {
  for (const task of tasks) await updateTask(task, { proposed: false });
}

export async function closeTask(task: string, state: TaskState) {
  try {
    taskChanged(await client.call("tasks.close", { task, state }));
  } catch (e) {
    fail(e);
  }
}

/** How a commitment went; renegotiated keeps it open with the new date. */
export async function settleTask(task: string, outcome: Params<"tasks.settle">["outcome"], due_at?: string) {
  try {
    taskChanged(await client.call("tasks.settle", { task, outcome, ...(due_at ? { due_at } : {}) }));
  } catch (e) {
    fail(e);
  }
}

/** Deletes a task for good, with its history and conversation. */
export async function deleteTask(task: string): Promise<boolean> {
  try {
    await client.call("tasks.delete", { task });
    taskDeleted(task);
    return true;
  } catch (e) {
    fail(e);
    return false;
  }
}

export async function commentTask(task: string, text: string): Promise<boolean> {
  try {
    await client.call("tasks.comment", { task, text });
    return true;
  } catch (e) {
    fail(e);
    return false;
  }
}
