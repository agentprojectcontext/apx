import { http } from "../http";
import type { ProjectConfig, ProjectEntry } from "../../types/daemon";

export const Projects = {
  list:    () => http.get<ProjectEntry[]>("/api/projects"),
  register:(path: string) => http.post<{ id: number; path: string }>("/api/projects", { path }),
  remove:  (id: string)   => http.del<void>(`/api/projects/${encodeURIComponent(id)}`),
  rebuild: (id: string)   => http.post<{ ok: true }>(`/api/projects/${encodeURIComponent(id)}/rebuild`),
  config:  {
    show:  (id: string)              => http.get<ProjectConfig>(`/api/projects/${id}/config`),
    set:   (id: string, set: Record<string, unknown>) =>
      http.patch<{ ok: true }>(`/api/projects/${id}/config`, { set }),
    unset: (id: string, keys: string[]) =>
      http.patch<{ ok: true }>(`/api/projects/${id}/config`, { unset: keys }),
    put:   (id: string, full: Record<string, unknown>) =>
      http.put<{ ok: true }>(`/api/projects/${id}/config`, full),
  },
  apcProject: {
    set: (id: string, set: Record<string, unknown>, unset?: string[]) =>
      http.patch<{ ok: true; apc_project: Record<string, unknown> }>(`/api/projects/${id}/apc-project`, { set, unset }),
    put: (id: string, full: Record<string, unknown>) =>
      http.put<{ ok: true; apc_project: Record<string, unknown> }>(`/api/projects/${id}/apc-project`, full),
  },
  // Project-level memory (.apc/memory.md). Per-agent memory lives in Agents.memory.
  memory: {
    get: (id: string) => http.get<{ body: string; path: string }>(`/api/projects/${id}/memory`),
    put: (id: string, body: string) => http.put<{ ok: boolean; bytes: number }>(`/api/projects/${id}/memory`, { body }),
  },
};
