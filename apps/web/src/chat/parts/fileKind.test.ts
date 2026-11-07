import assert from "node:assert/strict";
import { test } from "node:test";
import { viewableAs } from "./fileKind.ts";

test("a PDF and small text files open in the chat; anything else only downloads", () => {
  assert.equal(viewableAs("application/pdf", 9_000_000), "pdf");
  for (const mime of ["text/csv", "text/markdown", "text/html", "application/json", "application/ld+json"])
    assert.equal(viewableAs(mime, 4096), "text", mime);
  assert.equal(viewableAs("text/plain", 3 * 1024 * 1024), undefined);
  assert.equal(viewableAs("application/zip", 4096), undefined);
  assert.equal(viewableAs("application/vnd.openxmlformats-officedocument.wordprocessingml.document", 4096), undefined);
});
