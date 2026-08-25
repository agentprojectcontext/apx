import { http, streamNdjson } from "../http";
import type { ChatStreamEvent, ChatUsage } from "../../types/daemon";

// A group is a THREAD (channel "group") — listing and reading it go through the
// shared thread endpoints (Conversations.thread / the threads list / the inbox),
// not here. This client owns only what's group-specific: creating a room, adding
// a participant, and running the owner's turn as a streamed mention-cascade.

export interface GroupCreated {
  id: string;
  channel: "group";
  title: string;
  participants: string[];
}

// Agent-loop events forwarded through a group speaker turn (same NDJSON shape as 1:1 chat).
type GroupAgentStreamEvent = ChatStreamEvent & {
  type:
    | "tool_start"
    | "tool_result"
    | "tool_deduped"
    | "assistant_text"
    | "model_start"
    | "model_routed"
    | "engine_failed"
    | "model_retry"
    | "tools_suppressed"
    | "skill_inspector"
    | "reasoning";
};

// NDJSON events streamed while a group turn runs. Bodies are re-read from the
// thread afterward; these drive live speaker attribution + token streaming.
export type GroupStreamEvent =
  | { type: "owner_message" }
  | { type: "speaker_start"; slug: string; reason?: string | null }
  | { type: "speaker_delta"; slug: string; delta: string }
  | { type: "speaker_final"; slug: string; model?: string; usage?: ChatUsage }
  | { type: "done" }
  | { type: "final" }
  | { type: "error"; error: string }
  | GroupAgentStreamEvent;

export const Groups = {
  create: (pid: string, body: { title?: string; participants: string[] }) =>
    http.post<GroupCreated>(`/api/projects/${pid}/groups`, body),
  addParticipant: (pid: string, gid: string, slug: string) =>
    http.post<{ id: string; participants: string[] }>(`/api/projects/${pid}/groups/${gid}/participants`, { slug }),
  removeParticipant: (pid: string, gid: string, slug: string) =>
    http.del<{ id: string; participants: string[] }>(`/api/projects/${pid}/groups/${gid}/participants/${encodeURIComponent(slug)}`),
  sendStream: (
    pid: string,
    gid: string,
    prompt: string,
    onEvent: (ev: GroupStreamEvent) => void,
    signal?: AbortSignal,
    attachments?: { path: string; name?: string }[],
  ) => streamNdjson<GroupStreamEvent>(
    `/api/projects/${pid}/groups/${gid}/message/stream`,
    { prompt, ...(attachments?.length ? { attachments } : {}) },
    onEvent, signal,
  ),
  // Re-run from a speaker against the existing last owner message (regenerate).
  // `from` = slug to resume at; `reason` = who pulled them in (omit if owner).
  rerunStream: (
    pid: string,
    gid: string,
    onEvent: (ev: GroupStreamEvent) => void,
    signal?: AbortSignal,
    resume?: { from: string; reason?: string | null },
  ) => streamNdjson<GroupStreamEvent>(
    `/api/projects/${pid}/groups/${gid}/message/stream`,
    { rerun: true, ...(resume?.from ? { from: resume.from, ...(resume.reason ? { reason: resume.reason } : {}) } : {}) },
    onEvent, signal,
  ),
  // Rewind: keep the first `keepVisible` messages, drop the rest (backs
  // regenerate / edit & resend, which overwrite everything after a point).
  truncate: (pid: string, gid: string, keepVisible: number) =>
    http.post<{ ok: boolean; removed: number }>(`/api/projects/${pid}/groups/${gid}/truncate`, { keep_visible: keepVisible }),
};
