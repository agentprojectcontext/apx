// In-process event bus. Transports subscribe and forward events to operator sockets.
import type { CoreEvent } from "@apx/protocol";

export type Bus = ReturnType<typeof createBus>;

export function createBus() {
  const listeners = new Set<(event: CoreEvent) => void>();
  return {
    emit(event: CoreEvent): void {
      for (const l of listeners) {
        try {
          l(event);
        } catch {
          // a broken subscriber must not break the writer
        }
      }
    },
    on(listener: (event: CoreEvent) => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
