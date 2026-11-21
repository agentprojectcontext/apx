// The thread the store's checkpoints run in (checkpointer.ts): its own connection copies the log into the file and
// syncs it, so the core's event loop never waits on that fsync.
import { DatabaseSync } from "node:sqlite";
import { parentPort, workerData } from "node:worker_threads";

const { file, everyMs } = workerData as { file: string; everyMs: number };
const db = new DatabaseSync(file);
db.exec("PRAGMA busy_timeout = 1000");

// PASSIVE never waits on the core's writes; with nothing new in the log it copies and syncs nothing.
const checkpoint = () => {
  try {
    db.exec("PRAGMA wal_checkpoint(PASSIVE)");
  } catch {}
};
const timer = setInterval(checkpoint, everyMs);
parentPort?.on("message", (m: string) => {
  if (m !== "close") return;
  clearInterval(timer);
  checkpoint();
  db.close();
  parentPort?.close();
});
parentPort?.postMessage("ready");
