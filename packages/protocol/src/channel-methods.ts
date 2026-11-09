// Adding a channel account and a contact: the core names the account and fills in what a new one starts with, so
// every client makes them the same way. See DECISIONS.md#d-205
import { z } from "zod";
import { ChannelEmail, ChannelInfo, ChannelType, Person } from "./domain.ts";

export const channelMethods = {
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
