import { migrationWork } from "./agent-migration-scope.ts";
import { qb, type Sql } from "./sql.ts";

/** Recovery also notices work created after the original inventory, not only edits to its old rows. */
export function migrationOwnedWork(q: Sql, agent: string, project: string) {
  const work = migrationWork(q, project, agent);
  const ids = <T extends { id: string }>(rows: T[]) => rows.map((row) => row.id).sort();
  return {
    threads: [...work.threadIds].sort(),
    tasks: [...work.taskIds].sort(),
    runs: ids(q.all(qb.selectFrom("runs").select("id").where("agent_id", "=", agent))),
    memories: ids(
      q
        .all(qb.selectFrom("memories").select(["id", "agent_id", "thread_id"]))
        .filter((row) => row.agent_id === agent || (!!row.thread_id && work.threadIds.has(row.thread_id))),
    ),
    surfaces: ids(
      q
        .all(qb.selectFrom("surfaces").select(["id", "created_by", "thread_id"]))
        .filter((row) => row.created_by === agent || (!!row.thread_id && work.threadIds.has(row.thread_id))),
    ),
    routines: ids(q.all(qb.selectFrom("routines").select("id").where("agent_id", "=", agent))),
  };
}
