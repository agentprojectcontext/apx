import type { Project } from "@apx/protocol";
import type { Selectable } from "kysely";
import type { ProjectsTable } from "../db/schema.ts";
import { now, opt, qb, type Sql } from "./sql.ts";

/** `context` is AGENTS.md and `memory` the owner's .apc/memory.md: both go to the agents, never to clients. */
export type ProjectRecord = Project & { path?: string; context?: string; memory?: string };

const toProject = (r: Selectable<ProjectsTable>): ProjectRecord => ({
  id: r.id,
  name: r.name,
  ...opt("blob", r.blob),
  ...opt("path", r.path),
  ...opt("description", r.description),
  ...opt("kind", r.kind),
  present: Boolean(r.present),
  ...opt("context", r.context),
  ...opt("memory", r.memory_md),
});

/** What clients see: AGENTS.md and memory.md stay in the core (they go to the agents' context). */
export const publicProject = ({ context: _c, memory: _m, ...p }: ProjectRecord): Project => p;

export function projectsRepo({ one, all, run }: Sql) {
  return {
    list(): ProjectRecord[] {
      return all(qb.selectFrom("projects").selectAll().orderBy("name")).map(toProject);
    },
    get(id: string): ProjectRecord | undefined {
      const r = one(qb.selectFrom("projects").selectAll().where("id", "=", id));
      return r ? toProject(r) : undefined;
    },
    byPath(p: string): ProjectRecord | undefined {
      const r = one(qb.selectFrom("projects").selectAll().where("path", "=", p));
      return r ? toProject(r) : undefined;
    },
    upsert(p: Omit<ProjectRecord, "present"> & { present?: boolean }): void {
      run(
        qb
          .insertInto("projects")
          .values({
            id: p.id,
            name: p.name,
            blob: p.blob ?? null,
            path: p.path ?? null,
            description: p.description ?? null,
            kind: p.kind ?? null,
            context: p.context ?? null,
            memory_md: p.memory ?? null,
            present: p.present === false ? 0 : 1,
            created_at: now(),
          })
          .onConflict((c) =>
            c.column("id").doUpdateSet((eb) => ({
              name: eb.ref("excluded.name"),
              blob: eb.fn.coalesce(eb.ref("excluded.blob"), eb.ref("projects.blob")),
              path: eb.ref("excluded.path"),
              description: eb.ref("excluded.description"),
              kind: eb.ref("excluded.kind"),
              context: eb.ref("excluded.context"),
              memory_md: eb.ref("excluded.memory_md"),
              present: eb.ref("excluded.present"),
            })),
          ),
      );
    },
    setPresent(id: string, present: boolean): void {
      run(
        qb
          .updateTable("projects")
          .set({ present: present ? 1 : 0 })
          .where("id", "=", id),
      );
    },
  };
}
