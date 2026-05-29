import { http } from "../http";
import type { ProjectConfig, ProjectEntry } from "../../types/daemon";

export const Projects = {
  list:    () => http.get<ProjectEntry[]>("/projects"),
  register:(path: string) => http.post<{ id: number; path: string }>("/projects", { path }),
  remove:  (id: string)   => http.del<void>(`/projects/${encodeURIComponent(id)}`),
  rebuild: (id: string)   => http.post<{ ok: true }>(`/projects/${encodeURIComponent(id)}/rebuild`),
  config:  {
    show:  (id: string)              => http.get<ProjectConfig>(`/projects/${id}/config`),
    set:   (id: string, set: Record<string, unknown>) =>
      http.patch<{ ok: true }>(`/projects/${id}/config`, { set }),
    unset: (id: string, keys: string[]) =>
      http.patch<{ ok: true }>(`/projects/${id}/config`, { unset: keys }),
    put:   (id: string, full: Record<string, unknown>) =>
      http.put<{ ok: true }>(`/projects/${id}/config`, full),
  },
  apcProject: {
    set: (id: string, set: Record<string, unknown>, unset?: string[]) =>
      http.patch<{ ok: true; apc_project: Record<string, unknown> }>(`/projects/${id}/apc-project`, { set, unset }),
    put: (id: string, full: Record<string, unknown>) =>
      http.put<{ ok: true; apc_project: Record<string, unknown> }>(`/projects/${id}/apc-project`, full),
  },
  // Project-level memory (.apc/memory.md). Per-agent memory lives in Agents.memory.
  memory: {
    get: (id: string) => http.get<{ body: string; path: string }>(`/projects/${id}/memory`),
    put: (id: string, body: string) => http.put<{ ok: boolean; bytes: number }>(`/projects/${id}/memory`, { body }),
  },
};
