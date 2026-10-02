// Methods behind the composer: attachments, dictation and the chat's own model.
import { z } from "zod";
import { Id, ModelChoice } from "./domain.ts";

/** What can be attached: images the model can look at, and text it can read (PDFs and others are only listed). */
// 5 MB is the largest image every provider takes (Anthropic's limit).
export const UPLOAD_LIMITS = { imageBytes: 5 * 1024 * 1024, fileBytes: 2 * 1024 * 1024 } as const;

export const composerMethods = {
  /** Stores a file the owner attaches (base64); it reaches a message through threads.send `attachments`. */
  "media.upload": {
    params: z
      .object({
        name: z.string().trim().min(1).max(200),
        mime: z.string().max(100),
        /** base64; images up to 5 MB, other files up to 2 MB. */
        data: z.string().max(Math.ceil((UPLOAD_LIMITS.imageBytes * 4) / 3) + 8),
        thread: Id.optional(),
      })
      .strict(),
    result: z.object({
      media: z.object({
        id: Id,
        kind: z.enum(["image", "file"]),
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
    params: z.object({ data: z.string().max(14_000_000), mime: z.string().max(100), thread: Id.optional() }).strict(),
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
