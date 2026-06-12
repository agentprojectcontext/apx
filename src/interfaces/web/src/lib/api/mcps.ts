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

export interface McpTestResult {
  ok: boolean;
  tool_count?: number;
  tools?: Array<{ name: string; description: string }>;
  error?: string;
}

export interface McpLogsResult {
  transport: "stdio" | "http";
  running?: boolean;
  command?: string;
  args?: string[];
  url?: string;
  started_at?: string | null;
  last_exit_code?: number | null;
  last_error?: string | null;
  stderr_tail?: string;
  events: Array<{ ts: string; level: string; msg: string }>;
  note?: string;
}

export const Mcps = {
  list:   (pid: string) => http.get<McpEntry[]>(`/projects/${pid}/mcps`),
  check:  (pid: string) => http.get<McpCheck>(`/projects/${pid}/mcps/check`),
  add:    (pid: string, scope: McpScope, body: McpAddBody) =>
    http.post<{ ok: true; name: string }>(`/projects/${pid}/mcps?scope=${scope}`, body),
  remove: (pid: string, name: string, scope: McpScope = "shared") =>
    http.del<void>(`/projects/${pid}/mcps/${encodeURIComponent(name)}?scope=${scope}`),
  test:   (pid: string, name: string) =>
    http.post<McpTestResult>(`/projects/${pid}/mcps/${encodeURIComponent(name)}/test`, {}),
  logs:   (pid: string, name: string) =>
    http.get<McpLogsResult>(`/projects/${pid}/mcps/${encodeURIComponent(name)}/logs`),
};
