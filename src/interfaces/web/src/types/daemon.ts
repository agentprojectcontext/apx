// Daemon shapes. Mirror the responses returned by src/host/daemon/api/*.
// If you find yourself reaching for `any`, add a type here first.

export type ProjectKind =
  | "personal"
  | "company"
  | "app"
  | "software"
  | "default"
  | "other";

export interface ProjectEntry {
  id: number | string;
  path: string;
  name?: string;
  kind?: ProjectKind;
  agents?: number;
  storagePath?: string;
}

// Autonomy mirrors the super-agent permission modes.
export type AgentAutonomy = "total" | "automatico" | "permiso";

export interface AgentEntry {
  slug: string;
  /** Display name. The slug remains the stable identity used for links/delegation. */
  name?: string | null;
  role: string | null;
  model: string | null;
  language: string | null;
  description: string | null;
  is_master?: boolean;
  parent?: string | null;
  type?: string | null;
  area?: string | null;
  emoji?: string | null;
  // Blob-preset key for the agent's animated avatar (see components/agents/blobPresets).
  icon?: string | null;
  autonomy?: AgentAutonomy | null;
  skills: string[];
  tools: string[];
  // Optional per-agent activity summary; only present when the list is
  // requested with `?stats=1` (see AgentsTab).
  stats?: AgentStats;
}

export interface AgentStats {
  threads: number;
  records: number;
  tasks: number;
  heartbeats: number;
}

export interface AgentDetail extends AgentEntry {
  memory: string;
  system?: string;
  extra?: Record<string, unknown>;
}

export interface RoutineEntry {
  name: string;
  kind: "heartbeat" | "exec_agent" | "super_agent" | "telegram" | "shell" | "watch";
  schedule: string;
  spec: Record<string, unknown>;
  enabled: boolean;
  next_run_at: string | null;
  last_run_at: string | null;
  last_status: string | null;
  last_error: string | null;
  pre_commands?: string[];
  post_commands?: string[];
  /** Runtime state, not stored state: the daemon has a run of this open right
   *  now. Set by GET /projects/:pid/routines — absent means idle. */
  running?: boolean;
  run_started_at?: string;
}

/** One step of a run in flight — a tool the agent called, or something it said
 *  on the way. The live twin of a finished run's trace. */
export interface RoutineRunStep {
  at: string;
  id: string;
  kind: "tool" | "text";
  tool?: string;
  args?: Record<string, unknown> | null;
  status?: "running" | "done" | "error";
  text?: string;
}

/** The daemon's record of a routine run in flight. Read once from
 *  GET /projects/:pid/routines/:name/run, then followed live via RoutineFrame. */
export interface LiveRoutineRun {
  run_id: string;
  routine: string;
  kind: string;
  trigger: "manual" | "schedule" | "agent" | string;
  started_at: string;
  phase: "pre" | "agent" | "delivery" | "post";
  agent_slug: string | null;
  steps: RoutineRunStep[];
  text: string;
  ended_at?: string;
  status?: string;
  error?: string | null;
  conversation_id?: string;
}

/** One run a routine has already made, as the daemon reads it back out of the
 *  ledger (core/routines/run-log.js). A "routine updated" row is not one. */
export interface RoutineRun {
  ts: string;
  routine: string;
  status: "ok" | "error" | "skipped";
  skipped: boolean;
  body: string;
  result: Record<string, unknown>;
  flow: {
    pre?: { output?: string; exit?: number } | null;
    delivery?: Record<string, unknown> | null;
    post?: Array<{ cmd: string; exit: number; stdout: string; stderr: string }> | null;
  } | null;
  /** Lifted out of the result: what "open this run's chat" needs. */
  conversation_id: string | null;
  agent_slug: string | null;
}

/** A live-feed frame carrying a routine run as it moves. Unlike a message frame
 *  this carries the data — a run's steps are not in the ledger until it ends. */
export interface RoutineFrame {
  phase: "start" | "progress" | "end";
  project_id: number | string | null;
  routine: string;
  run: LiveRoutineRun;
}

// Workflow sub-status for an open task (orthogonal to `state`).
export type TaskStatus = "pending" | "running" | "in_review" | "blocked";

export interface TaskEntry {
  id: string;
  state: "open" | "done" | "dropped";
  status?: TaskStatus;
  title: string;
  body: string | null;
  tags: string[];
  due: string | null;
  agent: string | null;
  source: string | null;
  created_by?: string | null;
  thread?: string | null;
  done_at?: string | null;
  done_by?: string | null;
  dropped_at?: string | null;
  created_at: string;
  updated_at: string;
}

export interface OrgArea {
  slug: string;
  name: string;
  goal: string | null;
}

export interface OrgRole {
  slug: string;
  name: string;
  area: string | null;
  description: string | null;
}

export interface Organization {
  areas: OrgArea[];
  roles: OrgRole[];
}

// Project file browser (core/stores/project-files.js).
export type FileKind = "markdown" | "text" | "image" | "binary";

export interface FileNode {
  name: string;
  path: string;
  type: "dir" | "file";
  kind?: FileKind;
  children?: FileNode[];
}

export interface FileTreeResponse {
  scope: "project" | "docs";
  root: string;
  subdir: string;
  tree: FileNode[];
  truncated: boolean;
}

export interface FileContent {
  path: string;
  name: string;
  kind: FileKind;
  size: number;
  modified: string;
  encoding: "utf8" | "base64" | "binary";
  mime?: string;
  content: string | null;
  too_large?: boolean;
}

export interface McpEntry {
  name: string;
  source: "apc" | "runtime" | "global" | string;
  transport: string;
  enabled: boolean;
  command?: string | null;
  args?: string[];
  env?: Record<string, string>;
  url?: string | null;
  headers?: Record<string, string>;
}

export interface MessageEntry {
  ts: string;
  channel: string;
  direction: "in" | "out";
  type: string;
  author: string | null;
  actor_id: string | null;
  actor_kind: string | null;
  body: string;
  meta: Record<string, unknown>;
  agent_slug: string | null;
  session_id: string | number | null;
  external_id: string | null;
}

export interface TelegramChannel {
  name: string;
  bot_token?: string;
  chat_id?: string;
  project?: string;
  route_to_agent?: string;
  respond_with_engine?: boolean;
  poll_interval_ms?: number;
  owner_user_id?: number | string;
}

export interface TelegramChannelsResponse { channels: TelegramChannel[] }

export interface TelegramContact {
  user_id: number | string;
  name?: string;
  username?: string;
  role?: string;
  note?: string;
  first_seen?: string;
  last_seen?: string;
}

export interface TelegramRole { tools: "*" | string[] }

export interface TelegramContactsResponse {
  contacts: TelegramContact[];
  roles: Record<string, TelegramRole>;
  channel_owners: { name: string; owner_user_id: number | string | null }[];
}

export interface EngineSummary { engines: string[] }

export interface HealthSummary { status: string; version: string; uptime_s: number }

export interface ConversationListEntry {
  id: string;
  filename: string;
  agent_slug: string;
  started_at: string;
  ended_at?: string;
  channel?: string;
  messages?: number;
  title?: string;
  /** Put away: still on disk, just out of the lists that offer chats to resume. */
  archived?: boolean;
}

/** An attachment that arrived with a turn: the file is on disk under
 *  ~/.apx/media and `path` is what /api/media streams back. `path` is null when
 *  the download failed — the turn still records what was sent. */
export interface MessageMedia {
  kind: "audio" | "photo" | "video" | "animation" | "document" | "file";
  path: string | null;
  name: string | null;
  mime: string | null;
  size: number | null;
  duration: number | null;
}

export interface ConversationMessage {
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  ts?: string;
  name?: string;
  /** Present on role:"tool" rows from the global ledger — the tool name and its
   *  structured args/result, so the viewer can render a ToolCall part. */
  tool?: string;
  args?: Record<string, unknown>;
  result?: unknown;
  /** Attribution on role:"assistant" rows from the global ledger: who answered
   *  (stable id + display name + kind), on which model, and what it cost. */
  agent?: string;
  agent_name?: string;
  actor_kind?: string;
  model?: string;
  usage?: ChatUsage;
  /** Group only: which agent's @mention pulled this speaker in ("traído por X"). */
  reason?: string;
  /** Group system notice: an agent joined ("joined") or left ("left") the room.
   *  `who` is the agent slug it concerns. Rendered as a centred line. */
  event?: "joined" | "left";
  who?: string;
  /** Compact record of what the turn did, written at the time (the live tool
   *  events are long gone by the time a thread is read back). */
  tool_summary?: ToolSummary;
  /** The model's thinking for that turn, one entry per model pass. Never part
   *  of `content` — the adapter keeps the two apart. */
  reasoning?: string[];
  /** The skill inspector's decision for that turn, recorded at write time. */
  skill_inspector?: {
    embedder?: string;
    loaded?: string[];
    hinted?: string[];
    scored?: { slug: string; sim: number }[];
  };
  /** The file this turn carried — a user's upload, or one the agent SENT (a
   *  skill image it attached, a photo pushed to Telegram, a routine delivery).
   *  A stored row records one file; `media_list` is the several-file spelling a
   *  delivery writes, and it mirrors its first file here. */
  media?: MessageMedia;
  media_list?: MessageMedia[];
}

export interface ToolSummary {
  total: number;
  failed: number;
  tools: { name: string; count: number; failed: number }[];
}

export interface ConversationDetail {
  id: string;
  agent_slug: string;
  channel?: string;
  messages: ConversationMessage[];
  meta?: Record<string, unknown>;
  /** A turn being written right now (streamed over the live feed), so a surface
   *  opening this chat mid-answer shows the partial and follows the tokens. */
  active_turn?: ActiveTurn | null;
}

/** The daemon's record of an in-progress chat turn — the partial text so far
 *  plus who is writing it. Followed live via `TurnFrame`s on the events feed. */
export interface ActiveTurn {
  turn_id: string;
  text: string;
  agent_slug?: string;
  model?: string;
  started_at?: string;
}

/** A live-feed frame carrying a turn's tokens as they are written — the stream
 *  that used to belong only to the sending tab, now pushed to every surface. */
export interface TurnFrame {
  phase: "start" | "delta" | "final" | "error";
  project_id: number | string | null;
  agent_slug: string | null;
  conversation_id: string | null;
  turn_id: string;
  delta?: string;
  result?: { text?: string; usage?: ChatUsage; model?: string; name?: string; conversation_id?: string };
  error?: string;
}

/**
 * One participant's resolved avatar + display name.
 *
 * Resolved by the daemon (host/daemon/api/thread-faces.js) and shipped on the
 * payload, never re-derived from a slug in the panel: the super-agent and a
 * coding CLI are not project agents, so a screen resolving faces against its own
 * agent list draws a bare letter for exactly the participants that matter most.
 */
export interface AgentFace {
  /** Project / actor slug — needed to open the agent's ficha from a group face. */
  slug?: string | null;
  /** Blob-preset key (see components/agents/blobPresets), when the agent has one. */
  icon?: string | null;
  emoji?: string | null;
  /** Display name — used for the fallback initial and to seed the colour. */
  name?: string | null;
}

/** Super-agent channel thread (one per channel+day of the global ledger). */
export interface ThreadListEntry {
  id: string;         // YYYY-MM-DD
  channel: string;    // telegram | web | desktop | deck | …
  /** Already display-ready: for a2a and group threads it is "Andy · Claude",
   *  built from the resolved faces below, not the raw pair id. */
  title: string;
  messages: number;
  started_at: string;
  last_ts: string;
  archived?: boolean;
  /** For multi-agent threads (a2a, group): the participant agent slugs… */
  participants?: string[];
  /** …and the face each one wears. */
  participant_faces?: AgentFace[];
  preview?: string;
}

export interface ThreadDetail {
  id: string;
  channel: string;
  /** What this thread is called: the reader's own name for it, the resolved
   *  "A · B" of a multi-agent thread, or the first thing that was said in it. */
  title?: string;
  archived?: boolean;
  /** For multi-agent threads (a2a, group): the participant agent slugs… */
  participants?: string[];
  /** …and the face each one wears, so the header can draw them without a list. */
  participant_faces?: AgentFace[];
  messages: ConversationMessage[];
}

export interface PairedClient {
  id: string;
  label: string;
  kind: string;
  created_at: string;
  last_seen: string | null;
  token_suffix: string;
}

export interface PairInit {
  pairing_id: string;
  expires_at: string;
  ttl_ms: number;
  fingerprint: string;
  daemon: { host: string; port: number };
  lan_urls: string[];
}

export interface PairStatus {
  status: "pending" | "confirmed" | "expired" | "unknown";
  device_label?: string;
  client_id?: string;
}

export interface ProjectConfig {
  effective: Record<string, unknown>;
  project_only: Record<string, unknown>;
  project_config_path: string;
  apc_project: Record<string, unknown>;
  project_json_path: string;
}

export interface Identity {
  agent_name?: string;
  owner_name?: string;
  personality?: string;
  owner_context?: string;
  language?: string;
  timezone?: string;
  updated?: string;
  created?: string;
  last_wakeup?: string | null;
}

export interface SuperAgentConfig {
  enabled: boolean;
  name: string;
  icon: string;
  model: string;
  system: string;
  permission_mode: string;
  allowed_tools: string[];
  model_fallback: {
    enabled?: boolean;
    models?: string[];
    order?: string[];
  };
  // Content-based routing (RouterLLM pattern): prefer a model per turn by
  // features. Composes with model_fallback (failover) — see RoutingPanel.
  routing?: {
    enabled?: boolean;
    rules?: Array<{
      model: string;
      when?: {
        has_image?: boolean;
        min_prompt_chars?: number;
        max_prompt_chars?: number;
        min_context_chars?: number;
        channels?: string[];
        keywords?: string[];
      };
    }>;
  };
}

/** ~/.apx/config.json shape (partial — only what we read/write today). */
export interface GlobalConfig {
  port?: number;
  host?: string;
  log_level?: string;
  projects?: Array<{ path: string }>;
  user?: { language?: string; locale?: string; timezone?: string };
  super_agent?: Partial<SuperAgentConfig>;
  engines?: Record<string, {
    api_key?: string;
    base_url?: string;
    name?: string;
    engine?: string;
    default_model?: string;
    default_temperature?: number;
    default_max_tokens?: number;
    is_active?: boolean;
    context_limit_tokens?: number;
    model_context_limits?: Record<string, number>;
    pricing?: {
      input_per_million?: number;
      output_per_million?: number;
      cache_read_per_million?: number;
      cache_write_per_million?: number;
    };
  }>;
  telegram?: {
    enabled?: boolean;
    poll_interval_ms?: number;
    route_to_agent?: string;
    respond_with_engine?: boolean;
    channels?: TelegramChannel[];
  };
  voice?: Record<string, unknown>;
}

/** Token accounting accumulated across a super-agent turn. */
export interface ChatUsage {
  input_tokens?: number;
  output_tokens?: number;
}

/** A single tool invocation as surfaced by the agent loop's trace. */
export interface ToolTrace {
  id: string;
  tool: string;
  args?: Record<string, unknown>;
  result?: unknown;
  pending?: boolean;
}

/**
 * NDJSON events emitted by the super-agent loop (see core/agent/run-agent.js).
 * The fields are a union over every event `type`; consumers branch on `type`.
 */
export interface ChatStreamEvent {
  type?: string;
  // text streaming (assistant_text carries `text`)
  delta?: string;
  text?: string;
  content?: string;
  // assistant_reasoning: the model's chain of thought, kept out of the answer
  reasoning?: string;
  // diagnostics
  error?: string;
  iteration?: number;
  model?: string;
  provider?: string;
  reason?: string;
  retry_with?: string;
  from_fallback?: boolean;
  tools?: string[];
  streak?: number;
  // tool_start / tool_result / tool_deduped
  trace?: ToolTrace;
  // skill_inspector: which skills the per-turn RAG loaded/hinted this turn
  inspector?: {
    enabled?: boolean;
    reason?: string;
    embedder?: string;
    scored?: { slug: string; sim: number }[];
    loaded?: string[];
    hinted?: string[];
    jit?: boolean;
  };
  // final
  result?: {
    text?: string;
    usage?: ChatUsage;
    /** Agent persona that answered (identity.json name / agent slug). */
    name?: string;
    /** The conversation the turn was appended to — a project agent's streamed
     *  turn returns it so the client can bind subsequent sends (and the file
     *  rewind of regenerate / edit) to it. */
    conversation_id?: string;
    /** Engine that actually produced the reply — may differ from the configured
     *  one when routing fell back mid-turn. */
    model?: string;
    trace?: ToolTrace[];
  };
}
