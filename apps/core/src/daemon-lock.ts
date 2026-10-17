import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

/** An OS-released lock, independent of the listening port; never delete the file while a daemon may hold it. */
export function acquireDaemonLock(home: string): { release(): void } {
  fs.mkdirSync(home, { recursive: true });
  const canonical = fs.realpathSync(home);
  const db = new DatabaseSync(path.join(canonical, "daemon-lock.sqlite"));
  try {
    db.exec("PRAGMA busy_timeout = 0; BEGIN EXCLUSIVE");
    db.exec("CREATE TABLE IF NOT EXISTS daemon_lock (id INTEGER PRIMARY KEY)");
  } catch (error) {
    db.close();
    if ((error as { errcode?: number }).errcode === 5)
      throw new Error(`A daemon already owns ${canonical}. Connect to it or stop its supervisor first.`);
    throw error;
  }
  let released = false;
  return {
    release() {
      if (released) return;
      released = true;
      db.close();
    },
  };
}
