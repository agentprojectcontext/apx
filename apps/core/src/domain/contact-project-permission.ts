import { sql } from "kysely";
import { qb, type Sql } from "./sql.ts";

/** A project move must not carry the former project's authorization into the new one. */
export function revokeContactProjectReading(q: Pick<Sql, "run">, agentId: string) {
  q.run(
    qb
      .updateTable("persons")
      .set({ perms: sql<string>`json_set(perms, '$.project_reading', json('false'))` })
      .where("agent_id", "=", agentId)
      .where(sql<boolean>`json_extract(perms, '$.project_reading') = 1`),
  );
}
