import { http } from "../http";
import type { LiveRoutineRun, RoutineEntry, RoutineRun } from "../../types/daemon";

export const Routines = {
  list:    (pid: string) => http.get<RoutineEntry[]>(`/api/projects/${pid}/routines`),
  get:     (pid: string, name: string) => http.get<RoutineEntry>(`/api/projects/${pid}/routines/${name}`),
  run:     (pid: string, name: string) => http.post<unknown>(`/api/projects/${pid}/routines/${name}/run`),
  // The runs it has already made — only real runs; a "routine updated" ledger
  // row is not one, and the daemon is what knows the difference.
  runs:    (pid: string, name: string) =>
    http.get<RoutineRun[]>(`/api/projects/${pid}/routines/${encodeURIComponent(name)}/runs`),
  // The run in flight, if any: what survives a refresh, and what a second
  // device sees when this one pressed Play.
  activeRun: (pid: string, name: string) =>
    http.get<{ run: LiveRoutineRun | null }>(`/api/projects/${pid}/routines/${encodeURIComponent(name)}/run`),
  enable:  (pid: string, name: string) => http.post<unknown>(`/api/projects/${pid}/routines/${name}/enable`),
  disable: (pid: string, name: string) => http.post<unknown>(`/api/projects/${pid}/routines/${name}/disable`),
  upsert:  (pid: string, body: Partial<RoutineEntry>) =>
    http.post<RoutineEntry>(`/api/projects/${pid}/routines`, body),
  remove:  (pid: string, name: string) =>
    http.del<void>(`/api/projects/${pid}/routines/${encodeURIComponent(name)}`),
};
