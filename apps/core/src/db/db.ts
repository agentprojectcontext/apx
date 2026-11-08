// One SQLite file per install (WAL). Refuses the real home under a test runner.
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { defaultHome, legacyHome } from "../config.ts";
import { reconcileMigrationLineage } from "./migration-lineage.ts";
import { MIGRATIONS } from "./migrations.ts";

export type Db = DatabaseSync;

export function openDb(home: string, env: NodeJS.ProcessEnv = process.env): Db {
  const at = path.resolve(home);
  if (env.NODE_TEST_CONTEXT && (at === defaultHome() || at === legacyHome())) {
    throw new Error(`refusing to open the real ${at} from a test run; pass a temp home`);
  }
  const db = new DatabaseSync(path.join(home, "apx.db"));
  // A new store hands freed pages back to the disk bit by bit; an older one needs one rebuild first (storeRebuild).
  try {
    db.exec(
      "PRAGMA auto_vacuum = INCREMENTAL; PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;",
    );
    migrate(db, home);
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}

export type StoreSize = { bytes: number; free_bytes: number; incremental: boolean };

const pragma = (db: Db, name: string) => Number(Object.values(db.prepare(`PRAGMA ${name}`).get() ?? {})[0] ?? 0);

/** The store's size, the part of it that is free pages, and whether free pages can be given back without a rebuild. */
export function storeSize(db: Db): StoreSize {
  const page = pragma(db, "page_size");
  return {
    bytes: pragma(db, "page_count") * page,
    free_bytes: pragma(db, "freelist_count") * page,
    incremental: pragma(db, "auto_vacuum") === 2,
  };
}

/** Gives up to `pages` free pages back to the disk (all with none); only on a store made incremental. */
export function storeReclaim(db: Db, pages?: number): void {
  if (!storeSize(db).incremental) return;
  db.exec(`PRAGMA incremental_vacuum${pages === undefined ? "" : `(${Math.max(1, Math.floor(pages))})`}`);
  db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
}

/** Writes a compact copy of the store to `file` (a new file, without free pages), consistent while the core runs. */
export function storeCopy(db: Db, file: string): void {
  db.prepare("VACUUM INTO ?").run(file);
}

/** Rewrites the whole file without its free pages, incremental from then on. Blocks while it runs. */
export function storeRebuild(db: Db): void {
  db.exec("PRAGMA auto_vacuum = INCREMENTAL");
  db.exec("VACUUM");
  db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
}

function migrate(db: Db, home: string): void {
  db.exec("CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
  const row = db.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get() as { value: string } | undefined;
  let version = row ? Number(row.value) : 0;
  if (
    !Number.isSafeInteger(version) ||
    version < 0 ||
    version > MIGRATIONS.length ||
    (row && !/^\d+$/.test(row.value))
  ) {
    throw new Error("Unsupported database schema_version; keep the data and use a matching program version");
  }
  version = reconcileMigrationLineage(db, home, version);
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
