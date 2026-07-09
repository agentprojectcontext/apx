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

export const Sessions = {
  // Cross-engine sessions (apx · claude · codex), newest first — full set.
  global: (engine?: string) =>
    http
      .get<unknown>(`/sessions${engine ? `?engine=${encodeURIComponent(engine)}` : ""}`)
      .then((b) => ({ sessions: unwrapPage<SessionRow>(b).items })),
  // Server-paginated page. Optional `q` runs the same search core as
  // `apx session find` (title; + transcript content when `deep`).
  page: ({ engine, q, deep, cwd, limit, offset }: { engine?: string; q?: string; deep?: boolean; cwd?: string; limit: number; offset: number }) => {
    const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
    if (engine) params.set("engine", engine);
    if (q?.trim()) params.set("q", q.trim());
    if (deep) params.set("deep", "1");
    if (cwd?.trim()) params.set("cwd", cwd.trim());
    return http.get<unknown>(`/sessions?${params.toString()}`).then((b) => unwrapPage<SessionRow>(b));
  },
};
