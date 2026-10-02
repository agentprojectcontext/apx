// Tasks: the row is the task as it is now; every change is also an event, so its history can be told. The board's
// columns are a setting; "done" and "dropped" are states, never columns.
import type { Task, TaskColumn, TaskEvent, TaskKind, TaskPriority, TaskState } from "@apx/protocol";
import type { Selectable } from "kysely";
import type { Bus } from "../bus.ts";
import type { TasksTable } from "../db/schema.ts";
import { badRequest } from "../errors.ts";
import { newId, now, opt, qb, type Sql } from "./sql.ts";
import type { Store } from "./store.ts";

export const DEFAULT_COLUMNS: TaskColumn[] = [
  { id: "backlog", label: "Backlog" },
  { id: "todo", label: "To do" },
  { id: "doing", label: "Doing" },
  { id: "review", label: "Review" },
];

/** The board's columns: the owner's, or the default ones when none are saved (or they do not read). */
export function columnsOf(store: Store): TaskColumn[] {
  try {
    const saved = JSON.parse(store.settings.get("task_columns") ?? "null") as TaskColumn[] | null;
    return Array.isArray(saved) && saved.length ? saved : DEFAULT_COLUMNS;
  } catch {
    return DEFAULT_COLUMNS;
  }
}

/**
 * A due date as a moment: a bare day ("2026-10-05") means 09:00 that day, local time; otherwise an ISO date-time.
 * Nothing ambiguous ("05/10/2026") or impossible ("2026-02-31") is accepted.
 */
export function dueOf(text: string | null | undefined): string | null {
  if (!text) return null;
  const v = text.trim();
  const day = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  let d: Date;
  if (day) {
    const [y, m, dd] = [Number(day[1]), Number(day[2]), Number(day[3])];
    d = new Date(y, m - 1, dd, 9);
    if (d.getMonth() !== m - 1 || d.getDate() !== dd) throw badRequest(`"${text}" is not a date`);
  } else if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v)) d = new Date(v);
  else throw badRequest(`"${text}" is not a date (use 2026-10-05 or an ISO date-time)`);
  const year = d.getFullYear();
  if (Number.isNaN(d.getTime()) || year < 2000 || year > 2200) throw badRequest(`"${text}" is not a date`);
  return d.toISOString();
}

/** Tags as typed, without repeats (any case). */
export const tagsOf = (tags: string[] | undefined) =>
  tags && [...new Map(tags.map((t) => [t.trim().toLowerCase(), t.trim()])).values()].filter(Boolean);

/** Tasks with the name of their commitment's person. */
const tasksQuery = () =>
  qb
    .selectFrom("tasks")
    .leftJoin("persons", "persons.id", "tasks.person_id")
    .selectAll("tasks")
    .select("persons.name as person_name");

const toTask = (r: Selectable<TasksTable> & { person_name: string | null }): Task => ({
  id: r.id,
  ...opt("project_id", r.project_id),
  title: r.title,
  description: r.description,
  status: r.status,
  state: r.state as TaskState,
  kind: r.kind as TaskKind,
  priority: r.priority as TaskPriority,
  tags: JSON.parse(r.tags) as string[],
  ...opt("assignee", r.assignee),
  ...opt("parent_id", r.parent_id),
  thread_id: r.thread_id,
  awaits_owner: Boolean(r.awaits_owner),
  ...opt("due_at", r.due_at),
  ...opt("remind_at", r.remind_at),
  // A person removed before this fix left an id behind: shown as no person, never as the id.
  ...(r.person_id && r.person_name
    ? {
        person_id: r.person_id,
        person_name: r.person_name,
        owed_by: (r.owed_by ?? "owner") as "owner" | "person",
      }
    : {}),
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
  project_id: string | null;
  kind: TaskKind;
  priority: TaskPriority;
  tags: string[];
  due_at: string | null;
  remind_at: string | null;
  awaits_owner: boolean;
  person_id: string | null;
  owed_by: "owner" | "person";
}>;

export function tasksRepo({ one, all, run }: Sql, bus: Bus) {
  const emit = (t: Task) => bus.emit({ type: "task.updated", task: t });
  const event = (taskId: string, op: TaskEvent["op"], by: string, data: Record<string, unknown> = {}) =>
    run(qb.insertInto("task_events").values({ task_id: taskId, at: now(), op, by, data: JSON.stringify(data) }));

  const repo = {
    get(id: string): Task | undefined {
      const r = one(tasksQuery().where("tasks.id", "=", id));
      return r ? toTask(r) : undefined;
    },
    byThread(threadId: string): Task | undefined {
      const r = one(tasksQuery().where("tasks.thread_id", "=", threadId));
      return r ? toTask(r) : undefined;
    },
    /** Newest activity first. `projects` limits to those projects (undefined in the list = tasks without one). */
    list(o: {
      projects?: Array<string | undefined>;
      state?: TaskState;
      assignee?: string;
      commitments?: boolean;
      person?: string;
      limit: number;
    }): Task[] {
      let q = tasksQuery();
      if (o.projects) {
        const ids = o.projects.filter((p): p is string => p !== undefined);
        const global = o.projects.includes(undefined);
        if (!ids.length && !global) return [];
        q = q.where((eb) =>
          eb.or([
            ...(ids.length ? [eb("tasks.project_id", "in", ids)] : []),
            ...(global ? [eb("tasks.project_id", "is", null)] : []),
          ]),
        );
      }
      if (o.state) q = q.where("tasks.state", "=", o.state);
      if (o.assignee) q = q.where("tasks.assignee", "=", o.assignee);
      if (o.commitments) q = q.where("tasks.person_id", "is not", null);
      if (o.person) q = q.where("tasks.person_id", "=", o.person);
      return all(q.orderBy("tasks.activity_at", "desc").limit(o.limit)).map(toTask);
    },
    create(t: {
      title: string;
      description?: string | undefined;
      project_id?: string | undefined;
      assignee?: string | undefined;
      status: string;
      parent_id?: string | undefined;
      due_at?: string | undefined;
      remind_at?: string | undefined;
      kind?: TaskKind | undefined;
      priority?: TaskPriority | undefined;
      tags?: string[] | undefined;
      person_id?: string | undefined;
      owed_by?: "owner" | "person" | undefined;
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
          remind_at: t.remind_at ?? null,
          kind: t.kind ?? (t.person_id ? "commitment" : "task"),
          priority: t.priority ?? "normal",
          tags: JSON.stringify(t.tags ?? []),
          person_id: t.person_id ?? null,
          owed_by: t.person_id ? (t.owed_by ?? "owner") : null,
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
            ...(c.project_id !== undefined ? { project_id: c.project_id } : {}),
            ...(c.kind !== undefined ? { kind: c.kind } : {}),
            ...(c.priority !== undefined ? { priority: c.priority } : {}),
            ...(c.tags !== undefined ? { tags: JSON.stringify(c.tags) } : {}),
            // A new date or reminder time is reminded again.
            ...(c.due_at !== undefined && c.due_at !== (cur.due_at ?? null)
              ? { due_at: c.due_at, reminded_at: null }
              : {}),
            ...(c.remind_at !== undefined && c.remind_at !== (cur.remind_at ?? null)
              ? { remind_at: c.remind_at, reminded_at: null }
              : {}),
            ...(c.person_id !== undefined
              ? { person_id: c.person_id, owed_by: c.person_id ? (c.owed_by ?? cur.owed_by ?? "owner") : null }
              : {}),
            ...(c.person_id === undefined && c.owed_by !== undefined && cur.person_id ? { owed_by: c.owed_by } : {}),
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
    /** Open tasks whose reminder (or, without one, whose date) has come and were not reminded yet; marks them. */
    remindDue(at: string): Task[] {
      const rows = all(
        tasksQuery()
          .where("tasks.state", "=", "open")
          .where("tasks.reminded_at", "is", null)
          .where((eb) =>
            eb.or([
              eb("tasks.remind_at", "<=", at),
              eb.and([eb("tasks.remind_at", "is", null), eb("tasks.due_at", "<=", at)]),
            ]),
          ),
      );
      if (rows.length)
        run(
          qb
            .updateTable("tasks")
            .set({ reminded_at: at })
            .where(
              "id",
              "in",
              rows.map((r) => r.id),
            ),
        );
      return rows.map(toTask);
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
