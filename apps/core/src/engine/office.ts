// The office's moving parts that live in the engine: @mentions (in a task's conversation, an @agent answers there,
// a few hops at most) and the task a turn works on, shown at the top of its input.
import type { AgentRecord } from "../domain/agents.ts";
import type { RunRecord } from "../domain/runs.ts";
import type { Store } from "../domain/store.ts";
import type { AdmitFn } from "./engine.ts";

/** A mention starts a turn; a turn's mention another, but only this deep, so agents cannot ping-pong forever. */
export const MAX_MENTION_DEPTH = 2;
const MAX_MENTIONS = 3;

/** The agents an @mention names (by slug, name or id), in the order written; unknown names are skipped. */
export function mentioned(store: Store, text: string, projectId: string | undefined, except?: string): AgentRecord[] {
  const out: AgentRecord[] = [];
  for (const m of text.matchAll(/(?<![\w@])@([\p{L}\p{N}][\p{L}\p{N}_-]{0,40})/gu)) {
    const r = store.agents.resolve(m[1] ?? "", projectId);
    if ("agent" in r && r.agent.id !== except && !out.some((a) => a.id === r.agent.id)) out.push(r.agent);
    if (out.length >= MAX_MENTIONS) break;
  }
  return out;
}

/** The task a thread is the conversation of, as the turn reads it. */
export function taskBlock(store: Store, threadId: string): string | undefined {
  const t = store.tasks.byThread(threadId);
  if (!t) return undefined;
  const who = t.assignee ? (store.agents.get(t.assignee)?.name ?? t.assignee) : "nobody";
  return [
    `${t.title} · ${t.state === "open" ? t.status : t.state} · assigned to ${who}${t.awaits_owner ? " · waiting for the owner" : ""}${t.due_at ? ` · due ${t.due_at}` : ""}`,
    t.description ? t.description.slice(0, 2000) : "",
    "This is the task's conversation: your answer is posted here. Use task_update / task_close to move or close it; task_comment only for another task.",
  ]
    .filter(Boolean)
    .join("\n");
}

/** After a turn in a task's conversation: the task moved, and the agents its answer @mentions answer next. */
export function afterTaskTurn(store: Store, admit: AdmitFn, run: RunRecord): void {
  const thread = store.threads.get(run.thread_id);
  const task = thread?.kind === "task" ? store.tasks.byThread(thread.id) : undefined;
  if (!task || !thread) return;
  store.tasks.touched(task.id, run.agent_id, "update");
  if (run.state !== "completed" || run.depth + 1 > MAX_MENTION_DEPTH) return;
  const msg = run.message_id ? store.messages.get(run.message_id) : undefined;
  const text = (msg?.parts ?? []).map((p) => (p.type === "text" ? p.text : "")).join("\n");
  const author = store.agents.get(run.agent_id);
  for (const a of mentioned(store, text, task.project_id, run.agent_id))
    admit({
      thread_id: thread.id,
      agent_id: a.id,
      trigger: "a2a",
      origin: {
        kind: "agent",
        id: run.agent_id,
        name: author?.name ?? run.agent_id,
        thread_id: thread.id,
        run_id: run.id,
      },
      text,
      depth: run.depth + 1,
    });
}
