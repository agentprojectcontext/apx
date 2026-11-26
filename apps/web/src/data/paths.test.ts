import assert from "node:assert/strict";
import { test } from "node:test";
import { relativeInside } from "./paths.ts";

test("a file under a folder is named from that folder, and one outside it is not", () => {
  assert.equal(relativeInside("/work/acme", "/work/acme/notes/plan.md"), "notes/plan.md");
  assert.equal(relativeInside("/work/acme/", "/work/acme//./plan.md"), "plan.md");
  assert.equal(relativeInside("/work/acme", "/work/acme"), "");
  assert.equal(relativeInside("/work/acme", "/work/acme-other/plan.md"), undefined);
  assert.equal(relativeInside("/work/acme", "/work/acme/../northwind/plan.md"), undefined);
  assert.equal(relativeInside("C:\\Work\\Acme", "c:/work/acme/Notes/Plan.md"), "Notes/Plan.md");
});
