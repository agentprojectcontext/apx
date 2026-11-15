import { z } from "zod";
import { Part } from "./domain-parts.ts";
import { Id } from "./domain-projects.ts";
import { Author } from "./domain-threads.ts";

export const MessageDelivery = z.enum(["pending", "sent", "delivered", "read", "failed"]);
export type MessageDelivery = z.infer<typeof MessageDelivery>;
/** An emoji on a channel message: the agent's own, or the other side's (the contact, or the owner on their chat). */
export const MessageReaction = z.object({ emoji: z.string().min(1).max(32), by: z.enum(["agent", "them"]) });
export type MessageReaction = z.infer<typeof MessageReaction>;
/** How the owner's words written while their agent works wait for it (Message.waiting). */
export const MessageWaiting = z.object({
  until: z.enum(["step", "turn"]),
  run: Id.optional(),
  /** Captured when the owner's words arrive; null means they had no task authorization. */
  task_assignment: z.object({ task: Id, id: Id }).nullable().optional(),
});
export type MessageWaiting = z.infer<typeof MessageWaiting>;

export const Message = z.object({
  id: Id,
  thread_id: Id,
  seq: z.number().int(),
  author: Author,
  parts: z.array(Part),
  run_id: Id.optional(),
  model: z.string().optional(),
  /** True only when the engine confirmed the model; absent means historical provenance is unknown. */
  model_reported: z.boolean().optional(),
  /** Sent on a channel: queued, taken by the platform, on their device, seen by them, or not sent. */
  delivery: MessageDelivery.optional(),
  /** Emoji put on it on a channel, at most one per side. */
  reactions: z.array(MessageReaction).optional(),
  /**
   * The channel (its id) it came on or went out on; a chat everyone writes into (Home) shows each channel's part.
   * `chrome` (CHROME_VIA): written in, or answered to, APX's panel in Chrome.
   */
  via: z.string().optional(),
  /**
   * The owner's words their agent has not taken yet: `step`, its running turn takes them at its next step; `turn`,
   * they wait in line (as run `run`) until that turn ends, and can still be edited, removed or moved.
   */
  waiting: MessageWaiting.optional(),
  created_at: z.string(),
});
export type Message = z.infer<typeof Message>;

/** Tokens of a run; `context` is the last model call's input (how full the chat is), `window` that model's limit. */
export const RunUsage = z.object({
  input: z.number().int(),
  output: z.number().int(),
  context: z.number().int().optional(),
  window: z.number().int().optional(),
  /** Prompt tokens a provider read from its cache (cheaper, and counted inside `input`). */
  cached: z.number().int().optional(),
});
export type RunUsage = z.infer<typeof RunUsage>;

/** A sticker someone sent on a channel, kept so the agent reads what it means and can answer with it. */
export const Sticker = z.object({
  id: Id,
  /** The channel type it came on ("whatsapp", "telegram"): the agent sends it only there. */
  platform: z.string(),
  media_id: Id,
  mime: z.string(),
  /** What it shows and says; none until a model that reads images named it. */
  meaning: z.string().optional(),
  /** The emoji the platform says it stands for. */
  hint: z.string().optional(),
  /** Times it arrived, and times the agent sent it. */
  seen: z.number().int(),
  sent: z.number().int(),
  /** The owner said the agent may not send it. */
  blocked: z.boolean(),
  /** Waits for the owner's OK before the agent may send it. */
  pending: z.boolean(),
  /** A model saw it as adult-only: it always waits for the owner's OK. */
  adult: z.boolean(),
  last_at: z.string(),
});
export type Sticker = z.infer<typeof Sticker>;
