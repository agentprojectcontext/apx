import { Autonomy, BASE_PROJECT_ID, type Project } from "@apx/protocol";
import type { Selectable } from "kysely";
import type { ProjectsTable } from "../db/schema.ts";
import { now, opt, qb, type Sql } from "./sql.ts";

/** `context` is AGENTS.md and `memory` the owner's .apc/memory.md: both go to the agents, never to clients. */
export type ProjectRecord = Project & { path?: string; context?: string; memory?: string };
type ProjectWrite = Omit<ProjectRecord, "present" | "agents_md_chars" | "unreadable"> & {
  present?: boolean;
  context_chars?: number;
};
type Unreadable = NonNullable<Project["unreadable"]>;

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
  ...(r.context_chars ? { agents_md_chars: r.context_chars } : {}),
  ...autonomyOf(r.autonomy),
  ...foldersOf(r.read_only_folders),
  ...opt("parent", r.parent_id),
});

/** A stored list of folders; anything that is not a list of strings reads as none. */
function foldersOf(v: string | null): { read_only_folders?: string[] } {
  try {
    const list: unknown = v ? JSON.parse(v) : undefined;
    return Array.isArray(list) && list.length && list.every((x) => typeof x === "string")
      ? { read_only_folders: list }
      : {};
  } catch {
    return {};
  }
}

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
  // Not stored: the next start reads every folder again (apc/sync.ts load).
  const unreadable = new Map<string, Unreadable>();
  const shape = (r: Selectable<ProjectsTable>): ProjectRecord => {
    const p = toProject(r);
    const why = unreadable.get(p.id);
    return why ? { ...p, unreadable: why } : p;
  };
  /** Every record indexed at a folder, the one that holds it first: registered, then the oldest. */
  const atPath = (p: string): ProjectRecord[] =>
    all(
      qb
        .selectFrom("projects")
        .selectAll()
        .where("path", "=", p)
        .orderBy("registered", "desc")
        .orderBy("created_at")
        .orderBy("id"),
    ).map(shape);
  return {
    list(includeUnregistered = false): ProjectRecord[] {
      let query = qb.selectFrom("projects").selectAll().orderBy("name");
      if (!includeUnregistered) query = query.where("registered", "=", 1);
      return all(query).map(shape);
    },
    get(id: string): ProjectRecord | undefined {
      const r = one(qb.selectFrom("projects").selectAll().where("id", "=", id));
      return r ? shape(r) : undefined;
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
      return atPath(p)[0];
    },
    atPath,
    upsert(p: ProjectWrite): void {
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
            context_chars: p.context_chars ?? null,
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
                context_chars: eb.ref("excluded.context_chars"),
                memory_md: eb.ref("excluded.memory_md"),
                present: eb.ref("excluded.present"),
                registered: 1,
              }))
              // A reindex of unchanged files writes nothing, so it tells no client to reload.
              .where((eb) =>
                eb.or([
                  ...(
                    ["name", "path", "description", "kind", "context", "context_chars", "memory_md", "present"] as const
                  ).map((c) => eb(eb.ref(`projects.${c}`), "is not", eb.ref(`excluded.${c}`))),
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
    /** Why its folder could not be read, while this core runs; undefined once it was. */
    setUnreadable(id: string, why: Unreadable | undefined): void {
      if (unreadable.get(id) === why) return;
      if (why) unreadable.set(id, why);
      else unreadable.delete(id);
      changed();
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
    /** The folders its agents may only read, already checked (tools/folders.ts checkReadOnly); [] removes them. */
    setReadOnlyFolders(id: string, folders: string[]): void {
      write(
        qb
          .updateTable("projects")
          .set({ read_only_folders: folders.length ? JSON.stringify(folders) : null })
          .where("id", "=", id),
      );
    },
    /** Makes it a subproject of `parent` (a project id or BASE_PROJECT_ID), already checked; undefined detaches it. */
    setParent(id: string, parent: string | undefined): void {
      write(
        qb
          .updateTable("projects")
          .set({ parent_id: parent ?? null })
          .where("id", "=", id),
      );
    },
    /** Its registered subprojects (BASE_PROJECT_ID: the base project's). */
    children(id: string): ProjectRecord[] {
      return all(
        qb.selectFrom("projects").selectAll().where("parent_id", "=", id).where("registered", "=", 1).orderBy("name"),
      ).map(shape);
    },
    /**
     * Retain the indexed record for existing chats and tasks, without listing or watching it. Its subprojects become
     * projects of their own, and a subproject stops being one: brought back, it is a project of its own.
     */
    unregister(id: string): void {
      write(qb.updateTable("projects").set({ parent_id: null }).where("parent_id", "=", id));
      write(qb.updateTable("projects").set({ registered: 0, parent_id: null }).where("id", "=", id));
    },
  };
}

type ProjectsRepo = ReturnType<typeof projectsRepo>;

/**
 * Where a subproject takes what is kept per project from: its parent's id, or `project: undefined` (the global scope)
 * for a subproject of the base project. Undefined for a project of its own.
 */
export function inheritsFrom(
  projects: Pick<ProjectsRepo, "get">,
  id: string | undefined,
): { project: string | undefined } | undefined {
  const parent = id ? projects.get(id)?.parent : undefined;
  if (parent === BASE_PROJECT_ID) return { project: undefined };
  const p = parentOf(projects, id);
  return p ? { project: p.id } : undefined;
}

/**
 * The real project a subproject takes its agents and resources from: its parent when that is a registered project.
 * Undefined for a project of its own and for a subproject of the base project, whose agents and resources (the global
 * ones) every project already takes.
 */
export function parentOf(projects: Pick<ProjectsRepo, "get">, id: string | undefined): ProjectRecord | undefined {
  const parent = id ? projects.get(id)?.parent : undefined;
  if (!parent || parent === BASE_PROJECT_ID) return undefined;
  const p = projects.get(parent);
  return p && p.registered !== false ? p : undefined;
}

/** The projects whose own resources a project takes, nearest first: itself, then its parent (one level). */
export function lineage(projects: Pick<ProjectsRepo, "get">, id: string | undefined): string[] {
  if (!id) return [];
  const parent = parentOf(projects, id);
  return parent ? [id, parent.id] : [id];
}

/**
 * Whether an agent of `home` (undefined: a global agent) works in `project` (undefined: the base project): a global
 * agent everywhere, a project's agent in its own project and in that project's subprojects.
 */
export function worksIn(
  projects: Pick<ProjectsRepo, "get">,
  home: string | undefined,
  project: string | undefined,
): boolean {
  if (!home) return true;
  return lineage(projects, project).includes(home);
}

/**
 * Why `id` (undefined: a project being created) cannot become a subproject of `parent`, or undefined when it can: the
 * parent is the base project or a registered project of its own, not `id` itself, and `id` has no subprojects.
 */
export function parentProblem(
  projects: Pick<ProjectsRepo, "get" | "children">,
  id: string | undefined,
  parent: string,
): string | undefined {
  if (parent === id) return "a project cannot be its own subproject";
  if (id && projects.children(id).length) return "a project with subprojects cannot become a subproject";
  if (parent === BASE_PROJECT_ID) return undefined;
  const p = projects.get(parent);
  if (!p || p.registered === false) return `no project ${parent}`;
  if (p.parent) return `${p.name} is a subproject: subprojects have none of their own`;
  return undefined;
}
