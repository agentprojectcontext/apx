import { ContinuationCondition } from "@apx/protocol";
import { z } from "zod";
import { defineTool, type Tool } from "./types.ts";

export function continuationTools(): Tool[] {
  return [
    defineTool({
      name: "chat_followup",
      description:
        "Return once to this same chat later: a timer (e.g. in ten minutes) or when an open task in this project is completed. No model runs while waiting. Set a bounded purpose, absolute time/event and expiry (at most seven days). Never substitute a task for an appliance event: if the source cannot be observed, explain that and offer a time. An event is not permission for side effects. List to identify a request before canceling; clarify ambiguity. Once started, cancellation cannot undo it.",
      args: z.object({
        action: z.enum(["create", "list", "cancel"]),
        purpose: z
          .string()
          .trim()
          .min(1)
          .max(2000)
          .optional()
          .describe("Only the specific follow-up requested; not the whole conversation"),
        condition: ContinuationCondition.optional(),
        expires_at: z.iso.datetime({ offset: true }).optional(),
        id: z.string().optional(),
      }),
      effect: "local",
      confirm: (a) => (a.action === "create" ? "always" : "never"),
      ownerSetting: (a) => a.action === "create",
      deadlineMs: 5000,
      title: (a) =>
        a.action === "create"
          ? "Scheduled a follow-up"
          : a.action === "cancel"
            ? "Canceled a follow-up"
            : "Looked at follow-ups",
      when: (thread) => ["home", "agent", "loose", "code", "channel"].includes(thread.kind),
      run: async (args, ctx) => {
        const thread = ctx.thread.id;
        if (args.action === "list") return JSON.stringify(await ctx.call("continuations.list", { thread }));
        if (args.action === "cancel") {
          if (!args.id) throw new Error("List the chat's follow-ups and choose one to cancel");
          return JSON.stringify(await ctx.call("continuations.cancel", { thread, id: args.id }));
        }
        if (!args.purpose || !args.condition || !args.expires_at)
          throw new Error("Supply the specific purpose, time or task-completion condition, and expiry");
        if (!ctx.callAsOwner) throw new Error("Scheduling requires the owner's approval");
        return JSON.stringify(
          await ctx.callAsOwner("continuations.create", {
            thread,
            purpose: args.purpose,
            condition: args.condition,
            expires_at: args.expires_at,
          }),
        );
      },
    }),
  ];
}
