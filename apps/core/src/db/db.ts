// One SQLite file per install (WAL). Refuses the real home under a test runner.
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { defaultHome, legacyHome } from "../config.ts";
import { MIGRATIONS } from "./migrations.ts";

export type Db = DatabaseSync;

export function openDb(home: string, env: NodeJS.ProcessEnv = process.env): Db {
  const at = path.resolve(home);
  if (env.NODE_TEST_CONTEXT && (at === defaultHome() || at === legacyHome())) {
    throw new Error(`refusing to open the real ${at} from a test run; pass a temp home`);
  }
  const db = new DatabaseSync(path.join(home, "apx.db"));
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
  migrate(db);
  return db;
}

function migrate(db: Db): void {
  db.exec("CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
  const row = db.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get() as { value: string } | undefined;
  let version = row ? Number(row.value) : 0;
  for (const [i, sql] of MIGRATIONS.entries()) {
    if (i < version) continue;
    db.exec("BEGIN");
    try {
      db.exec(sql);
      version = i + 1;
      db.prepare(
        "INSERT INTO meta (key, value) VALUES ('schema_version', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      ).run(String(version));
      db.exec("COMMIT");
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
  }
}
