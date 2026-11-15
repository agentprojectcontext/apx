import { z } from "zod";

export const ChannelStrangers = z.enum(["pair", "ask", "answer", "ignore"]);
export type ChannelStrangers = z.infer<typeof ChannelStrangers>;

/** A channel instance as the owner configured it, and how it is doing. */
/** The channels APX can run: a bot or account the owner connects. */
export const ChannelType = z.enum([
  "telegram",
  "whatsapp",
  "discord",
  "slack",
  "matrix",
  "mattermost",
  "signal",
  "email",
  "imessage",
  "googlechat",
  "sms",
  "ntfy",
  "nextcloud",
  "irc",
  "twitch",
  "teams",
  "line",
]);
export type ChannelType = z.infer<typeof ChannelType>;

/**
 * How the bot behaves in a room (a Discord server's channel, a Telegram group): answer everything, only when called, only when it
 * can really help (a cheap model judges, by the owner's criterion), or never (it reads, so the owner can ask later).
 */
export const RoomMode = z.enum(["always", "mention", "useful", "read"]);
export type RoomMode = z.infer<typeof RoomMode>;

/**
 * Public rooms (a Discord server's channels, Telegram and WhatsApp groups). Deny by default: a room that is not listed does not exist for APX. People
 * there are strangers in public: the agent answers sealed (no tools, no memory, nothing of the owner's), by the owner's
 * knowledge and rules.
 */
export const ChannelRooms = z.object({
  rooms: z
    // A Teams group chat's id runs to about 90 characters.
    .array(
      z.object({
        id: z.string().min(1).max(120),
        name: z.string().max(80).default(""),
        mode: RoomMode,
        /** The agent that answers this room, when it is not the account's contacts agent. */
        agent_id: z.string().min(1).max(120).optional(),
      }),
    )
    .max(50),
  /** Words that count as calling the bot (besides an @mention or a reply to it). */
  names: z.array(z.string().min(1).max(40)).max(10).default([]),
  /** Answer only the owner in rooms; everyone else is read, never answered. */
  owner_only: z.boolean().default(false),
  /**
   * A line that is the owner's own phone (WhatsApp `self_owner`): whether the agent may speak in its groups, which reads
   * as the owner speaking. Unset: its groups are only read. See DECISIONS.md#d-216
   */
  as_owner: z.boolean().optional(),
  /** Every room is dropped: nothing said there is kept or answered, and the list stays for when they are on again. */
  off: z.boolean().optional(),
  /** What it can do and answer there: written by the owner, public. */
  knowledge: z.string().max(12_000).default(""),
  /** Hard rules for what it says there; they go last and win. */
  rules: z.string().max(2000).default(""),
  /** When an uncalled message deserves an answer (the "useful" rooms). */
  reply_when: z.string().max(2000).default(""),
  /** Between two answers to one person; answers per room per hour; uncalled messages judged per room per hour. */
  limits: z
    .object({
      user_cooldown_s: z.number().int().min(0).max(3600).default(20),
      room_replies_per_hour: z.number().int().min(1).max(600).default(30),
      checks_per_hour: z.number().int().min(0).max(1000).default(120),
    })
    .default({ user_cooldown_s: 20, room_replies_per_hour: 30, checks_per_hour: 120 }),
});
export type ChannelRooms = z.infer<typeof ChannelRooms>;

/**
 * How many automatic answers an account gives its contacts in an hour: each one, and all of them together (0: no cap
 * for the account). Past either, messages are kept unanswered and the owner hears it once. Rooms keep their own limits.
 */
export const ChannelLimits = z.object({
  per_contact_hour: z.number().int().min(1).max(600).default(20),
  per_account_hour: z.number().int().min(0).max(5000).default(0),
});
export type ChannelLimits = z.infer<typeof ChannelLimits>;
