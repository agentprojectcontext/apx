import assert from "node:assert/strict";
import { test } from "node:test";
import { isInside, samePath } from "../../data/paths.ts";
import { migrationBlocker, migrationPathSelected, toggleMigrationPath } from "./migration.ts";

test("file tree selection compares path segments across separators and preserves case-sensitive names", () => {
  assert.equal(samePath("reports\\charts\\", "reports/charts"), true);
  assert.equal(isInside("reports/charts", "reports/charts-other/report.csv"), false);
  assert.equal(isInside("reports/charts", "reports\\charts\\report.csv"), true);
  assert.equal(samePath("C:\\Work\\Reports", "c:/work/reports"), true);
  assert.equal(samePath("Reports", "reports"), false);
  assert.deepEqual(toggleMigrationPath(["reports\\charts\\report.csv", "notes.md"], "reports/charts", true), [
    "notes.md",
    "reports/charts",
  ]);
  assert.equal(migrationPathSelected(["reports/charts"], "reports\\charts\\report.csv"), true);
  assert.equal(migrationBlocker("inherited_scope"), "inheritance");
});
