type Socket = {
  listen(events: { open(): void; closed(): void; message(data: unknown): void }): () => void;
  close(): void;
};
type Dependencies = {
  metadata(signal: AbortSignal): Promise<unknown>;
  socket(): Socket;
  hidden(): boolean;
  visibility(notify: () => void): () => void;
  after(ms: number, notify: () => void): () => void;
};

export function createPublicationWatch(
  deps: Dependencies,
  changed: (state: "waiting" | "live" | "missing", metadata?: unknown) => void,
  failed: (missing: boolean) => void,
) {
  let active = true;
  let terminal = false;
  let generation = 0;
  let retry = 1000;
  let socket: Socket | undefined;
  let detach: (() => void) | undefined;
  let cancelDeadline: (() => void) | undefined;
  let cancelReconnect: (() => void) | undefined;
  let request: AbortController | undefined;
  const valid = (expected: number) => active && !terminal && !deps.hidden() && expected === generation;
  function disconnect() {
    generation++;
    request?.abort();
    detach?.();
    detach = undefined;
    try {
      socket?.close();
    } catch {}
    socket = undefined;
    cancelDeadline?.();
    cancelDeadline = undefined;
    cancelReconnect?.();
    cancelReconnect = undefined;
  }
  function unavailable(expected: number) {
    if (!valid(expected)) return;
    disconnect();
    failed(false);
    cancelReconnect = deps.after(retry, () => {
      cancelReconnect = undefined;
      void connect();
    });
    retry = Math.min(retry * 2, 30_000);
  }
  function missing() {
    terminal = true;
    disconnect();
    changed("missing");
  }
  async function connect() {
    disconnect();
    if (!active || terminal || deps.hidden()) return;
    const expected = generation;
    changed("waiting");
    request = new AbortController();
    cancelDeadline = deps.after(10_000, () => unavailable(expected));
    try {
      const meta = await deps.metadata(request.signal);
      if (!valid(expected)) return;
      changed("live", meta);
      socket = deps.socket();
      detach = socket.listen({
        open: () => {
          if (!valid(expected)) return;
          cancelDeadline?.();
          cancelDeadline = undefined;
          retry = 1000;
          // Changes before registration have no replay; read again once the socket is registered.
          changed("live");
        },
        closed: () => unavailable(expected),
        message: (data) => {
          if (!valid(expected)) return;
          try {
            if (typeof data !== "string" || data.length > 4096) throw new Error("invalid_event");
            const message = JSON.parse(data) as { state?: unknown };
            if (message.state === "missing") missing();
            else if (message.state === "live") changed("live");
            else throw new Error("invalid_event");
          } catch {
            unavailable(expected);
          }
        },
      });
    } catch (error) {
      if (!valid(expected)) return;
      if (error instanceof Error && error.message === "public_artifact_missing") missing();
      else unavailable(expected);
    }
  }
  const removeVisibility = deps.visibility(() => {
    if (!active || terminal) return;
    if (deps.hidden()) {
      disconnect();
      failed(false);
    } else void connect();
  });
  void connect();
  return () => {
    active = false;
    disconnect();
    removeVisibility();
  };
}
