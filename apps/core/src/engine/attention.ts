// What reaches the attention tray. Questions an agent asks the owner are noticed from the bus; they and tasks waiting
// for the owner leave the tray once answered or moved on. Routines, channels and tasks add their own notices.
import type { CoreEvent } from "@apx/protocol";
import type { Bus } from "../bus.ts";
import type { Store } from "../domain/store.ts";
import { previewOf } from "../domain/threads.ts";
import { audienceOf } from "./audience.ts";

export function createAttention(deps: { store: Store; bus: Bus; now?: () => Date }) {
  const { store } = deps;
  const clock = deps.now ?? (() => new Date());

  function onEvent(e: CoreEvent): void {
    if (e.type === "message.part" && e.part.type === "input") {
      if (e.part.state !== "pending") {
        store.notifications.resolve("input", e.part.input_id);
        return;
      }
      const thread = store.threads.get(e.thread_id);
      if (!thread || audienceOf(store, thread).kind !== "owner") return;
      const agentId = store.messages.get(e.message_id)?.author;
      const agent = agentId?.kind === "agent" ? store.agents.get(agentId.id) : undefined;
      store.notifications.add({
        kind: "input",
        level: "warn",
        title: agent?.name ?? thread.title,
        body: previewOf([e.part.prompt, e.part.detail].filter(Boolean).join(" — ")),
        thread_id: thread.id,
        ref: e.part.input_id,
      });
    } else if (e.type === "task.updated") {
      // Raised when a task starts waiting; later updates only clear it once it stops.
      const t = e.task;
      if (!t.awaits_owner || t.state !== "open") store.notifications.resolve("task", t.id);
      // Done, dropped or moved to a later date: the reminder is moot.
      if (t.state !== "open" || !t.due_at || t.due_at > clock().toISOString()) store.notifications.resolve("due", t.id);
    }
  }

  const off = deps.bus.on(onEvent);
  return {
    add: store.notifications.add,
    stop: off,
  };
}

export type Attention = ReturnType<typeof createAttention>;
