/** `terminal.input` carries at most this much (see the protocol); a longer paste goes up in pieces. */
const MAX_CHUNK = 64 * 1024;

/**
 * Keys typed into one terminal, delivered in the order they were typed. Each call is its own HTTP request and the
 * browser sends them over several connections, so firing one per keystroke lets a later one land first. Here one is
 * in flight at a time; what is typed meanwhile waits and goes up together when it answers.
 */
export function createInputQueue(send: (data: string) => Promise<unknown>): (data: string) => void {
  let waiting = "";
  let sending = false;
  const drain = async () => {
    sending = true;
    while (waiting) {
      const data = waiting.slice(0, MAX_CHUNK);
      waiting = waiting.slice(data.length);
      try {
        await send(data);
      } catch {
        // A failed keystroke is lost, as before; the ones after it still go.
      }
    }
    sending = false;
  };
  return (data) => {
    waiting += data;
    if (!sending) void drain();
  };
}
