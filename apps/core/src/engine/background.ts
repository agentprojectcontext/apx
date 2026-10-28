// Background checks: work the core keeps on the office clock by itself, such as an integration's reminders. They are
// not routines: the owner turns each one on or off where it lives (an integration's settings), not in the routines list.
import type { Log } from "../log.ts";

export type BackgroundCheck = {
  id: string;
  /** How often it runs; a run that is still going is never started again. */
  everyMs: number;
  run: (at: Date) => void | Promise<void>;
};

export function createBackground(log: Log, checks: readonly BackgroundCheck[] = []) {
  const state = new Map(checks.map((c) => [c.id, { check: c, lastAt: Number.NEGATIVE_INFINITY, running: false }]));
  const failed = (id: string, err: unknown) =>
    log.warn({ check: id, err: String(err).slice(0, 200) }, "background check failed");
  return {
    /** Called on each beat of the office clock: runs every check whose time came. */
    tick(at: Date): void {
      for (const s of state.values()) {
        if (s.running || at.getTime() - s.lastAt < s.check.everyMs) continue;
        s.lastAt = at.getTime();
        try {
          const done = s.check.run(at);
          if (!(done instanceof Promise)) continue;
          s.running = true;
          done.catch((err) => failed(s.check.id, err)).finally(() => (s.running = false));
        } catch (err) {
          failed(s.check.id, err);
        }
      }
    },
  };
}
