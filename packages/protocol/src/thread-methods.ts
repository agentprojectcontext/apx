// The owner's arrangement of a chat: its name, pinned, archived, and deleting it.
import { z } from "zod";
import { DocumentSource, Id, Message, Run, Thread, WritePolicy } from "./domain.ts";

export const threadMethods = {
  /**
   * Renames, pins or archives a chat; only what is given changes. `title: null` (or empty) goes back to the automatic
   * title. Home cannot be archived.
   */
  "threads.update": {
    params: z
      .object({
        thread: Id,
        title: z.string().trim().max(200).nullable().optional(),
        pinned: z.boolean().optional(),
        archived: z.boolean().optional(),
        /**
         * The chat works in its project's folder with this write policy, like a code session (its tools and engines
         * follow it); null: it stops. A code session always keeps its folder.
         */
        write: WritePolicy.nullable().optional(),
      })
      .strict(),
    result: Thread,
    effect: true,
    access: "human",
  },
  /**
   * Deletes a chat for good: its messages, runs, sub-threads and what pointed at them. Refused for Home, for a task's
   * chat (delete the task) and while a turn or a job runs in it (stop it first).
   */
  "threads.delete": {
    params: z.object({ thread: Id }).strict(),
    result: z.object({ deleted: z.array(Id) }),
    effect: true,
    access: "human",
  },
  /**
   * Edits one of the owner's messages, or asks again for an answer: the chat goes back to that message of the owner
   * (for an agent's answer, the owner's message that asked for it), it and everything after it go, what the agent saw
   * of them too, and it is sent again: `text` when editing, the same words (and files) otherwise. Refused while a turn
   * runs (stop it first), in a channel's chat (those messages were delivered) and in an engine session (Claude Code,
   * Codex: they keep their own history).
   */
  "threads.rewind": {
    params: z.object({ thread: Id, message: Id, text: z.string().trim().min(1).max(50_000).optional() }).strict(),
    result: z.object({ message: Message, run: Run }),
    effect: true,
    access: "human",
  },
  /**
   * A new chat with this one's history up to a message, what the agent saw of it too; the original stays as it is. At
   * an agent's answer the copy ends with that whole answer; at an owner's message it ends just before it, and its words
   * come back as `draft` to send (or change) in the new chat. Refused while a turn runs, in an engine session and in a
   * chat of several agents.
   */
  "threads.fork": {
    params: z.object({ thread: Id, message: Id, title: z.string().trim().max(200).optional() }).strict(),
    result: z.object({ thread: Thread, draft: z.string().optional() }),
    effect: true,
    access: "human",
  },
  /**
   * The documents in a project's chats (without `project_id`: the chats with no project), or in one chat with
   * `thread_id`, newest first: each file once, with the chat it is in. They open in the side panel (media.get).
   */
  "documents.list": {
    params: z.object({ project_id: Id.optional(), thread_id: Id.optional() }).strict(),
    result: z.object({
      documents: z.array(
        z.object({
          media_id: Id,
          title: z.string(),
          name: z.string(),
          format: z.enum(["markdown", "text"]),
          source: DocumentSource.optional(),
          bytes: z.number().int(),
          thread_id: Id,
          thread_title: z.string(),
          created_at: z.string(),
        }),
      ),
    }),
    effect: false,
    access: "human",
  },
} as const;
