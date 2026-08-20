import { http } from "../http";
import type { ConversationDetail, ConversationListEntry, ThreadListEntry, ThreadDetail } from "../../types/daemon";

export const Conversations = {
  list: (pid: string, slug: string, includeArchived = false) =>
    http.get<ConversationListEntry[]>(
      `/api/projects/${pid}/agents/${slug}/conversations${includeArchived ? "?include_archived=1" : ""}`,
    ),
  get:  (pid: string, slug: string, id: string) =>
    http.get<ConversationDetail>(`/api/projects/${pid}/agents/${slug}/conversations/${id}`),
  // Super-agent channel threads (telegram, web quick-chat, desktop …) derived
  // from the global message ledger — one thread per channel+day.
  threads: (pid: string, includeArchived = false) =>
    http.get<ThreadListEntry[]>(
      `/api/projects/${pid}/super-agent/threads${includeArchived ? "?include_archived=1" : ""}`,
    ),
  thread: (pid: string, channel: string, id: string) =>
    http.get<ThreadDetail>(`/api/projects/${pid}/super-agent/threads/${channel}/${id}`),
  // Rename, or put away. Archiving leaves the record exactly where it is and
  // only takes it out of the lists that offer chats to resume.
  update: (pid: string, slug: string, id: string, patch: { title?: string; archived?: boolean }) =>
    http.patch<{ ok: boolean }>(`/api/projects/${pid}/agents/${slug}/conversations/${id}`, patch),
  updateThread: (pid: string, channel: string, id: string, patch: { title?: string; archived?: boolean }) =>
    http.patch<{ ok: boolean }>(`/api/projects/${pid}/super-agent/threads/${channel}/${id}`, patch),
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
