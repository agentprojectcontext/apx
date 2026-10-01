// task_*: agents work the office board through the tasks.* methods, like the owner does in the app.
import type { Task } from "@apx/protocol";
import { z } from "zod";
import { defineTool, type Tool } from "./types.ts";

const line = (t: Task) =>
  `- [${t.id}] ${t.title} (${[
    t.state === "open" ? t.status : t.state,
    t.assignee,
    t.awaits_owner ? "waiting for the owner" : "",
    t.person_name ? (t.owed_by === "person" ? `${t.person_name} owes it` : `owed to ${t.person_name}`) : "",
    t.due_at ? `due ${t.due_at}` : "",
  ]
    .filter(Boolean)
    .join(", ")})`;

const commitmentArgs = {
  person: z.string().max(80).optional().describe("A commitment: the contact on the other side (name or id)."),
  owed_by: z
    .enum(["owner", "person"])
    .optional()
    .describe('"owner" if the owner promised it to the person (default), "person" if the person owes it to the owner.'),
  due_at: z.string().max(40).optional().describe("When it is due: a day (2026-10-05) or a moment (ISO)."),
};

export function taskTools(): Tool[] {
  return [
    defineTool({
      name: "task_list",
      description: "List the open tasks of this project (or yours only, or closed ones), with their ids and columns.",
      args: z.object({
        mine: z.boolean().optional(),
        state: z.enum(["open", "done", "dropped"]).optional(),
        commitments: z.boolean().optional().describe("Only commitments (tasks with a person on the other side)."),
      }),
      effect: "none",
      deadlineMs: 5_000,
      title: () => "Looked at the tasks",
      async run(a, ctx) {
        const r = await ctx.call("tasks.list", {
          ...(a.state ? { state: a.state } : {}),
          ...(a.mine ? { assignee: ctx.agent.id } : {}),
          ...(a.commitments ? { commitments: true } : {}),
        });
        const cols = `columns: ${r.columns.map((c) => c.id).join(", ")}`;
        return r.tasks.length ? `${r.tasks.map(line).join("\n")}\n${cols}` : `no tasks. ${cols}`;
      },
    }),
    defineTool({
      name: "task_create",
      description:
        "Create a task in this project's board: a clear title, what done looks like in the description, and who does it (an agent id) if you know. A promise between the owner and a contact is a commitment: give the person, who owes it and when it is due; the owner is reminded on that day.",
      args: z.object({
        title: z.string().trim().min(3).max(200),
        description: z.string().max(5000).optional(),
        assignee: z.string().max(80).optional(),
        status: z.string().max(40).optional(),
        ...commitmentArgs,
      }),
      effect: "local",
      confirm: "untrusted",
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
        "Change a task: move it to another column (status), assign it (an agent id, or null), retitle it, mark that it waits for the owner, or set its person, who owes it and its due date.",
      args: z.object({
        task: z.string().min(1).max(64),
        status: z.string().max(40).optional(),
        assignee: z.string().max(80).nullable().optional(),
        title: z.string().trim().min(3).max(200).optional(),
        description: z.string().max(5000).optional(),
        awaits_owner: z.boolean().optional(),
        ...commitmentArgs,
      }),
      effect: "local",
      confirm: "untrusted",
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
        "Comment on a task's conversation. Mention an agent with @name to ask it something there: it answers in that conversation.",
      args: z.object({ task: z.string().min(1).max(64), text: z.string().trim().min(1).max(5000) }),
      effect: "local",
      confirm: "untrusted",
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
      confirm: "untrusted",
      deadlineMs: 5_000,
      title: (a) => `Marked ${String(a.task ?? "")} ${String(a.state ?? "")}`,
      async run(a, ctx) {
        const t = await ctx.call("tasks.close", a);
        return `now ${t.state}.`;
      },
    }),
  ];
}
