// Domain shapes every client renders. Run states follow A2A task states so an A2A adapter stays thin.
import { z } from "zod";

export const Id = z.string().min(1).max(128);

export const Project = z.object({
  id: Id,
  name: z.string(),
  description: z.string().optional(),
  /** "company", "software", "personal"… as the project's .apc/project.json says. */
  kind: z.string().optional(),
  /** false when the registered folder is not on disk (moved, unmounted drive). */
  present: z.boolean().default(true),
  /** Blob name from the design system catalog, used as the project's avatar. */
  blob: z.string().optional(),
  path: z.string().optional(),
});
export type Project = z.infer<typeof Project>;

export const HarnessId = z.enum(["native", "claude", "codex"]);
export type HarnessId = z.infer<typeof HarnessId>;

/**
 * A model, named by the engine that runs it: "claude/claude-opus-5-5", "codex/gpt-6-sol", "gemini/gemini-3.8-flash".
 * An engine alone ("claude", "codex") means that engine's own default model.
 */
export const ModelRef = z
  .string()
  .regex(/^[a-z0-9][a-z0-9._-]*(\/.+)?$/i)
  .max(200);
export type ModelRef = z.infer<typeof ModelRef>;

/**
 * How an agent picks its model for a turn: a fixed model; a model with the router as fallback; or the router alone
 * (`model` absent). An agent without a choice uses the install default.
 */
export const ModelChoice = z.object({ model: ModelRef.optional(), router: z.boolean() });
export type ModelChoice = z.infer<typeof ModelChoice>;

/** The model router: per-turn rules (first match wins) and the fallback chain after them. */
export const RouterRule = z.object({
  /** Every condition present must hold; an empty `when` matches every turn. */
  when: z.object({
    has_image: z.boolean().optional(),
    min_chars: z.number().int().nonnegative().optional(),
    max_chars: z.number().int().nonnegative().optional(),
    min_context_chars: z.number().int().nonnegative().optional(),
    channels: z.array(z.string()).optional(),
    triggers: z.array(z.string()).optional(),
    agent_kinds: z.array(z.enum(["secretary", "agent"])).optional(),
    keywords: z.array(z.string().min(2)).optional(),
  }),
  model: ModelRef,
  note: z.string().max(200).optional(),
});
export type RouterRule = z.infer<typeof RouterRule>;
export const RouterConfig = z.object({ rules: z.array(RouterRule), chain: z.array(ModelRef) });
export type RouterConfig = z.infer<typeof RouterConfig>;

/** What an engine can run, asked to the engine itself. */
export const CatalogEngine = z.object({
  /** "claude", "codex", or a provider id ("gemini", "anthropic", …). */
  id: z.string(),
  kind: z.enum(["harness", "provider"]),
  label: z.string(),
  available: z.boolean(),
  detail: z.string().optional(),
  models: z.array(
    z.object({ id: z.string(), name: z.string(), description: z.string().optional(), chat: z.boolean() }),
  ),
  fetched_at: z.string().optional(),
});
export type CatalogEngine = z.infer<typeof CatalogEngine>;

/**
 * `ask`: every call that changes something waits for the owner. `standard`: high-impact calls wait while untrusted
 * content is in context. `total`: only calls marked "always" wait.
 */
export const Autonomy = z.enum(["ask", "standard", "total"]);
export type Autonomy = z.infer<typeof Autonomy>;

export const Agent = z.object({
  id: Id,
  name: z.string(),
  role: z.string().default(""),
  kind: z.enum(["secretary", "agent"]),
  blob: z.string().optional(),
  project_id: Id.optional(),
  /** Browser profile this agent may use: shared jar, an isolated jar, or always incognito. */
  browser_profile: z.enum(["shared", "isolated", "incognito"]).default("shared"),
  /** Absent = the install default. */
  model_choice: ModelChoice.optional(),
  /** The file name in .apc/agents/ for project agents. */
  slug: z.string().optional(),
  /** Slug of the agent it reports to, inside the same project. */
  parent: z.string().optional(),
  description: z.string().optional(),
  /** "apc" = defined by a file in the project; "local" = defined in APX itself. */
  source: z.enum(["apc", "local"]).default("local"),
  /** The engine of the agent's own model, when it has one (derived from `model_choice`). */
  harness: HarnessId.optional(),
  /** Tools (or groups: browser, widgets, agents, shell) it may use; absent = the default set. From `tools:`. */
  tools: z.array(z.string()).optional(),
  /** How often it stops for the owner's yes. From `autonomy:`; absent = standard. */
  autonomy: Autonomy.optional(),
});
export type Agent = z.infer<typeof Agent>;

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
  /** An a2a sub-thread's name: its caller continues the same session (same agent, same context) by it. */
  session: z.string().optional(),
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

export const InputKind = z.enum(["confirm", "question"]);
export type InputKind = z.infer<typeof InputKind>;
/** `expired` = nobody answered in time or the run ended first; for a confirmation it counts as a no. */
export const InputState = z.enum(["pending", "approved", "denied", "answered", "expired"]);
export type InputState = z.infer<typeof InputState>;

/** Something an agent waits on from the owner. Durable: it outlives a restart of the core. */
export const PendingInput = z.object({
  id: Id,
  run_id: Id,
  thread_id: Id,
  agent_id: Id,
  kind: InputKind,
  prompt: z.string(),
  tool: z.string().optional(),
  detail: z.string().optional(),
  options: z.array(z.string()).optional(),
  state: InputState,
  answer: z.string().optional(),
  created_at: z.string(),
  expires_at: z.string(),
  answered_at: z.string().optional(),
});
export type PendingInput = z.infer<typeof PendingInput>;

/** What the UI shows. The model's own transcript is stored separately (two projections of one log). */
const KnownPart = z.discriminatedUnion("type", [
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
  /** The agent waits for the owner: a yes/no on an action, or an answer to a question. Answered with runs.respond. */
  z.object({
    type: z.literal("input"),
    input_id: Id,
    kind: InputKind,
    prompt: z.string(),
    /** For a confirmation: the tool and a readable summary of its arguments. */
    tool: z.string().optional(),
    detail: z.string().optional(),
    options: z.array(z.string()).optional(),
    state: InputState,
    answer: z.string().optional(),
  }),
  /** Something the system says about the turn (interrupted, fallback engine, no answer): never the agent's words. */
  z.object({
    type: z.literal("notice"),
    level: z.enum(["info", "warn", "error"]),
    /** Stable code the UI translates (e.g. "run.interrupted"); `text` is the English fallback. */
    code: z.string(),
    text: z.string(),
  }),
]);
const KNOWN_PARTS: ReadonlySet<string> = new Set(KnownPart.options.map((o) => o.shape.type.value));

/**
 * A part this client does not know yet (sent by a newer core) is shown as a notice instead of breaking the whole
 * message: old apps and cached panels keep working while the protocol grows.
 */
export const Part = z.preprocess((v) => {
  const type = (v as { type?: unknown } | null)?.type;
  return typeof type === "string" && !KNOWN_PARTS.has(type)
    ? { type: "notice", level: "info", code: "part.unknown", text: `This part (${type}) needs a newer version of APX.` }
    : v;
}, KnownPart);
export type Part = z.infer<typeof KnownPart>;

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

/** What started a run. Everything enters through threads.send; this only says from where. */
export const RunTrigger = z.enum(["user", "a2a", "a2a_result", "surface", "channel", "routine", "system"]);
export type RunTrigger = z.infer<typeof RunTrigger>;

export const Run = z.object({
  id: Id,
  thread_id: Id,
  agent_id: Id,
  state: RunState,
  trigger: RunTrigger.default("user"),
  /** Delegated runs point at the run that asked for them. */
  parent_run_id: Id.optional(),
  depth: z.number().int().nonnegative().default(0),
  deadline_at: z.string().optional(),
  harness: HarnessId.optional(),
  model: z.string().optional(),
  error: z.string().optional(),
  started_at: z.string(),
  ended_at: z.string().optional(),
  /** Tools called so far. */
  tool_calls: z.number().int().nonnegative().default(0),
  /** What it is doing right now ("Opened github.com"); absent when idle or finished. */
  activity: z.string().optional(),
  /** Tokens reported by the provider for the whole run, when it reports them. */
  usage: z.object({ input: z.number().int(), output: z.number().int() }).optional(),
});
export type Run = z.infer<typeof Run>;

/**
 * Work running on its own, for the background view: an agent's turn outside the thread the owner is in (a
 * delegation, a woken agent) or, later, a terminal command. Built from runs; `thread_id` opens its transcript.
 */
export const Job = z.object({
  id: Id,
  kind: z.enum(["agent", "terminal"]),
  title: z.string(),
  state: RunState,
  thread_id: Id,
  /** The thread that started it (a delegation's caller). */
  parent_thread_id: Id.optional(),
  agent_id: Id.optional(),
  trigger: RunTrigger,
  model: z.string().optional(),
  usage: z.object({ input: z.number().int(), output: z.number().int() }).optional(),
  tool_calls: z.number().int().nonnegative(),
  activity: z.string().optional(),
  started_at: z.string(),
  ended_at: z.string().optional(),
});
export type Job = z.infer<typeof Job>;

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
  /** One part of a message changed (streaming text, a tool card): cheaper than resending the whole message. */
  z.object({
    type: z.literal("message.part"),
    thread_id: Id,
    message_id: Id,
    index: z.number().int().nonnegative(),
    part: Part,
  }),
  z.object({ type: z.literal("run.updated"), run: Run }),
  z.object({ type: z.literal("surface.updated"), surface: SurfaceSummary }),
  z.object({ type: z.literal("browser.tabs"), tabs: z.array(z.unknown()) }),
]);
export type CoreEvent = z.infer<typeof CoreEvent>;
