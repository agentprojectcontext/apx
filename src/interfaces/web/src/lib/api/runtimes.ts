import { http, unwrapPage } from "../http";


/**
 * A run of an external coding runtime, as the daemon records it.
 *
 * The file behind this has existed since `call_runtime` did; nothing read it
 * back until the owner asked to see "qué sesiones vas lanzando" (2026-09-20).
 */
export interface RuntimeSession {
  id: string;
  /** "claude-code" | "codex" | … — absent on a record written before this. */
  runtime?: string | null;
  agent?: string | null;
  title?: string | null;
  status?: string | null;
  started?: string | null;
  completed?: string | null;
  /** The engine's own last words, clipped to one line by the store. */
  result?: string | null;
  /** Where it ran. Absent on sessions from before the field existed. */
  cwd?: string | null;
  external_session_path?: string | null;
  /** It has closed — however it closed. */
  done: boolean;
  /** It closed badly (non-zero exit, a timeout, a refusal). */
  failed: boolean;
  mtime: number;
  project_id: number | string;
  project_name: string;
  /** Detail only: whatever the runtime wrote into its own session file. */
  body?: string;
}

/** One line of a session's conversation, as the room shapes it. */
export interface RuntimeRoomMessage {
  role: "user" | "assistant" | "tool" | "system";
  content: string;
  ts?: string;
  /** The speaker's stable id: an agent's slug, or the engine's name. */
  agent?: string;
  agent_name?: string;
  /** "engine" when the runtime itself said it; "agent" when an agent did. */
  actor_kind?: string;
  /**
   * Set on a prompt an AGENT wrote: it reached the engine as the owner's, because
   * `claude -p` has exactly one user and does not care who typed the words.
   */
  on_behalf_of?: string;
}

/** A session as a conversation — the three voices in one list. */
export interface RuntimeRoom {
  id: string;
  channel: string;
  runtime: string | null;
  cwd: string | null;
  launched_by: string | null;
  title: string;
  participants: string[];
  messages: RuntimeRoomMessage[];
  project_id: number | string;
  project_name: string;
}

export const Runtimes = {
  /** Every project's sessions, newest first. */
  list: (limit = 60) =>
    http.get<unknown>(`/api/runtime-sessions?limit=${limit}`).then((b) => unwrapPage<RuntimeSession>(b)),

  get: (pid: string, id: string) =>
    http.get<RuntimeSession>(`/api/projects/${pid}/runtime-sessions/${encodeURIComponent(id)}`),

  /**
   * The session as a CONVERSATION, not as a record.
   *
   * `get` answers "what is this session" — engine, folder, exit code, the notes
   * it left. This answers "what was said in it", which is the half that was
   * missing: a launch used to leave a receipt you could read and not answer.
   */
  room: (pid: string, id: string) =>
    http.get<RuntimeRoom>(`/api/projects/${pid}/runtime-rooms/${encodeURIComponent(id)}`),

  /** Which engines this machine can actually start (probed by the daemon, cached). */
  engines: () =>
    http.get<{ engines: { id: string; installed: boolean }[] }>("/api/runtime-engines")
      .then((b) => b.engines || []),

  /**
   * Start a new session — the mirror of `continue_`.
   *
   * `cwd` is the folder the engine opens in, and leaving it out means the
   * project's own. It matters more than it looks: on 2026-09-20 nine sessions
   * opened in the APX project's folder while their prompts described a repo
   * somewhere else, and spent their first minutes looking for it.
   */
  start: (pid: string, body: { runtime: string; prompt: string; cwd?: string }) =>
    http.post<{ status?: string; apc_session: string; cwd?: string }>(
      `/api/projects/${pid}/runtime-sessions`,
      body,
    ),

  /**
   * Say more to a session — straight to the engine.
   *
   * It resumes THAT session (same runtime, same folder, its own title and last
   * prompt as context) rather than asking the agent that launched it to relay:
   * "si yo escribo ahí le llegará a Claude y vos no hacés nada". Returns as
   * soon as the run is launched; the result lands in the chat it belongs to.
   */
  continue_: (pid: string, id: string, prompt: string) =>
    http.post<{ status: string; apc_session: string; cwd?: string }>(
      `/api/projects/${pid}/runtime-sessions/${encodeURIComponent(id)}/continue`,
      { prompt },
    ),
};
