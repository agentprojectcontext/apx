// task_*: agents work the office board through the tasks.* methods, like the owner does in the app.
import { type Task, TaskKind, TaskPriority, TaskTag } from "@apx/protocol";
import { z } from "zod";
import type { Store } from "../domain/store.ts";
import {
  boardScope,
  checkAssignee,
  checkColumn,
  checkSettle,
  dueOf,
  personOf,
  taskProject,
  visibleTask,
} from "../domain/tasks.ts";
import { CallError } from "../errors.ts";
import { cap, fromTeam, inlineName, untrusted } from "./result.ts";
import { type CheckContext, defineTool, type Tool } from "./types.ts";

const line = (t: Task, project?: string) =>
  `- [${t.id}] ${t.title} (${[
    project ? `project ${project}` : "",
    t.state === "open" ? t.status : t.state,
    t.assignee,
    t.awaits_owner ? "waiting for the owner" : "",
    t.person_name
      ? t.owed_by === "person"
        ? `${inlineName(t.person_name)} owes it`
        : `owed to ${inlineName(t.person_name)}`
      : "",
    t.due_at ? `due ${t.due_at}` : "",
    t.outcome ?? "",
    t.renegotiated ? `date moved ${t.renegotiated}×` : "",
    // When it last moved: what "moved today" and "quiet for days" are read from.
    `last activity ${t.activity_at.slice(0, 16).replace("T", " ")}`,
  ]
    .filter(Boolean)
    .join(", ")})`;

/**
 * Whose words a task's title and description are: the owner's, one of the owner's agents' (the owner's side,
 * DECISIONS.md#d-071), or outside text (an agent passing on a contact's request: it has a person).
 */
export function taskSide(t: Pick<Task, "created_by" | "person_id">): "owner" | "team" | "outside" {
  if (t.created_by === "owner") return "owner";
  return t.person_id ? "outside" : "team";
}

/** A task's words as the model reads them, enveloped by whose they are. */
export function taskWords(t: Pick<Task, "created_by" | "person_id">, words: string): string {
  const side = taskSide(t);
  if (side === "owner") return words;
  return (side === "team" ? fromTeam : untrusted)("task", { created_by: t.created_by }, words);
}

/** Titles a contact's request brought are outside data, as in a task's own chat; the owner's and agents' are not. */
function taskLines(tasks: Task[], lineOf: (t: Task) => string): string {
  const text = tasks.map(lineOf).join("\n");
  if (tasks.every((t) => taskSide(t) !== "outside")) return text;
  return untrusted("tasks", { note: "some titles come from contacts" }, text);
}

/** Past this the result cap would cut the list in the middle: the tasks that matter stay whole, the rest is counted. */
const LIST_CHARS = 10_000;
const RECENT_MS = 48 * 3600_000;

/** What a brief reads line by line: a promise, a date due within a day or past, a wait on the owner, a recent move. */
const pressing = (t: Task, at: number) =>
  t.kind === "commitment" ||
  Boolean(t.person_id) ||
  t.awaits_owner ||
  (t.due_at !== undefined && Date.parse(t.due_at) - at < 86_400_000) ||
  at - Date.parse(t.activity_at) < RECENT_MS;

/** The tasks a list cannot show whole, per project: how many, in which columns, and since when they are quiet. */
function folded(tasks: Task[], where: (t: Task) => string | undefined): string {
  const lines = [...Map.groupBy(tasks, (t) => where(t) ?? "")].map(([project, ts]) => {
    const columns = [...Map.groupBy(ts, (t) => t.status)].map(([c, n]) => `${n.length} ${c}`).join(", ");
    const last = ts.map((t) => t.activity_at).sort();
    const day = (iso: string | undefined) => (iso ?? "").slice(0, 10);
    return `- ${project ? `project ${project}` : "this project"}: ${ts.length} (${columns}), last activity ${day(last.at(-1))}, quiet since ${day(last[0])}`;
  });
  return `${tasks.length} more not listed one by one (no promise, no date due within a day, not waiting for the owner, no move in 48 hours):\n${lines.join("\n")}`;
}

/** A task list for the model: every task on its line while it fits, else the pressing ones and the rest counted. */
export function boardText(tasks: Task[], where: (t: Task) => string | undefined, at = Date.now()): string {
  const lineOf = (t: Task) => line(t, where(t));
  const whole = taskLines(tasks, lineOf);
  const rest = tasks.filter((t) => !pressing(t, at));
  if (whole.length <= LIST_CHARS || !rest.length) return whole;
  const keep = tasks.filter((t) => pressing(t, at));
  return `${keep.length ? `${taskLines(keep, lineOf)}\n` : ""}${folded(rest, where)}`;
}

/**
 * Writing on the board is the owner's own record and runs even with outside content in the turn. Handing work to a
 * teammate (an assignee, an @mention) does too, like `delegate`: the turn it starts works in the mode of whoever
 * asked for it (DECISIONS.md#d-073, #d-106).
 */
const handsOff = "never" as const;

const commitmentArgs = {
  person: z.string().max(80).optional(),
  owed_by: z.enum(["owner", "person"]).optional(),
  due_at: z.string().max(40).optional(),
};

const shapeArgs = {
  kind: TaskKind.optional(),
  priority: TaskPriority.optional(),
  tags: z.array(TaskTag).max(12).optional(),
};

/** What the shared fields mean, told once on task_create: task_update takes them as they are. */
const ABOUT: Record<string, string> = {
  person: "a commitment's contact",
  owed_by: 'who promised it: "owner" (default) or "person"',
  due_at: "2026-10-05 or an ISO moment",
  kind: '"commitment": owed to or by a person; "errand": small, on the way',
  priority: "default normal",
  tags: "short labels (client, area…)",
};
const described = <T extends Record<string, z.ZodType>>(fields: T): T =>
  Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, ABOUT[k] ? v.describe(ABOUT[k]) : v])) as T;

/** One argument's check, as the methods run it; a failure names the argument ("assignee: agent x not found"). */
function field<T>(name: string, check: () => T): T {
  try {
    return check();
  } catch (err) {
    if (!(err instanceof CallError) || err.shape.message.startsWith(`${name} `)) throw err;
    throw new CallError({ ...err.shape, message: `${name}: ${err.shape.message}` });
  }
}

const UNSPECIFIED = "It has not started: add a non-empty description with task_update to start the assigned agent.";

/** What an agent is told when the task it gave waits for the owner: this chat's chain is paused (DECISIONS.md#d-082). */
const PAUSED = (who: string) =>
  `It has not started: agents here reached the owner's limit for working on their own, so ${who} starts on it once the owner lets them go on (they were told). Do not assign it again.`;

export function taskTools(store: Store): Tool[] {
  /** Whether this chat keeps the task's start until the owner lets agents go on. */
  const waits = (task: string, ctx: CheckContext) =>
    Boolean(store.threads.context(ctx.thread.id).held?.some((h) => h.task === task));
  const scopeOf = (ctx: CheckContext) => boardScope(store, { id: ctx.agent.id, thread_id: ctx.thread.id });
  const taskOf = (id: string, ctx: CheckContext) => field("task", () => visibleTask(store, id, scopeOf(ctx)));
  /** What a new task or a change names besides the task: a real column, assignee and person, a date that reads. */
  const checkNamed = (
    a: { status?: string | undefined; assignee?: string | null | undefined; person?: string | undefined },
    due: string | undefined,
    project: string | undefined,
  ) => {
    field("status", () => checkColumn(store, a.status));
    field("assignee", () => checkAssignee(store, a.assignee, project));
    const person = a.person;
    if (person) field("person", () => personOf(store, person));
    field("due_at", () => dueOf(due));
  };
  return [
    defineTool({
      name: "task_get",
      description:
        "Read task details, history, sessions, consults, subtasks, usage and recent comments with saved evidence.",
      args: z.object({ task: z.string().min(1).max(64) }),
      effect: "none",
      deadlineMs: 5_000,
      title: () => "Read a task",
      async run(a, ctx) {
        const r = await ctx.call("tasks.get", { task: a.task });
        const section = (name: string, data: unknown, budget: number) =>
          `${name}:\n${cap(JSON.stringify(data), budget)}`;
        const chat = (t: (typeof r.sessions)[number]) => ({
          id: t.id,
          title: t.title,
          agent_ids: t.agent_ids,
          state: t.state,
        });
        return untrusted(
          "task_detail",
          {},
          [
            section("Task", r.task, 2_000),
            section("History", r.events, 1_800),
            section("Sessions", r.sessions.map(chat), 600),
            section("Consults", r.consults.map(chat), 600),
            section("Subtasks", r.subtasks, 900),
            section("Usage", r.usage, 400),
            section(
              `Comments (latest ${r.comments.length}${r.comments_truncated ? "; older messages omitted" : ""})`,
              r.comments.map(({ id, author, created_at, parts }) => ({ id, author, created_at, parts })),
              4_000,
            ),
          ].join("\n\n"),
        );
      },
    }),
    defineTool({
      name: "task_list",
      description:
        "List this project's tasks by newest activity (default open), with ids, columns and commitments. The global super-agent sees all projects.",
      args: z.object({
        mine: z.boolean().optional(),
        state: z.enum(["open", "done", "dropped"]).optional(),
        commitments: z.boolean().optional().describe("Only commitments (tasks with a person on the other side)."),
        limit: z.number().int().min(1).max(200).optional().describe("At most this many (default 200)."),
      }),
      effect: "none",
      deadlineMs: 5_000,
      title: () => "Looked at the tasks",
      async run(a, ctx) {
        const r = await ctx.call("tasks.list", {
          ...(a.state ? { state: a.state } : {}),
          ...(a.mine ? { assignee: ctx.agent.id } : {}),
          ...(a.commitments ? { commitments: true } : {}),
          ...(a.limit ? { limit: a.limit } : {}),
        });
        const cols = `columns: ${r.columns.map((c) => c.id).join(", ")}`;
        // Tasks from more than one place: each says which project it is in (by name, as the owner calls it).
        const many = new Set(r.tasks.map((t) => t.project_id ?? "")).size > 1;
        const listed = many ? await ctx.call("projects.list", {}) : undefined;
        const names = new Map(listed?.projects.map((p) => [p.id, p.name]));
        const where = (t: Task) =>
          listed ? (t.project_id ? (names.get(t.project_id) ?? t.project_id) : listed.base.name) : undefined;
        if (r.tasks.length) return `${boardText(r.tasks, where)}\n${cols}`;
        // An empty filtered list is not an empty board: say what was asked and what else is open.
        const scope = [a.state ?? "open", a.mine ? "assigned to you" : "", a.commitments ? "commitments" : ""];
        const empty = `no tasks (${scope.filter(Boolean).join(", ")}).`;
        if (!a.mine && !a.commitments && (a.state ?? "open") === "open") return `${empty} ${cols}`;
        const open = (await ctx.call("tasks.list", {})).tasks;
        const by = Map.groupBy(open, (t) => t.status);
        const spread = [...by].map(([status, ts]) => `${ts.length} ${status}`).join(", ");
        return `${empty} The board has ${open.length} open${open.length ? ` (${spread})` : ""}; task_list with no filters lists them. ${cols}`;
      },
    }),
    defineTool({
      name: "task_create",
      description:
        "Create a task, with an assignee and a description so it starts (subtasks too). Your role's own work: create it; reviews, QA or another area's work: propose it. A delegate proposes to its caller; a global agent's task goes to the assignee's project. A promise: person, owed_by, due_at.",
      args: z.object({
        title: z.string().trim().min(3).max(200),
        description: z.string().max(5000).optional(),
        assignee: z.string().max(80).optional(),
        project: z.string().min(1).max(80).optional().describe("project id; super-agent only"),
        status: z.string().max(40).optional(),
        ...described(shapeArgs),
        ...described(commitmentArgs),
        start_at: z.string().max(40).optional().describe("work begins"),
        propose: z.boolean().optional().describe("a chip the owner accepts before work starts"),
      }),
      effect: "local",
      confirm: handsOff,
      check: (a, ctx) => checkNamed(a, a.due_at, taskProject(store, { id: ctx.agent.id, thread_id: ctx.thread.id }, a)),
      deadlineMs: 5_000,
      title: (a) => `Created the task ${String(a.title ?? "").slice(0, 60)}`,
      async run(a, ctx) {
        const t = await ctx.call("tasks.create", a);
        const under = t.parent_id ? `, a subtask of ${t.parent_id}` : "";
        if (t.proposed)
          return `proposed ${t.id}${under}: it starts when the owner accepts it. Tell them what you proposed and why, in one line each.`;
        // A task with nobody on it never starts: say so while the agent can still fix it.
        if (!t.assignee && t.kind === "task")
          return `created ${t.id} in ${t.status}${under}, with nobody on it: it will not start. Assign it with task_update (the agent who does it, or yourself), or ask the owner who should.`;
        if (t.assignee && !t.description.trim()) return `created ${t.id} in ${t.status}${under}. ${UNSPECIFIED}`;
        // Its close reports back to this chat (DECISIONS.md#d-076): no need to watch the board for it.
        const back =
          t.assignee !== ctx.agent.id && ctx.thread.kind !== "a2a"
            ? " When they close it, their report comes here."
            : "";
        if (t.assignee && waits(t.id, ctx)) return `created ${t.id} in ${t.status}${under}. ${PAUSED(t.assignee)}`;
        return `created ${t.id} in ${t.status}${under}.${t.assignee ? ` ${t.assignee} starts on it ${t.start_at && t.start_at > new Date().toISOString() ? `at ${t.start_at}` : "now"}.${back}` : ""}`;
      },
    }),
    defineTool({
      name: "task_update",
      description:
        "Update a task's fields (they mean what task_create's do); assignee:null unassigns it. Finish or drop with task_close.",
      args: z.object({
        task: z.string().min(1).max(64),
        status: z.string().max(40).optional(),
        assignee: z.string().max(80).nullable().optional(),
        title: z.string().trim().min(3).max(200).optional(),
        description: z.string().max(5000).optional(),
        awaits_owner: z.boolean().optional(),
        reviewer: z.string().max(80).optional().describe('"owner" or agent'),
        plan: z.string().max(4000).optional().describe("the steps, marked done as you go; replaces the last"),
        ...shapeArgs,
        ...commitmentArgs,
      }),
      effect: "local",
      confirm: handsOff,
      check: (a, ctx) => checkNamed(a, a.due_at, taskOf(a.task, ctx).project_id),
      deadlineMs: 5_000,
      title: (a) => `Updated the task ${String(a.task ?? "")}`,
      async run({ task, ...c }, ctx) {
        const t = await ctx.call("tasks.update", { task, ...c });
        const pending = t.assignee && !t.description.trim() && t.chats === 0 ? ` ${UNSPECIFIED}` : "";
        const paused = !pending && t.assignee && waits(t.id, ctx) ? ` ${PAUSED(t.assignee)}` : "";
        return `updated: ${taskLines([t], (x) => line(x))}${pending}${paused}`;
      },
    }),
    defineTool({
      name: "task_comment",
      description:
        "Comment on a task's conversation. @owner requests the owner's attention (their reply clears it); @agent asks that teammate here and its answer comes back to you.",
      args: z.object({ task: z.string().min(1).max(64), text: z.string().trim().min(1).max(5000) }),
      effect: "local",
      confirm: handsOff,
      check: (a, ctx) => void taskOf(a.task, ctx),
      deadlineMs: 5_000,
      title: (a) => `Commented on ${String(a.task ?? "")}`,
      async run(a, ctx) {
        const r = await ctx.call("tasks.comment", a);
        return r.runs.length
          ? `commented; ${r.runs.length} agent(s) will answer there, and the answer comes back to you: do not wait for it.`
          : "commented.";
      },
    }),
    defineTool({
      name: "task_close",
      description: "Close a task, or reopen it. Request corrections with state:open, rework:true and a note.",
      args: z.object({
        task: z.string().min(1).max(64),
        state: z.enum(["done", "dropped", "open"]),
        note: z.string().max(2000).optional(),
        rework: z.boolean().optional(),
      }),
      effect: "local",
      check: (a, ctx) => void taskOf(a.task, ctx),
      deadlineMs: 5_000,
      title: (a) => `Marked ${String(a.task ?? "")} ${String(a.state ?? "")}`,
      async run(a, ctx) {
        const t = await ctx.call("tasks.close", a);
        return `now ${t.state}.`;
      },
    }),
    defineTool({
      name: "commitment_settle",
      description:
        "Record how a commitment went, as the owner said it: kept, missed, dropped (released by agreement) or renegotiated (a new date agreed with the person: give due_at). Never decide it yourself.",
      args: z.object({
        task: z.string().min(1).max(64),
        outcome: z.enum(["kept", "missed", "dropped", "renegotiated"]),
        due_at: z.string().max(40).optional().describe("Renegotiated: the new date (2026-10-05 or ISO)."),
        note: z.string().max(2000).optional(),
      }),
      effect: "local",
      check: (a, ctx) => checkSettle(taskOf(a.task, ctx), a.outcome, a.due_at),
      deadlineMs: 5_000,
      title: (a) => `Marked ${String(a.task ?? "")} ${String(a.outcome ?? "")}`,
      async run(a, ctx) {
        const t = await ctx.call("tasks.settle", a);
        return t.state === "open" ? `still open, now due ${t.due_at ?? "?"}.` : `closed: ${t.outcome ?? t.state}.`;
      },
    }),
  ];
}
