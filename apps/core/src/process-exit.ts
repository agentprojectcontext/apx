import { unavailable } from "./errors.ts";

export type ExitTimers = { after(ms: number, callback: () => void): () => void };
const realTimers: ExitTimers = {
  after(ms, callback) {
    const timer = setTimeout(callback, ms);
    return () => clearTimeout(timer);
  },
};

/** A timeout leaves the caller's exit promise intact, so a later retry still waits for the process. */
export async function waitForExit(
  done: Promise<unknown>,
  message: string,
  timers: ExitTimers = realTimers,
): Promise<void> {
  let cancel = () => {};
  try {
    await Promise.race([
      done,
      new Promise<never>((_, reject) => {
        cancel = timers.after(10_000, () => reject(unavailable(message)));
      }),
    ]);
  } finally {
    cancel();
  }
}
