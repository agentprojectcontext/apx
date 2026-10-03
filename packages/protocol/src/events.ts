// What the core pushes to connected clients.
import { z } from "zod";
import { TabInfo } from "./browser.ts";
import { Id, Job, Message, Part, Run, SurfaceSummary, Thread } from "./domain.ts";
import { Notification, Task } from "./office.ts";

/** Events pushed to every operator socket. `stream` groups the seq counter. */
export const CoreEvent = z.discriminatedUnion("type", [
  z.object({ type: z.literal("thread.updated"), thread: Thread }),
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
]);
export type CoreEvent = z.infer<typeof CoreEvent>;
