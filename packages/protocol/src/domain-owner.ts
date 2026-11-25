import { z } from "zod";
import { Id } from "./domain-projects.ts";
import { schemaFields } from "./schema-fields.ts";

/**
 * How memory works: notes searched by their words (default), also by meaning (an embedding model indexes them), or
 * no memory at all. And how long chats are kept small: summaries by an auxiliary model.
 */
/**
 * Who the owner is, as every agent working for them knows it: their name, a few lines about them, the language agents
 * answer in and the time zone their day runs on.
 */
export const OwnerIdentity = z.object(
  schemaFields({
    name: () => z.string().trim().max(80).default(""),
    /** How the owner wants to be called ("Nora"); empty: by their name. */
    call_me: () => z.string().trim().max(80).default(""),
    about: () => z.string().max(2000).default(""),
    /** ISO 639-1 ("es", "en"). */
    language: () =>
      z
        .string()
        .regex(/^[a-z]{2}$/)
        .default("es"),
    /** IANA ("America/Argentina/Buenos_Aires"); empty: this machine's. */
    timezone: () => z.string().max(60).default(""),
    /**
     * Publishing a task's work that can be undone (a plain push of a branch): `auto` runs it in Auto, `ask` waits for the
     * owner in every mode. A release, a tag or a forced push always waits (DECISIONS.md#d-208).
     */
    publish: () => z.enum(["auto", "ask"]).default("auto"),
  }),
);
export type OwnerIdentity = z.infer<typeof OwnerIdentity>;
/**
 * What `owner.set` changes: only the fields given. Defaults stay out, so saving one field never resets the others.
 */
export const OwnerPatch = z
  .object(
    schemaFields({
      name: () => z.string().trim().max(80),
      call_me: () => z.string().trim().max(80),
      about: () => z.string().max(2000),
      language: () => z.string().regex(/^[a-z]{2}$/),
      timezone: () => z.string().max(60),
      publish: () => z.enum(["auto", "ask"]),
    }),
  )
  .partial()
  .strict();

export const MemorySettings = z.object(
  schemaFields({
    mode: () => z.enum(["notes", "semantic", "off"]),
    /** Each message picks the skills it calls for by meaning (needs an embedding engine). */
    skill_picker: () => z.boolean().default(true),
    /** Summarize long chats' older turns automatically. */
    auto_compact: () => z.boolean(),
    auto_recall: () => z.boolean().optional(),
    auto_capture: () => z.boolean().optional(),
    auto_dream: () => z.boolean().optional(),
    daily_memory_calls: () => z.number().int().min(0).max(200).optional(),
    /**
     * The helper model for background work (titles, summaries, memory, judging, images…): an ordered comma-separated
     * chain of model refs, the first tried first; "off"; or none (the agent's own API models).
     */
    aux_model: () => z.string().max(1000).optional(),
  }),
);
export type MemorySettings = z.infer<typeof MemorySettings>;

/** How APX reaches the owner when they are not looking at the app. */
export const NoticePrefs = z.object(
  schemaFields({
    /**
     * Which chat app the super-agent also writes to unasked: a channel (its id), "none" for the app only, or unset for the
     * first running channel that knows the owner. The app and paired phones are told either way (engine/notice-push.ts).
     */
    channel: () => z.string().optional(),
    /**
     * Quiet hours ("HH:MM" in the owner's time zone): what APX would say unasked waits until they end (and then goes together); answers
     * and questions still arrive, without sound.
     */
    quiet_from: () =>
      z
        .string()
        .regex(/^\d{2}:\d{2}$/)
        .optional(),
    quiet_to: () =>
      z
        .string()
        .regex(/^\d{2}:\d{2}$/)
        .optional(),
    /** A confirmation or question unanswered in the app this long also goes to the channel (0 = never). */
    inputs_after_s: () => z.number().int().min(0).max(86_400).default(120),
    /** Messages APX may send unasked in a day, besides the ones that always arrive (0 = no cap). */
    budget_per_day: () => z.number().int().min(0).max(50).default(3),
    /** Least time between two unasked messages about the same project, and of the same kind (minutes; 0 = none). */
    project_gap_min: () => z.number().int().min(0).max(1440).default(180),
    kind_gap_min: () => z.number().int().min(0).max(1440).default(120),
    /** Something critical may go past the daily cap; and, separately, may arrive during quiet hours. */
    critical_skips_budget: () => z.boolean().default(true),
    critical_wakes: () => z.boolean().default(false),
  }),
);
export type NoticePrefs = z.infer<typeof NoticePrefs>;

/** One message APX meant to send unasked, and what the interruption budget did with it. */
export const Nudge = z.object(
  schemaFields({
    id: () => Id,
    at: () => z.string(),
    /** What it is about: "routine:<name>", "reminder", "digest"… */
    kind: () => z.string(),
    text: () => z.string(),
    thread_id: () => Id.optional(),
    project_id: () => Id.optional(),
    /** sent; held (quiet hours, it goes when they end); dropped (over the cap or too soon after another); merged (held,
     * then sent inside a digest, or told in the team news); relay (another agent's news, waiting for the super-agent's
     * team news); no_channel (nowhere to send it). */
    state: () => z.enum(["sent", "held", "dropped", "merged", "relay", "no_channel"]),
    reason: () => z.string().optional(),
    /** It always arrives (an anchor like the morning brief) or went past the cap as critical: not counted. */
    exempt: () => z.boolean(),
    /** The owner's 👍/👎 on it. */
    feedback: () => z.enum(["up", "down"]).optional(),
  }),
);
export type Nudge = z.infer<typeof Nudge>;
