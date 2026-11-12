import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { acquireDaemonLock } from "../daemon-lock.ts";
import { reconcileHotfixLineage } from "./migration-hotfix.ts";

/** Offline maintenance uses the daemon's exclusion boundary, never a second live writer. */
export function repairOfflineDatabase(home: string): { repaired: boolean; version: number; backup: string } {
  const file = path.join(home, "apx.db");
  if (!fs.existsSync(file)) throw new Error("No existing database to repair. Check APX_HOME; no database was created.");
  const lock = acquireDaemonLock(home);
  let db: DatabaseSync | undefined;
  let backup = "";
  try {
    db = new DatabaseSync(file);
    // Keep SQLite's writer exclusion across the backup and repair transactions, including WAL mode.
    db.exec(
      "PRAGMA busy_timeout = 0; PRAGMA foreign_keys = ON; PRAGMA locking_mode = EXCLUSIVE; BEGIN EXCLUSIVE; COMMIT",
    );
    const version = Number(db.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get()?.value);
    if (version !== 109)
      throw new Error("No supported offline repair for this database. Keep the data and use a matching APX version.");
    const repaired = reconcileHotfixLineage(db, home, version, (file) => {
      backup = file;
    });
    if (repaired === version)
      throw new Error(
        "No recognized hotfix migration to repair. Keep the data; share the doctor diagnosis with support.",
      );
    return { repaired: true, version: repaired, backup };
  } catch (error) {
    if (backup)
      throw new Error(
        `${error instanceof Error ? error.message : String(error)} Repair failed; keep the database and pre-repair backup: ${backup}`,
        { cause: error },
      );
    throw error;
  } finally {
    try {
      db?.close();
    } finally {
      lock.release();
    }
  }
}
