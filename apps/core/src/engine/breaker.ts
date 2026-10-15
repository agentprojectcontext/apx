// The spend breaker: agents waking each other (delegations, results, tasks they give) without the owner stop after a
// number of turns or tokens, counted over the whole conversation tree since the owner last wrote in it. A task chat an
// agent's turn started belongs to the tree of the chat it came from (DECISIONS.md#d-080).
import type { Store } from "../domain/store.ts";
import { unattendedLimits } from "./limits.ts";

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

/** Which limit stopped the chain and how much was spent, or undefined when one more unattended turn may run. */
export function trip(store: Store, threadId: string): { limit: "runs" | "tokens"; spent: string } | undefined {
  const max = unattendedLimits(store);
  if (!max.runs && !max.tokens) return undefined;
  const u = store.runs.unattended(tree(store, threadId));
  if (max.runs && u.runs >= max.runs) return { limit: "runs", spent: String(u.runs) };
  if (max.tokens && u.tokens >= max.tokens) return { limit: "tokens", spent: `${Math.round(u.tokens / 1000)}k` };
  return undefined;
}

/** Why one more unattended turn in this tree must wait for the owner, or undefined when it may run. */
export function tripped(store: Store, threadId: string): string | undefined {
  const t = trip(store, threadId);
  if (!t) return undefined;
  return `agents ${t.limit === "runs" ? `started ${t.spent} turns` : `spent ${t.spent} tokens`} on their own since you last wrote here; they wait for you before going on`;
}

/** The notice the owner sees when an agent gave a task while the chain is paused: `who` starts it once they go on. */
export function heldNotice(store: Store, threadId: string, who: string, task: string) {
  const t = trip(store, threadId);
  if (!t) return undefined;
  return {
    type: "notice" as const,
    level: "warn" as const,
    code: "breaker.held",
    text: `Paused: ${tripped(store, threadId)}. ${who} starts "${task}" once you let them go on.`,
    vars: { variant: t.limit, spent: t.spent, who, task, link: "apx:settings/agents" },
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
    vars: { variant: t.limit, spent: t.spent, who, link: "apx:settings/agents" },
  };
}
