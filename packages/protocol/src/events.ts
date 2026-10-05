// What the core pushes to connected clients.
import { z } from "zod";
import { TabInfo } from "./browser.ts";
import { Id, Job, Message, Part, Run, SurfaceSummary, Thread } from "./domain.ts";
import { Notification, Task } from "./office.ts";

/** Events pushed to every operator socket. `stream` groups the seq counter. */
export const CoreEvent = z.discriminatedUnion("type", [
  z.object({ type: z.literal("thread.updated"), thread: Thread }),
  /** The owner deleted the thread (and its sub-threads, listed in `children`). */
  z.object({ type: z.literal("thread.deleted"), thread_id: Id, children: z.array(Id) }),
  z.object({ type: z.literal("message.created"), message: Message }),
  z.object({ type: z.literal("message.updated"), message: Message }),
  /** One part of a message changed (streaming text, a tool card): cheaper than resending the whole message. */
  z.object({
    type: z.literal("message.part"),
    thread_id: Id,
    message_id: Id,
    index: z.number().int().nonnegative(),
    part: Part,
  }),
  z.object({ type: z.literal("run.updated"), run: Run }),
  z.object({ type: z.literal("job.updated"), job: Job }),
  z.object({ type: z.literal("task.updated"), task: Task }),
  z.object({ type: z.literal("notification.updated"), notification: Notification }),
  z.object({ type: z.literal("surface.updated"), surface: SurfaceSummary }),
  z.object({ type: z.literal("browser.tabs"), tabs: z.array(TabInfo) }),
  /** What a terminal printed (text as it came: escape codes and all). */
  z.object({ type: z.literal("terminal.output"), terminal: Id, data: z.string() }),
  /** Its shell ended. */
  z.object({ type: z.literal("terminal.exited"), terminal: Id, exit_code: z.number().int().optional() }),
]);
export type CoreEvent = z.infer<typeof CoreEvent>;
