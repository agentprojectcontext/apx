export type GateTimers = {
  set: (run: () => void, ms: number) => unknown;
  clear: (handle: unknown) => void;
};

const realTimers: GateTimers = {
  set: (run, ms) => setTimeout(run, ms),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/**
 * One reload at a time. `now` starts one (or joins the one running, with another to follow); `later` asks for one
 * after `gapMs`, folding every ask in between into it. A reload that takes longer than the gap never overlaps the
 * next: a busy office would otherwise stack whole-workspace downloads until the phone runs out of memory.
 */
export function reloadGate(run: () => Promise<void>, gapMs: number, timers: GateTimers = realTimers) {
  let running: Promise<void> | undefined;
  let again = false;
  let timer: unknown;
  let stopped = false;

  const later = (): void => {
    if (stopped) return;
    if (running) {
      again = true;
      return;
    }
    if (timer === undefined)
      timer = timers.set(() => {
        timer = undefined;
        void now().catch(() => undefined);
      }, gapMs);
  };

  const now = (): Promise<void> => {
    if (stopped) return Promise.resolve();
    if (timer !== undefined) {
      timers.clear(timer);
      timer = undefined;
    }
    if (running) {
      again = true;
      return running;
    }
    const current = Promise.resolve()
      .then(run)
      .finally(() => {
        running = undefined;
        if (again) {
          again = false;
          later();
        }
      });
    running = current;
    return current;
  };

  const stop = (): void => {
    stopped = true;
    again = false;
    if (timer !== undefined) timers.clear(timer);
    timer = undefined;
  };

  // A screen mounted again with the same gate takes it up again.
  const start = (): void => {
    stopped = false;
  };

  return { now, later, start, stop, busy: () => Boolean(running) };
}
