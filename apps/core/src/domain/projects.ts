import { Autonomy, type Project } from "@apx/protocol";
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
  ...(r.registered ? {} : { registered: false }),
  ...opt("context", r.context),
  ...opt("memory", r.memory_md),
  ...autonomyOf(r.autonomy),
});

/** A stored autonomy APX knows; anything else reads as none. */
function autonomyOf(v: string | null): { autonomy?: Autonomy } {
  const a = Autonomy.safeParse(v);
  return a.success ? { autonomy: a.data } : {};
}

/** What clients see: AGENTS.md and memory.md stay in the core (they go to the agents' context). */
export const publicProject = ({ context: _c, memory: _m, ...p }: ProjectRecord): Project => p;

/** `changed` is called after a write that changed a row (the store turns it into one `team.updated`). */
export function projectsRepo({ one, all, run }: Sql, changed: () => void) {
  const write = (q: Parameters<Sql["run"]>[0]) => {
    if (run(q)) changed();
  };
  return {
    list(includeUnregistered = false): ProjectRecord[] {
      let query = qb.selectFrom("projects").selectAll().orderBy("name");
      if (!includeUnregistered) query = query.where("registered", "=", 1);
      return all(query).map(toProject);
    },
    get(id: string): ProjectRecord | undefined {
      const r = one(qb.selectFrom("projects").selectAll().where("id", "=", id));
      return r ? toProject(r) : undefined;
    },
    /** When each project last moved: its newest task change or chat message. */
    lastActivity(): Map<string, string> {
      const latest = new Map<string, string>();
      const keep = (rows: Array<{ project_id: string | null; at: string | null }>) => {
        for (const r of rows)
          if (r.project_id && r.at && r.at > (latest.get(r.project_id) ?? "")) latest.set(r.project_id, r.at);
      };
      keep(
        all(
          qb
            .selectFrom("tasks")
            .select((eb) => ["project_id", eb.fn.max("activity_at").as("at")])
            .groupBy("project_id"),
        ),
      );
      keep(
        all(
          qb
            .selectFrom("threads")
            .select((eb) => ["project_id", eb.fn.max("updated_at").as("at")])
            .groupBy("project_id"),
        ),
      );
      return latest;
    },
    byPath(p: string): ProjectRecord | undefined {
      const r = one(qb.selectFrom("projects").selectAll().where("path", "=", p));
      return r ? toProject(r) : undefined;
    },
    upsert(p: Omit<ProjectRecord, "present"> & { present?: boolean }): void {
      write(
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
            registered: 1,
            created_at: now(),
          })
          .onConflict((c) =>
            c
              .column("id")
              .doUpdateSet((eb) => ({
                name: eb.ref("excluded.name"),
                blob: eb.fn.coalesce(eb.ref("excluded.blob"), eb.ref("projects.blob")),
                path: eb.ref("excluded.path"),
                description: eb.ref("excluded.description"),
                kind: eb.ref("excluded.kind"),
                context: eb.ref("excluded.context"),
                memory_md: eb.ref("excluded.memory_md"),
                present: eb.ref("excluded.present"),
                registered: 1,
              }))
              // A reindex of unchanged files writes nothing, so it tells no client to reload.
              .where((eb) =>
                eb.or([
                  ...(["name", "path", "description", "kind", "context", "memory_md", "present"] as const).map((c) =>
                    eb(eb.ref(`projects.${c}`), "is not", eb.ref(`excluded.${c}`)),
                  ),
                  eb(
                    eb.fn.coalesce(eb.ref("excluded.blob"), eb.ref("projects.blob")),
                    "is not",
                    eb.ref("projects.blob"),
                  ),
                  eb("projects.registered", "!=", 1),
                ]),
              ),
          ),
      );
    },
    setPresent(id: string, present: boolean): void {
      write(
        qb
          .updateTable("projects")
          .set({ present: present ? 1 : 0 })
          .where("id", "=", id)
          .where("present", "!=", present ? 1 : 0),
      );
    },
    /** How far its agents go on their own when they set nothing; undefined = standard. */
    setAutonomy(id: string, autonomy: Autonomy | undefined): void {
      write(
        qb
          .updateTable("projects")
          .set({ autonomy: autonomy ?? null })
          .where("id", "=", id),
      );
    },
    /** Retain the indexed record for existing chats and tasks, without listing or watching it. */
    unregister(id: string): void {
      write(qb.updateTable("projects").set({ registered: 0 }).where("id", "=", id));
    },
  };
}
