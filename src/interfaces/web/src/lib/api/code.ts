import { streamNdjson } from "../http";
import type { ChatStreamEvent, ConversationMessage } from "../../types/daemon";

// Code assistant client — the web surface for `apx code` (terminal coding
// assistant). There is no dedicated `/code` daemon route, and we must not
// restart the daemon, so the Code module rides on the EXISTING super-agent
// chat stream: POST /projects/:pid/super-agent/chat/stream.
//
// Why the super-agent and not a plain per-agent chat? `apx code` is a
// tool-using coding loop with project context. The super-agent is exactly
// that: the default APX tool-using dispatcher, scoped to a project via :pid,
// streaming NDJSON events (assistant_text / final / error / tool_*). Picking a
// project in the UI gives the assistant its working context, mirroring how the
// CLI resolves a project id before the REPL.
//
// Event shape on the wire (see src/host/daemon/api/super-agent.js):
//   { type: "assistant_text", text }   full accumulated text per iteration
//   { type: "tool_call" | "tool_result", ... } tool activity (surfaced as steps)
//   { type: "final", result: { text, usage, name, trace } }
//   { type: "error", error, trace_id }

export interface CodeStreamBody {
  /** The coding prompt / instruction for this turn. */
  prompt: string;
  /** Rolling conversation context (prior settled turns). */
  previousMessages?: ConversationMessage[];
  /** Optional model override (engine:model). */
  model?: string;
}

// We reuse the daemon's ChatStreamEvent but the super-agent loop emits a few
// extra fields (result, tool names) that the loose type doesn't model; callers
// narrow with a cast where needed.
export type CodeStreamEvent = ChatStreamEvent & {
  result?: { text?: string; usage?: unknown; name?: string; trace?: unknown };
  name?: string;
  tool?: string;
};

export const Code = {
  /**
   * Stream a coding turn against the super-agent for the given project.
   * `pid` is the project id that scopes the assistant's working context.
   */
  stream: (
    pid: string | number,
    body: CodeStreamBody,
    onEvent: (ev: CodeStreamEvent) => void,
    signal?: AbortSignal,
  ) =>
    streamNdjson<CodeStreamEvent>(
      `/projects/${pid}/super-agent/chat/stream`,
      body,
      onEvent,
      signal,
    ),
};
