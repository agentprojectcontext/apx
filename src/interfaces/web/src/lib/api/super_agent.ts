import { http, streamNdjson } from "../http";
import type { ChatStreamEvent, ConversationMessage } from "../../types/daemon";

export interface SuperAgentSendBody {
  prompt: string;
  previousMessages?: ConversationMessage[];
  model?: string;
}

export const SuperAgent = {
  send: (pid: string | number, body: SuperAgentSendBody) =>
    http.post<{ text: string; usage?: unknown; name?: string }>(
      `/projects/${pid}/super-agent/chat`,
      body,
    ),
  stream: (
    pid: string | number,
    body: SuperAgentSendBody,
    onEvent: (ev: ChatStreamEvent) => void,
    signal?: AbortSignal,
  ) => streamNdjson<ChatStreamEvent>(`/projects/${pid}/super-agent/chat/stream`, body, onEvent, signal),

  summarize: (body: { prompt: string; context_note?: string; model?: string }) =>
    http.post<{ text: string; usage?: unknown; name?: string }>("/super-agent/summarize", body),
};
