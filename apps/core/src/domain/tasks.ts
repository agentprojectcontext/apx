// Tasks: the row is the task as it is now; every change is also an event, so its history can be told. The board's
// columns are a setting; "done" and "dropped" are states, never columns.
import type { CommitmentOutcome, Task, TaskColumn, TaskEvent, TaskKind, TaskPriority, TaskState } from "@apx/protocol";
import type { Selectable } from "kysely";
import { sql as raw } from "kysely";
import type { Bus } from "../bus.ts";
import type { TasksTable } from "../db/schema.ts";
import { badRequest, notFound, unauthorized } from "../errors.ts";
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
  return store.settings.read("task_columns");
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

// The checks a task call must pass, in one place: the methods run them, and the task tools run them before the owner
// is asked, so nobody approves a call that could only fail.

/**
 * Where a caller works on the board: undefined is all of it (the owner, or the super-agent outside any project);
 * any other agent works on its chat's project and the global tasks.
 */
export function boardScope(
  store: Store,
  agent: { id: string; thread_id: string } | undefined,
): { project: string | undefined } | undefined {
  if (!agent) return undefined;
  const project = store.threads.get(agent.thread_id)?.project_id;
  if (!project && store.agents.get(agent.id)?.kind === "secretary") return undefined;
  return { project };
}

/** New tasks stay in the caller's scope; the global super-agent may use the assignee's project by default. */
export function taskProject(
  store: Store,
  agent: { id: string; thread_id: string } | undefined,
  request: { project?: string | undefined; assignee?: string | undefined },
): string | undefined {
  const scope = boardScope(store, agent);
  if (scope) {
    if (request.project !== undefined && request.project !== scope.project)
      throw unauthorized("an agent creates tasks only in its own project");
    return scope.project;
  }
  return request.project ?? (agent && request.assignee ? store.agents.get(request.assignee)?.project_id : undefined);
}

/** A task the caller may see and change. */
export function visibleTask(store: Store, id: string, scope: { project: string | undefined } | undefined): Task {
  const t = store.tasks.get(id);
  if (!t) throw notFound(`task ${id}`);
  if (scope && t.project_id && t.project_id !== scope.project)
    throw unauthorized("an agent works only on its own project's tasks");
  return t;
}

/** A column the board has. */
export function checkColumn(store: Store, status: string | undefined): void {
  const columns = columnsOf(store);
  if (status && !columns.some((c) => c.id === status))
    throw badRequest(`no column "${status}" (columns: ${columns.map((c) => c.id).join(", ")})`);
}

/** An assignee must exist and belong to the task's project (or to none). */
export function checkAssignee(store: Store, id: string | null | undefined, project: string | undefined): void {
  if (!id) return;
  const a = store.agents.get(id);
  if (!a) throw notFound(`agent ${id}`);
  if (a.project_id && a.project_id !== project) throw badRequest(`${a.name} works in another project`);
}

/** A person by id or exact name (any case); never the owner or a blocked person, never a guess between two. */
export function personOf(store: Store, ref: string): string {
  const key = ref.trim().toLowerCase();
  const byId = store.persons.get(ref);
  const named = byId ? [byId] : store.persons.list().filter((x) => x.name.toLowerCase() === key);
  if (named.length > 1) throw badRequest(`${named.length} contacts are called ${ref}; use the id`);
  const p = named[0];
  if (!p) throw notFound(`person ${ref} (add them to your contacts first)`);
  if (p.role === "owner") throw badRequest("a commitment is with someone else, not with the owner");
  if (p.role === "blocked") throw badRequest(`${p.name} is blocked`);
  return p.id;
}

/** Whether a commitment can be settled that way. */
export function checkSettle(t: Task, outcome: CommitmentOutcome | "renegotiated", due_at: string | undefined): void {
  if (t.kind !== "commitment") throw badRequest("only a commitment is kept, missed or renegotiated");
  if (outcome !== "renegotiated") return;
  if (!due_at) throw badRequest("a renegotiated commitment needs its new date (due_at)");
  if (t.state !== "open") throw badRequest("reopen it first: a closed commitment has no date to move");
  dueOf(due_at);
}

/** Tasks with the name of their commitment's person. */
const tasksQuery = () =>
  qb
    .selectFrom("tasks")
    .leftJoin("persons", "persons.id", "tasks.person_id")
    .selectAll("tasks")
    .select("persons.name as person_name")
    // The chats its agents worked it in (task-work.ts).
    .select((eb) =>
      eb
        .selectFrom("threads")
        .whereRef("threads.task_id", "=", "tasks.id")
        .select((c) => c.fn.countAll<number>().as("n"))
        .as("chats"),
    );

const toTask = (r: Selectable<TasksTable> & { person_name: string | null; chats: number | null }): Task => ({
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
  ...opt("start_at", r.start_at),
  ...opt("reviewer", r.reviewer),
  ...opt("plan", r.plan),
  ...(r.proposed ? { proposed: true } : {}),
  // A person removed before this fix left an id behind: shown as no person, never as the id.
  ...(r.person_id && r.person_name
    ? {
        person_id: r.person_id,
        person_name: r.person_name,
        owed_by: (r.owed_by ?? "owner") as "owner" | "person",
      }
    : {}),
  ...(r.outcome === "kept" || r.outcome === "missed" || r.outcome === "dropped" ? { outcome: r.outcome } : {}),
  renegotiated: r.renegotiated,
  chats: Number(r.chats ?? 0),
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
  start_at: string | null;
  reviewer: string | null;
  plan: string | null;
  proposed: boolean;
  awaits_owner: boolean;
  person_id: string | null;
  owed_by: "owner" | "person";
  outcome: CommitmentOutcome | null;
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
    /** Whether a task of this kind and title is in the project (or in none), in any state. */
    has(o: { kind: TaskKind; project_id: string | undefined; title: string }): boolean {
      const q = qb.selectFrom("tasks").select("id").where("kind", "=", o.kind).where("title", "=", o.title);
      const scoped =
        o.project_id === undefined ? q.where("project_id", "is", null) : q.where("project_id", "=", o.project_id);
      return Boolean(one(scoped.limit(1)));
    },
    /** Newest activity first. `projects` limits to those projects (undefined in the list = tasks without one). */
    list(o: {
      projects?: Array<string | undefined>;
      state?: TaskState;
      assignee?: string;
      commitments?: boolean;
      person?: string;
      parent?: string;
      from_thread?: string;
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
      if (o.parent) q = q.where("tasks.parent_id", "=", o.parent);
      if (o.from_thread)
        q = q.where((eb) =>
          eb.exists(
            eb
              .selectFrom("task_events")
              .select("task_id")
              .whereRef("task_events.task_id", "=", "tasks.id")
              .where("op", "=", "create")
              .where(raw<string>`json_extract(task_events.data, '$.from_thread')`, "=", o.from_thread as string),
          ),
        );
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
      start_at?: string | undefined;
      /** An agent's proposal: nothing starts until the owner accepts it. */
      proposed?: boolean | undefined;
      /** Already reminded (an import: what was due before it arrived is not news). */
      reminded_at?: string | undefined;
      kind?: TaskKind | undefined;
      priority?: TaskPriority | undefined;
      tags?: string[] | undefined;
      person_id?: string | undefined;
      owed_by?: "owner" | "person" | undefined;
      thread_id: string;
      by: string;
      /** An agent's chat and turn it was created in: its close reports back there. */
      from?: { thread: string; run: string } | undefined;
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
          start_at: t.start_at ?? null,
          proposed: t.proposed ? 1 : 0,
          reminded_at: t.reminded_at ?? null,
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
      event(id, "create", t.by, {
        title: t.title,
        status: t.status,
        ...(t.proposed ? { proposed: true } : {}),
        ...(t.assignee ? { assignee: t.assignee } : {}),
        ...(t.from ? { from_thread: t.from.thread, from_run: t.from.run } : {}),
      });
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
            // Open again, a commitment has no outcome yet.
            ...(c.outcome !== undefined ? { outcome: c.outcome } : c.state === "open" ? { outcome: null } : {}),
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
            ...(c.start_at !== undefined ? { start_at: c.start_at } : {}),
            ...(c.reviewer !== undefined ? { reviewer: c.reviewer } : {}),
            ...(c.plan !== undefined ? { plan: c.plan } : {}),
            ...(c.proposed !== undefined ? { proposed: c.proposed ? 1 : 0 } : {}),
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
    /** A commitment's date moved by agreement: a new date, reminded again, counted and recorded as its own event. */
    renegotiate(id: string, dueAt: string, by: string, note?: string): Task | undefined {
      const cur = repo.get(id);
      if (!cur) return undefined;
      const at = now();
      run(
        qb
          .updateTable("tasks")
          .set((eb) => ({
            due_at: dueAt,
            remind_at: null,
            reminded_at: null,
            renegotiated: eb("renegotiated", "+", 1),
            updated_at: at,
            activity_at: at,
          }))
          .where("id", "=", id),
      );
      event(id, "renegotiate", by, { from: cur.due_at ?? null, to: dueAt, ...(note ? { note } : {}) });
      const task = repo.get(id) as Task;
      emit(task);
      return task;
    },
    /** Links a correction request to the durable turn that will work on it. */
    reworkStarted(id: string, by: string, runId: string, threadId: string): void {
      event(id, "update", by, { rework_run_id: runId, rework_thread_id: threadId });
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
    /**
     * Deletes the task and its history (its conversation goes with `threads.remove`). Subtasks stay as tasks of their
     * own, and the agents' chats that worked it stay, no longer naming it.
     */
    remove(id: string): void {
      run(qb.updateTable("tasks").set({ parent_id: null }).where("parent_id", "=", id));
      run(qb.updateTable("threads").set({ task_id: null }).where("task_id", "=", id));
      run(qb.deleteFrom("task_events").where("task_id", "=", id));
      run(qb.deleteFrom("tasks").where("id", "=", id));
      bus.emit({ type: "task.deleted", task_id: id });
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
