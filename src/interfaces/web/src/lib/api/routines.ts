import { http } from "../http";
import type { RoutineEntry } from "../../types/daemon";

export const Routines = {
  list:    (pid: string) => http.get<RoutineEntry[]>(`/projects/${pid}/routines`),
  get:     (pid: string, name: string) => http.get<RoutineEntry>(`/projects/${pid}/routines/${name}`),
  run:     (pid: string, name: string) => http.post<unknown>(`/projects/${pid}/routines/${name}/run`),
  enable:  (pid: string, name: string) => http.post<unknown>(`/projects/${pid}/routines/${name}/enable`),
  disable: (pid: string, name: string) => http.post<unknown>(`/projects/${pid}/routines/${name}/disable`),
  upsert:  (pid: string, body: Partial<RoutineEntry>) =>
    http.post<RoutineEntry>(`/projects/${pid}/routines`, body),
  remove:  (pid: string, name: string) =>
    http.del<void>(`/projects/${pid}/routines/${encodeURIComponent(name)}`),
};
