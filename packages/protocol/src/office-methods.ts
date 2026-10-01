// Methods behind the office: tasks and commitments, routines, the attention tray and extensions.
import { z } from "zod";
import { Id, Message, Run } from "./domain.ts";
import {
  ExtensionInfo,
  Notification,
  Routine,
  RoutineRun,
  Schedule,
  Task,
  TaskColumn,
  TaskEvent,
  TaskState,
} from "./office.ts";

export const officeMethods = {
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
    result: z.object({ task: Task, events: z.array(TaskEvent) }),
    effect: false,
  },
  "tasks.create": {
    params: z
      .object({
        title: z.string().trim().min(1).max(200),
        description: z.string().max(10_000).optional(),
        project: Id.optional(),
        assignee: Id.optional(),
        status: z.string().max(40).optional(),
        parent: Id.optional(),
        due_at: z.string().max(40).optional(),
        /** A commitment: the person (id or exact name) and who owes it (default: the owner). */
        person: z.string().max(80).optional(),
        owed_by: z.enum(["owner", "person"]).optional(),
      })
      .strict(),
    result: Task,
    effect: true,
  },
  /** Changes what is given; `assignee: null` / `due_at: null` clear them. */
  "tasks.update": {
    params: z
      .object({
        task: Id,
        title: z.string().trim().min(1).max(200).optional(),
        description: z.string().max(10_000).optional(),
        status: z.string().max(40).optional(),
        assignee: Id.nullable().optional(),
        due_at: z.string().max(40).nullable().optional(),
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
    params: z.object({ task: Id, state: TaskState, note: z.string().max(2000).optional() }).strict(),
    result: Task,
    effect: true,
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
        prompt: z.string().trim().min(1).max(20_000),
        enabled: z.boolean().default(true),
      })
      .strict(),
    result: Routine,
    effect: true,
    access: "human",
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
  "extensions.set_secret": {
    params: z
      .object({ id: z.string().max(40), name: z.string().max(40), value: z.string().max(10_000).nullable() })
      .strict(),
    result: ExtensionInfo,
    effect: true,
    access: "human",
  },
} as const;
