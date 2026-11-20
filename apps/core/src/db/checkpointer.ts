// Checkpoints off the event loop (DECISIONS.md#d-259): a thread of its own copies the write-ahead log into the store
// and syncs it, and the core's connection stops checkpointing on its own while that thread is up.
import path from "node:path";
import { Worker } from "node:worker_threads";
import type { Db } from "./db.ts";

/** SQLite's own default: what the core's connection goes back to whenever the thread is not there. */
const AUTO_PAGES = 1000;

export type Checkpointer = { close(): Promise<void> };

export function startCheckpointer(
  db: Db,
  home: string,
  opts: { everyMs?: number; closeMs?: number } = {},
): Checkpointer {
  const worker = new Worker(new URL("./checkpointer-worker.ts", import.meta.url), {
    workerData: { file: path.join(home, "apx.db"), everyMs: opts.everyMs ?? 500 },
  });
  worker.unref();
  let up = false;
  let closed = false;
  let gone = false;
  const fallBack = () => {
    if (!up || closed) return;
    up = false;
    db.exec(`PRAGMA wal_autocheckpoint = ${AUTO_PAGES}`);
  };
  worker.on("message", (m) => {
    if (m !== "ready" || closed) return;
    db.exec("PRAGMA wal_autocheckpoint = 0");
    up = true;
  });
  // A thread that fails or ends leaves the core checkpointing as before, never with a log that only grows.
  worker.on("error", fallBack);
  worker.on("exit", () => {
    gone = true;
    fallBack();
  });
  return {
    async close() {
      if (closed) return;
      if (up) db.exec(`PRAGMA wal_autocheckpoint = ${AUTO_PAGES}`);
      closed = true;
      up = false;
      if (gone) return;
      const exited = new Promise<void>((resolve) => worker.once("exit", () => resolve()));
      worker.postMessage("close");
      const deadline = setTimeout(() => void worker.terminate(), opts.closeMs ?? 2000);
      await exited;
      clearTimeout(deadline);
    },
  };
}
