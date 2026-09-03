import { http, unwrapPage } from "../http";
import type { TaskEntry, TaskStatus } from "../../types/daemon";
import type { BoardColumn } from "../../components/tasks/columns";

/** What a project shows, plus the global vocabulary it may pick from. */
export interface ProjectColumns {
  columns: BoardColumn[];
  catalog: BoardColumn[];
}

export interface GlobalTaskEntry extends TaskEntry {
  project_id: number;
  project_name: string;
}

export interface TaskSummary {
  open: number;
  done: number;
  dropped: number;
  overdue: number;
  total: number;
  status: Record<TaskStatus, number>;
}

export const Tasks = {
  // Full sets (no pagination) — unwrapped to plain arrays for non-paged callers.
  list:   (pid: string, state: TaskEntry["state"] | "all" = "open") =>
    http.get<unknown>(`/api/projects/${pid}/tasks?state=${state}`).then((b) => unwrapPage<TaskEntry>(b).items),
  global: (state: TaskEntry["state"] | "all" = "open") =>
    http.get<unknown>(`/api/tasks?state=${state}`).then((b) => unwrapPage<GlobalTaskEntry>(b).items),
  // Server-paginated variants: one project (listPage) or all projects
  // (globalPage). Each returns the requested window plus the full total.
  listPage: (pid: string, { state, limit, offset, status }: { state: TaskEntry["state"] | "all"; limit: number; offset: number; status?: TaskStatus | "" }) =>
    http
      .get<unknown>(
        `/api/projects/${pid}/tasks?state=${state}&limit=${limit}&offset=${offset}` + (status ? `&status=${status}` : ""),
      )
      .then((b) => unwrapPage<TaskEntry>(b)),
  globalPage: ({ state, limit, offset, status }: { state: TaskEntry["state"] | "all"; limit: number; offset: number; status?: TaskStatus | "" }) =>
    http
      .get<unknown>(
        `/api/tasks?state=${state}&limit=${limit}&offset=${offset}` + (status ? `&status=${status}` : ""),
      )
      .then((b) => unwrapPage<GlobalTaskEntry>(b)),
  get:    (pid: string, id: string) => http.get<TaskEntry>(`/api/projects/${pid}/tasks/${id}`),
  /** Children of one task. `parent: ""` asks for top-level tasks only. */
  subtasks: (pid: string, parent: string) =>
    http
      .get<unknown>(`/api/projects/${pid}/tasks?state=all&parent=${encodeURIComponent(parent)}`)
      .then((b) => unwrapPage<TaskEntry>(b).items),
  /**
   * Add a comment. `summoned` names the agents an @mention pulled in — their
   * replies land in the thread AFTER this resolves, so the caller re-fetches
   * rather than waiting (a real QA run takes as long as the QA takes).
   */
  comment: (pid: string, id: string, text: string) =>
    http.post<{ task: TaskEntry; summoned: string[] }>(
      `/api/projects/${pid}/tasks/${id}/comments`, { text },
    ),
  add:    (pid: string, body: Partial<TaskEntry>) =>
    http.post<TaskEntry>(`/api/projects/${pid}/tasks`, body),
  patch:  (pid: string, id: string, patch: Partial<TaskEntry>) =>
    http.patch<TaskEntry>(`/api/projects/${pid}/tasks/${id}`, { patch }),
  status: (pid: string, id: string, status: TaskStatus) =>
    http.post<TaskEntry>(`/api/projects/${pid}/tasks/${id}/status`, { status }),
  done:   (pid: string, id: string) => http.post<TaskEntry>(`/api/projects/${pid}/tasks/${id}/done`),
  drop:   (pid: string, id: string) => http.post<TaskEntry>(`/api/projects/${pid}/tasks/${id}/drop`),
  reopen: (pid: string, id: string) => http.post<TaskEntry>(`/api/projects/${pid}/tasks/${id}/reopen`),
  summary: (pid: string) => http.get<TaskSummary>(`/api/projects/${pid}/tasks-summary`),

  /**
   * Board columns. The catalog is GLOBAL — renaming "in review" renames it for
   * every project, which is what keeps a column name meaning one thing. What a
   * project shows is a subset of it.
   */
  columns: {
    catalog:     () => http.get<{ columns: BoardColumn[] }>(`/api/tasks/columns`),
    saveCatalog: (columns: BoardColumn[]) =>
      http.put<{ columns: BoardColumn[] }>(`/api/tasks/columns`, { columns }),
    forProject:  (pid: string) => http.get<ProjectColumns>(`/api/projects/${pid}/tasks/columns`),
    saveForProject: (pid: string, ids: string[]) =>
      http.put<ProjectColumns>(`/api/projects/${pid}/tasks/columns`, { columns: ids }),
  },
};
