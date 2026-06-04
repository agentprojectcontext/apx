import { http } from "../http";
import type { McpEntry } from "../../types/daemon";

export type McpScope = "shared" | "runtime" | "global";

export interface McpCheck {
  sources: Array<{ name: string; path: string }>;
  entries: McpEntry[];
  conflicts: Array<{ name: string; sources: string[] }>;
}

export interface McpAddBody {
  name: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
  enabled?: boolean;
}

export const Mcps = {
  list:   (pid: string) => http.get<McpEntry[]>(`/projects/${pid}/mcps`),
  check:  (pid: string) => http.get<McpCheck>(`/projects/${pid}/mcps/check`),
  add:    (pid: string, scope: McpScope, body: McpAddBody) =>
    http.post<{ ok: true; name: string }>(`/projects/${pid}/mcps?scope=${scope}`, body),
  remove: (pid: string, name: string, scope: McpScope = "shared") =>
    http.del<void>(`/projects/${pid}/mcps/${encodeURIComponent(name)}?scope=${scope}`),
};
