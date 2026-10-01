// Domain shapes every client renders. Run states follow A2A task states so an A2A adapter stays thin.
import { z } from "zod";

export const Id = z.string().min(1).max(128);

export const Project = z.object({
  id: Id,
  name: z.string(),
  /** Blob name from the design system catalog, used as the project's avatar. */
  blob: z.string().optional(),
  path: z.string().optional(),
});
export type Project = z.infer<typeof Project>;

export const Agent = z.object({
  id: Id,
  name: z.string(),
  role: z.string().default(""),
  kind: z.enum(["secretary", "agent"]),
  blob: z.string().optional(),
  project_id: Id.optional(),
  /** Browser profile this agent may use: shared jar, an isolated jar, or always incognito. */
  browser_profile: z.enum(["shared", "isolated", "incognito"]).default("shared"),
  model: z.string().optional(),
  /** Which engine runs this agent's turns; absent = the install default. */
  harness: z.enum(["native", "claude", "codex"]).optional(),
});
export type Agent = z.infer<typeof Agent>;

export const HarnessId = z.enum(["native", "claude", "codex"]);
export type HarnessId = z.infer<typeof HarnessId>;

/** What the setup and Config → Motores show: installed → logged in → usable. */
export const EngineStatus = z.object({
  id: HarnessId,
  label: z.string(),
  installed: z.boolean(),
  logged_in: z.boolean(),
  version: z.string().optional(),
  /** Model or account detail, never a secret. */
  detail: z.string().optional(),
  default: z.boolean(),
});
export type EngineStatus = z.infer<typeof EngineStatus>;

export const RunState = z.enum(["submitted", "working", "input-required", "completed", "failed", "canceled"]);
export type RunState = z.infer<typeof RunState>;
export const TERMINAL_RUN_STATES: readonly RunState[] = ["completed", "failed", "canceled"];

export const ThreadKind = z.enum(["home", "agent", "loose", "a2a", "group"]);
export type ThreadKind = z.infer<typeof ThreadKind>;

export const Thread = z.object({
  id: Id,
  kind: ThreadKind,
  title: z.string(),
  agent_ids: z.array(Id),
  project_id: Id.optional(),
  /** a2a sub-threads point at the thread (and message) they were spawned from. */
  parent_id: Id.optional(),
  state: RunState.or(z.literal("idle")),
  preview: z.string().default(""),
  unread: z.number().int().nonnegative().default(0),
  created_at: z.string(),
  updated_at: z.string(),
});
export type Thread = z.infer<typeof Thread>;

export const Author = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("user") }),
  z.object({ kind: z.literal("agent"), id: Id }),
  z.object({ kind: z.literal("system") }),
  /** Text sent by a widget's sendPrompt(): shown apart from the owner's own messages. */
  z.object({ kind: z.literal("surface"), id: Id, title: z.string() }),
]);
export type Author = z.infer<typeof Author>;

/** What the UI shows. The model's own transcript is stored separately (two projections of one log). */
export const Part = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text"), text: z.string() }),
  z.object({
    type: z.literal("tool"),
    call_id: z.string(),
    tool: z.string(),
    title: z.string(),
    status: z.enum(["running", "ok", "error"]),
    detail: z.string().optional(),
  }),
  z.object({ type: z.literal("surface"), surface_id: Id, version: z.number().int(), title: z.string() }),
  z.object({
    type: z.literal("subthread"),
    thread_id: Id,
    agent_id: Id,
    title: z.string(),
    state: RunState,
    summary: z.string().optional(),
  }),
  z.object({
    type: z.literal("browser"),
    tab: z.string(),
    url: z.string(),
    title: z.string(),
    state: z.enum(["agent", "handoff", "user", "done"]),
    reason: z.string().optional(),
  }),
  z.object({ type: z.literal("image"), url: z.string(), alt: z.string().default("") }),
]);
export type Part = z.infer<typeof Part>;

export const Message = z.object({
  id: Id,
  thread_id: Id,
  seq: z.number().int(),
  author: Author,
  parts: z.array(Part),
  run_id: Id.optional(),
  model: z.string().optional(),
  created_at: z.string(),
});
export type Message = z.infer<typeof Message>;

export const Run = z.object({
  id: Id,
  thread_id: Id,
  agent_id: Id,
  state: RunState,
  error: z.string().optional(),
  started_at: z.string(),
  ended_at: z.string().optional(),
  /** Tokens reported by the provider for the whole run, when it reports them. */
  usage: z.object({ input: z.number().int(), output: z.number().int() }).optional(),
});
export type Run = z.infer<typeof Run>;

/** One primitive for widgets, sidebar panels and fullscreen apps. */
export const Surface = z.object({
  id: Id,
  /** Stable name an agent updates by ("ventas-mes"). Unique per project (or globally when no project). */
  name: z.string(),
  title: z.string(),
  html: z.string(),
  version: z.number().int(),
  pinned: z.boolean(),
  app: z.boolean(),
  project_id: Id.optional(),
  thread_id: Id.optional(),
  created_by: Id,
  updated_at: z.string(),
  /** Path of the public link (/a/<token>) when published; absent when private. */
  share_path: z.string().optional(),
});
export type Surface = z.infer<typeof Surface>;
export const SurfaceSummary = Surface.omit({ html: true });
export type SurfaceSummary = z.infer<typeof SurfaceSummary>;

/** Events pushed to every operator socket. `stream` groups the seq counter. */
export const CoreEvent = z.discriminatedUnion("type", [
  z.object({ type: z.literal("thread.updated"), thread: Thread }),
  z.object({ type: z.literal("message.created"), message: Message }),
  z.object({ type: z.literal("message.updated"), message: Message }),
  z.object({ type: z.literal("run.updated"), run: Run }),
  z.object({ type: z.literal("surface.updated"), surface: SurfaceSummary }),
  z.object({ type: z.literal("browser.tabs"), tabs: z.array(z.unknown()) }),
]);
export type CoreEvent = z.infer<typeof CoreEvent>;
