import assert from "node:assert/strict";
import { test } from "node:test";
import { publicError } from "./publicErrors.ts";

test("public-copy feedback distinguishes the HTML limit, copy budget and mandatory review", () => {
  assert.equal(publicError(new Error("public_artifact_html_too_large")), "public.htmlLarge");
  assert.equal(publicError(new Error("public_artifact_too_large")), "public.large");
  assert.equal(publicError(new Error("public_artifact_code_unavailable")), "public.codeBusy");
  assert.equal(publicError(new Error("public_artifact_review_required")), "public.reviewRequired");
  assert.equal(publicError(new Error("public_artifact_account_changed")), "public.invalid");
});
