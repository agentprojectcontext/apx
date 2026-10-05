// The owner's arrangement of a chat: its name, pinned, archived, and deleting it.
import { z } from "zod";
import { Id, Message, Run, Thread, WritePolicy } from "./domain.ts";

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
} as const;
