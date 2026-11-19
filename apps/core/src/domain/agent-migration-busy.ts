import { qb, type Sql } from "./sql.ts";

export function migrationBusyBlockers(q: Sql, source: string, agent: string, threads: Set<string>) {
  const sourceThreads = new Set(
    q.all(qb.selectFrom("threads").select("id").where("project_id", "=", source)).map((t) => t.id),
  );
  const sourceAgents = new Set(
    q.all(qb.selectFrom("agents").select("id").where("project_id", "=", source)).map((a) => a.id),
  );
  const owners = new Set(q.all(qb.selectFrom("agents").select("id").where("kind", "=", "secretary")).map((a) => a.id));
  const runs = q.all(qb.selectFrom("runs").select(["agent_id", "thread_id", "ended_at"]));
  const blockers: string[] = [];
  if (
    runs.some(
      (r) => !r.ended_at && !owners.has(r.agent_id) && (sourceAgents.has(r.agent_id) || sourceThreads.has(r.thread_id)),
    )
  )
    blockers.push("active_source_work");
  if (runs.some((r) => (r.agent_id === agent || threads.has(r.thread_id)) && !r.ended_at)) blockers.push("active_run");
  if (
    q
      .all(qb.selectFrom("jobs").select(["thread_id", "ended_at"]))
      .some((j) => sourceThreads.has(j.thread_id) && !j.ended_at)
  )
    blockers.push("active_job");
  if (
    q
      .all(qb.selectFrom("memory_work").select(["agent_id", "thread_id", "project_id", "state"]))
      .some(
        (j) =>
          (j.agent_id === agent || sourceThreads.has(j.thread_id) || j.project_id === source) && j.state === "working",
      )
  )
    blockers.push("active_memory_work");
  return blockers;
}
