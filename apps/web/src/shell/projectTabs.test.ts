import assert from "node:assert/strict";
import { test } from "node:test";
import { PROJECT_TABS, projectTabFrom } from "./projectTabs.ts";

test("a link opens the project tab it names", () => {
  for (const tab of PROJECT_TABS) assert.equal(projectTabFrom(tab.id), tab.id);
});

test("links to the old Artifacts and Files tabs open Files and Directory", () => {
  assert.equal(projectTabFrom("artifacts"), "shared");
  assert.equal(projectTabFrom("files"), "folder");
});

test("a link with no tab or an unknown one opens the overview", () => {
  assert.equal(projectTabFrom(null), "overview");
  assert.equal(projectTabFrom(""), "overview");
  assert.equal(projectTabFrom("widgets"), "overview");
  assert.equal(projectTabFrom("toString"), "overview");
});
