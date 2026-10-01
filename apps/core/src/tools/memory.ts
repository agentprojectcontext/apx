// remember / recall / forget: an agent's notes between threads, through the memory.* methods like any client.
import { z } from "zod";
import { defineTool, type Tool } from "./types.ts";

const SCOPE = z
  .enum(["global", "project", "agent"])
  .describe(
    "global: about the owner (preferences, people, how they work), every agent sees it; project: about this thread's project; agent: your own notebook",
  );

const line = (m: { id: string; scope: string; source: string; text: string }) =>
  `- [${m.id}] (${m.scope}${m.source === "owner" ? ", by the owner" : ""}) ${m.text}`;

export function memoryTools(): Tool[] {
  return [
    defineTool({
      name: "remember",
      description:
        "Save a short, durable fact for later threads: a preference, a decision, a name, how something works. One fact per call, in plain words. Never passwords, keys or codes. Skip what is only true for this conversation. To correct a note, pass its id.",
      args: z.object({
        text: z.string().trim().min(3).max(600),
        scope: SCOPE.optional(),
        id: z.string().max(64).optional().describe("the id of one of your notes, to replace its text"),
      }),
      effect: "local",
      // A page or another agent could plant a "fact" that every later turn would read: ask the owner then.
      confirm: "untrusted",
      deadlineMs: 5_000,
      title: (a) => `Remembered: ${String(a.text ?? "").slice(0, 80)}`,
      async run(a, ctx) {
        const scope = a.scope ?? (ctx.thread.project_id ? "project" : "global");
        const m = await ctx.call("memory.add", { text: a.text, scope, ...(a.id ? { id: a.id } : {}) });
        return `saved as ${m.id} (${m.scope}).`;
      },
    }),
    defineTool({
      name: "recall",
      description:
        "Search your notes and the owner's (global, this project, your own) by words. Notes relevant to each message already appear in its [memory] block; use this to look for something specific.",
      args: z.object({ query: z.string().trim().min(2).max(300), limit: z.number().int().min(1).max(20).optional() }),
      effect: "none",
      deadlineMs: 5_000,
      title: (a) => `Searched memory for "${String(a.query ?? "").slice(0, 60)}"`,
      async run(a, ctx) {
        const { memories } = await ctx.call("memory.list", { query: a.query, limit: a.limit ?? 8 });
        return memories.length ? memories.map(line).join("\n") : "no notes match.";
      },
    }),
    defineTool({
      name: "forget",
      description: "Remove one of the notes agents saved, by id, when it is wrong or no longer true.",
      args: z.object({ id: z.string().min(1).max(64) }),
      effect: "local",
      confirm: "untrusted",
      deadlineMs: 5_000,
      title: (a) => `Forgot the note ${String(a.id ?? "")}`,
      async run(a, ctx) {
        const { removed } = await ctx.call("memory.remove", { id: a.id });
        return removed ? "removed." : "no such note.";
      },
    }),
  ];
}
