// APX's own voice and voice calls. The voice runs on this machine (Apple silicon): it speaks the agents' voice notes,
// transcribes what the owner records, and carries calls. A call is a thread of kind "call" with one agent: the owner
// talks with a model (their main one unless they pick another), and what needs real work goes to that agent inside the
// call, shown there as a card.
import { z } from "zod";
import { Id, ModelRef } from "./domain.ts";

export const CallVoice = z.enum(["female", "male"]);
export type CallVoice = z.infer<typeof CallVoice>;

/** The accents APX's own voice speaks: Argentine Spanish, neutral Spanish, American English. */
export const VoiceLocale = z.enum(["es-AR", "es", "en-US"]);
export type VoiceLocale = z.infer<typeof VoiceLocale>;

/** One of APX's own voices: `<locale>-<gender>`, e.g. "es-AR-female". */
export const NativeVoice = z.object({ gender: CallVoice, locale: VoiceLocale });
export type NativeVoice = z.infer<typeof NativeVoice>;

/**
 * What this machine can do with APX's own voice. `full`: the larger voice and transcription models; `light`: smaller
 * ones (less memory, a little less natural); `none`: it cannot run here.
 */
export const VoiceTier = z.enum(["full", "light", "none"]);
export type VoiceTier = z.infer<typeof VoiceTier>;

/** Why APX's own voice cannot run here: not a Mac with Apple silicon, too little memory, or uv is missing. */
export const VoiceMissing = z.enum(["platform", "memory", "uv"]);
export type VoiceMissing = z.infer<typeof VoiceMissing>;

export const VoiceStatus = z.object({
  tier: VoiceTier,
  memory_gb: z.number(),
  missing: VoiceMissing.optional(),
  /** The owner turned it on (by default: on wherever it can run). */
  enabled: z.boolean(),
  /** Its models are downloaded. */
  installed: z.boolean(),
  /** A download in progress, or the one that failed. */
  install: z
    .object({
      state: z.enum(["downloading", "failed"]),
      received: z.number(),
      total: z.number(),
      error: z.string().optional(),
    })
    .optional(),
  /** Loaded now: a call or a voice note starts at once; otherwise the first one loads it. */
  running: z.boolean(),
  /** The voice agents speak with, and the one a call starts with. */
  voice: NativeVoice,
  /**
   * The model a call talks with: absent, the owner's main model; otherwise a model APX has (any provider, including a
   * server of their own added as a provider). The agent called works with its own model either way.
   */
  call_model: ModelRef.optional(),
});
export type VoiceStatus = z.infer<typeof VoiceStatus>;

/** Whether calls can run here, and why not when they can't. */
export const CallStatus = z.object({
  /** Everything a call needs is on this machine. */
  ready: z.boolean(),
  /** The voice engine is loaded now (a call starts at once); otherwise the first call loads it. */
  running: z.boolean(),
  /** What is missing when not ready: the voice cannot run here, is off, or there is no model to talk with. */
  missing: z.enum(["platform", "memory", "uv", "off", "model"]).optional(),
  /** The call going on now, if any. */
  live: Id.optional(),
  /** The voice a call starts with. */
  voice: NativeVoice.optional(),
});
export type CallStatus = z.infer<typeof CallStatus>;

const Ok = z.object({ ok: z.literal(true) });

export const callMethods = {
  "voice.status": {
    params: z.object({}).strict(),
    result: VoiceStatus,
    effect: false,
    access: "human",
  },
  /** Downloads the voice's models (done on its own where the machine can run it well). */
  "voice.install": {
    params: z.object({}).strict(),
    result: VoiceStatus,
    effect: true,
    access: "human",
  },
  /** Turns APX's own voice on or off, picks its voice, and the model calls talk with (`null`: the main model). */
  "voice.set": {
    params: z
      .object({
        enabled: z.boolean().optional(),
        voice: NativeVoice.optional(),
        call_model: ModelRef.nullable().optional(),
      })
      .strict(),
    result: VoiceStatus,
    effect: true,
    access: "human",
  },
  "calls.status": {
    params: z.object({}).strict(),
    result: CallStatus,
    effect: false,
    access: "human",
  },
  /**
   * Opens a call with an agent (the super-agent when none is named): its thread, and a single-use ticket for the
   * /voice-call socket that carries the audio both ways (16 kHz mono PCM up, 24 kHz mono PCM down) and the call's live
   * state as JSON text frames.
   */
  "calls.start": {
    params: z
      .object({
        agent_id: Id.optional(),
        voice: CallVoice.optional(),
        locale: VoiceLocale.optional(),
        /** Calling again from a call's chat goes on in that thread. */
        thread: Id.optional(),
      })
      .strict(),
    result: z.object({ thread_id: Id, ticket: z.string(), expires_in: z.number() }),
    effect: true,
    access: "human",
    replay: false,
  },
  "calls.end": {
    params: z.object({ thread_id: Id }).strict(),
    result: Ok,
    effect: true,
    access: "human",
  },
} as const;

/** Live frames on the /voice-call socket, from the core to the panel (audio travels as binary frames). */
export const CallFrame = z.discriminatedUnion("type", [
  /** The engine is loading its models (the first call after a while). */
  z.object({ type: z.literal("preparing") }),
  z.object({ type: z.literal("ready") }),
  /** What the owner is saying right now; the final words arrive as a message in the thread. */
  z.object({ type: z.literal("partial"), text: z.string() }),
  /** The owner talked over the voice: drop the audio not played yet. */
  z.object({ type: z.literal("interrupted") }),
  z.object({ type: z.literal("state"), state: z.enum(["listening", "thinking", "speaking"]) }),
  z.object({ type: z.literal("end"), reason: z.string() }),
]);
export type CallFrame = z.infer<typeof CallFrame>;
