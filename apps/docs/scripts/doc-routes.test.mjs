import assert from "node:assert/strict";
import { test } from "node:test";
import { documentationId, documentationPath, sitePath } from "../src/doc-routes.mjs";

test("documentation moves beneath docs with locale first and stable anchors", () => {
  assert.equal(documentationPath("/start/install/#windows"), "/docs/start/install/#windows");
  assert.equal(documentationPath("/es/concepts/agents/?from=nav#team"), "/es/docs/concepts/agents/?from=nav#team");
  assert.equal(documentationId("start/install.mdx"), "docs/start/install");
  assert.equal(documentationId("es/start/install.mdx"), "es/docs/start/install");
});

test("web pages, assets, external URLs and migrated documentation stay unchanged", () => {
  for (const path of [
    "/",
    "/es/",
    "/compare/openbot/",
    "/es/compare/",
    "/docs/start/install/",
    "/es/docs/start/install/",
    "/install.sh",
    "/brands/openbot.svg",
    "https://example.com/start/",
    "//example.com/start/",
    "#try",
  ]) {
    assert.equal(sitePath(path), path);
  }
});

test("configurable publication base is added once before locale and docs", () => {
  assert.equal(sitePath("/es/start/install/", "/apx/"), "/apx/es/docs/start/install/");
  assert.equal(sitePath("/apx/es/start/install/", "/apx/"), "/apx/es/docs/start/install/");
  assert.equal(sitePath("/apx/docs/start/install/", "/apx/"), "/apx/docs/start/install/");
  assert.equal(sitePath("/compare/", "/apx/"), "/apx/compare/");
  assert.equal(sitePath("/apx-extra/compare/", "/apx/"), "/apx/apx-extra/compare/");
  assert.equal(sitePath("/preview/apx/es/start/install/", "/preview/apx/"), "/preview/apx/es/docs/start/install/");
});
