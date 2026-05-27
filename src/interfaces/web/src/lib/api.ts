// Typed HTTP client against the APX daemon. All requests carry the bearer
// token loaded from /api/token-bootstrap on first paint (or from a pairing
// flow once that lands). Same-origin: when the daemon serves us, requests
// land on the same port; in `vite dev` the proxy redirects to 7430.

let token: string | null = null;

export function setToken(t: string | null) {
  token = t;
}
export function getToken(): string | null {
  return token;
}

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

async function request<T>(
  method: Method,
  path: string,
  body?: unknown,
  init: RequestInit = {}
): Promise<T> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    ...(token ? { authorization: `Bearer ${token}` } : {}),
    ...((init.headers as Record<string, string>) || {}),
  };
  const res = await fetch(path, {
    ...init,
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    let detail = "";
    try {
      const j = await res.json();
      detail = j?.error || JSON.stringify(j);
    } catch {
      detail = await res.text();
    }
    throw new Error(`${method} ${path} → ${res.status}: ${detail}`);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const api = {
  get:   <T>(p: string)              => request<T>("GET", p),
  post:  <T>(p: string, b?: unknown) => request<T>("POST", p, b),
  put:   <T>(p: string, b?: unknown) => request<T>("PUT", p, b),
  patch: <T>(p: string, b?: unknown) => request<T>("PATCH", p, b),
  del:   <T>(p: string)              => request<T>("DELETE", p),
};

// ── Domain types (mirrors host/daemon/api/* shapes) ──────────────────────────

export type ProjectKind = "personal" | "company" | "app" | "software" | "default" | "other";

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
  skills: string[];
  tools: string[];
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
}

export interface TelegramChannel {
  name: string;
  bot_token?: string;
  chat_id?: string;
  project?: string;
  route_to_agent?: string;
  respond_with_engine?: boolean;
  poll_interval_ms?: number;
}

export interface EngineSummary { engines: string[] }
export interface HealthSummary { status: string; version: string; uptime_s: number }

// Convenience wrappers used across screens.

export const Health = {
  get: () => api.get<HealthSummary>("/health"),
};

export const Projects = {
  list:    () => api.get<ProjectEntry[]>("/projects"),
  register:(path: string) => api.post<{ id: number; path: string }>("/projects", { path }),
  remove:  (id: string)   => api.del<void>(`/projects/${encodeURIComponent(id)}`),
  rebuild: (id: string)   => api.post<{ ok: true }>(`/projects/${encodeURIComponent(id)}/rebuild`),
  config:  {
    show:  (id: string)              => api.get<{ effective: any; project_only: any; project_config_path: string }>(`/projects/${id}/config`),
    set:   (id: string, set: any)    => api.patch<{ ok: true }>(`/projects/${id}/config`, { set }),
    unset: (id: string, keys: string[]) => api.patch<{ ok: true }>(`/projects/${id}/config`, { unset: keys }),
    put:   (id: string, full: any)   => api.put<{ ok: true }>(`/projects/${id}/config`, full),
  },
};

export const Agents = {
  list: (pid: string) => api.get<AgentEntry[]>(`/projects/${pid}/agents`),
  get:  (pid: string, slug: string) => api.get<AgentEntry & { memory: string }>(`/projects/${pid}/agents/${slug}`),
};

export const Routines = {
  list: (pid: string) => api.get<RoutineEntry[]>(`/projects/${pid}/routines`),
  get:  (pid: string, name: string) => api.get<RoutineEntry>(`/projects/${pid}/routines/${name}`),
  run:  (pid: string, name: string) => api.post<any>(`/projects/${pid}/routines/${name}/run`),
  enable:  (pid: string, name: string) => api.post<any>(`/projects/${pid}/routines/${name}/enable`),
  disable: (pid: string, name: string) => api.post<any>(`/projects/${pid}/routines/${name}/disable`),
};

export const Tasks = {
  list: (pid: string, state: string = "open") =>
    api.get<TaskEntry[]>(`/projects/${pid}/tasks?state=${state}`),
  add:  (pid: string, body: Partial<TaskEntry>) => api.post<TaskEntry>(`/projects/${pid}/tasks`, body),
  done: (pid: string, id: string) => api.post<TaskEntry>(`/projects/${pid}/tasks/${id}/done`),
  drop: (pid: string, id: string) => api.post<TaskEntry>(`/projects/${pid}/tasks/${id}/drop`),
};

export const Mcps = {
  list:  (pid: string) => api.get<McpEntry[]>(`/projects/${pid}/mcps`),
  check: (pid: string) => api.get<{ sources: any[]; entries: McpEntry[]; conflicts: any[] }>(`/projects/${pid}/mcps/check`),
};

export const Telegram = {
  channels: {
    list:   () => api.get<{ channels: TelegramChannel[] }>("/telegram/channels"),
    upsert: (ch: TelegramChannel) => api.post<{ channel: TelegramChannel; created: boolean }>("/telegram/channels", ch),
    patch:  (name: string, body: Partial<TelegramChannel>) => api.patch<{ ok: true; channel: TelegramChannel }>(`/telegram/channels/${name}`, body),
    remove: (name: string) => api.del<void>(`/telegram/channels/${name}`),
  },
  status: () => api.get<any>("/telegram/status"),
};

export const Engines = {
  list: () => api.get<EngineSummary>("/engines"),
};

export const Admin = {
  reload: () => api.post<{ ok: true; super_agent_model: string; fallback_order: string[] }>("/admin/reload"),
};

export const Messages = {
  forProject: (pid: string, channel?: string, limit = 100) =>
    api.get<any[]>(`/projects/${pid}/messages?limit=${limit}${channel ? `&channel=${channel}` : ""}`),
  global: (channel?: string, limit = 100) =>
    api.get<any[]>(`/messages/global?limit=${limit}${channel ? `&channel=${channel}` : ""}`),
};
