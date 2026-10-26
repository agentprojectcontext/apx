// The owner lets agents go on after the breaker paused a conversation tree: with a fresh budget counted from now, or
// with no limit until they next write in it. Tasks given while paused start, and chats that kept a result go on.
// See DECISIONS.md#d-081
import type { Store } from "../domain/store.ts";
import { tree } from "./breaker.ts";
import type { AdmitFn } from "./engine.ts";
import { startHeld } from "./task-work.ts";

export type GoOnMode = "reset" | "release";

/**
 * Lets the tree `threadId` is in go on; returns how many turns it started. `release` starts a chat's queued
 * delegations the breaker held (engine `release`).
 */
export function goOn(
  store: Store,
  admit: AdmitFn,
  release: (threadId: string) => number,
  threadId: string,
  mode: GoOnMode,
): number {
  const ids = tree(store, threadId);
  const top = ids[0] ?? threadId;
  const at = new Date().toISOString();
  store.tx(() => {
    store.threads.mergeContext(top, mode === "reset" ? { budget_from: at } : { released_at: at });
    for (const id of ids) {
      for (const code of ["breaker.paused", "breaker.held"]) {
        for (const message of store.messages.notices(id, code)) {
          let changed = false;
          const parts = message.parts.map((part) => {
            if (part.type !== "notice" || part.code !== code || part.vars?.resolved) return part;
            changed = true;
            return { ...part, vars: { ...part.vars, resolved: mode } };
          });
          if (changed) store.messages.update({ ...message, parts });
        }
      }
    }
  });
  let started = startHeld(store, admit, ids);
  for (const id of ids) {
    started += release(id);
    const { kept } = store.threads.context(id);
    if (kept && store.agents.get(kept)) {
      store.threads.mergeContext(id, { kept: undefined });
      admit({ thread_id: id, agent_id: kept, trigger: "system", origin: { kind: "go_on", mode }, text: "" });
      started++;
    }
  }
  return started;
}
