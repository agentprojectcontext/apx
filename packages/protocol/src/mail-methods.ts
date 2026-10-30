import { z } from "zod";
import type { MethodDef } from "./methods.ts";

/** A way the owner's mail goes out from APX: their connected Gmail, or an email channel's mailbox. */
export const MailRoute = z.object({
  kind: z.enum(["gmail", "channel"]),
  id: z.string(),
  label: z.string(),
  /** The address it sends from. */
  address: z.string().optional(),
});
export type MailRoute = z.infer<typeof MailRoute>;

/** A draft an agent wrote in a chat that the owner already sent from it. */
export const SentDraft = z.object({ key: z.string(), at: z.string(), via: z.string() });
export type SentDraft = z.infer<typeof SentDraft>;

const DraftKey = z.string().min(1).max(200);
const Emails = z.array(z.email()).max(50);

export const mailMethods = {
  /** How the owner can send a draft from a chat, and which of `sent` (draft keys) they already sent. */
  "mail.routes": {
    params: z.object({ sent: z.array(DraftKey).max(100).default([]) }).strict(),
    result: z.object({ routes: z.array(MailRoute), sent: z.array(SentDraft) }),
    effect: false,
    access: "human",
  },
  /** The owner sends a draft an agent wrote, as they reviewed it, through one route. A key already sent is refused. */
  "mail.send": {
    params: z
      .object({
        route: MailRoute.pick({ kind: true, id: true }),
        key: DraftKey,
        to: Emails.min(1),
        cc: Emails.default([]),
        subject: z
          .string()
          .max(300)
          .regex(/^[^\r\n]*$/),
        body: z.string().min(1).max(20_000),
      })
      .strict(),
    result: SentDraft,
    effect: true,
    access: "human",
  },
} as const satisfies Record<string, MethodDef>;
