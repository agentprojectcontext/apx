import type { Project } from "@apx/protocol";
import { now, opt, type Row, type Sql } from "./sql.ts";

/** `context` is AGENTS.md and `memory` the owner's .apc/memory.md: both go to the agents, never to clients. */
export type ProjectRecord = Project & { path?: string; context?: string; memory?: string };

const toProject = (r: Row): ProjectRecord => ({
  id: String(r.id),
  name: String(r.name),
  ...opt("blob", r.blob),
  ...opt("path", r.path),
  ...opt("description", r.description),
  ...opt("kind", r.kind),
  present: r.present === undefined || r.present === null ? true : Boolean(r.present),
  ...opt("context", r.context),
  ...opt("memory", r.memory_md),
});

/** What clients see: AGENTS.md and memory.md stay in the core (they go to the agents' context). */
export const publicProject = ({ context: _c, memory: _m, ...p }: ProjectRecord): Project => p;

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
        `INSERT INTO projects (id, name, blob, path, description, kind, context, memory_md, present, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET name = excluded.name, blob = COALESCE(excluded.blob, projects.blob), path = excluded.path,
           description = excluded.description, kind = excluded.kind, context = excluded.context,
           memory_md = excluded.memory_md, present = excluded.present`,
        p.id,
        p.name,
        p.blob ?? null,
        p.path ?? null,
        p.description ?? null,
        p.kind ?? null,
        p.context ?? null,
        p.memory ?? null,
        p.present === false ? 0 : 1,
        now(),
      );
    },
    setPresent(id: string, present: boolean): void {
      run("UPDATE projects SET present = ? WHERE id = ?", present ? 1 : 0, id);
    },
  };
}
