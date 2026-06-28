import { http, unwrapPage } from "../http";

export interface SessionRow {
  engine: string;
  id: string;
  title: string;
  mtime: number;
  cwd: string;
  path: string | null;
}

export const Sessions = {
  // Cross-engine sessions (apx · claude · codex), newest first — full set.
  global: (engine?: string) =>
    http
      .get<unknown>(`/sessions${engine ? `?engine=${encodeURIComponent(engine)}` : ""}`)
      .then((b) => ({ sessions: unwrapPage<SessionRow>(b).items })),
  // Server-paginated page: returns the requested window plus the full total.
  page: ({ engine, limit, offset }: { engine?: string; limit: number; offset: number }) => {
    const q = new URLSearchParams({ limit: String(limit), offset: String(offset) });
    if (engine) q.set("engine", engine);
    return http.get<unknown>(`/sessions?${q.toString()}`).then((b) => unwrapPage<SessionRow>(b));
  },
};
