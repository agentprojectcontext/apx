import { http, streamNdjson } from "../http";
import type { ChatStreamEvent, ChatUsage } from "../../types/daemon";

// Code module client — the web surface for OpenCode-style coding sessions.
//
// Backed by the daemon's project-scoped code-session API (see
// src/host/daemon/api/code.js). Sessions are persistent and server-side
// stateful: the turn handler rebuilds history from the stored transcript, so
// the client never sends `previousMessages`. Each session runs the super-agent
// on the `code` channel with a plan/build mode and an optional model override.

export type CodeMode = "build" | "plan";

/** Rich part shape — mirrors hooks/useChat.ts ChatPart (text | tool). */
export type CodeTextPart = { kind: "text"; text: string };
export type CodeToolPart = {
  kind: "tool";
  id: string;
  tool: string;
  args?: Record<string, unknown>;
  result?: unknown;
  status: "running" | "done" | "error" | "deduped";
};
export type CodePart = CodeTextPart | CodeToolPart;

export interface CodeTurn {
  role: "user" | "assistant";
  parts: CodePart[];
  ts: string;
  model?: string;
  mode?: CodeMode;
  usage?: ChatUsage;
  notes?: string[];
}

/** Session list row (no messages). */
export interface CodeSessionRow {
  id: string;
  title: string;
  mode: CodeMode;
  model: string | null;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  hasGit: boolean;
}

/** Full session with transcript. */
export interface CodeSession {
  id: string;
  projectId: string | null;
  title: string;
  createdAt: string;
  updatedAt: string;
  model: string | null;
  mode: CodeMode;
  git: { baselineCommit: string | null; baselineTree: string } | null;
  messages: CodeTurn[];
}

/** A single changed file in the session's diff vs its baseline. */
export interface CodeFileChange {
  path: string;
  status: "added" | "modified" | "deleted";
  additions: number | null;
  deletions: number | null;
  patch: string;
}

export interface CodeChanges {
  git: boolean;
  files: CodeFileChange[];
}

export type CodeStreamEvent = ChatStreamEvent & {
  name?: string;
  tool?: string;
};

const base = (pid: string | number) => `/projects/${pid}/code/sessions`;

export const Code = {
  sessions: {
    list: (pid: string | number) =>
      http.get<{ sessions: CodeSessionRow[] }>(base(pid)).then((r) => r.sessions),

    get: (pid: string | number, sid: string) =>
      http.get<CodeSession>(`${base(pid)}/${sid}`),

    create: (
      pid: string | number,
      body: { title?: string; model?: string | null; mode?: CodeMode } = {},
    ) => http.post<CodeSession>(base(pid), body),

    update: (
      pid: string | number,
      sid: string,
      patch: { title?: string; model?: string | null; mode?: CodeMode },
    ) => http.patch<CodeSession>(`${base(pid)}/${sid}`, patch),

    remove: (pid: string | number, sid: string) =>
      http.del<{ ok: boolean }>(`${base(pid)}/${sid}`),
  },

  changes: (pid: string | number, sid: string) =>
    http.get<CodeChanges>(`${base(pid)}/${sid}/changes`),

  /** Stream a coding turn into a session. History is server-side. */
  stream: (
    pid: string | number,
    sid: string,
    body: { prompt: string },
    onEvent: (ev: CodeStreamEvent) => void,
    signal?: AbortSignal,
  ) =>
    streamNdjson<CodeStreamEvent>(
      `${base(pid)}/${sid}/chat/stream`,
      body,
      onEvent,
      signal,
    ),
};
