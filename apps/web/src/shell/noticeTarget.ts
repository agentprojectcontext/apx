// Which task a notice is about: its ref is the task's id, or "review:<id>" for one ready for the owner to review.
import type { Notification } from "@apx/protocol";

export function noticeTask(n: Pick<Notification, "kind" | "ref">): string | undefined {
  if (n.kind !== "task" && n.kind !== "due") return undefined;
  const id = n.ref?.replace(/^review:/, "");
  return id?.startsWith("task_") ? id : undefined;
}
