// Tools that talk to the owner or page through what the turn already produced.
import { z } from "zod";
import type { Store } from "../domain/store.ts";
import { untrusted } from "./result.ts";
import { defineTool, type Tool } from "./types.ts";

const PAGE = 12_000;

export function ownerTools(store: Store): Tool[] {
  return [
    defineTool({
      name: "ask_owner",
      description:
        "Ask the owner a question and wait for the answer (they see it in the chat). Use it when you cannot continue without a decision or a fact only they have. options = short choices they can tap; they may still answer in their own words.",
      args: z.object({
        question: z.string().min(1).max(1000),
        options: z.array(z.string().min(1).max(80)).max(6).optional(),
      }),
      effect: "none",
      // The wait is bounded by the input's own deadline; this only covers a stuck write.
      deadlineMs: 16 * 60_000,
      title: (a) => `Asked you: ${String(a.question ?? "").slice(0, 60)}`,
      async run(a, ctx) {
        const r = await ctx.askOwner(a.question, a.options);
        if (r.state === "answered") return `The owner answered: ${r.answer ?? ""}`;
        return "The owner did not answer in time. Continue without it if you can, or say what you are waiting for.";
      },
    }),
    defineTool({
      name: "read_output",
      description:
        "Read more of a tool output that was cut (the cut result ends with read_output ref=…). Returns the page at offset.",
      args: z.object({
        ref: z.string().min(1).max(64),
        offset: z.number().int().min(0).optional(),
      }),
      effect: "none",
      deadlineMs: 5_000,
      title: () => "Read more of an output",
      async run(a, ctx) {
        const text = store.runs.output(a.ref, ctx.thread.id);
        if (text === undefined) return `no output ${a.ref} in this thread`;
        const from = Math.min(a.offset ?? 0, text.length);
        const page = text.slice(from, from + PAGE);
        const next = from + PAGE < text.length ? `\n[${text.length} chars total; next offset ${from + PAGE}]` : "";
        // The stored text may hold web pages or another agent's words: a page of it stays untrusted.
        return `${untrusted("tool_output", { ref: a.ref, offset: String(from) }, page)}${next}`;
      },
    }),
  ];
}
