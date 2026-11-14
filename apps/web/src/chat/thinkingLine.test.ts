import assert from "node:assert/strict";
import { test } from "node:test";
import { thinkingLine } from "./thinkingLine.ts";

test("a summary made of bold titles shows the newest title's words", () => {
  assert.equal(
    thinkingLine("**Reviewing prior tasks**\n\n**Preparing final build tests**"),
    "Preparing final build tests",
  );
});

test("a title with its words keeps both, on one line", () => {
  assert.equal(thinkingLine("**Planning**\nThe owner wants\na plan."), "Planning The owner wants a plan.");
});

test("nothing said yet shows nothing", () => {
  assert.equal(thinkingLine(undefined), undefined);
  assert.equal(thinkingLine("\n\n"), undefined);
});
