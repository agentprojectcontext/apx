import type { Task } from "@apx/protocol";
import type { Store } from "./store.ts";

/** A waiting task is noticed once; subsequent edits keep its read state. */
export function noticeTaskWaiting(store: Store, task: Task, waiting: boolean, body = ""): void {
  if (waiting && !task.awaits_owner && task.state === "open")
    store.notifications.add({ kind: "task", title: task.title, body, thread_id: task.thread_id, ref: task.id });
}

/** A task nobody is working on any more: told once per stall, in the tray, linked to its agent's chat. */
export function noticeTaskStalled(store: Store, task: Task, threadId: string, body: string): void {
  store.notifications.add({ kind: "task", level: "warn", title: task.title, body, thread_id: threadId, ref: task.id });
}

/** A task in review that is the owner's to check: told once, linked to its conversation, until it leaves review. */
export function noticeTaskReview(store: Store, task: Task, verdict?: string): void {
  const en = store.settings.get("owner_language") === "en";
  store.notifications.add({
    kind: "task",
    level: "info",
    title: task.title,
    body: verdict
      ? `${en ? "Reviewed, ready for you to close" : "Revisada, lista para que la cierres"}: ${verdict}`
      : en
        ? "Ready for you to review."
        : "Lista para que la revises.",
    thread_id: task.thread_id,
    ref: `review:${task.id}`,
  });
}

/** An agent's proposals waiting for the owner: one notice per agent, saying how many, until they are all decided. */
export function noticeTaskProposed(store: Store, task: Task): void {
  const waiting = store.tasks
    .list({ state: "open", limit: 500 })
    .filter((t) => t.proposed && t.created_by === task.created_by).length;
  const who = store.agents.get(task.created_by)?.name ?? task.created_by;
  const en = store.settings.get("owner_language") === "en";
  store.notifications.add({
    kind: "task",
    level: "info",
    title: who,
    body: en
      ? `${waiting} proposed task${waiting === 1 ? "" : "s"} to accept or drop`
      : `${waiting} tarea${waiting === 1 ? "" : "s"} propuesta${waiting === 1 ? "" : "s"} para aceptar o descartar`,
    ref: `proposals:${task.created_by}`,
  });
}
