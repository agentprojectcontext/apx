// The spend breaker: agents waking each other (delegations, results, tasks they give) without the owner stop after a
// number of turns or tokens, counted over the whole conversation tree since the owner last wrote in it. A task chat an
// agent's turn started belongs to the tree of the chat it came from (DECISIONS.md#d-080). An agent the owner gave a
// budget of its own also stops at it, in the same window, while the others go on. Agents on a task that spend too much
// without finishing a step of its plan stop the same way (DECISIONS.md#d-188).
import type { Task } from "@apx/protocol";
import type { Store } from "../domain/store.ts";
import { systemNote } from "../harness/native.ts";
import { agentLimits, STUCK_LIMITS, unattendedLimits } from "./limits.ts";

/** The chat above this one: its parent, or the chat whose agent gave the task this chat works on. */
const above = (store: Store, id: string) => store.threads.get(id)?.parent_id ?? store.threads.context(id).asked_from;

/** The thread at the top of `threadId`'s tree and every thread under it: sub-threads and the task chats they started. */
export function tree(store: Store, threadId: string): string[] {
  let root = threadId;
  for (let hops = 0, up = above(store, root); up && hops < 20; hops++, up = above(store, root)) root = up;
  if (!store.threads.get(root)) return [threadId];
  const ids = new Set<string>();
  const queue = [root];
  while (queue.length && ids.size < 200) {
    const id = queue.shift() as string;
    if (ids.has(id)) continue;
    ids.add(id);
    queue.push(...store.threads.children(id), ...store.threads.askedFrom(id));
  }
  return [...ids];
}

type Limits = { runs: number; tokens: number };
type Trip =
  | { limit: "runs" | "tokens"; spent: string }
  | { limit: "progress"; by: "runs" | "tokens"; spent: string; task: Task; since: string };

const kTokens = (n: number) => `${Math.round(n / 1000)}k`;

/** What agents (or one of them) spent in this tree's window, or undefined while the owner let them go this round. */
function spent(store: Store, threadId: string, agentId?: string): Limits | undefined {
  const ids = tree(store, threadId);
  const top = store.threads.context(ids[0] ?? threadId);
  const u = store.runs.unattended(ids, top.budget_from, agentId);
  // Let go for this round: until the owner writes in the tree again (DECISIONS.md#d-081).
  return top.released_at && top.released_at > u.since ? undefined : u;
}

function over(max: Limits, u: Limits | undefined): Extract<Trip, { limit: "runs" | "tokens" }> | undefined {
  if (!u) return undefined;
  if (max.runs && u.runs >= max.runs) return { limit: "runs", spent: String(u.runs) };
  if (max.tokens && u.tokens >= max.tokens) return { limit: "tokens", spent: kTokens(u.tokens) };
  return undefined;
}

/** The open task a chat works for: its own, or the one of a chat above it (a helper's caller, a consult's task). */
function taskOf(store: Store, threadId: string): Task | undefined {
  for (let id: string | undefined = threadId, hops = 0; id && hops < 5; hops++) {
    const thread = store.threads.get(id);
    const task = thread?.task_id ? store.tasks.get(thread.task_id) : store.tasks.byThread(id);
    if (task) return task.state === "open" ? task : undefined;
    id = thread?.parent_id;
  }
  return undefined;
}

/** A task's conversation, the chats it is worked in and every session under them. */
function taskChats(store: Store, task: Task): string[] {
  const ids = new Set<string>();
  const queue = [task.thread_id, ...store.threads.byTask(task.id).map((t) => t.id)];
  while (queue.length && ids.size < 200) {
    const id = queue.shift() as string;
    if (ids.has(id)) continue;
    ids.add(id);
    queue.push(...store.threads.children(id));
  }
  return [...ids];
}

/**
 * What agents spent on `threadId`'s task without finishing a step of its plan, when it is past STUCK_LIMITS: counted
 * since the last step done, the owner's last word in its chats, or their go on.
 */
export function stuckTrip(store: Store, threadId: string): Extract<Trip, { limit: "progress" }> | undefined {
  const task = taskOf(store, threadId);
  if (!task?.assignee) return undefined;
  const top = store.threads.context(tree(store, threadId)[0] ?? threadId);
  const progress = store.threads.context(task.thread_id).progress_at ?? task.created_at;
  const after = [progress, top.budget_from ?? "", top.released_at ?? ""].sort().at(-1) ?? progress;
  const u = store.runs.unattended(taskChats(store, task), after);
  const t = over(STUCK_LIMITS, u);
  return t && { limit: "progress", by: t.limit, spent: t.spent, task, since: [after, u.since].sort().at(-1) ?? after };
}

/** The owner hears once per stretch that a task got nowhere: in the tray, linked to its conversation. */
export function tellStuck(store: Store, threadId: string): void {
  const t = stuckTrip(store, threadId);
  if (!t || store.threads.context(t.task.thread_id).stuck_told === t.since) return;
  store.threads.mergeContext(t.task.thread_id, { stuck_told: t.since });
  const en = store.settings.get("owner_language") === "en";
  const spent = en
    ? `${t.spent} ${t.by === "runs" ? "turns" : "tokens"}`
    : `${t.spent} ${t.by === "runs" ? "turnos" : "tokens"}`;
  store.notifications.add({
    kind: "task",
    level: "warn",
    title: t.task.title,
    body: en
      ? `Paused: ${spent} without finishing a step of its plan. Write on the task to go on or change course.`
      : `En pausa: ${spent} sin terminar un paso de su plan. Escribí en la tarea para seguir o cambiar el rumbo.`,
    thread_id: t.task.thread_id,
    ref: `stuck:${t.task.id}`,
  });
}

/** Which limit stopped the chain and how much was spent, or undefined when one more unattended turn may run. */
export function trip(store: Store, threadId: string): Trip | undefined {
  const max = unattendedLimits(store);
  return (max.runs || max.tokens ? over(max, spent(store, threadId)) : undefined) ?? stuckTrip(store, threadId);
}

/** Which of its own limits `agentId` reached in this tree's window, or undefined when it has none or may go on. */
export function agentTrip(store: Store, threadId: string, agentId: string): Trip | undefined {
  const max = agentLimits(store, agentId);
  return max && over(max, spent(store, threadId, agentId));
}

/** Why `name` waits for the owner although others may go on, or undefined when it may take more work. */
export function agentTripped(store: Store, threadId: string, agentId: string, name: string): string | undefined {
  const t = agentTrip(store, threadId, agentId);
  if (!t) return undefined;
  return `${name} ${t.limit === "runs" ? `started ${t.spent} turns` : `spent ${t.spent} tokens`} on its own since the owner last wrote here, its own limit`;
}

const used = (u: Limits, max: Limits) =>
  [
    max.runs ? `${u.runs} of ${max.runs} turns` : "",
    max.tokens ? `${kTokens(u.tokens)} of ${kTokens(max.tokens)} tokens` : "",
  ]
    .filter(Boolean)
    .join(", ");

/**
 * What agents spent on their own in this tree since the owner last wrote, against the limits: the whole chain's and,
 * for each of `agentIds` with a budget of its own, its own. Empty while nothing limits them.
 */
export function budgetLeft(
  store: Store,
  threadId: string,
  agentIds: readonly string[],
): { all?: string; agents: Map<string, string> } {
  const agents = new Map<string, string>();
  const max = unattendedLimits(store);
  const u = spent(store, threadId);
  if (!u) return { agents };
  for (const id of agentIds) {
    const own = agentLimits(store, id);
    const s = own && spent(store, threadId, id);
    if (own && s) agents.set(id, used(s, own));
  }
  return { ...(max.runs || max.tokens ? { all: used(u, max) } : {}), agents };
}

/** Why one more unattended turn in this tree must wait for the owner, or undefined when it may run. */
export function tripped(store: Store, threadId: string): string | undefined {
  const t = trip(store, threadId);
  if (!t) return undefined;
  if (t.limit === "progress")
    return `agents spent ${t.spent} ${t.by === "runs" ? "turns" : "tokens"} on "${t.task.title.slice(0, 120)}" without finishing a step of its plan; they wait for you before going on`;
  return `agents ${t.limit === "runs" ? `started ${t.spent} turns` : `spent ${t.spent} tokens`} on their own since you last wrote here; they wait for you before going on`;
}

/** A pause notice's wording: the limit, or for a task that got nowhere what it spent. */
const variantOf = (t: Trip) =>
  t.limit === "progress" ? (t.by === "runs" ? "progressRuns" : "progressTokens") : t.limit;
/** What a pause notice says besides its variant: the task that got nowhere, or where the owner changes the limit. */
const pauseVars = (t: Trip): Record<string, string> =>
  t.limit === "progress" ? { stuck: t.task.title.slice(0, 120) } : { link: "apx:settings/agents" };

/**
 * The notice the owner sees when an agent gave a task while the chain is paused, or while `agentId` (who gets it) is
 * past its own limit: `who` starts it once they go on.
 */
export function heldNotice(store: Store, threadId: string, who: string, task: string, agentId?: string) {
  const chain = trip(store, threadId);
  const own = !chain && agentId ? agentTrip(store, threadId, agentId) : undefined;
  const t = chain ?? own;
  if (!t) return undefined;
  const why = chain ? tripped(store, threadId) : agentTripped(store, threadId, agentId ?? "", who);
  const variant = chain ? variantOf(chain) : t.limit === "runs" ? "agentRuns" : "agentTokens";
  return {
    type: "notice" as const,
    level: "warn" as const,
    code: "breaker.held",
    text: `Paused: ${why}. ${who} starts "${task}" once you let them go on.`,
    vars: { variant, spent: t.spent, who, task, thread: threadId, ...pauseVars(t) },
  };
}

/** The notice the owner sees when a result arrives while the chain is paused: `who` finished, write to go on. */
function pausedNotice(store: Store, threadId: string, who: string) {
  const t = trip(store, threadId);
  if (!t) return undefined;
  return {
    type: "notice" as const,
    level: "warn" as const,
    code: "breaker.paused",
    text: `Paused: ${tripped(store, threadId)}. ${who} finished; write to continue.`,
    vars: { variant: variantOf(t), spent: t.spent, who, thread: threadId, ...pauseVars(t) },
  };
}

/**
 * A result for `agentId` that arrives while its tree is paused: kept for its next turn as `note`, the owner sees why in
 * the chat, and the agent goes on with it when they let agents go on (go-on.ts). False when it may wake the agent now.
 */
export function keepWhilePaused(
  store: Store,
  o: { thread_id: string; agent_id: string; who: string; note: string; run_id?: string | undefined },
): boolean {
  const paused = pausedNotice(store, o.thread_id, o.who);
  if (!paused) return false;
  tellStuck(store, o.thread_id);
  store.modelLog.append(o.thread_id, o.run_id, [systemNote(o.note)]);
  store.messages.add({ thread_id: o.thread_id, author: { kind: "system" }, parts: [paused] });
  store.threads.mergeContext(o.thread_id, { kept: o.agent_id });
  return true;
}
