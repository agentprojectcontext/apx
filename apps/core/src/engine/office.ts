// The office's moving parts that live in the engine: @mentions (an @agent named in a task is asked there, a few hops
// at most; see task-work.ts) and the task a turn works on, shown at the top of its input.
import type { Task, Thread } from "@apx/protocol";
import type { AgentRecord } from "../domain/agents.ts";
import { ownerIdentity } from "../domain/owner.ts";
import { ownerQuestionProblem } from "../domain/owner-question.ts";
import type { Store } from "../domain/store.ts";
import { noticeTaskWaiting } from "../domain/task-attention.ts";
import { previewOf } from "../domain/threads.ts";
import { inlineName, untrusted } from "../tools/result.ts";

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

/** Whether a text @mentions the owner: as @owner, @human or by their name. */
export function mentionsOwner(store: Store, text: string): boolean {
  const normalize = (value: string) => value.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
  const name = ownerIdentity(store).name;
  const aliases = new Set(["owner", "human", ...name.split(/\s+/), name.replace(/\s+/g, "")].map(normalize));
  return [...text.matchAll(MENTIONS)].some((m) => aliases.has(normalize(m[1] ?? "")));
}

/** Why an agent's text that @mentions the owner is not something they can act on; undefined when it is (or no mention). */
export function ownerMentionProblem(store: Store, text: string): string | undefined {
  return mentionsOwner(store, text) ? ownerQuestionProblem(text) : undefined;
}

/**
 * Human mentions ask for attention without starting an agent turn; an owner's reply clears the request. An agent's
 * stand-in or a note about another message (its final answer is posted here too) does not ask.
 */
export function taskCommentAttention(store: Store, task: Task, text: string, by: string): void {
  if (task.state !== "open") return;
  const asks = by !== "owner" && mentionsOwner(store, text) && !ownerQuestionProblem(text);
  const waiting = by === "owner" ? false : asks || task.awaits_owner;
  if (waiting === task.awaits_owner) return;
  noticeTaskWaiting(store, task, waiting, previewOf(text));
  store.tasks.change(task.id, { awaits_owner: waiting }, by);
}

/**
 * The task a chat works on, as each turn there reads it: what it is, where it stands, who worked it before, and how to
 * keep it up to date. Its title and description may come from an agent (who may have read a web page), so unless the
 * owner wrote the task they arrive as outside data.
 */
export function taskBlock(store: Store, thread: Pick<Thread, "id" | "task_id">): string | undefined {
  const t = thread.task_id ? store.tasks.get(thread.task_id) : undefined;
  if (!t) return undefined;
  const name = (id: string) => store.agents.get(id)?.name ?? id;
  const who = t.assignee ? name(t.assignee) : "nobody";
  const state = `${t.state === "open" ? t.status : t.state} · assigned to ${who}${t.awaits_owner ? " · waiting for the owner" : ""}${t.due_at ? ` · due ${t.due_at}` : ""}${t.person_name ? ` · ${t.owed_by === "person" ? `${inlineName(t.person_name)} owes it` : `owed to ${inlineName(t.person_name)}`}` : ""}`;
  const words = [t.title, t.description.slice(0, 2000)].filter(Boolean).join("\n");
  const others = store.threads
    .byTask(t.id)
    .filter((c) => c.id !== thread.id)
    .map((c) => name(c.agent_ids[0] ?? ""));
  return [
    `Task ${t.id}:`,
    t.created_by === "owner" ? words : untrusted("task", { created_by: t.created_by }, words),
    state,
    others.length ? `Worked on before in their own chats by: ${[...new Set(others)].join(", ")}.` : "",
    "This is your chat for this task. Your final answer is posted to the task as your comment: say in a few lines what you did, what is left or what blocks you.",
    "Keep the task up to date with task_update (doing while you work on it, review when it is ready to be checked) and task_close when it is done. Do not use task_comment on this task; it is for other tasks.",
    "Mention @owner in your answer when you need the owner; mention @agent to ask a teammate (it answers in its own chat for this task).",
  ]
    .filter(Boolean)
    .join("\n");
}
