// Methods behind the office: tasks and commitments, routines, the attention tray and extensions.
import { z } from "zod";
import { Id, Message, Nudge, Run, Thread } from "./domain.ts";
import {
  ActiveProfile,
  ApiClient,
  CallModel,
  ClientScope,
  ExtensionInfo,
  Notification,
  ProfileInfo,
  Routine,
  RoutineAction,
  RoutineRun,
  Schedule,
  Task,
  TaskColumn,
  TaskEvent,
  TaskKind,
  TaskPriority,
  TaskState,
  TaskTag,
} from "./office.ts";

const TaskAttachment = z.object({
  media_id: Id,
  kind: z.enum(["image", "audio", "file"]),
  mime: z.string(),
  bytes: z.number().int(),
  name: z.string(),
});

export const officeMethods = {
  /** Snapshots selected readable media into the task; never shares its source chat. */
  "tasks.attach": {
    params: z.object({ task: Id, media_ids: z.array(Id).min(1).max(20) }).strict(),
    result: z.object({ attachments: z.array(TaskAttachment) }),
    effect: true,
  },
  "tasks.detach": {
    params: z.object({ task: Id, media_id: Id }).strict(),
    result: z.object({ removed: Id }),
    effect: true,
    access: "human",
  },
  /** Tasks (open by default) with the board's columns. An agent sees its own thread's project's and the global ones. */
  "tasks.list": {
    params: z
      .object({
        project: Id.optional(),
        state: TaskState.optional(),
        assignee: Id.optional(),
        /** Only commitments (tasks with a person), or one person's. */
        commitments: z.boolean().optional(),
        person: Id.optional(),
        limit: z.number().int().min(1).max(500).default(200),
      })
      .strict(),
    result: z.object({ tasks: z.array(Task), columns: z.array(TaskColumn) }),
    effect: false,
  },
  "tasks.get": {
    params: z.object({ task: Id }).strict(),
    /**
     * `sessions`: the chats its agents worked it in, oldest first (one per agent that took it). `consults`: the
     * teammates @mentioned on it, each asked apart (DECISIONS.md#d-073). `usage`: the tokens every turn on the task
     * took (its sessions, consults and conversation), by model. `subtasks`: the tasks under it, oldest activity first.
     */
    result: z.object({
      task: Task,
      events: z.array(TaskEvent),
      attachments: z.array(TaskAttachment).default([]),
      /** Latest conversation messages, oldest first, including persisted evidence parts. */
      comments: z.array(Message).default([]),
      comments_truncated: z.boolean().default(false),
      sessions: z.array(Thread),
      consults: z.array(Thread).default([]),
      subtasks: z.array(Task).default([]),
      usage: z
        .array(
          z.object({ model: z.string(), runs: z.number().int(), input: z.number().int(), output: z.number().int() }),
        )
        .default([]),
    }),
    effect: false,
  },
  "tasks.create": {
    params: z
      .object({
        title: z.string().trim().min(1).max(200),
        description: z.string().max(10_000).optional(),
        attachments: z.array(Id).max(20).optional(),
        project: Id.optional(),
        assignee: Id.optional(),
        status: z.string().max(40).optional(),
        parent: Id.optional(),
        kind: TaskKind.optional(),
        priority: TaskPriority.optional(),
        tags: z.array(TaskTag).max(12).optional(),
        due_at: z.string().max(40).optional(),
        remind_at: z.string().max(40).optional(),
        start_at: z.string().max(40).optional(),
        /** A proposal: it waits for the owner to accept it before anything starts. */
        propose: z.boolean().optional(),
        /** A commitment: the person (id or exact name) and who owes it (default: the owner). */
        person: z.string().max(80).optional(),
        owed_by: z.enum(["owner", "person"]).optional(),
      })
      .strict(),
    result: Task,
    effect: true,
  },
  /**
   * Changes what is given; `null` clears assignee, dates and person. `project` moves the task (and its conversation);
   * `null` makes it global. An assignee from another project is unassigned.
   */
  "tasks.update": {
    params: z
      .object({
        task: Id,
        attachments: z.array(Id).max(20).optional(),
        title: z.string().trim().min(1).max(200).optional(),
        description: z.string().max(10_000).optional(),
        status: z.string().max(40).optional(),
        assignee: Id.nullable().optional(),
        project: Id.nullable().optional(),
        kind: TaskKind.optional(),
        priority: TaskPriority.optional(),
        tags: z.array(TaskTag).max(12).optional(),
        due_at: z.string().max(40).nullable().optional(),
        remind_at: z.string().max(40).nullable().optional(),
        start_at: z.string().max(40).nullable().optional(),
        /** Who checks it in review: "owner" or an agent (id or name); null: the owner again. */
        reviewer: z.string().max(80).nullable().optional(),
        plan: z.string().max(4000).nullable().optional(),
        /** false accepts a proposal (the owner only): its work starts as if it had just been given. */
        proposed: z.literal(false).optional(),
        awaits_owner: z.boolean().optional(),
        person: z.string().max(80).nullable().optional(),
        owed_by: z.enum(["owner", "person"]).optional(),
      })
      .strict(),
    result: Task,
    effect: true,
  },
  /** Done, dropped, or open again. */
  "tasks.close": {
    params: z
      .object({ task: Id, state: TaskState, note: z.string().max(2000).optional(), rework: z.boolean().optional() })
      .strict(),
    result: Task,
    effect: true,
  },
  /**
   * How a commitment went: kept (done), missed or dropped (closed with that outcome), or renegotiated (still open,
   * with the new date agreed with the person).
   */
  "tasks.settle": {
    params: z
      .object({
        task: Id,
        outcome: z.enum(["kept", "missed", "dropped", "renegotiated"]),
        due_at: z.string().max(40).optional(),
        note: z.string().max(2000).optional(),
      })
      .strict(),
    result: Task,
    effect: true,
  },
  /**
   * Deletes a task for good: its history and its conversation. Subtasks and the agents' own chats about it stay.
   * Refused while a turn or a job runs in its conversation (stop it first).
   */
  "tasks.delete": {
    params: z.object({ task: Id }).strict(),
    result: z.object({ deleted: Id }),
    effect: true,
    access: "human",
  },
  /** A comment in the task's conversation; an @mentioned agent answers there. */
  "tasks.comment": {
    params: z.object({ task: Id, text: z.string().trim().min(1).max(20_000) }).strict(),
    result: z.object({ message: Message, runs: z.array(Run) }),
    effect: true,
  },
  /** Routines, all or one project's (the global ones have no project). */
  "routines.list": {
    params: z.object({ project: Id.optional() }).strict(),
    result: z.object({ routines: z.array(Routine) }),
    effect: false,
    access: "human",
  },
  /** Creates (no id) or changes a routine; the next run is computed from its schedule. */
  "routines.set": {
    params: z
      .object({
        id: Id.optional(),
        name: z.string().trim().min(1).max(120),
        agent: Id,
        project: Id.optional(),
        schedule: Schedule,
        /** Absent: what the routine had ("agent" for a new one). A shell routine's prompt is a short note. */
        action: RoutineAction.optional(),
        prompt: z.string().trim().min(1).max(20_000),
        /** On a change, absent keeps what the routine had and "" removes it. */
        pre_command: z.string().trim().max(4000).optional(),
        post_command: z.string().trim().max(4000).optional(),
        /** Absent: what the routine had ("always" for a new one). */
        call_model: CallModel.optional(),
        /** Absent: what the routine had (off for a new one). */
        anchor: z.boolean().optional(),
        /** Model calls each run may make. Absent keeps what the routine had; null goes back to the default. */
        max_steps: z.number().int().min(5).max(200).nullable().optional(),
        enabled: z.boolean().default(true),
      })
      .strict(),
    result: Routine,
    effect: true,
    access: "human",
  },
  /**
   * The profiles APX knows (its own and the owner's), the one the super-agent runs, and the routines it keeps;
   * `changed` names those whose prompt is no longer the one the profile ships (Restore puts it back).
   */
  "profiles.list": {
    params: z.object({}).strict(),
    result: z.object({
      profiles: z.array(ProfileInfo),
      active: ActiveProfile,
      routines: z.array(Routine),
      changed: z.array(Id).default([]),
    }),
    effect: false,
    access: "human",
  },
  /**
   * Runs a profile (or none) with these values: its routines are created or adopted, rescheduled and turned on; the
   * previous profile's are turned off. Prompts the owner edited stay.
   */
  "profiles.set": {
    params: z
      .object({
        id: z.string().nullable(),
        values: z.record(z.string(), z.union([z.string(), z.number()])).default({}),
      })
      .strict(),
    result: z.object({ active: ActiveProfile, routines: z.array(Routine), changed: z.array(Id).default([]) }),
    effect: true,
    access: "human",
  },
  /** Puts back a profile routine's default prompt. */
  "profiles.restore": {
    params: z.object({ routine: Id }).strict(),
    result: Routine,
    effect: true,
    access: "human",
  },
  /** Installs a profile from a folder with an apx-profile.json (copied into APX's home; one of the same id is replaced). */
  "profiles.install": {
    params: z.object({ path: z.string().min(1).max(1000) }).strict(),
    result: z.object({ profile: ProfileInfo }),
    effect: true,
    access: "human",
  },
  /** Removes an installed profile (APX's own stay); if it was running, the super-agent goes back to none. */
  "profiles.remove": {
    params: z.object({ id: z.string() }).strict(),
    result: z.object({ removed: z.boolean() }),
    effect: true,
    access: "human",
  },
  /**
   * An agent tells the owner something now, from work they are not watching (a routine, a task, a long job). It goes
   * through the interruption budget like a routine's news, and lands in the tray either way.
   */
  "notices.notify": {
    params: z.object({ text: z.string().min(1).max(1000), critical: z.boolean().optional() }).strict(),
    result: z.object({ state: Nudge.shape.state }),
    effect: true,
  },
  "routines.remove": {
    params: z.object({ routine: Id }).strict(),
    result: z.object({ removed: z.boolean() }),
    effect: true,
    access: "human",
  },
  /** Runs a routine now, outside its schedule. */
  "routines.run": {
    params: z.object({ routine: Id }).strict(),
    result: RoutineRun,
    effect: true,
    access: "human",
  },
  "routines.runs": {
    params: z.object({ routine: Id, limit: z.number().int().min(1).max(200).default(20) }).strict(),
    result: z.object({ runs: z.array(RoutineRun) }),
    effect: false,
    access: "human",
  },
  /** The attention tray, newest first, with how many are unread. */
  "notifications.list": {
    params: z
      .object({
        unread_only: z.boolean().default(false),
        limit: z.number().int().min(1).max(200).default(50),
      })
      .strict(),
    result: z.object({ notifications: z.array(Notification), unread: z.number().int() }),
    effect: false,
    access: "human",
  },
  /** Marks notices read: the given ones, or every one. */
  "notifications.read": {
    params: z.object({ ids: z.array(Id).max(200).optional() }).strict(),
    result: z.object({ unread: z.number().int() }),
    effect: true,
    access: "human",
  },
  "extensions.list": {
    params: z.object({}).strict(),
    result: z.object({ extensions: z.array(ExtensionInfo) }),
    effect: false,
    access: "human",
  },
  /** Reads a folder's apx-extension.json without installing or running anything. */
  "extensions.inspect": {
    params: z.object({ path: z.string().min(1).max(1000) }).strict(),
    result: ExtensionInfo,
    effect: false,
    access: "human",
  },
  /** Copies the folder into APX's home, off; installing it again replaces it (and turns it off if it changed). */
  "extensions.install": {
    params: z.object({ path: z.string().min(1).max(1000) }).strict(),
    result: ExtensionInfo,
    effect: true,
    access: "human",
  },
  "extensions.enable": {
    params: z.object({ id: z.string().max(40), enabled: z.boolean() }).strict(),
    result: ExtensionInfo,
    effect: true,
    access: "human",
  },
  "extensions.remove": {
    params: z.object({ id: z.string().max(40) }).strict(),
    result: z.object({ removed: z.boolean() }),
    effect: true,
    access: "human",
  },
  /** Stores (or with null, deletes) one of the secrets an extension declares. */
  /** Asks the extension's plugin for context on a sample text, as a turn would: what it adds, or why not. */
  "extensions.test": {
    params: z.object({ id: z.string().min(1).max(80), text: z.string().trim().min(1).max(2000) }).strict(),
    result: z.object({
      ok: z.boolean(),
      ms: z.number().int(),
      context: z.string().optional(),
      error: z.string().optional(),
    }),
    effect: false,
    access: "human",
  },
  "extensions.set_secret": {
    params: z
      .object({ id: z.string().max(40), name: z.string().max(40), value: z.string().max(10_000).nullable() })
      .strict(),
    result: ExtensionInfo,
    effect: true,
    access: "human",
  },
  "clients.list": {
    params: z.object({}).strict(),
    result: z.object({ clients: z.array(ApiClient) }),
    effect: false,
    access: "human",
  },
  /** A token for an outside app; it is shown once and only its fingerprint is kept. */
  "clients.create": {
    params: z.object({ name: z.string().trim().min(1).max(60), scopes: z.array(ClientScope).min(1).max(2) }).strict(),
    result: z.object({ client: ApiClient, token: z.string() }),
    effect: true,
    access: "human",
    replay: false,
  },
  "clients.revoke": {
    params: z.object({ id: Id }).strict(),
    result: z.object({ revoked: z.boolean() }),
    effect: true,
    access: "human",
  },
} as const;
