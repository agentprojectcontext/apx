// remember / recall / forget: an agent's notes between threads, through the memory.* methods like any client.
import type { Memory } from "@apx/protocol";
import { z } from "zod";
import { stepKey, stepPairs } from "../domain/procedure-steps.ts";
import type { Store } from "../domain/store.ts";
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
  const head = `- [${m.id}] (${m.kind ?? "note"}${m.source === "owner" ? ", by the owner" : ""}, ${m.updated_at.slice(0, 10)}) `;
  const hook = (m.kind === "procedure" ? procedureHook(m.text) : undefined) ?? first.replace(/\s+/g, " ").trim();
  return `${head}${hook.length > 96 ? `${hook.slice(0, 95)}…` : hook}`;
}

/** A procedure as the task the owner asked for and the decisive steps (site, programs, page script) that did it. */
function procedureHook(text: string): string | undefined {
  const [first = "", steps = ""] = text.split("\n");
  const asked = /asked: "(.*)"$/.exec(first)?.[1];
  if (!asked) return undefined;
  const pairs = stepPairs(steps);
  const keys = pairs.map((p) => stepKey(p.tool, p.gist)).filter((k, i, all) => k && k !== all[i - 1]);
  const method = (keys.length ? keys : pairs.slice(0, 2).map((p) => p.tool)).join(" → ");
  const task = asked
    .replace(/https?:\/\/(?:www\.)?([^/\s]+)\S*/g, "<$1>")
    .replace(/\s+/g, " ")
    .trim();
  const room = Math.max(24, 92 - method.length);
  return `"${task.length > room ? `${task.slice(0, room - 1)}…` : task}": ${method}`;
}

/** What wrapping notes saved with outside content adds around them (see notesText). */
export const TAINTED_WRAP =
  untrusted("memory_notes", { note: "saved while outside content was in context" }, "").length + 1;

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
    if (used + l.length + 1 > max) continue;
    (m.tainted ? tainted : clean).push(l);
    ids.push(m.id);
    used += l.length + 1;
  }
  const parts = [
    clean.join("\n"),
    tainted.length
      ? untrusted("memory_notes", { note: "saved while outside content was in context" }, tainted.join("\n"))
      : "",
  ].filter(Boolean);
  return parts.length ? { text: parts.join("\n"), ids } : { ids };
}

export function memoryTools(store: Store): Tool[] {
  return [
    defineTool({
      name: "remember",
      description:
        "Save one durable fact for later threads, in your own words: a preference, decision, name, how something works. Keep its scope and exceptions; a Why only if stated, a How to apply only if supported. Never passwords, keys or codes, nor what is only true in this conversation (that goes in tasks or plans). To correct a note, pass its id.",
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
      // The owner approves what the note says, not its id; the id stays below to tell two alike apart.
      explain: (a) => {
        const note = store.memories.get(a.id);
        return note ? `${note.text}\n(${note.id})` : undefined;
      },
      title: (a) => `Forgot the note ${String(a.id ?? "")}`,
      async run(a, ctx) {
        const { removed } = await ctx.call("memory.remove", { id: a.id });
        return removed ? "removed." : "no such note.";
      },
    }),
  ];
}
