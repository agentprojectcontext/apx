import type { Project } from "@apx/protocol";
import { now, opt, type Row, type Sql } from "./sql.ts";

export type ProjectRecord = Project & { path?: string; context?: string };

const toProject = (r: Row): ProjectRecord => ({
  id: String(r.id),
  name: String(r.name),
  ...opt("blob", r.blob),
  ...opt("path", r.path),
  ...opt("description", r.description),
  ...opt("kind", r.kind),
  present: r.present === undefined || r.present === null ? true : Boolean(r.present),
  ...opt("context", r.context),
});

/** What clients see: AGENTS.md stays in the core (it goes to the agents' context). */
export const publicProject = ({ context: _c, ...p }: ProjectRecord): Project => p;

export function projectsRepo({ one, all, run }: Sql) {
  return {
    list(): ProjectRecord[] {
      return all("SELECT * FROM projects ORDER BY name").map(toProject);
    },
    get(id: string): ProjectRecord | undefined {
      const r = one("SELECT * FROM projects WHERE id = ?", id);
      return r ? toProject(r) : undefined;
    },
    byPath(p: string): ProjectRecord | undefined {
      const r = one("SELECT * FROM projects WHERE path = ?", p);
      return r ? toProject(r) : undefined;
    },
    upsert(p: Omit<ProjectRecord, "present"> & { present?: boolean }): void {
      run(
        `INSERT INTO projects (id, name, blob, path, description, kind, context, present, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET name = excluded.name, blob = COALESCE(excluded.blob, projects.blob), path = excluded.path,
           description = excluded.description, kind = excluded.kind, context = excluded.context, present = excluded.present`,
        p.id,
        p.name,
        p.blob ?? null,
        p.path ?? null,
        p.description ?? null,
        p.kind ?? null,
        p.context ?? null,
        p.present === false ? 0 : 1,
        now(),
      );
    },
    setPresent(id: string, present: boolean): void {
      run("UPDATE projects SET present = ? WHERE id = ?", present ? 1 : 0, id);
    },
  };
}
