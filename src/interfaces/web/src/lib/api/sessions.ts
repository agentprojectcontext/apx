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
};
