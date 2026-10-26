// Execution and creation provenance can differ after reassignment: a delivery reaches the current handoff's source
// as well as a different historical creator. See HISTORY.md#task-execution-handoff.
import type { Task, Thread } from "@apx/protocol";
import type { AgentRecord } from "../domain/agents.ts";
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

type Recipient = { agent: AgentRecord; thread: Thread; run?: RunRecord | undefined };

function recipients(store: Store, task: Task, closer: string, created: Record<string, unknown>): Recipient[] {
  const out: Recipient[] = [];
  const add = (threadId: unknown, runId: unknown, agentId?: string) => {
    const thread = typeof threadId === "string" ? store.threads.get(threadId) : undefined;
    const run = typeof runId === "string" ? store.runs.get(runId) : undefined;
    const agent = store.agents.get(agentId ?? run?.agent_id ?? "");
    if (!agent || !thread || thread.kind === "a2a" || thread.task_id === task.id) return;
    if (!out.some((r) => r.thread.id === thread.id && r.agent.id === agent.id)) out.push({ thread, agent, run });
  };
  const from = store.threads.context(task.thread_id).handoff_from;
  if (from) {
    const run = store.runs.get(from.run);
    if (run?.thread_id === from.thread && store.threads.get(from.thread)?.project_id === task.project_id)
      add(from.thread, from.run);
  }
  if (task.created_by !== closer) add(created.from_thread, created.from_run, task.created_by);
  return out;
}

/** Reports once to the current transfer's source and, separately, a different historical creator. */
export function reportClose(
  store: Store,
  admit: AdmitFn,
  taskId: string,
  options: { immediate?: boolean; runStartedAt?: string } = {},
): RunRecord | undefined {
  const task = store.tasks.get(taskId);
  const close = task && lastClose(store, task);
  if (!task || !close) return undefined;
  const closer = store.agents.get(close.event.by);
  if (!closer || store.threads.context(task.thread_id).close_reported === close.index) return undefined;
  const targets = recipients(store, task, closer.id, close.created?.data ?? {});
  if (!targets.length) return undefined;
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
  let first: RunRecord | undefined;
  for (const { thread, agent, run } of targets) {
    const paused = pausedNotice(store, thread.id, closer.name);
    if (paused) {
      store.modelLog.append(thread.id, undefined, [
        systemNote(`A task you handed off was closed while agents were paused:\n${frameInput(origin, text)}`),
      ]);
      store.messages.add({ thread_id: thread.id, author: { kind: "system" }, parts: [paused] });
      store.threads.mergeContext(thread.id, { kept: agent.id });
      continue;
    }
    const reported = admit({
      thread_id: thread.id,
      agent_id: agent.id,
      trigger: "a2a_result",
      origin,
      text,
      depth: run?.depth ?? 0,
    });
    first ??= reported;
  }
  return first;
}
