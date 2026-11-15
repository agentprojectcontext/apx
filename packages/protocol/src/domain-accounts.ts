import { z } from "zod";
import { ChannelLimits, ChannelRooms, ChannelStrangers, ChannelType } from "./domain-channels.ts";
import { PersonPerms } from "./domain-people.ts";
import { Id } from "./domain-projects.ts";
import { schemaFields } from "./schema-fields.ts";

/** How a mail server is reached: TLS from the start (993, 465), STARTTLS (143, 587), or plain (this machine only). */
export const MailServer = z.object(
  schemaFields({
    host: () =>
      z
        .string()
        .min(1)
        .max(253)
        .regex(/^[a-z0-9.:[\]-]+$/i),
    port: () => z.number().int().min(1).max(65_535),
    tls: () => z.enum(["implicit", "starttls", "none"]),
  }),
);
export type MailServer = z.infer<typeof MailServer>;

/** An email channel's mailbox: read over IMAP, answered over SMTP. The password is the channel's secret. */
export const ChannelEmail = z.object(
  schemaFields({
    /** The address mail is sent from (and the mailbox's own, whose mail is never answered). */
    address: () => z.email().max(254),
    /** The display name on sent mail. */
    name: () => z.string().max(80).optional(),
    /** The sign-in name, when it is not the address. */
    username: () => z.string().max(254).optional(),
    imap: () => MailServer,
    smtp: () => MailServer,
    mailbox: () => z.string().min(1).max(200).default("INBOX"),
    /**
     * Only mail from these addresses (or "@domain") is read, besides the owner's own; empty: anyone (strangers are only
     * listed for the owner, never mailed a code).
     */
    allowed: () => z.array(z.string().min(3).max(254)).max(100).default([]),
    /** Mail from these addresses (or "@domain") is never read, nor listed for the owner; the owner's own still is. */
    blocked: () => z.array(z.string().min(3).max(254)).max(200).default([]),
    /**
     * Also read mail its server could not verify (no DKIM, SPF or DMARC pass for the sender's domain). Off: such mail is
     * dropped, since anyone can write the owner's address in a From line. Mail from the owner's own addresses is always
     * dropped unverified.
     */
    trust_unverified: () => z.boolean().default(false),
  }),
);
export type ChannelEmail = z.infer<typeof ChannelEmail>;

/**
 * Who may have a sealed chat of this channel (a room, a contact's chat) search the web and read public pages: no one,
 * only the owner when they ask in a room, or anyone it answers. Nothing else of the owner's ever opens to them.
 */
export const ChannelResearch = z.enum(["off", "owner", "everyone"]);
export type ChannelResearch = z.infer<typeof ChannelResearch>;

const HourOfDay = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

/**
 * When a channel answers its contacts, in the owner's time zone: the days it opens (0 = Sunday) and from when to when
 * ("22:00"–"02:00" runs past midnight into the next day; the same time twice is the whole day). Outside them a
 * contact's message waits, unanswered, until the hours begin. See DECISIONS.md#d-136
 */
export const ChannelHours = z.object(
  schemaFields({
    days: () => z.array(z.number().int().min(0).max(6)).min(1).max(7),
    from: () => HourOfDay,
    to: () => HourOfDay,
  }),
);
export type ChannelHours = z.infer<typeof ChannelHours>;

export const ChannelInfo = z.object(
  schemaFields({
    id: () => z.string(),
    type: () => ChannelType,
    label: () => z.string(),
    enabled: () => z.boolean(),
    /**
     * The agent that answers on it: the one the owner talks to in a chat of this channel's own, and the one that answers
     * contacts and rooms unless `contacts_agent_id` names another.
     */
    agent_id: () => Id,
    /** The agent that answers the contacts and rooms of this channel, when it is not `agent_id`. */
    contacts_agent_id: () => Id.optional(),
    /**
     * What a stranger's first message gets: a pairing code the owner approves (on the owner's own number and on email:
     * only listed),
     * a notice asking the owner first, an answer right away as a new contact, or nothing.
     */
    strangers: () => ChannelStrangers,
    /** A new message while the agent is working: wait for it, stop it, or (APX's own loop) slip into it. */
    concurrency: () => z.enum(["queue", "interrupt", "steer"]),
    /** The owner's messages go to the Home chat (one conversation everywhere) or to a chat of this channel. */
    owner_thread: () => z.enum(["home", "own"]),
    /**
     * WhatsApp: the linked number is the owner's own phone, so "Message yourself" is the owner talking. Off: a line of
     * its own the agent answers on, and the owner writes to it from their phone (linked with a code or by number).
     */
    self_owner: () => z.boolean().optional(),
    /** Discord: the server rooms it reads and may speak in; Telegram and WhatsApp: its groups. None: only direct messages. */
    rooms: () => ChannelRooms.optional(),
    /** The agent may answer with an emoji on their message instead of words (none set: it may). See DECISIONS.md#d-204 */
    reactions: () => z.boolean().optional(),
    /** Web search and reading in its sealed chats (none set: only when the owner asks). See DECISIONS.md#d-059 */
    research: () => ChannelResearch.optional(),
    /** When it answers contacts; none: at any hour. The owner is always answered. */
    hours: () => ChannelHours.optional(),
    /**
     * Its notices are silenced: what happens on it (someone new writing, a draft waiting, a reply that could not go) stays
     * out of the owner's tray and chat app; failures still arrive. It is all still in the account.
     */
    quiet: () => z.boolean().optional(),
    /** What its contacts' chats may do unless the owner set it for one of them (none: all off). */
    contacts: () => PersonPerms.optional(),
    /** The owner's notes for every contact and room of the account: what it can do and answer there. */
    knowledge: () => z.string().max(12_000).optional(),
    /** The owner's rules for every contact and room of the account; a contact's or a room's own go after and win. */
    rules: () => z.string().max(2000).optional(),
    /** Only the owner is answered: contacts' and rooms' messages are kept, never answered. */
    owner_only: () => z.boolean().optional(),
    /** Automatic answers to its contacts per hour (none set: 20 each, no cap for the account). */
    limits: () => ChannelLimits.optional(),
    /** Email: the mailbox and its servers. */
    email: () => ChannelEmail.optional(),
    token_set: () => z.boolean(),
    /** The stored token, masked for the owner to recognize it: the bot's number and the secret's last four. */
    token_hint: () => z.string().optional(),
    status: () => z.enum(["off", "starting", "running", "error"]),
    error: () => z.string().optional(),
    /** The account the channel runs as (a bot's @name, a WhatsApp number). */
    account: () => z.string().optional(),
    /** The name the app gives that account, when it has one besides `account` (a WhatsApp profile, a bot's name). */
    account_name: () => z.string().optional(),
    /** WhatsApp: the QR to scan from the phone to link the account, while one is waiting. Owner-only, never logged. */
    qr: () => z.string().optional(),
  }),
);
export type ChannelInfo = z.infer<typeof ChannelInfo>;

/** A stranger who wrote on a channel and is waiting for the owner to approve them. */
export const PairingRequest = z.object(
  schemaFields({
    code: () => z.string(),
    channel: () => z.string(),
    external_id: () => z.string(),
    name: () => z.string(),
    text: () => z.string().optional(),
    created_at: () => z.string(),
    expires_at: () => z.string(),
  }),
);
export type PairingRequest = z.infer<typeof PairingRequest>;

/**
 * A media service the owner runs or uses: an image generator (a homelab's A1111 or stable-diffusion.cpp, an
 * OpenAI-compatible API) or a voice (QVox and other OpenAI-compatible speech servers, Gemini). Per kind, the first
 * reachable enabled one in the owner's order answers.
 */
export const ServiceKind = z.enum(["image", "speech", "embedding", "transcription"]);
export type ServiceKind = z.infer<typeof ServiceKind>;
export const ServiceDialect = z.enum([
  "a1111",
  "sdcpp",
  "openai-images",
  /** The owner's own Codex draws with its image_gen tool, on their ChatGPT plan (no address or key). */
  "codex-images",
  "openai-speech",
  "gemini-speech",
  "ollama-embed",
  "gemini-embed",
  "openai-embed",
  "whisper-local",
  "whisper-cpp",
  "openai-transcribe",
  /** APX's own voice on this machine (voice-methods in call-methods.ts): it speaks and transcribes. */
  "apx-voice",
]);
export type ServiceDialect = z.infer<typeof ServiceDialect>;

/** Transcription on this machine: what it can run well, the models to pick from, and a download in progress. */
export const LocalTranscription = z.object(
  schemaFields({
    machine: () =>
      z.object(
        schemaFields({
          platform: () => z.string(),
          arch: () => z.string(),
          cores: () => z.number().int(),
          memory_gb: () => z.number(),
          accel: () => z.enum(["metal", "cpu"]),
          /** whisper.cpp's server is installed. */
          server: () => z.boolean(),
          ffmpeg: () => z.boolean(),
        }),
      ),
    /** How to install what is missing on this system. */
    install_hint: () => z.string().optional(),
    recommended: () => z.string(),
    models: () =>
      z.array(
        z.object(
          schemaFields({
            id: () => z.string(),
            mb: () => z.number(),
            quality: () => z.enum(["basic", "good", "great"]),
            installed: () => z.boolean(),
          }),
        ),
      ),
    download: () =>
      z
        .object(
          schemaFields({
            model: () => z.string(),
            received: () => z.number(),
            total: () => z.number(),
            error: () => z.string().optional(),
          }),
        )
        .optional(),
    /** The model the local service uses now. */
    active: () => z.string().optional(),
  }),
);
export type LocalTranscription = z.infer<typeof LocalTranscription>;
