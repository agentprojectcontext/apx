import { type ExitTimers, waitForExit } from "../process-exit.ts";

/** Tracks actual stdio process exits, including after the SDK sends SIGKILL. */
export function createProcessExits(timers?: ExitTimers) {
  const processes = new Map<symbol, { key: string; exited: Promise<void>; close?: () => Promise<void> }>();
  return {
    watch(
      key: string,
      transport: { readonly pid: number | null; onclose?: () => void; close?: () => Promise<void> },
    ): () => void {
      const id = Symbol(key);
      let exited!: () => void;
      const closed = new Promise<void>((resolve) => {
        exited = resolve;
      });
      const previous = transport.onclose;
      transport.onclose = () => {
        previous?.();
        processes.delete(id);
        exited();
      };
      return () => {
        if (transport.pid !== null)
          processes.set(id, {
            key,
            exited: closed,
            close: transport.close ? () => transport.close?.() ?? Promise.resolve() : undefined,
          });
      };
    },
    async wait(mine: (key: string) => boolean): Promise<void> {
      const exiting = [...processes.values()]
        .filter((p) => mine(p.key))
        .map((p) => Promise.all([p.close?.(), p.exited]));
      if (!exiting.length) return;
      await waitForExit(Promise.all(exiting), "MCP server did not exit; try again", timers);
    },
  };
}
