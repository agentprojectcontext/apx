// The office board: tasks (tasks.*), kept current by task.updated events.
import type { Task, TaskColumn, TaskEvent, TaskState } from "@apx/protocol";
import { t } from "../i18n/index.ts";
import { client } from "./client.ts";
import { createStore, useSlice } from "./createStore.ts";
import { notify } from "./notices.ts";

type State = { tasks: Record<string, Task>; columns: TaskColumn[]; ready: boolean };
const store = createStore<State>({ tasks: {}, columns: [], ready: false });

export const useTasks = <T>(select: (s: State) => T): T => useSlice(store, select);

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));
const fail = (e: unknown) => notify(t("error.tasks", { error: errText(e) }));

/** Open tasks plus the closed ones of the last days, so a just-finished card does not vanish. */
export async function loadTasks(): Promise<void> {
  try {
    const [open, done] = await Promise.all([
      client.call("tasks.list", { state: "open" }),
      client.call("tasks.list", { state: "done", limit: 30 }),
    ]);
    store.set({
      tasks: Object.fromEntries([...open.tasks, ...done.tasks].map((x) => [x.id, x])),
      columns: open.columns,
      ready: true,
    });
  } catch (e) {
    store.set({ ready: true });
    fail(e);
  }
}

/** A task.updated event. */
export function taskChanged(task: Task): void {
  store.set((s) => ({ tasks: { ...s.tasks, [task.id]: task } }));
}

export async function createTask(p: {
  title: string;
  description?: string;
  project?: string;
  assignee?: string;
  person?: string;
  owed_by?: "owner" | "person";
  due_at?: string;
}) {
  try {
    taskChanged(await client.call("tasks.create", p));
  } catch (e) {
    fail(e);
  }
}

export async function updateTask(
  task: string,
  c: {
    status?: string;
    assignee?: string | null;
    title?: string;
    description?: string;
    awaits_owner?: boolean;
    person?: string | null;
    owed_by?: "owner" | "person";
    due_at?: string | null;
  },
) {
  try {
    taskChanged(await client.call("tasks.update", { task, ...c }));
  } catch (e) {
    fail(e);
  }
}

export async function closeTask(task: string, state: TaskState) {
  try {
    taskChanged(await client.call("tasks.close", { task, state }));
  } catch (e) {
    fail(e);
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

export async function taskEvents(task: string): Promise<TaskEvent[]> {
  try {
    return (await client.call("tasks.get", { task })).events;
  } catch {
    return [];
  }
}
