// Moving an APX setup to another computer, or keeping a copy of it: one file without secrets, and an import that says
// first what it adds or changes. See DECISIONS.md#d-192
import { z } from "zod";
import { Agent, Author, Autonomy, ChannelInfo, Id, MemoryScope } from "./domain.ts";
import { FlowDraftGraph } from "./flow-graph.ts";
import { FlowDefinition } from "./flow-methods.ts";
import { Routine } from "./office.ts";

/** What the file says it is; a file of another format version is refused, never read in part. */
export const INSTANCE_FORMAT = "apx-instance";
export const INSTANCE_VERSION = 1;
/** The file's largest size, inside one request: chats and table rows are what makes it big. */
export const INSTANCE_MAX_BYTES = 20 * 1024 * 1024;

const Rows = z.array(z.object({ key: z.string().min(1).max(256), value: z.unknown() })).max(100_000);

/** An agent defined in APX itself (a project's file agents travel with its folder). */
export const InstanceAgent = Agent.omit({ source: true, harness: true, slug: true }).extend({
  prompt: z.string().max(200_000),
});
export type InstanceAgent = z.infer<typeof InstanceAgent>;
export const InstanceProject = z.object({
  id: Id,
  name: z.string().min(1).max(200),
  /** Its folder, with the home as `~`: another computer finds it there, or the project waits for it. */
  path: z.string().max(4096).optional(),
  description: z.string().max(4000).optional(),
  kind: z.string().max(40).optional(),
  autonomy: Autonomy.optional(),
  read_only_folders: z.array(z.string().max(4096)).max(200).optional(),
});
export type InstanceProject = z.infer<typeof InstanceProject>;
export const InstanceRoutine = Routine.pick({
  id: true,
  name: true,
  project_id: true,
  agent_id: true,
  schedule: true,
  action: true,
  prompt: true,
  pre_command: true,
  post_command: true,
  call_model: true,
  anchor: true,
  max_steps: true,
  origin: true,
  enabled: true,
});
export type InstanceRoutine = z.infer<typeof InstanceRoutine>;
/** A project's table: its columns always, its rows when the owner asked for them. */
export const InstanceTable = z.object({
  project_id: Id,
  name: z.string().min(1).max(120),
  columns: z.array(z.string().max(120)).max(200),
  required: z.array(z.string().max(120)).max(200),
  rows: Rows.optional(),
});
export type InstanceTable = z.infer<typeof InstanceTable>;
/** A Flow and its drawing (what runs, or the draft when nothing runs yet); its own rows when asked for. */
export const InstanceFlow = z.object({
  definition: FlowDefinition,
  graph: FlowDraftGraph.nullable(),
  rows: Rows.optional(),
});
export type InstanceFlow = z.infer<typeof InstanceFlow>;
export const InstanceMemory = z.object({
  scope: MemoryScope,
  project_id: Id.optional(),
  agent_id: Id.optional(),
  text: z.string().min(1).max(20_000),
  kind: z.enum(["user", "feedback", "project", "reference", "procedure"]).optional(),
  source: z.enum(["owner", "agent", "imported"]),
});
export type InstanceMemory = z.infer<typeof InstanceMemory>;
/** A channel as set up; its token and its linked account stay on the computer that has them. */
export const InstanceChannel = ChannelInfo.omit({
  token_set: true,
  token_hint: true,
  status: true,
  error: true,
  account: true,
  qr: true,
});
export type InstanceChannel = z.infer<typeof InstanceChannel>;
/** One of the owner's own MCP servers: its variables stay `secret://` references. */
export const InstanceMcp = z.object({
  name: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,40}$/),
  command: z.string().max(4096).optional(),
  args: z.array(z.string().max(4096)).max(200),
  env: z.record(z.string(), z.string().max(4096)),
  url: z.string().max(4096).optional(),
  headers: z.record(z.string(), z.string().max(4096)),
  /** The project it runs in only. */
  project: Id.optional(),
  enabled: z.boolean(),
});
export type InstanceMcp = z.infer<typeof InstanceMcp>;
/** One of the owner's skills: its folder's text files. */
export const InstanceSkill = z.object({
  name: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,80}$/),
  files: z.array(z.object({ path: z.string().min(1).max(500), text: z.string().max(1_000_000) })).max(200),
});
export type InstanceSkill = z.infer<typeof InstanceSkill>;
/** A chat's words, when the owner ticked chats: its text, without files or tool steps. */
export const InstanceChat = z.object({
  id: Id,
  kind: z.enum(["home", "agent", "loose", "group"]),
  title: z.string().max(500),
  agent_ids: z.array(Id).max(50),
  project_id: Id.optional(),
  created_at: z.string(),
  messages: z.array(z.object({ author: Author, text: z.string().max(200_000), created_at: z.string() })).max(100_000),
});
export type InstanceChat = z.infer<typeof InstanceChat>;

export const InstanceFile = z.object({
  format: z.literal(INSTANCE_FORMAT),
  version: z.literal(INSTANCE_VERSION),
  /** The APX that wrote it. */
  apx_version: z.string().max(80),
  created_at: z.string(),
  includes: z.object({ chats: z.boolean(), rows: z.boolean() }),
  agents: z.array(InstanceAgent).max(2000),
  projects: z.array(InstanceProject).max(2000),
  routines: z.array(InstanceRoutine).max(5000),
  tables: z.array(InstanceTable).max(5000),
  flows: z.array(InstanceFlow).max(5000),
  memory: z.array(InstanceMemory).max(200_000),
  channels: z.array(InstanceChannel).max(200),
  mcps: z.array(InstanceMcp).max(500),
  /** Model APIs as the owner set them (their keys as references), and other settings by name. */
  providers: z.array(z.record(z.string(), z.unknown())).max(200),
  settings: z.record(z.string(), z.unknown()),
  skills: z.array(InstanceSkill).max(1000),
  chats: z.array(InstanceChat).max(20_000),
});
export type InstanceFile = z.infer<typeof InstanceFile>;

export const INSTANCE_SECTIONS = [
  "agents",
  "projects",
  "routines",
  "tables",
  "flows",
  "memory",
  "channels",
  "mcps",
  "providers",
  "settings",
  "skills",
  "chats",
] as const;
export const InstanceSection = z.enum(INSTANCE_SECTIONS);
export type InstanceSection = z.infer<typeof InstanceSection>;

/**
 * Why an item comes in as it does: it arrives off until its secret is filled (`needs_secret`), because what it runs or
 * where it sends changed (`changed`), because it runs a command here (`runs_command`) or because it would send a key
 * this computer has to the address the file gives (`uses_key`); a Flow arrives as a
 * draft to publish (`draft`); the project's folder is not on this computer (`folder_missing`); it is not imported
 * because its agent or project is missing (`agent_missing`, `project_missing`), this computer keeps its own
 * (`kept_here`), Home already has messages (`home_not_empty`), or it did not read as this APX expects (`invalid`).
 */
export const InstanceReason = z.enum([
  "needs_secret",
  "changed",
  "runs_command",
  "uses_key",
  "draft",
  "folder_missing",
  "agent_missing",
  "project_missing",
  "kept_here",
  "home_not_empty",
  "invalid",
]);
export type InstanceReason = z.infer<typeof InstanceReason>;

export const InstancePlanItem = z.object({
  section: InstanceSection,
  id: z.string(),
  label: z.string(),
  action: z.enum(["add", "update", "same", "skip"]),
  /** It arrives turned off. */
  off: z.boolean().optional(),
  reason: InstanceReason.optional(),
});
export type InstancePlanItem = z.infer<typeof InstancePlanItem>;

export const InstancePlan = z.object({
  apx_version: z.string(),
  created_at: z.string(),
  includes: z.object({ chats: z.boolean(), rows: z.boolean() }),
  items: z.array(InstancePlanItem),
  /** The secrets the file names that this computer has no value for: filled in Settings › Secrets. */
  secrets: z.array(z.string()),
});
export type InstancePlan = z.infer<typeof InstancePlan>;

const ImportParams = z.object({ file: z.unknown() }).strict();

export const instanceMethods = {
  /** This setup as one file, without secret values; chats and table rows only when asked. */
  "instance.export": {
    params: z.object({ chats: z.boolean().default(false), rows: z.boolean().default(false) }).strict(),
    result: z.object({ file: InstanceFile, name: z.string(), bytes: z.number() }),
    effect: false,
    access: "human",
  },
  /** What importing the file would add, change, keep or leave out, without changing anything. */
  "instance.preview_import": {
    params: ImportParams,
    result: InstancePlan,
    effect: false,
    access: "human",
  },
  /** Imports the file as the preview said; the same file a second time changes nothing. */
  "instance.import": {
    params: ImportParams,
    result: InstancePlan.extend({ applied: z.number() }),
    effect: true,
    access: "human",
  },
} as const;
