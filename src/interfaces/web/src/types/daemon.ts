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

export interface AgentEntry {
  slug: string;
  role: string | null;
  model: string | null;
  language: string | null;
  description: string | null;
  is_master?: boolean;
  parent?: string | null;
  type?: string | null;
  area?: string | null;
  skills: string[];
  tools: string[];
}

export interface AgentDetail extends AgentEntry {
  memory: string;
  system?: string;
  extra?: Record<string, unknown>;
}

export interface RoutineEntry {
  name: string;
  kind: "heartbeat" | "exec_agent" | "super_agent" | "telegram" | "shell";
  schedule: string;
  spec: Record<string, unknown>;
  enabled: boolean;
  next_run_at: string | null;
  last_run_at: string | null;
  last_status: string | null;
  last_error: string | null;
  pre_commands?: string[];
  post_commands?: string[];
}

export interface TaskEntry {
  id: string;
  state: "open" | "done" | "dropped";
  title: string;
  body: string | null;
  tags: string[];
  due: string | null;
  agent: string | null;
  source: string | null;
  created_at: string;
  updated_at: string;
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
}

export interface ConversationMessage {
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  ts?: string;
  name?: string;
}

export interface ConversationDetail {
  id: string;
  agent_slug: string;
  channel?: string;
  messages: ConversationMessage[];
  meta?: Record<string, unknown>;
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
  model: string;
  system: string;
  permission_mode: string;
  allowed_tools: string[];
  model_fallback: {
    enabled?: boolean;
    models?: string[];
    order?: string[];
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
    name?: string;
    trace?: ToolTrace[];
  };
}
