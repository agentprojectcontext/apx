// Tools that talk to the owner or page through what the turn already produced.
import { z } from "zod";
import type { Store } from "../domain/store.ts";
import { untrusted } from "./result.ts";
import { defineTool, type Tool } from "./types.ts";

const PAGE = 12_000;

const NOTIFY_STATE = {
  sent: "sent to the owner",
  held: "held: the owner's quiet hours; it goes when they end",
  dropped: "kept in the owner's tray only (their interruption budget); do not send it again",
  merged: "sent with others",
  no_channel: "in the owner's tray (they have no channel set up)",
} as const;

export function ownerTools(store: Store): Tool[] {
  return [
    defineTool({
      name: "ask_owner",
      description:
        "Ask the owner a question and wait for the answer (they see it in the chat). Use it when you cannot continue without a decision or a fact only they have. options = short choices they can tap; they may still answer in their own words. If they do not answer soon, the question stays open and their answer reaches you in a new turn.",
      args: z.object({
        question: z.string().min(1).max(1000),
        options: z.array(z.string().min(1).max(80)).max(6).optional(),
        can_continue: z
          .boolean()
          .optional()
          .describe("true only if you can reasonably go on without the answer: then a late answer is not waited for."),
      }),
      effect: "none",
      // The wait is bounded by the input's own deadline; this only covers a stuck write.
      deadlineMs: 16 * 60_000,
      title: (a) => `Asked you: ${String(a.question ?? "").slice(0, 60)}`,
      async run(a, ctx) {
        const r = await ctx.askOwner(a.question, a.options, a.can_continue);
        if (r.state === "answered") return `The owner answered: ${r.answer ?? ""}`;
        if (r.state === "pending")
          return "The owner has not answered yet. The question stays open in the chat and their answer will reach you in a new turn. End this turn now: say briefly what you are waiting for and do not go on with work that depends on it.";
        return "The owner did not answer in time. Continue without it.";
      },
    }),
    defineTool({
      name: "notify_owner",
      description:
        "Tell the owner something now, on their phone or channel, from work they are not watching (a task, a long job). Only what needs them: a decision, a blocker, a result they are waiting for. One or two lines. Their interruption budget may hold it for later or keep it in the tray only. Not in a routine (its answer already reaches them) nor between agents.",
      args: z.object({
        text: z.string().min(1).max(1000),
        critical: z
          .boolean()
          .optional()
          .describe("Only for something that cannot wait (money, safety, a hard deadline)."),
      }),
      // It only ever reaches the owner, so it runs without asking even with outside content in the turn.
      effect: "external",
      deadlineMs: 15_000,
      title: (a) => `Told you: ${String(a.text ?? "").slice(0, 60)}`,
      async run(a, ctx) {
        const { state } = await ctx.call("notices.notify", { text: a.text, ...(a.critical ? { critical: true } : {}) });
        return NOTIFY_STATE[state];
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
