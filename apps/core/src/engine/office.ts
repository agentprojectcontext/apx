// The office's moving parts that live in the engine: @mentions (an @agent the owner names in a task is asked there; see
// task-work.ts) and the task a turn works on, shown at the top of its input.

import type { Task, Thread } from "@apx/protocol";
import type { AgentRecord } from "../domain/agents.ts";
import { ownerIdentity } from "../domain/owner.ts";
import { ownerQuestionProblem } from "../domain/owner-question.ts";
import type { Store } from "../domain/store.ts";
import { noticeTaskWaiting } from "../domain/task-attention.ts";
import { previewOf } from "../domain/threads.ts";
import { inlineName, untrusted } from "../tools/result.ts";
import { taskWords } from "../tools/tasks.ts";
import { handoffBrief } from "./task-handoff.ts";

const MAX_MENTIONS = 3;
/** As much of a plan as the task block carries: all a plan may hold (tasks.update caps it there). */
const PLAN_CHARS = 4000;
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

// Where a task's code work goes is the owner's call, asked once and kept when they answer "always".
const CODE_PLACE = [
  'Before you change code for this task, unless a note says where code work goes in this project (recall "worktree"), ask_owner with five short options written in the language you speak with the owner: a worktree now, a worktree always, here in the project folder now, here always, other; save an "always" with remember (scope project) and do not ask again.',
  "In a worktree: first git worktree list and the branches on this task's subject, and go on in the one that exists. Only if none, add one under .worktrees/ at the project root (never a parent folder, .apc or .claude) on a named branch (feat/…, fix/…), never detached. Remove it and its branch once merged, never with uncommitted changes.",
].join("\n");

/**
 * The task a chat works on, as each turn there reads it: what it is, where it stands, who worked it before, and how to
 * keep it up to date. Its title and description may come from an agent (who may have read a web page), so unless the
 * owner wrote the task they arrive as outside data.
 */
export function taskBlock(
  store: Store,
  thread: Pick<Thread, "id" | "task_id" | "kind" | "parent_id">,
): string | undefined {
  // A session delegated from a task's chat helps with that task: it reads where the task stands too.
  const parent =
    !thread.task_id && thread.kind === "a2a" && thread.parent_id ? store.threads.get(thread.parent_id) : undefined;
  const t = store.tasks.get(thread.task_id ?? parent?.task_id ?? "");
  if (!t) return undefined;
  const name = (id: string) => store.agents.get(id)?.name ?? id;
  const who = t.assignee ? name(t.assignee) : "nobody";
  const state = `${t.state === "open" ? t.status : t.state} · assigned to ${who}${t.awaits_owner ? " · waiting for the owner" : ""}${t.due_at ? ` · due ${t.due_at}` : ""}${t.person_name ? ` · ${t.owed_by === "person" ? `${inlineName(t.person_name)} owes it` : `owed to ${inlineName(t.person_name)}`}` : ""}`;
  const words = [t.title, t.description.slice(0, 2000)].filter(Boolean).join("\n");
  const others = store.threads
    .byTask(t.id)
    .filter((c) => c.id !== thread.id)
    .map((c) => `${name(c.agent_ids[0] ?? "")} (chat ${c.id})`);
  // The plan is an agent's working note, maybe written from what it read outside: data, never the owner's words.
  const plan = t.plan?.trim()
    ? `Plan kept on the task:\n${untrusted("task_plan", {}, t.plan.trim().slice(0, PLAN_CHARS))}`
    : "";
  const attachments = store.taskAttachments.list(t.id);
  const assets = attachments.length
    ? `This task keeps ${attachments.length} attachment(s). task_get lists their durable media ids; file_read inspects them.`
    : "";
  const head = [`Task ${t.id}:`, taskWords(t, words), state, plan, assets, handoffBrief(store, thread.id)].filter(
    Boolean,
  );
  const lookup =
    "task_get shows its latest comments and sessions; read_chat reads a session. Read them before redoing work.";
  if (parent)
    return [
      ...head,
      `You are helping with this task for ${name(parent.agent_ids[0] ?? "")}, whose chat for it is ${parent.id}. ${lookup}`,
      "Your answer goes back to them. If what you found matters to everyone on the task (verified, blocked, needs a decision), also leave a short task_comment on it.",
    ].join("\n");
  return [
    ...head,
    others.length ? `Worked on before by: ${[...new Set(others)].join(", ")}. ${lookup}` : "",
    "This is your chat for this task; what you say here stays here. Comment on the task with task_comment when others should know: a step done and verified, a block, something to review or decide. Two or three lines, never a transcript.",
    "Keep its plan on the task with task_update plan (the steps, marked done as you go): it is what the next turn reads, whatever this chat forgets. Keep the task up to date with task_update (doing while you work on it, review when it is ready to be checked: the owner checks it unless you name a reviewer agent) and task_close when it is done: the answer of the turn that closes it is posted as your report to whoever created the task.",
    "Mention @owner in a task_comment or in your answer when you need the owner. To ask a teammate, use delegate: its answer comes back to you (an @mention of an agent asks no one).",
    CODE_PLACE,
  ]
    .filter(Boolean)
    .join("\n");
}
