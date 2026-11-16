// Methods behind the app screens.
import { z } from "zod";
import { MemoryJobs, Sent, Withheld } from "./app-method-schemas.ts";
import { CHANNEL_DEFAULTS } from "./constants.ts";
import { deferMethod } from "./defer-method.ts";
import {
  AuxPurpose,
  ChannelEmail,
  ChannelHours,
  ChannelInfo,
  ChannelLimits,
  ChannelResearch,
  ChannelRooms,
  ChannelStrangers,
  ChannelType,
  ChatgptStatus,
  Id,
  Memory,
  MemoryEvidence,
  MemoryScope,
  MemorySettings,
  OwnerIdentity,
  OwnerPatch,
  PersonPerms,
  ProviderInfo,
  ProviderTransport,
  RoomMode,
} from "./domain.ts";

export const appConversationMethods = {
  /**
   * Signs the plan in: `device` gives a code to type at OpenAI's address (the core waits for it); `v1` takes over
   * APX v1's own sign-in. Never Codex CLI's.
   */
  "chatgpt.connect": deferMethod({
    params: () =>
      z
        .object({
          via: z.enum(["device", "v1"]),
        })
        .strict(),
    result: () => ChatgptStatus,
    effect: true,
    access: "human",
  }),
  "chatgpt.disconnect": deferMethod({
    params: () => z.object({}).strict(),
    result: () => ChatgptStatus,
    effect: true,
    access: "human",
  }),
  /**
   * Starts OpenRouter's sign-in: the page to approve at, which sends the browser back to `callback` (the panel's
   * /oauth/openrouter page) to finish it.
   */
  "openrouter.connect": deferMethod({
    params: () => z.object({ callback: z.string().url().max(500) }).strict(),
    result: () => z.object({ url: z.string() }),
    effect: true,
    access: "human",
  }),
  /**
   * The code OpenRouter sent back, with the state this core made minutes ago (once): its key is saved and OpenRouter
   * added. Open, like Google's: the browser it returns to may not be paired, and the core's PKCE verifier is the key.
   */
  "openrouter.finish": deferMethod({
    params: () => z.object({ code: z.string().min(1).max(2000), state: z.string().min(1).max(200) }).strict(),
    result: () => z.object({ ok: z.literal(true) }),
    effect: true,
    access: "human",
    open: true,
  }),
  "providers.list": deferMethod({
    params: () => z.object({}).strict(),
    result: () =>
      z.object({
        providers: z.array(ProviderInfo),
      }),
    effect: false,
    access: "human",
  }),
  /**
   * Adds or changes a model API (null removes it). `api_key` is stored as a secret named after the provider and
   * never returned; `needs_key: false` is for local servers.
   */
  "providers.set": deferMethod({
    params: () =>
      z
        .object({
          id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,31}$/),
          provider: z
            .object({
              label: z.string().max(60).optional(),
              preset: z.string().max(32).optional(),
              transport: ProviderTransport,
              base_url: z.string().url(),
              models: z.array(z.string().min(1)).max(200).optional(),
              enabled: z.boolean().optional(),
              needs_key: z.boolean().optional(),
            })
            .strict()
            .nullable(),
          api_key: z.string().min(1).max(4000).optional(),
        })
        .strict(),
    result: () =>
      z.object({
        providers: z.array(ProviderInfo),
      }),
    effect: true,
    access: "human",
  }),
  /**
   * Tokens and turns by model since a date. `billing`: included = the owner's subscription (Claude Code, Codex, an
   * ACP agent); metered = a provider's API, paid per token. `aux`: the auxiliary model's calls outside any turn
   * (always metered). With `thread`, only that chat's, all it kept, and `totals` over every run of it (`seconds` at
   * work; `cached` prompt tokens are counted inside `input`).
   */
  "usage.summary": deferMethod({
    params: () =>
      z
        .object({
          since: z.string().optional(),
          project: Id.optional(),
          thread: Id.optional(),
        })
        .strict(),
    result: () =>
      z.object({
        since: z.string(),
        totals: z
          .object({
            runs: z.number().int(),
            failed: z.number().int(),
            seconds: z.number(),
            input: z.number().int(),
            output: z.number().int(),
            cached: z.number().int(),
          })
          .optional(),
        models: z.array(
          z.object({
            model: z.string(),
            billing: z.enum(["included", "metered"]),
            runs: z.number().int(),
            input: z.number().int(),
            output: z.number().int(),
          }),
        ),
        aux: z.array(
          z.object({
            purpose: AuxPurpose,
            model: z.string(),
            calls: z.number().int(),
            input: z.number().int(),
            output: z.number().int(),
          }),
        ),
      }),
    effect: false,
  }),
  /**
   * Notes agents keep between threads. With `query`, the best matches first (full-text, accents ignored). An agent
   * sees the owner's global notes, its thread's project notes and its own.
   */
  "memory.list": deferMethod({
    params: () =>
      z
        .object({
          query: z.string().max(500).optional(),
          scope: MemoryScope.optional(),
          project: Id.optional(),
          agent: Id.optional(),
          /** Only the notes waiting for the owner to confirm them (true), or only the ones that stand (false). */
          pending: z.boolean().optional(),
          /** The forgotten notes instead (the owner's only). */
          forgotten: z.boolean().optional(),
          limit: z.number().int().min(1).max(500).default(100),
        })
        .strict(),
    result: () =>
      z.object({
        memories: z.array(Memory),
      }),
    effect: false,
  }),
  /** Who the owner is, for their agents (name, about, language, time zone). */
  "owner.get": deferMethod({
    params: () => z.object({}).strict(),
    result: () => OwnerIdentity,
    effect: false,
    access: "human",
  }),
  "owner.set": deferMethod({
    params: () => OwnerPatch,
    result: () => OwnerIdentity,
    effect: true,
    access: "human",
  }),
  "memory.settings": deferMethod({
    params: () => z.object({}).strict(),
    result: () =>
      MemorySettings.extend({
        indexed: z.number().int(),
        total: z.number().int(),
        /** The embedding engine and model in use ("Ollama · bge-m3"), when one is set up. */
        embedder: z.string().optional(),
      }),
    effect: false,
    access: "human",
  }),
  "memory.set_settings": deferMethod({
    params: () => MemorySettings.strict(),
    result: () => MemorySettings,
    effect: true,
    access: "human",
  }),
  /** Indexes, by meaning, the notes not indexed yet with the current embedding engine. */
  "memory.reindex": deferMethod({
    params: () => z.object({}).strict(),
    result: () =>
      z.object({
        indexed: z.number().int(),
        total: z.number().int(),
        engine: z.string().optional(),
      }),
    effect: true,
    access: "human",
  }),
  "memory.maintenance": deferMethod({
    params: () =>
      z
        .object({
          backfill: z.boolean().optional(),
          dream: z.boolean().optional(),
        })
        .strict(),
    result: () =>
      z.object({
        queued: z.number().int(),
        jobs: MemoryJobs,
      }),
    effect: true,
    access: "human",
  }),
  "memory.history": deferMethod({
    params: () =>
      z
        .object({
          id: Id,
        })
        .strict(),
    result: () =>
      z.object({
        versions: z.array(
          z.object({
            revision: z.number().int(),
            note: Memory,
            reason: z.string(),
            at: z.string(),
          }),
        ),
      }),
    effect: false,
    access: "human",
  }),
  "memory.undo": deferMethod({
    params: () =>
      z
        .object({
          id: Id,
          revision: z.number().int().positive(),
          expected_revision: z.number().int().positive().optional(),
        })
        .strict(),
    result: () => Memory,
    effect: true,
    access: "human",
  }),
  "memory.consolidate": deferMethod({
    params: () =>
      z
        .object({
          notes: z
            .array(
              z.object({
                id: Id,
                revision: z.number().int().positive(),
              }),
            )
            .min(2)
            .max(8),
          /** `shared`: the notes the agent's place shares (the project's, or the global ones), not its own notebook. */
          shelf: z.enum(["notebook", "shared"]).optional(),
        })
        .strict(),
    result: () =>
      z.object({
        merged: z.boolean(),
      }),
    effect: true,
  }),
  /**
   * An agent tidies its own notebook: retires notes a newer one corrects (`by`) or that went stale, and rewrites
   * relative dates ("today") as the dates they meant. Refused when it would forget too many notes at once.
   */
  "memory.tidy": deferMethod({
    params: () =>
      z
        .object({
          retire: z
            .array(
              z.object({
                id: Id,
                revision: z.number().int().positive(),
                by: Id.optional(),
                by_revision: z.number().int().positive().optional(),
              }),
            )
            .max(8)
            .optional(),
          redate: z
            .array(
              z.object({
                id: Id,
                revision: z.number().int().positive(),
              }),
            )
            .max(32)
            .optional(),
          shelf: z.enum(["notebook", "shared"]).optional(),
        })
        .strict(),
    result: () =>
      z.object({
        retired: z.number().int(),
        redated: z.number().int(),
      }),
    effect: true,
  }),
  /** An agent's note goes to its own thread's project (`project`) or to itself (`agent`); `id` edits one in place. */
  "memory.add": deferMethod({
    params: () =>
      z
        .object({
          text: z.string().trim().min(1).max(2000),
          scope: MemoryScope,
          project: Id.optional(),
          agent: Id.optional(),
          id: Id.optional(),
          kind: Memory.shape.kind,
          evidence: z.array(MemoryEvidence).max(8).optional(),
          expected_revision: z.number().int().positive().optional(),
          /** Set by an agent's tool when outside content is in its turn (agents' notes default to tainted). */
          tainted: z.boolean().optional(),
        })
        .strict(),
    result: () => Memory,
    effect: true,
  }),
  /**
   * Forgets a note: out of every turn and search until the owner brings it back. An agent may forget only notes agents
   * wrote that it can see; the owner forgets any, and with `forever` deletes it for good.
   */
  "memory.remove": deferMethod({
    params: () =>
      z
        .object({
          id: Id,
          forever: z.boolean().optional(),
        })
        .strict(),
    result: () =>
      z.object({
        removed: z.boolean(),
      }),
    effect: true,
  }),
  /** The owner confirms a note an agent wrote about them, so it stands in every agent's turns. */
  "memory.confirm": deferMethod({
    params: () =>
      z
        .object({
          id: Id,
        })
        .strict(),
    result: () => Memory,
    effect: true,
    access: "human",
  }),
  /** The owner confirms several notes agents wrote about them at once; ids already confirmed or gone are skipped. */
  "memory.confirm_all": deferMethod({
    params: () =>
      z
        .object({
          ids: z.array(Id).min(1).max(500),
        })
        .strict(),
    result: () =>
      z.object({
        confirmed: z.number().int(),
      }),
    effect: true,
    access: "human",
  }),
  /** Brings a forgotten note back. */
  "memory.restore": deferMethod({
    params: () =>
      z
        .object({
          id: Id,
        })
        .strict(),
    result: () => Memory,
    effect: true,
    access: "human",
  }),
  /** The owner's channels (Telegram bots…), their settings and whether each is running. */
  "channels.list": deferMethod({
    params: () => z.object({}).strict(),
    result: () =>
      z.object({
        channels: z.array(ChannelInfo),
      }),
    effect: false,
    access: "human",
  }),
  /**
   * The channels as an agent sees them: each app APX talks through, whether it is up, and the rooms (shared places such
   * as a Discord #channel) it reads. No tokens, accounts or QR. Open to agents; people are in `contacts.list`.
   */
  "channels.overview": deferMethod({
    params: () => z.object({}).strict(),
    result: () =>
      z.object({
        channels: z.array(
          z.object({
            id: z.string(),
            type: ChannelType,
            label: z.string(),
            status: ChannelInfo.shape.status,
            rooms: z.array(
              z.object({
                name: z.string(),
                mode: RoomMode,
              }),
            ),
          }),
        ),
      }),
    effect: false,
  }),
  /**
   * Adds, changes or (null) removes a channel. `token` goes to the secret store and never comes back; the channel is
   * restarted with the new settings.
   */
  "channels.set": deferMethod({
    params: () =>
      z
        .object({
          id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,31}$/),
          channel: z
            .object({
              type: ChannelType,
              label: z.string().max(60).optional(),
              enabled: z.boolean().default(true),
              agent_id: Id,
              contacts_agent_id: Id.optional(),
              strangers: ChannelStrangers.default(CHANNEL_DEFAULTS.strangers),
              concurrency: z.enum(["queue", "interrupt", "steer"]).default(CHANNEL_DEFAULTS.concurrency),
              owner_thread: z.enum(["home", "own"]).default(CHANNEL_DEFAULTS.owner_thread),
              self_owner: z.boolean().optional(),
              rooms: ChannelRooms.optional(),
              reactions: z.boolean().optional(),
              research: ChannelResearch.default(CHANNEL_DEFAULTS.research),
              hours: ChannelHours.optional(),
              quiet: z.boolean().optional(),
              email: ChannelEmail.optional(),
              contacts: PersonPerms.optional(),
              knowledge: z.string().max(12000).optional(),
              rules: z.string().max(2000).optional(),
              owner_only: z.boolean().optional(),
              limits: ChannelLimits.optional(),
            })
            .nullable(),
          // A Google service account key travels whole (about 2.3 KB).
          token: z.string().min(8).max(8000).optional(),
        })
        .strict(),
    result: () =>
      z.object({
        channels: z.array(ChannelInfo),
      }),
    effect: true,
    access: "human",
  }),
  /**
   * The owner writes to a contact or a room themselves, in its chat ("I'll write"): sent as is on the channel (in a
   * room, through the bot's account, the room's people named as @handle mentioned) and kept in the chat.
   */
  "channels.send": deferMethod({
    params: () =>
      z
        .object({
          thread: Id,
          text: z.string().trim().min(1).max(4000),
          omit_signature: z.boolean().optional(),
        })
        .strict(),
    result: () =>
      z.object({
        ok: z.literal(true),
      }),
    effect: true,
    access: "human",
  }),
  /**
   * An agent writes to one of the owner's contacts (or to the owner, on a channel) for the owner ("tell Alex on
   * WhatsApp…", "send me the quote"): sent on
   * the contact's channel (the one given, else the one they talked on last) and kept in their chat, where their answer
   * arrives. `recent` is the end of that chat, so the agent knows what was already said. Never offered to a contact's
   * own turn.
   */
  "channels.message": deferMethod({
    params: () =>
      z
        .object({
          person: Id,
          text: z.string().trim().min(1).max(4000),
          omit_signature: z.boolean().optional(),
          /** A channel id or type ("whatsapp"); absent: the one the contact used last. */
          channel: z.string().max(60).optional(),
          /** Files to send with it (media ids): images as images, anything else as a document. */
          files: z.array(Id).max(5).optional(),
          /** To the owner, who asked to go on there: Home answers on that chat from now on (DECISIONS.md#d-224). */
          stay: z.boolean().optional(),
        })
        .strict(),
    result: () =>
      z.union([
        Sent.extend({
          moved: z.boolean().optional(),
        }),
        Withheld,
      ]),
    effect: true,
  }),
  /**
   * An agent posts in a public room for the owner (a Discord server's channel the owner listed: "post the summary in
   * #help"): kept in the room's chat and sent with no pings to everyone. `room` is its exact name, with or without "#".
   * Never offered to a contact's own turn.
   */
  "channels.post": deferMethod({
    params: () =>
      z
        .object({
          room: z.string().trim().min(1).max(80),
          text: z.string().trim().min(1).max(4000),
          /** A channel id or type ("discord"), for two rooms of the same name on different channels. */
          channel: z.string().max(60).optional(),
          /** Files to send with it (media ids): images as images, anything else as a document. */
          files: z.array(Id).max(5).optional(),
        })
        .strict(),
    result: () => Sent,
    effect: true,
  }),
} as const;
