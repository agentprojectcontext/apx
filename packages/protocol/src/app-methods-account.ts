// Methods behind the app screens.
import { z } from "zod";
import {
  ContactSuggestion,
  Id,
  ImageDefaults,
  LocalEmbedding,
  LocalTranscription,
  NoticePrefs,
  Nudge,
  OutboxItem,
  OutboxState,
  Person,
  PersonRelation,
  PersonRole,
  ServiceInfo,
  ServiceKind,
  ServiceSettings,
  ServiceTest,
  Sticker,
  Thread,
} from "./domain.ts";

export const appAccountMethods = {
  /** What channels sent lately and how each delivery went (sent, uncertain, failed). */
  "channels.outbox": {
    params: z
      .object({
        limit: z.number().int().min(1).max(200).default(50),
        /** Only what this account sent (its id). */
        channel: z.string().min(1).max(64).optional(),
      })
      .strict(),
    result: z.object({ items: z.array(OutboxItem) }),
    effect: false,
    access: "human",
  },
  /** The stickers kept from a channel type, the most used first, named or not, blocked or not. */
  "stickers.list": {
    params: z.object({ platform: z.string().min(1).max(40) }).strict(),
    /** `auto`: new stickers are the agent's to use as they come (the default), else each waits for the owner's OK. */
    result: z.object({ stickers: z.array(Sticker), auto: z.boolean() }),
    effect: false,
    access: "human",
  },
  /** The owner's words for what a sticker means (no model names it again), or whether the agent may send it. */
  "stickers.set": {
    params: z
      .object({ id: Id, meaning: z.string().trim().min(1).max(160).optional(), blocked: z.boolean().optional() })
      .strict(),
    result: Sticker,
    effect: true,
    access: "human",
  },
  /**
   * Whether new stickers are the agent's to use as they come, or each waits for the owner's OK. One for adults, or one
   * no model could see, always waits.
   */
  "stickers.auto": {
    params: z.object({ on: z.boolean() }).strict(),
    result: z.object({ on: z.boolean() }),
    effect: true,
    access: "human",
  },
  /** Forgets a sticker and its file; if someone sends it again it is kept and named again. */
  "stickers.remove": {
    params: z.object({ id: Id }).strict(),
    result: z.object({ removed: z.boolean() }),
    effect: true,
    access: "human",
  },
  /**
   * A contact's chat on a channel, to write to them from the app: the one they have, or a new empty one (nothing is
   * sent until someone writes in it).
   */
  "channels.open": {
    params: z.object({ person: Id, channel: z.string().min(1).max(60) }).strict(),
    result: Thread,
    effect: true,
    access: "human",
  },
  /**
   * The rooms of the servers a channel's bot is in (Discord's text and announcement channels), or the groups a Telegram
   * bot was seen in (the Bot API cannot list them), to add one by picking it; `writable`: whether the bot may post there
   * (Discord's permissions for its roles in that room; always true for a Telegram group).
   */
  "channels.rooms": {
    params: z.object({ channel: z.string().min(1).max(60) }).strict(),
    result: z.object({
      rooms: z.array(z.object({ id: z.string(), name: z.string(), server: z.string(), writable: z.boolean() })),
    }),
    effect: false,
    access: "human",
  },
  /**
   * Who of a channel's contacts is online, as far as the platform says (WhatsApp; those who hide it never show).
   * Asking starts listening for them, so the first answer may be empty.
   */
  "channels.presence": {
    params: z.object({ channel: z.string().min(1).max(60) }).strict(),
    result: z.object({
      people: z.array(z.object({ person_id: Id, online: z.boolean(), last_seen: z.string().optional() })),
    }),
    effect: false,
    access: "human",
  },
  /**
   * Files that never arrived in a channel chat (kept as "[video — APX cannot read…]" or "[attachment could not be
   * downloaded…]") asked of the platform again — on WhatsApp the owner's phone sends each message again, so it has to
   * be online — and put in their messages. Starts no turn. `missing` says why each one did not come.
   */
  "channels.recover": {
    params: z.object({ thread: Id }).strict(),
    result: z.object({
      /** Messages waiting for their file. */
      asked: z.number().int(),
      recovered: z.array(z.object({ message_id: z.string(), name: z.string() })),
      missing: z.array(z.object({ message_id: z.string(), reason: z.string() })),
      /** Why nothing was tried, or why nothing came. */
      reason: z.string().optional(),
    }),
    effect: true,
    access: "human",
  },
  /** iMessage on this Mac as agent tools (read recent messages, send one with the owner's OK); off until turned on. */
  "imessage.get": {
    params: z.object({}).strict(),
    result: z.object({ available: z.boolean(), on: z.boolean() }),
    effect: false,
    access: "human",
  },
  "imessage.set": {
    params: z.object({ on: z.boolean() }).strict(),
    result: z.object({ available: z.boolean(), on: z.boolean() }),
    effect: true,
    access: "human",
  },
  /** The desktop app's settings: the global shortcut of the quick chat and whether APX starts at login. */
  /** The desktop app's settings: quick chat shortcut, start at login, and computer use on this computer. */
  "desktop.get": {
    params: z.object({}).strict(),
    result: z.object({
      shortcut: z.string(),
      launch_at_login: z.boolean(),
      computer_use: z.boolean(),
      /** The Mac stays awake while APX works for the owner (macOS). */
      keep_awake: z.boolean(),
    }),
    effect: false,
    access: "human",
  },
  "desktop.set": {
    params: z
      .object({
        shortcut: z.string().max(60),
        launch_at_login: z.boolean(),
        computer_use: z.boolean().default(false),
        keep_awake: z.boolean().default(true),
      })
      .strict(),
    result: z.object({
      shortcut: z.string(),
      launch_at_login: z.boolean(),
      computer_use: z.boolean(),
      keep_awake: z.boolean(),
    }),
    effect: true,
    access: "human",
  },
  /** Image and voice services in the owner's order, with whether each answers now; and the shared image defaults. */
  "services.list": {
    params: z.object({ kind: ServiceKind.optional() }).strict(),
    result: z.object({ services: z.array(ServiceInfo), image_defaults: ImageDefaults }),
    effect: false,
    access: "human",
  },
  /** Adds, changes or (null) removes a service; `api_key` goes to the secret store and never comes back. */
  "services.set": {
    params: z
      .object({
        id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,31}$/),
        service: ServiceSettings.nullable(),
        api_key: z.string().min(1).max(4000).optional(),
      })
      .strict(),
    result: z.object({ services: z.array(ServiceInfo) }),
    effect: true,
    access: "human",
  },
  /**
   * Asks a service now, saved or not yet (`service` as the form has it): whether it answers and the models it offers.
   * `id` names a saved one, whose key is used when `api_key` is not given and whose status is updated.
   */
  "services.test": {
    params: z
      .object({
        service: ServiceSettings,
        id: z.string().max(32).optional(),
        api_key: z.string().min(1).max(4000).optional(),
      })
      .strict(),
    result: ServiceTest,
    effect: false,
    access: "human",
  },
  /** Local transcription: this machine, the model that fits it, the models on disk and a download in progress. */
  "transcription.local": {
    params: z.object({}).strict(),
    result: LocalTranscription,
    effect: false,
    access: "human",
  },
  /**
   * Gets a local model (downloaded now, in the background) and sets up the local transcription service with it, first
   * in the order; one already on disk is only set up.
   */
  "transcription.install": {
    params: z.object({ model: z.string().max(60) }).strict(),
    result: LocalTranscription,
    effect: true,
    access: "human",
  },
  /** Embeddings on this machine through Ollama: whether it runs here, its models, the one that fits, a pull. */
  "embeddings.local": {
    params: z.object({}).strict(),
    result: LocalEmbedding,
    effect: false,
    access: "human",
  },
  /**
   * Sets memory's embedding engine to Ollama here with `model`, first in the order; a model Ollama does not have yet is
   * pulled first, in the background.
   */
  "embeddings.install": {
    params: z.object({ model: z.string().regex(/^[\w.:/-]{1,80}$/) }).strict(),
    result: LocalEmbedding,
    effect: true,
    access: "human",
  },
  /** The order services of one kind are tried in. */
  "services.order": {
    params: z.object({ kind: ServiceKind, ids: z.array(z.string()).max(50) }).strict(),
    result: z.object({ services: z.array(ServiceInfo) }),
    effect: true,
    access: "human",
  },
  "services.defaults": {
    params: ImageDefaults.strict(),
    result: ImageDefaults,
    effect: true,
    access: "human",
  },
  /**
   * Draws an image with the first image service that answers (or `service`). With `thread`, the images are shown in
   * that chat. Agents call it through make_image.
   */
  "media.image": {
    params: z
      .object({
        prompt: z.string().trim().min(1).max(4000),
        service: z.string().optional(),
        width: z.number().int().min(64).max(4096).optional(),
        height: z.number().int().min(64).max(4096).optional(),
        steps: z.number().int().min(1).max(200).optional(),
        negative_prompt: z.string().max(2000).optional(),
        count: z.number().int().min(1).max(4).optional(),
        seed: z.number().int().optional(),
        /** Images (media ids, from this chat when `thread` is given) the drawing works from. */
        references: z.array(Id).max(4).optional(),
        thread: Id.optional(),
      })
      .strict(),
    result: z.object({
      media: z.array(z.object({ id: Id, mime: z.string() })),
      service: z.string(),
      model: z.string().optional(),
      /** Services tried before this one, and why each failed. */
      skipped: z.array(z.string()),
    }),
    effect: true,
  },
  /** Speaks text with the first voice service that answers (or `service`). */
  "media.speak": {
    params: z
      .object({
        text: z.string().trim().min(1).max(4000),
        service: z.string().optional(),
        voice: z.string().max(100).optional(),
        thread: Id.optional(),
      })
      .strict(),
    result: z.object({
      media: z.object({ id: Id, mime: z.string() }),
      service: z.string(),
      skipped: z.array(z.string()),
    }),
    effect: true,
  },
  /** The bytes of an image or audio APX made, base64. */
  "media.get": {
    params: z.object({ id: Id }).strict(),
    result: z.object({ mime: z.string(), data: z.string(), bytes: z.number().int() }),
    effect: false,
  },
  "notices.get": {
    params: z.object({}).strict(),
    result: NoticePrefs,
    effect: false,
    access: "human",
  },
  /** The latest messages APX meant to send unasked (newest first), and how many count today against the cap. */
  "notices.log": {
    params: z.object({ limit: z.number().int().min(1).max(200).default(50) }).strict(),
    result: z.object({ items: z.array(Nudge), today: z.object({ sent: z.number().int(), cap: z.number().int() }) }),
    effect: false,
    access: "human",
  },
  /** The owner's 👍/👎 on a message APX sent unasked (null takes it back). A kind marked 👎 again and again stops. */
  "notices.feedback": {
    params: z.object({ id: Id, feedback: z.enum(["up", "down"]).nullable() }).strict(),
    result: Nudge,
    effect: true,
    access: "human",
  },
  "notices.set": {
    params: NoticePrefs.strict(),
    result: NoticePrefs,
    effect: true,
    access: "human",
  },
  "contacts.list": {
    params: z.object({}).strict(),
    result: z.object({ persons: z.array(Person) }),
    effect: false,
    access: "human",
  },
  /** Creates (no id) or changes a person; the owner stays the owner. */
  "contacts.set": {
    params: z
      .object({
        id: Id.optional(),
        name: z.string().trim().min(1).max(80),
        role: PersonRole.optional(),
        note: z.string().max(500).optional(),
        nickname: z.string().trim().max(40).optional(),
        relation: PersonRelation.nullable().optional(),
        rules: z.string().max(1000).optional(),
        muted: z.boolean().optional(),
        supervised: z.boolean().optional(),
        /** Who answers them instead of each account's contacts agent; null gives them back to the account's. */
        agent_id: Id.nullable().optional(),
        // Only the rights sent change; null gives one back to the account they write on.
        perms: z
          .object({
            appointments: z.boolean().nullable(),
            requests: z.boolean().nullable(),
            notes: z.boolean().nullable(),
            any_hour: z.boolean().nullable(),
          })
          .partial()
          .strict()
          .optional(),
      })
      .strict(),
    result: Person,
    effect: true,
    access: "human",
  },
  /** Replies drafted for supervised contacts, newest first: the pending ones by default. */
  "contacts.suggestions.list": {
    params: z
      .object({
        state: z.enum(["pending", "sent", "discarded", "superseded", "all"]).default("pending"),
        person: Id.optional(),
        limit: z.number().int().min(1).max(200).default(50),
      })
      .strict(),
    result: z.object({ suggestions: z.array(ContactSuggestion) }),
    effect: false,
    access: "human",
  },
  /**
   * Sends a pending suggestion to the contact in their chat, as the agent's reply; `text` sends that instead (edited).
   * `author: "owner"` sends `text` as the owner's own words. `delivery`: how the send went, as channels.message says.
   */
  "contacts.suggestions.send": {
    params: z
      .object({
        id: Id,
        text: z.string().trim().min(1).max(4000).optional(),
        author: z.enum(["agent", "owner"]).default("agent"),
      })
      .strict(),
    result: z.object({
      suggestion: ContactSuggestion,
      delivery: z.object({ state: OutboxState, error: z.string().optional() }),
    }),
    effect: true,
    access: "human",
  },
  /** Drops a pending suggestion: nothing is sent, the contact stays supervised. */
  "contacts.suggestions.discard": {
    params: z.object({ id: Id }).strict(),
    result: z.object({ suggestion: ContactSuggestion }),
    effect: true,
    access: "human",
  },
} as const;
