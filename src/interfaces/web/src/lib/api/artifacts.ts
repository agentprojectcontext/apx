import { http } from "../http";

export interface ArtifactEntry {
  name: string;
  path: string;
  size: number;
  modified: string;
}

export interface ArtifactContent {
  name: string;
  path: string;
  content: string;
}

// Shape of POST /projects/:pid/artifacts/:name/run. On success the daemon
// returns the captured stdout/stderr and exit metadata; on 4xx an error
// payload is thrown by the http client instead.
export interface ArtifactRunResult {
  ok: boolean;
  exitCode?: number | null;
  signal?: string | null;
  timedOut?: boolean;
  truncated?: boolean;
  stdout?: string;
  stderr?: string;
  durationMs?: number;
  error?: string;
}

export const Artifacts = {
  list: (pid: string) =>
    http.get<ArtifactEntry[]>(`/projects/${encodeURIComponent(pid)}/artifacts`),
  read: (pid: string, name: string) =>
    http.get<ArtifactContent>(
      `/projects/${encodeURIComponent(pid)}/artifacts/${encodeURIComponent(name)}`,
    ),
  run: (pid: string, name: string, args: string[] = []) =>
    http.post<ArtifactRunResult>(
      `/projects/${encodeURIComponent(pid)}/artifacts/${encodeURIComponent(name)}/run`,
      { args },
    ),
  remove: (pid: string, name: string) =>
    http.del<void>(
      `/projects/${encodeURIComponent(pid)}/artifacts/${encodeURIComponent(name)}`,
    ),
};
