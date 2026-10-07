// A task is worked in its agent's own chat for it (listed in the inbox like any chat), never in the task's
// conversation: that one keeps only comments, the owner's and each work turn's final answer posted back by its agent.
// Assigning starts the work; an @mention in a comment asks that agent in its chat for the task; an hourly pickup
// starts what was assigned and never began.
import type { Author, Task, Thread } from "@apx/protocol";
import type { Origin, RunRecord } from "../domain/runs.ts";
import type { Store } from "../domain/store.ts";
import { previewOf } from "../domain/threads.ts";
import type { AdmitFn } from "./engine.ts";
import { MAX_MENTION_DEPTH, mentioned, taskCommentAttention } from "./office.ts";

/** How often assigned tasks that never started are looked at, and how many start each time. */
export const PICKUP_EVERY_MS = 3600_000;
const PICKUP_AT_ONCE = 3;
const PRIORITY_RANK: Record<Task["priority"], number> = { urgent: 0, high: 1, normal: 2, low: 3 };

/** Who asked for the work: the owner (assigning, commenting) or another agent, a few hops deep at most. */
export type Asker =
  | { kind: "owner" }
  | { kind: "agent"; id: string; name: string; thread_id: string; run_id: string; depth: number };

/** The agent's chat for this task: its latest one, or a new one. */
export function sessionFor(store: Store, task: Task, agentId: string): Thread {
  const mine = store.threads.byTask(task.id).filter((t) => t.agent_ids[0] === agentId);
  return (
    mine.at(-1) ??
    store.threads.create({
      kind: "loose",
      title: task.title,
      agent_ids: [agentId],
      project_id: task.project_id,
      task_id: task.id,
    })
  );
}

const originOf = (asker: Asker): Origin =>
  asker.kind === "owner"
    ? { kind: "user" }
    : { kind: "agent", id: asker.id, name: asker.name, thread_id: asker.thread_id, run_id: asker.run_id };

const depthOf = (asker: Asker) => (asker.kind === "owner" ? 0 : asker.depth);

/** A turn of `agentId` in its chat for the task, on what `text` asks (shown there as the asker's message). */
function ask(store: Store, admit: AdmitFn, task: Task, agentId: string, text: string, asker: Asker, author: Author) {
  const thread = sessionFor(store, task, agentId);
  store.messages.add({ thread_id: thread.id, author, parts: [{ type: "text", text }] });
  store.threads.patch(thread.id, { preview: previewOf(text) });
  return admit({
    thread_id: thread.id,
    agent_id: agentId,
    trigger: asker.kind === "owner" ? "user" : "a2a",
    origin: originOf(asker),
    text,
    depth: depthOf(asker),
  });
}

/**
 * Starts an agent's work on a task in its chat for it. The task's words are the owner's when the owner wrote it;
 * otherwise the turn is only told to work on it, and reads the task as outside data in its [task] block.
 */
export function startTaskWork(
  store: Store,
  admit: AdmitFn,
  task: Task,
  agentId: string,
  asker: Asker,
): RunRecord | undefined {
  if (task.state !== "open" || !store.agents.get(agentId) || depthOf(asker) > MAX_MENTION_DEPTH) return undefined;
  const ownWords = task.created_by === "owner";
  const text = ownWords ? [task.title, task.description].filter(Boolean).join("\n\n") : "Work on this task.";
  const author: Author =
    asker.kind === "agent" ? { kind: "agent", id: asker.id } : ownWords ? { kind: "user" } : { kind: "system" };
  return ask(store, admit, task, agentId, text, asker, author);
}

/** A comment's @mentions: each agent named answers in its chat for the task, and its answer comes back as a comment. */
export function askMentioned(store: Store, admit: AdmitFn, task: Task, text: string, asker: Asker): RunRecord[] {
  if (depthOf(asker) > MAX_MENTION_DEPTH) return [];
  const except = asker.kind === "agent" ? asker.id : undefined;
  const author: Author = asker.kind === "agent" ? { kind: "agent", id: asker.id } : { kind: "user" };
  return mentioned(store, text, task.project_id, except).map((a) => ask(store, admit, task, a.id, text, asker, author));
}

/** A comment on the task, by the owner or an agent: the task moved, and an @owner asks for the owner's attention. */
export function addComment(store: Store, task: Task, author: Author, text: string, by: string) {
  const message = store.messages.add({ thread_id: task.thread_id, author, parts: [{ type: "text", text }] });
  store.threads.patch(task.thread_id, { preview: previewOf(text) });
  taskCommentAttention(store, task, text, by);
  store.tasks.touched(task.id, by);
  return message;
}

/**
 * After a turn in a task's chat: the task moved, the turn's answer is posted to the task as its agent's comment, and
 * the agents that answer @mentions are asked next (a few hops at most).
 */
export function afterWorkTurn(store: Store, admit: AdmitFn, run: RunRecord): void {
  const thread = store.threads.get(run.thread_id);
  const task = thread?.task_id ? store.tasks.get(thread.task_id) : undefined;
  if (!task) return;
  if (run.state !== "completed") {
    store.tasks.touched(task.id, run.agent_id, "update");
    return;
  }
  const msg = run.message_id ? store.messages.get(run.message_id) : undefined;
  const text = (msg?.parts ?? [])
    .map((p) => (p.type === "text" ? p.text : ""))
    .join("\n")
    .trim();
  if (!text) return;
  addComment(store, task, { kind: "agent", id: run.agent_id }, text, run.agent_id);
  const fresh = store.tasks.get(task.id) ?? task;
  const author = store.agents.get(run.agent_id);
  askMentioned(store, admit, fresh, text, {
    kind: "agent",
    id: run.agent_id,
    name: author?.name ?? run.agent_id,
    thread_id: run.thread_id,
    run_id: run.id,
    depth: run.depth + 1,
  });
}

/** When a task was last given to its agent (its creation with one, or the last assignment). */
function assignedAt(store: Store, task: Task): string | undefined {
  return store.tasks
    .events(task.id)
    .filter((e) => (e.op === "assign" || e.op === "create") && typeof e.data.assignee === "string")
    .at(-1)?.at;
}

/**
 * The hourly pickup: open tasks assigned to an agent (since this way of working began) that never started, the most
 * pressing first (priority, then the nearest due date), a few at a time.
 */
export function pickUpTasks(store: Store, admit: AdmitFn): RunRecord[] {
  const since = store.settings.get("task_work_since");
  if (!since) return [];
  const waiting = store.tasks
    .list({ state: "open", limit: 500 })
    .filter(
      (t) =>
        t.assignee &&
        t.status !== "review" &&
        store.agents.get(t.assignee) &&
        store.threads.byTask(t.id).length === 0 &&
        (assignedAt(store, t) ?? "") >= since,
    )
    .sort(
      (a, b) =>
        PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || (a.due_at ?? "￿").localeCompare(b.due_at ?? "￿"),
    );
  return waiting
    .slice(0, PICKUP_AT_ONCE)
    .flatMap((t) => startTaskWork(store, admit, t, t.assignee ?? "", { kind: "owner" }) ?? []);
}
