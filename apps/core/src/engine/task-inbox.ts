// The owner's comment on a task that names no one still reaches someone: after a short pause (so a few comments go
// together) the office clock hands it to the task's agent in its chat for the task, or to the super-agent when nobody
// has the task. The comment shows how far it got, as a channel message does: sent, handed to an agent, read. A turn
// that answers the owner (this hand-off, an @mention, words written in the task) posts its answer back on the task.
import type { Task } from "@apx/protocol";
import type { RunRecord } from "../domain/runs.ts";
import type { Store } from "../domain/store.ts";
import type { AdmitFn } from "./engine.ts";
import { ask } from "./task-work.ts";

/** How long an owner's comment waits before it is handed on, so the next ones join it. */
export const COMMENT_PAUSE_MS = 60_000;

/** Marks the owner's comment as sent and waiting for an agent (an open task only: a closed one has nobody on it). */
export function awaitAgent(store: Store, task: Task, messageId: string): void {
  if (task.state !== "open") return;
  store.messages.setDelivery(messageId, "sent");
  const waiting = store.threads.context(task.thread_id).owner_unread ?? [];
  store.threads.mergeContext(task.thread_id, { owner_unread: [...waiting, messageId].slice(-20) });
}

/**
 * A turn of the task's agent that answers the owner: its answer comes back on the task, and the owner's comments still
 * waiting go with it (marked delivered) so the clock does not hand them again.
 */
export function answersOwner(store: Store, task: Task, run: RunRecord): void {
  const ctx = store.threads.context(task.thread_id);
  const messages = ctx.owner_unread ?? [];
  for (const id of messages) store.messages.setDelivery(id, "delivered");
  store.threads.mergeContext(task.thread_id, {
    owner_unread: undefined,
    owner_handed: [...(ctx.owner_handed ?? []), { run: run.id, messages }].slice(-20),
  });
}

/**
 * A turn in the task's chat ended: whether it was answering the owner (its answer goes on the task). Comments it was
 * handed are read once it completes; a turn that failed or was canceled leaves them delivered.
 */
export function ownerTurnEnded(store: Store, task: Task, run: RunRecord): boolean {
  const handed = store.threads.context(task.thread_id).owner_handed ?? [];
  // A turn picked up after a restart, or tried again, answers for the one it replaces.
  const ids = new Set([run.id, run.input?.resume_of, run.input?.retry_of].filter(Boolean));
  const mine = handed.find((h) => ids.has(h.run));
  if (!mine) return false;
  if (run.state === "completed") for (const id of mine.messages) store.messages.setDelivery(id, "read");
  store.threads.mergeContext(task.thread_id, { owner_handed: handed.filter((h) => h !== mine) });
  return run.state === "completed";
}

const NOBODY_ON_IT =
  "This task has nobody on it. If the comment asks for something, do it: give the task to the right agent, answer, or plan it. If nothing is needed, say so in one line.";

/** Hands each task's waiting owner comments to its agent once the newest is past the pause; returns how many tasks. */
export function handOwnerComments(store: Store, admit: AdmitFn, now: Date): number {
  let handed = 0;
  for (const threadId of store.threads.unreadByAgents()) {
    const task = store.tasks.byThread(threadId);
    const comments = (store.threads.context(threadId).owner_unread ?? []).flatMap((id) => store.messages.get(id) ?? []);
    const newest = comments.at(-1)?.created_at;
    if (task?.state === "open" && newest && now.getTime() - Date.parse(newest) < COMMENT_PAUSE_MS) continue;
    const assignee = task?.assignee && store.agents.get(task.assignee) ? task.assignee : undefined;
    const agent = assignee ?? store.agents.list().find((a) => a.kind === "secretary")?.id;
    if (!task || task.state !== "open" || !comments.length || !agent) {
      store.threads.mergeContext(threadId, { owner_unread: undefined });
      continue;
    }
    const words = comments
      .map((m) => m.parts.flatMap((p) => (p.type === "text" ? [p.text] : [])).join("\n"))
      .filter(Boolean)
      .join("\n\n");
    const text = `The owner commented on the task:\n${words}${assignee ? "" : `\n\n${NOBODY_ON_IT}`}`;
    store.tx(() =>
      answersOwner(store, task, ask(store, admit, task, agent, text, { kind: "owner" }, { kind: "user" })),
    );
    handed++;
  }
  return handed;
}
