import { http } from "../http";

export interface SessionRow {
  engine: string;
  id: string;
  title: string;
  mtime: number;
  cwd: string;
  path: string | null;
}

export const Sessions = {
  // Cross-engine sessions (apx · claude · codex), newest first.
  global: (engine?: string) =>
    http.get<{ sessions: SessionRow[] }>(`/sessions${engine ? `?engine=${encodeURIComponent(engine)}` : ""}`),
  // Server-paginated page: returns the requested window plus the full total.
  page: ({ engine, limit, offset }: { engine?: string; limit: number; offset: number }) => {
    const q = new URLSearchParams({ limit: String(limit), offset: String(offset) });
    if (engine) q.set("engine", engine);
    return http
      .getWithTotal<{ sessions: SessionRow[] }>(`/sessions?${q.toString()}`)
      .then((r) => ({ items: r.data.sessions, total: r.total }));
  },
};
