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
  chat: (pid: string, slug: string, body: { prompt: string; conversation_id?: string }) =>
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
  // Vault = global agent templates (~/.apx/agents). Import copies one into a project.
  vault: () => http.get<AgentEntry[]>("/agents/vault"),
  import: (pid: string, slug: string) =>
    http.post<AgentEntry>(`/projects/${pid}/agents/import`, { slug }),
};
