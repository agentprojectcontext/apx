// What the office clock may start or look at next. Eligibility is filtered here, in SQL, before any limit: a board
// with thousands of open tasks never hides an eligible one behind the most recently active (DECISIONS.md#d-206).
import { sql as raw } from "kysely";
import { qb, type Sql } from "./sql.ts";

const PRIORITY = raw<number>`case tasks.priority when 'urgent' then 0 when 'high' then 1 when 'normal' then 2 else 3 end`;
/** When the task was last given to its agent: its creation with one, or the last assignment. */
const ASSIGNED_AT = raw<string>`(select e.at from task_events e where e.task_id = tasks.id and e.op in ('assign', 'create')
  and json_type(e.data, '$.assignee') = 'text' order by e.n desc limit 1)`;

/** Open work an agent could begin now: described, not proposed or in review, its agent known, no chat yet, not held. */
function startable(held: readonly string[]) {
  return qb
    .selectFrom("tasks")
    .select("tasks.id")
    .where("tasks.state", "=", "open")
    .where("tasks.proposed", "=", 0)
    .where("tasks.status", "!=", "review")
    .where(raw<string>`trim(tasks.description)`, "!=", "")
    .where((eb) => eb.exists(eb.selectFrom("agents").select("agents.id").whereRef("agents.id", "=", "tasks.assignee")))
    .where((eb) =>
      eb.not(eb.exists(eb.selectFrom("threads").select("threads.id").whereRef("threads.task_id", "=", "tasks.id"))),
    )
    .where(raw<boolean>`tasks.id not in (select value from json_each(${JSON.stringify(held)}))`);
}

export function taskLanesRepo({ all }: Sql) {
  return {
    /** Tasks whose start time came and whose work never began, the longest waiting first. */
    scheduled(at: string, held: readonly string[], limit: number): string[] {
      return all(
        startable(held)
          .where("tasks.start_at", "is not", null)
          .where("tasks.start_at", "<=", at)
          .orderBy("tasks.start_at")
          .orderBy("tasks.id")
          .limit(limit),
      ).map((r) => r.id);
    },
    /** Tasks given to an agent since `since` that never began, the most pressing first (priority, nearest due date). */
    unstarted(since: string, at: string, held: readonly string[], limit: number): string[] {
      return all(
        startable(held)
          .where((eb) => eb.or([eb("tasks.start_at", "is", null), eb("tasks.start_at", "<=", at)]))
          .where(ASSIGNED_AT, ">=", since)
          .orderBy(PRIORITY)
          .orderBy(raw`tasks.due_at is null`)
          .orderBy("tasks.due_at")
          .orderBy("tasks.id")
          .limit(limit),
      ).map((r) => r.id);
    },
    /**
     * Tasks in progress with an agent and no open subtask, after `after` in id order: the stall check walks them a page
     * at a time, so each is looked at whatever its activity.
     */
    inProgress(after: string, limit: number): string[] {
      return all(
        qb
          .selectFrom("tasks")
          .select("tasks.id")
          .where("tasks.state", "=", "open")
          .where("tasks.status", "=", "doing")
          .where("tasks.awaits_owner", "=", 0)
          .where("tasks.proposed", "=", 0)
          .where("tasks.id", ">", after)
          .where((eb) =>
            eb.exists(eb.selectFrom("agents").select("agents.id").whereRef("agents.id", "=", "tasks.assignee")),
          )
          .where((eb) =>
            eb.not(
              eb.exists(
                eb
                  .selectFrom("tasks as child")
                  .select("child.id")
                  .whereRef("child.parent_id", "=", "tasks.id")
                  .where("child.state", "=", "open"),
              ),
            ),
          )
          .orderBy("tasks.id")
          .limit(limit),
      ).map((r) => r.id);
    },
  };
}
