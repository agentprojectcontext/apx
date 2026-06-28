import { http, unwrapPage } from "../http";
import type { TaskEntry } from "../../types/daemon";

export interface GlobalTaskEntry extends TaskEntry {
  project_id: number;
  project_name: string;
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
  add:    (pid: string, body: Partial<TaskEntry>) =>
    http.post<TaskEntry>(`/projects/${pid}/tasks`, body),
  done:   (pid: string, id: string) => http.post<TaskEntry>(`/projects/${pid}/tasks/${id}/done`),
  drop:   (pid: string, id: string) => http.post<TaskEntry>(`/projects/${pid}/tasks/${id}/drop`),
  reopen: (pid: string, id: string) => http.post<TaskEntry>(`/projects/${pid}/tasks/${id}/reopen`),
};
