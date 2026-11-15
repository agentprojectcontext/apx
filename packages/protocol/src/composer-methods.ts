// Methods behind the composer: attachments, dictation and the chat's own model.
import { z } from "zod";
import { UPLOAD_LIMITS } from "./constants.ts";
import { DocumentSource, Id, ModelChoice } from "./domain.ts";

export const composerMethods = {
  /** Discards only a temporary task upload, never an existing chat or task attachment. */
  "media.discard": {
    params: z.object({ id: Id }).strict(),
    result: z.object({ discarded: Id }),
    effect: true,
    access: "human",
  },
  /** Snapshots a readable local file or owner-chat/task media id for the calling agent's current chat. */
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
      /** With `document`: where the file is in the chat. */
      source: DocumentSource.optional(),
    }),
    effect: true,
  },
  /** Stores a file the owner attaches (base64); it reaches a message through threads.send `attachments`. */
  "media.upload": {
    params: z
      .object({
        name: z.string().trim().min(1).max(200),
        mime: z.string().max(100),
        /** Base64; per-kind decoded limits are enforced when storing the upload. */
        data: z
          .string()
          .max(
            Math.ceil((Math.max(UPLOAD_LIMITS.fileBytes, UPLOAD_LIMITS.audioBytes, UPLOAD_LIMITS.imageBytes) * 4) / 3) +
              8,
          ),
        thread: Id.optional(),
        task_asset: z.boolean().optional(),
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
  /**
   * Speech to text for the composer's microphone (the words go into the field, nothing is sent), or for an agent
   * reading an audio file it attached in its own chat (`media_id`).
   */
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
  },
  /**
   * What the composer's microphone has heard so far, shown while it records. Only a transcription engine on this
   * machine answers (nothing is stored and nothing leaves it); `live` is false when there is none.
   */
  "media.listen": {
    params: z.object({ data: z.string().max(14_000_000), mime: z.string().max(100) }).strict(),
    result: z.object({ text: z.string(), live: z.boolean() }),
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
