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
  add:    (pid: string, body: Partial<TaskEntry>) =>
    http.post<TaskEntry>(`/projects/${pid}/tasks`, body),
  done:   (pid: string, id: string) => http.post<TaskEntry>(`/projects/${pid}/tasks/${id}/done`),
  drop:   (pid: string, id: string) => http.post<TaskEntry>(`/projects/${pid}/tasks/${id}/drop`),
  reopen: (pid: string, id: string) => http.post<TaskEntry>(`/projects/${pid}/tasks/${id}/reopen`),
};
