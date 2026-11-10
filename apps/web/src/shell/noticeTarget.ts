// Which task a notice is about: its ref is the task's id, or "review:<id>" for one ready for the owner to review. A
// calendar event's reminder names the event's series instead ("event:<series>").
import type { Notification } from "@apx/protocol";

export function noticeTask(n: Pick<Notification, "kind" | "ref">): string | undefined {
  if (n.kind !== "task" && n.kind !== "due") return undefined;
  const id = n.ref?.replace(/^review:/, "");
  return id?.startsWith("task_") ? id : undefined;
}

/** The calendar series a reminder is about, which the owner can stop being reminded of. */
export function noticeEvent(n: Pick<Notification, "kind" | "ref">): string | undefined {
  return n.kind === "due" && n.ref?.startsWith("event:") ? n.ref.slice(6) || undefined : undefined;
}
