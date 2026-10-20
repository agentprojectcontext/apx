// remember / recall / forget: an agent's notes between threads, through the memory.* methods like any client.
import type { Memory } from "@apx/protocol";
import { z } from "zod";
import { untrusted } from "./result.ts";
import { defineTool, type Tool } from "./types.ts";

const SCOPE = z
  .enum(["global", "project", "agent"])
  .describe(
    "global: about the owner (preferences, people, how they work), every agent sees it; project: about this thread's project; agent: your own notebook",
  );

export const MEMORY_BLOCK_CHARS = 2400;

const line = (m: Memory) =>
  `- [${m.id}] (${m.scope}${m.source === "owner" ? ", by the owner" : m.pending ? ", not confirmed by the owner" : ""}; updated ${m.updated_at}) ${m.text.replace(/\s+/g, " ")}`;

/**
 * Notes as the model reads them, capped. A note saved while outside content was in the turn is wrapped as untrusted,
 * so it counts as outside content again wherever it shows up.
 */
/** One line per note for the index: what it is about, not all it says (recall brings the rest). */
export function hookLine(m: Memory): string {
  const first = m.text.split("\n")[0] ?? "";
  const asked = m.kind === "procedure" ? /asked: "(.*)"$/.exec(first)?.[1] : undefined;
  const steps = m.kind === "procedure" ? [...(m.text.split("\n")[1] ?? "").matchAll(/`([^`]+)`/g)].slice(0, 2) : [];
  // A procedure's hook leads with what it used (a site by its host), then what the owner asked.
  const used = steps.map((s) => (s[1] ?? "").replace(/^https?:\/\/([^/]+).*$/, "$1")).join(" ");
  const about = asked ? `${used} for "${asked}"` : first;
  const hook = about.replace(/\s+/g, " ").trim();
  return `- [${m.id}] (${m.kind ?? "note"}, ${m.updated_at.slice(0, 10)}) ${hook.length > 96 ? `${hook.slice(0, 95)}…` : hook}`;
}

export function notesText(
  notes: Memory[],
  max = MEMORY_BLOCK_CHARS,
  format: (m: Memory) => string = line,
): { text?: string; ids: string[] } {
  const clean: string[] = [];
  const tainted: string[] = [];
  const ids: string[] = [];
  let used = 0;
  for (const m of notes) {
    const l = format(m);
    if (used + l.length > max) continue;
    (m.tainted ? tainted : clean).push(l);
    ids.push(m.id);
    used += l.length;
  }
  const parts = [
    clean.join("\n"),
    tainted.length
      ? untrusted("memory_notes", { note: "saved while outside content was in context" }, tainted.join("\n"))
      : "",
  ].filter(Boolean);
  return parts.length ? { text: parts.join("\n"), ids } : { ids };
}

export function memoryTools(): Tool[] {
  return [
    defineTool({
      name: "remember",
      description:
        "Save one durable fact for later threads, in your own words: a preference, a decision, a name, how something works. Never passwords, keys or codes, nor what is only true in this conversation. To correct a note, pass its id.",
      args: z.object({
        text: z.string().trim().min(3).max(600),
        scope: SCOPE.optional(),
        id: z.string().max(64).optional().describe("the id of one of your notes, to replace its text"),
      }),
      effect: "local",
      // Runs without asking: a note saved with outside content in the turn stays tainted (see notesText).
      deadlineMs: 5_000,
      title: (a) => `Remembered: ${String(a.text ?? "").slice(0, 80)}`,
      async run(a, ctx) {
        const scope = a.scope ?? (ctx.thread.project_id ? "project" : "global");
        const m = await ctx.call("memory.add", {
          text: a.text,
          scope,
          tainted: ctx.untrusted(),
          ...(a.id ? { id: a.id } : {}),
        });
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
        return notesText(memories, 8000).text ?? "no notes match.";
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
