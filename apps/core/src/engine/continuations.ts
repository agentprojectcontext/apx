import type { ChatContinuation } from "@apx/protocol";
import { continuationAuthority, continuationNotice } from "../domain/continuation-scope.ts";
import { type RunRecord, TERMINAL } from "../domain/runs.ts";
import type { Store } from "../domain/store.ts";
import type { AdmitFn } from "./engine.ts";
import { answerOf } from "./run-outcome.ts";

const CATCH_UP_MS = 15 * 60_000;

/** Uses the office clock and the durable run queue; waiting never holds a turn open. */
export function tickContinuations(store: Store, admit: AdmitFn, at: Date): void {
  const finish = (item: ChatContinuation, state: ChatContinuation["state"], reason: string, code: string = state) =>
    store.tx(() => {
      if (!store.continuations.change(item.id, item.state, state, { reason })) return;
      continuationNotice(store, { ...item, state }, code, `${item.purpose}: ${reason}`, { reason });
    });
  for (const item of store.continuations.list(undefined, true)) {
    if (item.state === "admitted") {
      const run = item.run_id ? store.runs.get(item.run_id) : undefined;
      if (!run) finish(item, "failed", "The execution could not be found. I did not retry it.");
      else if (TERMINAL.has(run.state)) {
        finishContinuation(store, run);
      }
      continue;
    }
    if (Date.parse(item.expires_at) <= at.getTime()) {
      finish(item, "expired", "The request expired before I could return. I did not start it.");
      continue;
    }
    const saved = store.continuations.get(item.id);
    if (!saved || continuationAuthority(store, item.thread_id, item.agent_id) !== saved.authority) {
      finish(item, "blocked", "The chat, agent or project settings changed. Ask again if you still want this check.");
      continue;
    }
    const condition = item.condition;
    if (condition.kind === "time") {
      if (Date.parse(condition.at) > at.getTime()) continue;
      if (at.getTime() - Date.parse(condition.at) > CATCH_UP_MS) {
        finish(item, "expired", "The requested time passed more than 15 minutes ago. I did not start a late check.");
        continue;
      }
    } else {
      const task = store.tasks.get(condition.task);
      if (!task || task.project_id !== item.project_id || task.state === "dropped") {
        finish(item, "blocked", "The task was removed, moved or dropped. I could not confirm completion.", "task");
        continue;
      }
      if (task.state !== "done") continue;
    }
    const thread = store.threads.get(item.thread_id);
    // Do not add an unbounded automatic queue behind the owner's current work.
    if (
      !thread ||
      thread.state === "working" ||
      thread.state === "submitted" ||
      thread.state === "queued" ||
      thread.state === "input-required" ||
      store.runs.nextQueued(item.thread_id)
    )
      continue;
    try {
      store.tx(() => {
        if (!store.continuations.change(item.id, "pending", "admitted")) return;
        const run = admit({
          thread_id: item.thread_id,
          agent_id: item.agent_id,
          trigger: "system",
          origin: { kind: "continuation", id: item.id },
          reply_to: store.threads.context(item.thread_id).reply_to ?? null,
          text: item.purpose,
        });
        store.continuations.change(item.id, "admitted", "admitted", { run_id: run.id });
        continuationNotice(
          store,
          item,
          "started",
          `I'm back for “${item.purpose}”. I'll leave the result or what prevented it in this chat.`,
        );
      });
    } catch {
      finish(item, "blocked", "The agent could not start this check. Ask again when it is available.", "unavailable");
    }
  }
}

export function finishContinuation(store: Store, run: RunRecord): void {
  const origin = run.input?.origin;
  if (origin?.kind !== "continuation" || !TERMINAL.has(run.state)) return;
  const item = store.continuations.get(origin.id)?.value;
  if (item?.state !== "admitted" || item.run_id !== run.id) return;
  const state = run.state === "completed" && answerOf(store, run) ? "completed" : "failed";
  const reason =
    state === "completed"
      ? "The check finished in this chat."
      : "The check stopped or gave no answer. See its result in this chat; I did not retry it.";
  store.tx(() => {
    if (!store.continuations.change(item.id, "admitted", state, { reason })) return;
    continuationNotice(store, { ...item, state }, state, `${item.purpose}: ${reason}`);
  });
}

export function continuationCanStart(store: Store, run: RunRecord, at: Date): boolean {
  const origin = run.input?.origin;
  if (origin?.kind !== "continuation") return true;
  const saved = store.continuations.get(origin.id);
  const item = saved?.value;
  const condition = item?.condition;
  const task = condition?.kind === "task_done" ? store.tasks.get(condition.task) : undefined;
  const ready =
    condition?.kind === "time"
      ? Date.parse(condition.at) <= at.getTime() && at.getTime() - Date.parse(condition.at) <= CATCH_UP_MS
      : task?.state === "done" && task.project_id === item?.project_id;
  if (
    ready &&
    item?.state === "admitted" &&
    item.run_id === run.id &&
    Date.parse(item.expires_at) > at.getTime() &&
    continuationAuthority(store, run.thread_id, run.agent_id) === saved?.authority
  )
    return true;
  if (item?.state === "admitted") {
    store.continuations.change(item.id, "admitted", "blocked", {
      reason: "No longer authorized or expired before execution",
    });
    continuationNotice(
      store,
      { ...item, state: "blocked" },
      "blocked",
      "This check expired or its access changed before it could start. Nothing was started.",
    );
  }
  store.threads.patch(run.thread_id, { state: "idle" });
  return false;
}
