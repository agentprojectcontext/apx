export type GestureContext = {
  signal: AbortSignal;
  check(): void;
};

/** The operation must settle only after its child processes have closed, including on cancellation. */
export function createGestureGate() {
  let epoch = 0;
  let active: AbortController | undefined;
  let drained: Promise<void> | undefined;
  let finish: (() => void) | undefined;
  let closing = false;

  const assertIdle = () => {
    if (active) throw new Error("another pointer action is still finishing; do not retry this action automatically");
    if (closing) throw new Error("computer use is closing; no further actions accepted");
  };
  return {
    assertIdle,
    invalidate() {
      epoch++;
      active?.abort();
    },
    drain() {
      closing = true;
      epoch++;
      active?.abort();
      return drained;
    },
    async run<T>(operation: (context: GestureContext) => Promise<T>): Promise<T> {
      assertIdle();
      const controller = new AbortController();
      const started = epoch;
      active = controller;
      drained = new Promise<void>((resolve) => {
        finish = resolve;
      });
      const check = () => {
        if (controller.signal.aborted || started !== epoch)
          throw new Error("pointer action cancelled; an effect already delivered cannot be withdrawn; do not retry");
      };
      try {
        check();
        const result = await operation({ signal: controller.signal, check });
        check();
        return result;
      } finally {
        active = undefined;
        drained = undefined;
        finish?.();
        finish = undefined;
      }
    },
  };
}
