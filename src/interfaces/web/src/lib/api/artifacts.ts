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

// A running ephemeral preview server for an artifact. `url` is the local
// http://localhost:<port>/ address; `tunnel` is set once shared publicly.
export interface ArtifactPreview {
  id: string;
  projectId: string | number | null;
  name: string;
  kind: "html" | "react" | "static" | "text";
  port: number;
  url: string;
  watch: boolean;
  createdAt: string;
  hits: number;
  tunnel: { id: string; url: string; provider: string } | null;
}

export interface ArtifactTunnel {
  id: string;
  url: string;
  provider: string;
  port: number;
  createdAt: string;
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
  write: (pid: string, name: string, content: string) =>
    http.patch<{ ok: boolean; name: string }>(
      `/projects/${encodeURIComponent(pid)}/artifacts/${encodeURIComponent(name)}`,
      { content },
    ),
  rename: (pid: string, name: string, newName: string) =>
    http.patch<{ ok: boolean; name: string }>(
      `/projects/${encodeURIComponent(pid)}/artifacts/${encodeURIComponent(name)}`,
      { newName },
    ),

  // Start (or reuse) an ephemeral local preview server for an artifact.
  preview: (pid: string, name: string, watch = true) =>
    http.post<ArtifactPreview>(
      `/projects/${encodeURIComponent(pid)}/artifacts/${encodeURIComponent(name)}/preview`,
      { watch },
    ),
  // List running preview servers for a project.
  previews: (pid: string) =>
    http.get<ArtifactPreview[]>(`/projects/${encodeURIComponent(pid)}/previews`),
  stopPreview: (id: string) => http.del<void>(`/previews/${encodeURIComponent(id)}`),
  // Open / close a public tunnel to a running preview.
  openTunnel: (id: string, provider?: string) =>
    http.post<ArtifactTunnel>(`/previews/${encodeURIComponent(id)}/tunnel`, { provider }),
  closeTunnel: (id: string) => http.del<void>(`/previews/${encodeURIComponent(id)}/tunnel`),
};
