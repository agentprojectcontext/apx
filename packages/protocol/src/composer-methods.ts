// Methods behind the composer: attachments, dictation and the chat's own model.
import { z } from "zod";
import { UPLOAD_LIMITS } from "./constants.ts";
import { Id, ModelChoice } from "./domain.ts";

export const composerMethods = {
  /** Snapshots a local file for the calling agent's current chat. */
  "media.attach": {
    params: z.object({ path: z.string().trim().min(1).max(1000), document: z.boolean().optional() }).strict(),
    result: z.object({
      media: z.object({
        id: Id,
        kind: z.enum(["image", "audio", "file"]),
        mime: z.string(),
        bytes: z.number().int(),
        name: z.string(),
      }),
    }),
    effect: true,
  },
  /** Stores a file the owner attaches (base64); it reaches a message through threads.send `attachments`. */
  "media.upload": {
    params: z
      .object({
        name: z.string().trim().min(1).max(200),
        mime: z.string().max(100),
        /** base64; audio up to 10 MB, images up to 5 MB, other files up to 2 MB. */
        data: z.string().max(Math.ceil((UPLOAD_LIMITS.audioBytes * 4) / 3) + 8),
        thread: Id.optional(),
      })
      .strict(),
    result: z.object({
      media: z.object({
        id: Id,
        kind: z.enum(["image", "audio", "file"]),
        mime: z.string(),
        bytes: z.number().int(),
        name: z.string(),
      }),
    }),
    effect: true,
    access: "human",
  },
  /** Speech to text for the composer's microphone: the words go into the field, nothing is sent. */
  "media.transcribe": {
    params: z
      .object({
        data: z.string().max(14_000_000).optional(),
        mime: z.string().max(100).optional(),
        media_id: Id.optional(),
        thread: Id.optional(),
      })
      .strict()
      .refine(
        (a) =>
          a.media_id ? a.data === undefined && a.mime === undefined : a.data !== undefined && a.mime !== undefined,
        {
          message: "give media_id or data and mime",
        },
      ),
    result: z.object({ text: z.string(), service: z.string() }),
    effect: false,
    access: "human",
  },
  /** The chat's own model: tried before the agent's. null goes back to the agent's choice. */
  "threads.model": {
    params: z.object({ thread: Id, model_choice: ModelChoice.nullable() }).strict(),
    result: z.object({ model_choice: ModelChoice.optional() }),
    effect: true,
    access: "human",
  },
} as const;
