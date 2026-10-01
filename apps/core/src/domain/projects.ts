import type { Project } from "@apx/protocol";
import { now, opt, type Row, type Sql } from "./sql.ts";

const toProject = (r: Row): Project => ({
  id: String(r.id),
  name: String(r.name),
  ...opt("blob", r.blob),
  ...opt("path", r.path),
});

export function projectsRepo({ one, all, run }: Sql) {
  return {
    list(): Project[] {
      return all("SELECT * FROM projects ORDER BY name").map(toProject);
    },
    get(id: string): Project | undefined {
      const r = one("SELECT * FROM projects WHERE id = ?", id);
      return r ? toProject(r) : undefined;
    },
    upsert(p: Project): void {
      run(
        "INSERT INTO projects (id, name, blob, path, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET name = excluded.name, blob = excluded.blob, path = excluded.path",
        p.id,
        p.name,
        p.blob ?? null,
        p.path ?? null,
        now(),
      );
    },
  };
}
