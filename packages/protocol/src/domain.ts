// Domain shapes every client renders. Run states follow A2A task states so an A2A adapter stays thin.
import { z } from "zod";
import { PERSON_RELATIONS } from "./constants.ts";

export const Id = z.string().min(1).max(128);

/** What a project is, as the owner picks it in its settings. A project's file may still name another kind. */
export const ProjectKind = z.enum(["personal", "app", "company", "software", "other"]);

/**
 * An agent's permission mode, in the order the owner picks from (DECISIONS.md#d-106). `manual`: every call that changes
 * something waits for the owner. `auto` (the default): reads anywhere but APX's home, writes and runs commands in the
 * folder it works in and its temp folder, and asks only for strong actions. `accept_edits`: as auto, but a command that
 * changes something asks. `plan`: reads and proposes, changes nothing. `total`: nothing waits (DECISIONS.md#d-047).
 */
export const Autonomy = z.enum(["manual", "auto", "accept_edits", "plan", "total"]);
export type Autonomy = z.infer<typeof Autonomy>;
/** The mode of an agent and a project that set none. */
export const DEFAULT_AUTONOMY: Autonomy = "auto";

/**
 * What a tool call does, by risk: reads; changes the project (files, memory, delegating); acts outside in the owner's
 * name (messages, posts, clicks on the web); or cannot be undone (deleting, granting). DECISIONS.md#d-090
 */
export const ToolRisk = z.enum(["read", "write", "outside", "irreversible"]);
export type ToolRisk = z.infer<typeof ToolRisk>;
/** An agent's own rule for one risk: runs without asking, asks first, or is never used. */
export const RulePolicy = z.enum(["auto", "ask", "off"]);
export type RulePolicy = z.infer<typeof RulePolicy>;
/** Its rules by risk; a risk left out follows its autonomy. */
export const AgentRules = z.object({
  read: RulePolicy.optional(),
  write: RulePolicy.optional(),
  outside: RulePolicy.optional(),
  irreversible: RulePolicy.optional(),
});
export type AgentRules = z.infer<typeof AgentRules>;

/** What each autonomy amounts to per risk, as the editor shows it before an agent sets rules of its own. */
export const AUTONOMY_RULES: Record<Autonomy, Required<AgentRules>> = {
  manual: { read: "auto", write: "ask", outside: "ask", irreversible: "ask" },
  auto: { read: "auto", write: "auto", outside: "ask", irreversible: "ask" },
  accept_edits: { read: "auto", write: "auto", outside: "ask", irreversible: "ask" },
  plan: { read: "auto", write: "off", outside: "off", irreversible: "off" },
  total: { read: "auto", write: "auto", outside: "auto", irreversible: "auto" },
};

/** The base project (no folder): the owner may name it, describe it and give it a kind, like any other. */
export const BaseProject = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().max(500).optional(),
  kind: ProjectKind.optional(),
  /** How far its agents go on their own when they set nothing themselves. Absent = auto. */
  autonomy: Autonomy.optional(),
});
export type BaseProject = z.infer<typeof BaseProject>;

const OrgSlug = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]*$/)
  .max(40);
/** An area of a company project ("Finance"): agents and roles belong to one. */
export const OrgArea = z.object({
  slug: OrgSlug,
  name: z.string().trim().min(1).max(60),
  goal: z.string().max(300).optional(),
});
/** A role the company has ("Chief Financial Officer"), in an area or general. An agent takes one. */
export const OrgRole = z.object({
  slug: OrgSlug,
  name: z.string().trim().min(1).max(80),
  area: OrgSlug.optional(),
  description: z.string().max(500).optional(),
});
/** A project's areas and roles: `.apc/organization.json` (v1's format), the base project's in APX's settings. */
export const Organization = z.object({ areas: z.array(OrgArea).max(40), roles: z.array(OrgRole).max(200) });
export type Organization = z.infer<typeof Organization>;
export type ProjectKind = z.infer<typeof ProjectKind>;

/**
 * A safety limit, not a budget: a project's AGENTS.md (and .apc/memory.md) reach its agents whole up to this many
 * UTF-16 code units. Past it, the head and tail are sent with a marker naming the lines left out.
 * The owner-facing CLI/UI notice covers AGENTS.md only; token usage depends on the content and model.
 */
export const AGENTS_MD_LIMIT = 200_000;

export const Project = z.object({
  /** False only in the optional history catalog after the owner unregisters a folder. */
  registered: z.boolean().optional(),
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
  /** How far its agents go on their own when they set nothing themselves; kept by APX, never in the folder. */
  autonomy: Autonomy.optional(),
  /** Absolute folders its agents may read and never change (another checkout, docs); kept by APX. */
  read_only_folders: z.array(z.string()).optional(),
  /** AGENTS.md's length when it is past AGENTS_MD_LIMIT: its agents get the head and tail, not all of it. */
  agents_md_chars: z.number().int().optional(),
});
export type Project = z.infer<typeof Project>;

/** Who runs a turn's loop. `acp` covers every Agent Client Protocol CLI; the engine id says which ("acp:opencode"). */
export const HarnessId = z.enum(["native", "claude", "codex", "acp", "aider", "antigravity"]);
export type HarnessId = z.infer<typeof HarnessId>;

/**
 * A model, named by the engine that runs it: "claude/claude-opus-5-5", "codex/gpt-6-sol", "gemini/gemini-3.8-flash".
 * An engine alone ("claude", "codex") means that engine's own default model.
 */
export const ModelRef = z
  .string()
  // An ACP agent's engine id carries its prefix: "acp:opencode/<model>"; "#high" asks for that reasoning effort.
  .regex(/^(acp:)?[a-z0-9][a-z0-9._-]*(\/[^#]+)?(#[a-z0-9-]+)?$/i)
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
    z.object({
      id: z.string(),
      name: z.string(),
      description: z.string().optional(),
      chat: z.boolean(),
      /** The reasoning efforts it takes ("low", "high"…), and the one it uses when none is asked for. */
      efforts: z.array(z.string()).optional(),
      default_effort: z.string().optional(),
    }),
  ),
  fetched_at: z.string().optional(),
  /** A model API's everyday chat model: what the router chain gets when the owner adds this provider. */
  starter: z.string().optional(),
});
export type CatalogEngine = z.infer<typeof CatalogEngine>;

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
  /** The agent it reports to, inside the same project: its slug (or its full id). */
  parent: z.string().optional(),
  /** Group it belongs to in the team view ("product", "sports"). From `area:`. */
  area: z.string().optional(),
  description: z.string().optional(),
  /** "apc" = defined by a file in the project; "local" = defined in APX itself. */
  source: z.enum(["apc", "local"]).default("local"),
  /** The engine of the agent's own model, when it has one (derived from `model_choice`). */
  harness: HarnessId.optional(),
  /** Tools (or groups: browser, widgets, agents, shell) it may use; absent = the default set. From `tools:`. */
  tools: z.array(z.string()).optional(),
  /** How often it stops for the owner's yes. From `autonomy:`; absent = its project's (DECISIONS.md#d-072). */
  autonomy: Autonomy.optional(),
  /** Skills it works with (its catalog is narrowed to these). From `skills:`; absent = every skill it can see. */
  skills: z.array(z.string()).optional(),
  /** How it comes across (warm, dry, playful…), apart from its instructions. */
  personality: z.string().max(1000).optional(),
  /**
   * It runs its team: on top of the chart, and the one work goes to first. From `orchestrator:`; false says it is not,
   * whatever its role suggests; absent, the head is guessed by role.
   */
  orchestrator: z.boolean().optional(),
  /** Its own rules by risk, over its autonomy. From `rules:`. */
  rules: AgentRules.optional(),
});
export type Agent = z.infer<typeof Agent>;

/** Resolved directory metadata; the stored orchestrator flag above remains unchanged. */
export const AgentListing = Agent.extend({
  scope: z.enum(["global", "project"]),
  project_name: z.string().nullable(),
  project_orchestrator: z
    .object({
      id: Id,
      name: z.string(),
      selection: z.enum(["marked", "role", "sole_head"]),
    })
    .nullable(),
  /** Heads the whole project; a marked agent with a parent leads only its reports. */
  is_orchestrator: z.boolean(),
  /** The agent its `parent:` names, resolved by slug or full id; null at the top of its team. */
  reports_to: z.object({ id: Id, name: z.string() }).nullable(),
  /** Ids of the agents that report to it. */
  leads: z.array(Id),
});
export type AgentListing = z.infer<typeof AgentListing>;

/** What the setup and Config → Motores show: installed → logged in → usable. */
export const EngineStatus = z.object({
  /** "native", "claude", "codex" or an ACP agent ("acp:opencode"). */
  id: z.string(),
  label: z.string(),
  installed: z.boolean(),
  logged_in: z.boolean(),
  /** Authentication cannot be probed separately for one-shot CLIs. */
  auth: z.literal("on_invocation").optional(),
  detail_code: z.enum(["oneshot", "oneshot_missing", "oneshot_windows_shim"]).optional(),
  version: z.string().optional(),
  /** Model or account detail, never a secret. */
  detail: z.string().optional(),
  default: z.boolean(),
});
export type EngineStatus = z.infer<typeof EngineStatus>;

/** `queued`: a delegation past the cap of its caller's thread, waiting for one of them to end (DECISIONS.md#d-096). */
export const RunState = z.enum(["queued", "submitted", "working", "input-required", "completed", "failed", "canceled"]);
export type RunState = z.infer<typeof RunState>;
export const TERMINAL_RUN_STATES: readonly RunState[] = ["completed", "failed", "canceled"];

/**
 * Why a run ended, when APX knows: `step_limit` is a turn on APX's own loop that used all its steps (its answer is
 * a progress report, not a final result); `provider_limit` is the model provider's usage limit (its plan or rate),
 * not a fault of the agent; `deadline` is the run's time running out. Absent on runs older than the field and on
 * outside engines' completed turns, which cannot tell.
 */
export const RunEndReason = z.enum(["normal", "step_limit", "failed", "canceled", "deadline", "provider_limit"]);
export type RunEndReason = z.infer<typeof RunEndReason>;

export const ThreadKind = z.enum(["home", "agent", "loose", "a2a", "group", "code", "channel", "task", "routine"]);
/** What an agent may change in a code thread's folder: ask each time, change files freely, or only read. */
export const WritePolicy = z.enum(["ask", "auto", "read-only"]);
export type WritePolicy = z.infer<typeof WritePolicy>;
export type ThreadKind = z.infer<typeof ThreadKind>;

export const Thread = z.object({
  id: Id,
  kind: ThreadKind,
  title: z.string(),
  agent_ids: z.array(Id),
  project_id: Id.optional(),
  /** a2a sub-threads point at the thread (and message) they were spawned from. */
  parent_id: Id.optional(),
  /** The task this chat works on: its agent's answers are posted back to the task as comments. */
  task_id: Id.optional(),
  /** The routine whose execution opened this chat; stable across routine renames. */
  routine_id: Id.optional(),
  /** An a2a sub-thread's name: its caller continues the same session (same agent, same context) by it. */
  session: z.string().optional(),
  /** Code threads: the folder the agent works in (inside its project) and what it may change there. */
  cwd: z.string().optional(),
  write: WritePolicy.optional(),
  /**
   * A session with an outside engine itself ("claude", "codex", "acp:opencode"): the owner talks to that engine with
   * its own prompt, in `cwd`; no agent persona, notes or roster. Its agent only owns the run.
   */
  engine: z.string().optional(),
  /** Channel threads: the conversation on a channel (a Telegram chat…) and the person on the other side. */
  channel: z.object({ id: z.string(), conversation: z.string(), person_id: Id.optional() }).optional(),
  /** The chat's own model, picked in its composer; absent = the agent's. */
  model_choice: ModelChoice.optional(),
  /** The chat in which the super-agent told what an update brought: that release's version. */
  release: z.string().optional(),
  /** The automatic title, present only while the owner's own name (`title`) stands over it. */
  auto_title: z.string().optional(),
  /** Pinned by the owner: first within its group in every list. */
  pinned: z.boolean().optional(),
  /** Archived by the owner: out of the lists (threads.list `include_archived`) until unarchived. */
  archived: z.boolean().optional(),
  state: RunState.or(z.literal("idle")),
  preview: z.string().default(""),
  unread: z.number().int().nonnegative().default(0),
  created_at: z.string(),
  updated_at: z.string(),
});
export type Thread = z.infer<typeof Thread>;

export const Author = z.discriminatedUnion("kind", [
  /** `direct`: the owner wrote to a contact themselves (sent as is), rather than telling the agent what to answer. */
  z.object({ kind: z.literal("user"), direct: z.boolean().optional() }),
  z.object({ kind: z.literal("agent"), id: Id }),
  z.object({ kind: z.literal("system") }),
  /** Text sent by a widget's sendPrompt(): shown apart from the owner's own messages. */
  z.object({ kind: z.literal("surface"), id: Id, title: z.string() }),
  /** Someone other than the owner, writing on a channel (a contact). */
  z.object({ kind: z.literal("person"), id: Id, name: z.string(), channel: z.string() }),
]);
export type Author = z.infer<typeof Author>;

/**
 * Repeated approvals belong to the owner; a session lasts in one chat until the core restarts. `always` with an
 * `agent_id` is that agent's; without one, every agent's. `project` answers a folder card: the folder becomes a
 * read-only folder of the chat's project (never a grant).
 */
export const ApprovalScope = z.enum(["once", "session", "always", "project"]);
export type ApprovalScope = z.infer<typeof ApprovalScope>;
/** Ends the key of a grant for a tool's calls that always ask (a destructive command, a routine change). */
export const STRICT_APPROVAL = "#always";
export const ToolApproval = z.object({
  key: z.string(),
  server: z.string(),
  project_id: Id.optional(),
  tool: z.string(),
  scope: z.enum(["session", "always"]),
  thread_id: Id.optional(),
  agent_id: Id.optional(),
  /**
   * Only calls whose arguments match: comma-separated paths, domains or names ("app/Http/", "github.com"). A call
   * matches when one of its text arguments starts with one, or is a URL on that domain.
   */
  condition: z.string().max(200).optional(),
  /** After this it asks again. */
  expires_at: z.string().optional(),
  granted_at: z.string().optional(),
  /** The chat it was granted from. */
  from_thread: Id.optional(),
});
export type ToolApproval = z.infer<typeof ToolApproval>;

/** A file a turn changed, or a confirmation proposes to change: a unified patch (from the first hunk) when known. */
export const FileChange = z.object({
  path: z.string(),
  status: z.string(),
  added: z.number().int().optional(),
  removed: z.number().int().optional(),
  diff: z.string().max(64_000).optional(),
  truncated: z.boolean().optional(),
});
export type FileChange = z.infer<typeof FileChange>;

export const InputKind = z.enum(["confirm", "question"]);
export type InputKind = z.infer<typeof InputKind>;
/**
 * `expired` = nobody answered in time or the run ended first; for a confirmation it counts as a no. `withdrawn` = the
 * agent took its question back before the owner answered.
 */
export const InputState = z.enum(["pending", "approved", "denied", "answered", "expired", "withdrawn"]);
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
  /** For a confirmation of a file write: what the file would become, as a patch. */
  change: FileChange.optional(),
  options: z.array(z.string()).optional(),
  multi: z.boolean().optional(),
  /** A read outside the agent's folders: the folders it would read, which the owner may let it read. */
  folders: z.array(z.string()).optional(),
  approval_scopes: z.array(ApprovalScope).optional(),
  approval_scope: ApprovalScope.optional(),
  state: InputState,
  answer: z.string().optional(),
  created_at: z.string(),
  expires_at: z.string(),
  answered_at: z.string().optional(),
});
export type PendingInput = z.infer<typeof PendingInput>;

/** Where a document's file is in its chat: a path in the chat's folder, or (`scratch`) in its temp folder. */
export const DocumentSource = z.object({ path: z.string().max(1000), scratch: z.boolean().optional() });
export type DocumentSource = z.infer<typeof DocumentSource>;

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
    /** What it answered (the whole report, up to a few thousand characters). */
    summary: z.string().optional(),
    /** A worker's name: a throwaway helper the caller started for this task (agent_id is then the caller's own). */
    worker: z.string().optional(),
    /** How long it worked, once it ended. */
    ms: z.number().int().nonnegative().optional(),
    /** Why it ended, once it did (a completed run that ran out of steps is not a finished one). */
    end_reason: RunEndReason.optional(),
    /** Who asked, when it is not the message's author (a consult on a task): an agent's id, or "owner". */
    asked_by: z.string().optional(),
    /** A completed run that did not go well: it gave no answer, or some of its actions failed. */
    issue: z.enum(["no_answer", "actions_failed"]).optional(),
  }),
  z.object({
    type: z.literal("browser"),
    tab: z.string(),
    url: z.string(),
    title: z.string(),
    state: z.enum(["agent", "handoff", "user", "done"]),
    reason: z.string().optional(),
  }),
  /** An image: one from the web (`url`) or one APX made (`media_id`, its bytes from media.get). */
  z.object({
    type: z.literal("image"),
    url: z.string().optional(),
    media_id: Id.optional(),
    mime: z.string().optional(),
    alt: z.string().default(""),
  }),
  /** Recorded or synthesized speech; the bytes come from media.get. */
  z.object({ type: z.literal("audio"), media_id: Id, mime: z.string(), transcript: z.string().optional() }),
  /** A file from either participant; document snapshots also open in the side panel. */
  z.object({
    type: z.literal("file"),
    media_id: Id,
    name: z.string(),
    mime: z.string(),
    bytes: z.number().int(),
    document: z
      .object({
        title: z.string().max(120),
        format: z.enum(["markdown", "text"]),
        /** The file it was read from, for files.reveal and files.open. */
        source: DocumentSource.optional(),
      })
      .optional(),
  }),
  /**
   * What changed in a code thread's folder (uncommitted, per git) when the turn ended; with `edits`, the files the
   * agent wrote in this turn with its file tools.
   */
  z.object({
    type: z.literal("changes"),
    cwd: z.string(),
    edits: z.boolean().optional(),
    /** The files are in the chat's temp folder (`cwd`): the agent's scratch work, not changes to the owner's folders. */
    scratch: z.boolean().optional(),
    files: z.array(FileChange),
    more: z.number().int().optional(),
  }),
  /** The agent waits for the owner: a yes/no on an action, or an answer to a question. Answered with runs.respond. */
  z.object({
    type: z.literal("input"),
    input_id: Id,
    kind: InputKind,
    prompt: z.string(),
    /** For a confirmation: the tool and a readable summary of its arguments. */
    tool: z.string().optional(),
    detail: z.string().optional(),
    change: FileChange.optional(),
    options: z.array(z.string()).optional(),
    /** A question whose options may be picked several at once. */
    multi: z.boolean().optional(),
    /** A read outside the agent's folders: the folders it would read (approval_scopes says if they may be kept). */
    folders: z.array(z.string()).optional(),
    approval_scopes: z.array(ApprovalScope).optional(),
    approval_scope: ApprovalScope.optional(),
    state: InputState,
    answer: z.string().optional(),
  }),
  /**
   * The skills of this turn: given whole (`loaded`: one named with "/name"), named for the agent to load (`strong`
   * when very close, else `hinted`), and the closest ones weighed (`scored`, with their raw similarity), so the chat
   * can show what went in and what nearly did. Turns before strong existed have none.
   */
  z.object({
    type: z.literal("skills"),
    engine: z.string(),
    loaded: z.array(z.string()),
    strong: z.array(z.string()).optional(),
    hinted: z.array(z.string()),
    scored: z.array(z.object({ name: z.string(), sim: z.number() })),
  }),
  /**
   * A few answers the agent offers (and, `custom`, one the owner writes); picking one replies with it. `for` says what
   * the pick also sets: the agent's personality.
   */
  z.object({
    type: z.literal("choices"),
    for: z.enum(["personality"]),
    options: z.array(z.object({ label: z.string(), value: z.string() })),
    custom: z.boolean().optional(),
  }),
  /** Something the system says about the turn (interrupted, fallback engine, no answer): never the agent's words. */
  z.object({
    type: z.literal("notice"),
    level: z.enum(["info", "warn", "error"]),
    /** Stable code the UI translates (e.g. "run.interrupted"); `text` is the English fallback. */
    code: z.string(),
    text: z.string(),
    /** Values for the translated text's {placeholders}. */
    vars: z.record(z.string(), z.union([z.string(), z.number()])).optional(),
    /** Verbatim output that is never translated (e.g. a routine command's last lines). */
    detail: z.string().optional(),
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

export const MessageDelivery = z.enum(["pending", "sent", "delivered", "read", "failed"]);
export type MessageDelivery = z.infer<typeof MessageDelivery>;
/** An emoji on a channel message: the agent's own, or the other side's (the contact, or the owner on their chat). */
export const MessageReaction = z.object({ emoji: z.string().min(1).max(32), by: z.enum(["agent", "them"]) });
export type MessageReaction = z.infer<typeof MessageReaction>;
export const Message = z.object({
  id: Id,
  thread_id: Id,
  seq: z.number().int(),
  author: Author,
  parts: z.array(Part),
  run_id: Id.optional(),
  model: z.string().optional(),
  /** Sent on a channel: queued, taken by the platform, on their device, seen by them, or not sent. */
  delivery: MessageDelivery.optional(),
  /** Emoji put on it on a channel, at most one per side. */
  reactions: z.array(MessageReaction).optional(),
  created_at: z.string(),
});
export type Message = z.infer<typeof Message>;

/** Tokens of a run; `context` is the last model call's input (how full the chat is), `window` that model's limit. */
export const RunUsage = z.object({
  input: z.number().int(),
  output: z.number().int(),
  context: z.number().int().optional(),
  window: z.number().int().optional(),
  /** Prompt tokens a provider read from its cache (cheaper, and counted inside `input`). */
  cached: z.number().int().optional(),
});
export type RunUsage = z.infer<typeof RunUsage>;

/** What an auxiliary model call was for: a chat's title, a long chat's summary, a room's gate, a commit message. */
export const AuxPurpose = z.enum([
  "title",
  "summary",
  "room",
  "commit",
  "suggestion",
  "memory_capture",
  "memory_dream",
  "news",
]);
export type AuxPurpose = z.infer<typeof AuxPurpose>;

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
  end_reason: RunEndReason.optional(),
  /** A run stopped by a provider limit: when the provider said that limit lifts. */
  resets_at: z.string().optional(),
  started_at: z.string(),
  ended_at: z.string().optional(),
  /** Tools called so far. */
  tool_calls: z.number().int().nonnegative().default(0),
  /** What it is doing right now ("Opened github.com"); absent when idle or finished. */
  activity: z.string().optional(),
  /** Tokens reported by the provider for the whole run, when it reports them. */
  usage: RunUsage.optional(),
});
export type Run = z.infer<typeof Run>;

/** What an agent's turn carries, as the core stamped it: the owner's message, a helper's result, a routine… */
export const JobFrom = z.object({
  kind: z.enum([
    "user",
    "agent",
    "surface",
    "channel",
    "routine",
    "input_answer",
    "job",
    "terminal",
    "go_on",
    "stalled_task",
    "task_result",
    "delegation_result",
  ]),
  /** Who sent it (the helper, the contact, the routine, the surface), when it has a name. */
  name: z.string().optional(),
});
export type JobFrom = z.infer<typeof JobFrom>;

/**
 * Every agent turn not over yet (working or queued) and the latest finished ones, or a terminal command an agent
 * started. `thread_id` opens the chat it belongs to.
 */
export const Job = z.object({
  id: Id,
  kind: z.enum(["agent", "terminal"]),
  title: z.string(),
  state: RunState,
  thread_id: Id,
  /** Display provenance even when the owning chat is not loaded by the operator. */
  thread_title: z.string().optional(),
  agent_name: z.string().optional(),
  /** The thread that started it (a delegation's caller). */
  parent_thread_id: Id.optional(),
  agent_id: Id.optional(),
  trigger: RunTrigger,
  /** Agent jobs: what the turn carries, to name one still queued ("Alma's result"). */
  from: JobFrom.optional(),
  model: z.string().optional(),
  usage: RunUsage.optional(),
  tool_calls: z.number().int().nonnegative(),
  activity: z.string().optional(),
  /** Terminal jobs: where the command runs, how it exited, and whether it was started in the background. */
  cwd: z.string().optional(),
  exit_code: z.number().int().optional(),
  background: z.boolean().optional(),
  started_at: z.string(),
  ended_at: z.string().optional(),
});
export type Job = z.infer<typeof Job>;

/** A model API our own loop calls (Gemini, OpenCode Zen, Groq, a local Ollama…). The key never leaves the core. */
export const ProviderTransport = z.enum(["openai-chat", "anthropic-messages", "chatgpt-responses"]);
export type ProviderTransport = z.infer<typeof ProviderTransport>;

/** The ChatGPT plan's sign-in for APX's own loop. */
export const ChatgptStatus = z.object({
  connected: z.boolean(),
  account: z.string().optional(),
  /** A sign-in in progress: the code the owner types at the address. */
  pending: z.object({ user_code: z.string(), verification_url: z.string(), expires_at: z.string() }).optional(),
  error: z.string().optional(),
  /** APX v1 has a ChatGPT sign-in of its own that can be taken over. */
  v1_available: z.boolean(),
});
export type ChatgptStatus = z.infer<typeof ChatgptStatus>;

export const ProviderInfo = z.object({
  /** Only a masked key suffix, never a credential. */
  key_hint: z.string().max(4).optional(),
  id: z.string(),
  label: z.string(),
  /** The kind of service, for its card's look (gemini, groq, ollama, openrouter…). */
  preset: z.string().optional(),
  transport: ProviderTransport,
  base_url: z.string(),
  /** Whether a key is stored (or none is needed); for a signed-in plan, whether it is signed in. */
  key_set: z.boolean(),
  /** Signed in rather than keyed: the sign-in it uses ("chatgpt"). */
  sign_in: z.string().optional(),
  needs_key: z.boolean(),
  /** A fixed model list, for servers that cannot list their own; empty = asked to the provider. */
  models: z.array(z.string()),
  enabled: z.boolean(),
  builtin: z.boolean(),
});
export type ProviderInfo = z.infer<typeof ProviderInfo>;

/**
 * A note agents keep between threads. `global`: about the owner, every agent sees it; `project`: agents working in
 * that project; `agent`: only that agent. `source` says who wrote it: the owner's notes are not an agent's to remove.
 */
export const MemoryScope = z.enum(["global", "project", "agent"]);
export type MemoryScope = z.infer<typeof MemoryScope>;
export const MemoryEvidence = z.object({
  message_id: Id,
  quote: z.string().min(3).max(2000),
  /** Derived by the core from the owner's confirmation or a read after a write. */
  verification: z
    .object({
      kind: z.enum(["owner_confirmation", "observed_result"]),
      criterion: z.string().min(3).max(300),
      step_ids: z.array(z.string().min(1).max(200)).max(8).optional(),
    })
    .optional(),
});
export type MemoryEvidence = z.infer<typeof MemoryEvidence>;
export const Memory = z.object({
  id: Id,
  scope: MemoryScope,
  project_id: Id.optional(),
  agent_id: Id.optional(),
  text: z.string(),
  revision: z.number().int().positive().optional(),
  /** `procedure`: how the agent did something that worked, kept as history (never as an instruction). */
  kind: z.enum(["user", "feedback", "project", "reference", "procedure"]).optional(),
  evidence: z.array(MemoryEvidence).optional(),
  source: z.enum(["owner", "agent"]),
  /** The agent that wrote it, and the thread and run it learned it in. */
  author_agent: Id.optional(),
  thread_id: Id.optional(),
  run_id: Id.optional(),
  /** A note an agent wrote about the owner (global): it waits for the owner to confirm it before it stands. */
  pending: z.boolean(),
  /** Forgotten by the owner or an agent: kept out of every turn until the owner brings it back. */
  forgotten_at: z.string().optional(),
  /** Saved by an agent while outside content was in its turn: agents see it as data, not as the owner's word. */
  tainted: z.boolean(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type Memory = z.infer<typeof Memory>;

/**
 * People APX talks to. The owner is one person with addresses on each channel; a contact gets a sealed conversation
 * (no tools, no memory, nothing of the owner's); anyone else is a stranger until the owner approves a pairing code.
 */
export const PersonRole = z.enum(["owner", "contact", "blocked"]);
export type PersonRole = z.infer<typeof PersonRole>;
export const Address = z.object({
  id: Id,
  person_id: Id,
  /** The channel instance ("telegram-main") and the id the platform gives this person there. */
  channel: z.string(),
  external_id: z.string(),
  label: z.string().optional(),
});
export type Address = z.infer<typeof Address>;
/** How a contact relates to the owner: it shapes how the agent talks to them. */
export const PersonRelation = z.enum(PERSON_RELATIONS);
export type PersonRelation = z.infer<typeof PersonRelation>;
/**
 * What a contact's chat may do besides talking. All off by default: each one gives the sealed turn exactly one
 * narrow tool (see DECISIONS.md#d-022).
 */
export const PersonPerms = z.object({
  /** Note an appointment they ask for, for the owner to confirm. */
  appointments: z.boolean().default(false),
  /** Note a request they make (a purchase, a favor) as a task for the owner. */
  requests: z.boolean().default(false),
  /** Answer from the owner's own notes (global ones only, read-only). */
  notes: z.boolean().default(false),
});
export type PersonPerms = z.infer<typeof PersonPerms>;
export const Person = z.object({
  id: Id,
  name: z.string(),
  role: PersonRole,
  /** "Who they are", in the owner's words: reaches only the turns that answer this person. */
  note: z.string().optional(),
  nickname: z.string().optional(),
  relation: PersonRelation.optional(),
  /** The owner's rules for answering them; they go last in the prompt. */
  rules: z.string().optional(),
  /** Silenced: their messages are kept, never answered. */
  muted: z.boolean().default(false),
  /** Wrote first and was kept silenced for the owner to decide: each message of theirs is reported meanwhile. */
  unreviewed: z.boolean().default(false),
  /**
   * Supervised: their messages get a reply drafted, never sent on its own; the owner sends it, edits it or drops it.
   * Silenced and supervised exclude each other (setting one clears the other).
   */
  supervised: z.boolean().default(false),
  perms: PersonPerms.default({ appointments: false, requests: false, notes: false }),
  addresses: z.array(Address),
  created_at: z.string(),
});
export type Person = z.infer<typeof Person>;

/** What became of a reply drafted for a supervised contact. */
export const SuggestionState = z.enum(["pending", "sent", "discarded", "superseded"]);
export type SuggestionState = z.infer<typeof SuggestionState>;
/** A reply the agent drafted for a supervised contact, waiting for the owner (see channels/suggestions.ts). */
export const ContactSuggestion = z.object({
  id: Id,
  person_id: Id,
  /** The contact's chat, where it goes once sent. */
  thread_id: Id,
  channel: z.string(),
  /** Their messages it answers, oldest first. */
  said: z.array(z.string()),
  /** The reply the agent would send; empty when it wrote none (see `error`). */
  text: z.string(),
  /** Why there is no draft: no model answered, or nothing needed an answer. */
  error: z.string().optional(),
  model: z.string().optional(),
  state: SuggestionState,
  created_at: z.string(),
  decided_at: z.string().optional(),
  /** The chat message it became, once sent. */
  message_id: Id.optional(),
});
export type ContactSuggestion = z.infer<typeof ContactSuggestion>;

export const ChannelStrangers = z.enum(["pair", "ask", "answer", "ignore"]);
export type ChannelStrangers = z.infer<typeof ChannelStrangers>;

/** A channel instance as the owner configured it, and how it is doing. */
/** The channels APX can run: a bot or account the owner connects. */
export const ChannelType = z.enum([
  "telegram",
  "whatsapp",
  "discord",
  "slack",
  "matrix",
  "mattermost",
  "signal",
  "email",
]);
export type ChannelType = z.infer<typeof ChannelType>;

/**
 * How the bot behaves in a room (a Discord server's channel, a Telegram group): answer everything, only when called, only when it
 * can really help (a cheap model judges, by the owner's criterion), or never (it reads, so the owner can ask later).
 */
export const RoomMode = z.enum(["always", "mention", "useful", "read"]);
export type RoomMode = z.infer<typeof RoomMode>;

/**
 * Public rooms (a Discord server's channels, Telegram groups). Deny by default: a room that is not listed does not exist for APX. People
 * there are strangers in public: the agent answers sealed (no tools, no memory, nothing of the owner's), by the owner's
 * knowledge and rules.
 */
export const ChannelRooms = z.object({
  rooms: z
    .array(z.object({ id: z.string().min(1).max(40), name: z.string().max(80).default(""), mode: RoomMode }))
    .max(50),
  /** Words that count as calling the bot (besides an @mention or a reply to it). */
  names: z.array(z.string().min(1).max(40)).max(10).default([]),
  /** Answer only the owner in rooms; everyone else is read, never answered. */
  owner_only: z.boolean().default(false),
  /** What it can do and answer there: written by the owner, public. */
  knowledge: z.string().max(12_000).default(""),
  /** Hard rules for what it says there; they go last and win. */
  rules: z.string().max(2000).default(""),
  /** When an uncalled message deserves an answer (the "useful" rooms). */
  reply_when: z.string().max(2000).default(""),
  /** Between two answers to one person; answers per room per hour; uncalled messages judged per room per hour. */
  limits: z
    .object({
      user_cooldown_s: z.number().int().min(0).max(3600).default(20),
      room_replies_per_hour: z.number().int().min(1).max(600).default(30),
      checks_per_hour: z.number().int().min(0).max(1000).default(120),
    })
    .default({ user_cooldown_s: 20, room_replies_per_hour: 30, checks_per_hour: 120 }),
});
export type ChannelRooms = z.infer<typeof ChannelRooms>;

/** How a mail server is reached: TLS from the start (993, 465), STARTTLS (143, 587), or plain (this machine only). */
export const MailServer = z.object({
  host: z
    .string()
    .min(1)
    .max(253)
    .regex(/^[a-z0-9.:[\]-]+$/i),
  port: z.number().int().min(1).max(65_535),
  tls: z.enum(["implicit", "starttls", "none"]),
});
export type MailServer = z.infer<typeof MailServer>;

/** An email channel's mailbox: read over IMAP, answered over SMTP. The password is the channel's secret. */
export const ChannelEmail = z.object({
  /** The address mail is sent from (and the mailbox's own, whose mail is never answered). */
  address: z.email().max(254),
  /** The display name on sent mail. */
  name: z.string().max(80).optional(),
  /** The sign-in name, when it is not the address. */
  username: z.string().max(254).optional(),
  imap: MailServer,
  smtp: MailServer,
  mailbox: z.string().min(1).max(200).default("INBOX"),
  /** Only mail from these addresses (or "@domain") is read; empty: anyone (strangers get a pairing code). */
  allowed: z.array(z.string().min(3).max(254)).max(100).default([]),
  /**
   * Also read mail its server could not verify (no DKIM, SPF or DMARC pass for the sender's domain). Off: such mail is
   * dropped, since anyone can write the owner's address in a From line.
   */
  trust_unverified: z.boolean().default(false),
});
export type ChannelEmail = z.infer<typeof ChannelEmail>;

export const ChannelClosers = z.enum(["silent", "react"]);
export type ChannelClosers = z.infer<typeof ChannelClosers>;

/**
 * Who may have a sealed chat of this channel (a room, a contact's chat) search the web and read public pages: no one,
 * only the owner when they ask in a room, or anyone it answers. Nothing else of the owner's ever opens to them.
 */
export const ChannelResearch = z.enum(["off", "owner", "everyone"]);
export type ChannelResearch = z.infer<typeof ChannelResearch>;

export const ChannelInfo = z.object({
  id: z.string(),
  type: ChannelType,
  label: z.string(),
  enabled: z.boolean(),
  /** The agent that answers on it. */
  agent_id: Id,
  /**
   * What a stranger's first message gets: a pairing code the owner approves (on the owner's own number: only listed),
   * a notice asking the owner first, an answer right away as a new contact, or nothing.
   */
  strangers: ChannelStrangers,
  /** A new message while the agent is working: wait for it, stop it, or (APX's own loop) slip into it. */
  concurrency: z.enum(["queue", "interrupt", "steer"]),
  /** The owner's messages go to the Home chat (one conversation everywhere) or to a chat of this channel. */
  owner_thread: z.enum(["home", "own"]),
  /**
   * WhatsApp: the linked number is the owner's own phone, so "Message yourself" is the owner talking. Off: a line of
   * its own the agent answers on, and the owner writes to it from their phone (linked with a code or by number).
   */
  self_owner: z.boolean().optional(),
  /** Discord: the server rooms it reads and may speak in; Telegram: its groups. None: only direct messages. */
  rooms: ChannelRooms.optional(),
  /**
   * A message that needs no answer ("ok", "gracias"): left in silence (none: the same), or answered with an emoji
   * reaction where the channel has them. Neither calls the model.
   */
  closers: ChannelClosers.optional(),
  /** Web search and reading in its sealed chats (none set: only when the owner asks). See DECISIONS.md#d-059 */
  research: ChannelResearch.optional(),
  /** Email: the mailbox and its servers. */
  email: ChannelEmail.optional(),
  token_set: z.boolean(),
  /** The stored token, masked for the owner to recognize it: the bot's number and the secret's last four. */
  token_hint: z.string().optional(),
  status: z.enum(["off", "starting", "running", "error"]),
  error: z.string().optional(),
  /** The account the channel runs as (a bot's @name, a WhatsApp number). */
  account: z.string().optional(),
  /** WhatsApp: the QR to scan from the phone to link the account, while one is waiting. Owner-only, never logged. */
  qr: z.string().optional(),
});
export type ChannelInfo = z.infer<typeof ChannelInfo>;

/** A stranger who wrote on a channel and is waiting for the owner to approve them. */
export const PairingRequest = z.object({
  code: z.string(),
  channel: z.string(),
  external_id: z.string(),
  name: z.string(),
  text: z.string().optional(),
  created_at: z.string(),
  expires_at: z.string(),
});
export type PairingRequest = z.infer<typeof PairingRequest>;

/**
 * A media service the owner runs or uses: an image generator (a homelab's A1111 or stable-diffusion.cpp, an
 * OpenAI-compatible API) or a voice (QVox and other OpenAI-compatible speech servers, Gemini). Per kind, the first
 * reachable enabled one in the owner's order answers.
 */
export const ServiceKind = z.enum(["image", "speech", "embedding", "transcription"]);
export type ServiceKind = z.infer<typeof ServiceKind>;
export const ServiceDialect = z.enum([
  "a1111",
  "sdcpp",
  "openai-images",
  /** The owner's own Codex draws with its image_gen tool, on their ChatGPT plan (no address or key). */
  "codex-images",
  "openai-speech",
  "gemini-speech",
  "ollama-embed",
  "gemini-embed",
  "openai-embed",
  "whisper-local",
  "whisper-cpp",
  "openai-transcribe",
]);
export type ServiceDialect = z.infer<typeof ServiceDialect>;

/** Transcription on this machine: what it can run well, the models to pick from, and a download in progress. */
export const LocalTranscription = z.object({
  machine: z.object({
    platform: z.string(),
    arch: z.string(),
    cores: z.number().int(),
    memory_gb: z.number(),
    accel: z.enum(["metal", "cpu"]),
    /** whisper.cpp's server is installed. */
    server: z.boolean(),
    ffmpeg: z.boolean(),
  }),
  /** How to install what is missing on this system. */
  install_hint: z.string().optional(),
  recommended: z.string(),
  models: z.array(
    z.object({
      id: z.string(),
      mb: z.number(),
      quality: z.enum(["basic", "good", "great"]),
      installed: z.boolean(),
    }),
  ),
  download: z
    .object({ model: z.string(), received: z.number(), total: z.number(), error: z.string().optional() })
    .optional(),
  /** The model the local service uses now. */
  active: z.string().optional(),
});
export type LocalTranscription = z.infer<typeof LocalTranscription>;

/** Memory by meaning on this machine: Ollama here (or not), its embedding models, the one that fits, a pull going on. */
export const LocalEmbedding = z.object({
  memory_gb: z.number(),
  ollama: z.object({
    url: z.string(),
    running: z.boolean(),
    version: z.string().optional(),
    /** The embedding models it has pulled. */
    models: z.array(z.object({ name: z.string(), mb: z.number() })),
  }),
  /** Ollama's library models to pick from, with their download size. */
  library: z.array(z.object({ id: z.string(), mb: z.number(), quality: z.enum(["basic", "good", "great"]) })),
  recommended: z.string(),
  pull: z
    .object({ model: z.string(), completed: z.number(), total: z.number(), error: z.string().optional() })
    .optional(),
  /** The embedding engine in use now ("Ollama · bge-m3"). */
  active: z.string().optional(),
});
export type LocalEmbedding = z.infer<typeof LocalEmbedding>;
export const ImageDefaults = z.object({
  width: z.number().int().min(64).max(4096),
  height: z.number().int().min(64).max(4096),
  steps: z.number().int().min(1).max(200),
  cfg_scale: z.number().min(0).max(50),
  negative_prompt: z.string().max(2000),
  count: z.number().int().min(1).max(8),
});
export type ImageDefaults = z.infer<typeof ImageDefaults>;
export const ServiceSettings = z.object({
  kind: ServiceKind,
  dialect: ServiceDialect,
  label: z.string().min(1).max(60),
  base_url: z.string().url(),
  enabled: z.boolean(),
  needs_key: z.boolean(),
  model: z.string().max(200).optional(),
  voice: z.string().max(100).optional(),
  language: z.string().max(20).optional(),
  style: z.string().max(300).optional(),
  /** QVox cloned voices: the reference recording (a path on the QVox machine), its words, and how loose to read. */
  clone: z.string().max(500).optional(),
  ref_text: z.string().max(2000).optional(),
  temperature: z.number().min(0).max(2).optional(),
  /** Image services: this one's own defaults over the shared ones. */
  defaults: ImageDefaults.partial().optional(),
});
export type ServiceSettings = z.infer<typeof ServiceSettings>;
export const ServiceInfo = ServiceSettings.extend({
  id: z.string(),
  key_set: z.boolean(),
  /** Checked a moment ago: answers, does not answer, or not checked (switched off). */
  status: z.enum(["reachable", "unreachable", "unknown"]),
});
export type ServiceInfo = z.infer<typeof ServiceInfo>;
/**
 * A service asked now: it answers (with the models it offers, when it lists them), or why not: no answer in time,
 * nothing listening there, an unknown name, a refused key, another HTTP error.
 */
export const ServiceTest = z.object({
  ok: z.boolean(),
  problem: z.enum(["timeout", "refused", "name", "key", "http", "other"]).optional(),
  detail: z.string().optional(),
  models: z.array(z.string()).optional(),
});
export type ServiceTest = z.infer<typeof ServiceTest>;

/**
 * How memory works: notes searched by their words (default), also by meaning (an embedding model indexes them), or
 * no memory at all. And how long chats are kept small: summaries by an auxiliary model.
 */
/**
 * Who the owner is, as every agent working for them knows it: their name, a few lines about them, the language agents
 * answer in and the time zone their day runs on.
 */
export const OwnerIdentity = z.object({
  name: z.string().trim().max(80).default(""),
  about: z.string().max(2000).default(""),
  /** ISO 639-1 ("es", "en"). */
  language: z
    .string()
    .regex(/^[a-z]{2}$/)
    .default("es"),
  /** IANA ("America/Argentina/Buenos_Aires"); empty: this machine's. */
  timezone: z.string().max(60).default(""),
});
export type OwnerIdentity = z.infer<typeof OwnerIdentity>;

export const MemorySettings = z.object({
  mode: z.enum(["notes", "semantic", "off"]),
  /** Each message picks the skills it calls for by meaning (needs an embedding engine). */
  skill_picker: z.boolean().default(true),
  /** Summarize long chats' older turns automatically. */
  auto_compact: z.boolean(),
  auto_recall: z.boolean().optional(),
  auto_capture: z.boolean().optional(),
  auto_dream: z.boolean().optional(),
  daily_memory_calls: z.number().int().min(0).max(200).optional(),
  /** The auxiliary model for titles and summaries: a model ref, "off", or none (the agent's own API models). */
  aux_model: z.string().max(200).optional(),
});
export type MemorySettings = z.infer<typeof MemorySettings>;

/** How APX reaches the owner when they are not looking at the app. */
export const NoticePrefs = z.object({
  /**
   * Where notices go: a channel (its id) or a paired device's push ("device:<id>"); none = the first running channel
   * that knows the owner.
   */
  channel: z.string().optional(),
  /**
   * Quiet hours (local time, "HH:MM"): what APX would say unasked waits until they end (and then goes together); answers
   * and questions still arrive, without sound.
   */
  quiet_from: z
    .string()
    .regex(/^\d{2}:\d{2}$/)
    .optional(),
  quiet_to: z
    .string()
    .regex(/^\d{2}:\d{2}$/)
    .optional(),
  /** A confirmation or question unanswered in the app this long also goes to the channel (0 = never). */
  inputs_after_s: z.number().int().min(0).max(86_400).default(120),
  /** Messages APX may send unasked in a day, besides the ones that always arrive (0 = no cap). */
  budget_per_day: z.number().int().min(0).max(50).default(3),
  /** Least time between two unasked messages about the same project, and of the same kind (minutes; 0 = none). */
  project_gap_min: z.number().int().min(0).max(1440).default(180),
  kind_gap_min: z.number().int().min(0).max(1440).default(120),
  /** Something critical may go past the daily cap; and, separately, may arrive during quiet hours. */
  critical_skips_budget: z.boolean().default(true),
  critical_wakes: z.boolean().default(false),
});
export type NoticePrefs = z.infer<typeof NoticePrefs>;

/** One message APX meant to send unasked, and what the interruption budget did with it. */
export const Nudge = z.object({
  id: Id,
  at: z.string(),
  /** What it is about: "routine:<name>", "reminder", "digest"… */
  kind: z.string(),
  text: z.string(),
  thread_id: Id.optional(),
  project_id: Id.optional(),
  /** sent; held (quiet hours, it goes when they end); dropped (over the cap or too soon after another); merged (held,
   * then sent inside a digest, or told in the team news); relay (another agent's news, waiting for the super-agent's
   * team news); no_channel (nowhere to send it). */
  state: z.enum(["sent", "held", "dropped", "merged", "relay", "no_channel"]),
  reason: z.string().optional(),
  /** It always arrives (an anchor like the morning brief) or went past the cap as critical: not counted. */
  exempt: z.boolean(),
  /** The owner's 👍/👎 on it. */
  feedback: z.enum(["up", "down"]).optional(),
});
export type Nudge = z.infer<typeof Nudge>;

export const OutboxState = z.enum(["queued", "sending", "sent", "uncertain", "failed"]);
export const OutboxItem = z.object({
  id: Id,
  channel: z.string(),
  conversation: z.string(),
  thread_id: Id.optional(),
  kind: z.enum(["reply", "notice", "pairing", "input"]),
  text: z.string(),
  state: OutboxState,
  attempts: z.number().int(),
  error: z.string().optional(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type OutboxItem = z.infer<typeof OutboxItem>;

/** An MCP server an agent may use: the owner's own, or one a project's `.apc/mcps.json` names. */
export const McpServerStatus = z.object({
  name: z.string(),
  scope: z.enum(["global", "project"]),
  project_id: Id.optional(),
  transport: z.enum(["stdio", "http"]),
  /** The command line or URL (no secret values: those are references). */
  target: z.string(),
  enabled: z.boolean(),
  /** A project's server runs only after the owner approved this exact definition. */
  trusted: z.boolean(),
  /** needs-sign-in: it asked the owner to sign in in their browser and is not started again until they do. */
  status: z.enum(["off", "needs-approval", "disabled", "starting", "ready", "error", "needs-sign-in"]),
  /** The page it asked the owner to open, while it still waits for them there. */
  sign_in_url: z.string().optional(),
  tools: z.number().int(),
  /** Tool names once it has started. */
  tool_names: z.array(z.string()).default([]),
  /** Owner-wide grants for the current tool contracts; unknown until tools have been loaded. */
  tool_permission_mode: z.enum(["unknown", "ask", "all", "some"]).default("unknown"),
  /** Stored secrets its definition names (`secret://NAME`), and whether each has a value. */
  vars: z.array(z.object({ name: z.string(), set: z.boolean() })).default([]),
  /** One of the owner's servers that runs only in its project (`project_id`), like v1's per-project servers. */
  only: z.boolean().default(false),
  /** A global server turned off inside the project asked about. */
  off_here: z.boolean().default(false),
  /**
   * As it is defined, to edit it: one the owner added in APX (values hold secret:// references, never the secrets) or
   * a project's file. Absent for an extension's servers (they come with the extension).
   */
  definition: z
    .object({
      command: z.string().optional(),
      args: z.array(z.string()),
      env: z.record(z.string(), z.string()),
      url: z.string().optional(),
      headers: z.record(z.string(), z.string()),
    })
    .optional(),
  error: z.string().optional(),
});
export type McpServerStatus = z.infer<typeof McpServerStatus>;

/** One primitive for widgets, sidebar panels and fullscreen apps. */
/** A widget's state: JSON values by key. */
export const SurfaceState = z.record(z.string().min(1).max(100), z.unknown());
export type SurfaceState = z.infer<typeof SurfaceState>;
/** An origin a widget may read live data from: https or wss, a host and maybe a port, nothing else. */
export const SurfaceOrigin = z
  .string()
  .max(200)
  .regex(/^(https|wss):\/\/[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+(:\d{1,5})?$/);

/** Where an installed artifact came from: who made it, and where, as its file said. Absent for one made here. */
export const ArtifactOrigin = z.object({
  /** The person whose APX it was exported from. */
  author: z.string().max(80).optional(),
  /** The agent that made it there. */
  agent: z.string().max(80).optional(),
  /** The project it belonged to there. */
  project: z.string().max(120).optional(),
  /** Its version when exported. */
  version: z.number().int().min(1).optional(),
  exported_at: z.string().max(40).optional(),
  installed_at: z.string().max(40),
});
export type ArtifactOrigin = z.infer<typeof ArtifactOrigin>;
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
  /** Origins it may connect to for live data (shown to the owner); absent: no network at all. */
  connect: z.array(SurfaceOrigin).max(5).optional(),
  /** What it remembers (APX.state): kept across openings and new versions, read and written by it and its agent. */
  state: SurfaceState.optional(),
  /** Installed from a file: who made it and where. */
  origin: ArtifactOrigin.optional(),
});
export type Surface = z.infer<typeof Surface>;
export const SurfaceSummary = Surface.omit({ html: true, state: true });
export type SurfaceSummary = z.infer<typeof SurfaceSummary>;

/** Most an artifact's store (APX.store) may hold, as JSON bytes of every value together. */
export const ARTIFACT_STORE_MAX = 5_000_000;
/** Largest an artifact's database file (APX.db) may grow. */
export const ARTIFACT_DB_MAX = 50_000_000;
/** An artifact's own secret key (its full name is `artifact.<name>.<key>`). */
export const ArtifactSecretKey = z
  .string()
  .min(1)
  .max(60)
  .regex(/^[a-z0-9][a-z0-9_-]*$/);
/** What an artifact is, as a bundle names it: enough to install it again without its owner's data. */
export const ArtifactManifest = z.object({
  name: z
    .string()
    .min(1)
    .max(60)
    .regex(/^[a-z0-9][a-z0-9-]*$/),
  title: z.string().min(1).max(120),
  kind: z.enum(["widget", "app"]),
  version: z.number().int().min(1),
  /** The kit version its HTML loads (/_apx/kit@<version>.js). */
  kit: z.string().max(40).optional(),
  connect: z.array(SurfaceOrigin).max(5).optional(),
  /** Secret keys it expects, never their values. */
  secrets: z.array(ArtifactSecretKey).max(20).optional(),
  live: z.boolean().optional(),
  /** Schema version of its database, for future migrations. */
  data_version: z.number().int().min(0).optional(),
  source: z.object({ framework: z.enum(["preact", "html"]).optional(), built_at: z.string().optional() }).optional(),
  /** Who made it: the person whose APX exported it, its agent and its project there (kept through later exports). */
  author: z.string().max(80).optional(),
  agent: z.string().max(80).optional(),
  project: z.string().max(120).optional(),
  exported_at: z.string().max(40).optional(),
});
export type ArtifactManifest = z.infer<typeof ArtifactManifest>;
/** One artifact as a file: its page and, only when asked, its memory (state, store, base64 database). */
export const ArtifactBundle = z.object({
  format: z.literal("apx-artifact@1"),
  manifest: ArtifactManifest,
  html: z.string().min(1).max(400_000),
  state: SurfaceState.optional(),
  store: z.record(z.string(), z.unknown()).optional(),
  db: z.string().optional(),
});
export type ArtifactBundle = z.infer<typeof ArtifactBundle>;
/** A value bound to an artifact's SQL: what SQLite takes as a parameter. */
export const ArtifactSqlParam = z.union([z.string(), z.number(), z.null(), z.boolean()]);
/** What an artifact remembers, sizes only (its contents stay with it). */
export const ArtifactMemory = z.object({
  state_chars: z.number().int(),
  store: z.object({ keys: z.array(z.string()), bytes: z.number().int() }),
  db: z.object({ bytes: z.number().int(), tables: z.array(z.object({ name: z.string(), rows: z.number().int() })) }),
  /** The origin each of its secrets was first sent to; it is sent nowhere else until the owner resets the pins. */
  secrets: z.array(z.object({ key: z.string(), origin: z.string() })),
});
export type ArtifactMemory = z.infer<typeof ArtifactMemory>;
