import { http } from "../http";
import type { ConversationDetail, ConversationListEntry, ThreadListEntry, ThreadDetail } from "../../types/daemon";

export const Conversations = {
  list: (pid: string, slug: string) =>
    http.get<ConversationListEntry[]>(`/api/projects/${pid}/agents/${slug}/conversations`),
  get:  (pid: string, slug: string, id: string) =>
    http.get<ConversationDetail>(`/api/projects/${pid}/agents/${slug}/conversations/${id}`),
  // Super-agent channel threads (telegram, web quick-chat, desktop …) derived
  // from the global message ledger — one thread per channel+day.
  threads: (pid: string) =>
    http.get<ThreadListEntry[]>(`/api/projects/${pid}/super-agent/threads`),
  thread: (pid: string, channel: string, id: string) =>
    http.get<ThreadDetail>(`/api/projects/${pid}/super-agent/threads/${channel}/${id}`),
  // Delete a persisted agent conversation (its `.md` file).
  remove: (pid: string, slug: string, id: string) =>
    http.del<{ ok: boolean }>(`/api/projects/${pid}/agents/${slug}/conversations/${id}`),
  // Delete a super-agent channel thread (its channel+day ledger file).
  removeThread: (pid: string, channel: string, id: string) =>
    http.del<{ ok: boolean }>(`/api/projects/${pid}/super-agent/threads/${channel}/${id}`),
  compact: (pid: string, slug: string, id?: string) =>
    http.post<{ ok?: boolean }>(
      id
        ? `/api/projects/${pid}/agents/${slug}/conversations/${id}/compact`
        : `/api/projects/${pid}/agents/${slug}/compact`,
      {}
    ),
};
