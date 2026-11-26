import { badRequest } from "../errors.ts";
import { decodeMigrationBackup, encodeMigrationBackup } from "./agent-migration-codec.ts";
import { migrationContext } from "./agent-migration-context.ts";
import { suspendMigrationGrants } from "./agent-migration-grants.ts";
import { agentMigrationInventory } from "./agent-migration-inventory.ts";
import { type MigrationBackup, migrationRevision, migrationSnapshot } from "./agent-migration-snapshot.ts";
import { revokeContactProjectReading } from "./contact-project-permission.ts";
import { projectProtectionRepo } from "./project-protection.ts";
import { newId, now, qb, type Sql } from "./sql.ts";

type Inventory = ReturnType<typeof agentMigrationInventory>;

export function agentMigrationReceipt(q: Sql, id: string) {
  const row = q.one(qb.selectFrom("meta").select("value").where("key", "=", `agent-migration:${id}`));
  if (!row) return undefined;
  const backup = decodeMigrationBackup(row.value) as MigrationBackup;
  return { id, state: backup.state, at: backup.at, inventory: backup.inventory };
}

/** A synchronous commit keeps new runs and memory capture out of a half-moved graph. */
export function commitAgentMigration(q: Sql, inventory: Inventory, id = newId("migration")) {
  return q.tx(() => {
    const live = agentMigrationInventory(q, inventory.agent, inventory.destination);
    if (live.revision !== inventory.revision) throw badRequest("The inventory changed; preview the move again");
    if (live.blockers.length) throw badRequest("Resolve the move's blockers before continuing");
    const at = now();
    const threads = new Set(live.threads);
    const tasks = new Set(live.tasks);
    const selected = migrationSnapshot(q, live);
    revokeContactProjectReading(q, live.agent);
    q.run(qb.updateTable("agents").set({ project_id: live.destination, parent: null }).where("id", "=", live.agent));
    for (const a of selected.agents)
      if (a.id !== live.agent) q.run(qb.updateTable("agents").set({ parent: null }).where("id", "=", a.id));
    for (const task of selected.tasks) {
      if (!tasks.has(task.id)) {
        q.run(qb.updateTable("tasks").set({ parent_id: null, updated_at: at }).where("id", "=", task.id));
        q.run(
          qb.insertInto("task_events").values({
            task_id: task.id,
            op: "update",
            by: "owner",
            data: JSON.stringify({ migration: id, parent_id: null }),
            at,
          }),
        );
        continue;
      }
      q.run(
        qb
          .updateTable("tasks")
          .set({
            project_id: live.destination,
            assignee: task.assignee === live.agent ? live.agent : null,
            reviewer: task.reviewer === live.agent ? live.agent : null,
            parent_id: task.parent_id && tasks.has(task.parent_id) ? task.parent_id : null,
            updated_at: at,
          })
          .where("id", "=", task.id),
      );
      q.run(
        qb.insertInto("task_events").values({
          task_id: task.id,
          op: "update",
          by: "owner",
          data: JSON.stringify({ migration: id, project_id: live.destination }),
          at,
        }),
      );
    }
    // History keeps its authors; membership and return addresses no longer grant the old team access.
    for (const thread of selected.threads) {
      q.run(
        qb
          .updateTable("threads")
          .set({
            project_id: live.destination,
            agent_ids: JSON.stringify([live.agent]),
            parent_id: thread.parent_id && threads.has(thread.parent_id) ? thread.parent_id : null,
            cwd: null,
            session: null,
            context: JSON.stringify(migrationContext(JSON.parse(thread.context))),
            state: "idle",
            updated_at: at,
          })
          .where("id", "=", thread.id),
      );
      q.run(qb.updateTable("model_log").set({ archived: 1 }).where("thread_id", "=", thread.id));
      q.run(qb.deleteFrom("harness_sessions").where("thread_id", "=", thread.id));
      q.run(
        qb
          .updateTable("memory_work")
          .set({ project_id: live.destination, updated_at: at })
          .where("thread_id", "=", thread.id),
      );
      q.run(
        qb
          .updateTable("memory_work")
          .set({ state: "failed", error: "Retired by project migration", lease_until: null, updated_at: at })
          .where("thread_id", "=", thread.id)
          .where("state", "=", "pending"),
      );
      q.run(qb.updateTable("memory_episodes").set({ project_id: live.destination }).where("thread_id", "=", thread.id));
    }
    for (const thread of selected.detached_threads)
      q.run(
        qb
          .updateTable("threads")
          .set({
            agent_ids: JSON.stringify((JSON.parse(thread.agent_ids) as string[]).filter((id) => id !== live.agent)),
            updated_at: at,
          })
          .where("id", "=", thread.id),
      );
    for (const memory of selected.memories)
      q.run(
        qb
          .updateTable("memories")
          .set({
            project_id: live.destination,
            ...(memory.scope === "global" ? { scope: "project" } : {}),
            ...(memory.scope === "agent" ? { agent_id: live.agent } : {}),
          })
          .where("id", "=", memory.id),
      );
    for (const exclusion of selected.memory_exclusions)
      q.run(
        qb
          .updateTable("memory_exclusions")
          .set({ project_id: live.destination })
          .where("memory_id", "=", exclusion.memory_id),
      );
    for (const routine of selected.routines)
      q.run(qb.updateTable("routines").set({ project_id: live.destination, enabled: 0 }).where("id", "=", routine.id));
    for (const surface of selected.surfaces)
      q.run(qb.updateTable("surfaces").set({ project_id: live.destination }).where("id", "=", surface.id));
    suspendMigrationGrants(q, live);
    projectProtectionRepo(q).protect(id, live.destination);
    const backup: MigrationBackup = {
      inventory: live,
      at,
      state: "committed",
      selected,
      revision: migrationRevision(
        q,
        live,
        selected.agents.map((a) => a.id),
      ),
    };
    q.run(qb.insertInto("meta").values({ key: `agent-migration:${id}`, value: encodeMigrationBackup(backup) }));
    return { id, at, inventory: live };
  });
}
