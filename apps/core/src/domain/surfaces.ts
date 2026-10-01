// Widgets, sidebar panels and fullscreen apps: one primitive. Addressed by id; an agent updates its own by
// stable name within a project (`upsert`).
import { randomUUID } from "node:crypto";
import type { Surface, SurfaceSummary } from "@apx/protocol";
import type { Bus } from "../bus.ts";
import { newId, now, opt, type Row, type Sql } from "./sql.ts";

const toSurface = (r: Row): Surface => ({
  id: String(r.id),
  name: String(r.name),
  title: String(r.title),
  html: String(r.html),
  version: Number(r.version),
  pinned: Boolean(r.pinned),
  app: Boolean(r.app),
  ...opt("project_id", r.project_id),
  ...opt("thread_id", r.thread_id),
  created_by: String(r.created_by),
  updated_at: String(r.updated_at),
  ...(r.share_token ? { share_path: `/a/${String(r.share_token)}` } : {}),
});

export const summary = ({ html: _html, ...rest }: Surface): SurfaceSummary => rest;

export function surfacesRepo({ one, all, run }: Sql, bus: Bus) {
  const emit = (s: Surface) => bus.emit({ type: "surface.updated", surface: summary(s) });
  const repo = {
    list(projectId?: string): SurfaceSummary[] {
      const rows = projectId
        ? all("SELECT * FROM surfaces WHERE project_id = ? OR project_id IS NULL ORDER BY updated_at DESC", projectId)
        : all("SELECT * FROM surfaces ORDER BY updated_at DESC");
      return rows.map((r) => summary(toSurface(r)));
    },
    get(id: string): Surface | undefined {
      const r = one("SELECT * FROM surfaces WHERE id = ?", id);
      return r ? toSurface(r) : undefined;
    },
    /** A surface by its stable name within a project (or among global ones). */
    byName(projectId: string | undefined, name: string): Surface | undefined {
      const r = one("SELECT * FROM surfaces WHERE COALESCE(project_id, '') = ? AND name = ?", projectId ?? "", name);
      return r ? toSurface(r) : undefined;
    },
    byShareToken(token: string): Surface | undefined {
      const r = one("SELECT * FROM surfaces WHERE share_token = ?", token);
      return r ? toSurface(r) : undefined;
    },
    upsert(s: {
      name: string;
      title: string;
      html: string;
      project_id?: string | undefined;
      thread_id?: string | undefined;
      created_by: string;
      pinned?: boolean | undefined;
      app?: boolean | undefined;
    }): Surface {
      const existing = one(
        "SELECT * FROM surfaces WHERE COALESCE(project_id, '') = ? AND name = ?",
        s.project_id ?? "",
        s.name,
      );
      const ts = now();
      if (existing) {
        const cur = toSurface(existing);
        const next: Surface = {
          ...cur,
          title: s.title,
          html: s.html,
          version: cur.version + 1,
          pinned: s.pinned ?? cur.pinned,
          app: s.app ?? cur.app,
          updated_at: ts,
        };
        run(
          "UPDATE surfaces SET title = ?, html = ?, version = ?, pinned = ?, app = ?, updated_at = ? WHERE id = ?",
          next.title,
          next.html,
          next.version,
          Number(next.pinned),
          Number(next.app),
          ts,
          cur.id,
        );
        emit(next);
        return next;
      }
      const created: Surface = {
        id: newId("srf"),
        name: s.name,
        title: s.title,
        html: s.html,
        version: 1,
        pinned: s.pinned ?? false,
        app: s.app ?? false,
        ...(s.project_id ? { project_id: s.project_id } : {}),
        ...(s.thread_id ? { thread_id: s.thread_id } : {}),
        created_by: s.created_by,
        updated_at: ts,
      };
      run(
        "INSERT INTO surfaces (id, name, title, html, version, pinned, app, project_id, thread_id, created_by, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        created.id,
        created.name,
        created.title,
        created.html,
        1,
        Number(created.pinned),
        Number(created.app),
        created.project_id ?? null,
        created.thread_id ?? null,
        created.created_by,
        ts,
      );
      emit(created);
      return created;
    },
    patch(id: string, p: { pinned?: boolean | undefined; app?: boolean | undefined }): SurfaceSummary | undefined {
      const cur = repo.get(id);
      if (!cur) return undefined;
      const next = { ...cur, pinned: p.pinned ?? cur.pinned, app: p.app ?? cur.app, updated_at: now() };
      run(
        "UPDATE surfaces SET pinned = ?, app = ?, updated_at = ? WHERE id = ?",
        Number(next.pinned),
        Number(next.app),
        next.updated_at,
        cur.id,
      );
      emit(next);
      return summary(next);
    },
    share(id: string, shared: boolean): SurfaceSummary | undefined {
      const cur = repo.get(id);
      if (!cur) return undefined;
      const token = shared ? (cur.share_path?.slice(3) ?? randomUUID().replaceAll("-", "")) : null;
      run("UPDATE surfaces SET share_token = ? WHERE id = ?", token, cur.id);
      const next = repo.get(cur.id) as Surface;
      emit(next);
      return summary(next);
    },
  };
  return repo;
}
