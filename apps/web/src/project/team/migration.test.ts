import assert from "node:assert/strict";
import test from "node:test";
import { migrationBlocker, migrationPathSelected, toggleMigrationPath } from "./migration.ts";

test("selecting a folder replaces its selected descendants without dropping unrelated work", () => {
  assert.deepEqual(
    toggleMigrationPath(["research/chart.csv", "notes.md", "research/deep/report.md"], "research", true),
    ["notes.md", "research"],
  );
  assert.equal(migrationPathSelected(["research"], "research/chart.csv"), true);
  assert.equal(migrationPathSelected(["research"], "research-other/chart.csv"), false);
});

test("removing a folder also removes explicit descendants and selecting twice never duplicates it", () => {
  assert.deepEqual(toggleMigrationPath(["research", "research/chart.csv", "notes.md"], "research", false), [
    "notes.md",
  ]);
  assert.deepEqual(toggleMigrationPath(["research"], "research", true), ["research"]);
});

test("every current blocking family has actionable copy and new blockers fail closed", () => {
  for (const code of ["active_run", "active_job", "active_memory_work", "active_source_work"])
    assert.equal(migrationBlocker(code), "busy");
  for (const code of ["slug_conflict", "artifact_name_conflict", "definition_changed"])
    assert.equal(migrationBlocker(code), "conflict");
  for (const code of ["flow_binding", "connected_chat", "group_chat", "cross_project_thread", "published_surface"])
    assert.equal(migrationBlocker(code), "connection");
  for (const code of ["missing_attachment", "project_skill_requires_selection"])
    assert.equal(migrationBlocker(code), "files");
  assert.equal(migrationBlocker("unfinished_migration"), "pending");
  assert.equal(migrationBlocker("future_reason"), "unknown");
});
