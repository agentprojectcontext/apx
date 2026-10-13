// The spend breaker: agents waking each other (delegations, results) without the owner stop after a number of turns
// or tokens, counted over the whole conversation tree since the owner last wrote in it.
import type { Store } from "../domain/store.ts";
import { unattendedLimits } from "./limits.ts";

/** The thread at the top of `threadId`'s tree and every sub-thread under it. */
function tree(store: Store, threadId: string): string[] {
  let root = store.threads.get(threadId);
  for (let hops = 0; root?.parent_id && hops < 10; hops++) root = store.threads.get(root.parent_id);
  if (!root) return [threadId];
  const ids: string[] = [];
  const queue = [root.id];
  while (queue.length && ids.length < 200) {
    const id = queue.shift() as string;
    ids.push(id);
    queue.push(...store.threads.children(id));
  }
  return ids;
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
