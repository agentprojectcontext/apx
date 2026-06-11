import { http } from "../http";
import type { AgentDetail, AgentEntry } from "../../types/daemon";

export const Agents = {
  list:   (pid: string) => http.get<AgentEntry[]>(`/projects/${pid}/agents`),
  get:    (pid: string, slug: string) => http.get<AgentDetail>(`/projects/${pid}/agents/${slug}`),
  create: (pid: string, body: Partial<AgentEntry> & { slug: string }) =>
    http.post<AgentEntry>(`/projects/${pid}/agents`, body),
  update: (pid: string, slug: string, body: Partial<AgentEntry> & { system?: string }) =>
    http.patch<AgentEntry>(`/projects/${pid}/agents/${encodeURIComponent(slug)}`, body),
  remove: (pid: string, slug: string) =>
    http.del<{ ok: boolean }>(`/projects/${pid}/agents/${encodeURIComponent(slug)}`),
  chat: (pid: string, slug: string, body: { prompt: string; conversation_id?: string; model?: string }) =>
    http.post<{ conversation_id: string; text: string; usage?: unknown; engine: string }>(
      `/projects/${pid}/agents/${encodeURIComponent(slug)}/chat`,
      body,
    ),
  memory: {
    get: (pid: string, slug: string) =>
      http.get<{ body: string }>(`/projects/${pid}/agents/${slug}/memory`),
    put: (pid: string, slug: string, body: string) =>
      http.put<{ ok: boolean; bytes: number }>(`/projects/${pid}/agents/${slug}/memory`, { body }),
  },
  // Vault = global agent templates. Two-layer: bundled defaults shipped with
  // APX + user overrides/new ones in ~/.apx/agents. The API merges both and
  // exposes a `source` per entry: "bundled" | "user" | "user-override".
  // Tombstones (deleted bundled defaults) are hidden unless includeRemoved=true.
  vault: (opts?: { includeRemoved?: boolean }) =>
    http.get<(AgentEntry & { source?: "bundled" | "user" | "user-override" })[]>(
      opts?.includeRemoved ? "/agents/vault?include_removed=1" : "/agents/vault",
    ),
  vaultCreate: (slug: string, fields: Record<string, unknown> = {}, body = "") =>
    http.post<AgentEntry>("/agents/vault", { slug, fields, body }),
  vaultPatch: (slug: string, patch: { fields?: Record<string, unknown>; body?: string }) =>
    http.patch<AgentEntry>(`/agents/vault/${encodeURIComponent(slug)}`, patch),
  vaultRemove: (slug: string) =>
    http.del<{ ok: boolean; removed: "user" | "tomb" | "user+tomb" }>(
      `/agents/vault/${encodeURIComponent(slug)}`,
    ),
  vaultRestore: (slug: string) =>
    http.post<{ ok: boolean; agent: AgentEntry | null }>(
      `/agents/vault/${encodeURIComponent(slug)}/restore`,
    ),
  import: (pid: string, slug: string) =>
    http.post<AgentEntry>(`/projects/${pid}/agents/import`, { slug }),
};
