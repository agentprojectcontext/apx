// What the core pushes to connected clients.
import { z } from "zod";
import { TabInfo } from "./browser.ts";
import { Id, Job, Message, Part, Run, SurfaceState, SurfaceSummary, Thread } from "./domain.ts";
import { Notification, Task } from "./office.ts";

/** Events pushed to every operator socket. `stream` groups the seq counter. */
export const CoreEvent = z.discriminatedUnion("type", [
  z.object({ type: z.literal("thread.updated"), thread: Thread }),
  /** The owner deleted the thread (and its sub-threads, listed in `children`). */
  z.object({ type: z.literal("thread.deleted"), thread_id: Id, children: z.array(Id) }),
  z.object({ type: z.literal("message.created"), message: Message }),
  /** Messages taken out of a thread: the owner rewound it to edit a message or ask for another answer. */
  z.object({ type: z.literal("message.deleted"), thread_id: Id, message_ids: z.array(Id) }),
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
  /** A task was deleted for good (its conversation goes as a thread.deleted). */
  z.object({ type: z.literal("task.deleted"), task_id: Id }),
  z.object({ type: z.literal("notification.updated"), notification: Notification }),
  z.object({ type: z.literal("surface.updated"), surface: SurfaceSummary }),
  /** A widget the owner deleted, with what it remembered: lists drop it. */
  z.object({ type: z.literal("surface.deleted"), surface_id: Id }),
  /** A widget's remembered state changed (the widget or its agent wrote it): open copies take it live. */
  z.object({ type: z.literal("surface.state"), surface_id: Id, state: SurfaceState }),
  /**
   * A Flow's saved drawing changed: a draft saved, discarded or published, or a Flow made with one. `by` is the agent
   * whose tool did it, null for the owner. An open screen reloads that Flow's drawing.
   */
  z.object({
    type: z.literal("flow.draft"),
    flow: z.string(),
    project: z.string(),
    draft_version: z.number().int().nullable(),
    by: z.string().nullable(),
  }),
  /**
   * A Flow's test (DECISIONS.md#d-178): it started waiting for an event until `until`, stopped or ran out of time, one
   * arrived and started the run `event`, or one arrived that the drawing could not take.
   */
  z.object({
    type: z.literal("flow.test"),
    flow: z.string(),
    state: z.enum(["listening", "stopped", "expired", "received", "refused"]),
    until: z.string().nullable(),
    event: z.string().nullable(),
  }),
  /**
   * A drawn Flow's run moved: a step started or ended, or the run ended. Ids and states only; what each step was given
   * and gave back is read with `flows.run_get`.
   */
  z.object({
    type: z.literal("flow.run"),
    flow: z.string(),
    event: z.string(),
    state: z.enum(["pending", "succeeded", "failed", "uncertain", "cancelled", "ignored"]),
    test: z.boolean(),
    steps: z.array(z.object({ node: z.string(), state: z.string() })),
  }),
  /** Agents or projects changed (from any client, an agent's tool or a project's files): reload both lists. */
  z.object({ type: z.literal("team.updated") }),
  z.object({ type: z.literal("browser.tabs"), tabs: z.array(TabInfo) }),
  /** A chat waits on the computer its agent started: Linux set up the first time, booting, then ready or not. */
  z.object({
    type: z.literal("computer.progress"),
    thread_id: Id,
    stage: z.enum(["creating", "loading", "ready", "failed"]),
  }),
  /** What a terminal printed (text as it came: escape codes and all). */
  z.object({ type: z.literal("terminal.output"), terminal: Id, data: z.string() }),
  /** Its shell ended. */
  z.object({ type: z.literal("terminal.exited"), terminal: Id, exit_code: z.number().int().optional() }),
]);
export type CoreEvent = z.infer<typeof CoreEvent>;
