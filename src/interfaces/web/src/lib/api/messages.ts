import { http } from "../http";
import type { MessageEntry } from "../../types/daemon";

const qs = (params: Record<string, string | number | undefined>) => {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== "") s.set(k, String(v));
  }
  const str = s.toString();
  return str ? `?${str}` : "";
};

export const Messages = {
  // Cross-project channels (telegram, direct, …) — ~/.apx/messages/<channel>/*.jsonl
  global: (opts: { channel?: string; limit?: number; since?: string } = {}) =>
    http.get<MessageEntry[]>(`/messages/global${qs(opts)}`),

  // Per-project activity — ~/.apx/projects/<id>/messages/*.jsonl
  project: (pid: string, opts: { channel?: string; agent?: string; limit?: number; since?: string } = {}) =>
    http.get<MessageEntry[]>(`/projects/${pid}/messages${qs(opts)}`),

  search: (pid: string, q: string, limit = 50) =>
    http.get<MessageEntry[]>(`/projects/${pid}/messages/search${qs({ q, limit })}`),
};
