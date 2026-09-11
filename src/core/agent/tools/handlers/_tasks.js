// Shared addressing for the task tools. See _locate.js for why an omitted
// `project` searches instead of failing.
import { getTask } from "#core/stores/tasks.js";
import { locateRecord } from "./_locate.js";

/** @returns {{project: object, task: object} | {error: string}} */
export function locateTask(projects, { project, task }) {
  const found = locateRecord(projects, {
    project,
    id: task,
    read: getTask,
    kind: "task",
    example: "t_ab12cd",
    lister: "list_tasks",
  });
  return found.error ? found : { project: found.project, task: found.record };
}

/** The children of a task, compact enough to sit inside a detail reply. */
export function subtaskRows(tasks) {
  return tasks.map((t) => ({
    id: t.id,
    title: t.title,
    state: t.state,
    status: t.status,
    ...(t.agent ? { agent: t.agent } : {}),
    ...(t.due ? { due: t.due } : {}),
  }));
}
