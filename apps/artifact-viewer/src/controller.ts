import type { readPublicCopy } from "./read.ts";

type Copy = Awaited<ReturnType<typeof readPublicCopy>>;
type After = (ms: number, callback: () => void) => () => void;
type Status = "loading" | "ready" | "missing" | "offline";
type State = { status: Status; copy?: Copy; downloading: boolean };
type Watch = (
  changed: (state: "waiting" | "live" | "missing", metadata?: unknown) => void,
  failed: (missing: boolean) => void,
) => () => void;

function boundedRead(load: () => Promise<Copy>, after: After, signal: AbortSignal) {
  let cancel = () => {};
  let aborted = () => {};
  const deadline = new Promise<never>((_resolve, reject) => {
    aborted = () => reject(new Error("public_copy_cancelled"));
    signal.addEventListener("abort", aborted, { once: true });
    cancel = after(15_000, () => reject(new Error("public_copy_deadline")));
    if (signal.aborted) aborted();
  });
  const reading = Promise.resolve().then(() => {
    if (signal.aborted) throw new Error("public_copy_cancelled");
    return load();
  });
  return Promise.race([reading, deadline]).finally(() => {
    cancel();
    signal.removeEventListener("abort", aborted);
  });
}

export function createPublicationController(deps: {
  valid: boolean;
  load(metadata?: unknown): Promise<Copy>;
  watch: Watch;
  after: After;
  online(): boolean;
}) {
  let state: State = { status: deps.valid ? "loading" : "missing", downloading: false };
  const listeners = new Set<() => void>();
  let generation = 0;
  let active = false;
  let subscription = 0;
  let operation = new AbortController();
  let unsubscribe: (() => void) | undefined;
  let cancelWaiting: (() => void) | undefined;
  const emit = (next: State) => {
    state = next;
    for (const notify of listeners) notify();
  };
  const invalidate = () => {
    generation++;
    operation.abort();
    operation = new AbortController();
    cancelWaiting?.();
    cancelWaiting = undefined;
  };
  const unavailable = (status: "offline" | "missing") => {
    invalidate();
    emit({ status, downloading: false });
  };
  const load = (metadata?: unknown) => {
    invalidate();
    emit({ status: "loading", downloading: false });
    const expected = generation;
    void boundedRead(() => deps.load(metadata), deps.after, operation.signal).then(
      (copy) => {
        if (expected === generation) emit({ status: "ready", copy, downloading: false });
      },
      () => {
        if (expected === generation) unavailable("offline");
      },
    );
  };
  const waiting = () => {
    if (!deps.online()) {
      unavailable("offline");
      return;
    }
    emit({ status: "loading", downloading: false });
    if (!cancelWaiting) cancelWaiting = deps.after(15_000, () => unavailable("offline"));
  };
  return {
    snapshot: () => state,
    subscribe(notify: () => void) {
      listeners.add(notify);
      return () => {
        listeners.delete(notify);
      };
    },
    start() {
      active = true;
      const expectedSubscription = ++subscription;
      unsubscribe?.();
      invalidate();
      if (!deps.valid) {
        emit({ status: "missing", downloading: false });
        return;
      }
      waiting();
      unsubscribe = deps.watch(
        (next, metadata) => {
          if (expectedSubscription !== subscription) return;
          if (next === "live") load(metadata);
          else if (next === "missing") unavailable("missing");
          else {
            invalidate();
            waiting();
          }
        },
        (missing) => {
          if (expectedSubscription === subscription) unavailable(missing ? "missing" : "offline");
        },
      );
    },
    stop() {
      active = false;
      subscription++;
      unsubscribe?.();
      unsubscribe = undefined;
      invalidate();
    },
    offline() {
      unavailable("offline");
    },
    async download() {
      if (!active || !state.copy || state.status !== "ready" || state.downloading) return;
      const expected = generation;
      const hash = state.copy.sha256;
      emit({ ...state, downloading: true });
      try {
        const copy = await boundedRead(deps.load, deps.after, operation.signal);
        if (expected !== generation) return;
        if (copy.sha256 !== hash) throw new Error("public_copy_changed");
        return { copy, current: () => expected === generation };
      } catch {
        if (expected === generation) unavailable("offline");
      } finally {
        if (expected === generation) emit({ ...state, downloading: false });
      }
    },
  };
}
