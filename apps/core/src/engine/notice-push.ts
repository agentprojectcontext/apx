// Every tray notice also reaches the owner's phones with the app closed: the app is where APX always tells them, whatever
// chat app they also picked (DECISIONS.md#d-161). In quiet hours only what needs them now: a question, an error.
import type { CoreEvent, Notification } from "@apx/protocol";
import type { Bus } from "../bus.ts";
import { quietNow } from "../domain/notices.ts";
import type { Store } from "../domain/store.ts";
import type { Push } from "../services/push.ts";

const urgent = (n: Notification) => n.kind === "input" || n.level === "error";

export function createNoticePush(deps: { store: Store; bus: Bus; push: Push; now?: () => Date }) {
  /** Notice versions already pushed: an update that changes nothing (or marks it read) is not news. */
  const pushed = new Set<string>();

  function onEvent(e: CoreEvent): void {
    if (e.type !== "notification.updated") return;
    const n = e.notification;
    if (n.read_at || (!urgent(n) && quietNow(deps.store, deps.now?.()))) return;
    const key = `${n.id}:${n.created_at}`;
    if (pushed.has(key)) return;
    pushed.add(key);
    if (pushed.size > 500) pushed.delete(pushed.values().next().value ?? "");
    for (const device of deps.store.devices.list()) {
      const target = deps.store.devices.pushTarget(device.id);
      if (!target) continue;
      void deps.push(target, {
        title: n.title,
        body: n.body.slice(0, 3500),
        data: { source: "apx-notice", notice_id: n.id, ...(n.thread_id ? { thread_id: n.thread_id } : {}) },
      });
    }
  }

  return { stop: deps.bus.on(onEvent) };
}
