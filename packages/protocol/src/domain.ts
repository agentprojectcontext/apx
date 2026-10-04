// Domain shapes every client renders. Run states follow A2A task states so an A2A adapter stays thin.
import { z } from "zod";
import { PERSON_RELATIONS } from "./constants.ts";

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

/** Who runs a turn's loop. `acp` covers every Agent Client Protocol CLI; the engine id says which ("acp:opencode"). */
export const HarnessId = z.enum(["native", "claude", "codex", "acp"]);
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
  /** Group it belongs to in the team view ("product", "sports"). From `area:`. */
  area: z.string().optional(),
  description: z.string().optional(),
  /** "apc" = defined by a file in the project; "local" = defined in APX itself. */
  source: z.enum(["apc", "local"]).default("local"),
  /** The engine of the agent's own model, when it has one (derived from `model_choice`). */
  harness: HarnessId.optional(),
  /** Tools (or groups: browser, widgets, agents, shell) it may use; absent = the default set. From `tools:`. */
  tools: z.array(z.string()).optional(),
  /** How often it stops for the owner's yes. From `autonomy:`; absent = standard. */
  autonomy: Autonomy.optional(),
  /** Skills it works with (its catalog is narrowed to these). From `skills:`; absent = every skill it can see. */
  skills: z.array(z.string()).optional(),
  /** How it comes across (warm, dry, playful…), apart from its instructions. */
  personality: z.string().max(1000).optional(),
});
export type Agent = z.infer<typeof Agent>;

/** What the setup and Config → Motores show: installed → logged in → usable. */
export const EngineStatus = z.object({
  /** "native", "claude", "codex" or an ACP agent ("acp:opencode"). */
  id: z.string(),
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
  /** An image: one from the web (`url`) or one APX made (`media_id`, its bytes from media.get). */
  z.object({
    type: z.literal("image"),
    url: z.string().optional(),
    media_id: Id.optional(),
    mime: z.string().optional(),
    alt: z.string().default(""),
  }),
  /** Speech APX made; the bytes come from media.get. */
  z.object({ type: z.literal("audio"), media_id: Id, mime: z.string(), transcript: z.string().optional() }),
  /** A file the owner attached to a message; the bytes come from media.get. */
  z.object({ type: z.literal("file"), media_id: Id, name: z.string(), mime: z.string(), bytes: z.number().int() }),
  /** What changed in a code thread's folder (uncommitted, per git) when the turn ended. */
  z.object({
    type: z.literal("changes"),
    cwd: z.string(),
    files: z.array(
      z.object({
        path: z.string(),
        status: z.string(),
        added: z.number().int().optional(),
        removed: z.number().int().optional(),
      }),
    ),
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
    options: z.array(z.string()).optional(),
    state: InputState,
    answer: z.string().optional(),
  }),
  /**
   * The skills picked by meaning for this turn: given whole (`loaded`), named (`hinted`), and the closest ones weighed
   * (`scored`, with their raw similarity), so the chat can show what went in and what nearly did.
   */
  z.object({
    type: z.literal("skills"),
    engine: z.string(),
    loaded: z.array(z.string()),
    hinted: z.array(z.string()),
    scored: z.array(z.object({ name: z.string(), sim: z.number() })),
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

/** Tokens of a run; `context` is the last model call's input (how full the chat is), `window` that model's limit. */
export const RunUsage = z.object({
  input: z.number().int(),
  output: z.number().int(),
  context: z.number().int().optional(),
  window: z.number().int().optional(),
});
export type RunUsage = z.infer<typeof RunUsage>;

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
  usage: RunUsage.optional(),
});
export type Run = z.infer<typeof Run>;

/**
 * Work running on its own, for the background view: an agent's turn outside the thread the owner is in (a
 * delegation, a woken agent) or a terminal command an agent started. `thread_id` opens the chat it belongs to.
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
export const ProviderInfo = z.object({
  id: z.string(),
  label: z.string(),
  /** The kind of service, for its card's look (gemini, groq, ollama, openrouter…). */
  preset: z.string().optional(),
  transport: z.enum(["openai-chat", "anthropic-messages"]),
  base_url: z.string(),
  /** Whether a key is stored (or none is needed). */
  key_set: z.boolean(),
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
export const Memory = z.object({
  id: Id,
  scope: MemoryScope,
  project_id: Id.optional(),
  agent_id: Id.optional(),
  text: z.string(),
  source: z.enum(["owner", "agent"]),
  /** The agent that wrote it, and the thread it learned it in. */
  author_agent: Id.optional(),
  thread_id: Id.optional(),
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
  perms: PersonPerms.default({ appointments: false, requests: false, notes: false }),
  addresses: z.array(Address),
  created_at: z.string(),
});
export type Person = z.infer<typeof Person>;

export const ChannelStrangers = z.enum(["pair", "ask", "answer", "ignore"]);
export type ChannelStrangers = z.infer<typeof ChannelStrangers>;

/** A channel instance as the owner configured it, and how it is doing. */
/** The channels APX can run: a bot or account the owner connects. */
export const ChannelType = z.enum(["telegram", "whatsapp", "discord", "slack"]);
export type ChannelType = z.infer<typeof ChannelType>;

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
   * then sent inside a digest); no_channel (nowhere to send it). */
  state: z.enum(["sent", "held", "dropped", "merged", "no_channel"]),
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
  status: z.enum(["off", "needs-approval", "disabled", "starting", "ready", "error"]),
  tools: z.number().int(),
  /** Tool names once it has started. */
  tool_names: z.array(z.string()).default([]),
  /** Stored secrets its definition names (`secret://NAME`), and whether each has a value. */
  vars: z.array(z.object({ name: z.string(), set: z.boolean() })).default([]),
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
