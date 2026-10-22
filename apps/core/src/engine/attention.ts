// What reaches the attention tray. Questions an agent asks the owner are noticed from the bus; they and tasks waiting
// for the owner leave the tray once answered or moved on. A turn that ends or fails in one of the owner's chats is
// noticed when the chat is still unread a moment later (nobody was looking). Routines, channels and tasks add their own.
import type { CoreEvent } from "@apx/protocol";
import type { Bus } from "../bus.ts";
import type { Store } from "../domain/store.ts";
import { previewOf } from "../domain/threads.ts";
import { audienceOf } from "./audience.ts";
import { droppedWords } from "./owner-words.ts";
import { droppedResult, silent } from "./run-outcome.ts";

/** How long an open chat has to mark a finished turn read before it counts as unseen. */
const UNSEEN_AFTER_MS = 5000;
/** Chats whose turns reach the owner some other way: a routine's news, a delegation's result, a contact's chat. */
const QUIET_KINDS = new Set(["routine", "a2a"]);

export function createAttention(deps: { store: Store; bus: Bus; now?: () => Date; unseenAfterMs?: number }) {
  const { store } = deps;
  const clock = deps.now ?? (() => new Date());
  const timers = new Set<ReturnType<typeof setTimeout>>();
  /** Runs already looked at: a run may report its end more than once. */
  const ended = new Set<string>();

  /** A turn ended in the owner's chat: if it is still unread in a moment, the tray (and their phone) hears of it. */
  function runEnded(runId: string): void {
    const run = store.runs.get(runId);
    if (!run || (run.state !== "completed" && run.state !== "failed") || run.trigger === "surface") return;
    // An answer to a channel message already went to that channel; a provider limit is told once per stall.
    if (run.input?.origin?.kind === "channel" || run.end_reason === "provider_limit") return;
    const thread = store.threads.get(run.thread_id);
    if (!thread || QUIET_KINDS.has(thread.kind) || audienceOf(store, thread).kind !== "owner") return;
    const dropped = droppedResult(store, run);
    if (ended.has(run.id)) return;
    ended.add(run.id);
    if (ended.size > 500) ended.delete(ended.values().next().value ?? "");
    const timer = setTimeout(() => {
      timers.delete(timer);
      const now = store.threads.get(thread.id);
      if (!now?.unread) return;
      // A result turn that said nothing and was tried once more (engine `retryDropped`): the retry reports.
      if (dropped && store.runs.list(thread.id, 5).some((r) => r.input?.retry_of === run.id)) return;
      const failed = run.state === "failed";
      const origin = run.input?.origin;
      const from = origin?.kind === "delegation_result" || origin?.kind === "task_result" ? origin.name : undefined;
      store.notifications.add({
        kind: "run",
        // A turn that ended without a word or an action is not a finished one: the owner should look.
        level: failed ? "error" : silent(store, run) ? "warn" : "info",
        title: store.agents.get(run.agent_id)?.name ?? now.title,
        body: previewOf(
          failed ? (run.error ?? now.preview) : dropped && from ? droppedWords(store, from) : now.preview,
        ),
        thread_id: thread.id,
        // One unread notice per chat: the latest turn replaces the one before.
        ref: thread.id,
      });
    }, deps.unseenAfterMs ?? UNSEEN_AFTER_MS);
    timer.unref?.();
    timers.add(timer);
  }

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
    } else if (e.type === "run.updated") {
      runEnded(e.run.id);
    } else if (e.type === "task.updated") {
      // Raised when a task starts waiting; later updates only clear it once it stops.
      const t = e.task;
      if (!t.awaits_owner || t.state !== "open") store.notifications.resolve("task", t.id);
      if (t.status !== "review" || t.state !== "open") store.notifications.resolve("task", `review:${t.id}`);
      // Done, dropped or moved to a later date: the reminder is moot.
      if (t.state !== "open" || !t.due_at || t.due_at > clock().toISOString()) store.notifications.resolve("due", t.id);
    }
  }

  const off = deps.bus.on(onEvent);
  return {
    add: store.notifications.add,
    stop: () => {
      off();
      for (const t of timers) clearTimeout(t);
      timers.clear();
    },
  };
}

export type Attention = ReturnType<typeof createAttention>;
