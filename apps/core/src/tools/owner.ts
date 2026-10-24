// Tools that talk to the owner or page through what the turn already produced.
import { z } from "zod";
import type { InputRecord } from "../domain/inputs.ts";
import { ownerQuestionProblem } from "../domain/owner-question.ts";
import type { Store } from "../domain/store.ts";
import { untrusted } from "./result.ts";
import { defineTool, type Tool } from "./types.ts";

const PAGE = 12_000;

const NOTIFY_STATE = {
  sent: "sent to the owner",
  held: "held: the owner's quiet hours; it goes when they end",
  dropped: "kept in the owner's tray only (their interruption budget); do not send it again",
  merged: "sent with others",
  relay: "handed to the super-agent, who tells the owner in its next team news; do not send it again",
  no_channel: "in the owner's tray (they have no channel set up)",
} as const;

/** What the agent learns from an action card: accepted means do it now, its calls still pass their own checks. */
function actionResult(r: InputRecord): string {
  const note = r.answer ? ` Their note: ${r.answer}` : "";
  if (r.state === "approved")
    return `The owner accepted this action: do it now, as proposed.${note} If a call in it still waits for their OK, APX asks them for it.`;
  if (r.state === "denied") return `The owner declined this action: do not do it.${note}`;
  if (r.state === "pending")
    return `The owner has not answered yet. The card stays open in the chat (id ${r.id}) and their answer will reach you in a new turn; if it is no longer needed, take it back with ask_owner withdraw=${r.id}. End this turn now: say briefly what waits on them and do not do the action.`;
  if (r.state === "withdrawn") return "The proposal was withdrawn. Continue without it.";
  return "The owner did not answer in time: do not do the action.";
}

export function ownerTools(store: Store): Tool[] {
  return [
    defineTool({
      name: "ask_owner",
      description:
        "Ask the owner something only they can answer, and wait. options: short choices to tap (multi: several at once); they may still write their own answer. A late answer reaches you in a new turn.",
      args: z
        .object({
          question: z.string().min(1).max(1000).optional(),
          options: z.array(z.string().min(1).max(80)).max(6).optional(),
          multi: z.boolean().optional(),
          can_continue: z
            .boolean()
            .optional()
            .describe(
              "true only if you can reasonably go on without the answer: then a late answer is not waited for.",
            ),
          action: z
            .string()
            .min(1)
            .max(1000)
            .optional()
            .describe(
              "Instead of a question: the one concrete action you would take (what, where, when), for the owner to accept or decline. Not for a single call: APX asks for those.",
            ),
          withdraw: z.string().min(1).max(64).optional().describe("Instead: id of your open question to take back"),
        })
        // Checked before anything is written or sent: a stand-in question would reach the owner's phone.
        .superRefine((a, c) => {
          if (a.withdraw) return;
          if (a.action && (a.question || a.options || a.multi)) {
            c.addIssue({ code: "custom", path: ["action"], message: "an action takes no question or options" });
            return;
          }
          const text = a.action ?? a.question;
          const why = text ? ownerQuestionProblem(text) : "give a question or an action, or withdraw";
          if (why)
            c.addIssue({
              code: "custom",
              path: [a.action ? "action" : "question"],
              message: `not sent: ${why}. ${a.action ? "Name the one action the owner accepts" : "Ask one specific question with what the owner needs to decide"}, or do not ask.`,
            });
        }),
      effect: "none",
      // The wait is bounded by the input's own deadline; this only covers a stuck write.
      deadlineMs: 16 * 60_000,
      title: (a) =>
        a.withdraw
          ? "Took back a question"
          : a.action
            ? `Proposed: ${String(a.action).slice(0, 60)}`
            : `Asked you: ${String(a.question ?? "").slice(0, 60)}`,
      async run(a, ctx) {
        if (a.withdraw) {
          const r = ctx.withdrawQuestion(a.withdraw);
          return `Question ${r.id} withdrawn; the owner is not asked again.`;
        }
        if (a.action) return actionResult(await ctx.proposeAction(a.action, a.can_continue));
        const r = await ctx.askOwner(a.question ?? "", a.options, a.can_continue, a.multi);
        if (r.state === "answered") return `The owner answered: ${r.answer ?? ""}`;
        if (r.state === "pending")
          return `The owner has not answered yet. The question stays open in the chat (id ${r.id}) and their answer will reach you in a new turn; if it is no longer needed, take it back with ask_owner withdraw=${r.id}. End this turn now: say briefly what you are waiting for and do not go on with work that depends on it.`;
        if (r.state === "withdrawn") return "The question was withdrawn. Continue without it.";
        return "The owner did not answer in time. Continue without it.";
      },
    }),
    defineTool({
      name: "notify_owner",
      description:
        "Tell the owner something now, on their phone or channel, from work they are not watching (a task, a long job): only a decision, a blocker or a result they wait for, in one or two lines. Their notice budget may hold it for later. Not in a routine (its answer reaches them) nor between agents.",
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
