import { createHash } from "node:crypto";
import { sql as raw } from "kysely";
import { migrationGrants } from "./agent-migration-grants.ts";
import type { agentMigrationInventory } from "./agent-migration-inventory.ts";
import { migrationOwnedWork } from "./agent-migration-owned.ts";
import { projectProtectionRepo } from "./project-protection.ts";
import { qb, type Sql } from "./sql.ts";

type Selection = {
  agent: string;
  source: string;
  destination: string;
  tasks: string[];
  detached_tasks: string[];
  threads: string[];
  detached_threads: string[];
  memories: string[];
  routines: string[];
  surfaces: string[];
  media: string[];
};
const within = (column: string, ids: string[]) =>
  raw<boolean>`${raw.ref(column)} in (select value from json_each(${JSON.stringify(ids)}))`;

export function migrationSnapshot(q: Sql, live: Selection, relatedAgents?: string[]) {
  const agent = q.one(qb.selectFrom("agents").selectAll().where("id", "=", live.agent));
  return {
    owned_work: migrationOwnedWork(q, live.agent, agent?.project_id ?? live.source),
    projects: q.all(
      qb.selectFrom("projects").selectAll().where("id", "in", [live.source, live.destination]).orderBy("id"),
    ),
    detached_threads: q.all(
      qb.selectFrom("threads").selectAll().where(within("id", live.detached_threads)).orderBy("id"),
    ),
    protections: projectProtectionRepo(q)
      .list()
      .filter((p) => p.project === live.destination),
    grants: migrationGrants(q, live),
    agents: q
      .all(qb.selectFrom("agents").selectAll().orderBy("id"))
      .filter((a) =>
        relatedAgents
          ? relatedAgents.includes(a.id)
          : a.id === live.agent ||
            (a.project_id === live.source && a.parent && (a.parent === agent?.slug || a.parent === live.agent)),
      ),
    tasks: q.all(
      qb
        .selectFrom("tasks")
        .selectAll()
        .where(within("id", [...live.tasks, ...live.detached_tasks]))
        .orderBy("id"),
    ),
    threads: q.all(qb.selectFrom("threads").selectAll().where(within("id", live.threads)).orderBy("id")),
    memories: q.all(qb.selectFrom("memories").selectAll().where(within("id", live.memories)).orderBy("id")),
    media: q.all(
      qb
        .selectFrom("media")
        .selectAll()
        .where((eb) => eb.or([within("id", live.media), within("thread_id", live.threads)]))
        .orderBy("id"),
    ),
    attachments: q.all(
      qb.selectFrom("task_attachments").selectAll().where(within("task_id", live.tasks)).orderBy("media_id"),
    ),
    routines: q.all(qb.selectFrom("routines").selectAll().where(within("id", live.routines)).orderBy("id")),
    surfaces: q.all(qb.selectFrom("surfaces").selectAll().where(within("id", live.surfaces)).orderBy("id")),
    model_log: q.all(
      qb
        .selectFrom("model_log")
        .selectAll()
        .where(within("thread_id", live.threads))
        .orderBy("thread_id")
        .orderBy("seq"),
    ),
    harness_sessions: q.all(
      qb
        .selectFrom("harness_sessions")
        .selectAll()
        .where(within("thread_id", live.threads))
        .orderBy("thread_id")
        .orderBy("harness"),
    ),
    memory_work: q.all(qb.selectFrom("memory_work").selectAll().where(within("thread_id", live.threads)).orderBy("id")),
    memory_episodes: q.all(
      qb.selectFrom("memory_episodes").selectAll().where(within("thread_id", live.threads)).orderBy("rowid"),
    ),
    memory_exclusions: q.all(
      qb
        .selectFrom("memory_exclusions")
        .selectAll()
        .where((eb) => eb.or([eb("agent_id", "=", live.agent), within("thread_id", live.threads)]))
        .orderBy("memory_id"),
    ),
  };
}

/** New work makes an automatic reversal unsafe, even when it did not change a task. */
export function migrationRevision(q: Sql, inventory: Selection, agents: string[]) {
  const messages = q.all(
    qb.selectFrom("messages").selectAll().where(within("thread_id", inventory.threads)).orderBy("id"),
  );
  const runs = q.all(qb.selectFrom("runs").selectAll().where(within("thread_id", inventory.threads)).orderBy("id"));
  const events = q.all(
    qb
      .selectFrom("task_events")
      .selectAll()
      .where(within("task_id", [...inventory.tasks, ...inventory.detached_tasks]))
      .orderBy("n"),
  );
  return createHash("sha256")
    .update(JSON.stringify({ snapshot: migrationSnapshot(q, inventory, agents), messages, runs, events }))
    .digest("hex");
}

export type MigrationBackup = {
  inventory: ReturnType<typeof agentMigrationInventory>;
  at: string;
  state: "committed" | "restored";
  selected: ReturnType<typeof migrationSnapshot>;
  revision: string;
};
