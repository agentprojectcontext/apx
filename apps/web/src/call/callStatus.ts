import { useEffect } from "react";
import { calls, useCalls } from "../data/calls.ts";
import { client } from "../data/client.ts";

let loading: Promise<void> | undefined;

/** Asks the core again whether calls can run here (when a call button first shows, and after each call). */
export function loadCallStatus(): Promise<void> {
  loading ??= client
    .call("calls.status", {})
    .then((status) => calls.set({ status }))
    .catch(() => undefined)
    .finally(() => {
      loading = undefined;
    });
  return loading;
}

/**
 * Whether calls can ever run here (not a Mac with Apple silicon: never) and the owner allows them, asking the core once
 * when a call button first shows. The card says what else is missing.
 */
export function useCanCall(): boolean {
  const status = useCalls((s) => s.status);
  useEffect(() => {
    if (!calls.get().status) void loadCallStatus();
  }, []);
  return status !== undefined && status.missing !== "platform" && status.missing !== "disabled";
}

export function closeCall(): void {
  calls.set({ card: undefined, live: undefined });
  void loadCallStatus();
}
