// An artifact's own memory beside its row: <home>/artifacts/<project|global>/<name>/data.sqlite holds the `kv` table
// behind APX.store and every other table is the artifact's own (APX.db). Each call opens and closes its connection.
// Statement time is not capped: a slow query holds the core's thread until it ends (the file is at most 50 MB).
import fs from "node:fs";
import path from "node:path";
import { constants as C, DatabaseSync, type SQLInputValue, type StatementSync } from "node:sqlite";
import { ARTIFACT_DB_MAX, ARTIFACT_STORE_MAX, type ArtifactMemory } from "@apx/protocol";
import { badRequest, CallError } from "../errors.ts";

/** Which artifact: its stable name within a project (none: a global one). */
export type ArtifactRef = { name: string; project_id?: string | undefined };
export type SqlParam = string | number | null | boolean;

/** Rows and bytes a query may return before the rest is cut. */
export const QUERY_MAX_ROWS = 2000;
export const QUERY_MAX_BYTES = 2_000_000;

const KV = "kv";
const SQLITE_HEADER = "SQLite format 3\0";
/** PRAGMAs that only read a table's shape. */
const READ_PRAGMAS = new Set(["table_info", "table_list"]);
/** Tables SQLite itself refuses direct writes to (writable_schema is never allowed), touched by CREATE/DROP. */
const SCHEMA_TABLES = new Set(["sqlite_master", "sqlite_schema", "sqlite_temp_master", "sqlite_temp_schema"]);

/** The artifact's folder; refuses anything that could step outside <home>/artifacts. */
export function artifactDir(home: string, a: ArtifactRef): string {
  const scope = a.project_id ?? "global";
  if (!/^[A-Za-z0-9_-]+$/.test(scope) || !/^[a-z0-9][a-z0-9-]*$/.test(a.name))
    throw badRequest(`not an artifact name: ${a.name}`);
  return path.join(home, "artifacts", scope, a.name);
}

/**
 * Refuses what could reach past the artifact's file: ATTACH/DETACH, PRAGMAs other than reading a table's shape,
 * load_extension, temp objects and writes to sqlite_* tables; `guardKv` also keeps APX.db off the store's table.
 */
function authorizer(guardKv: boolean) {
  return (action: number, a: string | null, b: string | null): number => {
    // PRAGMA table_info(t) passes "t" as `b`: both read pragmas are harmless with any argument.
    switch (action) {
      case C.SQLITE_ATTACH:
      case C.SQLITE_DETACH:
      case C.SQLITE_CREATE_TEMP_INDEX:
      case C.SQLITE_CREATE_TEMP_TABLE:
      case C.SQLITE_CREATE_TEMP_TRIGGER:
      case C.SQLITE_CREATE_TEMP_VIEW:
        return C.SQLITE_DENY;
      case C.SQLITE_PRAGMA:
        return a && READ_PRAGMAS.has(a.toLowerCase()) ? C.SQLITE_OK : C.SQLITE_DENY;
      case C.SQLITE_FUNCTION:
        return b?.toLowerCase() === "load_extension" ? C.SQLITE_DENY : C.SQLITE_OK;
      case C.SQLITE_INSERT:
      case C.SQLITE_UPDATE:
      case C.SQLITE_DELETE: {
        const t = a?.toLowerCase() ?? "";
        if (t.startsWith("sqlite_") && !SCHEMA_TABLES.has(t)) return C.SQLITE_DENY;
        return guardKv && t === KV ? C.SQLITE_DENY : C.SQLITE_OK;
      }
      case C.SQLITE_DROP_TABLE:
      case C.SQLITE_ALTER_TABLE:
        return guardKv && (action === C.SQLITE_DROP_TABLE ? a : b)?.toLowerCase() === KV ? C.SQLITE_DENY : C.SQLITE_OK;
      case C.SQLITE_CREATE_TRIGGER:
        return guardKv && b?.toLowerCase() === KV ? C.SQLITE_DENY : C.SQLITE_OK;
      default:
        return C.SQLITE_OK;
    }
  };
}

/**
 * The words of `sql` outside strings, quoted names and comments, and whether more than one statement follows.
 * VACUUM never reaches the authorizer, so it is refused by its word.
 */
function scan(sql: string): { words: Set<string>; statements: number } {
  const words = new Set<string>();
  let statements = 0;
  let pending = false;
  let i = 0;
  const closeOf: Record<string, string> = { "'": "'", '"': '"', "`": "`", "[": "]" };
  while (i < sql.length) {
    const ch = sql[i] as string;
    if (closeOf[ch]) {
      const end = sql.indexOf(closeOf[ch] as string, i + 1);
      i = end < 0 ? sql.length : end + 1;
      pending = true;
    } else if (sql.startsWith("--", i)) {
      const end = sql.indexOf("\n", i);
      i = end < 0 ? sql.length : end + 1;
    } else if (sql.startsWith("/*", i)) {
      const end = sql.indexOf("*/", i + 2);
      i = end < 0 ? sql.length : end + 2;
    } else if (ch === ";") {
      if (pending) statements++;
      pending = false;
      i++;
    } else if (/[A-Za-z_]/.test(ch)) {
      const m = /^[A-Za-z_][A-Za-z0-9_$]*/.exec(sql.slice(i, i + 200)) as RegExpExecArray;
      words.add(m[0].toUpperCase());
      i += m[0].length;
      pending = true;
    } else {
      if (!/\s/.test(ch)) pending = true;
      i++;
    }
  }
  if (pending) statements++;
  return { words, statements };
}

/** Rows as plain JSON values: blobs become base64, big integers numbers. */
function cell(v: unknown): unknown {
  if (v instanceof Uint8Array) return Buffer.from(v).toString("base64");
  if (typeof v === "bigint") return Number(v);
  return v;
}

const bindable = (params: readonly SqlParam[] | undefined): SQLInputValue[] =>
  (params ?? []).map((p) => (typeof p === "boolean" ? Number(p) : p));

export function artifactMemory(deps: { home: string; dbMax?: number; storeMax?: number }) {
  const dbMax = deps.dbMax ?? ARTIFACT_DB_MAX;
  const storeMax = deps.storeMax ?? ARTIFACT_STORE_MAX;
  const fileOf = (a: ArtifactRef) => path.join(artifactDir(deps.home, a), "data.sqlite");
  // Beside the database, so clearing the db or the store keeps where its secrets may go.
  const pinsOf = (a: ArtifactRef) => path.join(artifactDir(deps.home, a), "secret-pins.json");

  /** The artifact's file, created with its kv table on first use; capped at `dbMax` bytes. */
  function open(a: ArtifactRef, opts: { readOnly?: boolean; guarded?: boolean } = {}): DatabaseSync {
    const file = fileOf(a);
    if (!fs.existsSync(file) || !opts.readOnly) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const w = new DatabaseSync(file, { allowExtension: false });
      w.exec(`CREATE TABLE IF NOT EXISTS ${KV} (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL)`);
      if (!opts.readOnly) {
        limit(w);
        if (opts.guarded) w.setAuthorizer(authorizer(true));
        return w;
      }
      w.close();
    }
    const r = new DatabaseSync(file, { readOnly: true, allowExtension: false });
    if (opts.guarded) r.setAuthorizer(authorizer(true));
    return r;
  }
  function limit(db: DatabaseSync) {
    const page = Number((db.prepare("PRAGMA page_size").get() as { page_size: number }).page_size);
    db.exec(`PRAGMA max_page_count = ${Math.max(1, Math.floor(dbMax / page))}`);
  }
  const using = <T>(db: DatabaseSync, f: (db: DatabaseSync) => T): T => {
    try {
      return f(db);
    } finally {
      db.close();
    }
  };
  const fullError = (e: unknown): never => {
    const msg = e instanceof Error ? e.message : String(e);
    if (/full/i.test(msg)) throw badRequest(`the artifact's database is full (the most is ${dbMax} bytes)`);
    throw badRequest(msg);
  };
  const storeSize = (db: DatabaseSync) =>
    db
      .prepare(
        `SELECT count(*) AS n, coalesce(sum(length(CAST(key AS BLOB)) + length(CAST(value AS BLOB))), 0) AS b FROM ${KV}`,
      )
      .get() as { n: number; b: number };
  /** Refuses VACUUM (which writes files) and, with params, a second statement that would be silently dropped. */
  const checked = (sql: string, single: boolean) => {
    const s = scan(sql);
    if (s.words.has("VACUUM")) throw badRequest("VACUUM is not allowed on an artifact's database");
    if (s.statements === 0) throw badRequest("no SQL statement");
    if (single && s.statements > 1) throw badRequest("one statement at a time");
    return s;
  };
  const tables = (db: DatabaseSync) =>
    (
      db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
        .all() as { name: string }[]
    )
      .filter((t) => t.name !== KV)
      .map((t) => ({
        name: t.name,
        rows: Number(
          (db.prepare(`SELECT count(*) AS n FROM "${t.name.replaceAll('"', '""')}"`).get() as { n: number }).n,
        ),
      }));

  const api = {
    file: fileOf,
    dir: (a: ArtifactRef) => artifactDir(deps.home, a),
    exists: (a: ArtifactRef) => fs.existsSync(fileOf(a)),

    storeGet(a: ArtifactRef, keys?: readonly string[]): Record<string, unknown> {
      if (!api.exists(a)) return {};
      return using(open(a, { readOnly: true }), (db) => {
        const rows = (
          keys
            ? keys.length
              ? db.prepare(`SELECT key, value FROM ${KV} WHERE key IN (${keys.map(() => "?").join(",")})`).all(...keys)
              : []
            : db.prepare(`SELECT key, value FROM ${KV}`).all()
        ) as { key: string; value: string }[];
        const out: Record<string, unknown> = {};
        for (const r of rows) {
          try {
            out[r.key] = JSON.parse(r.value);
          } catch {}
        }
        return out;
      });
    },
    /** Sets keys (null removes one) in one transaction, refused whole past the store's cap. */
    storeSet(a: ArtifactRef, patch: Record<string, unknown>): { keys: number; bytes: number } {
      return using(open(a), (db) => {
        const ts = new Date().toISOString();
        const put = db.prepare(
          `INSERT INTO ${KV} (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
        );
        const del = db.prepare(`DELETE FROM ${KV} WHERE key = ?`);
        db.exec("BEGIN");
        try {
          for (const [k, v] of Object.entries(patch)) {
            const json = v === null || v === undefined ? undefined : JSON.stringify(v);
            if (json === undefined) del.run(k);
            else put.run(k, json, ts);
          }
          const size = storeSize(db);
          if (size.b > storeMax) throw badRequest(`the store would hold ${size.b} bytes; the most is ${storeMax}`);
          db.exec("COMMIT");
          return { keys: Number(size.n), bytes: Number(size.b) };
        } catch (e) {
          // A full file has already rolled the transaction back.
          if (db.isTransaction) db.exec("ROLLBACK");
          if (e instanceof CallError) throw e;
          return fullError(e);
        }
      });
    },
    /** A read-only statement; rows past QUERY_MAX_ROWS or QUERY_MAX_BYTES are cut. */
    query(a: ArtifactRef, sql: string, params?: readonly SqlParam[]): { columns: string[]; rows: unknown[][] } {
      checked(sql, true);
      return using(open(a, { readOnly: true, guarded: true }), (db) => {
        let stmt: StatementSync;
        try {
          stmt = db.prepare(sql);
        } catch (e) {
          return fullError(e);
        }
        stmt.setReturnArrays(true);
        const columns = stmt.columns().map((c) => c.name);
        const rows: unknown[][] = [];
        let bytes = 0;
        try {
          for (const raw of stmt.iterate(...bindable(params)) as Iterable<unknown[]>) {
            const row = raw.map(cell);
            bytes += JSON.stringify(row).length;
            if (rows.length >= QUERY_MAX_ROWS || bytes > QUERY_MAX_BYTES) break;
            rows.push(row);
          }
        } catch (e) {
          return fullError(e);
        }
        return { columns, rows };
      });
    },
    /** A writing statement, or a script of several when there are no params. */
    exec(a: ArtifactRef, sql: string, params?: readonly SqlParam[]): { changes: number; last_id: number | null } {
      const single = (params?.length ?? 0) > 0;
      checked(sql, single);
      return using(open(a, { guarded: true }), (db) => {
        try {
          if (single) {
            const r = db.prepare(sql).run(...bindable(params));
            return { changes: Number(r.changes), last_id: r.changes ? Number(r.lastInsertRowid) : null };
          }
          const before = Number((db.prepare("SELECT total_changes() AS n").get() as { n: number }).n);
          db.exec(sql);
          const after = db.prepare("SELECT total_changes() AS n, last_insert_rowid() AS id").get() as {
            n: number;
            id: number;
          };
          const changes = Number(after.n) - before;
          return { changes, last_id: changes && Number(after.id) ? Number(after.id) : null };
        } catch (e) {
          return fullError(e);
        }
      });
    },
    /** Store keys and bytes, database size and tables (the store's own table left out), and secret pins. */
    info(a: ArtifactRef): Omit<ArtifactMemory, "state_chars"> {
      const secrets = Object.entries(api.pins(a))
        .sort(([x], [y]) => x.localeCompare(y))
        .map(([key, origin]) => ({ key, origin }));
      if (!api.exists(a)) return { store: { keys: [], bytes: 0 }, db: { bytes: 0, tables: [] }, secrets };
      return using(open(a, { readOnly: true }), (db) => {
        const keys = (db.prepare(`SELECT key FROM ${KV} ORDER BY key`).all() as { key: string }[]).map((r) => r.key);
        return {
          store: { keys, bytes: Number(storeSize(db).b) },
          db: { bytes: fs.statSync(fileOf(a)).size, tables: tables(db) },
          secrets,
        };
      });
    },
    /** The origin each secret key was first sent to (trust on first use). */
    pins(a: ArtifactRef): Record<string, string> {
      try {
        const raw = JSON.parse(fs.readFileSync(pinsOf(a), "utf8")) as unknown;
        if (!raw || typeof raw !== "object") return {};
        return Object.fromEntries(Object.entries(raw).filter(([, v]) => typeof v === "string")) as Record<
          string,
          string
        >;
      } catch {
        return {};
      }
    },
    /** Pins a secret key to an origin, unless it already has one. */
    pin(a: ArtifactRef, key: string, origin: string): void {
      const all = api.pins(a);
      if (all[key]) return;
      all[key] = origin;
      fs.mkdirSync(path.dirname(pinsOf(a)), { recursive: true });
      const tmp = `${pinsOf(a)}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(all, null, 2));
      fs.renameSync(tmp, pinsOf(a));
    },
    /** Forgets the store, the database (its own tables), the secret pins (never the values), or several. */
    clear(a: ArtifactRef, parts: { store?: boolean; db?: boolean; secrets?: boolean }): void {
      if (parts.secrets) fs.rmSync(pinsOf(a), { force: true });
      if (!api.exists(a)) return;
      if (parts.db) {
        const kept = parts.store ? {} : api.storeGet(a);
        fs.rmSync(fileOf(a), { force: true });
        for (const suffix of ["-journal", "-wal", "-shm"]) fs.rmSync(fileOf(a) + suffix, { force: true });
        if (Object.keys(kept).length) api.storeSet(a, kept);
        return;
      }
      if (parts.store) using(open(a), (db) => db.exec(`DELETE FROM ${KV}`));
    },
    /** The whole file as base64, when there is one. */
    dump(a: ArtifactRef): string | undefined {
      return api.exists(a) ? fs.readFileSync(fileOf(a)).toString("base64") : undefined;
    },
    /** Replaces the artifact's memory with a bundle's: a database file (checked), then its store. */
    load(a: ArtifactRef, data: { db?: string | undefined; store?: Record<string, unknown> | undefined }): void {
      const dir = artifactDir(deps.home, a);
      fs.rmSync(dir, { recursive: true, force: true });
      if (data.db) {
        const bytes = Buffer.from(data.db, "base64");
        if (bytes.length > dbMax)
          throw badRequest(`the bundle's database is ${bytes.length} bytes; the most is ${dbMax}`);
        if (bytes.subarray(0, 16).toString("latin1") !== SQLITE_HEADER)
          throw badRequest("the bundle's database is not an SQLite file");
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(fileOf(a), bytes);
        try {
          using(new DatabaseSync(fileOf(a), { allowExtension: false }), (db) => {
            const ok = db.prepare("PRAGMA quick_check").get() as { quick_check: string };
            if (ok.quick_check !== "ok") throw new Error(ok.quick_check);
            db.exec("PRAGMA journal_mode = DELETE");
          });
        } catch (e) {
          fs.rmSync(dir, { recursive: true, force: true });
          throw badRequest(`the bundle's database is damaged: ${e instanceof Error ? e.message : e}`);
        }
        // Its store comes from the bundle's `store`, never from rows inside the file.
        using(open(a), (db) => db.exec(`DELETE FROM ${KV}`));
      }
      if (data.store && Object.keys(data.store).length) api.storeSet(a, data.store);
    },
    /** The schema version the artifact gave its database (PRAGMA user_version), when it set one. */
    dataVersion(a: ArtifactRef): number | undefined {
      if (!api.exists(a)) return undefined;
      const v = using(open(a, { readOnly: true }), (db) =>
        Number((db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version),
      );
      return v > 0 ? v : undefined;
    },
  };
  return api;
}
export type ArtifactMemoryStore = ReturnType<typeof artifactMemory>;

/** One line for an agent: store keys and bytes, database tables with their rows (never the contents). */
export function memorySummary(home: string, a: ArtifactRef): string {
  const info = artifactMemory({ home }).info(a);
  const store = info.store.keys.length
    ? `store: ${info.store.keys.length} keys, ${info.store.bytes} bytes`
    : "store: empty";
  const db = info.db.tables.length
    ? `db: ${info.db.tables.map((t) => `${t.name} (${t.rows} rows)`).join(", ")}`
    : "db: no tables";
  return `${store}; ${db}`;
}
