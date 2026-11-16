import assert from "node:assert/strict";
import { test } from "node:test";
import { isSkipAnswer } from "./signals.ts";

test("an answer that is only SKIP reads as nothing new, however it is marked", () => {
  for (const said of ["SKIP", "skip", "**SKIP**", "`SKIP`.", " SKIP! "]) assert.equal(isSkipAnswer(said), true, said);
  for (const said of ["Skipped the meeting", "SKIP this one", "", "OK"]) assert.equal(isSkipAnswer(said), false, said);
});
