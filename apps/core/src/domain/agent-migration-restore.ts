import { badRequest, notFound } from "../errors.ts";
import { decodeMigrationBackup, encodeMigrationBackup } from "./agent-migration-codec.ts";
import { restoreMigrationGrants } from "./agent-migration-grants.ts";
import { type MigrationBackup, migrationRevision } from "./agent-migration-snapshot.ts";
import { projectProtectionRepo } from "./project-protection.ts";
import { now, qb, type Sql } from "./sql.ts";

export function checkedMigrationRecovery(q: Sql, id: string): MigrationBackup {
  const row = q.one(qb.selectFrom("meta").select("value").where("key", "=", `agent-migration:${id}`));
  if (!row) throw notFound("migration backup");
  const backup = decodeMigrationBackup(row.value) as MigrationBackup;
  if (backup.state === "restored") return backup;
  if (backup.state !== "committed" || !backup.selected || !backup.inventory)
    throw badRequest("Invalid migration backup");
  if (
    migrationRevision(
      q,
      backup.inventory,
      backup.selected.agents.map((a) => a.id),
    ) !== backup.revision
  )
    throw badRequest("Work changed after the move; automatic recovery would overwrite it");
  return backup;
}

/** Restores only the selected graph, and only before new work has changed it. */
export function restoreAgentMigration(q: Sql, id: string) {
  return q.tx(() => {
    const key = `agent-migration:${id}`;
    const backup = checkedMigrationRecovery(q, id);
    if (backup.state === "restored") return { id, restored: true as const };
    const selected = backup.selected;
    restoreMigrationGrants(q, selected.grants);
    projectProtectionRepo(q).restore(id);
    for (const a of selected.agents) q.run(qb.updateTable("agents").set(a).where("id", "=", a.id));
    for (const t of selected.tasks) q.run(qb.updateTable("tasks").set(t).where("id", "=", t.id));
    for (const t of selected.detached_threads) q.run(qb.updateTable("threads").set(t).where("id", "=", t.id));
    for (const t of selected.threads) q.run(qb.updateTable("threads").set(t).where("id", "=", t.id));
    for (const m of selected.memories) q.run(qb.updateTable("memories").set(m).where("id", "=", m.id));
    for (const r of selected.routines) q.run(qb.updateTable("routines").set(r).where("id", "=", r.id));
    for (const s of selected.surfaces) q.run(qb.updateTable("surfaces").set(s).where("id", "=", s.id));
    for (const w of selected.memory_work) q.run(qb.updateTable("memory_work").set(w).where("id", "=", w.id));
    for (const e of selected.memory_episodes)
      q.run(qb.updateTable("memory_episodes").set(e).where("rowid", "=", e.rowid));
    for (const e of selected.memory_exclusions)
      q.run(qb.updateTable("memory_exclusions").set(e).where("memory_id", "=", e.memory_id));
    for (const entry of selected.model_log)
      q.run(
        qb
          .updateTable("model_log")
          .set({ archived: entry.archived })
          .where("thread_id", "=", entry.thread_id)
          .where("seq", "=", entry.seq),
      );
    if (selected.harness_sessions.length) q.run(qb.insertInto("harness_sessions").values(selected.harness_sessions));
    for (const t of selected.tasks)
      q.run(
        qb.insertInto("task_events").values({
          task_id: t.id,
          at: now(),
          op: "update",
          by: "owner",
          data: JSON.stringify({ migration: id, restored: true, project_id: t.project_id }),
        }),
      );
    q.run(
      qb
        .updateTable("meta")
        .set({ value: encodeMigrationBackup({ ...backup, state: "restored" }) })
        .where("key", "=", key),
    );
    return { id, restored: true as const };
  });
}
