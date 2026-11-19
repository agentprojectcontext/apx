import { qb, type Sql } from "./sql.ts";

/** Task participation includes former assignees and consultations, not only the task's current assignee. */
export function migrationWork(q: Sql, source: string, agent: string) {
  const threads = q.all(qb.selectFrom("threads").selectAll());
  const tasks = q.all(qb.selectFrom("tasks").selectAll().where("project_id", "=", source));
  const authored = new Set(
    q.all(qb.selectFrom("task_events").select("task_id").where("by", "=", agent)).map((r) => r.task_id),
  );
  const ran = new Set(
    q.all(qb.selectFrom("runs").select("thread_id").where("agent_id", "=", agent)).map((r) => r.thread_id),
  );
  const involved = (t: (typeof threads)[number]) =>
    (JSON.parse(t.agent_ids) as string[]).includes(agent) || ran.has(t.id);
  const taskIds = new Set(
    tasks
      .filter(
        (t) =>
          t.assignee === agent ||
          t.reviewer === agent ||
          t.created_by === agent ||
          authored.has(t.id) ||
          threads.some(
            (c) => (c.task_id === t.id || c.id === t.thread_id || c.parent_id === t.thread_id) && involved(c),
          ),
      )
      .map((t) => t.id),
  );
  const dedicated = (t: (typeof threads)[number]) => {
    const members = JSON.parse(t.agent_ids) as string[];
    return (
      !!t.task_id ||
      members.every(
        (id) =>
          id === agent || q.one(qb.selectFrom("agents").select("kind").where("id", "=", id))?.kind === "secretary",
      )
    );
  };
  const threadIds = new Set(
    threads.filter((t) => t.project_id === source && involved(t) && dedicated(t)).map((t) => t.id),
  );
  for (const t of tasks) if (taskIds.has(t.id)) threadIds.add(t.thread_id);
  // Descendants travel, never an unrelated caller's whole parent chat.
  let added = true;
  while (added) {
    added = false;
    for (const task of tasks) {
      if (
        !taskIds.has(task.id) &&
        threads.some((t) => threadIds.has(t.id) && (t.task_id === task.id || t.id === task.thread_id))
      ) {
        taskIds.add(task.id);
        threadIds.add(task.thread_id);
        added = true;
      }
    }
    for (const t of threads) {
      if (
        !threadIds.has(t.id) &&
        ((t.task_id && taskIds.has(t.task_id)) || (t.parent_id && threadIds.has(t.parent_id)))
      ) {
        threadIds.add(t.id);
        added = true;
      }
    }
  }
  return {
    threads,
    taskIds,
    threadIds,
    selectedThreads: threads.filter((t) => threadIds.has(t.id)),
    selectedTasks: tasks.filter((t) => taskIds.has(t.id)),
    detachedTasks: tasks.filter((t) => !taskIds.has(t.id) && !!t.parent_id && taskIds.has(t.parent_id)),
    detachedThreads: threads.filter(
      (t) => !threadIds.has(t.id) && (JSON.parse(t.agent_ids) as string[]).includes(agent),
    ),
  };
}
