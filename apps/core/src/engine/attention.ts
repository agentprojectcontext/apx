// What reaches the attention tray. Questions an agent asks the owner and tasks waiting for them are noticed from the
// bus, and leave the tray once answered or moved on; routines and channels add their own notices.
import type { CoreEvent } from "@apx/protocol";
import type { Bus } from "../bus.ts";
import type { Store } from "../domain/store.ts";
import { previewOf } from "../domain/threads.ts";
import { audienceOf } from "./audience.ts";

export function createAttention(deps: { store: Store; bus: Bus }) {
  const { store } = deps;

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
      if (e.task.awaits_owner && e.task.state === "open")
        store.notifications.add({ kind: "task", title: e.task.title, thread_id: e.task.thread_id, ref: e.task.id });
      else store.notifications.resolve("task", e.task.id);
    }
  }

  const off = deps.bus.on(onEvent);
  return {
    add: store.notifications.add,
    stop: off,
  };
}

export type Attention = ReturnType<typeof createAttention>;
