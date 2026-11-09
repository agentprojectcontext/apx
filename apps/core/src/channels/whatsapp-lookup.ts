// A question to the WhatsApp library's own id store, which may never answer: every lookup has a deadline.
import type { RunTimers } from "../engine/engine.ts";

/** How long the device's own id store has to say which number a private id stands for (or the other way). */
const LOOKUP_MS = 5_000;
export const wallTimers: RunTimers = {
  now: () => Date.now(),
  after(ms, callback) {
    const timer = setTimeout(callback, ms);
    return () => clearTimeout(timer);
  },
};
/** A lookup's answer, or none once its deadline passes or it fails. */
export function lookup(
  timers: RunTimers,
  ask: Promise<string | null | undefined> | undefined,
): Promise<string | null | undefined> {
  if (!ask) return Promise.resolve(undefined);
  return new Promise((resolve) => {
    const cancel = timers.after(LOOKUP_MS, () => resolve(undefined));
    ask.then(
      (v) => {
        cancel();
        resolve(v);
      },
      () => {
        cancel();
        resolve(undefined);
      },
    );
  });
}
