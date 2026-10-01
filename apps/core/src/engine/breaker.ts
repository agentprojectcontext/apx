// The spend breaker: agents waking each other (delegations, results) without the owner stop after a number of turns
// or tokens, counted over the whole conversation tree since the owner last wrote in it.
import type { Store } from "../domain/store.ts";
import { MAX_UNATTENDED_RUNS, MAX_UNATTENDED_TOKENS } from "./limits.ts";

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

/** Why one more unattended turn in this tree must wait for the owner, or undefined when it may run. */
export function tripped(store: Store, threadId: string): string | undefined {
  const u = store.runs.unattended(tree(store, threadId));
  if (u.runs >= MAX_UNATTENDED_RUNS)
    return `agents started ${u.runs} turns on their own since you last wrote here; they wait for you before going on`;
  if (u.tokens >= MAX_UNATTENDED_TOKENS)
    return `agents spent ${Math.round(u.tokens / 1000)}k tokens on their own since you last wrote here; they wait for you before going on`;
  return undefined;
}
