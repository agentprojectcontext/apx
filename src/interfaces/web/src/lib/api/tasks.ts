import { http } from "../http";
import type { TaskEntry } from "../../types/daemon";

export interface GlobalTaskEntry extends TaskEntry {
  project_id: number;
  project_name: string;
}

export const Tasks = {
  list:   (pid: string, state: TaskEntry["state"] | "all" = "open") =>
    http.get<TaskEntry[]>(`/projects/${pid}/tasks?state=${state}`),
  global: (state: TaskEntry["state"] | "all" = "open") =>
    http.get<GlobalTaskEntry[]>(`/tasks?state=${state}`),
  // Server-paginated variants: one project (listPage) or all projects
  // (globalPage). Each returns the requested window plus the full total.
  listPage: (pid: string, { state, limit, offset }: { state: TaskEntry["state"] | "all"; limit: number; offset: number }) =>
    http
      .getWithTotal<TaskEntry[]>(`/projects/${pid}/tasks?state=${state}&limit=${limit}&offset=${offset}`)
      .then((r) => ({ items: r.data, total: r.total })),
  globalPage: ({ state, limit, offset }: { state: TaskEntry["state"] | "all"; limit: number; offset: number }) =>
    http
      .getWithTotal<GlobalTaskEntry[]>(`/tasks?state=${state}&limit=${limit}&offset=${offset}`)
      .then((r) => ({ items: r.data, total: r.total })),
  add:    (pid: string, body: Partial<TaskEntry>) =>
    http.post<TaskEntry>(`/projects/${pid}/tasks`, body),
  done:   (pid: string, id: string) => http.post<TaskEntry>(`/projects/${pid}/tasks/${id}/done`),
  drop:   (pid: string, id: string) => http.post<TaskEntry>(`/projects/${pid}/tasks/${id}/drop`),
  reopen: (pid: string, id: string) => http.post<TaskEntry>(`/projects/${pid}/tasks/${id}/reopen`),
};
