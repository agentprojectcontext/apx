import { http } from "../http";
import type { ConversationDetail, ConversationListEntry } from "../../types/daemon";

export const Conversations = {
  list: (pid: string, slug: string) =>
    http.get<ConversationListEntry[]>(`/projects/${pid}/agents/${slug}/conversations`),
  get:  (pid: string, slug: string, id: string) =>
    http.get<ConversationDetail>(`/projects/${pid}/agents/${slug}/conversations/${id}`),
  compact: (pid: string, slug: string, id?: string) =>
    http.post<{ ok?: boolean }>(
      id
        ? `/projects/${pid}/agents/${slug}/conversations/${id}/compact`
        : `/projects/${pid}/agents/${slug}/compact`,
      {}
    ),
};
