import { http } from "../http";
import type { ProjectConfig, ProjectEntry } from "../../types/daemon";

export const Projects = {
  list:    () => http.get<ProjectEntry[]>("/api/projects"),
  register: (path: string, opts: RegisterProjectOptions = {}) =>
    http.post<{ id: number; path: string; kind: string | null; team: PackInstallResult | null }>(
      "/api/projects",
      { path, ...opts },
    ),
  remove:  (id: string)   => http.del<void>(`/api/projects/${encodeURIComponent(id)}`),
  rebuild: (id: string)   => http.post<{ ok: true }>(`/api/projects/${encodeURIComponent(id)}/rebuild`),
  // Point a project at another folder, KEEPING its id — the repair for a
  // renamed or moved directory. Never remove+add: the id is the entry's
  // position in the registry and the stored data hangs off the apx_id, so a
  // re-registration would hand the project a new id and orphan its agents,
  // routines, tasks and chats.
  //
  // Omitting `path` asks the daemon to find it: a folder next to the old one
  // whose `.apc/project.json` carries the same apx_id. That is a match on
  // identity rather than on name, which is why one click may answer it.
  relink: (id: string, path?: string, opts: { force?: boolean } = {}) =>
    http.post<RelinkResult>(`/api/projects/${encodeURIComponent(id)}/relink`, {
      ...(path ? { path } : {}),
      ...(opts.force ? { force: true } : {}),
    }),
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
  // Project-level memory. Two files: `memory` is the curated `.apc/memory.md`
  // that git carries and only a person writes; `memory.local` is
  // `~/.apx/projects/<id>/memory.md`, never committed, and is the one the
  // `remember` tool appends to. Per-agent memory lives in Agents.memory.
  memory: {
    get: (id: string) => http.get<{ body: string; path: string }>(`/api/projects/${id}/memory`),
    put: (id: string, body: string) => http.put<{ ok: boolean; bytes: number }>(`/api/projects/${id}/memory`, { body }),
    local: {
      get: (id: string) => http.get<{ body: string; path: string }>(`/api/projects/${id}/memory/local`),
      put: (id: string, body: string) =>
        http.put<{ ok: boolean; bytes: number }>(`/api/projects/${id}/memory/local`, { body }),
    },
  },
};

/** What a successful relink reports back: where it went, and what it found there. */
export type RelinkResult = {
  ok: true;
  id: number | string;
  /** The path it was registered at before — worth showing, it is what broke. */
  from: string;
  path: string;
  agents: number;
  /**
   * Whether `~/.apx/config.json` recorded the move. False means the running
   * daemon is repaired but the old path returns on its next boot, which is
   * worth saying out loud rather than letting the user rediscover it.
   */
  persisted: boolean;
};

/** Everything the Add-project dialog can decide besides the path. */
export type RegisterProjectOptions = {
  /** personal | company | app | software | other. Unlocks the structure tab for a company. */
  kind?: string;
  /** Create .apc/ when the folder is not an APC project yet, instead of failing. */
  init?: boolean;
  /** Pack id to install right away, e.g. "company". */
  team?: string;
};

export type PackInstallResult =
  | { installed: { slug: string; template: string }[]; areas: string[]; roles: string[] }
  | { error: string };
