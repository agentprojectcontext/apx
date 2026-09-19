import { http, streamNdjson } from "../http";
import type { ChatStreamEvent, ConversationMessage } from "../../types/daemon";

export interface SuperAgentSendBody {
  prompt: string;
  previousMessages?: ConversationMessage[];
  model?: string;
  // Surface that originated this turn, so the daemon injects the matching
  // channels/*.md block. "web" = big chat (full tools), "web_sidebar" = quick
  // chat (lightweight). Omitted → daemon defaults to "api".
  //
  // Any channel name, not only the two web ones: regenerating a channel thread
  // re-runs the turn INTO THAT THREAD, so the daemon has to write it to the same
  // ledger it was just cut from. Which threads may do that is decided in one
  // place — `threadRewindRefusal`, core/constants/channels.js.
  channel?: string;
  /** Files this turn carries, as paths the daemon stored (POST /media/upload).
   *  It re-resolves each one inside ~/.apx/media before reading it. */
  attachments?: { path: string; name?: string }[];
}

export const SuperAgent = {
  send: (pid: string | number, body: SuperAgentSendBody) =>
    http.post<{ text: string; usage?: unknown; name?: string }>(
      `/api/projects/${pid}/super-agent/chat`,
      body,
    ),
  stream: (
    pid: string | number,
    body: SuperAgentSendBody,
    onEvent: (ev: ChatStreamEvent) => void,
    signal?: AbortSignal,
  ) => streamNdjson<ChatStreamEvent>(`/api/projects/${pid}/super-agent/chat/stream`, body, onEvent, signal),

  summarize: (body: { prompt: string; context_note?: string; model?: string }) =>
    http.post<{ text: string; usage?: unknown; name?: string }>("/api/super-agent/summarize", body),
};
