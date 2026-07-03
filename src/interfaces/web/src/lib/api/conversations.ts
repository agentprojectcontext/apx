import { http } from "../http";
import type { ConversationDetail, ConversationListEntry, ThreadListEntry, ThreadDetail } from "../../types/daemon";

export const Conversations = {
  list: (pid: string, slug: string) =>
    http.get<ConversationListEntry[]>(`/projects/${pid}/agents/${slug}/conversations`),
  get:  (pid: string, slug: string, id: string) =>
    http.get<ConversationDetail>(`/projects/${pid}/agents/${slug}/conversations/${id}`),
  // Super-agent channel threads (telegram, web quick-chat, desktop …) derived
  // from the global message ledger — one thread per channel+day.
  threads: (pid: string) =>
    http.get<ThreadListEntry[]>(`/projects/${pid}/super-agent/threads`),
  thread: (pid: string, channel: string, id: string) =>
    http.get<ThreadDetail>(`/projects/${pid}/super-agent/threads/${channel}/${id}`),
  compact: (pid: string, slug: string, id?: string) =>
    http.post<{ ok?: boolean }>(
      id
        ? `/projects/${pid}/agents/${slug}/conversations/${id}/compact`
        : `/projects/${pid}/agents/${slug}/compact`,
      {}
    ),
};
