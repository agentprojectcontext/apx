import type { Task } from "@apx/protocol";
import type { Store } from "./store.ts";

/** A waiting task is noticed once; subsequent edits keep its read state. */
export function noticeTaskWaiting(store: Store, task: Task, waiting: boolean, body = ""): void {
  if (waiting && !task.awaits_owner && task.state === "open")
    store.notifications.add({ kind: "task", title: task.title, body, thread_id: task.thread_id, ref: task.id });
}
