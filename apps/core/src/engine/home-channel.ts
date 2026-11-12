// Home talks to the owner where they talk now: an answer to a message goes where it was written, but what comes later
// (a delegated result, a task's report, a job that ended) follows the owner, and they can move the whole conversation
// to another channel. See DECISIONS.md#d-224
import { type RunInput, TERMINAL } from "../domain/runs.ts";
import { HOME_THREAD_ID } from "../domain/seed.ts";
import type { Store } from "../domain/store.ts";

type At = { channel: string; conversation: string };

/**
 * Where a later turn in a chat answers: in Home none of its own, so the engine takes where Home talks to the owner when
 * the turn starts; elsewhere where the turn that started the work answered.
 */
export function laterReplyTo(store: Store, threadId: string, bound: RunInput["reply_to"]): RunInput["reply_to"] {
  return store.threads.get(threadId)?.kind === "home" ? undefined : bound;
}

/** The owner asked to go on in Home on another channel: Home's answers, and those of turns not yet ended, go there. */
export function moveHome(store: Store, at: At): void {
  store.tx(() => {
    store.threads.mergeContext(HOME_THREAD_ID, { reply_to: at });
    for (const r of store.runs.list(HOME_THREAD_ID, 50))
      if (!TERMINAL.has(r.state) && r.input) store.runs.setReplyTo(r.id, at);
  });
}
