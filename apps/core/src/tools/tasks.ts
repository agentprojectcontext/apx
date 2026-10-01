// task_*: agents work the office board through the tasks.* methods, like the owner does in the app.
import { z } from "zod";
import { defineTool, type Tool } from "./types.ts";

const line = (t: {
  id: string;
  title: string;
  status: string;
  state: string;
  assignee?: string;
  awaits_owner: boolean;
}) =>
  `- [${t.id}] ${t.title} (${t.state === "open" ? t.status : t.state}${t.assignee ? `, ${t.assignee}` : ""}${t.awaits_owner ? ", waiting for the owner" : ""})`;

export function taskTools(): Tool[] {
  return [
    defineTool({
      name: "task_list",
      description: "List the open tasks of this project (or yours only, or closed ones), with their ids and columns.",
      args: z.object({ mine: z.boolean().optional(), state: z.enum(["open", "done", "dropped"]).optional() }),
      effect: "none",
      deadlineMs: 5_000,
      title: () => "Looked at the tasks",
      async run(a, ctx) {
        const r = await ctx.call("tasks.list", {
          ...(a.state ? { state: a.state } : {}),
          ...(a.mine ? { assignee: ctx.agent.id } : {}),
        });
        const cols = `columns: ${r.columns.map((c) => c.id).join(", ")}`;
        return r.tasks.length ? `${r.tasks.map(line).join("\n")}\n${cols}` : `no tasks. ${cols}`;
      },
    }),
    defineTool({
      name: "task_create",
      description:
        "Create a task in this project's board: a clear title, what done looks like in the description, and who does it (an agent id) if you know.",
      args: z.object({
        title: z.string().trim().min(3).max(200),
        description: z.string().max(5000).optional(),
        assignee: z.string().max(80).optional(),
        status: z.string().max(40).optional(),
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
        "Change a task: move it to another column (status), assign it (an agent id, or null), retitle it, or mark that it waits for the owner.",
      args: z.object({
        task: z.string().min(1).max(64),
        status: z.string().max(40).optional(),
        assignee: z.string().max(80).nullable().optional(),
        title: z.string().trim().min(3).max(200).optional(),
        description: z.string().max(5000).optional(),
        awaits_owner: z.boolean().optional(),
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
