import assert from "node:assert/strict";
import { test } from "node:test";
import { fieldsOf, isLong, rowColumns } from "./step-value.ts";

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
