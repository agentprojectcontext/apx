import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { ARTIFACT_DB_MAX, ARTIFACT_STORE_MAX } from "@apx/protocol";
import { artifactDir, artifactMemory, memorySummary, QUERY_MAX_ROWS } from "./artifact-memory.ts";

const tmpHome = () => fs.mkdtempSync(path.join(os.tmpdir(), "apx-artifact-mem-"));
const sales = { name: "sales", project_id: "prj_acme" };

test("the store keeps JSON values by key in the artifact's own folder, and a null removes one", () => {
  const home = tmpHome();
  try {
    const mem = artifactMemory({ home });
    assert.deepEqual(mem.storeGet(sales), {});
    assert.equal(mem.exists(sales), false);
    const r = mem.storeSet(sales, { last: { value: 42, at: "2026-01-01" }, note: "hi" });
    assert.equal(r.keys, 2);
    assert.ok(r.bytes > 0);
    assert.equal(mem.file(sales), path.join(home, "artifacts", "prj_acme", "sales", "data.sqlite"));
    assert.deepEqual(mem.storeGet(sales), { last: { value: 42, at: "2026-01-01" }, note: "hi" });
    assert.deepEqual(mem.storeGet(sales, ["note", "missing"]), { note: "hi" });
    mem.storeSet(sales, { note: null });
    assert.deepEqual(mem.storeGet(sales), { last: { value: 42, at: "2026-01-01" } });
    // A global artifact by the same name keeps its own memory.
    assert.deepEqual(mem.storeGet({ name: "sales" }), {});
    assert.throws(() => artifactDir(home, { name: "../x" }), /not an artifact name/);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("the store is refused whole past 5 MB and keeps what it had", () => {
  const home = tmpHome();
  try {
    assert.equal(ARTIFACT_STORE_MAX, 5_000_000);
    const mem = artifactMemory({ home });
    mem.storeSet(sales, { a: "x".repeat(3_000_000) });
    assert.throws(() => mem.storeSet(sales, { b: "y".repeat(2_100_000), c: 1 }), /the most is 5000000/);
    assert.deepEqual(Object.keys(mem.storeGet(sales)), ["a"]);
    // Replacing a value counts its new size, not both.
    assert.equal(mem.storeSet(sales, { a: "z".repeat(4_000_000) }).keys, 1);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("the database runs the artifact's own tables: scripts, params, read-only queries and caps", () => {
  const home = tmpHome();
  try {
    const mem = artifactMemory({ home });
    mem.exec(
      sales,
      "CREATE TABLE orders (id INTEGER PRIMARY KEY AUTOINCREMENT, item TEXT, paid INTEGER); CREATE INDEX o_item ON orders(item)",
    );
    const ins = mem.exec(sales, "INSERT INTO orders (item, paid) VALUES (?, ?)", ["tea", true]);
    assert.deepEqual(ins, { changes: 1, last_id: 1 });
    mem.exec(
      sales,
      "INSERT INTO orders (item, paid) VALUES ('cake', 0); INSERT INTO orders (item, paid) VALUES ('pie', 1)",
    );
    const q = mem.query(sales, "SELECT item, paid FROM orders WHERE paid = ? ORDER BY id", [1]);
    assert.deepEqual(q, {
      columns: ["item", "paid"],
      rows: [
        ["tea", 1],
        ["pie", 1],
      ],
    });
    // The shape of a table may be read.
    assert.equal(mem.query(sales, "PRAGMA table_info(orders)").rows.length, 3);
    // A query never writes, and one with params runs alone.
    assert.throws(() => mem.query(sales, "DELETE FROM orders"), /readonly|read-only/i);
    assert.throws(() => mem.exec(sales, "DELETE FROM orders WHERE id = ?; DROP TABLE orders", [1]), /one statement/);
    // Rows past the cap are cut.
    mem.exec(
      sales,
      `WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 2500) INSERT INTO orders (item, paid) SELECT 'x', 0 FROM n`,
    );
    assert.equal(mem.query(sales, "SELECT * FROM orders").rows.length, QUERY_MAX_ROWS);
    const info = mem.info(sales);
    assert.deepEqual(info.db.tables, [{ name: "orders", rows: 2503 }]);
    assert.match(memorySummary(home, sales), /store: empty; db: orders \(2503 rows\)/);
    mem.storeSet(sales, { k: 1 });
    assert.match(memorySummary(home, sales), /store: 1 keys, \d+ bytes; db: orders/);
    assert.equal(memorySummary(home, { name: "none" }), "store: empty; db: no tables");
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("the database refuses what reaches past its file or its store", () => {
  const home = tmpHome();
  try {
    const mem = artifactMemory({ home });
    mem.exec(sales, "CREATE TABLE t (a)");
    const refused: [string, RegExp][] = [
      [`ATTACH DATABASE '${path.join(home, "other.sqlite")}' AS o`, /not authorized/],
      ["DETACH DATABASE main", /not authorized/],
      [`VACUUM INTO '${path.join(home, "copy.sqlite")}'`, /VACUUM/],
      ["/* hi */ vacuum", /VACUUM/],
      ["PRAGMA writable_schema = 1", /not authorized/],
      ["PRAGMA journal_mode = OFF", /not authorized/],
      ["SELECT load_extension('evil')", /not authorized/],
      ["UPDATE sqlite_sequence SET seq = 1", /not authorized|no such table/],
      ["INSERT INTO sqlite_master VALUES ('table', 'x', 'x', 0, '')", /not authorized|may not be modified/],
      ["INSERT INTO kv VALUES ('a', 'not json', 'now')", /not authorized/],
      ["DROP TABLE kv", /not authorized/],
      ["CREATE TEMP TABLE scratch (a)", /not authorized/],
      ["CREATE TRIGGER sneaky AFTER INSERT ON kv BEGIN SELECT 1; END", /not authorized/],
    ];
    for (const [sql, err] of refused) assert.throws(() => mem.exec(sales, sql), err, sql);
    assert.throws(() => mem.query(sales, "PRAGMA writable_schema"), /not authorized/);
    assert.equal(fs.existsSync(path.join(home, "copy.sqlite")), false);
    assert.equal(fs.existsSync(path.join(home, "other.sqlite")), false);
    // The word inside a string is not the statement.
    assert.deepEqual(mem.query(sales, "SELECT 'vacuum' AS w").rows, [["vacuum"]]);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("the database stops growing at its page cap (50 MB by default)", () => {
  const home = tmpHome();
  try {
    assert.equal(ARTIFACT_DB_MAX, 50_000_000);
    const mem = artifactMemory({ home, dbMax: 200_000 });
    mem.exec(sales, "CREATE TABLE blobs (b BLOB)");
    assert.throws(() => mem.exec(sales, "INSERT INTO blobs VALUES (zeroblob(400000))"), /database is full/);
    assert.ok(fs.statSync(mem.file(sales)).size <= 200_000);
    // The store hits the same file cap.
    assert.throws(() => mem.storeSet(sales, { big: "x".repeat(300_000) }), /full/);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("clearing forgets the store or the database apart, and a bundle's memory loads back", () => {
  const home = tmpHome();
  try {
    const mem = artifactMemory({ home });
    mem.storeSet(sales, { k: "v" });
    mem.exec(sales, "CREATE TABLE t (a); INSERT INTO t VALUES (1)");
    mem.clear(sales, { db: true });
    assert.deepEqual(mem.storeGet(sales), { k: "v" });
    assert.deepEqual(mem.info(sales).db.tables, []);
    mem.exec(sales, "CREATE TABLE t (a); INSERT INTO t VALUES (7)");
    mem.clear(sales, { store: true });
    assert.deepEqual(mem.storeGet(sales), {});
    assert.deepEqual(mem.query(sales, "SELECT a FROM t").rows, [[7]]);

    const dump = mem.dump(sales) as string;
    const copy = { name: "sales-2", project_id: "prj_acme" };
    mem.load(copy, { db: dump, store: { restored: true } });
    assert.deepEqual(mem.query(copy, "SELECT a FROM t").rows, [[7]]);
    assert.deepEqual(mem.storeGet(copy), { restored: true });
    assert.throws(
      () => mem.load({ name: "bad" }, { db: Buffer.from("hello").toString("base64") }),
      /not an SQLite file/,
    );
    assert.equal(mem.exists({ name: "bad" }), false);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});
