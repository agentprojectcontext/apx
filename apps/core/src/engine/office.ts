// The office's moving parts that live in the engine: @mentions (in a task's conversation, an @agent answers there,
// a few hops at most) and the task a turn works on, shown at the top of its input.
import type { Task } from "@apx/protocol";
import type { AgentRecord } from "../domain/agents.ts";
import { ownerIdentity } from "../domain/owner.ts";
import type { RunRecord } from "../domain/runs.ts";
import type { Store } from "../domain/store.ts";
import { noticeTaskWaiting } from "../domain/task-attention.ts";
import { previewOf } from "../domain/threads.ts";
import { untrusted } from "../tools/result.ts";
import type { AdmitFn } from "./engine.ts";

/** A mention starts a turn; a turn's mention another, but only this deep, so agents cannot ping-pong forever. */
export const MAX_MENTION_DEPTH = 2;
const MAX_MENTIONS = 3;
const MENTIONS = /(?<![\p{L}\p{N}_@])@([\p{L}\p{N}][\p{L}\p{N}_-]*)/gu;

/** The agents an @mention names (by slug, name or id), in the order written; unknown names are skipped. */
export function mentioned(store: Store, text: string, projectId: string | undefined, except?: string): AgentRecord[] {
  const out: AgentRecord[] = [];
  for (const m of text.matchAll(MENTIONS)) {
    if (["owner", "human"].includes(m[1]?.toLowerCase() ?? "")) continue;
    const r = store.agents.resolve(m[1] ?? "", projectId);
    if (
      "agent" in r &&
      (!r.agent.project_id || r.agent.project_id === projectId) &&
      r.agent.id !== except &&
      !out.some((a) => a.id === r.agent.id)
    )
      out.push(r.agent);
    if (out.length >= MAX_MENTIONS) break;
  }
  return out;
}

/** Human mentions ask for attention without starting an agent turn; an owner's reply clears the request. */
export function taskCommentAttention(store: Store, task: Task, text: string, by: string): void {
  if (task.state !== "open") return;
  const normalize = (value: string) => value.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
  const name = ownerIdentity(store).name;
  const aliases = new Set(["owner", "human", ...name.split(/\s+/), name.replace(/\s+/g, "")].map(normalize));
  const asks = by !== "owner" && [...text.matchAll(MENTIONS)].some((m) => aliases.has(normalize(m[1] ?? "")));
  const waiting = by === "owner" ? false : asks || task.awaits_owner;
  if (waiting === task.awaits_owner) return;
  noticeTaskWaiting(store, task, waiting, previewOf(text));
  store.tasks.change(task.id, { awaits_owner: waiting }, by);
}

/**
 * The task a thread is the conversation of, as the turn reads it. Its title and description may come from an agent
 * (who may have read a web page), so unless the owner wrote the task they arrive as outside data.
 */
export function taskBlock(store: Store, threadId: string): string | undefined {
  const t = store.tasks.byThread(threadId);
  if (!t) return undefined;
  const who = t.assignee ? (store.agents.get(t.assignee)?.name ?? t.assignee) : "nobody";
  const state = `${t.state === "open" ? t.status : t.state} · assigned to ${who}${t.awaits_owner ? " · waiting for the owner" : ""}${t.due_at ? ` · due ${t.due_at}` : ""}${t.person_name ? ` · ${t.owed_by === "person" ? `${t.person_name} owes it` : `owed to ${t.person_name}`}` : ""}`;
  const words = [t.title, t.description.slice(0, 2000)].filter(Boolean).join("\n");
  return [
    t.created_by === "owner" ? words : untrusted("task", { created_by: t.created_by }, words),
    state,
    "This is the task's conversation: your answer is posted here. Use task_update / task_close to move or close it; task_comment only for another task.",
    "Mention @owner when you need the owner's attention here; it goes to their tray. Mention @agent to ask a teammate here.",
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
  if (run.state !== "completed") return;
  const msg = run.message_id ? store.messages.get(run.message_id) : undefined;
  const text = (msg?.parts ?? []).map((p) => (p.type === "text" ? p.text : "")).join("\n");
  taskCommentAttention(store, task, text, run.agent_id);
  if (run.depth + 1 > MAX_MENTION_DEPTH) return;
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
