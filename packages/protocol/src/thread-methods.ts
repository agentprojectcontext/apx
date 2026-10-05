// The owner's arrangement of a chat: its name, pinned, archived, and deleting it.
import { z } from "zod";
import { Id, Thread, WritePolicy } from "./domain.ts";

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
} as const;
