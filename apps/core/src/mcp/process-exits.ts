import { unavailable } from "../errors.ts";

/** Tracks actual stdio process exits, including after the SDK sends SIGKILL. */
export function createProcessExits() {
  const processes = new Map<symbol, { key: string; exited: Promise<void> }>();
  return {
    watch(key: string, transport: { readonly pid: number | null; onclose?: () => void }): () => void {
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
        if (transport.pid !== null) processes.set(id, { key, exited: closed });
      };
    },
    async wait(mine: (key: string) => boolean): Promise<void> {
      const exiting = [...processes.values()].filter((p) => mine(p.key)).map((p) => p.exited);
      if (!exiting.length) return;
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          Promise.all(exiting),
          new Promise<never>((_, reject) => {
            timer = setTimeout(
              () => reject(unavailable("MCP server did not exit; its files were not changed")),
              10_000,
            );
          }),
        ]);
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
