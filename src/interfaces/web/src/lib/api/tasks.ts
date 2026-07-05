import { http, unwrapPage } from "../http";
import type { TaskEntry, TaskStatus } from "../../types/daemon";

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
    http.get<unknown>(`/projects/${pid}/tasks?state=${state}`).then((b) => unwrapPage<TaskEntry>(b).items),
  global: (state: TaskEntry["state"] | "all" = "open") =>
    http.get<unknown>(`/tasks?state=${state}`).then((b) => unwrapPage<GlobalTaskEntry>(b).items),
  // Server-paginated variants: one project (listPage) or all projects
  // (globalPage). Each returns the requested window plus the full total.
  listPage: (pid: string, { state, limit, offset }: { state: TaskEntry["state"] | "all"; limit: number; offset: number }) =>
    http.get<unknown>(`/projects/${pid}/tasks?state=${state}&limit=${limit}&offset=${offset}`).then((b) => unwrapPage<TaskEntry>(b)),
  globalPage: ({ state, limit, offset }: { state: TaskEntry["state"] | "all"; limit: number; offset: number }) =>
    http.get<unknown>(`/tasks?state=${state}&limit=${limit}&offset=${offset}`).then((b) => unwrapPage<GlobalTaskEntry>(b)),
  get:    (pid: string, id: string) => http.get<TaskEntry>(`/projects/${pid}/tasks/${id}`),
  add:    (pid: string, body: Partial<TaskEntry>) =>
    http.post<TaskEntry>(`/projects/${pid}/tasks`, body),
  patch:  (pid: string, id: string, patch: Partial<TaskEntry>) =>
    http.patch<TaskEntry>(`/projects/${pid}/tasks/${id}`, { patch }),
  status: (pid: string, id: string, status: TaskStatus) =>
    http.post<TaskEntry>(`/projects/${pid}/tasks/${id}/status`, { status }),
  done:   (pid: string, id: string) => http.post<TaskEntry>(`/projects/${pid}/tasks/${id}/done`),
  drop:   (pid: string, id: string) => http.post<TaskEntry>(`/projects/${pid}/tasks/${id}/drop`),
  reopen: (pid: string, id: string) => http.post<TaskEntry>(`/projects/${pid}/tasks/${id}/reopen`),
  summary: (pid: string) => http.get<TaskSummary>(`/projects/${pid}/tasks-summary`),
};
