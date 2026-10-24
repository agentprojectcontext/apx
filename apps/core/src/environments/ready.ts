// Chats whose agent started the computer and ended its turn to wait: each gets one turn the moment the computer is
// ready, or failed, so the agent never checks on it in the chat. Kept in memory: a restart ends the preparation too.
import type { RunTimers } from "../engine/engine.ts";

export type ReadyEvent = { thread: string; agent: string; ready: boolean; error?: string };
type Phase = { phase?: string | undefined; error?: string | undefined };

export const READY_POLL_MS = 2_000;
/** Past the lifecycle's own preparation deadline (20 minutes), so a preparation that hangs is reported by it first. */
export const READY_WAIT_MS = 25 * 60_000;

const wall: RunTimers = {
  now: () => Date.now(),
  after(ms, callback) {
    const timer = setTimeout(callback, ms);
    timer.unref();
    return () => clearTimeout(timer);
  },
};

export function readyWaiters(o: { phase: () => Promise<Phase>; wake: (e: ReadyEvent) => void; timers?: RunTimers }) {
  const timers = o.timers ?? wall;
  const waiting = new Map<string, { agent: string; until: number }>();
  let cancel: (() => void) | undefined;
  let closed = false;
  const arm = () => {
    if (!closed && waiting.size && !cancel) cancel = timers.after(READY_POLL_MS, () => void check());
  };
  const check = async () => {
    cancel = undefined;
    const s = await o.phase().catch(() => undefined);
    if (closed) return;
    const now = timers.now();
    for (const [thread, w] of waiting) {
      const late = now >= w.until;
      if ((!s || s.phase === "preparing") && !late) continue;
      waiting.delete(thread);
      const ready = s?.phase === "running";
      const error = late && s?.phase !== "running" ? "it did not start in time" : (s?.error ?? `it is ${s?.phase}`);
      o.wake({ thread, agent: w.agent, ready, ...(ready ? {} : { error }) });
    }
    arm();
  };
  return {
    /** The chat's agent hears once when the computer is up, or why it is not. */
    add(thread: string, agent: string) {
      waiting.set(thread, { agent, until: timers.now() + READY_WAIT_MS });
      arm();
    },
    waiting: () => waiting.size,
    close() {
      closed = true;
      cancel?.();
      waiting.clear();
    },
  };
}
