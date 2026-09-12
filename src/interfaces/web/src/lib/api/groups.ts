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
  /** Present when the room mixes agents from several projects. */
  homes?: Record<string, number | string>;
}

export type GroupMember = { project_id: number | string; slug: string };

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
  // The cascade names itself before it does any work, so it can be stopped from
  // the first token instead of only once it is over.
  | { type: "start"; turn_id: string; channel: "group"; thread_id: string }
  | { type: "owner_message" }
  | { type: "speaker_start"; slug: string; reason?: string | null }
  | { type: "speaker_delta"; slug: string; delta: string }
  // `text` is the reply as it was written to the thread. It is on the event and
  // not only in the ledger because an engine that does not stream (or a
  // fallback chain that lands on one) emits no deltas at all: without it the
  // speaker's bubble stayed empty until the re-read at the end of the whole
  // cascade, which is the "boxes with nothing in them" a room showed for
  // minutes at a time.
  | { type: "speaker_final"; slug: string; text?: string; model?: string; usage?: ChatUsage }
  // One speaker was cut off by Stop; its partial is already in the thread.
  | { type: "speaker_aborted"; slug: string; text: string }
  | { type: "done" }
  | { type: "final" }
  // The room was stopped. Not an error — see api/turn-abort.js.
  | { type: "aborted" }
  | { type: "error"; error: string }
  | GroupAgentStreamEvent;

export const Groups = {
  create: (
    pid: string,
    body: { title?: string; participants?: string[]; members?: GroupMember[] },
  ) => http.post<GroupCreated>(`/api/projects/${pid}/groups`, body),
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
  // Rewind: keep the first `keepVisible` owner+agent turns, drop the rest
  // (tool rows ride with their agent; backs regenerate / edit & resend).
  truncate: (pid: string, gid: string, keepVisible: number) =>
    http.post<{ ok: boolean; removed: number }>(`/api/projects/${pid}/groups/${gid}/truncate`, { keep_visible: keepVisible }),
};
