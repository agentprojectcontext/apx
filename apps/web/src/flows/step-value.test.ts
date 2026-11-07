import assert from "node:assert/strict";
import { test } from "node:test";
import { fieldsOf, isLong, partKey, repeats, rowColumns } from "./step-value.ts";

test("only an object or a list reads as fields", () => {
  assert.deepEqual(fieldsOf('{ "a": 1, "b": ["x"] }'), { a: 1, b: ["x"] });
  assert.deepEqual(fieldsOf("\n [1, 2]"), [1, 2]);
  assert.equal(fieldsOf("WhatsApp → You\n\nHello"), undefined);
  assert.equal(fieldsOf('"just text"'), undefined);
  assert.equal(fieldsOf("42"), undefined);
  assert.equal(fieldsOf("null"), undefined);
  assert.equal(fieldsOf("{ not json"), undefined);
});

test("long or multi-line text gets a block of its own", () => {
  assert.equal(isLong("short"), false);
  assert.equal(isLong("one\ntwo"), true);
  assert.equal(isLong("x".repeat(81)), true);
});

test("rows show the table's columns, else the fields they have", () => {
  const rows = [{ value: { answer: "a", at: "t" } }, { value: { answer: "b", extra: 1 } }];
  assert.deepEqual(rowColumns(["at"], rows), ["at"]);
  assert.deepEqual(rowColumns([], rows), ["answer", "at", "extra"]);
  assert.deepEqual(rowColumns([], [{ value: "plain" }, { value: { n: 1 } }]), ["value", "n"]);
  assert.deepEqual(rowColumns([], []), []);
});

test("a table read's row shows once: as columns; row and rows only repeat it", () => {
  const read = {
    answer: "long text",
    at: "2026-10-31",
    rows: { demo: { at: "2026-10-31", answer: "long text" } },
    row: { answer: "long text", at: "2026-10-31" },
  };
  assert.deepEqual([...repeats(read)].sort(), [partKey(["row"]), partKey(["rows", "demo"])].sort());
  // Two keys read: rows holds a row not shown above, so only the first one repeats.
  const two = { ...read, rows: { demo: read.row, other: { answer: "x", at: "y" } } };
  assert.deepEqual([...repeats(two)].sort(), [partKey(["row"]), partKey(["rows", "demo"])].sort());
  // Nothing repeats in data that holds no copy; empty parts never count.
  assert.equal(repeats({ a: { x: 1 }, b: { x: 2 }, c: {}, d: {} }).size, 0);
  assert.deepEqual([...repeats([{ x: 1 }, { x: 1 }])], [partKey(["2"])]);
});
