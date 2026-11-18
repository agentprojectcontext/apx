import assert from "node:assert/strict";
import { test } from "node:test";
import { needsComputerReview } from "./approvalReview.ts";

test("public-copy review follows draft metadata, not a tool name", () => {
  for (const tool of ["apx_settings", "surfaces.public_commit", "browser_open"]) {
    const input: { tool: string; artifact_draft?: string } = { tool };
    assert.equal(needsComputerReview(input), false);
    input.artifact_draft = "reviewed-copy";
    assert.equal(needsComputerReview(input), true);
  }
});
