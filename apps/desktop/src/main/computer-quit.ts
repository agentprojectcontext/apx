export function createPointerQuitBarrier(drain: () => Promise<void> | undefined, quit: () => void) {
  let waiting = false;
  return (event: { preventDefault(): void }) => {
    const pending = drain();
    if (!pending) return;
    event.preventDefault();
    if (waiting) return;
    waiting = true;
    void pending.then(() => {
      waiting = false;
      quit();
    });
  };
}
