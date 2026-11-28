// What the core pushes to connected clients.
import { z } from "zod";
import { TabInfo } from "./browser.ts";
import { CarAlert } from "./car.ts";
import { Id, Job, Message, Part, Run, SurfaceState, SurfaceSummary, Thread } from "./domain.ts";
import { Notification, Task } from "./office.ts";
import { schemaFields } from "./schema-fields.ts";

/** Events pushed to every operator socket. `stream` groups the seq counter. */
export const CoreEvent = z.discriminatedUnion("type", [
  z.object(
    schemaFields({
      type: () => z.literal("thread.updated"),
      thread: () => Thread,
    }),
  ),
  /** The owner deleted the thread (and its sub-threads, listed in `children`). */
  z.object(
    schemaFields({
      type: () => z.literal("thread.deleted"),
      thread_id: () => Id,
      children: () => z.array(Id),
    }),
  ),
  z.object(
    schemaFields({
      type: () => z.literal("message.created"),
      message: () => Message,
    }),
  ),
  /** Messages taken out of a thread: the owner rewound it to edit a message or ask for another answer. */
  z.object(
    schemaFields({
      type: () => z.literal("message.deleted"),
      thread_id: () => Id,
      message_ids: () => z.array(Id),
    }),
  ),
  z.object(
    schemaFields({
      type: () => z.literal("message.updated"),
      message: () => Message,
    }),
  ),
  /** One part of a message changed (streaming text, a tool card): cheaper than resending the whole message. */
  z.object(
    schemaFields({
      type: () => z.literal("message.part"),
      thread_id: () => Id,
      message_id: () => Id,
      index: () => z.number().int().nonnegative(),
      part: () => Part,
    }),
  ),
  z.object(
    schemaFields({
      type: () => z.literal("run.updated"),
      run: () => Run,
    }),
  ),
  z.object(
    schemaFields({
      type: () => z.literal("job.updated"),
      job: () => Job,
    }),
  ),
  z.object(
    schemaFields({
      type: () => z.literal("task.updated"),
      task: () => Task,
    }),
  ),
  /** A task was deleted for good (its conversation goes as a thread.deleted). */
  z.object(
    schemaFields({
      type: () => z.literal("task.deleted"),
      task_id: () => Id,
    }),
  ),
  z.object(
    schemaFields({
      type: () => z.literal("notification.updated"),
      notification: () => Notification,
    }),
  ),
  z.object(
    schemaFields({
      type: () => z.literal("surface.updated"),
      surface: () => SurfaceSummary,
    }),
  ),
  /** A widget the owner deleted, with what it remembered: lists drop it. */
  z.object(
    schemaFields({
      type: () => z.literal("surface.deleted"),
      surface_id: () => Id,
    }),
  ),
  /** A widget's remembered state changed (the widget or its agent wrote it): open copies take it live. */
  z.object(
    schemaFields({
      type: () => z.literal("surface.state"),
      surface_id: () => Id,
      state: () => SurfaceState,
    }),
  ),
  /**
   * A Flow's saved drawing changed: a draft saved, discarded or published, or a Flow made with one. `by` is the agent
   * whose tool did it, null for the owner. An open screen reloads that Flow's drawing.
   */
  z.object(
    schemaFields({
      type: () => z.literal("flow.draft"),
      flow: () => z.string(),
      project: () => z.string(),
      draft_version: () => z.number().int().nullable(),
      by: () => z.string().nullable(),
    }),
  ),
  /**
   * A Flow's test (DECISIONS.md#d-178): it started waiting for an event until `until`, stopped or ran out of time, one
   * arrived and started the run `event`, or one arrived that the drawing could not take.
   */
  z.object(
    schemaFields({
      type: () => z.literal("flow.test"),
      flow: () => z.string(),
      state: () => z.enum(["listening", "stopped", "expired", "received", "refused"]),
      until: () => z.string().nullable(),
      event: () => z.string().nullable(),
    }),
  ),
  /**
   * A drawn Flow's run moved: a step started or ended, or the run ended. Ids and states only; what each step was given
   * and gave back is read with `flows.run_get`.
   */
  z.object(
    schemaFields({
      type: () => z.literal("flow.run"),
      flow: () => z.string(),
      event: () => z.string(),
      state: () => z.enum(["pending", "succeeded", "failed", "uncertain", "cancelled", "ignored"]),
      test: () => z.boolean(),
      steps: () =>
        z.array(
          z.object(
            schemaFields({
              node: () => z.string(),
              state: () => z.string(),
            }),
          ),
        ),
    }),
  ),
  /** Agents or projects changed (from any client, an agent's tool or a project's files): reload both lists. */
  z.object(
    schemaFields({
      type: () => z.literal("team.updated"),
    }),
  ),
  z.object(
    schemaFields({
      type: () => z.literal("browser.tabs"),
      tabs: () => z.array(TabInfo),
    }),
  ),
  /** A chat waits on the computer its agent started: Linux set up the first time, booting, then ready or not. */
  z.object(
    schemaFields({
      type: () => z.literal("computer.progress"),
      thread_id: () => Id,
      stage: () => z.enum(["creating", "loading", "ready", "failed"]),
    }),
  ),
  /**
   * What a turn's model is thinking, as far as it says (its reasoning summary), while it has not started its answer:
   * shown live and never kept. An empty text: it stopped thinking.
   */
  z.object(
    schemaFields({
      type: () => z.literal("run.thinking"),
      run_id: () => Id,
      thread_id: () => Id,
      text: () => z.string(),
    }),
  ),
  /** The disk holding the APX home ran low or has room again, or space was freed: read `storage.status` again. */
  z.object(
    schemaFields({
      type: () => z.literal("storage.changed"),
    }),
  ),
  /** A trip started or ended, or an offer was made or answered: read `car.trip` again. `alert` is a new offer. */
  z.object(
    schemaFields({
      type: () => z.literal("car.updated"),
      alert: () => CarAlert.optional(),
    }),
  ),
  /** The owner or the super-agent switched the panel between simple and advanced. */
  z.object(
    schemaFields({
      type: () => z.literal("panel.mode"),
      mode: () => z.enum(["simple", "advanced"]),
    }),
  ),
  /** An extension or a catalog of the owner's changed (from any client or agent): read the Marketplace's lists again. */
  z.object(
    schemaFields({
      type: () => z.literal("extensions.changed"),
    }),
  ),
  /** A catalog of the owner's is being read: entries checked of how many (0 of 0 while it downloads). */
  z.object(
    schemaFields({
      type: () => z.literal("extensions.catalog_reading"),
      id: () => z.string(),
      done: () => z.number().int(),
      total: () => z.number().int(),
    }),
  ),
  /** A model app on this computer (Ollama, LM Studio) was found, opened or closed: read `models.list` again. */
  z.object(
    schemaFields({
      type: () => z.literal("models.changed"),
    }),
  ),
  /** What a terminal printed (text as it came: escape codes and all). */
  z.object(
    schemaFields({
      type: () => z.literal("terminal.output"),
      terminal: () => Id,
      data: () => z.string(),
    }),
  ),
  /** Its shell ended. */
  z.object(
    schemaFields({
      type: () => z.literal("terminal.exited"),
      terminal: () => Id,
      exit_code: () => z.number().int().optional(),
    }),
  ),
]);
export type CoreEvent = z.infer<typeof CoreEvent>;
