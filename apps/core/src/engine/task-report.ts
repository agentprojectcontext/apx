// A task an agent created and another agent closed reports back: its creator gets a turn in the chat it created the
// task from, like a delegation's result, however long the work took. See DECISIONS.md#d-076
import type { Task } from "@apx/protocol";
import type { Origin, RunRecord } from "../domain/runs.ts";
import type { Store } from "../domain/store.ts";
import { systemNote } from "../harness/native.ts";
import { pausedNotice } from "./breaker.ts";
import { frameInput } from "./context.ts";
import type { AdmitFn } from "./engine.ts";

/** How much of the closer's report its creator reads. */
const REPORT_CHARS = 4000;
const STATE_OPS = new Set(["done", "drop", "reopen"]);

/** The task's last close and its place in the task's history, while the task stays closed. */
function lastClose(store: Store, task: Task) {
  if (task.state === "open") return undefined;
  const events = store.tasks.events(task.id);
  const index = events.findLastIndex((e) => STATE_OPS.has(e.op));
  const event = events[index];
  return event && event.op !== "reopen" ? { event, index, created: events.find((e) => e.op === "create") } : undefined;
}

/** Whether `run`'s agent closed the task during that run (or during the run a restart cut off, which it picks up). */
export function closedIn(store: Store, task: Task, run: RunRecord): boolean {
  const close = lastClose(store, task);
  if (close?.event.by !== run.agent_id) return false;
  const first = run.input?.resume_of ? store.runs.get(run.input.resume_of) : undefined;
  return close.event.at >= (first?.started_at ?? run.started_at);
}

/** The closer's note and latest comment; immediate reports label comments from before the current work. */
function reportOf(store: Store, task: Task, closer: string, note: unknown, freshSince?: string): string {
  const comment = store.messages
    .list(task.thread_id, 50)
    .findLast((m) => m.author.kind === "agent" && m.author.id === closer);
  const said = comment?.parts
    .map((p) => (p.type === "text" ? p.text : ""))
    .join("\n")
    .trim();
  const stale = freshSince && comment && comment.created_at < freshSince;
  const closing = typeof note === "string" && note.trim() ? `Closing note: ${note.trim()}` : "";
  const text = stale && said ? `Earlier comment (written before this close, not the closing verdict):\n${said}` : said;
  const pending = freshSince && (!said || stale) ? "Closing turn's final answer pending." : "";
  return (
    (freshSince ? [closing, text, pending] : [text, closing]).filter(Boolean).join("\n\n").slice(0, REPORT_CHARS) ||
    "(no comment)"
  );
}

/**
 * Wakes the agent that created the task, in the chat it created it from, once another agent closed it. Nobody is
 * woken when the owner created or closed it, or its creator closed it without an execution handoff; a chat answering another agent is
 * not woken (DECISIONS.md#d-074). Past the unattended limits the report waits there for the owner.
 */
export function reportClose(
  store: Store,
  admit: AdmitFn,
  taskId: string,
  options: { immediate?: boolean; runStartedAt?: string } = {},
): RunRecord | undefined {
  const task = store.tasks.get(taskId);
  const close = task && lastClose(store, task);
  if (!task || !close) return undefined;
  const creator = store.agents.get(task.created_by);
  const closer = store.agents.get(close.event.by);
  if (!creator || !closer) return undefined;
  if (store.threads.context(task.thread_id).close_reported === close.index) return undefined;
  const from = close.created?.data ?? {};
  const thread = typeof from.from_thread === "string" ? store.threads.get(from.from_thread) : undefined;
  if (!thread || thread.kind === "a2a" || thread.task_id === task.id) return undefined;
  const transferred = store.threads.byTask(task.id).some((session) => {
    const source = store.threads.context(session.id).handoff_from;
    return source?.thread === thread.id && source.run === from.from_run;
  });
  if (creator.id === closer.id && !transferred) return undefined;
  store.threads.mergeContext(task.thread_id, { close_reported: close.index });
  const origin: Origin = {
    kind: "task_result",
    task_id: task.id,
    title: task.title.slice(0, 120),
    state: task.state === "dropped" ? "dropped" : "done",
    agent_id: closer.id,
    name: closer.name,
  };
  const since = close.event.at;
  const freshSince = options.immediate
    ? options.runStartedAt && options.runStartedAt < since
      ? options.runStartedAt
      : since
    : undefined;
  const text = reportOf(store, task, closer.id, close.event.data.note, freshSince);
  const paused = pausedNotice(store, thread.id, closer.name);
  if (paused) {
    // Kept for the creator's next turn (when the owner writes), and the owner sees why it stopped.
    store.modelLog.append(thread.id, undefined, [
      systemNote(`A task you created was closed while agents were paused:\n${frameInput(origin, text)}`),
    ]);
    store.messages.add({ thread_id: thread.id, author: { kind: "system" }, parts: [paused] });
    store.threads.mergeContext(thread.id, { kept: creator.id });
    return undefined;
  }
  const created = typeof from.from_run === "string" ? store.runs.get(from.from_run) : undefined;
  return admit({
    thread_id: thread.id,
    agent_id: creator.id,
    trigger: "a2a_result",
    origin,
    text,
    depth: created?.depth ?? 0,
  });
}
