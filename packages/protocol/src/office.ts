// The office: tasks and commitments, routines, the attention tray, and extensions.
import { z } from "zod";
import { Id, RunState } from "./domain.ts";

/**
 * A task: work someone owns, in a board column, with its history as events and its conversation as a thread (a
 * comment that @mentions an agent runs a turn of that agent there). `done` and `dropped` are states, not columns.
 */
export const TaskState = z.enum(["open", "done", "dropped"]);
export type TaskState = z.infer<typeof TaskState>;
export const TaskColumn = z.object({ id: z.string(), label: z.string() });
/** A task, a commitment with someone (who owes whom), or an errand: something small to do on the way. */
export const TaskKind = z.enum(["task", "commitment", "errand"]);
export type TaskKind = z.infer<typeof TaskKind>;
export const TaskPriority = z.enum(["low", "normal", "high", "urgent"]);
export type TaskPriority = z.infer<typeof TaskPriority>;
export const TaskTag = z.string().trim().min(1).max(32);
export type TaskColumn = z.infer<typeof TaskColumn>;
export const Task = z.object({
  id: Id,
  project_id: Id.optional(),
  title: z.string(),
  /** For people; what an agent should do goes in the comments. */
  description: z.string(),
  status: z.string(),
  state: TaskState,
  kind: TaskKind,
  priority: TaskPriority,
  tags: z.array(z.string()),
  /** The agent working on it. */
  assignee: Id.optional(),
  parent_id: Id.optional(),
  thread_id: Id,
  /** Waiting for the owner (a decision, an answer). */
  awaits_owner: z.boolean(),
  due_at: z.string().optional(),
  /** When the owner is reminded; without it, when the task is due. */
  remind_at: z.string().optional(),
  /** A commitment: the person on the other side, and who owes it (the owner promised it, or the person did). */
  person_id: Id.optional(),
  person_name: z.string().optional(),
  owed_by: z.enum(["owner", "person"]).optional(),
  /** Who created it: "owner" or an agent's id. */
  created_by: z.string(),
  created_at: z.string(),
  updated_at: z.string(),
  /** Last time anything happened: an edit, a comment, a turn. */
  activity_at: z.string(),
});
export type Task = z.infer<typeof Task>;
export const TaskEvent = z.object({
  at: z.string(),
  op: z.enum(["create", "update", "move", "assign", "comment", "done", "drop", "reopen"]),
  by: z.string(),
  data: z.record(z.string(), z.unknown()).default({}),
});
export type TaskEvent = z.infer<typeof TaskEvent>;

/** When a routine runs: a five-field cron (local time), every N minutes, once, or only by hand. */
export const Schedule = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("cron"), cron: z.string().trim().min(9).max(120) }),
  z.object({
    kind: z.literal("every"),
    minutes: z
      .number()
      .int()
      .min(5)
      .max(60 * 24 * 31),
  }),
  z.object({ kind: z.literal("once"), at: z.string().max(40) }),
  z.object({ kind: z.literal("manual") }),
]);
export type Schedule = z.infer<typeof Schedule>;

/** One run of a routine: its own conversation, and whether the owner was told (false = nothing worth saying). */
export const RoutineRun = z.object({
  run_id: Id,
  thread_id: Id,
  state: RunState,
  started_at: z.string(),
  ended_at: z.string().optional(),
  delivered: z.boolean().optional(),
  /** false: the pre-command's result said not to call the model, so the run spent no tokens. */
  model_called: z.boolean().optional(),
});
export type RoutineRun = z.infer<typeof RoutineRun>;

/** When a routine with a pre-command calls its model: always, only if it printed something, only if it failed, never. */
export const CallModel = z.enum(["always", "output", "fails", "never"]);
export type CallModel = z.infer<typeof CallModel>;

/** Work an agent does on its own on a schedule; the owner hears back only when there is something to say. */
export const Routine = z.object({
  id: Id,
  name: z.string(),
  project_id: Id.optional(),
  agent_id: Id,
  schedule: Schedule,
  prompt: z.string(),
  /** Shell run in the project's folder before the agent; its output reaches the prompt as outside data. */
  pre_command: z.string().optional(),
  /** Shell run after the agent, with $APX_LLM_OUTPUT, $APX_STATUS, $APX_SKIPPED and $APX_PRE_OUTPUT. */
  post_command: z.string().optional(),
  call_model: CallModel.default("always"),
  enabled: z.boolean(),
  next_run_at: z.string().optional(),
  last_run_at: z.string().optional(),
  last: RoutineRun.optional(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type Routine = z.infer<typeof Routine>;

/** What a notice in the attention tray is about. */
export const NotificationKind = z.enum(["input", "task", "due", "routine", "channel"]);
export type NotificationKind = z.infer<typeof NotificationKind>;

/**
 * Something that wants the owner: an agent waiting for their OK, a task waiting for them, a routine's news, a channel
 * matter. `title` names the subject (an agent, a task, a routine); the screen says what kind of thing it is.
 */
export const Notification = z.object({
  id: Id,
  kind: NotificationKind,
  level: z.enum(["info", "warn", "error"]),
  title: z.string(),
  body: z.string(),
  thread_id: Id.optional(),
  /** The input, task, run or request it is about. */
  ref: z.string().optional(),
  created_at: z.string(),
  read_at: z.string().optional(),
});
export type Notification = z.infer<typeof Notification>;

/** Events a plugin may watch. */
export const PluginEvent = z.enum([
  "thread.updated",
  "message.created",
  "run.updated",
  "task.updated",
  "notification.updated",
]);
export type PluginEvent = z.infer<typeof PluginEvent>;

/** An extension's id. */
const ExtId = z.string().regex(/^[a-z0-9][a-z0-9_-]{0,19}$/);
/** Names inside an extension (MCP servers, secrets): no "-", so `<id>-<name>` always splits one way. */
const ExtName = z.string().regex(/^[a-z0-9][a-z0-9_]{0,19}$/);

/**
 * `apx-extension.json`: what an extension brings, readable without running anything. Paths are relative to its
 * folder; `secret://name` in an MCP server means the extension's own secret `name`, declared under `secrets`.
 */
export const ExtensionManifest = z
  .object({
    id: ExtId,
    name: z.string().trim().min(1).max(80),
    version: z.string().max(40),
    description: z.string().max(500).default(""),
    /** A folder of skill folders (each with a SKILL.md). */
    skills: z.string().max(200).optional(),
    mcp: z
      .record(
        ExtName,
        z
          .object({
            command: z.string().max(200).optional(),
            args: z.array(z.string().max(500)).max(40).default([]),
            env: z.record(z.string(), z.string().max(500)).default({}),
            url: z.string().max(500).optional(),
            headers: z.record(z.string(), z.string().max(500)).default({}),
          })
          .strict(),
      )
      .default({}),
    /** Routines the owner can add from it (they pick the agent). */
    routines: z
      .array(z.object({ name: z.string().max(120), schedule: Schedule, prompt: z.string().max(20_000) }).strict())
      .max(20)
      .default([]),
    secrets: z
      .array(z.object({ name: ExtName, label: z.string().max(120), url: z.string().max(500).optional() }).strict())
      .max(10)
      .default([]),
    /**
     * Code that runs beside APX in a separate process (it reads only its folder and writes only its data folder). It
     * can watch the events it names and add context to the owner's turns; it never calls APX.
     */
    plugin: z
      .object({
        entry: z.string().max(200),
        observe: z.array(PluginEvent).max(10).default([]),
        context: z.boolean().default(false),
        /** Whether it may reach the internet (never this machine). */
        network: z.boolean().default(false),
      })
      .strict()
      .optional(),
  })
  .strict();
export type ExtensionManifest = z.infer<typeof ExtensionManifest>;

/** An installed extension as the owner sees it: what it brings and whether it is on. */
export const ExtensionInfo = z.object({
  id: z.string(),
  name: z.string(),
  version: z.string(),
  description: z.string(),
  enabled: z.boolean(),
  /** Fingerprint of its files: turning it on approves exactly these. */
  hash: z.string(),
  /** The folder it was installed from. */
  source: z.string(),
  skills: z.array(z.string()),
  mcp: z.array(z.string()),
  routines: ExtensionManifest.shape.routines,
  secrets: z.array(z.object({ name: z.string(), label: z.string(), url: z.string().optional(), set: z.boolean() })),
  plugin: z
    .object({
      observe: z.array(PluginEvent),
      context: z.boolean(),
      network: z.boolean(),
      status: z.enum(["off", "running", "error"]),
      error: z.string().optional(),
    })
    .optional(),
  /** It brings code that runs on this computer (an MCP command or a plugin): turning it on trusts its author. */
  runs_code: z.boolean(),
  installed_at: z.string(),
});
export type ExtensionInfo = z.infer<typeof ExtensionInfo>;

/** What an outside app (Claude Code, Codex…) holding a client token may do. */
export const ClientScope = z.enum(["chat", "browser"]);
export type ClientScope = z.infer<typeof ClientScope>;

/** An outside app the owner connected: it acts as a model, never as the owner, and only within its scopes. */
export const ApiClient = z.object({
  id: Id,
  name: z.string(),
  scopes: z.array(ClientScope),
  created_at: z.string(),
  last_used_at: z.string().optional(),
});
export type ApiClient = z.infer<typeof ApiClient>;
