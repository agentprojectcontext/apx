// Which notices make a sound on this device. Pure, so node:test covers it (sounds.ts plays them).
import type { NotificationKind } from "@apx/protocol";

/** Which notices make a sound: the ones asking for something, the ones telling something, both, or none. */
export type NoticeSound = "all" | "requests" | "messages" | "off";

/** What waits for the owner's own action: an agent's question or OK, a task, something due. */
const REQUESTS: ReadonlySet<NotificationKind> = new Set(["input", "task", "due"]);

export function soundsFor(kind: NotificationKind, mode: NoticeSound): boolean {
  if (mode === "all") return true;
  if (mode === "off") return false;
  return REQUESTS.has(kind) === (mode === "requests");
}
