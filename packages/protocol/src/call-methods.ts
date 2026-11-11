// Voice calls with the super-agent: each call is a thread of kind "call". The owner talks to a fast voice model on
// this machine; what needs real work goes to the super-agent inside the call, shown there as a card.
import { z } from "zod";
import { Id } from "./domain.ts";

export const CallVoice = z.enum(["female", "male"]);
export type CallVoice = z.infer<typeof CallVoice>;

/** Whether calls can run here, and why not when they can't. */
export const CallStatus = z.object({
  /** Everything a call needs is on this machine. */
  ready: z.boolean(),
  /** The voice engine is loaded now (a call starts at once); otherwise the first call loads it. */
  running: z.boolean(),
  /** What is missing when not ready. */
  missing: z.enum(["platform", "uv", "voice"]).optional(),
  /** The call going on now, if any. */
  live: Id.optional(),
});
export type CallStatus = z.infer<typeof CallStatus>;

const Ok = z.object({ ok: z.literal(true) });

export const callMethods = {
  "calls.status": {
    params: z.object({}).strict(),
    result: CallStatus,
    effect: false,
    access: "human",
  },
  /**
   * Opens a call: its thread, and a single-use ticket for the /voice-call socket that carries the audio both ways
   * (16 kHz mono PCM up, 24 kHz mono PCM down) and the call's live state as JSON text frames.
   */
  "calls.start": {
    params: z
      .object({
        voice: CallVoice.default("female"),
        lang: z.enum(["es", "en"]).optional(),
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
