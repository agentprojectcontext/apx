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

export const Runtimes = {
  /** Every project's sessions, newest first. */
  list: (limit = 60) =>
    http.get<unknown>(`/api/runtime-sessions?limit=${limit}`).then((b) => unwrapPage<RuntimeSession>(b)),

  get: (pid: string, id: string) =>
    http.get<RuntimeSession>(`/api/projects/${pid}/runtime-sessions/${encodeURIComponent(id)}`),

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
