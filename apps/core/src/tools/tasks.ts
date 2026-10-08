// task_*: agents work the office board through the tasks.* methods, like the owner does in the app.
import { type Task, TaskKind, TaskPriority, TaskTag } from "@apx/protocol";
import { z } from "zod";
import { defineTool, type Tool } from "./types.ts";

const line = (t: Task, project?: string) =>
  `- [${t.id}] ${t.title} (${[
    project ? `project ${project}` : "",
    t.state === "open" ? t.status : t.state,
    t.assignee,
    t.awaits_owner ? "waiting for the owner" : "",
    t.person_name ? (t.owed_by === "person" ? `${t.person_name} owes it` : `owed to ${t.person_name}`) : "",
    t.due_at ? `due ${t.due_at}` : "",
    t.outcome ?? "",
    t.renegotiated ? `date moved ${t.renegotiated}×` : "",
    // When it last moved: what "moved today" and "quiet for days" are read from.
    `last activity ${t.activity_at.slice(0, 16).replace("T", " ")}`,
  ]
    .filter(Boolean)
    .join(", ")})`;

/**
 * Writing on the board is the owner's own record and runs even with outside content in the turn; handing the work to
 * an agent (an assignee, an @mention) starts that agent's turn, so then it waits for the owner like any other action.
 */
const handsOff = (a: { assignee?: string | null | undefined; text?: string | undefined }) =>
  (a.assignee ? "untrusted" : a.text && /(^|\s)@[\w-]/.test(a.text) ? "untrusted" : "never") as "untrusted" | "never";

const commitmentArgs = {
  person: z.string().max(80).optional().describe("a commitment's contact (name or id)"),
  owed_by: z.enum(["owner", "person"]).optional().describe('who promised it: "owner" (default) or "person"'),
  due_at: z.string().max(40).optional().describe("a day (2026-10-05) or a moment (ISO)"),
};

const shapeArgs = {
  kind: TaskKind.optional().describe(
    '"commitment" has a person on the other side; "errand" is something small to do on the way.',
  ),
  priority: TaskPriority.optional().describe("default normal"),
  tags: z.array(TaskTag).max(12).optional().describe("short labels (client, area…)"),
};

export function taskTools(): Tool[] {
  return [
    defineTool({
      name: "task_list",
      description:
        'List the open tasks of this project (or yours only, or closed ones), newest activity first, with their ids, columns, project and when each last moved. Outside any project the super-agent sees every project\'s board. Commitments show who is owed ("owed to …" / "… owes it").',
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
        if (r.tasks.length) return `${r.tasks.map((t) => line(t, where(t))).join("\n")}\n${cols}`;
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
        "Create a task on this project's board: a clear title, what done looks like (description) and who does it (assignee: an agent id). A promise between the owner and a contact is a commitment: give the person, who owes it and the due date; the owner is reminded that day.",
      args: z.object({
        title: z.string().trim().min(3).max(200),
        description: z.string().max(5000).optional(),
        assignee: z.string().max(80).optional(),
        status: z.string().max(40).optional(),
        ...shapeArgs,
        ...commitmentArgs,
      }),
      effect: "local",
      confirm: handsOff,
      deadlineMs: 5_000,
      title: (a) => `Created the task ${String(a.title ?? "").slice(0, 60)}`,
      async run(a, ctx) {
        const t = await ctx.call("tasks.create", a);
        return `created ${t.id} in ${t.status}.`;
      },
    }),
    defineTool({
      name: "task_update",
      description:
        "Change a task: its column (status), who does it (assignee; null for nobody), title, description, whether it waits for the owner, or a commitment's person, who owes it and due date. To finish or drop it, use task_close.",
      args: z.object({
        task: z.string().min(1).max(64),
        status: z.string().max(40).optional(),
        assignee: z.string().max(80).nullable().optional(),
        title: z.string().trim().min(3).max(200).optional(),
        description: z.string().max(5000).optional(),
        awaits_owner: z.boolean().optional(),
        ...shapeArgs,
        ...commitmentArgs,
      }),
      effect: "local",
      confirm: handsOff,
      deadlineMs: 5_000,
      title: (a) => `Updated the task ${String(a.task ?? "")}`,
      async run({ task, ...c }, ctx) {
        const t = await ctx.call("tasks.update", { task, ...c });
        return `updated: ${line(t)}`;
      },
    }),
    defineTool({
      name: "task_comment",
      description:
        "Comment on a task's conversation. Mention an agent with @name to ask it something there: it answers in that conversation. Mention @owner to request the owner's attention; their reply clears the request.",
      args: z.object({ task: z.string().min(1).max(64), text: z.string().trim().min(1).max(5000) }),
      effect: "local",
      confirm: handsOff,
      deadlineMs: 5_000,
      title: (a) => `Commented on ${String(a.task ?? "")}`,
      async run(a, ctx) {
        const r = await ctx.call("tasks.comment", a);
        return r.runs.length ? `commented; ${r.runs.length} agent(s) will answer there.` : "commented.";
      },
    }),
    defineTool({
      name: "task_close",
      description: "Close a task as done (or dropped, saying why), or open it again.",
      args: z.object({
        task: z.string().min(1).max(64),
        state: z.enum(["done", "dropped", "open"]),
        note: z.string().max(2000).optional(),
      }),
      effect: "local",
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
      deadlineMs: 5_000,
      title: (a) => `Marked ${String(a.task ?? "")} ${String(a.outcome ?? "")}`,
      async run(a, ctx) {
        const t = await ctx.call("tasks.settle", a);
        return t.state === "open" ? `still open, now due ${t.due_at ?? "?"}.` : `closed: ${t.outcome ?? t.state}.`;
      },
    }),
  ];
}
