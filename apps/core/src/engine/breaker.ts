// The spend breaker: agents waking each other (delegations, results, tasks they give) without the owner stop after a
// number of turns or tokens, counted over the whole conversation tree since the owner last wrote in it. A task chat an
// agent's turn started belongs to the tree of the chat it came from (DECISIONS.md#d-080). An agent the owner gave a
// budget of its own also stops at it, in the same window, while the others go on.
import type { Store } from "../domain/store.ts";
import { systemNote } from "../harness/native.ts";
import { agentLimits, unattendedLimits } from "./limits.ts";

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
type Trip = { limit: "runs" | "tokens"; spent: string };

const kTokens = (n: number) => `${Math.round(n / 1000)}k`;

/** What agents (or one of them) spent in this tree's window, or undefined while the owner let them go this round. */
function spent(store: Store, threadId: string, agentId?: string): Limits | undefined {
  const ids = tree(store, threadId);
  const top = store.threads.context(ids[0] ?? threadId);
  const u = store.runs.unattended(ids, top.budget_from, agentId);
  // Let go for this round: until the owner writes in the tree again (DECISIONS.md#d-081).
  return top.released_at && top.released_at > u.since ? undefined : u;
}

function over(max: Limits, u: Limits | undefined): Trip | undefined {
  if (!u) return undefined;
  if (max.runs && u.runs >= max.runs) return { limit: "runs", spent: String(u.runs) };
  if (max.tokens && u.tokens >= max.tokens) return { limit: "tokens", spent: kTokens(u.tokens) };
  return undefined;
}

/** Which limit stopped the chain and how much was spent, or undefined when one more unattended turn may run. */
export function trip(store: Store, threadId: string): Trip | undefined {
  const max = unattendedLimits(store);
  if (!max.runs && !max.tokens) return undefined;
  return over(max, spent(store, threadId));
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
  return `agents ${t.limit === "runs" ? `started ${t.spent} turns` : `spent ${t.spent} tokens`} on their own since you last wrote here; they wait for you before going on`;
}

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
  const variant = chain ? t.limit : t.limit === "runs" ? "agentRuns" : "agentTokens";
  return {
    type: "notice" as const,
    level: "warn" as const,
    code: "breaker.held",
    text: `Paused: ${why}. ${who} starts "${task}" once you let them go on.`,
    vars: { variant, spent: t.spent, who, task, thread: threadId, link: "apx:settings/agents" },
  };
}

/** The notice the owner sees when a result arrives while the chain is paused: `who` finished, write to go on. */
export function pausedNotice(store: Store, threadId: string, who: string) {
  const t = trip(store, threadId);
  if (!t) return undefined;
  return {
    type: "notice" as const,
    level: "warn" as const,
    code: "breaker.paused",
    text: `Paused: ${tripped(store, threadId)}. ${who} finished; write to continue.`,
    vars: { variant: t.limit, spent: t.spent, who, thread: threadId, link: "apx:settings/agents" },
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
  store.modelLog.append(o.thread_id, o.run_id, [systemNote(o.note)]);
  store.messages.add({ thread_id: o.thread_id, author: { kind: "system" }, parts: [paused] });
  store.threads.mergeContext(o.thread_id, { kept: o.agent_id });
  return true;
}
