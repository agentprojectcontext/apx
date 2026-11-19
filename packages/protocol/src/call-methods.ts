// Calls use configured services on any desktop platform, or APX's local voice on supported Apple silicon Macs.
// Each call keeps a thread; work requested during it goes to the agent while the conversation continues.
import { z } from "zod";
import { deferMethod } from "./defer-method.ts";
import { Id, ModelRef } from "./domain.ts";
import { schemaFields } from "./schema-fields.ts";

export const CallVoice = z.enum(["female", "male"]);
export type CallVoice = z.infer<typeof CallVoice>;

/** The accents APX's own voice speaks: Argentine Spanish, neutral Spanish, American English. */
export const VoiceLocale = z.enum(["es-AR", "es", "en-US"]);
export type VoiceLocale = z.infer<typeof VoiceLocale>;

/** One of APX's own voices: `<locale>-<gender>`, e.g. "es-AR-female". */
export const NativeVoice = z.object(
  schemaFields({
    gender: () => CallVoice,
    locale: () => VoiceLocale,
  }),
);
export type NativeVoice = z.infer<typeof NativeVoice>;

/**
 * What this machine can do with APX's own voice. `full`: the larger voice and transcription models; `light`: smaller
 * ones (less memory, a little less natural); `none`: it cannot run here.
 */
export const VoiceTier = z.enum(["full", "light", "none"]);
export type VoiceTier = z.infer<typeof VoiceTier>;

/** Which models the owner wants: `auto` is the lighter ones on a Mac with less than 32 GB, the larger ones above. */
export const VoiceQuality = z.enum(["auto", "light", "full"]);
export type VoiceQuality = z.infer<typeof VoiceQuality>;

/** Why APX's own voice cannot run here: not a Mac with Apple silicon, too little memory, or uv is missing. */
export const VoiceMissing = z.enum(["platform", "memory", "uv"]);
export type VoiceMissing = z.infer<typeof VoiceMissing>;

export const VoiceStatus = z.object(
  schemaFields({
    tier: () => VoiceTier,
    memory_gb: () => z.number(),
    missing: () => VoiceMissing.optional(),
    /** The owner turned it on (by default: on wherever it can run). */
    enabled: () => z.boolean(),
    /** Its models are downloaded. */
    installed: () => z.boolean(),
    /** What hears is downloaded (alone, or with the rest): APX transcribes even where it does not speak. */
    hears_installed: () => z.boolean(),
    /** A download in progress, or the one that failed. */
    install: () =>
      z
        .object(
          schemaFields({
            state: () => z.enum(["downloading", "failed"]),
            received: () => z.number(),
            total: () => z.number(),
            error: () => z.string().optional(),
            /** What it downloads: every model, or (`ears`) only what hears. */
            part: () => z.enum(["all", "ears"]).optional(),
          }),
        )
        .optional(),
    /** Loaded now: a call or a voice note starts at once; otherwise the first one loads it. */
    running: () => z.boolean(),
    /** The voice agents speak with, and the one a call starts with. */
    voice: () => NativeVoice,
    /** Calls are offered (the owner may want APX's voice without calls). */
    calls: () => z.boolean(),
    quality: () => VoiceQuality,
    /** This Mac has the memory for the larger models (16 GB or more). */
    can_full: () => z.boolean(),
    /**
     * The model a call talks with: absent, the owner's main model; otherwise a model APX has (any provider, including a
     * server of their own added as a provider). The agent called works with its own model either way.
     */
    call_model: () => ModelRef.optional(),
    /** Local MLX voice, or the owner's configured speech and transcription services. */
    call_engine: () => z.enum(["native", "services"]).optional(),
    call_speech: () => Id.optional(),
    call_transcription: () => Id.optional(),
    /** What this Mac's voice is made of and where it is kept (absent where it cannot run). */
    models: () =>
      z
        .object(
          schemaFields({
            /** The model that speaks. */
            speaks: () => z.string(),
            /** The model that hears (voice notes, dictation and calls). */
            hears: () => z.string(),
            /** About how much it downloads, all models together. */
            size_gb: () => z.number(),
            /** About how much only what hears downloads. */
            hears_gb: () => z.number(),
            /** The folder the models are kept in. */
            folder: () => z.string(),
          }),
        )
        .optional(),
  }),
);
export type VoiceStatus = z.infer<typeof VoiceStatus>;

/** Whether calls can run here, and why not when they can't. */
export const CallStatus = z.object(
  schemaFields({
    /** Everything a call needs is on this machine. */
    ready: () => z.boolean(),
    engine: () => z.enum(["native", "services"]).optional(),
    /** The voice engine is loaded now (a call starts at once); otherwise the first call loads it. */
    running: () => z.boolean(),
    /**
     * What is missing when not ready: the voice cannot run here, is off, there is no model to talk with, or the owner
     * turned calls off (`disabled`: no call buttons).
     */
    missing: () =>
      z.enum(["platform", "memory", "uv", "off", "model", "disabled", "speech", "transcription"]).optional(),
    /** The call going on now, if any. */
    live: () => Id.optional(),
    /** The voice a call starts with. */
    voice: () => NativeVoice.optional(),
  }),
);
export type CallStatus = z.infer<typeof CallStatus>;

const Ok = z.object(
  schemaFields({
    ok: () => z.literal(true),
  }),
);

export const callMethods = {
  "voice.status": deferMethod({
    params: () => z.object({}).strict(),
    result: () => VoiceStatus,
    effect: false,
    access: "human",
  }),
  /** Downloads the voice's models (done on its own where the machine can run it well). */
  "voice.install": deferMethod({
    /** `ears`: only what hears (transcription), without APX's speaking voice. */
    params: () => z.object({ part: z.enum(["all", "ears"]).optional() }).strict(),
    result: () => VoiceStatus,
    effect: true,
    access: "human",
  }),
  /**
   * Turns APX's own voice on or off, picks its voice, turns calls on or off, and picks the model calls talk with
   * (`null`: the main model).
   */
  "voice.set": deferMethod({
    params: () =>
      z
        .object({
          enabled: z.boolean().optional(),
          voice: NativeVoice.optional(),
          calls: z.boolean().optional(),
          quality: VoiceQuality.optional(),
          call_model: ModelRef.nullable().optional(),
          call_engine: z.enum(["native", "services"]).optional(),
          call_speech: Id.nullable().optional(),
          call_transcription: Id.nullable().optional(),
        })
        .strict(),
    result: () => VoiceStatus,
    effect: true,
    access: "human",
  }),
  "calls.status": deferMethod({
    params: () => z.object({}).strict(),
    result: () => CallStatus,
    effect: false,
    access: "human",
  }),
  /**
   * Opens a call with an agent (the super-agent when none is named): its thread, and a single-use ticket for the
   * /voice-call socket that carries the audio both ways (16 kHz mono PCM up, 24 kHz mono PCM down) and the call's live
   * state as JSON text frames.
   */
  "calls.start": deferMethod({
    params: () =>
      z
        .object({
          agent_id: Id.optional(),
          voice: CallVoice.optional(),
          locale: VoiceLocale.optional(),
          /** Calling again from a call's chat goes on in that thread. */
          thread: Id.optional(),
        })
        .strict(),
    result: () =>
      z.object({
        thread_id: Id,
        ticket: z.string(),
        expires_in: z.number(),
      }),
    effect: true,
    access: "human",
    replay: false,
  }),
  /** The call card is open: the voice starts loading what a call needs, so the call begins without a wait. */
  "calls.prepare": deferMethod({
    params: () => z.object({}).strict(),
    result: () => Ok,
    effect: false,
    access: "human",
  }),
  /** Words the owner types in the chat of the call going on: the voice takes them as said and answers aloud. */
  "calls.say": deferMethod({
    params: () =>
      z
        .object({
          thread_id: Id,
          text: z.string().trim().min(1).max(4000),
        })
        .strict(),
    result: () => Ok,
    effect: true,
    access: "human",
  }),
  "calls.end": deferMethod({
    params: () =>
      z
        .object({
          thread_id: Id,
        })
        .strict(),
    result: () => Ok,
    effect: true,
    access: "human",
  }),
} as const;

/** Live frames on the /voice-call socket, from the core to the panel (audio travels as binary frames). */
export const CallFrame = z.discriminatedUnion("type", [
  /** The engine is loading its models (the first call after a while): how far it got and about how long is left. */
  z.object(
    schemaFields({
      type: () => z.literal("preparing"),
      progress: () => z.number().min(0).max(1).optional(),
      left_s: () => z.number().min(0).optional(),
    }),
  ),
  z.object(
    schemaFields({
      type: () => z.literal("ready"),
    }),
  ),
  /** What the owner is saying right now; the final words arrive as a message in the thread. */
  z.object(
    schemaFields({
      type: () => z.literal("partial"),
      text: () => z.string(),
    }),
  ),
  /** The owner talked over the voice: drop the audio not played yet. */
  z.object(
    schemaFields({
      type: () => z.literal("interrupted"),
    }),
  ),
  z.object(
    schemaFields({
      type: () => z.literal("state"),
      state: () => z.enum(["listening", "thinking", "speaking"]),
    }),
  ),
  z.object(
    schemaFields({
      type: () => z.literal("end"),
      reason: () => z.string(),
    }),
  ),
]);
export type CallFrame = z.infer<typeof CallFrame>;
