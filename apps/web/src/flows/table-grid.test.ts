import assert from "node:assert/strict";
import { test } from "node:test";
import { cellText, cellValue, changedCells, gridRows } from "./table-grid.ts";

test("a typed cell keeps numbers, true/false and JSON as values, and anything else as text", () => {
  assert.equal(cellValue("42"), 42);
  assert.equal(cellValue("-1.5"), -1.5);
  assert.equal(cellValue("true"), true);
  assert.deepEqual(cellValue("[1, 2]"), [1, 2]);
  assert.deepEqual(cellValue('{"a":1}'), { a: 1 });
  assert.equal(cellValue("0800 555"), "0800 555");
  assert.equal(cellValue("007"), "007", "leading zeros stay text, like a code or a phone");
  assert.equal(cellValue("[not json"), "[not json");
  assert.equal(cellValue("Alex"), "Alex");
  assert.equal(cellValue("  "), null);
  assert.equal(cellText(null), "");
  assert.equal(cellText({ a: 1 }), '{"a":1}');
});

test("rows show by column, an older row saved whole shows in its value column, and an edit sends only what changed", () => {
  const rows = gridRows({ columns: ["name", "value"] }, [
    { key: "a", value: { name: "Alex", hidden: 1 }, updated_at: "2026-10-29T00:00:00.000Z" },
    { key: "b", value: "just text", updated_at: "2026-10-28T00:00:00.000Z" },
  ]);
  assert.deepEqual(
    rows.map((r) => r.cells),
    [
      ["Alex", ""],
      ["", "just text"],
    ],
  );
  assert.deepEqual(changedCells(["name", "value"], ["Alex", ""], ["Sam", ""]), { name: "Sam" });
  assert.deepEqual(changedCells(["name", "value"], undefined, ["Sam", ""]), { name: "Sam", value: null });
});
