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
/** How a commitment ended: kept, missed (its date passed undelivered) or dropped (released by agreement). */
export const CommitmentOutcome = z.enum(["kept", "missed", "dropped"]);
export type CommitmentOutcome = z.infer<typeof CommitmentOutcome>;
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
  /** When its work starts: an assigned task waits until then (unset: at once). */
  start_at: z.string().optional(),
  /** Who checks it in review: "owner" or an agent's id. */
  reviewer: z.string().optional(),
  /** The plan its agent keeps: steps, what is done, what is next (Markdown). It outlives any chat's summaries. */
  plan: z.string().optional(),
  /** An agent proposed it: it waits for the owner to accept it (tasks.update proposed:false) before work starts. */
  proposed: z.boolean().optional(),
  /** A commitment: the person on the other side, and who owes it (the owner promised it, or the person did). */
  person_id: Id.optional(),
  person_name: z.string().optional(),
  owed_by: z.enum(["owner", "person"]).optional(),
  /** A closed commitment: how it ended. */
  outcome: CommitmentOutcome.optional(),
  /** How many times its date was moved by agreement with the person. */
  renegotiated: z.number().int(),
  /** Who created it: "owner" or an agent's id. */
  created_by: z.string(),
  created_at: z.string(),
  updated_at: z.string(),
  /** Last time anything happened: an edit, a comment, a turn. */
  /** How many chats its agents worked it in (each agent that took it has one). */
  chats: z.number().int().nonnegative().default(0),
  activity_at: z.string(),
});
export type Task = z.infer<typeof Task>;
export const TaskEvent = z.object({
  at: z.string(),
  op: z.enum(["create", "update", "move", "assign", "comment", "done", "drop", "reopen", "renegotiate"]),
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
export const CallModel = z.enum(["always", "output", "succeeds", "fails", "never"]);
export type CallModel = z.infer<typeof CallModel>;

/**
 * What a routine does: its agent answers the prompt; or the prompt itself is sent to the owner as it is (a message,
 * `{{pre_output}}` filled with the pre-command's output, no model); or only its pre-command runs (a shell job).
 */
/** Its agent answers the prompt; a message is sent as written; only its command runs; its agent watches the owner's
 * work (late tasks, commitments, quiet projects) and is called only when something new shows up; its agent tells
 * the owner, in one message, what the other agents' routines and notices had for them (called only when there is);
 * or its agent reads the mail that reached the owner's Gmail since its last run (called only when some came). */
export const RoutineAction = z.enum(["agent", "message", "shell", "watch", "relay", "mail"]);
export type RoutineAction = z.infer<typeof RoutineAction>;

/** Work an agent does on its own on a schedule; the owner hears back only when there is something to say. */
export const Routine = z.object({
  id: Id,
  name: z.string(),
  project_id: Id.optional(),
  agent_id: Id,
  schedule: Schedule,
  action: RoutineAction.default("agent"),
  prompt: z.string(),
  /** Shell run in the project's folder before the agent; its output reaches the prompt as outside data. */
  pre_command: z.string().optional(),
  /** Shell run after the agent, with $APX_LLM_OUTPUT, $APX_STATUS, $APX_SKIPPED and $APX_PRE_OUTPUT. */
  post_command: z.string().optional(),
  call_model: CallModel.default("always"),
  /** Its news always arrives (a morning or evening brief): never counted in the daily cap nor held by quiet hours. */
  anchor: z.boolean().default(false),
  /** Model calls each run may make before it must answer; absent: what any run no one watches gets. */
  max_steps: z.number().int().optional(),
  /** Seeded by a profile ("secretary:day-open"): the profile keeps its schedule, and can restore its prompt. */
  origin: z.string().optional(),
  enabled: z.boolean(),
  next_run_at: z.string().optional(),
  last_run_at: z.string().optional(),
  last: RoutineRun.optional(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type Routine = z.infer<typeof Routine>;

/** Text in the owner's languages: `en` always, others when the author wrote them. */
export const Localized = z.object({ en: z.string().max(400) }).catchall(z.string().max(400));
export type Localized = z.infer<typeof Localized>;

const ProfileKey = z.string().regex(/^[a-z][a-z0-9_]{0,40}$/);

/**
 * One setting a profile asks for. `schedule` is a five-field cron shown as a time and days; `choice` options may
 * carry a line for the prompt block (`prompt`), put where the block says `{{key}}`.
 */
export const ProfileField = z.object({
  key: ProfileKey,
  type: z.enum(["schedule", "number", "text", "command", "choice"]),
  label: Localized,
  help: Localized.optional(),
  default: z.union([z.string().max(2000), z.number()]),
  /** Numbers: bounds and what they count ("hours", "days"). */
  min: z.number().optional(),
  max: z.number().optional(),
  unit: z.enum(["hours", "days", "minutes"]).optional(),
  options: z
    .array(z.object({ value: z.string().max(60), label: Localized, prompt: z.string().max(500).optional() }))
    .max(10)
    .optional(),
});
export type ProfileField = z.infer<typeof ProfileField>;

/**
 * A routine a profile keeps on the super-agent. Its schedule may name a setting: a cron `"{{day_open}}"`, or every
 * `hours: "{{watch_every_h}}"`; `pre_command` too (`"{{calendar_command}}"`).
 */
export const ProfileRoutine = z.object({
  key: z.string().regex(/^[a-z][a-z0-9_-]{0,40}$/),
  name: Localized,
  /** v1's names for the same routine: an imported one is adopted instead of doubled. */
  v1: z.array(z.string()).default([]),
  action: z.enum(["agent", "watch", "message", "relay", "mail"]).default("agent"),
  anchor: z.boolean().default(false),
  schedule: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("cron"), cron: z.string().max(120) }),
    z.object({
      kind: z.literal("every"),
      hours: z.union([
        z
          .number()
          .min(1)
          .max(24 * 31),
        z.string().max(60),
      ]),
    }),
  ]),
  prompt: z.string().min(1).max(8000),
  pre_command: z.string().max(2000).optional(),
});
export type ProfileRoutine = z.infer<typeof ProfileRoutine>;

/**
 * A profile: what the super-agent is for (a chief of staff, a focus coach…), as data. Its block joins the
 * super-agent's system prompt, its routines are seeded and kept in step, its settings feed both and the watch's
 * thresholds (`waiting_hours`, `commitment_lead_hours`, `stale_project_days`, when it has them).
 * See DECISIONS.md#d-037
 */
export const ProfileManifest = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,40}$/),
  name: Localized,
  description: Localized,
  version: z.string().max(20).default("1.0.0"),
  /** English, for the system prompt; `{{key}}` takes a setting (a choice's own prompt line). */
  prompt: z.string().max(6000).default(""),
  settings: z.array(ProfileField).max(30).default([]),
  routines: z.array(ProfileRoutine).max(12).default([]),
});
export type ProfileManifest = z.infer<typeof ProfileManifest>;

export const ProfileInfo = ProfileManifest.extend({
  /** "apx": ships with APX; "owner": installed from a folder. */
  source: z.enum(["apx", "owner"]),
});
export type ProfileInfo = z.infer<typeof ProfileInfo>;

/** The profile the super-agent runs (none: it only answers), with the owner's values for its settings. */
export const ActiveProfile = z.object({
  id: z.string().nullable().default(null),
  values: z.record(z.string(), z.union([z.string(), z.number()])).default({}),
});
export type ActiveProfile = z.infer<typeof ActiveProfile>;

/** What a notice in the attention tray is about. */
export const NotificationKind = z.enum(["input", "task", "due", "routine", "channel", "agent", "run"]);
export type NotificationKind = z.infer<typeof NotificationKind>;

/**
 * Something that wants the owner: an agent waiting for their OK, a task waiting for them, a routine's news, a channel
 * matter, a turn that ended or failed in a chat they were not looking at. `title` names the subject (an agent, a task, a routine); the screen says what kind of thing it is.
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
        /** Whether it may also reach the local network and the owner's tailnet (a home device, a NAS). */
        local_network: z.boolean().default(false),
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
      local_network: z.boolean(),
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
