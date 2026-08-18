import { http, unwrapPage } from "../http";

export interface SessionRow {
  engine: string;
  id: string;
  title: string;
  mtime: number;
  cwd: string;
  path: string | null;
  // Present only on search results: where the query matched.
  match?: "title" | "content";
}

// One session, read on demand: the working directory and last prompt cost a
// file read (or a subprocess, for OpenCode) that the list can't pay per row.
export interface SessionDetail {
  engine: string;
  id: string;
  title: string;
  last_prompt: string | null;
  cwd: string | null;
  path: string | null;
  mtime: number;
  /** The command that re-enters this session, or null if the engine can't. */
  resume_command: string | null;
}

export const Sessions = {
  detail: (id: string, engine?: string) =>
    http.get<SessionDetail>(
      `/api/sessions/${encodeURIComponent(id)}${engine ? `?engine=${encodeURIComponent(engine)}` : ""}`,
    ),
  // Cross-engine sessions (apx · claude · codex), newest first — full set.
  global: (engine?: string) =>
    http
      .get<unknown>(`/api/sessions${engine ? `?engine=${encodeURIComponent(engine)}` : ""}`)
      .then((b) => ({ sessions: unwrapPage<SessionRow>(b).items })),
  // Server-paginated page. Optional `q` runs the same search core as
  // `apx session find` (title; + transcript content when `deep`).
  page: ({ engine, q, deep, cwd, limit, offset }: { engine?: string; q?: string; deep?: boolean; cwd?: string; limit: number; offset: number }) => {
    const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
    if (engine) params.set("engine", engine);
    if (q?.trim()) params.set("q", q.trim());
    if (deep) params.set("deep", "1");
    if (cwd?.trim()) params.set("cwd", cwd.trim());
    return http.get<unknown>(`/api/sessions?${params.toString()}`).then((b) => unwrapPage<SessionRow>(b));
  },
};
