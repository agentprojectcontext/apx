import { http } from "../http";
import type { ConversationDetail, ConversationListEntry, ThreadListEntry, ThreadDetail } from "../../types/daemon";

/**
 * One path segment, safe to paste into a URL.
 *
 * Agent slugs and thread ids are NAMES, not identifiers we mint, and a coding
 * CLI brings its own: `opencode#bg`, and with it the pair id
 * `opencode#bg~tester`. Interpolated raw, everything from the `#` onward became
 * the URL's fragment and never left the browser — the daemon saw
 * `…/threads/a2a/opencode`, answered "thread not found", and each of those
 * chats was a 404 you could see in the list but not open.
 */
const seg = (s: string | number) => encodeURIComponent(String(s));

export const Conversations = {
  list: (pid: string, slug: string, includeArchived = false) =>
    http.get<ConversationListEntry[]>(
      `/api/projects/${pid}/agents/${seg(slug)}/conversations${includeArchived ? "?include_archived=1" : ""}`,
    ),
  get:  (pid: string, slug: string, id: string) =>
    http.get<ConversationDetail>(`/api/projects/${pid}/agents/${seg(slug)}/conversations/${seg(id)}`),
  // Super-agent channel threads (telegram, web quick-chat, desktop …) derived
  // from the global message ledger — one thread per channel+day.
  threads: (pid: string, includeArchived = false) =>
    http.get<ThreadListEntry[]>(
      `/api/projects/${pid}/super-agent/threads${includeArchived ? "?include_archived=1" : ""}`,
    ),
  thread: (pid: string, channel: string, id: string) =>
    http.get<ThreadDetail>(`/api/projects/${pid}/super-agent/threads/${seg(channel)}/${seg(id)}`),
  // Rename, or put away. Archiving leaves the record exactly where it is and
  // only takes it out of the lists that offer chats to resume.
  update: (pid: string, slug: string, id: string, patch: { title?: string; archived?: boolean }) =>
    http.patch<{ ok: boolean }>(`/api/projects/${pid}/agents/${seg(slug)}/conversations/${seg(id)}`, patch),
  updateThread: (pid: string, channel: string, id: string, patch: { title?: string; archived?: boolean }) =>
    http.patch<{ ok: boolean }>(`/api/projects/${pid}/super-agent/threads/${seg(channel)}/${seg(id)}`, patch),
  // Delete a persisted agent conversation (its `.md` file).
  remove: (pid: string, slug: string, id: string) =>
    http.del<{ ok: boolean }>(`/api/projects/${pid}/agents/${seg(slug)}/conversations/${seg(id)}`),
  // Delete a super-agent channel thread — its channel+day ledger file, or, for
  // a group room or an a2a pair, every ledger row belonging to that thread.
  removeThread: (pid: string, channel: string, id: string) =>
    http.del<{ ok: boolean }>(`/api/projects/${pid}/super-agent/threads/${seg(channel)}/${seg(id)}`),
  // Rewind a persisted agent conversation to its first `keepVisible` user/
  // assistant turns, dropping the rest — backs "regenerate" and "edit & resend".
  truncate: (pid: string, slug: string, id: string, keepVisible: number) =>
    http.post<{ ok: boolean }>(`/api/projects/${pid}/agents/${seg(slug)}/conversations/${seg(id)}/truncate`, { keep_visible: keepVisible }),
  compact: (pid: string, slug: string, id?: string) =>
    http.post<{ ok?: boolean }>(
      id
        ? `/api/projects/${pid}/agents/${seg(slug)}/conversations/${seg(id)}/compact`
        : `/api/projects/${pid}/agents/${seg(slug)}/compact`,
      {}
    ),
};
