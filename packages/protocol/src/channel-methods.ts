// Adding a channel account and a contact: the core names the account and fills in what a new one starts with, so
// every client makes them the same way. See DECISIONS.md#d-205
import { z } from "zod";
import { ChannelEmail, ChannelInfo, ChannelType, Person } from "./domain.ts";

export const channelMethods = {
  /** Explicit, quiet recovery of one page of a mailbox's retained history; never changes the live cursor. */
  "channels.email_history": {
    params: z
      .object({
        channel: z.string().min(1).max(32),
        after_uid: z.number().int().nonnegative().default(0),
        uidvalidity: z.number().int().positive().optional(),
        limit: z.number().int().min(1).max(50).default(25),
      })
      .strict(),
    result: z.object({
      uidvalidity: z.number().int().positive(),
      next_uid: z.number().int().nonnegative(),
      has_more: z.boolean(),
      scanned: z.number().int().nonnegative(),
      stored: z.number().int().nonnegative(),
      already_seen: z.number().int().nonnegative(),
      skipped: z.number().int().nonnegative(),
      failed: z.number().int().nonnegative(),
    }),
    effect: true,
    access: "human",
  },
  /**
   * A new account of a chat app, answered by the super-agent: the core gives it its id (the app's name for the first,
   * a random one after it, never its number or token) and its name. It is kept once it has connected; one never
   * connected is dropped when the core starts again. iMessage is one per Mac.
   */
  "channels.add": {
    params: z
      .object({
        type: ChannelType,
        label: z.string().max(60).optional(),
        self_owner: z.boolean().optional(),
        email: ChannelEmail.optional(),
        // A Google service account key travels whole (about 2.3 KB).
        token: z.string().min(8).max(8000).optional(),
      })
      .strict(),
    result: z.object({ id: z.string(), channels: z.array(ChannelInfo) }),
    effect: true,
    access: "human",
  },
  /** A new contact with their address on a channel, both or neither; an address already someone's is refused. */
  "contacts.add": {
    params: z
      .object({
        channel: z.string().min(1).max(32),
        name: z.string().trim().min(1).max(80),
        address: z.string().trim().min(3).max(80),
      })
      .strict(),
    result: Person,
    effect: true,
    access: "human",
  },
} as const;
