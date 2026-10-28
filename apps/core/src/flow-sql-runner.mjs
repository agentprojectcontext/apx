// Runs one Flow SQL step on a SQLite file (DECISIONS.md#d-170), in a process of its own so a slow query can be
// stopped. node:sqlite does not follow Node's permission model, so what a statement may do is the authorizer's: one
// statement on the main database, reads (and for a write: inserts, updates, deletes, new tables and indexes), never
// another file (ATTACH, VACUUM INTO), a pragma or an extension. Values arrive only as bound parameters. Reads one JSON
// request on stdin, writes one JSON line on stdout.
import { constants as C, DatabaseSync } from "node:sqlite";

const write = process.stdout.write.bind(process.stdout);
const say = (answer) => write(`${JSON.stringify(answer)}\n`);
/** Why it stopped; thrown, so the run ends where it is and this process ends once its line is written. */
class Stop extends Error {
  constructor(error, message) {
    super(error);
    this.answer = { ok: false, error, ...(message ? { message: String(message).slice(0, 500) } : {}) };
  }
}
const fail = (error, message) => {
  throw new Stop(error, message);
};

/** The whole run, as the line to write. */
async function main() {
  let raw = "";
  for await (const chunk of process.stdin) raw += chunk;
  const { file, mode, query, params, maxRows, maxBytes, busyMs } = JSON.parse(raw);
  const writes = mode === "write";

  const READS = new Set(["SELECT", "WITH", "VALUES"]);
  const WRITES = new Set([...READS, "INSERT", "UPDATE", "DELETE", "REPLACE", "CREATE"]);
  // A statement's first word (after comments): VACUUM INTO writes a file and no authorizer hears of it.
  const first = /^(?:\s|--[^\n]*(?:\n|$)|\/\*[\s\S]*?\*\/)*([A-Za-z]+)/.exec(query)?.[1]?.toUpperCase() ?? "";
  if (!(writes ? WRITES : READS).has(first)) fail("query_failed", "That statement is not allowed here");

  const ALLOWED = new Set([
    C.SQLITE_SELECT,
    C.SQLITE_READ,
    C.SQLITE_FUNCTION,
    C.SQLITE_RECURSIVE,
    ...(writes
      ? [C.SQLITE_INSERT, C.SQLITE_UPDATE, C.SQLITE_DELETE, C.SQLITE_CREATE_TABLE, C.SQLITE_CREATE_INDEX]
      : []),
  ]);
  const FUNCTIONS_REFUSED = new Set(["load_extension", "fts3_tokenizer", "readfile", "writefile", "edit", "zipfile"]);

  let db;
  try {
    db = new DatabaseSync(file, { readOnly: !writes, allowExtension: false, timeout: busyMs });
    // Before the authorizer: a database's own views and triggers can't call functions with effects, and SQLite's
    // memory is bounded like the heap.
    db.exec("PRAGMA trusted_schema = OFF; PRAGMA hard_heap_limit = 67108864;");
    if (!writes) db.exec("PRAGMA query_only = ON;");
  } catch (err) {
    fail("database_unavailable", err?.message);
  }
  db.setAuthorizer((action, a, b, database) => {
    if (!ALLOWED.has(action)) return C.SQLITE_DENY;
    if (database !== null && database !== "main") return C.SQLITE_DENY;
    if (action === C.SQLITE_FUNCTION && FUNCTIONS_REFUSED.has(String(b).toLowerCase())) return C.SQLITE_DENY;
    return C.SQLITE_OK;
  });

  let stmt;
  try {
    stmt = db.prepare(query);
  } catch (err) {
    fail("query_failed", err?.message);
  }
  // One statement: whatever follows the first is never run, so it is refused rather than ignored.
  const tail = query.slice(stmt.sourceSQL.length);
  if (!/^(?:\s|;|--[^\n]*(?:\n|$)|\/\*[\s\S]*?\*\/)*$/.test(tail)) fail("query_failed", "One statement per step");

  stmt.setAllowBareNamedParameters(true);
  stmt.setAllowUnknownNamedParameters(false);
  const bound = Object.create(null);
  for (const [name, value] of Object.entries(params ?? {}))
    bound[name] =
      value === null || typeof value === "number" || typeof value === "string"
        ? value
        : typeof value === "boolean"
          ? Number(value)
          : JSON.stringify(value);

  const cell = (v) =>
    v instanceof Uint8Array
      ? { blob: v.byteLength }
      : typeof v === "bigint"
        ? v.toString()
        : v === undefined
          ? null
          : v;
  try {
    const columns = stmt.columns().map((c) => c.name);
    const rows = [];
    let bytes = 0;
    let truncated = false;
    if (columns.length) {
      for (const row of stmt.iterate(bound)) {
        const clean = Object.fromEntries(Object.entries(row).map(([k, v]) => [k, cell(v)]));
        bytes += Buffer.byteLength(JSON.stringify(clean));
        if (rows.length >= maxRows || bytes > maxBytes) {
          truncated = true;
          break;
        }
        rows.push(clean);
      }
    }
    const changed = writes ? (columns.length ? undefined : stmt.run(bound)) : undefined;
    const after = writes ? db.prepare("SELECT changes() AS c, last_insert_rowid() AS id").get() : undefined;
    return {
      ok: true,
      value: {
        ...(columns.length ? { columns, rows, count: rows.length, truncated } : {}),
        ...(writes
          ? {
              changes: Number(changed?.changes ?? after?.c ?? 0),
              last_id: Number(changed?.lastInsertRowid ?? after?.id ?? 0),
            }
          : {}),
      },
    };
  } catch (err) {
    fail("query_failed", err?.message);
  }
}
try {
  say(await main());
} catch (err) {
  say(err instanceof Stop ? err.answer : { ok: false, error: "query_failed", message: err?.message });
}
