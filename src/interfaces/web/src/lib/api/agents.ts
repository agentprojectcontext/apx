import { http, streamNdjson } from "../http";
import type { AgentDetail, AgentEntry, ChatStreamEvent, ChatUsage } from "../../types/daemon";

export const Agents = {
  list:   (pid: string, opts?: { stats?: boolean }) =>
    http.get<AgentEntry[]>(`/api/projects/${pid}/agents${opts?.stats ? "?stats=1" : ""}`),
  get:    (pid: string, slug: string) => http.get<AgentDetail>(`/api/projects/${pid}/agents/${slug}`),
  create: (pid: string, body: Partial<AgentEntry> & { slug: string; system?: string }) =>
    http.post<AgentEntry>(`/api/projects/${pid}/agents`, body),
  update: (pid: string, slug: string, body: Partial<AgentEntry> & { system?: string }) =>
    http.patch<AgentEntry>(`/api/projects/${pid}/agents/${encodeURIComponent(slug)}`, body),
  remove: (pid: string, slug: string) =>
    http.del<{ ok: boolean }>(`/api/projects/${pid}/agents/${encodeURIComponent(slug)}`),
  // Duplicate an agent server-side into a fresh "<slug>-n" (Name gains " (n)"),
  // carrying its prompt + memory. Returns the new agent so the caller can open it.
  clone: (pid: string, slug: string) =>
    http.post<AgentEntry>(`/api/projects/${pid}/agents/${encodeURIComponent(slug)}/clone`, {}),
  // Rename an agent's slug (moves its file + runtime dir, repoints Parent refs
  // and routines). Returns the agent at its new slug — the caller must navigate
  // to it, since the resource URL changed.
  rename: (pid: string, slug: string, newSlug: string) =>
    http.post<AgentEntry>(`/api/projects/${pid}/agents/${encodeURIComponent(slug)}/rename`, { slug: newSlug }),
  chat: (pid: string, slug: string, body: { prompt: string; conversation_id?: string; model?: string; channel?: string; attachments?: { path: string; name?: string }[] }) =>
    http.post<{ conversation_id: string; text: string; usage?: ChatUsage; engine: string }>(
      `/api/projects/${pid}/agents/${encodeURIComponent(slug)}/chat`,
      body,
    ),
  // The same turn, streamed token-by-token (NDJSON) — identical event vocabulary
  // to the super-agent stream, so the chat renders a project agent's answer as it
  // writes instead of a blank wait that ends in the whole reply at once.
  chatStream: (
    pid: string,
    slug: string,
    body: { prompt: string; conversation_id?: string; model?: string; channel?: string; attachments?: { path: string; name?: string }[] },
    onEvent: (ev: ChatStreamEvent) => void,
    signal?: AbortSignal,
  ) => streamNdjson<ChatStreamEvent>(`/api/projects/${pid}/agents/${encodeURIComponent(slug)}/chat/stream`, body, onEvent, signal),
  memory: {
    get: (pid: string, slug: string) =>
      http.get<{ body: string }>(`/api/projects/${pid}/agents/${slug}/memory`),
    put: (pid: string, slug: string, body: string) =>
      http.put<{ ok: boolean; bytes: number }>(`/api/projects/${pid}/agents/${slug}/memory`, { body }),
  },
  // Vault = global agent templates. Two-layer: bundled defaults shipped with
  // APX + user overrides/new ones in ~/.apx/agents. The API merges both and
  // exposes a `source` per entry: "bundled" | "user" | "user-override".
  // Tombstones (deleted bundled defaults) are hidden unless includeRemoved=true.
  vault: (opts?: { includeRemoved?: boolean }) =>
    http.get<(AgentEntry & { source?: "bundled" | "user" | "user-override" })[]>(
      opts?.includeRemoved ? "/api/agents/vault?include_removed=1" : "/api/agents/vault",
    ),
  vaultCreate: (slug: string, fields: Record<string, unknown> = {}, body = "") =>
    http.post<AgentEntry>("/api/agents/vault", { slug, fields, body }),
  vaultPatch: (slug: string, patch: { fields?: Record<string, unknown>; body?: string }) =>
    http.patch<AgentEntry>(`/api/agents/vault/${encodeURIComponent(slug)}`, patch),
  vaultRemove: (slug: string) =>
    http.del<{ ok: boolean; removed: "user" | "tomb" | "user+tomb" }>(
      `/api/agents/vault/${encodeURIComponent(slug)}`,
    ),
  vaultRestore: (slug: string) =>
    http.post<{ ok: boolean; agent: AgentEntry | null }>(
      `/api/agents/vault/${encodeURIComponent(slug)}/restore`,
    ),
  import: (pid: string, slug: string) =>
    http.post<AgentEntry>(`/api/projects/${pid}/agents/import`, { slug }),
};
