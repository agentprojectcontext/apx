// Tasks: the row is the task as it is now; every change is also an event, so its history can be told. The board's
// columns are a setting; "done" and "dropped" are states, never columns.
import type { Task, TaskColumn, TaskEvent, TaskState } from "@apx/protocol";
import type { Selectable } from "kysely";
import type { Bus } from "../bus.ts";
import type { TasksTable } from "../db/schema.ts";
import { newId, now, qb, type Sql } from "./sql.ts";

export const DEFAULT_COLUMNS: TaskColumn[] = [
  { id: "backlog", label: "Backlog" },
  { id: "todo", label: "To do" },
  { id: "doing", label: "Doing" },
  { id: "review", label: "Review" },
];

const toTask = (r: Selectable<TasksTable>): Task => ({
  id: r.id,
  ...(r.project_id ? { project_id: r.project_id } : {}),
  title: r.title,
  description: r.description,
  status: r.status,
  state: r.state as TaskState,
  ...(r.assignee ? { assignee: r.assignee } : {}),
  ...(r.parent_id ? { parent_id: r.parent_id } : {}),
  thread_id: r.thread_id,
  awaits_owner: Boolean(r.awaits_owner),
  ...(r.due_at ? { due_at: r.due_at } : {}),
  created_by: r.created_by,
  created_at: r.created_at,
  updated_at: r.updated_at,
  activity_at: r.activity_at,
});

export type TaskChange = Partial<{
  title: string;
  description: string;
  status: string;
  state: TaskState;
  assignee: string | null;
  due_at: string | null;
  awaits_owner: boolean;
}>;

export function tasksRepo({ one, all, run }: Sql, bus: Bus) {
  const emit = (t: Task) => bus.emit({ type: "task.updated", task: t });
  const event = (taskId: string, op: TaskEvent["op"], by: string, data: Record<string, unknown> = {}) =>
    run(qb.insertInto("task_events").values({ task_id: taskId, at: now(), op, by, data: JSON.stringify(data) }));

  const repo = {
    get(id: string): Task | undefined {
      const r = one(qb.selectFrom("tasks").selectAll().where("id", "=", id));
      return r ? toTask(r) : undefined;
    },
    byThread(threadId: string): Task | undefined {
      const r = one(qb.selectFrom("tasks").selectAll().where("thread_id", "=", threadId));
      return r ? toTask(r) : undefined;
    },
    /** Newest activity first. `projects` limits to those projects (undefined in the list = tasks without one). */
    list(o: { projects?: Array<string | undefined>; state?: TaskState; assignee?: string; limit: number }): Task[] {
      let q = qb.selectFrom("tasks").selectAll();
      if (o.projects) {
        const ids = o.projects.filter((p): p is string => p !== undefined);
        const global = o.projects.includes(undefined);
        if (!ids.length && !global) return [];
        q = q.where((eb) =>
          eb.or([
            ...(ids.length ? [eb("project_id", "in", ids)] : []),
            ...(global ? [eb("project_id", "is", null)] : []),
          ]),
        );
      }
      if (o.state) q = q.where("state", "=", o.state);
      if (o.assignee) q = q.where("assignee", "=", o.assignee);
      return all(q.orderBy("activity_at", "desc").limit(o.limit)).map(toTask);
    },
    create(t: {
      title: string;
      description?: string | undefined;
      project_id?: string | undefined;
      assignee?: string | undefined;
      status: string;
      parent_id?: string | undefined;
      due_at?: string | undefined;
      thread_id: string;
      by: string;
    }): Task {
      const id = newId("task");
      const at = now();
      run(
        qb.insertInto("tasks").values({
          id,
          project_id: t.project_id ?? null,
          title: t.title,
          description: t.description ?? "",
          status: t.status,
          assignee: t.assignee ?? null,
          parent_id: t.parent_id ?? null,
          thread_id: t.thread_id,
          due_at: t.due_at ?? null,
          created_by: t.by,
          created_at: at,
          updated_at: at,
          activity_at: at,
        }),
      );
      event(id, "create", t.by, { title: t.title, status: t.status, ...(t.assignee ? { assignee: t.assignee } : {}) });
      const task = repo.get(id) as Task;
      emit(task);
      return task;
    },
    /** Applies a change and records it as one event (move, assign, done… or a plain update). */
    change(id: string, c: TaskChange, by: string, note?: string): Task | undefined {
      const cur = repo.get(id);
      if (!cur) return undefined;
      const at = now();
      run(
        qb
          .updateTable("tasks")
          .set({
            ...(c.title !== undefined ? { title: c.title } : {}),
            ...(c.description !== undefined ? { description: c.description } : {}),
            ...(c.status !== undefined ? { status: c.status } : {}),
            ...(c.state !== undefined ? { state: c.state } : {}),
            ...(c.assignee !== undefined ? { assignee: c.assignee } : {}),
            ...(c.due_at !== undefined ? { due_at: c.due_at } : {}),
            ...(c.awaits_owner !== undefined ? { awaits_owner: c.awaits_owner ? 1 : 0 } : {}),
            updated_at: at,
            activity_at: at,
          })
          .where("id", "=", id),
      );
      event(id, opOf(cur, c), by, { ...c, ...(note ? { note } : {}) });
      const task = repo.get(id) as Task;
      emit(task);
      return task;
    },
    /** A comment or a turn in its conversation: the task moved, without changing it. */
    touched(id: string, by: string, op: "comment" | "update" = "comment"): void {
      run(qb.updateTable("tasks").set({ activity_at: now() }).where("id", "=", id));
      if (op === "comment") event(id, "comment", by);
      const task = repo.get(id);
      if (task) emit(task);
    },
    events(id: string): TaskEvent[] {
      return all(qb.selectFrom("task_events").selectAll().where("task_id", "=", id).orderBy("n")).map((r) => ({
        at: r.at,
        op: r.op as TaskEvent["op"],
        by: r.by,
        data: JSON.parse(r.data) as Record<string, unknown>,
      }));
    },
  };
  return repo;
}

/** The event a change is: closing and reopening, moving between columns, assigning, or an edit. */
function opOf(cur: Task, c: TaskChange): TaskEvent["op"] {
  if (c.state && c.state !== cur.state) return c.state === "done" ? "done" : c.state === "dropped" ? "drop" : "reopen";
  if (c.status !== undefined && c.status !== cur.status) return "move";
  if (c.assignee !== undefined && c.assignee !== (cur.assignee ?? null)) return "assign";
  return "update";
}
