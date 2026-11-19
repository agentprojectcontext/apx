import { badRequest } from "../errors.ts";
import { decodeMigrationBackup, encodeMigrationBackup } from "./agent-migration-codec.ts";
import { type MigrationBackup, migrationRevision } from "./agent-migration-snapshot.ts";
import { qb, type Sql } from "./sql.ts";

/** Called inside the move transaction after APC has mirrored the staged definitions. */
export function sealAgentMigration(q: Sql, id: string) {
  const key = `agent-migration:${id}`;
  const row = q.one(qb.selectFrom("meta").select("value").where("key", "=", key));
  if (!row) throw badRequest("No committed project move to finalize");
  const backup = decodeMigrationBackup(row.value) as MigrationBackup;
  if (backup.state !== "committed") throw badRequest("This move is not committed");
  const revision = migrationRevision(
    q,
    backup.inventory,
    backup.selected.agents.map((a) => a.id),
  );
  q.run(
    qb
      .updateTable("meta")
      .set({ value: encodeMigrationBackup({ ...backup, revision }) })
      .where("key", "=", key),
  );
}
